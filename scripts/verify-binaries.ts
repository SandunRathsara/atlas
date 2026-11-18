// Real compiled `atlas` binaries for verify scripts, built at most once per
// source tree and identity and cached under ~/.cache/atlas-verify (never /tmp:
// each binary is ~100 MB).
//
//   const binary = await verifyBinary("v0.1.0+build.1", "a".repeat(40));
//   const metadata = await verifyMetadata(binary, "v0.1.0+build.1", "a".repeat(40));
//
// The cache key is the git tree hash of the working tree including
// uncommitted and untracked files, so any source change rebuilds. Old entries
// for other trees are removed when a new tree is built.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildReleaseFolder } from "../src/release-layout.ts";
import { createReleaseMetadata, parseReleaseTag, type ReleaseMetadata } from "../src/release.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
export const verifyCacheRoot = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "atlas-verify");

const git = (args: string[], env: Record<string, string> = {}) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: repositoryRoot, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

let treeHash: string | undefined;
const sourceTree = () => {
  if (treeHash) return treeHash;
  const index = resolve(repositoryRoot, git(["rev-parse", "--git-path", `atlas-verify-index-${process.pid}`]));
  try {
    copyFileSync(resolve(repositoryRoot, git(["rev-parse", "--git-path", "index"])), index);
    git(["add", "-A"], { GIT_INDEX_FILE: index });
    treeHash = git(["write-tree"], { GIT_INDEX_FILE: index });
  } finally {
    rmSync(index, { force: true });
  }
  return treeHash;
};

const built = new Map<string, string>();

/** Path to a compiled binary embedding `tag`/`sha` (development build when both are omitted). */
export const verifyBinary = async (tag?: string, sha?: string) => {
  const tree = sourceTree();
  const key = `${tree}-${tag ? createHash("sha256").update(`${tag}\0${sha}`).digest("hex").slice(0, 16) : "dev"}`;
  const directory = join(verifyCacheRoot, key);
  const binary = join(directory, "atlas");
  if (built.has(key) || existsSync(binary)) {
    built.set(key, binary);
    return binary;
  }
  mkdirSync(verifyCacheRoot, { recursive: true });
  for (const entry of readdirSync(verifyCacheRoot)) {
    if (!entry.startsWith(tree)) rmSync(join(verifyCacheRoot, entry), { recursive: true, force: true });
  }
  const scratch = join(verifyCacheRoot, `.build-${process.pid}-${key}`);
  const result = Bun.spawnSync([
    process.execPath, join(repositoryRoot, "scripts/build-binary.ts"), "--out", scratch,
    ...(tag ? ["--tag", tag, "--sha", sha!] : []),
  ], { cwd: repositoryRoot, stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`building the ${tag ?? "development"} verify binary failed`);
  rmSync(directory, { recursive: true, force: true });
  renameSync(scratch, directory);
  built.set(key, binary);
  return binary;
};

/** Schema-2 metadata describing `binary` exactly. */
export const verifyMetadata = (binary: string, tag: string, sha: string): ReleaseMetadata => {
  const bytes = readFileSync(binary);
  const client = (JSON.parse(readFileSync(join(repositoryRoot, "node_modules/@opencode/client/package.json"), "utf8")) as { version: string }).version;
  return createReleaseMetadata(tag, sha, { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }, client);
};

const fixtureBinaryText = (tag: string, sha: string) => {
  const parsed = parseReleaseTag(tag);
  const identity = { published: true, tag: parsed.tag, semver: parsed.semver, build: parsed.build, gitSha: sha };
  return `#!/bin/sh\necho '${JSON.stringify(identity)}'\n`;
};

/** Metadata for the stand-in binary of `fixtureReleaseFolder` (deterministic per tag/sha). */
export const fixtureMetadata = (tag: string, sha: string): ReleaseMetadata => {
  const bytes = Buffer.from(fixtureBinaryText(tag, sha));
  const client = (JSON.parse(readFileSync(join(repositoryRoot, "node_modules/@opencode/client/package.json"), "utf8")) as { version: string }).version;
  return createReleaseMetadata(tag, sha, { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }, client);
};

/**
 * A tiny stand-in Release folder built by the production builder: its `atlas`
 * is a shell script that only prints `tag`/`sha` as its identity, with matching
 * metadata. Intact for staging and retention; not a working Atlas.
 */
export const fixtureReleaseFolder = async (releasesRoot: string, tag: string, sha: string) => {
  mkdirSync(releasesRoot, { recursive: true });
  const script = join(releasesRoot, `.fixture-${tag}`);
  writeFileSync(script, fixtureBinaryText(tag, sha), { mode: 0o755 });
  try {
    const metadata = fixtureMetadata(tag, sha);
    return { metadata, path: await buildReleaseFolder({ binaryPath: script, metadata, releasesRoot }) };
  } finally {
    rmSync(script, { force: true });
  }
};
