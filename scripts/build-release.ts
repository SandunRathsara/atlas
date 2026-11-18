#!/usr/bin/env bun
// Builds the three files of one Atlas Release.
//
// Usage:
//   bun scripts/build-release.ts <vX.Y.Z+build.N> <40-hex commit> <output-dir>
//   bun run build:release -- <same args>
//
// Inputs:
//   tag      Release tag to embed (must parse; sequence checks live in
//            `bun scripts/release.ts validate`).
//   commit   Must equal the checked-out HEAD. The checkout must be clean
//            (no staged, unstaged, or untracked files).
//   output   Created if missing. None of the three outputs may already exist.
//   Runs on Linux x64 under the Bun pinned in package.json `engines.bun`. Needs
//   no secrets: it reads only the checkout and installs from the frozen lockfile.
//
// Outputs (in <output-dir>):
//   atlas-linux-x64         compiled binary (scripts/build-binary.ts), mode 0755
//   atlas-linux-x64.sha256  one line: `<sha256-hex>  atlas-linux-x64`
//   atlas-release.json      schema-2 metadata (src/release.ts#createReleaseMetadata)
// The last stdout line is the absolute output directory.
//
// Phase 4 hook: `install.sh` will be copied into <output-dir> here (see the
// marked line below) so it ships as a fourth asset of the same Release.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createReleaseMetadata,
  parseReleaseTag,
  RELEASE_ASSET_NAME,
  RELEASE_CHECKSUM_NAME,
} from "../src/release.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const fail = (message: string): never => {
  console.error(`build-release: ${message}`);
  process.exit(1);
};
const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { cwd: repositoryRoot, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) fail(`failed: ${command.join(" ")}`);
  return result.stdout.toString();
};

const [tag, commit, outputArgument, ...extra] = Bun.argv.slice(2);
if (!tag || !commit || !outputArgument || extra.length > 0) fail("usage: bun scripts/build-release.ts <release-tag> <git-sha> <output-directory>");
parseReleaseTag(tag!);
if (!/^[0-9a-f]{40}$/u.test(commit!)) fail("the commit must be a full lowercase Git SHA-1");
if (process.platform !== "linux" || process.arch !== "x64") fail("Atlas releases are built only on Linux x64");

// The binary must come from exactly the requested, unmodified commit.
if (run(["git", "status", "--porcelain", "--untracked-files=all"]).trim()) fail("the checkout has uncommitted or untracked files");
if (run(["git", "rev-parse", "--verify", "HEAD"]).trim() !== commit) fail("the requested release SHA is not the checked-out commit");

const output = resolve(outputArgument!);
const outputs = [RELEASE_ASSET_NAME, RELEASE_CHECKSUM_NAME, "atlas-release.json"].map((name) => join(output, name));
for (const path of outputs) if (lstatSync(path, { throwIfNoEntry: false })) fail(`release output already exists: ${path}`);
mkdirSync(output, { recursive: true });

run([process.execPath, "install", "--frozen-lockfile"]);

// The OpenCode client version is compiled in (src/opencode.ts) and reported in
// the metadata; package.json, bun.lock and the installed package must agree.
const declared = (JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> })
  .dependencies?.["@opencode/client"];
const lock = readFileSync(join(repositoryRoot, "bun.lock"), "utf8");
const locked = /"@opencode\/client": \["@opencode\/client@([^"]+)"/u.exec(lock)?.[1];
const installed = (JSON.parse(readFileSync(join(repositoryRoot, "node_modules/@opencode/client/package.json"), "utf8")) as { version?: string }).version;
if (!declared || declared !== locked || locked !== installed) fail("package.json, bun.lock and node_modules disagree on @opencode/client");
if (lock.includes("@opencode-ai/")) fail("bun.lock must not contain the retired @opencode-ai packages");

// Build next to the outputs (not /tmp: the binary is ~100 MB).
const scratch = join(output, `.build-${process.pid}`);
try {
  rmSync(scratch, { recursive: true, force: true });
  const built = run([process.execPath, join(repositoryRoot, "scripts/build-binary.ts"), "--out", scratch, "--tag", tag!, "--sha", commit!])
    .trim().split("\n").at(-1)!;
  if (run(["git", "status", "--porcelain", "--untracked-files=all"]).trim()) fail("the build modified tracked files");

  const bytes = readFileSync(built);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = createReleaseMetadata(tag!, commit!, { sha256, size: bytes.byteLength }, installed!);
  renameSync(built, join(output, RELEASE_ASSET_NAME));
  chmodSync(join(output, RELEASE_ASSET_NAME), 0o755);
  writeFileSync(join(output, RELEASE_CHECKSUM_NAME), `${sha256}  ${RELEASE_ASSET_NAME}\n`, { flag: "wx" });
  writeFileSync(join(output, "atlas-release.json"), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  // Phase 4: copy install.sh into `output` here.
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
for (const path of outputs) assert(existsSync(path), `missing ${path}`);
console.log(`built Atlas ${tag} release files`);
console.log(output);
