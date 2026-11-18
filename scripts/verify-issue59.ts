import "./isolate-opencode.ts";
import { strict as assert } from "node:assert";
import {
  chmodSync,
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
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { createPersistence } from "../src/persistence.ts";
import { buildReleaseFolder } from "../src/release-layout.ts";
import type { ReleaseMetadata } from "../src/release.ts";
import { createUpdateService } from "../src/update-discovery.ts";
import { createUpdatePauseCoordinator, restoreUpdatePauseUntilUpdaterSettles } from "../src/update-pause.ts";
import {
  ACTIVATION_HEALTH_TIMEOUT_MS,
  createUpdaterClient,
  createUpdaterService,
  installShippedSupportServices,
  type UpdaterClient,
} from "../src/updater.ts";
import { checkActivationHealth } from "../src/updater-server.ts";
import { fixtureMetadata, fixtureReleaseFolder, verifyBinary, verifyMetadata } from "./verify-binaries.ts";

// One real compiled Release (~100 MB) lives here, so stay off the small /tmp.
const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
mkdirSync(cacheRoot, { recursive: true });
const root = mkdtempSync(join(cacheRoot, "atlas-issue59-"));
const key = "a".repeat(64);
// Stand-in Releases: builder-made folders whose `atlas` only reports its identity.
const metadata = (tag: string, character: string) => fixtureMetadata(tag, character.repeat(40));
const installed = metadata("v0.1.0+build.1", "1");

const waitFor = async (predicate: () => boolean | Promise<boolean>, message: string) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(2);
  }
  assert.fail(message);
};

type HostOptions = {
  candidateStarts?: boolean;
  previousStarts?: boolean;
  candidateHealthy?: () => boolean;
  previousHealthy?: () => boolean;
  timeoutMs?: number;
  hostRuntime?: () => { git: string | null; gh: string | null };
};

const releaseTree = async (releasesRoot: string, release: ReleaseMetadata) => {
  const { metadata: built, path } = await fixtureReleaseFolder(releasesRoot, release.identity.tag, release.identity.gitSha);
  assert.deepEqual(built, release);
  return path;
};

const createHost = async (name: string, candidate: ReleaseMetadata, options: HostOptions = {}) => {
  const hostRoot = join(root, name);
  const releasesRoot = join(hostRoot, "releases");
  const statePath = join(hostRoot, "data", "update-state.json");
  const socketPath = join(hostRoot, "run", "updater.sock");
  const keyPath = join(hostRoot, "config", "updater.key");
  const currentPath = join(hostRoot, "current");
  const supportRoot = join(hostRoot, "services");
  mkdirSync(join(hostRoot, "config"), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, `${key}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  const previousPath = await releaseTree(releasesRoot, installed);
  const candidatePath = await releaseTree(releasesRoot, candidate);
  symlinkSync(previousPath, currentPath, "dir");
  const dataPath = join(hostRoot, "shared-data.txt");
  writeFileSync(dataPath, "preserve me\n");
  const controls: string[] = [];
  let running = true;

  const serviceOptions = {
    statePath,
    socketPath,
    keyPath,
    releasesRoot,
    currentPath,
    activationTimeoutMs: options.timeoutMs ?? 25,
    activationPollMs: 2,
    hostRuntime: options.hostRuntime ?? (() => ({ git: "2.55.0", gh: "2.100.0" })),
    controlAtlas: async (operation: "stop" | "start") => {
      controls.push(operation);
      if (operation === "stop") {
        running = false;
        return true;
      }
      const selected = realpathSync(currentPath);
      if (selected === candidatePath && options.candidateStarts === false) return false;
      if (selected === previousPath && options.previousStarts === false) return false;
      running = true;
      return true;
    },
    checkAtlasHealth: async (expected: ReleaseMetadata) => {
      if (!running) return false;
      const selected = realpathSync(currentPath);
      if (selected === candidatePath) {
        return expected.identity.tag === candidate.identity.tag && (options.candidateHealthy?.() ?? true);
      }
      return selected === previousPath && expected.identity.tag === installed.identity.tag && (options.previousHealthy?.() ?? true);
    },
    updateSupportServices: async (releasePath: string, release: ReleaseMetadata) => {
      await installShippedSupportServices(releasePath, release, supportRoot);
    },
  };
  let service = createUpdaterService(serviceOptions);
  await service.start();
  let client = createUpdaterClient({ socketPath, keyPath });
  await client.stage(candidate);
  await waitFor(async () => (await client.status()).state === "staged", `${name}: release was not staged`);

  return {
    candidate,
    candidatePath,
    previousPath,
    currentPath,
    statePath,
    supportRoot,
    controls,
    dataPath,
    client: () => client,
    service: () => service,
    reopen: async (changes: Partial<typeof serviceOptions> = {}) => {
      service = createUpdaterService({ ...serviceOptions, ...changes });
      await service.start();
      client = createUpdaterClient({ socketPath, keyPath });
      return client;
    },
  };
};

const terminal = new Set(["succeeded", "rolled_back", "rollback_failed", "abandoned"]);
const approveAndActivate = async (client: UpdaterClient, candidate: ReleaseMetadata, retry = false) => {
  await client.prepareActivation(candidate, retry);
  await client.activate(candidate);
  await waitFor(async () => terminal.has((await client.status()).activation.state), "activation did not finish");
  return (await client.status()).activation;
};

const fakeOpenCode = () => {
  let pauseCount = 0;
  let resumeCount = 0;
  let readinessQueries = 0;
  return {
    service: {
      start: () => undefined,
      stop: () => undefined,
      enqueue: () => undefined,
      process: async () => undefined,
      pauseForUpdate: async () => { pauseCount += 1; },
      resumeFromUpdate: () => { resumeCount += 1; },
      getClient: async () => { throw new Error("OpenCode is intentionally absent"); },
      isReady: () => false,
      readiness: () => { readinessQueries += 1; return { ready: false, state: "stale" as const, reason: "OpenCode is intentionally absent", version: undefined }; },
      onEvent: () => () => false,
      onTransport: () => () => false,
      transportState: () => "stale" as const,
    },
    counts: () => ({ pauseCount, resumeCount, readinessQueries }),
  };
};

const github = {
  listInstallationRepositories: async () => [],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [],
  listStacks: async () => [],
  getBranchRef: async () => null,
};

try {
  assert.equal(ACTIVATION_HEALTH_TIMEOUT_MS, 60_000, "production candidate health deadline must be 60 seconds");

  {
    let calls = 0;
    let preparationPaused = false;
    let handoffPaused = false;
    const coordinator = createUpdatePauseCoordinator({
      preparation: {
        pauseForUpdate: async () => { preparationPaused = true; },
        resumeFromUpdate: () => { preparationPaused = false; },
      },
      openCode: {
        pauseForUpdate: async () => { handoffPaused = true; },
        resumeFromUpdate: () => { handoffPaused = false; },
      },
      timeoutMs: 5,
    });
    await restoreUpdatePauseUntilUpdaterSettles(
      coordinator,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("controlled startup socket race");
        return { activation: { state: calls === 2 ? "validating" : "succeeded" } } as never;
      },
      async () => {
        assert.equal(preparationPaused && handoffPaused, true, "status uncertainty must not start preparation or handoff");
      },
    );
    assert.equal(calls, 3, "startup pause must reconcile unavailable, active, then terminal updater status");
    assert.equal(preparationPaused || handoffPaused, false, "terminal updater status must release the conservative startup pause");
  }

  const startupOpenCode = fakeOpenCode();
  const startupPersistence = createPersistence({ path: ":memory:" });
  const startupApp = createApp({
    persistence: startupPersistence,
    sharedToken: "secret",
    github,
    openCode: startupOpenCode.service,
    startPausedForUpdate: true,
  });
  await waitFor(() => startupApp.updatePause.state() === "paused", "an Atlas process started during activation did not hold preparation/handoff");
  const startupPause = await startupApp.updatePause.pause();
  assert.equal(startupPause.status, "paused");
  assert.equal(startupPause.status === "paused" && startupPause.resume(), true);
  startupPersistence.close();

  const webCandidate = metadata("v0.1.1+build.2", "2");
  let candidateHealthy = false;
  const webHost = await createHost("web", webCandidate, { candidateHealthy: () => candidateHealthy });
  const databasePath = join(root, "web.sqlite");
  const persistence = createPersistence({ path: databasePath });
  persistence.recordUpdateDiscoverySuccess([webCandidate, installed]);
  let losePrepareResponse = true;
  let loseActivateResponse = true;
  const realClient = webHost.client();
  const lossyClient: UpdaterClient = {
    status: realClient.status,
    setPolicy: realClient.setPolicy,
    stage: realClient.stage,
    prepareActivation: async (candidate, retry) => {
      const durable = await realClient.prepareActivation(candidate, retry);
      if (losePrepareResponse) {
        losePrepareResponse = false;
        throw new Error("controlled lost approval response");
      }
      return durable;
    },
    activate: async (candidate) => {
      const durable = await realClient.activate(candidate);
      if (loseActivateResponse) {
        loseActivateResponse = false;
        throw new Error("controlled lost activation response");
      }
      return durable;
    },
    abandonActivation: realClient.abandonActivation,
  };
  const updates = createUpdateService({ persistence, installed: installed.identity, updater: lossyClient });
  const openCode = fakeOpenCode();
  const app = createApp({ persistence, releaseIdentity: installed.identity, updates, sharedToken: "secret", github, openCode: openCode.service });

  let response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  let html = await response.text();
  assert.match(html, /action="\/updates\/install"/);
  assert.match(html, /> Install<\/button>/);
  assert.match(html, /id="update-install-form"[^>]*hx-post="\/updates\/install"[^>]*hx-indicator="#update-install-progress"[^>]*hx-disabled-elt=/, "Install must expose labelled pending and repeat prevention");
  assert.match(html, /Requesting activation…/);
  response = await app.fetch(new Request("http://atlas.test/updates/install", { method: "POST" }));
  assert.equal(response.status, 401, "activation requires existing Atlas access");
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
  const browserUpdates = await app.fetch(new Request("http://atlas.test/updates", { headers: { Cookie: cookie! } }));
  const installCsrf = (await browserUpdates.text()).match(/action="\/updates\/install"[\s\S]*?name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(installCsrf);
  response = await app.fetch(new Request("http://atlas.test/updates/install", {
    method: "POST",
    headers: { Cookie: cookie!, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: installCsrf!, tag: webCandidate.identity.tag }),
  }));
  assert.equal(response.status, 403, "browser activation requires same-origin CSRF");
  response = await app.fetch(new Request("http://atlas.test/updates/install", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tag: webCandidate.identity.tag }),
  }));
  assert.equal(response.status, 303, await response.text());
  await waitFor(async () => (await realClient.status()).activation.state === "validating", "candidate validation did not start after approval");
  const repeated = await app.fetch(new Request("http://atlas.test/updates/install", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tag: webCandidate.identity.tag }),
  }));
  assert.equal(repeated.status, 303, "repeated approval must coalesce");
  assert.deepEqual(webHost.controls, ["stop", "start"], "lost/repeated requests must not launch competing activation");
  candidateHealthy = true;
  await waitFor(async () => (await realClient.status()).activation.state === "succeeded", "approved release did not activate");
  await waitFor(() => app.updatePause.state() === "active", "successful activation did not release the update pause");
  assert.equal(realpathSync(webHost.currentPath), webHost.candidatePath);
  assert.equal(realpathSync(join(webHost.supportRoot, "current")), join(webHost.supportRoot, "releases", `atlas-${webCandidate.identity.tag}`), "successful activation must atomically select the candidate's shipped support services");
  // The surviving services run `<supportRoot>/current/atlas credentials|updater`.
  assert.equal(readFileSync(join(webHost.supportRoot, "current", "atlas"), "utf8"), readFileSync(join(webHost.candidatePath, "atlas"), "utf8"));
  assert.deepEqual(JSON.parse(readFileSync(join(webHost.supportRoot, "current", "RELEASE_METADATA.json"), "utf8")), webCandidate);
  assert.equal(lstatSync(join(webHost.supportRoot, "releases", `atlas-${webCandidate.identity.tag}`)).mode & 0o222, 0, "the selected support bundle must be immutable");
  assert.equal(readFileSync(webHost.dataPath, "utf8"), "preserve me\n");
  assert.deepEqual(openCode.counts(), { pauseCount: 1, resumeCount: 1, readinessQueries: 0 }, "activation must pause handoff without querying or operating OpenCode readiness");
  const activationHealth = await app.fetch(new Request("http://atlas.test/health?activation=1", { headers: { Authorization: "Bearer secret" } }));
  assert.equal(activationHealth.status, 200);
  assert.equal(Object.hasOwn(await activationHealth.json() as object, "openCode"), false, "activation health must not evaluate or report OpenCode readiness");
  assert.equal(openCode.counts().readinessQueries, 0);
  response = await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  html = await response.text();
  assert.match(html, /Activated/);
  assert.match(html, /identity and storage health are checked independently of OpenCode/);
  persistence.close();
  const reopenedPersistence = createPersistence({ path: databasePath });
  assert.equal(reopenedPersistence.getUpdateDiscoveryState().candidates[0]?.identity.tag, webCandidate.identity.tag, "activation must preserve Atlas data");
  reopenedPersistence.close();
  webHost.service().close();

  const timeoutCandidate = metadata("v0.1.2+build.3", "3");
  const timeoutHost = await createHost("checkpoint-timeout", timeoutCandidate);
  const timeoutPersistence = createPersistence({ path: join(root, "timeout.sqlite") });
  timeoutPersistence.recordUpdateDiscoverySuccess([timeoutCandidate, installed]);
  const timeoutUpdates = createUpdateService({ persistence: timeoutPersistence, installed: installed.identity, updater: timeoutHost.client() });
  await timeoutUpdates.install(timeoutCandidate.identity.tag, false, async () => ({ status: "timed_out", reason: "safe_checkpoint_timeout" }));
  await waitFor(async () => (await timeoutHost.client().status()).activation.state === "abandoned", "checkpoint timeout was not recorded durably");
  assert.equal(realpathSync(timeoutHost.currentPath), timeoutHost.previousPath);
  assert.deepEqual(timeoutHost.controls, [], "checkpoint timeout must not stop or select Atlas");
  timeoutPersistence.close();
  timeoutHost.service().close();

  let runtimesAvailable = true;
  const runtimeCandidate = metadata("v0.1.3+build.12", "c");
  const runtimeHost = await createHost("runtime-revalidation", runtimeCandidate, {
    hostRuntime: () => ({ git: runtimesAvailable ? "2.100.1" : "2.54.9", gh: "2.100.0" }),
  });
  runtimesAvailable = false;
  await assert.rejects(runtimeHost.client().prepareActivation(runtimeCandidate, false), /rejected/, "activation must revalidate host runtimes after staging and immediately before the pause");
  const runtimeStatus = await runtimeHost.client().status();
  assert.match(runtimeStatus.requirements?.unmet[0] ?? "", /Git 2\.55\.0 or newer is required; this host reports 2\.54\.9/);
  assert.deepEqual(runtimeHost.controls, [], "runtime drift must be recorded before Atlas is paused or stopped");
  runtimeHost.service().close();

  for (const scenario of ["failed-boot", "wrong-identity", "unhealthy-storage", "deadline"] as const) {
    const candidate = metadata(`v0.2.${scenario === "failed-boot" ? 0 : scenario === "wrong-identity" ? 1 : scenario === "unhealthy-storage" ? 2 : 3}+build.${scenario === "failed-boot" ? 4 : scenario === "wrong-identity" ? 5 : scenario === "unhealthy-storage" ? 6 : 7}`, scenario === "failed-boot" ? "4" : scenario === "wrong-identity" ? "5" : scenario === "unhealthy-storage" ? "6" : "7");
    const host = await createHost(scenario, candidate, {
      candidateStarts: scenario !== "failed-boot",
      candidateHealthy: () => false,
      previousHealthy: () => true,
    });
    const result = await approveAndActivate(host.client(), candidate);
    assert.equal(result.state, "rolled_back", `${scenario} must recover the previous release`);
    assert.equal(realpathSync(host.currentPath), host.previousPath);
    assert.equal(result.failedTags.includes(candidate.identity.tag), true, `${scenario} must suppress the failed build`);
    assert.equal(readFileSync(host.dataPath, "utf8"), "preserve me\n", `${scenario} must preserve shared data`);
    assert.equal(existsSync(join(host.supportRoot, "current")), false, `${scenario} must not select candidate support services before candidate health succeeds`);
    host.service().close();
  }

  const failedCandidate = metadata("v0.3.0+build.8", "8");
  const failedHost = await createHost("suppression", failedCandidate, { candidateHealthy: () => false, previousHealthy: () => true });
  assert.equal((await approveAndActivate(failedHost.client(), failedCandidate)).state, "rolled_back");
  const failedUiPersistence = createPersistence({ path: ":memory:" });
  failedUiPersistence.recordUpdateDiscoverySuccess([failedCandidate, installed]);
  const failedUiUpdates = createUpdateService({ persistence: failedUiPersistence, installed: installed.identity, updater: failedHost.client() });
  const failedUi = createApp({ persistence: failedUiPersistence, releaseIdentity: installed.identity, updates: failedUiUpdates, sharedToken: "secret", github, openCode: fakeOpenCode().service });
  response = await failedUi.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }));
  html = await response.text();
  assert.match(html, /> Retry<\/button>/, "a suppressed failed build must expose explicit Retry");
  assert.match(html, /Recovered/, "the durable rollback result must be visible after reconnect");
  response = await failedUi.fetch(new Request("http://atlas.test/updates/install", {
    method: "POST",
    headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tag: failedCandidate.identity.tag }),
  }));
  assert.equal(response.status, 409, "Install must not bypass failed-build suppression");
  html = await response.text();
  assert.match(html, /The update change was not completed/);
  assert.match(html, /Review the preserved choice and try again/);
  assert.match(html, /> Retry<\/button>/, "a rejected activation must preserve the safe Retry action");
  failedUiPersistence.close();
  failedHost.service().close();
  await Bun.sleep(5);
  let reopenedClient = await failedHost.reopen();
  assert.equal((await reopenedClient.status()).activation.failedTags.includes(failedCandidate.identity.tag), true, "failed-build suppression must survive updater restart");
  await assert.rejects(reopenedClient.prepareActivation(failedCandidate, false), /rejected/, "ordinary approval must not retry a failed build");
  await reopenedClient.prepareActivation(failedCandidate, true);
  await reopenedClient.abandonActivation(failedCandidate, "Explicit Retry was accepted for this regression check.");
  const laterCandidate = metadata("v0.3.1+build.9", "9");
  await releaseTree(join(root, "suppression", "releases"), laterCandidate);
  await reopenedClient.stage(laterCandidate);
  await waitFor(async () => (await reopenedClient.status()).state === "staged", "later release was not staged");
  await reopenedClient.prepareActivation(laterCandidate, false);
  await reopenedClient.abandonActivation(laterCandidate, "Later releases remain eligible under normal approval.");
  failedHost.service().close();

  const rollbackFailureCandidate = metadata("v0.4.0+build.10", "a");
  const rollbackFailureHost = await createHost("rollback-failure", rollbackFailureCandidate, {
    candidateHealthy: () => false,
    previousHealthy: () => false,
  });
  const rollbackFailure = await approveAndActivate(rollbackFailureHost.client(), rollbackFailureCandidate);
  assert.equal(rollbackFailure.state, "rollback_failed");
  assert.match(rollbackFailure.message, /did not report its expected identity and healthy storage/);
  rollbackFailureHost.service().close();

  const interruptedCandidate = metadata("v0.5.0+build.11", "b");
  let interruptedHealthy = false;
  const interruptedHost = await createHost("interrupted", interruptedCandidate, {
    candidateHealthy: () => interruptedHealthy,
    timeoutMs: 1_000,
  });
  await interruptedHost.client().prepareActivation(interruptedCandidate, false);
  await interruptedHost.client().activate(interruptedCandidate);
  await waitFor(async () => (await interruptedHost.client().status()).activation.state === "validating", "interrupted updater did not reach validation");
  interruptedHost.service().close();
  await Bun.sleep(10);
  interruptedHealthy = true;
  reopenedClient = await interruptedHost.reopen();
  await waitFor(async () => (await reopenedClient.status()).activation.state === "succeeded", "restarted updater did not reconcile activation");
  assert.equal(interruptedHost.controls.filter((operation) => operation === "stop").length, 1, "updater restart must not replay a completed stop/select sequence");
  interruptedHost.service().close();

  // Activation health (src/updater-server.ts#checkActivationHealth) against
  // controlled responses: identity, storage, token, and no OpenCode gate.
  let healthMode: "healthy" | "wrong" | "unhealthy" | "opencode" = "healthy";
  const healthServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("Authorization") !== "Bearer secret") return Response.json({}, { status: 401 });
      return Response.json({
        atlas: { process: true, release: healthMode === "wrong" ? installed.identity : webCandidate.identity },
        persistence: { healthy: healthMode !== "unhealthy" },
        ...(healthMode === "opencode" ? { openCode: { ready: true } } : {}),
      });
    },
  });
  const runHealth = (token = "secret") => checkActivationHealth(webCandidate, { port: healthServer.port!, token });
  assert.equal(await runHealth(), true, "Atlas-only health must pass with OpenCode unavailable");
  assert.equal(await runHealth("wrong"), false, "a rejected token is not healthy");
  healthMode = "wrong";
  assert.equal(await runHealth(), false, "an old process response must not satisfy candidate identity health");
  healthMode = "unhealthy";
  assert.equal(await runHealth(), false, "unhealthy Atlas storage must fail activation health");
  healthMode = "opencode";
  assert.equal(await runHealth(), false, "activation health must not mix in OpenCode readiness");
  await healthServer.stop(true);

  // The same check against a real `atlas serve` from a builder-made Release folder.
  const realTag = "v0.1.1+build.2";
  const realSha = "2".repeat(40);
  const realBinary = await verifyBinary(realTag, realSha);
  const realMetadata = verifyMetadata(realBinary, realTag, realSha);
  const realRelease = await buildReleaseFolder({ binaryPath: realBinary, metadata: realMetadata, releasesRoot: join(root, "real-releases") });
  const freePort = () => {
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    return port;
  };
  const port = freePort();
  let webhookPort = freePort();
  while (webhookPort === port) webhookPort = freePort();
  const runRoot = join(root, "real-run");
  mkdirSync(join(runRoot, "home"), { recursive: true, mode: 0o700 });
  mkdirSync(join(runRoot, "sessions"), { recursive: true, mode: 0o700 });
  chmodSync(runRoot, 0o700);
  const server = Bun.spawn([join(realRelease, "atlas"), "serve"], {
    cwd: realRelease,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: join(runRoot, "home"),
      ATLAS_SHARED_TOKEN: "secret",
      ATLAS_GITHUB_WEBHOOK_SECRET: "fixture-webhook-secret",
      ATLAS_GITHUB_ORGANIZATION: "fixture-org",
      ATLAS_GITHUB_INSTALLATION_ID: "1",
      ATLAS_PORT: String(port),
      ATLAS_WEBHOOK_PORT: String(webhookPort),
      ATLAS_DATABASE_PATH: join(runRoot, "atlas.sqlite"),
      ATLAS_SESSION_ROOT: join(runRoot, "sessions"),
      ATLAS_GITHUB_ENV_PATH: join(runRoot, "github.env"),
      ATLAS_CREDENTIAL_REGISTRY_PATH: join(runRoot, "session-scopes.json"),
      ATLAS_SUPPLIER_SOCKET: join(runRoot, "supplier.sock"),
      ATLAS_SUPPLIER_KEY_PATH: join(runRoot, "supplier.key"),
      OPENCODE_SERVICE_FILE: join(runRoot, "missing-opencode-service.json"),
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 200 && !healthy; attempt += 1) {
      healthy = await checkActivationHealth(realMetadata, { port, token: "secret" });
      if (!healthy) await Bun.sleep(50);
    }
    assert.equal(healthy, true, "a real Release passes activation health for its own identity with OpenCode unavailable");
    const wrongSha = { identity: { ...realMetadata.identity, gitSha: "f".repeat(40) } };
    assert.equal(await checkActivationHealth(wrongSha, { port, token: "secret" }), false, "a running Release with a different SHA fails activation health");
    assert.equal(await checkActivationHealth(installed, { port, token: "secret" }), false, "a running Release with a different tag fails activation health");
    assert.equal(await checkActivationHealth(realMetadata, { port, token: "wrong" }), false, "activation health needs the shared token");
  } finally {
    server.kill("SIGTERM");
    await server.exited;
  }

  console.log("Issue #59 approval, activation, rollback, suppression, and restart checks passed");
} finally {
  if (existsSync(root)) {
    Bun.spawnSync(["chmod", "-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
}
