import { strict as assert } from "node:assert";
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createCredentialBoundary, readSessionHelperReferences } from "../src/credentials.ts";
import { createReleaseMetadata, type ReleaseMetadata } from "../src/release.ts";
import { createUpdaterClient, createUpdaterService } from "../src/updater.ts";
import { renderUpdatesStatus } from "../src/views/updates.ts";

const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp/opencode", "atlas-issue61-"));
const releasesRoot = join(root, "releases");
const currentPath = join(root, "current");
const statePath = join(root, "data", "update-state.json");
const updaterSocket = join(root, "run", "updater.sock");
const updaterKey = join(root, "config", "updater.key");
const registryPath = join(root, "data", "session-scopes.json");
const supplierSocket = join(root, "run", "supplier.sock");
const supplierKey = join(root, "config", "supplier.key");
const sessionDirectory = join(root, "sessions", "ses_retained");
const key = "a".repeat(64);
const token = "release-retention-fixture-token";

const metadata = (tag: string, character: string) => createReleaseMetadata(tag, character.repeat(40), {
  bun: "1.3.14",
  git: "2.55.0",
  gh: "2.100.0",
});
const referenced = metadata("v0.0.1+build.1", "1");
const startupUnused = metadata("v0.0.2+build.2", "2");
const installed = metadata("v0.1.0+build.3", "3");
const candidate = metadata("v0.1.0+build.4", "4");
const inFlightUnused = metadata("v0.0.3+build.5", "5");
const restartUnused = metadata("v0.0.4+build.6", "6");
const failedCandidate = metadata("v0.1.0+build.7", "7");
const rollbackUnused = metadata("v0.0.5+build.8", "8");
const cleanupCandidate = metadata("v0.1.0+build.9", "9");
const cleanupUnused = metadata("v0.0.6+build.10", "a");

const releaseTree = (release: ReleaseMetadata) => {
  const path = join(releasesRoot, `atlas-${release.identity.tag}`);
  mkdirSync(path, { recursive: true, mode: 0o755 });
  writeFileSync(join(path, "RELEASE_METADATA.json"), `${JSON.stringify(release)}\n`);
  writeFileSync(join(path, "complete.txt"), `${release.identity.tag}\n`);
  return path;
};

const waitFor = async (predicate: () => boolean | Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(2);
  }
  assert.fail(message);
};

const terminal = new Set(["succeeded", "rolled_back", "rollback_failed", "abandoned"]);
let credentials: ReturnType<typeof createCredentialBoundary> | undefined;
let updater: ReturnType<typeof createUpdaterService> | undefined;
let updaterClient = () => createUpdaterClient({ socketPath: updaterSocket, keyPath: updaterKey });

try {
  mkdirSync(join(root, "config"), { recursive: true, mode: 0o700 });
  mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(updaterKey, `${key}\n`, { mode: 0o600 });
  const referencedPath = releaseTree(referenced);
  releaseTree(startupUnused);
  const installedPath = releaseTree(installed);
  const candidatePath = releaseTree(candidate);
  symlinkSync(installedPath, currentPath, "dir");

  const helper = join(referencedPath, "scripts", "atlas-git-credential.ts");
  mkdirSync(join(referencedPath, "scripts"), { recursive: true });
  mkdirSync(join(referencedPath, "src"), { recursive: true });
  copyFileSync(join(import.meta.dir, "atlas-git-credential.ts"), helper);
  copyFileSync(join(import.meta.dir, "../src/credentials.ts"), join(referencedPath, "src", "credentials.ts"));
  chmodSync(helper, 0o755);

  credentials = createCredentialBoundary({
    registryPath,
    socketPath: supplierSocket,
    keyPath: supplierKey,
    staticToken: token,
    allowStaticToken: true,
    authorizedRepositories: ["Acme/repo"],
  });
  credentials.registerScope({
    atlasId: "ses_retained",
    directory: sessionDirectory,
    repositoryId: "123",
    fullName: "Acme/repo",
    helperPaths: [referencedPath, helper],
  });
  const registryOwnerUid = lstatSync(registryPath).uid;
  assert.deepEqual(new Set(readSessionHelperReferences({ registryPath, expectedOwnerUid: registryOwnerUid })), new Set([referencedPath, helper]), "the updater-safe registry reader must accept the expected owner, mode, and path");
  assert.throws(() => readSessionHelperReferences({ registryPath, expectedOwnerUid: registryOwnerUid + 1 }), /private regular file/, "the updater-safe reader must reject an unexpected owner");
  chmodSync(registryPath, 0o640);
  assert.throws(() => readSessionHelperReferences({ registryPath, expectedOwnerUid: registryOwnerUid }), /private regular file/, "the updater-safe reader must reject a group-readable registry");
  chmodSync(registryPath, 0o600);
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    chownSync(registryPath, 65534, 65534);
    assert.equal(readSessionHelperReferences({ registryPath, expectedOwnerUid: 65534 }).includes(helper), true, "a root updater must safely read a registry owned by the expected service account");
    assert.throws(() => readSessionHelperReferences({ registryPath, expectedOwnerUid: 0 }), /private regular file/);
    chownSync(registryPath, 0, 0);
  }
  await credentials.start();

  const healthy = new Map<string, boolean>([[candidate.identity.tag, false], [installed.identity.tag, true]]);
  let failCleanupAfterHealth: string | null = null;
  const controls: string[] = [];
  const options = {
    statePath,
    socketPath: updaterSocket,
    keyPath: updaterKey,
    releasesRoot,
    currentPath,
    activationTimeoutMs: 80,
    activationPollMs: 2,
    hostRuntime: () => ({ bun: "1.3.14", git: "2.55.0", gh: "2.100.0" }),
    listHelperReferences: () => readSessionHelperReferences({ registryPath, expectedOwnerUid: registryOwnerUid }),
    controlAtlas: (operation: "stop" | "start") => {
      controls.push(operation);
      return true;
    },
    checkAtlasHealth: (release: ReleaseMetadata) => {
      const result = healthy.get(release.identity.tag) ?? false;
      if (result && failCleanupAfterHealth === release.identity.tag) {
        failCleanupAfterHealth = null;
        chmodSync(releasesRoot, 0o555);
      }
      return result;
    },
  };
  updater = createUpdaterService(options);
  await updater.start();
  let client = updaterClient();
  let status = await client.status();
  assert.equal(status.cleanup.state, "succeeded");
  assert.equal(existsSync(join(releasesRoot, `atlas-${startupUnused.identity.tag}`)), false, "startup cleanup retained an unused older release");
  assert.equal(existsSync(referencedPath), true, "startup cleanup removed a helper-referenced release");
  assert.equal(realpathSync(currentPath), installedPath, "startup cleanup changed the current release");
  assert.equal(existsSync(candidatePath), true, "startup cleanup removed a newer inactive release");

  await client.stage(candidate);
  await waitFor(async () => (await client.status()).state === "staged", "candidate was not staged");
  await client.prepareActivation(candidate, false);
  await client.activate(candidate);
  await waitFor(async () => (await client.status()).activation.state === "validating", "candidate did not reach validation");
  const inFlightUnusedPath = releaseTree(inFlightUnused);
  assert.equal(existsSync(inFlightUnusedPath), true, "cleanup raced in-flight activation");
  healthy.set(candidate.identity.tag, true);
  await waitFor(async () => (await client.status()).activation.state === "succeeded", "candidate activation did not succeed");
  status = await client.status();
  assert.equal(status.activation.previousPath, installedPath, "previous working release was not retained durably");
  assert.equal(realpathSync(currentPath), candidatePath);
  assert.equal(existsSync(installedPath), true, "cleanup removed the previous working release");
  assert.equal(existsSync(referencedPath), true, "cleanup removed a referenced release");
  assert.equal(existsSync(inFlightUnusedPath), false, "post-activation cleanup retained an unused older release");

  const helperChild = Bun.spawn([process.execPath, helper, "get"], {
    cwd: sessionDirectory,
    env: {
      ...(process.env as Record<string, string>),
      ATLAS_SUPPLIER_SOCKET: supplierSocket,
      ATLAS_SUPPLIER_KEY_PATH: supplierKey,
      ATLAS_SESSION_DIRECTORY: sessionDirectory,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (helperChild.stdin && typeof helperChild.stdin !== "number") {
    helperChild.stdin.write("protocol=https\nhost=github.com\npath=Acme/repo.git\n\n");
    helperChild.stdin.end();
  }
  const [helperExit, helperOutput] = await Promise.all([helperChild.exited, new Response(helperChild.stdout).text()]);
  assert.equal(helperExit, 0, "referenced older helper was not callable after cleanup");
  assert.match(helperOutput, new RegExp(`password=${token}`));

  const restartUnusedPath = releaseTree(restartUnused);
  updater.close();
  updater = undefined;
  await Bun.sleep(5);
  updater = createUpdaterService(options);
  await updater.start();
  client = updaterClient();
  assert.equal(existsSync(restartUnusedPath), false, "updater restart did not reconcile retention");
  assert.equal(existsSync(installedPath), true, "restart cleanup removed the previous working release");
  assert.equal(existsSync(referencedPath), true, "restart cleanup removed a helper dependency");

  const failedCandidatePath = releaseTree(failedCandidate);
  healthy.set(failedCandidate.identity.tag, false);
  healthy.set(candidate.identity.tag, true);
  await client.stage(failedCandidate);
  await waitFor(async () => (await client.status()).state === "staged", "rollback candidate was not staged");
  await client.prepareActivation(failedCandidate, false);
  await client.activate(failedCandidate);
  await waitFor(async () => (await client.status()).activation.state === "validating", "rollback candidate did not reach validation");
  const rollbackUnusedPath = releaseTree(rollbackUnused);
  status = await activateResult(client, failedCandidate);
  assert.equal(status.activation.state, "rolled_back");
  assert.equal(status.activation.previousPath, candidatePath, "failed candidate was treated as the previous working release");
  assert.equal(realpathSync(currentPath), candidatePath);
  assert.equal(existsSync(failedCandidatePath), true, "cleanup removed the staged failed candidate needed for Retry");
  assert.equal(existsSync(installedPath), false, "rollback cleanup retained a superseded previous release");
  assert.equal(existsSync(rollbackUnusedPath), false, "rollback cleanup retained an unused older release");
  assert.equal(existsSync(referencedPath), true);

  const cleanupCandidatePath = releaseTree(cleanupCandidate);
  healthy.set(cleanupCandidate.identity.tag, false);
  await client.stage(cleanupCandidate);
  await waitFor(async () => (await client.status()).state === "staged", "cleanup-failure candidate was not staged");
  await client.prepareActivation(cleanupCandidate, false);
  await client.activate(cleanupCandidate);
  await waitFor(async () => (await client.status()).activation.state === "validating", "cleanup-failure candidate did not reach validation");
  const cleanupUnusedPath = releaseTree(cleanupUnused);
  failCleanupAfterHealth = cleanupCandidate.identity.tag;
  healthy.set(cleanupCandidate.identity.tag, true);
  await waitFor(async () => (await client.status()).activation.state === "succeeded", "cleanup failure changed a healthy activation result");
  status = await client.status();
  assert.equal(realpathSync(currentPath), cleanupCandidatePath);
  assert.equal(status.activation.state, "succeeded", "cleanup failure misreported the healthy active release");
  assert.equal(status.cleanup.state, "failed", "cleanup failure was not visible on the updater boundary");
  assert.ok(status.cleanup.pendingTags.includes(cleanupUnused.identity.tag), "partial cleanup work was not retained durably");
  const html = renderUpdatesStatus({
    installed: cleanupCandidate.identity,
    checking: false,
    discovery: { candidates: [], lastCheckAt: null, lastSuccessAt: null, lastFailureAt: null, failureReason: null, stageRequestFailureAt: null, stageRequestFailureReason: null },
    candidates: [],
    available: null,
    updater: status,
    updaterError: null,
  });
  assert.match(html, /Activated/);
  assert.match(html, /Cleanup failed/);

  chmodSync(releasesRoot, 0o755);
  updater.close();
  updater = undefined;
  await Bun.sleep(5);
  updater = createUpdaterService(options);
  await updater.start();
  client = updaterClient();
  status = await client.status();
  assert.equal(status.cleanup.state, "succeeded", "restart did not reconcile partial cleanup");
  assert.equal(existsSync(cleanupUnusedPath), false);
  assert.equal(existsSync(candidatePath), true, "restart cleanup removed the previous working release");
  assert.equal(existsSync(referencedPath), true);
  assert.equal(existsSync(sessionDirectory), true, "release cleanup removed Session data");
  assert.equal(controls.filter((operation) => operation === "stop").length, 3, "cleanup launched an activation or replayed process control");
  assert.match(readFileSync(statePath, "utf8"), /"cleanup":\{"state":"succeeded"/, "cleanup outcome was not durable");

  const validState = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, any>;
  const corruptions = [
    (state: Record<string, any>) => { state.lastResult.tag = "not-a-release"; },
    (state: Record<string, any>) => { state.activation.failedTags = ["not-a-release"]; },
    (state: Record<string, any>) => { state.activation.lastResult.tag = "not-a-release"; },
    (state: Record<string, any>) => { state.cleanup.pendingTags = ["not-a-release"]; },
    (state: Record<string, any>) => { state.cleanup.removedTags = ["not-a-release"]; },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    const invalid = structuredClone(validState);
    corrupt(invalid);
    const invalidStatePath = join(root, `invalid-update-state-${index}.json`);
    writeFileSync(invalidStatePath, JSON.stringify(invalid));
    assert.throws(() => createUpdaterService({ statePath: invalidStatePath }), /Updater .*state is invalid/, "all persisted updater result, suppression, and cleanup tags must cross the validated ReleaseTag boundary");
  }

  console.log("Issue #61 release retention and helper continuity checks passed");
} finally {
  updater?.close();
  credentials?.close();
  if (existsSync(root)) {
    Bun.spawnSync(["chmod", "-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
}

async function activateResult(client: ReturnType<typeof createUpdaterClient>, release: ReleaseMetadata) {
  await waitFor(async () => terminal.has((await client.status()).activation.state), `activation did not finish for ${release.identity.tag}`);
  return await client.status();
}
