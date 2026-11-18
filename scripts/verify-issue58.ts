import "./isolate-opencode.ts";
import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { connect } from "node:net";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { createPersistence } from "../src/persistence.ts";
import { createReleaseMetadata, type ReleaseMetadata } from "../src/release.ts";
import { createUpdateService, UPDATE_CHECK_INTERVAL_MS } from "../src/update-discovery.ts";
import { createUpdaterClient, createUpdaterService, type UpdaterStatus } from "../src/updater.ts";
import { verifyBinary, verifyMetadata } from "./verify-binaries.ts";

// Staging downloads a real ~100 MB binary; keep it off the small /tmp.
const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
mkdirSync(cacheRoot, { recursive: true });
const root = mkdtempSync(join(cacheRoot, "atlas-issue58-"));
// Discovery-only metadata: the asset is never downloaded.
const metadata = (tag: string, character: string, options: { maintenance?: boolean; minimumGit?: string } = {}) => {
  const value = createReleaseMetadata(tag, character.repeat(40), { sha256: "0".repeat(64), size: 1 }, "2.3.2");
  if (options.minimumGit) value.minimumHostTools = { ...value.minimumHostTools, git: options.minimumGit };
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
  schemaVersion: 2,
  policy: "approval_required",
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
  // Staging hashes and runs a real binary, so allow up to 30 s.
  for (let attempt = 0; attempt < 3000; attempt += 1) {
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
  let rejectPolicy = false;
  const updates = createUpdateService({
    persistence,
    installed: installedMetadata.identity,
    fetcher: discoveryFetch,
    apiUrl: "https://updates.test/releases",
    downloadBaseUrl: "https://downloads.test/releases",
    updater: {
      status: async () => updaterStatus,
      setPolicy: async (policy) => {
        if (rejectPolicy) throw new Error("controlled policy failure");
        updaterStatus = { ...updaterStatus, policy };
        return updaterStatus;
      },
      stage: async (candidate) => {
        stageRequests.push(candidate.identity.tag);
        updaterStatus = {
          ...idleUpdater(),
          state: "downloading",
          metadata: candidate,
          requestedAt: "2026-09-12T12:00:00.000Z",
          updatedAt: "2026-09-12T12:00:00.000Z",
          message: "Downloading the published Atlas binary.",
          requirements: {
            required: candidate.minimumHostTools,
            available: { git: "2.55.0", gh: "2.100.0" },
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
  assert.match(html, /id="update-check-form"[^>]*hx-post="\/updates\/check"[^>]*hx-indicator="#update-check-progress"[^>]*hx-disabled-elt=/, "Check now must expose labelled pending and repeat prevention");
  assert.match(html, /Checking releases…/);
  // Updates lives under More: the phone bar leads back there; the Repository filter stays in the desktop bar.
  assert.match(html, /<div class="ax-bar-phone"><a class="ax-bar-back" href="\/more">/, "the mobile header must lead back to More");
  assert.match(html, /<div class="ax-bar-desk">[\s\S]*?aria-label="Repository filter: All Repositories"/, "Repository context must remain visible in the desktop header");
  assert.match(html, /<nav class="ax-tabbar"[^>]*>[\s\S]*?<a href="\/more" aria-current="page">/, "the mobile More tab, which holds Updates, must be current on Updates");
  assert.match(html, /class="ax-menu-item" href="\/updates" aria-current="page"/, "the desktop Updates link must use the shared selected-navigation contract");

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
  assert.match(html, /id="update-policy-form"[^>]*hx-post="\/updates\/policy"[^>]*hx-indicator="#update-policy-progress"[^>]*hx-disabled-elt=/, "policy changes must expose labelled pending and repeat prevention");
  assert.match(html, /Saving policy…/);
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
  const statusFragment = await response.text();
  assert.doesNotMatch(statusFragment, /<!doctype html>/, "HTMX status polling must return only its fragment");
  assert.match(statusFragment, /id="updates-live-status"[^>]*hx-get="\/updates\/status"/);
  assert.doesNotMatch(statusFragment, /update-policy-form|action="\/updates\/policy"/, "status polling must not replace the policy form while it is being edited");

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
  assert.match(await response.text(), /Refresh this page before trying the check again/);
  response = await app.fetch(new Request("http://atlas.test/updates/check", {
    method: "POST",
    headers: { Cookie: cookie!, Origin: "http://atlas.test", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: updateCsrf! }),
  }));
  assert.equal(response.status, 303);
  await updates.check();

  rejectPolicy = true;
  response = await app.fetch(new Request("http://atlas.test/updates/policy", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "HX-Request": "true", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ policy: "automatic" }),
  }));
  assert.equal(response.status, 409);
  html = await response.text();
  assert.match(html, /The update change was not completed/);
  assert.match(html, /Review the preserved choice and try again/);
  assert.match(html, /<input[^>]*id="update-policy"[^>]*\bchecked>/, "a failed policy save must preserve the submitted choice");
  assert.match(html, /<button[^>]*name="policy" value="automatic">Try saving again<\/button>/, "a failed policy save must offer to resubmit the preserved choice");
  assert.match(html, /href="\/inbox">return to Inbox<\/a>/);
  rejectPolicy = false;

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

  const maintenance = metadata("v0.3.0+build.4", "4", { maintenance: true, minimumGit: "2.60.0" });
  releases = [maintenance, installedMetadata];
  updaterStatus = idleUpdater();
  await updates.check();
  updaterStatus = {
    ...updaterStatus,
    requirements: {
      required: maintenance.minimumHostTools,
      available: { git: "2.55.0", gh: "2.100.0" },
      unmet: ["Git 2.60.0 or newer is required; this host reports 2.55.0."],
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
  // The active Release's own metadata is what forward-only staging compares against.
  writeFileSync(join(oldRelease, "RELEASE_METADATA.json"), `${JSON.stringify(metadata("v0.1.0+build.1", "1"))}\n`);
  symlinkSync(oldRelease, activeRelease, "dir");
  mkdirSync(join(hostRoot, "config"), { recursive: true });
  writeFileSync(keyPath, `${"a".repeat(64)}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);

  // The download server publishes real compiled binaries with their `.sha256` sidecars.
  const assets = new Map<string, Uint8Array>();
  const publishMetadata = (requested: ReleaseMetadata) =>
    assets.set(`/${requested.identity.tag}/atlas-release.json`, Buffer.from(JSON.stringify(requested)));
  const publish = (requested: ReleaseMetadata, bytes: Uint8Array) => {
    publishMetadata(requested);
    assets.set(`/${requested.identity.tag}/${requested.asset.name}`, bytes);
    assets.set(`/${requested.identity.tag}/${requested.asset.checksum}`, Buffer.from(`${requested.asset.sha256}  ${requested.asset.name}\n`));
  };
  const stagedBinary = await verifyBinary("v0.1.0+build.5", "5".repeat(40));
  const staged = verifyMetadata(stagedBinary, "v0.1.0+build.5", "5".repeat(40));
  publish(staged, readFileSync(stagedBinary));
  // Identity mismatch: a genuine binary of build 5 published, with its true SHA-256, as build 6.
  const mismatch = createReleaseMetadata("v0.1.0+build.6", "5".repeat(40), staged.asset, staged.openCodeClient);
  publish(mismatch, readFileSync(stagedBinary));
  // Tampered: metadata and sidecar describe the real binary, the server sends a script.
  const marker = join(root, "tampered-binary-executed");
  const tampered = createReleaseMetadata("v0.1.0+build.8", "5".repeat(40), staged.asset, staged.openCodeClient);
  // Same size as the real binary, so only the SHA-256 check can catch it.
  const script = Buffer.from(`#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
  publish(tampered, Buffer.concat([script, Buffer.alloc(staged.asset.size - script.byteLength, 0x0a)]));
  const failedDownload = metadata("v0.1.0+build.7", "7");
  publishMetadata(failedDownload);
  // A downgrade to the active build is published but must never be staged.
  publishMetadata(metadata("v0.1.0+build.1", "1"));
  // build 9 redirects the binary to plain HTTP; build 10 sends more bytes than its metadata declares.
  const insecureRedirect = createReleaseMetadata("v0.1.0+build.9", "5".repeat(40), staged.asset, staged.openCodeClient);
  publishMetadata(insecureRedirect);
  const oversized = createReleaseMetadata("v0.1.0+build.10", "5".repeat(40), staged.asset, staged.openCodeClient);
  publish(oversized, Buffer.concat([readFileSync(stagedBinary), Buffer.alloc(1)]));
  const networkRequests = new Map<string, number>();
  const downloadBaseUrl = "https://downloads.test/releases";
  const downloads = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.protocol, "https:", "the updater only fetches over HTTPS");
    assert.equal(init?.redirect, "manual", "the updater follows redirects itself");
    const path = decodeURIComponent(url.pathname.replace(/^\/releases/u, ""));
    networkRequests.set(path, (networkRequests.get(path) ?? 0) + 1);
    if (path === `/${insecureRedirect.identity.tag}/${insecureRedirect.asset.name}`) {
      return new Response(null, { status: 302, headers: { Location: "http://downloads.test/plain" } });
    }
    const asset = assets.get(path);
    return asset ? new Response(asset as BodyInit) : new Response("controlled missing asset", { status: 500 });
  }) as typeof fetch;
  assert.throws(() => createUpdaterService({ statePath, socketPath, keyPath, releasesRoot, downloadBaseUrl: "http://downloads.test/releases" }), /HTTPS/, "a plain-HTTP download base is refused");

  updaterHost = createUpdaterService({
    statePath,
    socketPath,
    keyPath,
    releasesRoot,
    currentPath: activeRelease,
    downloadBaseUrl,
    fetcher: downloads,
    now: () => Date.parse("2026-09-12T13:00:00.000Z"),
    hostRuntime: () => ({ git: "2.55.0", gh: "2.100.0" }),
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
  assert.equal(existsSync(join(hostStatus.stagedPath!, "atlas")), true);
  assert.equal(existsSync(join(hostStatus.stagedPath!, "bin", "git")), true);
  assert.deepEqual(JSON.parse(readFileSync(join(hostStatus.stagedPath!, "RELEASE_METADATA.json"), "utf8")), staged);
  assert.equal(lstatWriteBits(hostStatus.stagedPath!), 0, "staged release root must be read-only");
  assert.equal(readlinkSync(activeRelease), oldRelease, "staging must not change the active selection");
  assert.equal(networkRequests.get(`/${staged.identity.tag}/${staged.asset.name}`), 1, "repeated staging requests must coalesce");
  assert.match(readFileSync(statePath, "utf8"), /"state":"staged"/, "staging outcome must be durable");

  updaterHost.close();
  updaterHost = undefined;
  const reopenedOptions = { statePath, socketPath, keyPath, releasesRoot, currentPath: activeRelease, downloadBaseUrl, fetcher: downloads };
  reopenedUpdaterHost = createUpdaterService(reopenedOptions);
  await reopenedUpdaterHost.start();
  const reopenedClient = createUpdaterClient({ socketPath, keyPath });
  hostStatus = await reopenedClient.status();
  assert.equal(hostStatus.state, "staged", "staging status must remain readable after updater restart");
  assert.equal(hostStatus.lastResult?.tag, staged.identity.tag);

  await reopenedClient.stage(mismatch);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "identity mismatch did not fail staging");
  hostStatus = await reopenedClient.status();
  assert.match(hostStatus.message, /reports a different release identity/);
  assert.equal(existsSync(join(releasesRoot, `atlas-${mismatch.identity.tag}`)), false, "an identity mismatch is never staged, so it can never be activated");
  assert.equal(readlinkSync(activeRelease), oldRelease);

  await reopenedClient.stage(tampered);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "a tampered binary did not fail staging");
  hostStatus = await reopenedClient.status();
  assert.match(hostStatus.message, /does not match its published SHA-256/);
  assert.equal(existsSync(marker), false, "a binary whose SHA-256 does not match is never executed");
  assert.equal(existsSync(join(releasesRoot, `atlas-${tampered.identity.tag}`)), false);
  assert.deepEqual(readdirSync(releasesRoot).filter((name) => name.startsWith(".")), [], "failed staging leaves no temporary files");

  await reopenedClient.stage(failedDownload);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "download failure did not reach durable failed state");
  hostStatus = await reopenedClient.status();
  assert.match(hostStatus.message, /download failed \(HTTP 500\)/);
  assert.equal(hostStatus.lastResult?.state, "failed");
  assert.equal(readlinkSync(activeRelease), oldRelease);

  // Forward-only: a Release that is not newer than the active one is refused outright.
  // The reply stays opaque; the reason goes to the updater's journal.
  const wrongKey = join(hostRoot, "config", "wrong.key");
  writeFileSync(wrongKey, `${"b".repeat(64)}\n`, { mode: 0o600 });
  const logged: string[] = [];
  const consoleError = console.error;
  console.error = (...items: unknown[]) => logged.push(items.join(" "));
  try {
    await assert.rejects(reopenedClient.stage(metadata("v0.1.0+build.1", "1")), /rejected/, "staging the active build (a downgrade) must be refused");
    await assert.rejects(createUpdaterClient({ socketPath, keyPath: wrongKey }).stage(metadata("v0.1.0+build.1", "1")), /rejected/);
  } finally {
    console.error = consoleError;
  }
  assert.deepEqual(logged.filter((line) => line.startsWith("Atlas updater refused")).length, 1, "only the keyed request is logged");
  assert.match(logged.join("\n"), /Atlas updater refused "stage": Atlas v0\.1\.0\+build\.1 is not newer than the active/, "the refusal reason is logged");
  assert.equal((await reopenedClient.status()).metadata?.identity.tag, failedDownload.identity.tag, "a refused downgrade changes nothing");

  // Caller metadata is ignored: a raw request with forged metadata stages only what the updater fetched.
  const forged = { ...staged, asset: { ...staged.asset, sha256: "0".repeat(64), size: 1 } };
  const raw = await new Promise<string>((resolveRaw, rejectRaw) => {
    const socket = connect(socketPath);
    let reply = "";
    socket.on("connect", () => socket.write(`${JSON.stringify({ key: "a".repeat(64), operation: "stage", tag: staged.identity.tag, metadata: forged })}\n`));
    socket.on("data", (chunk) => { reply += chunk.toString(); });
    socket.on("end", () => resolveRaw(reply));
    socket.on("error", rejectRaw);
  });
  assert.equal(JSON.parse(raw).ok, true, raw);
  await waitFor(async () => (await reopenedClient.status()).state === "staged", "re-staging the published release did not finish");
  assert.deepEqual((await reopenedClient.status()).metadata, staged, "the updater must use only the metadata it fetched itself");

  await reopenedClient.stage(insecureRedirect);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "an HTTP redirect did not fail staging");
  assert.match((await reopenedClient.status()).message, /HTTPS/, "a redirect to plain HTTP is refused");

  await reopenedClient.stage(oversized);
  await waitFor(async () => (await reopenedClient.status()).state === "failed", "an oversized binary did not fail staging");
  assert.match((await reopenedClient.status()).message, /too large/, "a binary larger than its published size is aborted");
  assert.deepEqual(readdirSync(releasesRoot).filter((name) => name.startsWith(".")), [], "aborted downloads leave no temporary files");

  // A state file someone else could write (here: group-writable) is ignored, never acted on.
  reopenedUpdaterHost.close();
  reopenedUpdaterHost = undefined;
  const hostile = { ...JSON.parse(readFileSync(statePath, "utf8")), policy: "automatic" };
  writeFileSync(statePath, `${JSON.stringify(hostile)}\n`);
  chmodSync(statePath, 0o666);
  reopenedUpdaterHost = createUpdaterService(reopenedOptions);
  await reopenedUpdaterHost.start();
  hostStatus = await createUpdaterClient({ socketPath, keyPath }).status();
  assert.equal(hostStatus.policy, "approval_required", "a writable-by-others state file must not set the policy");
  assert.equal(hostStatus.metadata, null, "a writable-by-others state file must not be acted on");

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
