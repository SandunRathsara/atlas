import { strict as assert } from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { createOpenCodeHandoffService } from "../src/opencode.ts";
import { createPersistence, type Persistence, type SpecInput } from "../src/persistence.ts";

type FixtureOptions = {
  health: unknown;
  healthText?: string;
  healthStatus?: number;
  registration?: "primary" | "fallback";
  registrationVersion?: string;
  filePassword?: string;
  eventContentType?: string;
  malformedPaths?: string[];
};

type RecordedRequest = { method: string; path: string; body?: Record<string, unknown> };

const root = join(tmpdir(), `atlas-issue-52-${crypto.randomUUID()}`);
await mkdir(root, { recursive: true, mode: 0o700 });

const json = (value: unknown, status = 200) => Response.json(value, { status });
const sessionInfo = (id: string, directory: string) => ({
  id,
  projectID: "fixture",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory },
});

const fixture = async (name: string, options: FixtureOptions) => {
  const requests: RecordedRequest[] = [];
  const sessions = new Map<string, { directory: string }>();
  const password = "fixture-secret";
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("Authorization") !== authorization) return json({ error: "unauthorized" }, 401);
      const body = request.method === "POST" ? JSON.parse(await request.text()) as Record<string, unknown> : undefined;
      requests.push({ method: request.method, path: url.pathname, ...(body ? { body } : {}) });

      if (url.pathname === "/api/health") {
        if (options.healthText !== undefined) return new Response(options.healthText, { status: options.healthStatus ?? 200, headers: { "Content-Type": "application/json" } });
        return json(options.health, options.healthStatus);
      }
      if (url.pathname === "/api/event") {
        if (options.eventContentType) return new Response("{}", { headers: { "Content-Type": options.eventContentType } });
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"id":"connected","created":1,"type":"server.connected","data":{}}\n\n'));
          },
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      if (options.malformedPaths?.includes(url.pathname)) return new Response("{", { headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/api/session" && request.method === "POST") {
        const id = String(body?.id);
        const directory = String((body?.location as { directory?: unknown } | undefined)?.directory);
        sessions.set(id, { directory });
        return json({ data: sessionInfo(id, directory) });
      }
      if (url.pathname === "/api/session/active") return json({ data: {} });

      const match = /^\/api\/session\/([^/]+)(?:\/(prompt|permission|form|inbox))?$/.exec(url.pathname);
      if (match) {
        const id = decodeURIComponent(match[1]!);
        const saved = sessions.get(id);
        if (!saved) return json({ error: "not found" }, 404);
        if (!match[2]) return json({ data: sessionInfo(id, saved.directory) });
        if (match[2] === "prompt" && request.method === "POST") {
          return json({ data: { id: body?.id, sessionID: id, timeCreated: 1, type: "user", payload: { text: body?.text }, delivery: "queue" } });
        }
        return json({ data: [] });
      }
      return json({ error: "unexpected fixture route" }, 404);
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const serviceFile = join(root, `${name}.json`);
  const registration = options.registration === "fallback"
    ? { service: { endpoint: { url, password: options.filePassword ?? password }, ...(options.registrationVersion !== undefined ? { version: options.registrationVersion } : {}) } }
    : {
      url,
      pid: process.pid,
      password: options.filePassword ?? password,
      ...(options.registrationVersion !== undefined ? { version: options.registrationVersion } : {}),
    };
  await writeFile(serviceFile, JSON.stringify(registration), { mode: 0o600 });
  return { requests, serviceFile, stop: () => server.stop(true) };
};

const handoff = (persistence: Persistence, serviceFile: string) => createOpenCodeHandoffService({
  persistence,
  serviceFile,
  pollMs: 60_000,
  requestTimeoutMs: 1_000,
});

const preparedSession = (persistence: Persistence, id: string) => {
  persistence.upsertRepository({
    githubId: "1",
    installationId: "installation",
    organization: "Org",
    owner: "Org",
    name: "repo",
    fullName: "Org/repo",
    htmlUrl: "https://github.com/Org/repo",
    description: null,
    visibility: "private",
    defaultBranch: "main",
    archived: false,
    disabled: false,
    hasIssues: true,
  });
  const spec: SpecInput = {
    githubId: "spec-52",
    issueNumber: "52",
    title: "Version-independent OpenCode",
    body: "Keep the handoff sequence intact.",
    htmlUrl: "https://github.com/Org/repo/issues/52",
    state: "open",
    labels: ["spec"],
    isPullRequest: false,
    hasSpecLabel: true,
    updatedAt: null,
  };
  persistence.replaceSpecs("1", [spec]);
  persistence.markRefreshSuccess("1", "access");
  assert.equal(persistence.queueSession({
    atlasId: id,
    repositoryId: "1",
    spec,
    submissionId: id.slice(4),
    submissionOrderTime: "2026-09-11T00:00:00.000Z",
    prompt: "Implement the Spec exactly once.",
    targetKind: "default",
    targetBranch: "main",
  }).kind, "created");
  const directory = join(root, id);
  assert(persistence.claimPreparation(id, {
    directory,
    baseBranch: "main",
    baseSha: "a".repeat(40),
    workingBranch: `atlas/${id}`,
  }, 1, true));
  assert.equal(persistence.setPreparationCheckpoint(id, "prepared", "Prepared for fixture handoff")?.preparationCheckpoint, "prepared");
};

const assertConnects = async (name: string, options: FixtureOptions, expectedVersion?: string) => {
  const remote = await fixture(name, options);
  const persistence = createPersistence({ path: ":memory:" });
  const service = handoff(persistence, remote.serviceFile);
  try {
    await service.getClient();
    assert.equal(service.isReady(), true);
    assert.equal(service.readiness().version, expectedVersion);
  } finally {
    service.stop();
    remote.stop();
    persistence.close();
  }
};

try {
  await assertConnects("primary-different", {
    health: { healthy: true, version: "9.9.9-fixture", pid: process.pid },
    registrationVersion: "9.9.9-fixture",
  }, "9.9.9-fixture");
  await assertConnects("primary-empty", {
    health: { healthy: true, version: "", pid: process.pid },
    registrationVersion: "",
  });
  await assertConnects("fallback-absent", {
    health: { healthy: true },
    registration: "fallback",
  });

  {
    const remote = await fixture("handoff-success", {
      health: { healthy: true, version: "future-beta", pid: process.pid },
      registrationVersion: "future-beta",
    });
    const persistence = createPersistence({ path: ":memory:" });
    const atlasId = "ses_52525252-5252-4252-8252-525252525252";
    preparedSession(persistence, atlasId);
    const service = handoff(persistence, remote.serviceFile);
    await service.process();
    const completed = persistence.getSession(atlasId)!;
    assert.equal(completed.handoffCheckpoint, "prompt_accepted");
    assert.equal(completed.state, "idle");
    assert.equal(completed.opencodeFreshness, "fresh");
    const creates = () => remote.requests.filter((request) => request.method === "POST" && request.path === "/api/session");
    const prompts = () => remote.requests.filter((request) => request.method === "POST" && request.path.endsWith("/prompt"));
    assert.equal(creates().length, 1);
    assert.equal(prompts().length, 1);
    assert.equal(prompts()[0]?.body?.text, completed.exactMessage);
    await service.process();
    assert.equal(creates().length, 1, "reconciliation must not recreate the OpenCode Session");
    assert.equal(prompts().length, 1, "reconciliation must not resend the initial prompt");
    service.stop();
    remote.stop();
    persistence.close();
  }

  {
    const remote = await fixture("later-decode-failure", {
      health: { healthy: true, version: "future-beta", pid: process.pid },
      registrationVersion: "future-beta",
      malformedPaths: ["/api/session/active"],
    });
    const persistence = createPersistence({ path: ":memory:" });
    const atlasId = "ses_53535353-5353-4353-8353-535353535353";
    preparedSession(persistence, atlasId);
    const service = handoff(persistence, remote.serviceFile);
    await service.process();
    const uncertain = persistence.getSession(atlasId)!;
    assert.equal(uncertain.handoffCheckpoint, "prompt_accepted");
    assert.equal(uncertain.state, "preparing");
    assert.equal(uncertain.opencodeFreshness, "stale");
    assert.equal(uncertain.executionSlotHeld, true);
    assert.equal(remote.requests.filter((request) => request.path.endsWith("/prompt")).length, 1);
    await service.process();
    assert.equal(remote.requests.filter((request) => request.path.endsWith("/prompt")).length, 1, "a decoding failure must not duplicate the prompt");
    assert.equal(persistence.getSession(atlasId)?.state, "preparing", "a decoding failure must not invent a terminal outcome");
    service.stop();
    remote.stop();
    persistence.close();
  }

  {
    const remote = await fixture("unhealthy", {
      health: { healthy: false, version: "future-beta", pid: process.pid },
      registrationVersion: "future-beta",
    });
    const persistence = createPersistence({ path: ":memory:" });
    const atlasId = "ses_54545454-5454-4454-8454-545454545454";
    preparedSession(persistence, atlasId);
    const service = handoff(persistence, remote.serviceFile);
    await service.process();
    const paused = persistence.getSession(atlasId)!;
    assert.equal(service.isReady(), false);
    assert.equal(paused.handoffCheckpoint, "not_started");
    assert.equal(paused.state, "preparing");
    assert.equal(paused.opencodeFreshness, "stale");
    assert.equal(paused.executionSlotHeld, true);
    assert.equal(remote.requests.some((request) => request.method === "POST"), false);
    service.stop();
    remote.stop();
    persistence.close();
  }

  const rejected: Array<[string, FixtureOptions]> = [
    ["undecodable-health", { health: {}, healthText: "{" }],
    ["invalid-auth", { health: { healthy: true, version: "future-beta", pid: process.pid }, registrationVersion: "future-beta", filePassword: "wrong" }],
    ["invalid-event-stream", { health: { healthy: true, version: "future-beta", pid: process.pid }, registrationVersion: "future-beta", eventContentType: "application/json" }],
  ];
  for (const [name, options] of rejected) {
    const remote = await fixture(name, options);
    const persistence = createPersistence({ path: ":memory:" });
    const service = handoff(persistence, remote.serviceFile);
    await assert.rejects(service.getClient(), `${name} must not become ready`);
    assert.equal(service.isReady(), false);
    service.stop();
    remote.stop();
    persistence.close();
  }

  {
    const serviceFile = join(root, "invalid-discovery.json");
    await writeFile(serviceFile, JSON.stringify({ url: "file:///tmp/not-http", password: "secret" }));
    const persistence = createPersistence({ path: ":memory:" });
    const service = handoff(persistence, serviceFile);
    await assert.rejects(service.getClient());
    assert.equal(service.isReady(), false);
    service.stop();
    persistence.close();
  }

  {
    const serviceFile = join(root, "unavailable.json");
    await writeFile(serviceFile, JSON.stringify({ url: "http://127.0.0.1:1", password: "secret" }));
    const persistence = createPersistence({ path: ":memory:" });
    const service = handoff(persistence, serviceFile);
    await assert.rejects(service.getClient());
    assert.equal(service.isReady(), false);
    service.stop();
    persistence.close();
  }

  const github = {
    listInstallationRepositories: async () => [],
    hasLabel: async () => true,
    listIssues: async () => [],
    listPullRequests: async () => [],
    listStacks: async () => [],
    getBranchRef: async () => null,
  };
  {
    const remote = await fixture("health-request", {
      health: { healthy: true, version: "another-version", pid: process.pid },
      registrationVersion: "another-version",
    });
    const persistence = createPersistence({ path: ":memory:" });
    const service = handoff(persistence, remote.serviceFile);
    await service.getClient();
    const app = createApp({ persistence, sharedToken: "secret", github, openCode: service });
    const unauthenticated = await app.fetch(new Request("http://atlas.test/health"));
    assert.equal(unauthenticated.status, 303);
    assert(unauthenticated.headers.get("Location")?.startsWith("/login"));
    const response = await app.fetch(new Request("http://atlas.test/health", { headers: { Authorization: "Bearer secret" } }));
    assert.equal(response.status, 200);
    const body = await response.json() as { openCode: Record<string, unknown> };
    assert.equal(body.openCode.ready, true);
    assert.equal(body.openCode.version, "another-version");
    assert.equal(Object.hasOwn(body.openCode, "expectedVersion"), false);
    persistence.close();
    service.stop();
    remote.stop();
  }

  {
    const persistence = createPersistence({ path: ":memory:" });
    const openCode = {
      start: () => undefined,
      stop: () => undefined,
      enqueue: () => undefined,
      process: async () => undefined,
      getClient: async () => { throw new Error("not ready"); },
      isReady: () => false,
      readiness: () => ({ ready: false, state: "stale" as const, reason: "not ready", version: undefined }),
      onEvent: () => () => false,
      onTransport: () => () => false,
      transportState: () => "stale" as const,
    };
    const app = createApp({ persistence, sharedToken: "secret", github, openCode });
    const response = await app.fetch(new Request("http://atlas.test/health", { headers: { Authorization: "Bearer secret" } }));
    assert.equal(response.status, 200, "OpenCode readiness must not replace persistence HTTP status");
    const body = await response.json() as { openCode: Record<string, unknown> };
    assert.equal(body.openCode.ready, false);
    assert.equal(Object.hasOwn(body.openCode, "version"), false);
    persistence.close();
    const degraded = await app.fetch(new Request("http://atlas.test/health", { headers: { Authorization: "Bearer secret" } }));
    assert.equal(degraded.status, 503, "unhealthy persistence must determine the health HTTP status");
  }

  const deployment = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("Authorization") !== "Bearer secret") return json({ error: "unauthorized" }, 401);
      const kind = new URL(request.url).pathname.slice(1);
      const responses: Record<string, unknown> = {
        ready: { atlas: { process: true }, persistence: { healthy: true }, openCode: { ready: true, version: "future-beta" } },
        "ready-no-version": { atlas: { process: true }, persistence: { healthy: true }, openCode: { ready: true } },
        process: { atlas: { process: false }, persistence: { healthy: true }, openCode: { ready: true } },
        persistence: { atlas: { process: true }, persistence: { healthy: false }, openCode: { ready: true } },
        opencode: { atlas: { process: true }, persistence: { healthy: true }, openCode: { ready: false } },
      };
      return json(responses[kind] ?? {});
    },
  });
  const runHealthCheck = async (kind: string) => {
    const child = Bun.spawn(["bash", join(import.meta.dir, "../deploy/check-health.sh")], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, ATLAS_SHARED_TOKEN: "secret", ATLAS_HEALTH_URL: `http://127.0.0.1:${deployment.port}/${kind}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    const exitCode = await child.exited;
    return { exitCode, stdout: await stdout, stderr: await stderr };
  };
  assert.equal((await runHealthCheck("ready")).exitCode, 0);
  assert.equal((await runHealthCheck("ready-no-version")).exitCode, 0, "deployment health must not require a non-empty version");
  assert.equal((await runHealthCheck("process")).exitCode, 1);
  assert.equal((await runHealthCheck("persistence")).exitCode, 1);
  assert.equal((await runHealthCheck("opencode")).exitCode, 3);
  deployment.stop(true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Issue #52 OpenCode runtime and health checks passed");
