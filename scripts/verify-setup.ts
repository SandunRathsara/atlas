#!/usr/bin/env bun
// Proves `atlas setup` without root: every run uses `--root <tmp>` and a fake
// host (systemctl, tailscale, git, gh, stat -f, health, id, useradd). Ownership
// is recorded by the fake fchown/chown (by inode + birth time, shared across
// runs; unrecorded means root); modes are real. `runAs` emulates the service
// user: it may create or read only what that account owns.
//
// Covers: fresh install (files, modes, owners, units, release dirs read-only),
// dry run, idempotent re-run, re-run with a changed answer and rotation,
// preflight failures (nothing changed), health failure, Btrfs units, adopt from
// the older layout (data and secrets byte-identical, backup, stop order,
// running-Session gate, automatic restore), every Tailscale branch, the
// service-user policy (dedicated account, privileged accounts), unsafe source
// folders and tools, and a hostile service user planting paths for root.
//
// Usage: bun scripts/verify-setup.ts
import { Database } from "bun:sqlite";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  cpSync, existsSync, fstatSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync,
  writeFileSync, type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sessionSummary } from "../src/commands/ops.ts";
import clientManifestJson from "@opencode/client/package.json" with { type: "json" };
import { createReleaseMetadata, RELEASE_ASSET_NAME, type ReleaseMetadata } from "../src/release.ts";
import type { RunAs, RunResult, SetupHost } from "../src/setup/host.ts";
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
const stagesBefore = readdirSync("/var/tmp").filter((name) => name.startsWith("atlas-setup-")).sort();
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
  /** `tailscale serve status` fails. */
  serveStatusFails?: boolean;
  /** Host tools root must not run (path -> problem). */
  unsafeTools?: Record<string, string>;
};

const DNS = "atlas-box.tail1234.ts.net";
type FakeAccount = { name: string; uid: number; gid: number; home: string; groups: string[] };
const USER = { name: "svc", uid: 1500, gid: 1500, home: "/home/svc" };
const ACCOUNTS: Record<string, FakeAccount> = {
  svc: { ...USER, groups: ["svc"] },
  omega: { name: "omega", uid: 1000, gid: 1000, home: "/home/omega", groups: ["omega", "sudo"] },
  root: { name: "root", uid: 0, gid: 0, home: "/root", groups: ["root"] },
};

// Fake ownership, shared by every host (a re-run sees what earlier runs set).
const owners = new Map<string, { uid: number; gid: number }>();
const ownerKey = (stat: Pick<Stats, "ino" | "birthtimeMs">) => `${stat.ino}:${stat.birthtimeMs}`;
const ownerOf = (stat: Pick<Stats, "ino" | "birthtimeMs">) => owners.get(ownerKey(stat)) ?? { uid: 0, gid: 0 };
/** Marks a real path (not followed) as owned by uid/gid in the fake. */
const own = (full: string, uid: number, gid: number) => owners.set(ownerKey(lstatSync(full)), { uid, gid });
const ownTree = (full: string, uid: number, gid: number) => {
  own(full, uid, gid);
  if (lstatSync(full).isDirectory()) for (const entry of readdirSync(full)) ownTree(join(full, entry), uid, gid);
};

const makeHost = (root: string, scenario: Scenario = {}) => {
  const calls: string[][] = [];
  const output: string[] = [];
  const accounts: Record<string, FakeAccount> = { ...ACCOUNTS };
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
    if (command === "id" && args[0] === "-nG") {
      const account = accounts[args.at(-1)!];
      return account ? result(0, `${account.groups.join(" ")}\n`) : result(1, "", "no such user\n");
    }
    if (command === "sudo") return result(1, "", "sudo: a password is required\n");
    if (command === "useradd") {
      const name = args.at(-1)!;
      const home = args[args.indexOf("--home-dir") + 1]!;
      accounts[name] = { name, uid: 990, gid: 990, home, groups: [name] };
      return result(0);
    }
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
        if (scenario.serveStatusFails) return result(1, "", "error: failed to fetch serve config\n");
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

  // ---- the service user, emulated: it reaches only what its uid owns ----
  const uidOf = (account: RunAs) => (account ? accounts[account.user]?.uid ?? -2 : 65534);
  const mayRead = (uid: number, full: string) => {
    if (!existsSync(full)) return false;
    const stat = statSync(realpathSync(full));
    return ownerOf(stat).uid === uid ? (stat.mode & 0o400) !== 0 : (stat.mode & 0o004) !== 0;
  };
  const runAs = async (account: RunAs, argv: string[]): Promise<RunResult> => {
    calls.push(["runAs", account?.user ?? "nobody", ...argv]);
    const uid = uidOf(account);
    const gid = account ? accounts[account.user]?.gid ?? -2 : 65534;
    const [command, ...args] = argv;
    if (args[0] === "ops" && args[1] === "session-summary") {
      const database = args[2]!;
      if (existsSync(database) && !mayRead(uid, database)) return result(0, JSON.stringify({ active: {}, schema: null, readable: false }));
      return result(0, JSON.stringify(sessionSummary(database)));
    }
    if (command === "cat") {
      const file = args.at(-1)!;
      return mayRead(uid, file) ? result(0, readFileSync(file, "utf8")) : result(1, "", `cat: ${file}: Permission denied\n`);
    }
    if (command === "mkdir") {
      const modeArg = Number.parseInt(args[args.indexOf("-m") + 1]!, 8);
      for (const target of args.slice(args.indexOf("--") + 1)) {
        if (existsSync(target)) continue; // mkdir -p: an existing folder (or link to one) is left alone
        let parent = dirname(target);
        while (!existsSync(parent)) parent = dirname(parent);
        if (ownerOf(statSync(realpathSync(parent))).uid !== uid) return result(1, "", `mkdir: ${target}: Permission denied\n`);
        const created: string[] = [];
        for (let current = target; !existsSync(current); current = dirname(current)) created.unshift(current);
        for (const folder of created) {
          mkdirSync(folder, { mode: modeArg });
          own(folder, uid, gid);
        }
      }
      return result(0);
    }
    if (command === "bash") {
      const child = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
      return result(child.exitCode ?? 1, child.stdout.toString(), child.stderr.toString());
    }
    return await run(argv);
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
    executable: (path) => tools.has(path) || /\/nologin$/u.test(path),
    toolProblem: (path) => scenario.unsafeTools?.[path] ?? null,
    systemdBooted: () => scenario.systemd ?? true,
    user: (name) => {
      const account = accounts[name];
      return account ? { name: account.name, uid: account.uid, gid: account.gid, home: account.home } : null;
    },
    group: (name) => accounts[name]?.gid ?? null,
    chown: (path, uid, gid) => own(path, uid, gid),
    fchown: (descriptor, uid, gid) => owners.set(ownerKey(fstatSync(descriptor)), { uid, gid }),
    owner: (stat) => ownerOf(stat as Stats),
    runAs,
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
    owner: (path: string) => ownerOf(lstatSync(join(root, path))),
    accounts,
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
    ["etc/atlas/github.env", 0o640, 0, USER.gid],
    ["etc/atlas/github-app.pem", 0o640, 0, USER.gid],
    ["etc/atlas/supplier.key", 0o640, 0, USER.gid],
    ["etc/atlas/updater.key", 0o640, 0, USER.gid],
    ["var/lib/atlas", 0o700, USER.uid, USER.gid],
    ["var/lib/atlas/sessions", 0o700, USER.uid, USER.gid],
    ["var/lib/atlas/opencode-data/opencode", 0o700, USER.uid, USER.gid],
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
  check("fresh: service user reported", fake.text().includes("Runs as:  svc"), fake.text());
  const gitCalls = fake.calls.filter((call) => call.includes("/usr/bin/git"));
  check("fresh: tools probed as nobody", gitCalls.length > 0 && gitCalls.every((call, index) =>
    call[0] === "runAs" ? call.join(" ") === "runAs nobody /usr/bin/git --version" : gitCalls[index - 1]?.[0] === "runAs"), JSON.stringify(gitCalls));
  check("fresh: data subfolders made by the service user", fake.calls.some((call) => call[0] === "runAs" && call[1] === "svc" && call[2] === "mkdir"));
  check("fresh: OpenCode config installed as the service user", fake.calls.some((call) => call[0] === "runAs" && call[1] === "svc" && call[2] === "bash"));
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
// The older install's units and env examples, kept as files (CI clones with depth 1, so no git history).
const OLD_INSTALL = join(import.meta.dir, "fixtures/old-install-432fe69");
const oldFile = (name: string) => readFileSync(join(OLD_INSTALL, name), "utf8");
const oldLayout = (root: string, sessionState: string | null) => {
  for (const name of ["atlas.service", "atlas-credentials.service", "atlas-updater.service", "opencode.service",
    "atlas-snapshot.service", "atlas-snapshot.timer", "atlas-space-check.service", "atlas-space-check.timer"]) {
    mkdirSync(p(root, "etc/systemd/system"), { recursive: true });
    writeFileSync(p(root, `etc/systemd/system/${name}`), oldFile(name), { mode: 0o644 });
  }
  mkdirSync(p(root, "etc/atlas"), { recursive: true, mode: 0o750 });
  const oldEnv = oldFile("atlas.env.example")
    .replace("REPLACE_WITH_PRIVATE_SHARED_TOKEN", "old-token-0123456789abcdefghijklmnopqrstuvwxyz")
    .replace("REPLACE_WITH_GITHUB_WEBHOOK_SECRET", "old-webhook-secret-value")
    .replace("ATLAS_GIT_BINARY=/opt/atlas/current/bin/git", "ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git");
  writeFileSync(p(root, "etc/atlas/atlas.env"), oldEnv, { mode: 0o600 });
  writeFileSync(p(root, "etc/atlas/github.env"), oldFile("github.env.example").replace("your-organization", "acme"), { mode: 0o600 });
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
  // The older install let the service user own its secrets and data.
  for (const name of ["github.env", "github-app.pem", "supplier.key"]) own(p(root, `etc/atlas/${name}`), 1000, 1000);
  ownTree(data, 1000, 1000);
  return { oldRelease, oldBundle };
};
/** `uid:gid mode` of /etc/atlas and every entry in it. */
const etcOwners = (root: string) => Object.fromEntries(["", ...readdirSync(p(root, "etc/atlas")).sort()].map((name) => {
  const stat = lstatSync(p(root, `etc/atlas/${name}`));
  const owner = ownerOf(stat);
  return [name || ".", `${owner.uid}:${owner.gid} ${(stat.mode & 0o7777).toString(8)}`];
}));
const adoptArgs = (extra: string[] = []) => ["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5", ...extra];
const dataAndSecrets = (root: string) => ({
  data: tree(p(root, "var/lib/atlas"), (path) => path === "opencode-config/opencode/opencode.json"),
  secrets: ["github-app.pem", "supplier.key", "updater.key"].map((name) => read(root, `etc/atlas/${name}`)),
  github: ["ATLAS_GITHUB_ORGANIZATION", "ATLAS_GITHUB_APP_ID", "ATLAS_GITHUB_INSTALLATION_ID", "ATLAS_GITHUB_APP_PRIVATE_KEY_PATH"]
    .map((key) => env(root, "etc/atlas/github.env").get(key)),
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
  check("adopt: secrets byte-identical", same(before.secrets, after.secrets) && same(before.env, after.env) && same(before.github, after.github),
    JSON.stringify([before.github, after.github]));
  for (const name of ["github.env", "github-app.pem", "supplier.key"]) {
    const owner = fake.owner(`etc/atlas/${name}`);
    check(`adopt: ${name} now root:omega 0640`, owner.uid === 0 && owner.gid === 1000 && mode(root, `etc/atlas/${name}`) === 0o640,
      `${JSON.stringify(owner)} ${mode(root, `etc/atlas/${name}`).toString(8)}`);
  }
  check("adopt: privileged user kept, warned once", fake.text().split("omega can become root (group sudo)").length === 2 &&
    fake.text().includes("Kept, because this install already runs as omega"), fake.text());
  check("adopt: Sessions read as the service user", fake.calls.some((call) => call[0] === "runAs" && call[1] === "omega" && call[4] === "session-summary"));
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
  const ownersBefore = etcOwners(root);
  const fake = makeHost(root, { healthy: false });
  ["atlas.service", "atlas-updater.service", "atlas-credentials.service"].forEach((unit) => fake.active.add(unit));
  const code = await runSetup(adoptArgs(["--adopt"]), fake.host);
  const after = tree(root, (path) => path.startsWith("var/backups") || path.startsWith("opt/atlas/releases/atlas-v1") ||
    path.startsWith("opt/atlas/services/releases/atlas-v1") || path === "var/lib/atlas/opencode-config/opencode/opencode.json" ||
    path === "etc/systemd/journald@atlas.conf" || path === "usr");
  check("adopt-fail: exit 1", code === 1);
  check("adopt-fail: restored automatically", fake.text().includes("Restored."), fake.text());
  check("adopt-fail: units, env, links back", same(before, after), JSON.stringify(Object.keys(after).filter((key) => after[key] !== before[key])));
  const ownersAfter = etcOwners(root);
  check("adopt-fail: /etc/atlas owners and modes back", same(ownersBefore, ownersAfter) && ownersBefore["supplier.key"] === "1000:1000 600",
    JSON.stringify({ ownersBefore, ownersAfter }));
  const backups = readdirSync(p(root, "var/backups/atlas"));
  const rollback = readFileSync(p(root, `var/backups/atlas/${backups[0]}/ROLLBACK.txt`), "utf8");
  check("adopt-fail: ROLLBACK.txt restores owners and modes",
    rollback.includes("sudo chown 1000:1000 /etc/atlas/supplier.key\nsudo chmod 600 /etc/atlas/supplier.key\n") &&
    rollback.includes("sudo chown 0:0 /etc/atlas\nsudo chmod 750 /etc/atlas\n"), rollback);
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

// ---------- 11. service user ----------
/** answers() without --user svc: the default dedicated account. */
const defaultUserArgs = (extra: string[] = []) => answers(extra).filter((_, index) => index !== 2 && index !== 3);
for (const extra of [[], ["--yes"]]) {
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(defaultUserArgs(extra), fake.host);
  check(`user: missing atlas account refused ${extra.join(" ")}`, code === 1 &&
    fake.text().includes("Service user atlas does not exist. Re-run with --create-user"), fake.text());
  check(`user: refusal changed nothing ${extra.join(" ")}`, readdirSync(root).length === 0 && !fake.calls.some((call) => call[0] === "useradd"));
}
for (const [label, extra, prompts] of [
  ["flag", ["--create-user"], null],
  ["prompt", [], ["y"]],
] as Array<[string, string[], string[] | null]>) {
  const root = newRoot();
  const fake = makeHost(root, { openCode: true, prompts });
  const code = await runSetup(defaultUserArgs(extra), fake.host);
  check(`user ${label}: created`, code === 0, fake.text());
  const useradd = fake.calls.find((call) => call[0] === "useradd")?.join(" ");
  check(`user ${label}: useradd system account`, useradd === "useradd --system --user-group --home-dir /var/lib/atlas/home --no-create-home --shell /usr/sbin/nologin atlas", useradd);
  const unit = read(root, "etc/systemd/system/atlas.service");
  check(`user ${label}: units run as atlas`, unit.includes("User=atlas\n") && unit.includes("Group=atlas\n"));
  for (const dir of ["var/lib/atlas", "var/lib/atlas/home", "var/lib/atlas/sessions"]) {
    check(`user ${label}: ${dir} owned by atlas`, fake.owner(dir).uid === 990 && mode(root, dir) === 0o700, JSON.stringify(fake.owner(dir)));
  }
  check(`user ${label}: github.env root:atlas`, fake.owner("etc/atlas/github.env").uid === 0 && fake.owner("etc/atlas/github.env").gid === 990);
  check(`user ${label}: reported`, fake.text().includes("Runs as:  atlas (new system account)"), fake.text());
  check(`user ${label}: OpenCode sign-in hint`, fake.text().includes("sudo -u atlas env HOME=/var/lib/atlas/home XDG_CONFIG_HOME=/var/lib/atlas/opencode-config"), fake.text());
}
{
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(answers(["--user", "omega"]), fake.host);
  check("privileged: refused without a terminal", code === 1 && fake.text().includes("omega can become root (group sudo)") &&
    fake.text().includes("--allow-privileged-user"), fake.text());
  check("privileged: refusal changed nothing", readdirSync(root).length === 0);
}
{
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(answers(["--user", "omega", "--allow-privileged-user"]), fake.host);
  check("privileged: allowed by flag", code === 0 && fake.text().includes("Allowed by --allow-privileged-user") &&
    fake.text().includes("can become root: group sudo"), fake.text());
}
for (const [answer, expected] of [["n", 1], ["y", 0]] as Array<[string, number]>) {
  const root = newRoot();
  const fake = makeHost(root, { prompts: [answer] });
  const code = await runSetup(answers(["--user", "omega"]), fake.host);
  check(`privileged: prompt ${answer}`, code === expected && fake.asked.some((question) => question.includes("Run Atlas as omega anyway?")) &&
    fake.text().includes("anything that takes over a Session could take over this whole machine"), fake.text());
  if (answer === "n") check("privileged: no changes after n", readdirSync(root).length === 0);
}

// ---------- 12. unsafe Release source, unsafe tools ----------
const copyRelease = (name: string) => {
  const dir = join(base, name);
  cpSync(release1.dir, dir, { recursive: true });
  return dir;
};
for (const [label, prepare, expect] of [
  ["source folder owned by the service user", (dir: string) => own(dir, 1500, 1500), "must be owned by root"],
  ["source file group-writable", (dir: string) => Bun.spawnSync(["chmod", "0664", join(dir, "atlas-release.json")]), "must be owned by root"],
  ["source binary owned by the service user", (dir: string) => own(join(dir, RELEASE_ASSET_NAME), 1500, 1500), "must be owned by root"],
  ["binary changed", (dir: string) => writeFileSync(join(dir, RELEASE_ASSET_NAME), "#!/bin/sh\nexit 0\n", { mode: 0o755 }), "does not match the SHA-256"],
] as Array<[string, (dir: string) => unknown, string]>) {
  const dir = copyRelease(`unsafe-${label.replace(/\W+/gu, "-")}`);
  prepare(dir);
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", dir, ...answers().slice(2)], fake.host);
  check(`source ${label}: refused`, code === 1 && fake.text().includes(expect), fake.text());
  check(`source ${label}: nothing written`, readdirSync(root).length === 0);
}
{
  const parent = join(base, "svc-owned-parent");
  mkdirSync(parent);
  own(parent, 1500, 1500);
  cpSync(release1.dir, join(parent, "release"), { recursive: true });
  const root = newRoot();
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", join(parent, "release"), ...answers().slice(2)], fake.host);
  check("source parent owned by the service user: refused", code === 1 && fake.text().includes("Every folder above"), fake.text());
}
{
  const root = newRoot();
  const fake = makeHost(root, { unsafeTools: { "/usr/bin/git": "/usr/bin/git must be owned by root and not writable by group or others" } });
  const code = await runSetup(answers(), fake.host);
  check("unsafe git: refused", code === 1 && fake.text().includes("git at /usr/bin/git is not safe to run"), fake.text());
  check("unsafe git: never run", !fake.calls.some((call) => call.includes("/usr/bin/git")) && readdirSync(root).length === 0);
}

// ---------- 13. Tailscale serve status unknown ----------
{
  const { root, fake } = await tailscaleRun("status unknown no tty", { tailscale: "running", serveStatusFails: true }, ["--tailscale", "yes"]);
  check("tailscale unknown: not served without a terminal", !fake.calls.some((call) => call[1] === "serve" && call[2] === "--bg") &&
    fake.text().includes("could not read the current serve config") && !env(root, "etc/atlas/atlas.env").has("ATLAS_ORIGIN"), fake.text());
}
{
  const { fake } = await tailscaleRun("status unknown n", { tailscale: "running", serveStatusFails: true, prompts: ["n"] }, ["--tailscale", "yes"]);
  check("tailscale unknown: asked, n leaves it alone", fake.asked.some((question) => question.includes("replacing whatever is there")) &&
    !fake.calls.some((call) => call[1] === "serve" && call[2] === "--bg"));
}
{
  const { fake } = await tailscaleRun("status unknown y", { tailscale: "running", serveStatusFails: true, prompts: ["y"] }, ["--tailscale", "yes"]);
  check("tailscale unknown: y serves", fake.calls.some((call) => call[1] === "serve" && call[2] === "--bg"));
}

// ---------- 14. hostile service user ----------
// Plants paths (as the service user could on an older install) and re-runs
// setup. Nothing outside /etc/atlas, the backups, and the data folder may
// change owner, mode, or content.
const ownedTree = (root: string) => {
  const out: Record<string, string> = {};
  const skip = (relative: string) => ["etc/atlas", "var/backups", "var/lib/atlas"].some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
  const walk = (relative: string) => {
    if (skip(relative)) return;
    const full = p(root, relative);
    const stat = lstatSync(full);
    const owner = ownerOf(stat);
    const head = `${(stat.mode & 0o7777).toString(8)} ${owner.uid}:${owner.gid}`;
    if (stat.isDirectory()) {
      out[relative || "."] = head;
      for (const entry of readdirSync(full).sort()) walk(join(relative, entry));
    } else if (stat.isSymbolicLink()) out[relative] = `${head} -> ${readlinkSync(full)}`;
    else out[relative] = `${head} ${createHash("sha256").update(readFileSync(full)).digest("hex")}`;
  };
  walk("");
  return out;
};
const diff = (left: Record<string, string>, right: Record<string, string>) =>
  [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => left[key] !== right[key]).map((key) => `${key}: ${left[key]} => ${right[key]}`);
const plantHostile = (root: string, options: { removeKey: boolean }) => {
  mkdirSync(p(root, "victim/dir"), { recursive: true, mode: 0o755 });
  mkdirSync(p(root, "victim/dir2"), { recursive: true, mode: 0o755 });
  writeFileSync(p(root, "victim/dir/keep.txt"), "victim\n", { mode: 0o644 });
  writeFileSync(p(root, "victim/secret.pem"), readFileSync(pemPath), { mode: 0o600 });
  // An older install's service-owned github.env naming a root-only file as "the key".
  writeFileSync(p(root, "etc/atlas/github.env"), [
    "ATLAS_GITHUB_ORGANIZATION=acme", "ATLAS_GITHUB_APP_ID=12345", "ATLAS_GITHUB_INSTALLATION_ID=67890",
    "ATLAS_GITHUB_APP_PRIVATE_KEY_PATH=/victim/secret.pem", "LD_PRELOAD=/var/lib/atlas/evil.so", "",
  ].join("\n"), { mode: 0o600 });
  own(p(root, "etc/atlas/github.env"), 1500, 1500);
  if (options.removeKey) rmSync(p(root, "etc/atlas/github-app.pem"));
  // Data folder links pointing root at files it must not touch.
  const data = p(root, "var/lib/atlas");
  for (const [name, target] of [["sessions", "victim/dir"], ["opencode-cache", "victim/dir2"], ["atlas.sqlite", "victim/secret.pem"]]) {
    rmSync(join(data, name), { recursive: true, force: true });
    symlinkSync(p(root, target), join(data, name));
    own(join(data, name), 1500, 1500);
  }
};
{
  const root = newRoot();
  check("hostile: fresh install", await runSetup(answers(), makeHost(root).host) === 0);
  plantHostile(root, { removeKey: false });
  // atlas.env that another account could have written: its paths must be ignored.
  writeFileSync(p(root, "etc/atlas/atlas.env"), `${read(root, "etc/atlas/atlas.env")}ATLAS_SUPPLIER_KEY_PATH=/victim/secret.pem\n`.replace(
    /^ATLAS_DATABASE_PATH=.*$/mu, "ATLAS_DATABASE_PATH=/victim/dir/atlas.sqlite"), { mode: 0o600 });
  own(p(root, "etc/atlas/atlas.env"), 1500, 1500);
  const before = ownedTree(root);
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5", "--confirm-running-sessions"], fake.host);
  check("hostile re-run: exit 0", code === 0, fake.text());
  const changes = diff(before, ownedTree(root));
  check("hostile re-run: nothing outside the intended folders changed", changes.length === 0, changes.join("\n"));
  const githubEnv = env(root, "etc/atlas/github.env");
  check("hostile re-run: github.env names the fixed key, drops planted lines", githubEnv.get("ATLAS_GITHUB_APP_PRIVATE_KEY_PATH") === "/etc/atlas/github-app.pem" &&
    !githubEnv.has("LD_PRELOAD"), read(root, "etc/atlas/github.env"));
  check("hostile re-run: github.env root:svc 0640", fake.owner("etc/atlas/github.env").uid === 0 && mode(root, "etc/atlas/github.env") === 0o640);
  check("hostile re-run: key unchanged", read(root, "etc/atlas/github-app.pem") === readFileSync(pemPath, "utf8"));
  const atlasEnv = env(root, "etc/atlas/atlas.env");
  check("hostile re-run: untrusted atlas.env paths ignored", fake.text().includes("atlas.env is not root-only") &&
    atlasEnv.get("ATLAS_DATABASE_PATH") === "/var/lib/atlas/atlas.sqlite" && atlasEnv.get("ATLAS_SUPPLIER_KEY_PATH") === "/etc/atlas/supplier.key" &&
    fake.owner("etc/atlas/atlas.env").uid === 0 && mode(root, "etc/atlas/atlas.env") === 0o600, read(root, "etc/atlas/atlas.env"));
  check("hostile re-run: database read as svc only", fake.calls.some((call) => call[0] === "runAs" && call[1] === "svc" && call[4] === "session-summary") &&
    fake.text().includes("the Session database could not be read"), fake.text());
}
{
  const root = newRoot();
  check("hostile no key: fresh install", await runSetup(answers(), makeHost(root).host) === 0);
  plantHostile(root, { removeKey: true });
  const before = ownedTree(root);
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5", "--confirm-running-sessions"], fake.host);
  check("hostile no key: stops", code === 1 && fake.text().includes("could not be read as svc") && fake.text().includes("Missing answer: GitHub App private key"), fake.text());
  check("hostile no key: victim never read into /etc/atlas", !existsSync(p(root, "etc/atlas/github-app.pem")));
  const changes = diff(before, ownedTree(root));
  check("hostile no key: nothing outside the intended folders changed", changes.length === 0, changes.join("\n"));
}
{
  // Legit older install: the key lived in the data folder, owned by the service user.
  const root = newRoot();
  check("legacy key: fresh install", await runSetup(answers(), makeHost(root).host) === 0);
  writeFileSync(p(root, "var/lib/atlas/app.pem"), readFileSync(pemPath), { mode: 0o600 });
  own(p(root, "var/lib/atlas/app.pem"), 1500, 1500);
  writeFileSync(p(root, "etc/atlas/github.env"), read(root, "etc/atlas/github.env").replace("/etc/atlas/github-app.pem", "/var/lib/atlas/app.pem"));
  rmSync(p(root, "etc/atlas/github-app.pem"));
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5"], fake.host);
  check("legacy key: read as svc and installed", code === 0 && read(root, "etc/atlas/github-app.pem") === readFileSync(pemPath, "utf8") &&
    fake.calls.some((call) => call[0] === "runAs" && call[1] === "svc" && call[2] === "cat") && mode(root, "etc/atlas/github-app.pem") === 0o640, fake.text());
  check("legacy key: old file untouched", fake.owner("var/lib/atlas/app.pem").uid === 1500 && mode(root, "var/lib/atlas/app.pem") === 0o600);
}

{
  const root = newRoot();
  check("unit owned by svc: fresh install", await runSetup(answers(), makeHost(root).host) === 0);
  own(p(root, "etc/systemd/system/atlas.service"), 1500, 1500);
  const fake = makeHost(root);
  const code = await runSetup(["--source-dir", release1.dir, "--tailscale", "no", "--health-timeout", "5"], fake.host);
  check("unit owned by svc: stops", code === 1 && fake.text().includes("atlas.service is not a regular file owned by root"), fake.text());
}

const stagesAfter = readdirSync("/var/tmp").filter((name) => name.startsWith("atlas-setup-")).sort();
check("staged Release copies removed", same(stagesBefore, stagesAfter), stagesAfter.join(","));

removeBase();
if (failures > 0) {
  console.error(`verify-setup: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`verify-setup: ${checks} checks passed`);
