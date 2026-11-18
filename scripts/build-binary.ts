#!/usr/bin/env bun
// Builds the single compiled `atlas` binary.
//
// Usage:
//   bun scripts/build-binary.ts [--out <dir>] [--tag <vX.Y.Z+build.N> --sha <40-hex commit>]
//   bun run build:binary -- [same flags]
//
// Inputs:
//   --out  Output directory (default: dist). Created if missing; an existing
//          <out>/atlas is replaced.
//   --tag, --sha  Release identity to embed. Give both for a Release build, or
//          neither for an unpublished development build. The SHA is not checked
//          against the checkout; the release pipeline owns that check.
//   Must run under the Bun version pinned in package.json `engines.bun`.
//
// Steps: `bun run build:css` (src/styles.css -> public/app.css, embedded), then
//   `bun build --compile --target=bun-linux-x64-baseline src/cli.ts`, defining
//   __ATLAS_RELEASE_TAG__/__ATLAS_RELEASE_SHA__ (src/release.ts#embeddedReleaseIdentity).
//   .env/bunfig autoloading is disabled in the binary; systemd supplies the env.
//   On a Linux x64 host it then runs `<out>/atlas version --json` and checks the
//   embedded identity.
//
// Output: <out>/atlas (mode 0755). The last stdout line is its absolute path.
import { chmodSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEVELOPMENT_RELEASE_IDENTITY, parseReleaseTag, type ReleaseIdentity } from "../src/release.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const fail = (message: string): never => {
  console.error(`build-binary: ${message}`);
  process.exit(1);
};

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { out: { type: "string" }, tag: { type: "string" }, sha: { type: "string" } },
  strict: true,
});
if ((values.tag === undefined) !== (values.sha === undefined)) fail("give both --tag and --sha, or neither");

let expected: ReleaseIdentity = DEVELOPMENT_RELEASE_IDENTITY;
if (values.tag !== undefined && values.sha !== undefined) {
  if (!/^[0-9a-f]{40}$/.test(values.sha)) fail("--sha must be a full lowercase Git SHA-1");
  const parsed = parseReleaseTag(values.tag);
  expected = { published: true, tag: parsed.tag, semver: parsed.semver, build: parsed.build, gitSha: values.sha };
}

const pinnedBun = (await Bun.file(join(repositoryRoot, "package.json")).json()).engines?.bun;
if (Bun.version !== pinnedBun) fail(`requires Bun ${pinnedBun}, running ${Bun.version}`);

const outDirectory = resolve(values.out ?? join(repositoryRoot, "dist"));
const outfile = join(outDirectory, "atlas");
mkdirSync(outDirectory, { recursive: true });

const step = (command: string[]) => {
  const result = Bun.spawnSync(command, { cwd: repositoryRoot, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) fail(`failed: ${command.join(" ")}`);
};

step([process.execPath, "run", "build:css"]);
step([
  process.execPath, "build", "--compile",
  "--target=bun-linux-x64-baseline",
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
  `--define=__ATLAS_RELEASE_TAG__=${JSON.stringify(expected.tag ?? "")}`,
  `--define=__ATLAS_RELEASE_SHA__=${JSON.stringify(expected.gitSha ?? "")}`,
  `--outfile=${outfile}`,
  "src/cli.ts",
]);
chmodSync(outfile, 0o755);

if (process.platform === "linux" && process.arch === "x64") {
  const version = Bun.spawnSync([outfile, "version", "--json"], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  if (version.exitCode !== 0) fail("built binary could not report its version");
  const actual = version.stdout.toString().trim();
  if (actual !== JSON.stringify(expected)) fail(`embedded identity mismatch: ${actual}`);
}

console.log(outfile);
