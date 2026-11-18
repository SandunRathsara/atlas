// Optional: share the Atlas UI on the tailnet with `tailscale serve` (never
// Funnel). Runs after the services are healthy. Every tailscale call has a
// timeout, because `serve` blocks while Serve is not enabled on the tailnet.
import { compareVersions, parseToolVersion } from "../host-tools.ts";
import type { Tailscale } from "./answers.ts";
import type { SetupHost } from "./host.ts";

export type TailscaleOutcome =
  | { kind: "served"; url: string }
  | { kind: "skipped"; reason: string };

const SERVE_TIMEOUT_MS = 20_000;
const ENABLE_SERVE_URL = /https:\/\/login\.tailscale\.com\/f\/serve\?\S+/u;

/** `{ dns }` when tailscale is installed, logged in, and running; otherwise a reason. */
export const detectTailscale = async (host: SetupHost): Promise<{ binary: string; dns: string } | { reason: string }> => {
  const binary = host.which("tailscale");
  if (!binary) return { reason: "Tailscale is not installed" };
  const status = await host.run([binary, "status", "--json"], { timeoutMs: 10_000 });
  let parsed: { BackendState?: unknown; Self?: { DNSName?: unknown } } = {};
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    return { reason: "Tailscale did not report its status" };
  }
  if (parsed.BackendState !== "Running") return { reason: `Tailscale is not running (${String(parsed.BackendState ?? "unknown")})` };
  const dns = typeof parsed.Self?.DNSName === "string" ? parsed.Self.DNSName.replace(/\.$/u, "") : "";
  if (!/^[a-z0-9.-]+$/iu.test(dns)) return { reason: "Tailscale has no MagicDNS name for this machine" };
  return { binary, dns };
};

const askYesNo = async (host: SetupHost, question: string) => {
  for (;;) {
    const answer = (await host.prompter!.ask(`${question} [y/n] `)).trim().toLowerCase();
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
  }
};

/** What already serves https://<dns>:443/, if anything. */
const currentServe = async (host: SetupHost, binary: string, dns: string) => {
  const status = await host.run([binary, "serve", "status", "--json"], { timeoutMs: 10_000 });
  if (status.code !== 0) return { known: false as const };
  let config: { TCP?: Record<string, { HTTPS?: boolean; TCPForward?: string }>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string }> }> } = {};
  try {
    config = status.stdout.trim() ? JSON.parse(status.stdout) : {};
  } catch {
    return { known: false as const };
  }
  const handler = config.Web?.[`${dns}:443`]?.Handlers?.["/"];
  const tcp = config.TCP?.["443"];
  const target = handler ? handler.Proxy ?? handler.Path ?? "text" : tcp?.TCPForward ? `tcp ${tcp.TCPForward}` : null;
  return { known: true as const, target };
};

const classify = (output: string) => {
  const enableUrl = ENABLE_SERVE_URL.exec(output)?.[0];
  if (enableUrl) return { kind: "serve-not-enabled" as const, url: enableUrl };
  if (/https?\b[^\n]*(not enabled|disabled)|enable https|certificates? (are|is) (not|disabled)/iu.test(output)) {
    return { kind: "https-disabled" as const };
  }
  if (/access denied|permission denied|--operator|use 'sudo/iu.test(output)) return { kind: "permission" as const };
  return { kind: "other" as const };
};

export const setUpTailscale = async (
  host: SetupHost,
  options: { mode: Tailscale; port: number; webhookPort: number },
): Promise<TailscaleOutcome> => {
  if (options.mode === "no") return { kind: "skipped", reason: "Tailscale: skipped (--tailscale=no)." };
  const detected = await detectTailscale(host);
  if ("reason" in detected) return { kind: "skipped", reason: `Tailscale: ${detected.reason}; skipping.` };
  const { binary, dns } = detected;
  const url = `https://${dns}`;
  const local = `http://127.0.0.1:${options.port}`;

  if (options.mode === "ask") {
    if (!host.prompter) return { kind: "skipped", reason: `Tailscale: not asked (no terminal). Re-run with --tailscale=yes to serve ${url}/.` };
    if (!await askYesNo(host, `Make Atlas available to every device on your tailnet at ${url}/ ?`)) {
      return { kind: "skipped", reason: "Tailscale: you chose not to serve Atlas." };
    }
  }

  const existing = await currentServe(host, binary, dns);
  if (existing.known && existing.target === local) return { kind: "served", url };
  if (!existing.known) {
    // Unknown is not "empty": serving could replace someone else's config.
    host.out(`Tailscale: could not read the current serve config, so something may already serve ${url}/.`);
    if (!host.prompter || !await askYesNo(host, `Serve Atlas (${local}) at ${url}/ anyway, replacing whatever is there?`)) {
      return { kind: "skipped", reason: `Tailscale: left the serve config alone. Check \`tailscale serve status\`, then: tailscale serve --bg --https=443 ${local}` };
    }
  }
  if (existing.known && existing.target) {
    host.out(`Tailscale already serves ${url}/ -> ${existing.target}.`);
    if (!host.prompter || !await askYesNo(host, `Replace it with Atlas (${local})?`)) {
      return { kind: "skipped", reason: `Tailscale: left the existing serve config alone. To use it for Atlas: tailscale serve --bg --https=443 ${local}` };
    }
  }

  const version = parseToolVersion((await host.run([binary, "version"], { timeoutMs: 10_000 })).stdout);
  const legacy = version !== null && compareVersions(version, "1.52.0") < 0;
  const serveArgs = legacy ? [binary, "serve", "https", "/", local] : [binary, "serve", "--bg", "--https=443", local];

  for (;;) {
    const result = await host.run(serveArgs, { timeoutMs: SERVE_TIMEOUT_MS });
    const output = `${result.stdout}\n${result.stderr}`;
    const after = await currentServe(host, binary, dns);
    if (!result.timedOut && result.code === 0 && after.known && after.target === local) return { kind: "served", url };
    const problem = classify(output);
    let message: string;
    if (problem.kind === "serve-not-enabled") {
      message = `Serve is not enabled on your tailnet. Enable it here: ${problem.url}`;
    } else if (problem.kind === "https-disabled") {
      message = "HTTPS certificates are off for your tailnet. Turn on HTTPS at https://login.tailscale.com/admin/dns";
    } else if (problem.kind === "permission") {
      message = "Tailscale refused: this account may not change serve settings. Run setup with sudo, or: tailscale set --operator=$USER";
    } else {
      message = `tailscale serve failed${result.timedOut ? " (timed out)" : ""}: ${output.trim().split("\n").slice(-2).join(" ")}`;
    }
    host.out(message);
    if (!host.prompter || problem.kind === "permission" || problem.kind === "other") {
      return { kind: "skipped", reason: `Tailscale: not set up. Later: tailscale ${serveArgs.slice(1).join(" ")}` };
    }
    const choice = (await host.prompter.ask("Type r to retry or s to skip: ")).trim().toLowerCase();
    if (choice !== "r") return { kind: "skipped", reason: `Tailscale: skipped. Later: tailscale ${serveArgs.slice(1).join(" ")}` };
  }
};

export const funnelHint = (webhookPort: number, dns: string | null) =>
  `Webhooks (optional, public): tailscale funnel --bg --https=8443 http://127.0.0.1:${webhookPort}` +
  (dns ? `  ->  https://${dns}:8443/webhooks/github` : "");
