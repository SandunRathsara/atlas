import { strict as assert } from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const metadata = createReleaseMetadata(initial, sha, { bun: "1.3.14", git: "2.55.0", gh: "2.100.0" });
assert.equal(assertReleaseMetadata(metadata), metadata);
assert.throws(() => assertReleaseMetadata({
  ...metadata,
  identity: { ...metadata.identity, gitSha: "b".repeat(40), build: 2 },
}), /does not agree/);

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
