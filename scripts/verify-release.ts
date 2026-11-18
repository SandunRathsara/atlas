import "./isolate-opencode.ts";
import { strict as assert } from "node:assert";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, MINIMUM_HOST_TOOLS, parseToolVersion } from "../src/host-tools.ts";
import { buildReleaseFolder, gitWrapperText, releaseFolderIntact } from "../src/release-layout.ts";
import { releaseShimText } from "../src/shims.ts";
import { renderUnits } from "../src/units.ts";
import { verifyBinary, verifyMetadata } from "./verify-binaries.ts";
import { createApp } from "../src/app.ts";
import { createPersistence } from "../src/persistence.ts";
import {
  assertReleaseMetadata,
  compareReleaseTags,
  createReleaseMetadata,
  loadReleaseIdentity,
  parseReleaseTag,
  validateReleaseSequence,
} from "../src/release.ts";

const initial = "v0.1.0+build.1";
const sha = "a".repeat(40);
assert.deepEqual(parseReleaseTag(initial), {
  tag: initial,
  semver: "0.1.0",
  major: 0,
  minor: 1,
  patch: 0,
  build: 1,
});
for (const malformed of ["0.1.0+build.1", "v0.1+build.1", "v00.1.0+build.1", "v0.1.0+build.0", "v0.1.0-alpha+build.1"]) {
  assert.throws(() => parseReleaseTag(malformed));
}

assert.equal(compareReleaseTags("v0.1.0+build.2", initial), 1, "numeric build orders equal SemVer");
assert.equal(compareReleaseTags("v0.2.0+build.2", "v0.1.9+build.99"), 1, "SemVer orders before build");
assert.equal(validateReleaseSequence(initial, []).build, 1);
assert.equal(validateReleaseSequence("v0.1.0+build.2", [initial]).build, 2);
assert.equal(validateReleaseSequence("v0.2.0+build.2", [initial]).semver, "0.2.0");
assert.throws(() => validateReleaseSequence("v0.1.0+build.2", []), /first Atlas release/);
assert.throws(() => validateReleaseSequence(initial, [initial]), /already exists/);
assert.throws(() => validateReleaseSequence("v0.2.0+build.1", [initial]), /must be greater/);
assert.throws(() => validateReleaseSequence("v0.0.9+build.2", [initial]), /must be newer/);
const serialized = [initial, "v0.1.0+build.2"];
assert.equal(validateReleaseSequence("v0.1.1+build.3", serialized).build, 3);
assert.throws(() => validateReleaseSequence("v0.1.0+build.2", serialized), /already exists/, "a release-job rerun must be rejected");

const metadata = createReleaseMetadata(initial, sha, { sha256: "f".repeat(64), size: 1234 }, "2.3.2");
assert.equal(assertReleaseMetadata(metadata), metadata);
assert.equal(metadata.schemaVersion, 2);
assert.deepEqual(metadata.asset, { name: "atlas-linux-x64", checksum: "atlas-linux-x64.sha256", sha256: "f".repeat(64), size: 1234, os: "linux", architecture: "x64" });
assert.deepEqual(metadata.minimumHostTools, MINIMUM_HOST_TOOLS);
assert.equal("runtime" in metadata, false, "schema 2 has no Bun runtime pin");
assert.throws(() => assertReleaseMetadata({
  ...metadata,
  identity: { ...metadata.identity, gitSha: "b".repeat(40), build: 2 },
}), /does not agree/);
// Schema 1 (tarball) and unknown schemas are refused with a clear message.
const schemaOne = {
  schemaVersion: 1,
  identity: metadata.identity,
  artifact: { name: `atlas-linux-x64-${initial}.tar.gz`, checksum: `atlas-linux-x64-${initial}.tar.gz.sha256`, os: "linux", architecture: "x64", format: "tar.gz" },
  runtime: { bun: "1.3.14", git: "2.55.0", gh: "2.100.0" },
  rollback: metadata.rollback,
};
assert.throws(() => assertReleaseMetadata(schemaOne), /schema 1 \(tarball Releases\) is no longer supported/);
assert.throws(() => assertReleaseMetadata({ ...metadata, schemaVersion: 3 }), /schema 3 is not supported; expected schema 2/);
assert.throws(() => assertReleaseMetadata({ ...metadata, schemaVersion: undefined }), /schema null is not supported/);
for (const asset of [
  { ...metadata.asset, sha256: "F".repeat(64) },
  { ...metadata.asset, size: 0 },
  { ...metadata.asset, name: "atlas" },
  { ...metadata.asset, checksum: "atlas-linux-x64.sha512" },
]) assert.throws(() => assertReleaseMetadata({ ...metadata, asset }), /asset metadata is invalid/);
assert.throws(() => assertReleaseMetadata({ ...metadata, minimumHostTools: { git: "2.55", gh: "2.100.0" } }), /minimum host tool/);
assert.throws(() => assertReleaseMetadata({ ...metadata, minimumHostTools: { ...metadata.minimumHostTools, bun: "1.3.14" } }), /minimum host tool/);
assert.throws(() => assertReleaseMetadata({ ...metadata, openCodeClient: "" }), /OpenCode client/);

// Host tool minimums compare numerically.
assert.equal(compareVersions("2.55.0", "2.55.0"), 0);
assert.equal(compareVersions("2.100.0", "2.55.0"), 1, "2.100 is newer than 2.55");
assert.equal(compareVersions("2.9.9", "2.55.0"), -1);
assert.equal(parseToolVersion("git version 2.55.1\n"), "2.55.1");
assert.equal(parseToolVersion("gh version 2.100.0 (2026-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.100.0\n"), "2.100.0");
assert.equal(parseToolVersion("no version"), null);

// bin/git runs host git only at or above the minimum and passes arguments through.
const wrapperRoot = mkdtempSync(join(tmpdir(), "atlas-git-wrapper-"));
try {
  const wrapper = join(wrapperRoot, "git");
  writeFileSync(wrapper, gitWrapperText("2.55.0"), { mode: 0o755 });
  const fakeGit = (version: string) => {
    const path = join(wrapperRoot, `git-${version.replaceAll(/\W/gu, "_")}`);
    writeFileSync(path, `#!/bin/sh\nif [ "$1" = --version ]; then echo "git version ${version}"; exit 0; fi\nprintf '%s|' "$@"\n`, { mode: 0o755 });
    return path;
  };
  const runWrapper = (realGit: string, ...args: string[]) => Bun.spawnSync([wrapper, ...args], {
    env: { PATH: "/usr/bin:/bin", ATLAS_REAL_GIT: realGit }, stdout: "pipe", stderr: "pipe",
  });
  for (const version of ["2.55.0", "2.55.1", "2.100.0", "3.0.0", "2.55.0.windows.1"]) {
    const result = runWrapper(fakeGit(version), "status", "a b");
    assert.equal(result.exitCode, 0, `git ${version} meets 2.55.0: ${result.stderr}`);
    assert.equal(result.stdout.toString(), "status|a b|");
  }
  for (const version of ["2.54.9", "2.9.99", "1.99.99", "banana"]) {
    const result = runWrapper(fakeGit(version), "status");
    assert.equal(result.exitCode, 1, `git ${version} must be refused`);
    assert.equal(result.stdout.toString(), "", "a refused git never runs the command");
  }
  assert.equal(runWrapper("relative/git", "status").exitCode, 1, "the real git path must be absolute");
  assert.equal(runWrapper(join(wrapperRoot, "missing"), "status").exitCode, 1);
} finally {
  rmSync(wrapperRoot, { recursive: true, force: true });
}

// systemd units: one renderer, every hardening directive, no Bun, no tree paths.
const units = renderUnits({ user: "omega", group: "omega", home: "/home/omega" });
assert.deepEqual(Object.keys(units).sort(), ["atlas-credentials.service", "atlas-updater.service", "atlas.service", "opencode.service"]);
for (const [name, text] of Object.entries(units)) {
  for (const directive of ["Restart=on-failure", "RestartSec=5s", "TimeoutStopSec=30s", "LogNamespace=atlas", "LogRateLimitIntervalSec=30s", "LogRateLimitBurst=1000", "LimitNOFILE=65536", "StartLimitBurst=5", "WantedBy=multi-user.target"]) {
    assert.ok(text.includes(`${directive}\n`), `${name} keeps ${directive}`);
  }
  assert.doesNotMatch(text, /bun|\/deploy\/|\.ts\b|ATLAS_RELEASE_ROOT|tools\/(git|gh)\//iu, `${name} has no Bun or source-tree paths`);
}
assert.match(units["atlas.service"], /^User=omega$/mu);
assert.match(units["atlas.service"], /^ExecStart=\/opt\/atlas\/current\/atlas serve$/mu);
assert.match(units["atlas.service"], /^Environment=PATH=\/opt\/atlas\/current\/bin:/mu);
assert.match(units["atlas.service"], /^Environment=ATLAS_GIT_BINARY=\/opt\/atlas\/current\/bin\/git$/mu);
assert.match(units["atlas.service"], /^ExecStartPre=\/opt\/atlas\/current\/bin\/git --version$/mu);
assert.match(units["atlas.service"], /^UMask=0077$/mu);
assert.match(units["atlas-credentials.service"], /^ExecStart=\/opt\/atlas\/services\/current\/atlas credentials$/mu);
assert.match(units["atlas-credentials.service"], /^RuntimeDirectory=atlas\nRuntimeDirectoryMode=0700$/mu);
assert.match(units["atlas-credentials.service"], /^UMask=0077$/mu);
const updaterUnit = units["atlas-updater.service"];
assert.match(updaterUnit, /^User=root\nGroup=omega$/mu);
assert.match(updaterUnit, /^ExecStart=\/opt\/atlas\/services\/current\/atlas updater$/mu);
for (const directive of ["NoNewPrivileges=true", "PrivateTmp=true", "ProtectHome=true", "ProtectSystem=strict", "UMask=0007", "RuntimeDirectory=atlas-updater", "RuntimeDirectoryMode=0750",
  "StateDirectory=atlas-updater", "StateDirectoryMode=0700", "Environment=ATLAS_UPDATE_STATE_PATH=/var/lib/atlas-updater/update-state.json",
  "ReadWritePaths=/opt/atlas /run/atlas-updater", "ReadOnlyPaths=-/opt/atlas/tools", "Environment=ATLAS_SERVICE_USER=omega", "Environment=ATLAS_SERVICE_GROUP=omega"]) {
  assert.ok(updaterUnit.includes(`${directive}\n`), `updater keeps ${directive}`);
}
assert.doesNotMatch(updaterUnit, /ReadWritePaths=.*\/var\/lib\/atlas(\s|$)/mu, "the root updater must not write the service-owned data folder");
assert.doesNotMatch(updaterUnit, /EnvironmentFile|opencode/iu, "the updater reads only the health token and port from atlas.env and never selects OpenCode");
assert.match(units["opencode.service"], /^ExecStartPre=\/opt\/atlas\/tools\/opencode\/current\/bin\/opencode --version$/mu);
assert.match(units["opencode.service"], /^Environment=GIT_SSH_COMMAND=\/bin\/false$/mu);
const custom = renderUnits({ user: "atlas", group: "atlas", home: "/var/lib/atlas-home", prefix: "/srv/atlas", dataDir: "/srv/data", configDir: "/srv/etc", realGit: "/usr/local/bin/git" });
assert.match(custom["atlas.service"], /^ExecStart=\/srv\/atlas\/current\/atlas serve$/mu);
assert.match(custom["atlas.service"], /^EnvironmentFile=\/srv\/etc\/atlas.env$/mu);
assert.match(custom["atlas-updater.service"], /^Environment=ATLAS_UPDATE_STATE_PATH=\/var\/lib\/atlas-updater\/update-state.json$/mu);
assert.match(custom["opencode.service"], /^Environment=ATLAS_REAL_GIT=\/usr\/local\/bin\/git$/mu);
assert.throws(() => renderUnits({ user: "root", group: "omega", home: "/root" }), /must not run as root/);
assert.throws(() => renderUnits({ user: "omega", group: "omega", home: "/home/omega", prefix: "/opt/atlas dir" }), /plain absolute path/);
assert.throws(() => renderUnits({ user: "omega", group: "omega", home: "relative" }), /plain absolute path/);

// Release folder builder with real compiled binaries.
const binaryTag = "v0.1.0+build.1";
const binarySha = "c".repeat(40);
const binary = await verifyBinary(binaryTag, binarySha);
const binaryMetadata = verifyMetadata(binary, binaryTag, binarySha);
const scratchParent = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, "atlas-verify-layout-"));
try {
  const releasesRoot = join(scratch, "releases");
  const folder = await buildReleaseFolder({ binaryPath: binary, metadata: binaryMetadata, releasesRoot });
  assert.equal(folder, join(releasesRoot, `atlas-${binaryTag}`));
  assert.deepEqual(readdirSync(folder).sort(), ["RELEASE_METADATA.json", "atlas", "bin"]);
  assert.deepEqual(readdirSync(join(folder, "bin")).sort(), ["gh", "git", "git-credential-atlas"]);
  assert.equal(lstatSync(join(folder, "atlas")).mode & 0o7777, 0o555);
  assert.equal(lstatSync(folder).mode & 0o7777, 0o555);
  assert.equal(lstatSync(join(folder, "RELEASE_METADATA.json")).mode & 0o7777, 0o444);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "RELEASE_METADATA.json"), "utf8")), binaryMetadata);
  assert.equal(readFileSync(join(folder, "bin/gh"), "utf8"), releaseShimText(join(folder, "atlas"), "gh"));
  assert.equal(readFileSync(join(folder, "bin/git-credential-atlas"), "utf8"), releaseShimText(join(folder, "atlas"), "git-credential"));
  assert.equal(readFileSync(join(folder, "bin/git"), "utf8"), gitWrapperText(binaryMetadata.minimumHostTools.git));
  const reported = Bun.spawnSync([join(folder, "atlas"), "version", "--json"], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe" });
  assert.deepEqual(JSON.parse(reported.stdout.toString()), binaryMetadata.identity, "the folder's binary loads its own RELEASE_METADATA.json");
  assert.equal(await releaseFolderIntact(folder, binaryMetadata), true);
  assert.equal(await buildReleaseFolder({ binaryPath: binary, metadata: binaryMetadata, releasesRoot }), folder, "an intact folder is reused");
  const leftovers = () => readdirSync(releasesRoot).filter((name) => name.startsWith("."));
  assert.deepEqual(leftovers(), []);

  // A tampered binary is refused before anything executes it.
  const marker = join(scratch, "executed");
  const tampered = join(scratch, "tampered");
  writeFileSync(tampered, `#!/bin/sh\ntouch '${marker}'\necho '${JSON.stringify(binaryMetadata.identity)}'\n`, { mode: 0o755 });
  const otherRoot = join(scratch, "other-releases");
  await assert.rejects(buildReleaseFolder({ binaryPath: tampered, metadata: binaryMetadata, releasesRoot: otherRoot }), /does not match its published SHA-256/);
  const sameSize = join(scratch, "flipped");
  const bytes = readFileSync(binary);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(sameSize, bytes, { mode: 0o755 });
  await assert.rejects(buildReleaseFolder({ binaryPath: sameSize, metadata: binaryMetadata, releasesRoot: otherRoot }), /does not match its published SHA-256/);
  const tamperedMetadata = { ...binaryMetadata, asset: { ...binaryMetadata.asset, size: readFileSync(tampered).byteLength, sha256: "0".repeat(64) } };
  await assert.rejects(buildReleaseFolder({ binaryPath: tampered, metadata: tamperedMetadata, releasesRoot: otherRoot }), /SHA-256/);
  assert.equal(existsSync(marker), false, "a binary whose SHA-256 does not match is never executed");
  assert.deepEqual(readdirSync(otherRoot), [], "a refused build leaves nothing behind");

  // A binary whose embedded identity differs from its metadata is refused before it can be selected.
  const lying = createReleaseMetadata("v0.1.0+build.2", binarySha, binaryMetadata.asset, binaryMetadata.openCodeClient);
  await assert.rejects(buildReleaseFolder({ binaryPath: binary, metadata: lying, releasesRoot: otherRoot }), /reports a different release identity/);
  const wrongSha = createReleaseMetadata(binaryTag, "d".repeat(40), binaryMetadata.asset, binaryMetadata.openCodeClient);
  await assert.rejects(buildReleaseFolder({ binaryPath: binary, metadata: wrongSha, releasesRoot: otherRoot }), /reports a different release identity/);
  assert.deepEqual(readdirSync(otherRoot), [], "an identity mismatch leaves no Release folder");

  // An existing folder that is not intact is never overwritten.
  const brokenRoot = join(scratch, "broken-releases");
  mkdirSync(join(brokenRoot, `atlas-${binaryTag}`), { recursive: true });
  await assert.rejects(buildReleaseFolder({ binaryPath: binary, metadata: binaryMetadata, releasesRoot: brokenRoot }), /already exists but does not match/);
  chmodSync(join(folder, "bin"), 0o755);
  writeFileSync(join(folder, "bin", "extra"), "");
  chmodSync(join(folder, "bin"), 0o555);
  assert.equal(await releaseFolderIntact(folder, binaryMetadata), false, "an extra file makes a folder not intact");
  chmodSync(join(folder, "bin"), 0o755);
  rmSync(join(folder, "bin", "extra"));
  chmodSync(join(folder, "bin"), 0o555);
  assert.equal(await releaseFolderIntact(folder, binaryMetadata), true);
  chmodSync(folder, 0o755);
  assert.equal(await releaseFolderIntact(folder, binaryMetadata), false, "a writable folder is not intact");
} finally {
  Bun.spawnSync(["chmod", "-R", "u+w", scratch]);
  rmSync(scratch, { recursive: true, force: true });
}

const root = join(tmpdir(), `atlas-release-identity-${crypto.randomUUID()}`);
await mkdir(root, { recursive: true });
try {
  assert.equal(loadReleaseIdentity(root).published, false, "an ordinary checkout must remain identified as development");
  await writeFile(join(root, "RELEASE_METADATA.json"), JSON.stringify(metadata));
  assert.deepEqual(loadReleaseIdentity(root), metadata.identity);

  const persistence = createPersistence({ path: ":memory:" });
  const openCode = {
    start: () => undefined,
    stop: () => undefined,
    enqueue: () => undefined,
    process: async () => undefined,
    pauseForUpdate: async () => undefined,
    resumeFromUpdate: () => undefined,
    getClient: async () => { throw new Error("OpenCode is intentionally absent"); },
    isReady: () => false,
    readiness: () => ({ ready: false, state: "stale" as const, reason: "OpenCode is intentionally absent", version: undefined }),
    onEvent: () => () => false,
    onTransport: () => () => false,
    transportState: () => "stale" as const,
  };
  const app = createApp({
    persistence,
    openCode,
    releaseIdentity: metadata.identity,
    sharedToken: "secret",
    github: {
      listInstallationRepositories: async () => [],
      hasLabel: async () => true,
      listIssues: async () => [],
      listPullRequests: async () => [],
      listStacks: async () => [],
      getBranchRef: async () => null,
    },
  });
  const response = await app.fetch(new Request("http://atlas.test/health", { headers: { Authorization: "Bearer secret" } }));
  assert.equal(response.status, 200, "OpenCode absence must not degrade Atlas storage health");
  const body = await response.json() as { atlas: { release: unknown }; persistence: { healthy: boolean }; openCode: { ready: boolean } };
  assert.deepEqual(body.atlas.release, metadata.identity);
  assert.equal(body.persistence.healthy, true);
  assert.equal(body.openCode.ready, false);
  persistence.close();
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Issue #57 release identity and health checks passed");
