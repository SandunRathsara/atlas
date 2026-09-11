import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { createPersistence, type Persistence } from "../src/persistence.ts";
import { createReleaseMetadata, type ReleaseMetadata } from "../src/release.ts";
import { createUpdateService, UPDATE_CHECK_INTERVAL_MS } from "../src/update-discovery.ts";
import { createUpdaterClient, createUpdaterService } from "../src/updater.ts";

const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp/opencode", "atlas-issue60-"));
const key = "a".repeat(64);
const metadata = (tag: string, character: string) => createReleaseMetadata(tag, character.repeat(40), {
  bun: "1.3.14",
  git: "2.55.0",
  gh: "2.100.0",
});
const installed = metadata("v0.1.0+build.1", "1");
const sameBuild2 = metadata("v0.1.0+build.2", "2");
const sameBuild10 = metadata("v0.1.0+build.10", "a");
const sameBuild12 = metadata("v0.1.0+build.12", "c");
const semverChange = metadata("v0.2.0+build.11", "b");

const waitFor = async (predicate: () => boolean | Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(5);
  }
  assert.fail(message);
};

const releaseTree = (releasesRoot: string, release: ReleaseMetadata) => {
  const path = join(releasesRoot, `atlas-${release.identity.tag}`);
  mkdirSync(path, { recursive: true, mode: 0o755 });
  writeFileSync(join(path, "RELEASE_METADATA.json"), `${JSON.stringify(release)}\n`);
  return path;
};

const createHost = async (name: string, candidates: ReleaseMetadata[], activationTimeoutMs = 10_000) => {
  const hostRoot = join(root, name);
  const releasesRoot = join(hostRoot, "releases");
  const statePath = join(hostRoot, "data", "update-state.json");
  const socketPath = join(hostRoot, "run", "updater.sock");
  const keyPath = join(hostRoot, "config", "updater.key");
  const currentPath = join(hostRoot, "current");
  mkdirSync(join(hostRoot, "config"), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, `${key}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  const paths = new Map([[installed.identity.tag, releaseTree(releasesRoot, installed)]]);
  for (const candidate of candidates) paths.set(candidate.identity.tag, releaseTree(releasesRoot, candidate));
  symlinkSync(paths.get(installed.identity.tag)!, currentPath, "dir");
  const controls: string[] = [];
  const unhealthy = new Set<string>();
  let clock = Date.parse("2026-09-12T12:00:00.000Z");
  const serviceOptions = {
    statePath,
    socketPath,
    keyPath,
    releasesRoot,
    currentPath,
    now: () => clock++,
    activationTimeoutMs,
    activationPollMs: 2,
    hostRuntime: () => ({ bun: "1.3.14", git: "2.55.0", gh: "2.100.0" }),
    controlAtlas: async (operation: "stop" | "start") => {
      controls.push(operation);
      return true;
    },
    checkAtlasHealth: async (expected: ReleaseMetadata) => {
      const selected = [...paths].find(([, path]) => path === realpathSync(currentPath))?.[0];
      return selected === expected.identity.tag && !unhealthy.has(expected.identity.tag);
    },
  };
  let service = createUpdaterService(serviceOptions);
  await service.start();
  let client = createUpdaterClient({ socketPath, keyPath });
  return {
    controls,
    currentPath,
    paths,
    unhealthy,
    client: () => client,
    close: () => service.close(),
    reopen: async () => {
      service.close();
      await Bun.sleep(10);
      service = createUpdaterService(serviceOptions);
      await service.start();
      client = createUpdaterClient({ socketPath, keyPath });
      return client;
    },
  };
};

const discovery = (persistence: Persistence, updater: ReturnType<typeof createUpdaterClient>, releases: () => ReleaseMetadata[], schedule?: { callback?: () => void; interval?: number }) =>
  createUpdateService({
    persistence,
    installed: installed.identity,
    updater,
    apiUrl: "https://updates.test/releases",
    downloadBaseUrl: "https://downloads.test/releases",
    fetcher: (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.startsWith("https://updates.test/releases")) {
        return Response.json(releases().map((release) => ({ tag_name: release.identity.tag, draft: false, prerelease: false })));
      }
      const release = releases().find((candidate) => url === `https://downloads.test/releases/${encodeURIComponent(candidate.identity.tag)}/atlas-release.json`);
      return release ? Response.json(release) : new Response("not found", { status: 404 });
    }) as typeof fetch,
    scheduleEvery: schedule ? (callback, interval) => {
      schedule.callback = callback;
      schedule.interval = interval;
      return 1 as unknown as ReturnType<typeof setInterval>;
    } : undefined,
    cancelSchedule: () => undefined,
    sleep: () => Bun.sleep(2),
  });

const pause = async () => ({ status: "paused" as const, resume: () => true });
const github = {
  listInstallationRepositories: async () => [],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [],
  listStacks: async () => [],
  getBranchRef: async () => null,
};
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

try {
  const host = await createHost("policy-and-concurrency", [sameBuild2, sameBuild10, semverChange]);
  const persistence = createPersistence({ path: join(root, "policy.sqlite") });
  let releases = [semverChange, sameBuild2, sameBuild10, installed];
  const updates = discovery(persistence, host.client(), () => releases);
  const app = createApp({ persistence, releaseIdentity: installed.identity, updates, sharedToken: "secret", github, openCode });

  let response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  let html = await response.text();
  assert.match(html, /Approval required/);
  assert.match(html, /Automatic for current SemVer builds/);
  response = await app.fetch(new Request("http://atlas.test/updates/policy", { method: "POST" }));
  assert.equal(response.status, 401, "policy changes require existing Atlas access");
  response = await app.fetch(new Request("http://atlas.test/updates/policy", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ policy: "invalid" }),
  }));
  assert.equal(response.status, 400, "unknown policy values must be rejected");

  const loginPage = await app.fetch(new Request("http://atlas.test/login"));
  const loginCsrf = (await loginPage.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
  const login = await app.fetch(new Request("http://atlas.test/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://atlas.test" },
    body: new URLSearchParams({ csrf: loginCsrf!, returnTo: "/updates", token: "secret" }),
  }));
  const cookie = login.headers.get("Set-Cookie")?.split(";")[0];
  const browserPage = await app.fetch(new Request("http://atlas.test/updates", { headers: { Cookie: cookie! } }));
  const policyCsrf = (await browserPage.text()).match(/action="\/updates\/policy"[\s\S]*?name="csrf" value="([^"]+)"/)?.[1];
  response = await app.fetch(new Request("http://atlas.test/updates/policy", {
    method: "POST",
    headers: { Cookie: cookie!, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: policyCsrf!, policy: "automatic" }),
  }));
  assert.equal(response.status, 403, "browser policy changes require same-origin CSRF");

  host.unhealthy.add(sameBuild10.identity.tag);
  response = await app.fetch(new Request("http://atlas.test/updates/policy", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ policy: "automatic" }),
  }));
  assert.equal(response.status, 303);
  await waitFor(async () => (await host.client().status()).activation.state === "validating", "automatic activation did not use the existing updater path");
  assert.equal((await host.client().status()).activation.metadata?.identity.tag, sameBuild10.identity.tag, "numeric same-SemVer build must win over a newer SemVer");
  assert.equal((await updates.status()).available?.identity.tag, sameBuild10.identity.tag, "automatic policy must expose the relevant same-SemVer candidate");
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  html = await response.text();
  assert.match(html, /Automatic/);
  assert.match(html, /v0\.1\.0\+build\.10/);
  assert.doesNotMatch(html, /v0\.2\.0\+build\.11/, "a newer SemVer must not hide the automatic same-SemVer candidate");

  await Promise.all([
    updates.install(sameBuild10.identity.tag, false, pause),
    updates.install(sameBuild10.identity.tag, false, pause),
    updates.check(pause),
    updates.check(pause),
  ]);
  response = await app.fetch(new Request("http://atlas.test/updates/policy", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ policy: "approval_required" }),
  }));
  assert.equal(response.status, 303);
  host.unhealthy.delete(sameBuild10.identity.tag);
  await waitFor(async () => (await host.client().status()).activation.state === "succeeded", "an in-progress activation must finish coherently after a policy change");
  await waitFor(() => app.updatePause.state() === "active", "automatic activation did not release the safe pause");
  assert.deepEqual(host.controls, ["stop", "start"], "overlapping wakeups and approvals must not launch competing activation effects");
  assert.equal(realpathSync(host.currentPath), host.paths.get(sameBuild10.identity.tag));

  await host.client().setPolicy("automatic");
  const reopened = await host.reopen();
  assert.equal((await reopened.status()).policy, "automatic", "automatic policy must survive updater restart and code selection changes");
  host.close();
  persistence.close();

  const scheduleHost = await createHost("schedule", [sameBuild10, semverChange]);
  await scheduleHost.client().setPolicy("automatic");
  const schedulePersistence = createPersistence({ path: join(root, "schedule.sqlite") });
  const schedule = {} as { callback?: () => void; interval?: number };
  const scheduledUpdates = discovery(schedulePersistence, scheduleHost.client(), () => [semverChange, sameBuild10, installed], schedule);
  scheduledUpdates.start();
  await waitFor(async () => (await scheduledUpdates.status()).updater?.metadata?.identity.tag === sameBuild10.identity.tag, "startup check did not use automatic eligibility");
  assert.equal(schedule.interval, UPDATE_CHECK_INTERVAL_MS);
  schedule.callback?.();
  await scheduledUpdates.check();
  assert.equal((await scheduledUpdates.status()).available?.identity.tag, sameBuild10.identity.tag, "scheduled and manual checks must share startup eligibility");
  scheduledUpdates.stop();
  scheduleHost.close();
  schedulePersistence.close();

  for (const mode of ["retry", "later"] as const) {
    const failureHost = await createHost(`failure-${mode}`, [sameBuild10, sameBuild12, semverChange], 20);
    failureHost.unhealthy.add(sameBuild10.identity.tag);
    await failureHost.client().setPolicy("automatic");
    const failurePersistence = createPersistence({ path: join(root, `failure-${mode}.sqlite`) });
    let failureReleases = [semverChange, sameBuild10, installed];
    let failureUpdates = discovery(failurePersistence, failureHost.client(), () => failureReleases);
    await failureUpdates.check(pause);
    await waitFor(async () => (await failureHost.client().status()).activation.state === "rolled_back", `${mode}: failed automatic build did not roll back`);
    await Bun.sleep(10);
    const effectsAfterFailure = failureHost.controls.length;
    const failureClient = await failureHost.reopen();
    let failureStatus = await failureClient.status();
    assert.equal(failureStatus.policy, "automatic", `${mode}: policy must survive rollback/updater restart`);
    assert.equal(failureStatus.activation.failedTags.includes(sameBuild10.identity.tag), true, `${mode}: failed build suppression must persist`);
    failureUpdates = discovery(failurePersistence, failureClient, () => failureReleases);
    await failureUpdates.check(pause);
    await Bun.sleep(50);
    assert.equal(failureHost.controls.length, effectsAfterFailure, `${mode}: a suppressed build must not reactivate automatically`);

    if (mode === "retry") {
      failureHost.unhealthy.delete(sameBuild10.identity.tag);
      const retryApp = createApp({
        persistence: failurePersistence,
        releaseIdentity: installed.identity,
        updates: failureUpdates,
        sharedToken: "secret",
        github,
        openCode,
      });
      response = await retryApp.fetch(new Request("http://atlas.test/updates/install", {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tag: sameBuild10.identity.tag, retry: "1" }),
      }));
      assert.equal(response.status, 303, "explicit Retry HTTP did not accept the failed build");
      await waitFor(async () => (await failureClient.status()).activation.state === "succeeded", "explicit Retry did not permit the failed build");
      await waitFor(() => retryApp.updatePause.state() === "active", "explicit Retry did not release the safe pause");
    } else {
      failureReleases = [semverChange, sameBuild12, sameBuild10, installed];
      await failureUpdates.check(pause);
      await waitFor(async () => (await failureClient.status()).activation.state === "succeeded", "a later eligible build was blocked by an earlier failure");
      failureStatus = await failureClient.status();
      assert.equal(failureStatus.activation.metadata?.identity.tag, sameBuild12.identity.tag);
    }
    await Bun.sleep(10);
    failureHost.close();
    failurePersistence.close();
  }

  console.log("Issue #60 automatic policy, HTTP, selection, concurrency, suppression, and restart checks passed");
} finally {
  Bun.spawnSync(["chmod", "-R", "u+w", root]);
  rmSync(root, { recursive: true, force: true });
}
