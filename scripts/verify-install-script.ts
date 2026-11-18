#!/usr/bin/env bun
// Proves the real install.sh against a local HTTP fixture (no GitHub, no root).
// install.sh runs under `setsid` (no terminal) with a PATH of real tools plus
// fakes: `id -u` says 0 (root); the "binary" records how it was run.
//
// Covers: not root (refused before any download, sudo command printed),
// latest URL, pinned version (`+` sent as %2B, missing `v` added), bad
// version, SHA mismatch, metadata mismatch, aarch64, musl, exit code passed
// through, root-only download folder under ATLAS_INSTALL_TMP_PARENT (TMPDIR
// ignored), no terminal and no answers (root-only folder kept, next command
// printed), temp folder removed; plus `sh -n`, `dash -n`, `shellcheck -s sh`.
//
// Usage: bun scripts/verify-install-script.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");
const script = join(repository, "install.sh");
const base = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "atlas-verify-install-script");
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = "") => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}${detail ? `:\n${detail}` : ""}`);
  }
};
const which = (name: string) => Bun.which(name, { PATH: "/usr/local/bin:/usr/bin:/bin" });

// ---------- syntax ----------
const syntax = (label: string, argv: string[] | null) => {
  if (!argv) return check(`${label}: available`, false, `${label} is not installed and Docker is not available`);
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  check(label, result.exitCode === 0, `${result.stdout}${result.stderr}`);
};
const docker = which("docker");
syntax("sh -n", ["sh", "-n", script]);
syntax("dash -n", which("dash") ? ["dash", "-n", script]
  : docker ? [docker, "run", "--rm", "-v", `${script}:/install.sh:ro`, "debian:12", "dash", "-n", "/install.sh"] : null);
const shellcheck = (() => {
  const plain = Bun.spawnSync(["shellcheck", "--version"], { stdout: "ignore", stderr: "ignore" });
  if (plain.exitCode === 0) return ["shellcheck"];
  const mise = Bun.spawnSync(["mise", "x", "aqua:koalaman/shellcheck@0.11.0", "--", "shellcheck", "--version"], { stdout: "ignore", stderr: "ignore" });
  if (mise.exitCode === 0) return ["mise", "x", "aqua:koalaman/shellcheck@0.11.0", "--", "shellcheck"];
  return docker ? [docker, "run", "--rm", "-v", `${script}:/install.sh:ro`, "koalaman/shellcheck:stable"] : null;
})();
syntax("shellcheck -s sh", shellcheck && (shellcheck[0] === docker ? [...shellcheck, "-s", "sh", "/install.sh"] : [...shellcheck, "-s", "sh", script]));

// ---------- fixture Release ----------
const TAG = "v1.4.0+build.12";
const log = join(base, "binary.log");
const binaryText = `#!/bin/sh
{ printf 'args:'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; printf 'files:'; ls "$3" | tr '\\n' ' '; printf '\\n'; printf 'modes: %s %s\\n' "$(stat -c %a "$3")" "$(stat -c %a "$0")"; } >>"${log}"
exit "\${FAKE_EXIT:-0}"
`;
const fixture = (corrupt: "none" | "sha" | "metadata") => {
  const binary = Buffer.from(binaryText);
  const sha = createHash("sha256").update(binary).digest("hex");
  return {
    "atlas-linux-x64": corrupt === "sha" ? Buffer.from(`${binaryText}# tampered\n`) : binary,
    "atlas-linux-x64.sha256": Buffer.from(`${sha}  atlas-linux-x64\n`),
    "atlas-release.json": Buffer.from(JSON.stringify({ schemaVersion: 2, asset: { sha256: corrupt === "metadata" ? "b".repeat(64) : sha } })),
  } as Record<string, Buffer>;
};
let files = fixture("none");
const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    requests.push(path);
    const match = /^\/releases\/(?:latest\/download|download\/([^/]+))\/([^/]+)$/u.exec(path);
    if (!match || (match[1] !== undefined && match[1] !== encodeURIComponent(TAG))) return new Response("no", { status: 404 });
    const body = files[match[2]!];
    return body ? new Response(new Uint8Array(body)) : new Response("no", { status: 404 });
  },
});
const releases = `http://127.0.0.1:${server.port}/releases`;

// ---------- fake PATH ----------
const makeBin = (name: string, fakes: Record<string, string>, omit: string[] = []) => {
  const bin = join(base, `bin-${name}`);
  mkdirSync(bin, { recursive: true });
  for (const tool of ["sh", "uname", "id", "mktemp", "chmod", "rm", "cut", "tr", "sed", "grep", "sha256sum",
    "curl", "getconf", "ldd", "ls", "cat", "printf", "bash", "stat"]) {
    if (omit.includes(tool) || fakes[tool]) continue;
    const real = which(tool);
    if (real) symlinkSync(real, join(bin, tool));
  }
  for (const [tool, text] of Object.entries(fakes)) writeFileSync(join(bin, tool), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
  return bin;
};
// Pretend to be root: install.sh only asks `id -u`.
const id = `[ "$1" = -u ] && { echo 0; exit 0; }; exec ${which("id")} "$@"`;
const normalBin = makeBin("normal", { id });

type Run = { code: number; out: string; log: string; requests: string[]; tmpLeft: string[]; tmpdirLeft: string[]; tmp: string };
let runCounter = 0;
// Async spawn: the fixture server runs in this same process.
const install = async (args: string[], options: { bin?: string; env?: Record<string, string> } = {}): Promise<Run> => {
  const home = join(base, `home-${++runCounter}`);
  const tmp = join(base, `tmp-${runCounter}`);
  const tmpdir = join(base, `tmpdir-${runCounter}`);
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(tmpdir, { recursive: true });
  rmSync(log, { force: true });
  requests.length = 0;
  // `curl … | sh -s -- args`, with the script piped from a file.
  const child = Bun.spawn([which("setsid") ?? "setsid", "-w", "sh", "-c", 's=$1; shift; cat "$s" | sh -s -- "$@"', "x", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { PATH: options.bin ?? normalBin, HOME: home, TMPDIR: tmpdir, ATLAS_INSTALL_TMP_PARENT: tmp, ATLAS_INSTALL_BASE_URL: releases, ...options.env },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return {
    code,
    out: `${stdout}${stderr}`,
    log: existsSync(log) ? readFileSync(log, "utf8") : "",
    requests: [...requests],
    tmpLeft: readdirSync(tmp),
    tmpdirLeft: readdirSync(tmpdir),
    tmp,
  };
};

// ---------- 0. not root ----------
{
  const run = await install(["--answers", "/root/it's.json"], { bin: makeBin("user", {}) });
  check("not root: refused before any download", run.code === 1 && run.requests.length === 0 && run.log === "" && run.tmpLeft.length === 0, run.out);
  check("not root: sudo command printed", run.out.includes(`curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sudo sh -s -- '--answers' '/root/it'\\''s.json'`), run.out);
}

// ---------- 1. good path, latest ----------
{
  const run = await install(["--answers", "/root/answers.json"]);
  check("latest: exit 0", run.code === 0, run.out);
  check("latest: URLs", JSON.stringify(run.requests) === JSON.stringify(
    ["atlas-linux-x64", "atlas-linux-x64.sha256", "atlas-release.json"].map((name) => `/releases/latest/download/${name}`)), JSON.stringify(run.requests));
  check("latest: verified line", run.out.includes("Downloaded and verified atlas-linux-x64"), run.out);
  check("latest: setup run directly with source dir and passed-through args",
    new RegExp(`^args: setup --source-dir ${run.tmp}/atlas-install\\.\\w+ --answers /root/answers\\.json$`, "mu").test(run.log) && !run.log.includes("sudo"), run.log);
  check("latest: root-only folder, binary 0500", run.log.includes("modes: 700 500"), run.log);
  check("latest: TMPDIR not used", run.tmpdirLeft.length === 0);
  check("latest: setup saw all three files", run.log.includes("files:atlas-linux-x64 atlas-linux-x64.sha256 atlas-release.json "), run.log);
  check("latest: temp folder removed", run.tmpLeft.length === 0, run.tmpLeft.join(","));
}

// ---------- 2. pinned ----------
{
  const run = await install(["--version", TAG, "--answers", "a.json"]);
  check("pinned: exit 0", run.code === 0, run.out);
  check("pinned: %2B in URL", run.requests[0] === "/releases/download/v1.4.0%2Bbuild.12/atlas-linux-x64", JSON.stringify(run.requests));
  check("pinned: --version not passed to setup", !run.log.includes("--version"), run.log);
  const env = await install(["--answers", "a.json"], { env: { ATLAS_VERSION: "1.4.0+build.12" } });
  check("pinned via env without v", env.code === 0 && env.requests[0] === "/releases/download/v1.4.0%2Bbuild.12/atlas-linux-x64", env.out);
  const bad = await install(["--version=1.4", "--answers", "a.json"]);
  check("pinned: bad version refused", bad.code === 1 && bad.out.includes("must look like") && bad.requests.length === 0, bad.out);
  const missing = await install(["--version", "v9.9.9+build.1", "--answers", "a.json"]);
  check("pinned: missing Release", missing.code === 1 && missing.out.includes("download failed") && missing.log === "", missing.out);
}

// ---------- 3. checksum ----------
for (const corrupt of ["sha", "metadata"] as const) {
  files = fixture(corrupt);
  const run = await install(["--answers", "a.json"]);
  check(`${corrupt} mismatch: refused`, run.code === 1 && run.out.includes("Nothing was installed") && run.log === "", run.out + run.log);
  check(`${corrupt} mismatch: temp folder removed`, run.tmpLeft.length === 0);
}
files = fixture("none");

// ---------- 4. platform ----------
{
  const arm = await install(["--answers", "a.json"], { bin: makeBin("arm", { id, uname: '[ "$1" = -m ] && echo aarch64 || echo Linux' }) });
  check("aarch64 refused", arm.code === 1 && arm.out.includes("only on x86_64 (this is aarch64)") && arm.requests.length === 0, arm.out);
  const musl = await install(["--answers", "a.json"], { bin: makeBin("musl", { id, ldd: "echo 'musl libc (x86_64)' >&2; exit 1", getconf: "exit 1" }) });
  check("musl refused", musl.code === 1 && musl.out.includes("musl libc") && musl.requests.length === 0, musl.out);
  const noLibc = await install(["--answers", "a.json"], { bin: makeBin("nolibc", { id, getconf: "exit 1" }) });
  check("no glibc refused", noLibc.code === 1 && noLibc.out.includes("glibc was not found"), noLibc.out);
  const noSha = await install(["--answers", "a.json"], { bin: makeBin("nosha", { id }, ["sha256sum"]) });
  check("sha256sum missing refused", noSha.code === 1 && noSha.out.includes("sha256sum is missing"), noSha.out);
  const noCurl = await install(["--answers", "a.json"], { bin: makeBin("nocurl", { id }, ["curl"]) });
  check("no curl/wget refused", noCurl.code === 1 && noCurl.out.includes("curl or wget is needed"), noCurl.out);
}

// ---------- 5. setup exit code is passed through ----------
{
  const run = await install(["--answers", "a.json"], { env: { FAKE_EXIT: "3" } });
  check("setup failure exit code", run.code === 3 && run.tmpLeft.length === 0, run.out);
}

// ---------- 6. no terminal, no answers ----------
{
  const run = await install([]);
  check("no tty: exit 0 without running setup", run.code === 0 && !run.log.includes("args:"), run.out + run.log);
  check("no tty: one root-only folder kept", run.tmpLeft.length === 1 && run.tmpLeft[0]!.startsWith("atlas-install."), run.tmpLeft.join(","));
  const keep = join(run.tmp, run.tmpLeft[0] ?? "missing");
  check("no tty: files kept, folder 0700", ["atlas-linux-x64", "atlas-linux-x64.sha256", "atlas-release.json"].every((name) => existsSync(join(keep, name))) &&
    (statSync(keep).mode & 0o777) === 0o700, run.out);
  check("no tty: next command printed (no sudo)", run.out.includes(`  ${keep}/atlas-linux-x64 setup --source-dir ${keep}`) && !run.out.includes("sudo"), run.out);
  check("no tty: nothing in HOME", !existsSync(join(base, `home-${runCounter}`, ".cache")));
}

server.stop(true);
rmSync(base, { recursive: true, force: true });
if (failures > 0) {
  console.error(`verify-install-script: ${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`verify-install-script: ${checks} checks passed`);
