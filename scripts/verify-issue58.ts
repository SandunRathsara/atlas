import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { createPersistence } from "../src/persistence.ts";
import { createReleaseMetadata, type ReleaseMetadata } from "../src/release.ts";
import { createUpdateService, UPDATE_CHECK_INTERVAL_MS } from "../src/update-discovery.ts";
import { createUpdaterClient, createUpdaterService, type UpdaterStatus } from "../src/updater.ts";

const root = mkdtempSync(join(tmpdir(), "atlas-issue58-"));
const metadata = (tag: string, character: string, options: { maintenance?: boolean; bun?: string } = {}) => {
  const value = createReleaseMetadata(tag, character.repeat(40), {
    bun: options.bun ?? "1.3.14",
    git: "2.55.0",
    gh: "2.100.0",
  });
  if (options.maintenance) {
    value.rollback = {
      codeOnlyCompatible: false,
      manualMaintenanceInstructions: "Read the release notes and use the documented stopped-writer procedure.",
    };
  }
  return value;
};

const installedMetadata = metadata("v0.1.0+build.1", "1");
const olderSameSemver = metadata("v0.1.0+build.9", "9");
const sameSemver = metadata("v0.1.0+build.10", "a");
const newerSemver = metadata("v0.2.0+build.11", "b");
const openCode = {
  start: () => undefined,
  stop: () => undefined,
  enqueue: () => undefined,
  process: async () => undefined,
  pauseForUpdate: async () => undefined,
  resumeFromUpdate: () => undefined,
  getClient: async () => { throw new Error("OpenCode is intentionally absent"); },
  isReady: () => false,
  readiness: () => ({ ready: false, state: "stale" as const, reason: "OpenCode is intentionally absent", version: "unrelated" }),
  onEvent: () => () => false,
  onTransport: () => () => false,
  transportState: () => "stale" as const,
};
const github = {
  listInstallationRepositories: async () => [],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [],
  listStacks: async () => [],
  getBranchRef: async () => null,
};

const idleUpdater = (): UpdaterStatus => ({
  schemaVersion: 1,
  state: "idle",
  metadata: null,
  requestedAt: null,
  updatedAt: null,
  stagedPath: null,
  message: "No release has been staged yet.",
  requirements: null,
  lastResult: null,
  activation: {
    state: "idle",
    metadata: null,
    previousPath: null,
    previousMetadata: null,
    requestedAt: null,
    updatedAt: null,
    deadlineAt: null,
    message: "No release activation has been requested.",
    failureMessage: null,
    retry: false,
    failedTags: [],
    lastResult: null,
  },
  cleanup: {
    state: "idle",
    message: "Release cleanup has not run yet.",
    updatedAt: null,
    pendingTags: [],
    removedTags: [],
  },
});

const waitFor = async (predicate: () => boolean | Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(10);
  }
  assert.fail(message);
};

let downloadServer: ReturnType<typeof Bun.serve> | undefined;
let updaterHost: ReturnType<typeof createUpdaterService> | undefined;
let reopenedUpdaterHost: ReturnType<typeof createUpdaterService> | undefined;

try {
  const databasePath = join(root, "atlas.sqlite");
  const persistence = createPersistence({ path: databasePath, now: () => Date.parse("2026-09-12T12:00:00.000Z") });
  let releases = [olderSameSemver, newerSemver, sameSemver, installedMetadata];
  let discoveryFails = false;
  let listRequests = 0;
  const discoveryFetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.startsWith("https://updates.test/releases")) {
      listRequests += 1;
      if (discoveryFails) throw new Error("controlled discovery failure");
      return Response.json(releases.map((release) => ({ tag_name: release.identity.tag, draft: false, prerelease: false })));
    }
    const release = releases.find((candidate) => url === `https://downloads.test/releases/${encodeURIComponent(candidate.identity.tag)}/atlas-release.json`);
    return release ? Response.json(release) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  let scheduled: (() => void) | undefined;
  let scheduledEvery = 0;
  let updaterStatus = idleUpdater();
  const stageRequests: string[] = [];
  let loseStageResponse = false;
  const updates = createUpdateService({
    persistence,
    installed: installedMetadata.identity,
    fetcher: discoveryFetch,
    apiUrl: "https://updates.test/releases",
    downloadBaseUrl: "https://downloads.test/releases",
    updater: {
      status: async () => updaterStatus,
      stage: async (candidate) => {
        stageRequests.push(candidate.identity.tag);
        updaterStatus = {
          ...idleUpdater(),
          state: "downloading",
          metadata: candidate,
          requestedAt: "2026-09-12T12:00:00.000Z",
          updatedAt: "2026-09-12T12:00:00.000Z",
          message: "Downloading the published release archive.",
          requirements: {
            required: candidate.runtime,
            available: { bun: "1.3.14", git: "2.55.0", gh: "2.100.0" },
            unmet: [],
          },
        };
        if (loseStageResponse) throw new Error("controlled lost response");
        return updaterStatus;
      },
      prepareActivation: async () => { throw new Error("activation is outside the issue #58 fixture"); },
      activate: async () => { throw new Error("activation is outside the issue #58 fixture"); },
      abandonActivation: async () => { throw new Error("activation is outside the issue #58 fixture"); },
    },
    scheduleEvery: (callback, milliseconds) => {
      scheduled = callback;
      scheduledEvery = milliseconds;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    cancelSchedule: () => undefined,
  });
  const app = createApp({
    persistence,
    releaseIdentity: installedMetadata.identity,
    updates,
    sharedToken: "secret",
    github,
    openCode,
  });

  let response = await app.fetch(new Request("http://atlas.test/updates"));
  assert.equal(response.status, 303, "Updates must retain existing authentication");
  response = await app.fetch(new Request("http://atlas.test/updates/check", { method: "POST" }));
  assert.equal(response.status, 401, "unauthenticated update mutations must be rejected");
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  let html = await response.text();
  assert.match(html, /Not checked yet/);
  assert.doesNotMatch(html, /No newer release found/, "initial state must not claim a successful no-update check");

  updates.start();
  await updates.check();
  assert.equal(scheduledEvery, UPDATE_CHECK_INTERVAL_MS, "scheduled discovery must run every four hours");
  assert.equal(stageRequests.at(-1), newerSemver.identity.tag, "SemVer must order before the build number");
  assert.equal(app.updatePause.state(), "active", "discovery and staging must not pause Session admission");
  let status = await updates.status();
  assert.equal(status.available?.identity.tag, newerSemver.identity.tag);
  assert.deepEqual(status.candidates.map((candidate) => candidate.identity.tag), [
    newerSemver.identity.tag,
    sameSemver.identity.tag,
    olderSameSemver.identity.tag,
    installedMetadata.identity.tag,
  ], "numeric builds and all candidates needed by later same-SemVer policy must be retained");

  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /Installed release/);
  assert.match(html, /v0\.2\.0\+build\.11/);
  assert.match(html, /Approval required/);
  assert.match(html, /Downloading/);
  assert.doesNotMatch(html, /<button[^>]*>[^<]*Install/u, "activation controls must not be exposed by this slice");

  updaterStatus = idleUpdater();
  loseStageResponse = true;
  await updates.check();
  status = await updates.status();
  assert.equal(status.discovery.stageRequestFailureReason, null, "durable updater status must reconcile a lost staging response");
  assert.equal(status.updater?.metadata?.identity.tag, newerSemver.identity.tag);
  loseStageResponse = false;

  response = await app.fetch(new Request("http://atlas.test/updates/status", { headers: { Authorization: "Bearer secret" } }));
  assert.match(await response.text(), /<!doctype html>/, "direct status navigation must return a complete page");
  response = await app.fetch(new Request("http://atlas.test/updates/status", { headers: { Authorization: "Bearer secret", "HX-Request": "true" } }));
  assert.doesNotMatch(await response.text(), /<!doctype html>/, "HTMX status polling must return only its fragment");

  const loginPage = await app.fetch(new Request("http://atlas.test/login"));
  const loginCsrf = (await loginPage.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(loginCsrf);
  const login = await app.fetch(new Request("http://atlas.test/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://atlas.test" },
    body: new URLSearchParams({ csrf: loginCsrf!, returnTo: "/updates", token: "secret" }),
  }));
  const cookie = login.headers.get("Set-Cookie")?.split(";")[0];
  assert.ok(cookie);
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Cookie: cookie! } }));
  html = await response.text();
  const updateCsrf = html.match(/<form action="\/updates\/check"[\s\S]*?name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(updateCsrf);
  response = await app.fetch(new Request("http://atlas.test/updates/check", {
    method: "POST",
    headers: { Cookie: cookie!, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: updateCsrf! }),
  }));
  assert.equal(response.status, 403, "browser update mutations require same-origin CSRF");
  response = await app.fetch(new Request("http://atlas.test/updates/check", {
    method: "POST",
    headers: { Cookie: cookie!, Origin: "http://atlas.test", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: updateCsrf! }),
  }));
  assert.equal(response.status, 303);
  await updates.check();

  const beforeSchedule = listRequests;
  scheduled?.();
  await waitFor(() => listRequests > beforeSchedule, "scheduled release discovery did not run");
  await waitFor(async () => !(await updates.status()).checking, "scheduled release discovery did not complete");

  discoveryFails = true;
  await updates.check();
  status = await updates.status();
  assert.equal(status.available?.identity.tag, newerSemver.identity.tag, "failed discovery must retain the known candidate");
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  html = await response.text();
  assert.match(html, /Release check failed/);
  assert.match(html, /Known release information was retained/);
  assert.doesNotMatch(html, /No newer release found/);

  discoveryFails = false;
  releases = [installedMetadata];
  updaterStatus = idleUpdater();
  await updates.check();
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  assert.match(await response.text(), /No newer release found/, "a successful no-update check must be distinct from failure");

  const maintenance = metadata("v0.3.0+build.4", "4", { maintenance: true, bun: "1.4.0" });
  releases = [maintenance, installedMetadata];
  updaterStatus = idleUpdater();
  await updates.check();
  updaterStatus = {
    ...updaterStatus,
    requirements: {
      required: maintenance.runtime,
      available: { bun: "1.3.14", git: "2.55.0", gh: "2.100.0" },
      unmet: ["Bun 1.4.0 is required; this host reports 1.3.14."],
    },
  };
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  html = await response.text();
  assert.match(html, /Manual maintenance required/);
  assert.match(html, /stopped-writer procedure/);
  assert.match(html, /Host runtime requirements are not met/);
  assert.match(html, /OpenCode keeps running and is not an activation gate/);
  assert.doesNotMatch(html, /action="\/updates\/install"/, "maintenance-required or runtime-ineligible releases must not expose Install");
  response = await app.fetch(new Request("http://atlas.test/updates/install", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tag: maintenance.identity.tag }),
  }));
  assert.equal(response.status, 409, "direct activation must reject maintenance-required or runtime-ineligible releases");
  updates.stop();
  persistence.close();
  const reopenedPersistence = createPersistence({ path: databasePath });
  assert.equal(reopenedPersistence.getUpdateDiscoveryState().candidates[0]?.identity.tag, maintenance.identity.tag, "known release candidates must survive an Atlas restart");
  reopenedPersistence.close();

  const hostRoot = join(root, "host");
  const releasesRoot = join(hostRoot, "releases");
  const statePath = join(hostRoot, "data", "update-state.json");
  const socketPath = join(hostRoot, "run", "updater.sock");
  const keyPath = join(hostRoot, "config", "updater.key");
  const activeRelease = join(hostRoot, "current");
  const oldRelease = join(releasesRoot, "atlas-v0.1.0+build.1");
  mkdirSync(oldRelease, { recursive: true });
  symlinkSync(oldRelease, activeRelease, "dir");
  mkdirSync(join(hostRoot, "config"), { recursive: true });
  writeFileSync(keyPath, `${"a".repeat(64)}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);

  const assets = new Map<string, Uint8Array>();
  const addArchive = (requested: ReleaseMetadata, embedded: ReleaseMetadata = requested) => {
    const fixture = join(root, `archive-${requested.identity.build}`);
    const tree = join(fixture, `atlas-${requested.identity.tag}`);
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "RELEASE_METADATA.json"), `${JSON.stringify(embedded)}\n`);
    writeFileSync(join(tree, "ready.txt"), "complete\n");
    const archive = join(fixture, requested.artifact.name);
    const result = Bun.spawnSync(["tar", "--create", "--gzip", "--file", archive, "--directory", fixture, `atlas-${requested.identity.tag}`]);
    assert.equal(result.exitCode, 0);
    const bytes = readFileSync(archive);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assets.set(`/${requested.identity.tag}/${requested.artifact.name}`, bytes);
    assets.set(`/${requested.identity.tag}/${requested.artifact.checksum}`, Buffer.from(`${digest}  ${requested.artifact.name}\n`));
  };

  const staged = metadata("v0.1.0+build.5", "5");
  const mismatch = metadata("v0.1.0+build.6", "6");
  const mismatchedEmbedded = metadata(mismatch.identity.tag, "f");
  const failedDownload = metadata("v0.1.0+build.7", "7");
  addArchive(staged);
  addArchive(mismatch, mismatchedEmbedded);
  const networkRequests = new Map<string, number>();
  downloadServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      networkRequests.set(path, (networkRequests.get(path) ?? 0) + 1);
      const asset = assets.get(path);
      return asset ? new Response(asset as BodyInit) : new Response("controlled missing asset", { status: 500 });
    },
  });

  updaterHost = createUpdaterService({
    statePath,
    socketPath,
    keyPath,
    releasesRoot,
    downloadBaseUrl: `http://127.0.0.1:${downloadServer.port}`,
    now: () => Date.parse("2026-09-12T13:00:00.000Z"),
    hostRuntime: () => ({ bun: "1.3.14", git: "2.55.0", gh: "2.100.0" }),
  });
  await updaterHost.start();
  const client = createUpdaterClient({ socketPath, keyPath });
  assert.equal((await client.status()).state, "idle");
  await Promise.all([client.stage(staged), client.stage(staged)]);
  await waitFor(async () => ["staged", "failed"].includes((await client.status()).state), "release staging did not finish");
  let hostStatus = await client.status();
  assert.equal(hostStatus.state, "staged", hostStatus.message);
  assert.equal(hostStatus.metadata?.identity.tag, staged.identity.tag);
  assert.equal(hostStatus.stagedPath, join(releasesRoot, `atlas-${staged.identity.tag}`));
  assert.equal(existsSync(join(hostStatus.stagedPath!, "ready.txt")), true);
  assert.equal(lstatWriteBits(hostStatus.stagedPath!), 0, "staged release root must be read-only");
  assert.equal(readlinkSync(activeRelease), oldRelease, "staging must not change the active selection");
  assert.equal(networkRequests.get(`/${staged.identity.tag}/${staged.artifact.name}`), 1, "repeated staging requests must coalesce");
  assert.match(readFileSync(statePath, "utf8"), /"state":"staged"/, "staging outcome must be durable");

  updaterHost.close();
  updaterHost = undefined;
  reopenedUpdaterHost = createUpdaterService({ statePath, socketPath, keyPath, releasesRoot, downloadBaseUrl: `http://127.0.0.1:${downloadServer.port}` });
  await reopenedUpdaterHost.start();
  const reopenedClient = createUpdaterClient({ socketPath, keyPath });
  hostStatus = await reopenedClient.status();
  assert.equal(hostStatus.state, "staged", "staging status must remain readable after updater restart");
  assert.equal(hostStatus.lastResult?.tag, staged.identity.tag);

  await reopenedClient.stage(mismatch);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "identity mismatch did not fail staging");
  hostStatus = await reopenedClient.status();
  assert.match(hostStatus.message, /identity does not match/);
  assert.equal(existsSync(join(releasesRoot, `atlas-${mismatch.identity.tag}`)), false);
  assert.equal(readlinkSync(activeRelease), oldRelease);

  await reopenedClient.stage(failedDownload);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "download failure did not reach durable failed state");
  hostStatus = await reopenedClient.status();
  assert.match(hostStatus.message, /download failed \(HTTP 500\)/);
  assert.equal(hostStatus.lastResult?.state, "failed");
  assert.equal(readlinkSync(activeRelease), oldRelease);

  console.log("Issue #58 discovery, Updates HTTP, and durable staging checks passed");
} finally {
  reopenedUpdaterHost?.close();
  updaterHost?.close();
  await downloadServer?.stop(true);
  Bun.spawnSync(["chmod", "-R", "u+w", root]);
  rmSync(root, { recursive: true, force: true });
}

function lstatWriteBits(path: string) {
  return lstatSync(path).mode & 0o222;
}
