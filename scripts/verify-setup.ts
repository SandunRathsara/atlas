#!/usr/bin/env bun
// Proves `atlas setup` without root: every run uses `--root <tmp>` and a fake
// host (systemctl, tailscale, git, gh, stat -f, health). Ownership is recorded
// by the fake chown (by inode); modes are real.
//
// Covers: fresh install (files, modes, owners, units, release dirs read-only),
// dry run, idempotent re-run, re-run with a changed answer and rotation,
// preflight failures (nothing changed), health failure, Btrfs units, adopt from
// the older layout (data and secrets byte-identical, backup, stop order,
// running-Session gate, automatic restore), and every Tailscale branch.
//
// Usage: bun scripts/verify-setup.ts
import { Database } from "bun:sqlite";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import clientManifestJson from "@opencode/client/package.json" with { type: "json" };
import { createReleaseMetadata, RELEASE_ASSET_NAME, type ReleaseMetadata } from "../src/release.ts";
import type { RunResult, SetupHost } from "../src/setup/host.ts";
import { runSetup } from "../src/setup/run.ts";
const clientManifest = clientManifestJson as { version: string };

const base = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "atlas-verify-setup");
const removeBase = () => {
  // Release folders are read-only; make them writable before removing.
  if (existsSync(base)) Bun.spawnSync(["chmod", "-R", "u+w", base]);
  rmSync(base, { recursive: true, force: true });
};
removeBase();
mkdirSync(base, { recursive: true });
let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = "") => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
};

// ---------- fixture Release ----------
const makeRelease = (tag: string) => {
  const dir = join(base, `source-${tag.replace(/[^a-z0-9.]/giu, "_")}`);
  mkdirSync(dir, { recursive: true });
  const sha = "a".repeat(40);
  const [, semver, build] = /^v(.+)\+build\.(\d+)$/u.exec(tag)!;
  const identity = JSON.stringify({ published: true, tag, semver, build: Number(build), gitSha: sha });
  const binary = join(dir, RELEASE_ASSET_NAME);
  writeFileSync(binary, `#!/bin/sh\n[ "$1 $2" = "version --json" ] && { echo '${identity}'; exit 0; }\nexit 1\n`, { mode: 0o755 });
  const bytes = readFileSync(binary);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = createReleaseMetadata(tag, sha, { sha256, size: bytes.length }, clientManifest.version);
  writeFileSync(join(dir, "atlas-release.json"), JSON.stringify(metadata));
  writeFileSync(join(dir, `${RELEASE_ASSET_NAME}.sha256`), `${sha256}  ${RELEASE_ASSET_NAME}\n`);
  return { dir, metadata };
};
const release1 = makeRelease("v1.0.0+build.1");
const release2 = makeRelease("v1.0.0+build.2");

const pemPath = join(base, "app.pem");
writeFileSync(pemPath, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }));
const badPem = join(base, "bad.pem");
writeFileSync(badPem, "not a key\n");

// ---------- fake host ----------
type Scenario = {
  isRoot?: boolean;
  systemd?: boolean;
  gitVersion?: string | null;
  ghVersion?: string | null;
  openCode?: boolean;
  btrfs?: boolean;
  healthy?: boolean;
  /** Tailscale: absent, stopped, running. */
  tailscale?: "absent" | "stopped" | "running";
  /** What `tailscale serve --bg` does: ok, not-enabled (blocks with URL), https-off, then ok on retry. */
  serve?: Array<"ok" | "not-enabled" | "https-off">;
  /** Existing serve target for https://<dns>:443/. */
  serving?: string;
  prompts?: string[] | null;
};

const DNS = "atlas-box.tail1234.ts.net";
const USER = { name: "svc", uid: 1500, gid: 1500, home: "/home/svc" };
const ACCOUNTS: Record<string, { name: string; uid: number; gid: number; home: string }> = {
  svc: USER,
  omega: { name: "omega", uid: 1000, gid: 1000, home: "/home/omega" },
  root: { name: "root", uid: 0, gid: 0, home: "/root" },
};

const makeHost = (root: string, scenario: Scenario = {}) => {
  const calls: string[][] = [];
  const output: string[] = [];
  const owners = new Map<number, { uid: number; gid: number }>();
  const active = new Set<string>();
  let clock = Date.parse("2026-11-18T10:00:00Z");
  let serving = scenario.serving;
  const serveQueue = [...(scenario.serve ?? ["ok"])];
  const prompts = scenario.prompts === undefined ? null : scenario.prompts === null ? null : [...scenario.prompts];
  const asked: string[] = [];
  const tools = new Set(["/usr/bin/systemctl", "/usr/bin/setpriv", "/usr/bin/getent", "/usr/bin/stat"]);
  if (scenario.gitVersion !== null) tools.add("/usr/bin/git");
  if (scenario.ghVersion !== null) tools.add("/usr/bin/gh");
  if (scenario.openCode) tools.add("/opt/atlas/tools/opencode/current/bin/opencode");
  if ((scenario.tailscale ?? "absent") !== "absent") tools.add("/usr/bin/tailscale");
  const result = (code: number, stdout = "", stderr = "", timedOut = false): RunResult => ({ code, stdout, stderr, timedOut });

  const run = async (argv: string[]): Promise<RunResult> => {
    calls.push(argv);
    const [command, ...args] = argv;
    if (command === "/usr/bin/git") return result(0, `git version ${scenario.gitVersion ?? "2.39.5"}\n`);
    if (command === "/usr/bin/gh") return result(0, `gh version ${scenario.ghVersion ?? "2.23.0"} (2023-02-01)\n`);
    if (command === "stat") return result(0, scenario.btrfs ? "btrfs\n" : "ext2/ext3\n");
    if (command === "bash") {
      const child = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
      return result(child.exitCode ?? 1, child.stdout.toString(), child.stderr.toString());
    }
    if (command === "systemctl") {
      const [verb, ...units] = args;
      if (verb === "is-active") {
        const unit = units.at(-1)!;
        return result(active.has(unit) ? 0 : 3, active.has(unit) ? "active\n" : "inactive\n");
      }
      if (verb === "stop") units.forEach((unit) => active.delete(unit));
      if (verb === "start" || verb === "restart") units.forEach((unit) => active.add(unit));
      return result(0);
    }
    if (command === "/usr/bin/tailscale") {
      if (args[0] === "status") {
        return result(0, JSON.stringify(scenario.tailscale === "running"
          ? { BackendState: "Running", Self: { DNSName: `${DNS}.` } }
          : { BackendState: "Stopped", Self: { DNSName: "" } }));
      }
      if (args[0] === "version") return result(0, "1.104.2\n  tailscale commit: x\n");
      if (args[0] === "serve" && args[1] === "status") {
        return result(0, serving ? JSON.stringify({ TCP: { "443": { HTTPS: true } }, Web: { [`${DNS}:443`]: { Handlers: { "/": { Proxy: serving } } } } }) : "{}");
      }
      if (args[0] === "serve") {
        const next = serveQueue.shift() ?? "ok";
        if (next === "not-enabled") {
          return result(137, `Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nABC123\n`, "", true);
        }
        if (next === "https-off") return result(1, "", "error: HTTPS is not enabled for your tailnet; enable HTTPS in the admin panel\n");
        serving = args.at(-1);
        return result(0, "Available within your tailnet:\n");
      }
    }
    return result(127, "", `${command}: not faked`);
  };

  const host: SetupHost = {
    root,
    platform: "linux",
    arch: "x64",
    isRoot: scenario.isRoot ?? true,
    invokingUser: "svc",
    execPath: "/nonexistent/atlas",
    run,
    which: (name) => [...tools].find((path) => path.endsWith(`/${name}`)) ?? null,
    executable: (path) => tools.has(path),
    systemdBooted: () => scenario.systemd ?? true,
    user: (name) => ACCOUNTS[name] ?? null,
    group: (name) => ACCOUNTS[name]?.gid ?? null,
    chown: (path, uid, gid) => owners.set(lstatSync(path).ino, { uid, gid }),
    fetch: (async (url: string | URL) => {
      calls.push(["fetch", String(url)]);
      if (!(scenario.healthy ?? true) || !active.has("atlas.service")) return new Response("down", { status: 503 });
      const current = JSON.parse(readFileSync(join(root, "opt/atlas/current/RELEASE_METADATA.json"), "utf8")) as ReleaseMetadata;
      return Response.json({ status: "ok", atlas: { process: true, release: current.identity }, persistence: { healthy: true } });
    }) as typeof fetch,
    sleep: async (milliseconds) => { clock += milliseconds; },
    now: () => new Date(clock),
    prompter: prompts ? {
      ask: async (question) => {
        asked.push(question);
        // Plain questions take their default; yes/no and retry questions follow the script.
        if (!/\[y\/n\]|Type r/u.test(question)) return "";
        const answer = prompts.shift();
        if (answer === undefined) throw new Error(`unexpected prompt: ${question}`);
        return answer;
      },
    } : null,
    out: (line) => output.push(line),
  };
  return {
    host, calls, output, asked, active,
    text: () => output.join("\n"),
    owner: (path: string) => owners.get(lstatSync(join(root, path)).ino),
    serving: () => serving,
  };
};

// ---------- helpers ----------
let rootCounter = 0;
const newRoot = () => {
  const root = join(base, `root-${++rootCounter}`);
  mkdirSync(root, { recursive: true });
  return root;
};
const p = (root: string, path: string) => join(root, path);
const mode = (root: string, path: string) => lstatSync(p(root, path)).mode & 0o7777;
const read = (root: string, path: string) => readFileSync(p(root, path), "utf8");
const env = (root: string, path: string) => new Map(read(root, path).split("\n").filter((line) => line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as [string, string]));
const answers = (extra: string[] = []) => [
  "--source-dir", release1.dir, "--user", "svc", "--org", "acme", "--app-id", "12345", "--installation-id", "67890",
  "--private-key", pemPath, "--tailscale", "no", "--health-timeout", "5", ...extra,
];
const tree = (root: string, skip: (path: string) => boolean = () => false): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (relative: string) => {
    const full = p(root, relative);
    const stat = lstatSync(full);
    if (skip(relative)) return;
    if (stat.isDirectory()) for (const entry of readdirSync(full).sort()) walk(join(relative, entry));
    else if (stat.isSymbolicLink()) out[relative] = `-> ${readlinkSync(full)}`;
    else out[relative] = createHash("sha256").update(readFileSync(full)).digest("hex");
  };
  if (existsSync(root)) walk("");
  return out;
};
const same = (left: object, right: object) => JSON.stringify(left) === JSON.stringify(right);
const systemctlCalls = (calls: string[][]) => calls.filter((call) => call[0] === "systemctl" && call[1] !== "is-active").map((call) => call.slice(1).join(" "));

// ---------- 1. fresh install ----------
const freshRoot = newRoot();
{
  const fake = makeHost(freshRoot);
  const code = await runSetup(answers(), fake.host);
  check("fresh: exit 0", code === 0, fake.text());
  const owners: Array<[string, number, number, number]> = [
    ["etc/atlas", 0o750, 0, USER.gid],
    ["etc/atlas/atlas.env", 0o600, 0, 0],
    ["etc/atlas/github.env", 0o600, USER.uid, USER.gid],
    ["etc/atlas/github-app.pem", 0o600, USER.uid, USER.gid],
    ["etc/atlas/supplier.key", 0o600, USER.uid, USER.gid],
    ["etc/atlas/updater.key", 0o640, 0, USER.gid],
    ["var/lib/atlas", 0o700, USER.uid, USER.gid],
    ["var/lib/atlas/sessions", 0o700, USER.uid, USER.gid],
    ["opt/atlas", 0o755, 0, 0],
    ["opt/atlas/releases", 0o755, 0, 0],
    ["opt/atlas/services", 0o755, 0, 0],
    ["etc/systemd/system/atlas.service", 0o644, 0, 0],
  ];
  for (const [path, expected, uid, gid] of owners) {
    check(`fresh: ${path} mode`, mode(freshRoot, path) === expected, mode(freshRoot, path).toString(8));
    const owner = fake.owner(path);
    check(`fresh: ${path} owner`, owner?.uid === uid && owner?.gid === gid, JSON.stringify(owner));
  }
  const folder = "opt/atlas/releases/atlas-v1.0.0+build.1";
  check("fresh: release folder read-only", mode(freshRoot, folder) === 0o555 && mode(freshRoot, `${folder}/atlas`) === 0o555);
  for (const dir of ["opt/atlas", "opt/atlas/releases", "opt/atlas/services", folder, `${folder}/bin`]) {
    check(`fresh: ${dir} not group/other writable`, (mode(freshRoot, dir) & 0o022) === 0);
  }
  check("fresh: current -> release", readlinkSync(p(freshRoot, "opt/atlas/current")) === p(freshRoot, folder));
  check("fresh: services/current -> bundle", readlinkSync(p(freshRoot, "opt/atlas/services/current")) === p(freshRoot, "opt/atlas/services/releases/atlas-v1.0.0+build.1"));
  check("fresh: /usr/local/bin/atlas link", readlinkSync(p(freshRoot, "usr/local/bin/atlas")) === p(freshRoot, "opt/atlas/current/atlas"));
  const atlasEnv = env(freshRoot, "etc/atlas/atlas.env");
  check("fresh: token is 43 base64url chars", /^[A-Za-z0-9_-]{43}$/u.test(atlasEnv.get("ATLAS_SHARED_TOKEN") ?? ""));
  check("fresh: webhook secret", /^[A-Za-z0-9_-]{43}$/u.test(atlasEnv.get("ATLAS_GITHUB_WEBHOOK_SECRET") ?? ""));
  check("fresh: no origin without Tailscale", !atlasEnv.has("ATLAS_ORIGIN"));
  check("fresh: no recovery status off Btrfs", !atlasEnv.has("ATLAS_RECOVERY_STATUS_PATH"));
  check("fresh: git wrapper", atlasEnv.get("ATLAS_GIT_BINARY") === "/opt/atlas/current/bin/git");
  check("fresh: keys are 64 hex", /^[0-9a-f]{64}\n$/u.test(read(freshRoot, "etc/atlas/supplier.key")) && /^[0-9a-f]{64}\n$/u.test(read(freshRoot, "etc/atlas/updater.key")));
  const githubEnv = env(freshRoot, "etc/atlas/github.env");
  check("fresh: github.env", githubEnv.get("ATLAS_GITHUB_ORGANIZATION") === "acme" && githubEnv.get("ATLAS_GITHUB_APP_ID") === "12345" &&
    githubEnv.get("ATLAS_GITHUB_INSTALLATION_ID") === "67890" && githubEnv.get("ATLAS_GITHUB_APP_PRIVATE_KEY_PATH") === "/etc/atlas/github-app.pem");
  check("fresh: pem copied", read(freshRoot, "etc/atlas/github-app.pem") === readFileSync(pemPath, "utf8"));
  const unit = read(freshRoot, "etc/systemd/system/atlas.service");
  check("fresh: unit user", unit.includes("User=svc\n") && unit.includes("ExecStart=/opt/atlas/current/atlas serve"));
  check("fresh: no maintenance units", !existsSync(p(freshRoot, "etc/systemd/system/atlas-snapshot.service")));
  check("fresh: journald config", existsSync(p(freshRoot, "etc/systemd/journald@atlas.conf")));
  check("fresh: opencode config", existsSync(p(freshRoot, "var/lib/atlas/opencode-config/opencode/opencode.json")));
  const systemctl = systemctlCalls(fake.calls);
  check("fresh: enable + start order", same(systemctl, [
    "daemon-reload", "enable atlas-credentials.service atlas-updater.service atlas.service",
    "restart atlas-credentials.service", "restart atlas-updater.service", "restart atlas.service",
  ]), JSON.stringify(systemctl));
  check("fresh: OpenCode missing only warns", fake.text().includes("OpenCode not found"));
  check("fresh: token shown once", fake.text().split(atlasEnv.get("ATLAS_SHARED_TOKEN")!).length === 2);
  check("fresh: webhook secret never shown", !fake.text().includes(atlasEnv.get("ATLAS_GITHUB_WEBHOOK_SECRET")!));
  check("fresh: HTTPS warning", fake.text().includes("sign-in needs HTTPS"));
}

// ---------- 2. re-run: identical, nothing restarted ----------
{
  const before = tree(freshRoot);
  const fake = makeHost(freshRoot);
  const code = await runSetup(["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5"], fake.host);
  check("rerun: exit 0", code === 0, fake.text());
  check("rerun: files byte-identical", same(before, tree(freshRoot)), JSON.stringify(Object.keys(tree(freshRoot)).filter((key) => tree(freshRoot)[key] !== before[key])));
  check("rerun: start, not restart", same(systemctlCalls(fake.calls).slice(-3), ["start atlas-credentials.service", "start atlas-updater.service", "start atlas.service"]), JSON.stringify(systemctlCalls(fake.calls)));
  check("rerun: token not shown", fake.text().includes("Sign-in token: unchanged"));
  check("rerun: no backup", !existsSync(p(freshRoot, "var/backups/atlas")));
}

// ---------- 3. re-run: changed answer, rotation, newer Release, no downgrade ----------
{
  const token = env(freshRoot, "etc/atlas/atlas.env").get("ATLAS_SHARED_TOKEN");
  const webhook = env(freshRoot, "etc/atlas/atlas.env").get("ATLAS_GITHUB_WEBHOOK_SECRET");
  const fake = makeHost(freshRoot);
  const code = await runSetup(["--source-dir", release2.dir, "--port", "3100", "--rotate-token", "--tailscale", "no", "--health-timeout", "5"], fake.host);
  const atlasEnv = env(freshRoot, "etc/atlas/atlas.env");
  check("rerun2: exit 0", code === 0, fake.text());
  check("rerun2: port changed", atlasEnv.get("ATLAS_PORT") === "3100");
  check("rerun2: token rotated and shown", atlasEnv.get("ATLAS_SHARED_TOKEN") !== token && fake.text().includes(atlasEnv.get("ATLAS_SHARED_TOKEN")!));
  check("rerun2: webhook secret kept", atlasEnv.get("ATLAS_GITHUB_WEBHOOK_SECRET") === webhook);
  check("rerun2: restart", systemctlCalls(fake.calls).includes("restart atlas.service"));
  check("rerun2: current -> build.2", readlinkSync(p(freshRoot, "opt/atlas/current")).endsWith("atlas-v1.0.0+build.2"));
  const backups = readdirSync(p(freshRoot, "var/backups/atlas"));
  check("rerun2: backup of atlas.env", backups.length === 1 && backups[0]!.startsWith("setup-") &&
    env(freshRoot, `var/backups/atlas/${backups[0]}/etc/atlas/atlas.env`).get("ATLAS_SHARED_TOKEN") === token);
  check("rerun2: health probed new port", fake.calls.some((call) => call[0] === "fetch" && call[1]!.includes(":3100/")));

  const again = makeHost(freshRoot);
  const downgrade = await runSetup(["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5"], again.host);
  check("rerun3: older Release does not downgrade", downgrade === 0 && readlinkSync(p(freshRoot, "opt/atlas/current")).endsWith("atlas-v1.0.0+build.2"), again.text());
}

// ---------- 4. dry run ----------
{
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(answers(["--dry-run"]), fake.host);
  check("dry-run: exit 0", code === 0, fake.text());
  check("dry-run: nothing written", readdirSync(root).length === 0, readdirSync(root).join(","));
  check("dry-run: no systemctl", systemctlCalls(fake.calls).length === 0);
  check("dry-run: plan printed", fake.text().includes("Plan (nothing was changed)") && fake.text().includes("Release folder"));
}

// ---------- 5. preflight failures change nothing ----------
for (const [label, scenario, extra, expect] of [
  ["git too old", { gitVersion: "2.30.0" }, [], "git 2.30.0 is too old"],
  ["gh missing", { ghVersion: null }, [], "gh is not installed"],
  ["not root", { isRoot: false }, [], "not running as root"],
  ["no systemd", { systemd: false }, [], "systemd is not running"],
  ["bad pem", {}, ["--private-key", badPem], "not a readable PEM"],
  ["root user", {}, ["--user", "root"], "must not be root"],
  ["bad origin", {}, ["--origin", "http://x"], "https"],
] as Array<[string, Scenario, string[], string]>) {
  const root = newRoot();
  const fake = makeHost(root, scenario);
  const code = await runSetup([...answers(), ...extra], fake.host);
  check(`preflight ${label}: exit 1`, code === 1, fake.text());
  check(`preflight ${label}: message`, fake.text().includes(expect), fake.text());
  check(`preflight ${label}: nothing written`, readdirSync(root).length === 0);
  check(`preflight ${label}: no systemctl`, systemctlCalls(fake.calls).length === 0);
}
{
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", release1.dir, "--tailscale", "no"], fake.host);
  check("missing answers without a terminal: exit 1", code === 1 && fake.text().includes("Missing answer: GitHub organization"), fake.text());
  check("missing answers: nothing written", readdirSync(root).length === 0);
}

// ---------- 6. health failure ----------
{
  const root = newRoot();
  const fake = makeHost(root, { healthy: false });
  const code = await runSetup(answers(), fake.host);
  check("health: exit 1", code === 1);
  check("health: hints", fake.text().includes("journalctl --namespace=atlas") && fake.text().includes("did not report healthy within 5s"), fake.text());
}

// ---------- 7. Btrfs ----------
{
  const root = newRoot();
  const fake = makeHost(root, { btrfs: true, openCode: true });
  const code = await runSetup(answers(), fake.host);
  check("btrfs: exit 0", code === 0, fake.text());
  check("btrfs: maintenance units", ["atlas-snapshot.service", "atlas-snapshot.timer", "atlas-space-check.service", "atlas-space-check.timer"]
    .every((name) => existsSync(p(root, `etc/systemd/system/${name}`))));
  check("btrfs: snapshot runs the binary", read(root, "etc/systemd/system/atlas-snapshot.service").includes("ExecStart=/opt/atlas/current/atlas ops snapshot"));
  check("btrfs: recovery status path", env(root, "etc/atlas/atlas.env").get("ATLAS_RECOVERY_STATUS_PATH") === "/var/lib/atlas/recovery-status");
  check("btrfs: backups root 0700", mode(root, "var/backups/atlas") === 0o700);
  check("btrfs: timers enabled", systemctlCalls(fake.calls).includes("enable --now atlas-snapshot.timer atlas-space-check.timer"));
  check("btrfs: OpenCode present is enabled and started", systemctlCalls(fake.calls).some((call) => call.startsWith("enable") && call.includes("opencode.service")) &&
    systemctlCalls(fake.calls).includes("start opencode.service"));
}

// ---------- 8. adopt ----------
const git = (args: string[]) => Bun.spawnSync(["git", ...args], { stdout: "pipe" }).stdout.toString();
const oldLayout = (root: string, sessionState: string | null) => {
  for (const name of ["atlas.service", "atlas-credentials.service", "atlas-updater.service", "opencode.service",
    "atlas-snapshot.service", "atlas-snapshot.timer", "atlas-space-check.service", "atlas-space-check.timer"]) {
    mkdirSync(p(root, "etc/systemd/system"), { recursive: true });
    writeFileSync(p(root, `etc/systemd/system/${name}`), git(["show", `432fe69:deploy/systemd/${name}`]), { mode: 0o644 });
  }
  mkdirSync(p(root, "etc/atlas"), { recursive: true, mode: 0o750 });
  const oldEnv = git(["show", "432fe69:deploy/atlas.env.example"])
    .replace("REPLACE_WITH_PRIVATE_SHARED_TOKEN", "old-token-0123456789abcdefghijklmnopqrstuvwxyz")
    .replace("REPLACE_WITH_GITHUB_WEBHOOK_SECRET", "old-webhook-secret-value")
    .replace("ATLAS_GIT_BINARY=/opt/atlas/current/bin/git", "ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git");
  writeFileSync(p(root, "etc/atlas/atlas.env"), oldEnv, { mode: 0o600 });
  writeFileSync(p(root, "etc/atlas/github.env"), git(["show", "432fe69:deploy/github.env.example"]).replace("your-organization", "acme"), { mode: 0o600 });
  writeFileSync(p(root, "etc/atlas/github-app.pem"), readFileSync(pemPath), { mode: 0o600 });
  writeFileSync(p(root, "etc/atlas/supplier.key"), `${"1".repeat(64)}\n`, { mode: 0o600 });
  writeFileSync(p(root, "etc/atlas/updater.key"), `${"2".repeat(64)}\n`, { mode: 0o640 });
  const data = p(root, "var/lib/atlas");
  for (const dir of ["sessions/s1", "opencode-config/opencode", "opencode-data/opencode", "opencode-state/opencode", "opencode-cache", "opencode-runtime"]) {
    mkdirSync(join(data, dir), { recursive: true, mode: 0o700 });
  }
  writeFileSync(join(data, "sessions/s1/notes.txt"), "work in progress\n");
  writeFileSync(join(data, "session-scopes.json"), "{\"scopes\":[]}", { mode: 0o600 });
  const database = new Database(join(data, "atlas.sqlite"));
  database.run("CREATE TABLE sessions (id INTEGER PRIMARY KEY, state TEXT NOT NULL)");
  database.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
  database.run("INSERT INTO schema_migrations VALUES (7, 'x')");
  database.run("INSERT INTO sessions (state) VALUES ('succeeded')");
  if (sessionState) database.run("INSERT INTO sessions (state) VALUES (?)", [sessionState]);
  database.close();
  const oldRelease = p(root, "opt/atlas/releases/atlas-v0.9.0+build.3");
  mkdirSync(join(oldRelease, "src"), { recursive: true });
  writeFileSync(join(oldRelease, "src/server.ts"), "// old\n");
  symlinkSync(oldRelease, p(root, "opt/atlas/current"));
  const oldBundle = p(root, "opt/atlas/services/releases/bootstrap-1-2");
  mkdirSync(oldBundle, { recursive: true });
  symlinkSync(oldBundle, p(root, "opt/atlas/services/current"));
  return { oldRelease, oldBundle };
};
const adoptArgs = (extra: string[] = []) => ["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5", ...extra];
const dataAndSecrets = (root: string) => ({
  data: tree(p(root, "var/lib/atlas"), (path) => path === "opencode-config/opencode/opencode.json"),
  secrets: ["github.env", "github-app.pem", "supplier.key", "updater.key"].map((name) => read(root, `etc/atlas/${name}`)),
  env: [...env(root, "etc/atlas/atlas.env")].filter(([key]) => !["ATLAS_GIT_BINARY", "ATLAS_RECOVERY_STATUS_PATH"].includes(key)),
});
{
  const root = newRoot();
  oldLayout(root, null);
  const before = tree(root);
  const refused = makeHost(root);
  check("adopt: needs --adopt without a terminal", await runSetup(adoptArgs(), refused.host) === 1 && refused.text().includes("--adopt"), refused.text());
  check("adopt: refused run changed nothing", same(before, tree(root)));
}
{
  const root = newRoot();
  oldLayout(root, "running");
  const before = tree(root);
  const fake = makeHost(root);
  const code = await runSetup(adoptArgs(["--adopt"]), fake.host);
  check("adopt: running Session blocks", code === 1 && fake.text().includes("1 running") && fake.text().includes("--confirm-running-sessions"), fake.text());
  check("adopt: blocked run changed nothing", same(before, tree(root)) && systemctlCalls(fake.calls).length === 0);
}
{
  const root = newRoot();
  const { oldRelease } = oldLayout(root, "running");
  const before = dataAndSecrets(root);
  const oldUnits = read(root, "etc/systemd/system/atlas.service");
  const fake = makeHost(root, { openCode: true });
  ["atlas.service", "atlas-updater.service", "atlas-credentials.service", "opencode.service"].forEach((unit) => fake.active.add(unit));
  const code = await runSetup(adoptArgs(["--adopt", "--confirm-running-sessions"]), fake.host);
  check("adopt: exit 0", code === 0, fake.text());
  const after = dataAndSecrets(root);
  check("adopt: data byte-identical", same(before.data, after.data));
  check("adopt: secrets byte-identical", same(before.secrets, after.secrets) && same(before.env, after.env));
  check("adopt: git wrapper rewritten", env(root, "etc/atlas/atlas.env").get("ATLAS_GIT_BINARY") === "/opt/atlas/current/bin/git");
  check("adopt: recovery status removed off Btrfs", !env(root, "etc/atlas/atlas.env").has("ATLAS_RECOVERY_STATUS_PATH"));
  check("adopt: service user from old units", read(root, "etc/systemd/system/atlas.service").includes("User=omega"));
  const backups = readdirSync(p(root, "var/backups/atlas"));
  const backup = `var/backups/atlas/${backups.find((name) => !name.startsWith("setup-"))}`;
  check("adopt: units backed up", read(root, `${backup}/etc/systemd/system/atlas.service`) === oldUnits &&
    existsSync(p(root, `${backup}/etc/systemd/system/atlas-snapshot.timer`)));
  check("adopt: env backed up", env(root, `${backup}/etc/atlas/atlas.env`).get("ATLAS_GIT_BINARY") === "/opt/atlas/current/deploy/bin/git");
  check("adopt: rollback steps saved", read(root, `${backup}/ROLLBACK.txt`).includes(`ln -sfnT ${oldRelease} /opt/atlas/current`));
  const systemctl = systemctlCalls(fake.calls);
  check("adopt: stop order", same(systemctl.slice(0, 3), ["stop atlas.service", "stop atlas-updater.service", "stop atlas-credentials.service"]), JSON.stringify(systemctl));
  check("adopt: OpenCode never stopped or restarted", !systemctl.some((call) => call.includes("opencode")));
  check("adopt: old maintenance units removed", !existsSync(p(root, "etc/systemd/system/atlas-snapshot.service")) && systemctl.includes("disable --now atlas-snapshot.timer"));
  check("adopt: old Release tree kept", existsSync(join(oldRelease, "src/server.ts")));
  check("adopt: current switched", readlinkSync(p(root, "opt/atlas/current")).endsWith("atlas-v1.0.0+build.1"));
  check("adopt: OpenCode restart hint", fake.text().includes("restart opencode.service"));
}
{
  const root = newRoot();
  const { oldRelease, oldBundle } = oldLayout(root, null);
  const before = tree(root, (path) => path.startsWith("var/backups") || path.startsWith("opt/atlas/releases/atlas-v1") ||
    path.startsWith("opt/atlas/services/releases/atlas-v1") || path === "var/lib/atlas/opencode-config/opencode/opencode.json" ||
    path === "etc/systemd/journald@atlas.conf" || path === "usr");
  const fake = makeHost(root, { healthy: false });
  ["atlas.service", "atlas-updater.service", "atlas-credentials.service"].forEach((unit) => fake.active.add(unit));
  const code = await runSetup(adoptArgs(["--adopt"]), fake.host);
  const after = tree(root, (path) => path.startsWith("var/backups") || path.startsWith("opt/atlas/releases/atlas-v1") ||
    path.startsWith("opt/atlas/services/releases/atlas-v1") || path === "var/lib/atlas/opencode-config/opencode/opencode.json" ||
    path === "etc/systemd/journald@atlas.conf" || path === "usr");
  check("adopt-fail: exit 1", code === 1);
  check("adopt-fail: restored automatically", fake.text().includes("Restored."), fake.text());
  check("adopt-fail: units, env, links back", same(before, after), JSON.stringify(Object.keys(after).filter((key) => after[key] !== before[key])));
  check("adopt-fail: links", readlinkSync(p(root, "opt/atlas/current")) === oldRelease && readlinkSync(p(root, "opt/atlas/services/current")) === oldBundle);
  check("adopt-fail: old services started again", ["atlas-credentials.service", "atlas-updater.service", "atlas.service"].every((unit) => fake.active.has(unit)));
}

// ---------- 9. Tailscale ----------
const tailscaleRun = async (label: string, scenario: Scenario, extra: string[]) => {
  const root = newRoot();
  const fake = makeHost(root, scenario);
  const code = await runSetup([...answers(), ...extra], fake.host);
  check(`tailscale ${label}: exit 0`, code === 0, fake.text());
  return { root, fake };
};
{
  const { fake } = await tailscaleRun("absent", { tailscale: "absent" }, ["--tailscale", "ask"]);
  check("tailscale absent: info line", fake.text().includes("Tailscale is not installed; skipping."));
}
{
  const { fake } = await tailscaleRun("stopped", { tailscale: "stopped" }, ["--tailscale", "yes"]);
  check("tailscale stopped: info line", fake.text().includes("Tailscale is not running (Stopped)"));
}
{
  const { root, fake } = await tailscaleRun("ok", { tailscale: "running", prompts: ["y"] }, ["--tailscale", "ask"]);
  check("tailscale ok: explicit question", fake.asked.some((question) => question.includes(`Make Atlas available to every device on your tailnet at https://${DNS}/ ?`)));
  check("tailscale ok: serve --bg", fake.calls.some((call) => call.join(" ") === "/usr/bin/tailscale serve --bg --https=443 http://127.0.0.1:3000"));
  check("tailscale ok: origin set", env(root, "etc/atlas/atlas.env").get("ATLAS_ORIGIN") === `https://${DNS}`);
  check("tailscale ok: atlas restarted", systemctlCalls(fake.calls).filter((call) => call === "restart atlas.service").length === 2);
  check("tailscale ok: never funnel", !fake.calls.some((call) => call.includes("funnel")) && fake.text().includes("tailscale funnel --bg --https=8443 http://127.0.0.1:3001"));
}
{
  const { fake } = await tailscaleRun("no tty", { tailscale: "running" }, ["--tailscale", "ask"]);
  check("tailscale ask without tty: not served", fake.text().includes("not asked (no terminal)") && !fake.calls.some((call) => call[1] === "serve" && call[2] === "--bg"));
}
{
  const { root, fake } = await tailscaleRun("not-enabled skip", { tailscale: "running", serve: ["not-enabled"], prompts: ["s"] }, ["--tailscale", "yes"]);
  check("tailscale not-enabled: URL shown", fake.text().includes("https://login.tailscale.com/f/serve?node=nABC123"));
  check("tailscale not-enabled: skipped", !env(root, "etc/atlas/atlas.env").has("ATLAS_ORIGIN"));
}
{
  const { root, fake } = await tailscaleRun("not-enabled retry", { tailscale: "running", serve: ["not-enabled", "ok"], prompts: ["r"] }, ["--tailscale", "yes"]);
  check("tailscale retry: served after retry", env(root, "etc/atlas/atlas.env").get("ATLAS_ORIGIN") === `https://${DNS}`, fake.text());
}
{
  const { fake } = await tailscaleRun("https-off", { tailscale: "running", serve: ["https-off"], prompts: ["s"] }, ["--tailscale", "yes"]);
  check("tailscale https-off: hint", fake.text().includes("HTTPS certificates are off"), fake.text());
}
{
  const { root, fake } = await tailscaleRun("conflict", { tailscale: "running", serving: "http://127.0.0.1:8080", prompts: ["n"] }, ["--tailscale", "yes"]);
  check("tailscale conflict: asked", fake.text().includes("already serves") && fake.asked.some((question) => question.includes("Replace it")));
  check("tailscale conflict: not clobbered", fake.serving() === "http://127.0.0.1:8080" && !env(root, "etc/atlas/atlas.env").has("ATLAS_ORIGIN"));
}
{
  const { fake } = await tailscaleRun("conflict no tty", { tailscale: "running", serving: "http://127.0.0.1:8080" }, ["--tailscale", "yes"]);
  check("tailscale conflict without tty: not clobbered", fake.serving() === "http://127.0.0.1:8080");
}
{
  const { root } = await tailscaleRun("given origin kept", { tailscale: "running" }, ["--tailscale", "yes", "--origin", "https://atlas.example.com"]);
  check("tailscale: explicit origin wins", env(root, "etc/atlas/atlas.env").get("ATLAS_ORIGIN") === "https://atlas.example.com");
}

// ---------- 10. answers file ----------
{
  const root = newRoot();
  const file = join(base, "answers.json");
  writeFileSync(file, JSON.stringify({ user: "svc", organization: "acme", appId: "1", installationId: "2", privateKeyPath: pemPath, tailscale: "no", port: 3200 }));
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", release1.dir, "--answers", file, "--health-timeout", "5"], fake.host);
  check("answers file: exit 0", code === 0 && env(root, "etc/atlas/atlas.env").get("ATLAS_PORT") === "3200", fake.text());
  writeFileSync(file, JSON.stringify({ nope: 1 }));
  check("answers file: unknown key refused", await runSetup(["--source-dir", release1.dir, "--answers", file], makeHost(newRoot()).host) === 2);
}

removeBase();
if (failures > 0) {
  console.error(`verify-setup: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`verify-setup: ${checks} checks passed`);
