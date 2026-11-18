import "./isolate-opencode.ts";
import { strict as assert } from "node:assert";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { createOpenCodeHandoffService, openCodeClientVersion } from "../src/opencode.ts";
import { createPersistence, type Persistence, type SpecInput } from "../src/persistence.ts";

type FixtureOptions = {
  /** Raw `GET /api/info` body; OpenCode 2.3.2 does not wrap it in `{ data }`. */
  info: Record<string, unknown>;
  infoText?: string;
  infoStatus?: number;
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
// Error bodies observed from OpenCode 2.3.2.
const unauthorized = () => json({ _tag: "UnauthorizedError", message: "Authentication required" }, 401);
const sessionNotFound = (sessionID: string) => json({ _tag: "SessionNotFoundError", sessionID, message: `Session not found: ${sessionID}` }, 404);
const serverInfo = (version: string) => ({
  version,
  pid: process.pid,
  hostname: "fixture",
  urls: [],
  paths: { tmp: "/tmp/opencode" },
  capabilities: { persistentPty: true },
});
const sessionInfo = (id: string, directory: string, title: string) => ({
  id,
  projectID: "fixture",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  title,
  location: { directory },
});

type Outcome = "succeeded" | "failed" | "interrupted";

/** Controllable 2.3.2 Session-tree state for execution reconciliation scenarios. */
type RemoteTree = {
  outcomes: Map<string, Outcome>;
  active: Set<string>;
  /** Running jobs returned by `GET /api/experimental/job` (the fixture ignores the `descendants` filter). */
  jobs: Array<Record<string, unknown>>;
  inbox: Map<string, unknown[]>;
  /** Items returned by `GET /api/session/:id/permission` and `/form`. */
  permissions: Map<string, unknown[]>;
  forms: Map<string, unknown[]>;
  children: Array<{ id: string; parentID: string; directory: string }>;
  /** The latest assistant message's `retry` field, as 2.3.2 exposes it while a provider retry is scheduled. */
  retry?: { attempt: number; at: number; error: { type: string; message: string } };
  failJobs?: boolean;
  holdActive?: Promise<void>;
  activeRequested?: () => void;
};

const fixture = async (name: string, options: FixtureOptions) => {
  const requests: RecordedRequest[] = [];
  const sessions = new Map<string, { directory: string; title: string; prompts: Map<string, unknown> }>();
  const tree: RemoteTree = { outcomes: new Map(), active: new Set(), jobs: [], inbox: new Map(), permissions: new Map(), forms: new Map(), children: [] };
  // Real 2.3.2 dedupes a repeated prompt id (same item, no second user message, no second model call), but a
  // repeat after the round ended still wakes the Session for an empty execution round. Atlas must never resend.
  const promptCounts = new Map<string, number>();
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const password = "fixture-secret";
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("Authorization") !== authorization) return unauthorized();
      const body = request.method === "POST" ? JSON.parse(await request.text()) as Record<string, unknown> : undefined;
      requests.push({ method: request.method, path: url.pathname, ...(body ? { body } : {}) });

      if (url.pathname === "/api/info") {
        if (options.infoText !== undefined) return new Response(options.infoText, { headers: { "Content-Type": "application/json" } });
        return json(options.info, options.infoStatus ?? 200);
      }
      if (url.pathname === "/api/event") {
        if (options.eventContentType) return new Response("{}", { headers: { "Content-Type": options.eventContentType } });
        let own: ReadableStreamDefaultController<Uint8Array> | undefined;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            own = controller;
            streams.add(controller);
            controller.enqueue(new TextEncoder().encode('data: {"id":"evt_connected","created":1,"type":"server.connected","data":{}}\n\n'));
          },
          cancel() {
            if (own) streams.delete(own);
          },
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      if (options.malformedPaths?.includes(url.pathname)) return new Response("{", { headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/api/session" && request.method === "POST") {
        const id = String(body?.id);
        // 2.3.2 dedupes a repeated caller id: HTTP 200 with the existing Session unchanged, never 409.
        const existing = sessions.get(id);
        if (existing) return json({ data: sessionInfo(id, existing.directory, existing.title) });
        const directory = String((body?.location as { directory?: unknown } | undefined)?.directory);
        const title = String(body?.title);
        sessions.set(id, { directory, title, prompts: new Map() });
        return json({ data: sessionInfo(id, directory, title) });
      }
      if (url.pathname === "/api/session" && request.method === "GET") {
        const parentID = url.searchParams.get("parentID");
        const data = tree.children.filter((child) => child.parentID === parentID).map((child) => ({
          ...sessionInfo(child.id, child.directory, "child"),
          parentID: child.parentID,
        }));
        return json({ data, cursor: {} });
      }
      if (url.pathname === "/api/session/active") {
        tree.activeRequested?.();
        if (tree.holdActive) await tree.holdActive;
        return json({ data: Object.fromEntries([...tree.active].map((id) => [id, { type: "running" }])) });
      }
      if (url.pathname === "/api/experimental/job") {
        if (tree.failJobs) return json({ _tag: "InternalServerError", message: "fixture job failure" }, 500);
        return json({ data: tree.jobs });
      }

      const match = /^\/api\/session\/([^/]+)(?:\/(prompt|permission|form|inbox|message|message\/[^/]+))?$/.exec(url.pathname);
      if (match) {
        const id = decodeURIComponent(match[1]!);
        const saved = sessions.get(id);
        if (!saved) return sessionNotFound(id);
        if (!match[2]) {
          const outcome = tree.outcomes.get(id);
          return json({ data: { ...sessionInfo(id, saved.directory, saved.title), ...(outcome ? { outcome } : {}) } });
        }
        if (match[2] === "prompt" && request.method === "POST") {
          // 2.3.2 dedupes a repeated caller message id by returning the original inbox item.
          const promptId = String(body?.id);
          promptCounts.set(promptId, (promptCounts.get(promptId) ?? 0) + 1);
          if (!saved.prompts.has(promptId)) {
            saved.prompts.set(promptId, { id: promptId, sessionID: id, time: { created: 1 }, type: "user", payload: { text: body?.text }, delivery: "steer" });
          }
          return json({ data: saved.prompts.get(promptId) });
        }
        if (match[2] === "inbox") return json({ data: tree.inbox.get(id) ?? [] });
        if (match[2] === "permission") return json({ data: tree.permissions.get(id) ?? [] });
        if (match[2] === "form") return json({ data: tree.forms.get(id) ?? [] });
        if (match[2] === "message") {
          const data = tree.retry && url.searchParams.get("type") === "assistant"
            ? [{
              id: "msg_fixture_assistant",
              type: "assistant",
              time: { created: tree.retry.at - 2_000 },
              agent: "build",
              model: { id: "scripted", providerID: "mock" },
              content: [],
              retry: tree.retry,
            }]
            : [];
          return json({ data, cursor: {} });
        }
        if (match[2].startsWith("message/")) {
          const messageID = decodeURIComponent(match[2].slice("message/".length));
          const prompt = saved.prompts.get(messageID) as { payload: { text: unknown } } | undefined;
          if (!prompt) return json({ _tag: "MessageNotFoundError", sessionID: id, messageID, message: `Message not found: ${messageID}` }, 404);
          return json({ data: { id: messageID, time: { created: 1 }, text: prompt.payload.text, type: "user" } });
        }
        return json({ data: [] });
      }
      return json({ _tag: "NotFound", message: "unexpected fixture route" }, 404);
    },
  });
  const emit = (type: string, data: Record<string, unknown>) => {
    const line = `data: ${JSON.stringify({ id: `evt_${crypto.randomUUID()}`, created: Date.now(), type, data })}\n\n`;
    for (const controller of streams) controller.enqueue(new TextEncoder().encode(line));
  };
  const duplicatePrompts = () => [...promptCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const url = `http://127.0.0.1:${server.port}`;
  const serviceFile = join(root, `${name}.json`);
  // Primary mirrors the flat 0600 registration written by `opencode serve --service`.
  const registration = options.registration === "fallback"
    ? { service: { endpoint: { url, password: options.filePassword ?? password }, ...(options.registrationVersion !== undefined ? { version: options.registrationVersion } : {}) } }
    : {
      id: `svc_${name}`,
      url,
      pid: process.pid,
      password: options.filePassword ?? password,
      ...(options.registrationVersion !== undefined ? { version: options.registrationVersion } : {}),
    };
  await writeFile(serviceFile, JSON.stringify(registration), { mode: 0o600 });
  return { requests, serviceFile, tree, emit, duplicatePrompts, stop: () => server.stop(true) };
};

const handoff = (persistence: Persistence, serviceFile: string, hooks: { onSlotReleased?: () => void; onTerminal?: () => void } = {}) => createOpenCodeHandoffService({
  persistence,
  serviceFile,
  pollMs: 60_000,
  requestTimeoutMs: 1_000,
  ...hooks,
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

const withFixture = async (
  name: string,
  options: FixtureOptions,
  run: (context: {
    requests: RecordedRequest[];
    persistence: Persistence;
    service: ReturnType<typeof handoff>;
    remote: Awaited<ReturnType<typeof fixture>>;
    released: () => number;
    terminals: () => number;
  }) => Promise<void>,
) => {
  const remote = await fixture(name, options);
  const persistence = createPersistence({ path: ":memory:" });
  let released = 0;
  let terminals = 0;
  const service = handoff(persistence, remote.serviceFile, { onSlotReleased: () => { released += 1; }, onTerminal: () => { terminals += 1; } });
  try {
    await run({ requests: remote.requests, persistence, service, remote, released: () => released, terminals: () => terminals });
    assert.equal(remote.duplicatePrompts(), 0, `${name} must never send a prompt id twice (2.3.2 re-wakes the Session on a repeat)`);
  } finally {
    service.stop();
    remote.stop();
    persistence.close();
  }
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
  const installedClient = JSON.parse(await readFile(join(import.meta.dir, "../node_modules/@opencode/client/package.json"), "utf8")) as { name: string; version: string };
  assert.equal(installedClient.name, "@opencode/client");
  assert.equal(openCodeClientVersion, installedClient.version, "clientVersion must come from the installed client package");
  const [clientMajor, clientMinor] = installedClient.version.split(".");
  const sameLine = `${clientMajor}.${clientMinor}.999-fixture`;

  // [name, options, expected observed version, expect a version-skew warning]
  const successfulCases: Array<[string, FixtureOptions, string | undefined, boolean]> = [
    ["primary-different", {
      info: serverInfo("9.9.9-fixture"),
      registrationVersion: "9.9.9-fixture",
    }, "9.9.9-fixture", true],
    ["primary-same-line", {
      info: serverInfo(sameLine),
      registrationVersion: sameLine,
    }, sameLine, false],
    ["primary-unregistered-version", {
      info: serverInfo(installedClient.version),
    }, installedClient.version, false],
    ["primary-empty", {
      info: serverInfo(""),
      registrationVersion: "",
    }, undefined, false],
    ["fallback-absent", {
      info: { pid: process.pid },
      registration: "fallback",
    }, undefined, false],
  ];
  for (const [name, options, expectedVersion, expectWarning] of successfulCases) {
    await withFixture(name, options, async ({ requests, persistence, service }) => {
      const atlasId = `ses_${crypto.randomUUID()}`;
      preparedSession(persistence, atlasId);
      await service.process();

      assert.equal(service.isReady(), true);
      assert.equal(service.readiness().version, expectedVersion);
      const completed = persistence.getSession(atlasId)!;
      assert.equal(completed.handoffCheckpoint, "prompt_accepted");
      assert.equal(completed.openCodeSessionId, completed.opencodeIntendedSessionId);
      assert.equal(completed.initialInboxId, completed.initialMessageId);
      assert.equal(completed.state, "idle");
      assert.equal(completed.opencodeFreshness, "fresh");
      const creates = () => requests.filter((request) => request.method === "POST" && request.path === "/api/session");
      const prompts = () => requests.filter((request) => request.method === "POST" && request.path.endsWith("/prompt"));
      assert.equal(creates().length, 1);
      assert.equal(prompts().length, 1);
      assert.equal(prompts()[0]?.body?.text, completed.exactMessage);
      await service.process();
      assert.equal(creates().length, 1, `${name} must not recreate the OpenCode Session`);
      assert.equal(prompts().length, 1, `${name} must not resend the initial prompt`);

      const app = createApp({ persistence, sharedToken: "secret", github, openCode: service });
      const unauthenticated = await app.fetch(new Request("http://atlas.test/health"));
      assert.equal(unauthenticated.status, 303);
      assert(unauthenticated.headers.get("Location")?.startsWith("/login"));
      const response = await app.fetch(new Request("http://atlas.test/health", { headers: { Authorization: "Bearer secret" } }));
      assert.equal(response.status, 200);
      const body = await response.json() as { openCode: Record<string, unknown> };
      assert.equal(body.openCode.ready, true);
      assert.equal(Object.hasOwn(body.openCode, "expectedVersion"), false);
      if (expectedVersion === undefined) assert.equal(Object.hasOwn(body.openCode, "version"), false);
      else assert.equal(body.openCode.version, expectedVersion);
      assert.equal(body.openCode.clientVersion, installedClient.version, `${name} must report the installed client version`);
      if (expectWarning) {
        assert.equal(typeof body.openCode.versionWarning, "string", `${name} must warn on a major.minor mismatch`);
        assert((body.openCode.versionWarning as string).includes(expectedVersion!) && (body.openCode.versionWarning as string).includes(installedClient.version));
      } else {
        assert.equal(body.openCode.versionWarning, null, `${name} must not warn without a known major.minor mismatch`);
      }
      const activation = await app.fetch(new Request("http://atlas.test/health?activation=1", { headers: { Authorization: "Bearer secret" } }));
      assert.equal(activation.status, 200, "a version warning must not change activation health");
      assert.equal(Object.hasOwn(await activation.json() as object, "openCode"), false, "activation health must stay independent of OpenCode");
      // The warning is surfaced where OpenCode readiness already is; the update path must never consult OpenCode (ADR-0002).
      const detailPage = await (await app.fetch(new Request(`http://atlas.test/sessions/${atlasId}`, { headers: { Authorization: "Bearer secret" } }))).text();
      assert.equal(detailPage.includes("data-opencode-version-warning"), expectWarning, `${name} Session detail diagnostic notice`);
      if (expectWarning) assert(detailPage.includes("does not pause launches or affect Atlas updates") && !detailPage.includes("OpenCode launches are paused"));
      const updatesPage = await (await app.fetch(new Request("http://atlas.test/updates", { headers: { Authorization: "Bearer secret" } }))).text();
      assert.equal(updatesPage.includes("data-opencode-version-warning"), false, "the Updates page must not depend on OpenCode");
    });
  }

  await withFixture("later-decode-failure", {
    info: serverInfo("future-beta"),
    registrationVersion: "future-beta",
    malformedPaths: ["/api/session/active"],
  }, async ({ requests, persistence, service }) => {
    const atlasId = "ses_53535353-5353-4353-8353-535353535353";
    preparedSession(persistence, atlasId);
    await service.process();
    const uncertain = persistence.getSession(atlasId)!;
    assert.equal(uncertain.handoffCheckpoint, "prompt_accepted");
    assert.equal(uncertain.state, "preparing");
    assert.equal(uncertain.opencodeFreshness, "stale");
    assert.equal(uncertain.executionSlotHeld, true);
    assert.equal(requests.filter((request) => request.path.endsWith("/prompt")).length, 1);
    await service.process();
    assert.equal(requests.filter((request) => request.path.endsWith("/prompt")).length, 1, "a decoding failure must not duplicate the prompt");
    assert.equal(persistence.getSession(atlasId)?.state, "preparing", "a decoding failure must not invent a terminal outcome");
  });

  // 2.3.2 has no `healthy` flag; a server that cannot answer `/api/info` successfully is not ready.
  await withFixture("unhealthy", {
    info: { _tag: "InternalServerError", message: "fixture failure" },
    infoStatus: 500,
    registration: "fallback",
  }, async ({ requests, persistence, service }) => {
    const atlasId = "ses_54545454-5454-4454-8454-545454545454";
    preparedSession(persistence, atlasId);
    await service.process();
    const paused = persistence.getSession(atlasId)!;
    assert.equal(service.isReady(), false);
    assert.equal(paused.handoffCheckpoint, "not_started");
    assert.equal(paused.state, "preparing");
    assert.equal(paused.opencodeFreshness, "stale");
    assert.equal(paused.executionSlotHeld, true);
    assert.equal(requests.some((request) => request.method === "POST"), false);
  });

  const handedOff = async (persistence: Persistence, service: ReturnType<typeof handoff>) => {
    const atlasId = `ses_${crypto.randomUUID()}`;
    preparedSession(persistence, atlasId);
    await service.process();
    const session = persistence.getSession(atlasId)!;
    assert.equal(session.handoffCheckpoint, "prompt_accepted");
    return { atlasId, rootId: session.openCodeSessionId!, directory: session.directory! };
  };
  const observe = (persistence: Persistence, atlasId: string) => {
    const session = persistence.getSession(atlasId)!;
    return { state: session.state, reason: session.stateReason ?? "", slot: session.executionSlotHeld, freshness: session.opencodeFreshness };
  };
  const subagentJob = (sessionID: string, childSessionID: string) => ({
    kind: "subagent", id: `job_${childSessionID}`, sessionID, status: "running", time: { started: 1 }, childSessionID, agent: "general", description: "fixture child",
  });
  const settle = () => Bun.sleep(50);

  // Stable 2.x runs subagents in the background: the root's own round ends with an `outcome` while children work,
  // and each child's report re-wakes its parent. Terminal (and the slot release) must wait for the whole tree.
  await withFixture("background-subagent-tree", {
    info: serverInfo(installedClient.version),
  }, async ({ persistence, service, remote, released, terminals }) => {
    const { atlasId, rootId, directory } = await handedOff(persistence, service);
    const childId = `ses_${crypto.randomUUID()}`;
    const grandchildId = `ses_${crypto.randomUUID()}`;
    remote.tree.children.push({ id: childId, parentID: rootId, directory }, { id: grandchildId, parentID: childId, directory });

    // Root round ended (`outcome` readable, root not active) while its background child is a running job.
    remote.tree.outcomes.set(rootId, "succeeded");
    remote.tree.active = new Set([childId]);
    remote.tree.jobs = [subagentJob(rootId, childId)];
    await service.process();
    let seen = observe(persistence, atlasId);
    assert.equal(seen.state, "running", "an outcome on the root must not be terminal while a descendant job runs");
    assert.equal(seen.slot, true, "the execution slot must stay held while the tree works");
    assert.match(seen.reason, /child Sessions are still working/u);

    // A child re-woken by its own child's report is active with no running job: only verified `active()` proves it.
    remote.tree.jobs = [];
    remote.tree.active = new Set([grandchildId]);
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "running", "an active verified grandchild must keep the tree running");
    assert.equal(seen.slot, true);

    // The child report is enqueued on the root before the root becomes active again.
    remote.tree.active = new Set();
    remote.tree.inbox.set(rootId, [{ id: "msg_report", sessionID: rootId, time: { created: 1 }, type: "synthetic", payload: { text: "report" }, delivery: "queue" }]);
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "running", "undelivered root input must keep the Session running");
    assert.match(seen.reason, /undelivered input/u);

    // Root's second round: still the stale first-round outcome, but the root is active.
    remote.tree.inbox.clear();
    remote.tree.active = new Set([rootId]);
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "running");
    assert.equal(released(), 0, "no slot release before the tree is quiet");
    assert.equal(terminals(), 0);

    // An active Session that is not a verified descendant (other directory) must not hold this one open.
    const strangerId = `ses_${crypto.randomUUID()}`;
    remote.tree.children.push({ id: strangerId, parentID: childId, directory: `${directory}-elsewhere` });
    remote.tree.active = new Set([strangerId, `ses_${crypto.randomUUID()}`]);
    remote.tree.outcomes.set(rootId, "failed");
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "failed", "the final outcome is recorded once the verified tree is quiet");
    assert.equal(seen.slot, false);
    assert.match(seen.reason, /confirmed a failed outcome/u);
    assert.equal(released(), 1);
    assert.equal(terminals(), 1);
    await service.process();
    assert.equal(released(), 1, "the final outcome is recorded exactly once");
    assert.equal(terminals(), 1);
  });

  await withFixture("tree-read-failure", {
    info: serverInfo(installedClient.version),
  }, async ({ persistence, service, remote, released }) => {
    const { atlasId, rootId } = await handedOff(persistence, service);
    remote.tree.outcomes.set(rootId, "succeeded");
    remote.tree.failJobs = true;
    await service.process();
    const seen = observe(persistence, atlasId);
    assert.notEqual(seen.state, "succeeded", "an unreadable job list must not let the root outcome through");
    assert.equal(seen.freshness, "stale");
    assert.equal(seen.slot, true);
    assert.equal(released(), 0);
    remote.tree.failJobs = false;
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "succeeded");
  });

  // 2.3.2 reports provider retries only through `session.retry.scheduled` and the assistant message `retry` field.
  await withFixture("provider-retry", {
    info: serverInfo(installedClient.version),
  }, async ({ persistence, service, remote }) => {
    const { atlasId, rootId } = await handedOff(persistence, service);
    remote.tree.active = new Set([rootId]);
    remote.emit("session.execution.started", { sessionID: rootId });
    await settle();
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "running");
    const error = { type: "provider.internal", message: "upstream exploded", status: 500 };
    remote.emit("session.step.started", { sessionID: rootId, assistantMessageID: "msg_fixture_assistant" });
    remote.emit("session.retry.scheduled", { sessionID: rootId, assistantMessageID: "msg_fixture_assistant", attempt: 2, at: Date.now() + 2_000, error });
    await settle();
    await service.process();
    let seen = observe(persistence, atlasId);
    assert.equal(seen.state, "waiting", "a scheduled provider retry must surface as waiting");
    assert.match(seen.reason, /retry after a provider error \(attempt 2\): upstream exploded/u);
    remote.emit("session.step.started", { sessionID: rootId, assistantMessageID: "msg_fixture_assistant" });
    await settle();
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "waiting", "a retry attempt's step start is not progress");
    remote.emit("session.step.first-token", { sessionID: rootId, assistantMessageID: "msg_fixture_assistant" });
    await settle();
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "running", "real progress clears the retry");
  });

  // After an Atlas restart or stream reconnect the retry event is gone; the readable assistant `retry` field restores it.

  await withFixture("provider-retry-after-restart", {
    info: serverInfo(installedClient.version),
  }, async ({ persistence, service, remote }) => {
    const { atlasId, rootId } = await handedOff(persistence, service);
    remote.tree.active = new Set([rootId]);
    remote.tree.retry = { attempt: 4, at: Date.now() + 8_000, error: { type: "provider.internal", message: "upstream exploded" } };
    await service.process();
    let seen = observe(persistence, atlasId);
    assert.equal(seen.state, "waiting", "a retry readable on the assistant message must survive lost events");
    assert.match(seen.reason, /attempt 4/u);
    remote.tree.retry = undefined;
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "running");
    // An interrupt during the retry wait clears the retry and records the outcome.
    remote.tree.active = new Set();
    remote.tree.outcomes.set(rootId, "interrupted");
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "interrupted");
    assert.match(seen.reason, /confirmed an interrupted outcome/u);
  });

  // A terminal execution event racing the reads, or landing before `outcome` is readable, must not show idle.
  await withFixture("terminal-event-race", {
    info: serverInfo(installedClient.version),
  }, async ({ persistence, service, remote }) => {
    const { atlasId, rootId } = await handedOff(persistence, service);
    remote.tree.active = new Set([rootId]);
    remote.emit("session.execution.started", { sessionID: rootId });
    await settle();
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "running");

    let release!: () => void;
    let requested!: () => void;
    const activeRequested = new Promise<void>((resolve) => { requested = resolve; });
    remote.tree.holdActive = new Promise<void>((resolve) => { release = resolve; });
    remote.tree.activeRequested = () => requested();
    const reconciling = service.process();
    await activeRequested;
    await settle(); // `session.get` has answered without an outcome
    remote.emit("session.execution.succeeded", { sessionID: rootId });
    await settle();
    remote.tree.active = new Set();
    remote.tree.holdActive = undefined;
    remote.tree.activeRequested = undefined;
    release();
    await reconciling;
    let seen = observe(persistence, atlasId);
    assert.equal(seen.state, "running", "a terminal event during the reads must not be reported as idle");

    // The event is now older than the reads, but `outcome` is still not readable: keep confirming, not idle.
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "running");
    assert.match(seen.reason, /confirming the outcome/u);
    remote.tree.outcomes.set(rootId, "succeeded");
    await service.process();
    assert.equal(observe(persistence, atlasId).state, "succeeded");
  });

  // Real 2.3.2: a blocked execution keeps the root in `session.active()`, and interrupting it or restarting the
  // server clears the pending item with the round. Pending wins while live; a confirmed quiet outcome wins otherwise.
  await withFixture("pending-items", {
    info: serverInfo(installedClient.version),
  }, async ({ persistence, service, remote, released, terminals }) => {
    const { atlasId, rootId } = await handedOff(persistence, service);
    const permission = {
      id: "per_fixture", sessionID: rootId, action: "shell", resources: ["touch approved.txt"], save: ["touch *"],
      source: { type: "tool", messageID: "msg_fixture", id: "call_1" },
    };
    const form = {
      id: "frm_fixture", sessionID: rootId, title: "Questions", metadata: { kind: "question", tool: { messageID: "msg_fixture", id: "call_2" } },
      fields: [{ key: "q0", title: "Color", type: "string", options: [{ value: "Red", label: "Red" }], custom: true }],
    };

    // Root active + pending permission, even beside a stale earlier-round outcome: waiting, slot held.
    remote.tree.outcomes.set(rootId, "succeeded");
    remote.tree.active = new Set([rootId]);
    remote.tree.permissions.set(rootId, [permission]);
    await service.process();
    let seen = observe(persistence, atlasId);
    assert.equal(seen.state, "waiting", "an active root blocked on a permission must be waiting");
    assert.equal(seen.slot, true);
    assert.match(seen.reason, /permission request/u);

    remote.tree.permissions.clear();
    remote.tree.forms.set(rootId, [form]);
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "waiting", "an active root blocked on a form must be waiting");
    assert.match(seen.reason, /form response/u);
    assert.equal(released(), 0);
    assert.equal(terminals(), 0);

    // Quiet tree + confirmed outcome + a stale pending permission and form: terminal, slot released.
    remote.tree.active = new Set();
    remote.tree.outcomes.set(rootId, "interrupted");
    remote.tree.permissions.set(rootId, [permission]);
    await service.process();
    seen = observe(persistence, atlasId);
    assert.equal(seen.state, "interrupted", "a stale pending item must not hold a quiet, terminal Session in waiting");
    assert.equal(seen.slot, false);
    assert.match(seen.reason, /interrupted outcome and its Session tree is quiet/u);
    assert.equal(released(), 1);
    assert.equal(terminals(), 1);
  });

  const rejected: Array<[string, FixtureOptions]> = [
    ["undecodable-info", { info: {}, infoText: "{" }],
    ["invalid-auth", { info: serverInfo("future-beta"), registrationVersion: "future-beta", filePassword: "wrong" }],
    ["invalid-event-stream", { info: serverInfo("future-beta"), registrationVersion: "future-beta", eventContentType: "application/json" }],
  ];
  for (const [name, options] of rejected) {
    await withFixture(name, options, async ({ service }) => {
      await assert.rejects(service.getClient(), `${name} must not become ready`);
      assert.equal(service.isReady(), false);
    });
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

  {
    const persistence = createPersistence({ path: ":memory:" });
    const openCode = {
      start: () => undefined,
      stop: () => undefined,
      enqueue: () => undefined,
      process: async () => undefined,
      pauseForUpdate: async () => undefined,
      resumeFromUpdate: () => undefined,
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
    assert.equal(body.openCode.clientVersion, openCodeClientVersion);
    assert.equal(body.openCode.versionWarning, null, "an unknown server version must not warn");
    const skewed = createApp({ persistence, sharedToken: "secret", github, openCode: { ...openCode, readiness: () => ({ ready: false, state: "stale" as const, reason: "not ready", version: "99.0.0" }) } });
    const skewedResponse = await skewed.fetch(new Request("http://atlas.test/health", { headers: { Authorization: "Bearer secret" } }));
    assert.equal(skewedResponse.status, 200, "a version warning must not change the health HTTP status");
    const skewedBody = await skewedResponse.json() as { openCode: Record<string, unknown> };
    assert.equal(skewedBody.openCode.ready, false, "a version warning must not change readiness");
    assert.equal(typeof skewedBody.openCode.versionWarning, "string");
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
        "ready-version-warning": { atlas: { process: true }, persistence: { healthy: true }, openCode: { ready: true, version: "9.9.9", clientVersion: "2.3.2", versionWarning: "skew" } },
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
  assert.equal((await runHealthCheck("ready-version-warning")).exitCode, 0, "a version warning must not fail deployment health");
  assert.equal((await runHealthCheck("process")).exitCode, 1);
  assert.equal((await runHealthCheck("persistence")).exitCode, 1);
  assert.equal((await runHealthCheck("opencode")).exitCode, 1, "the normal operator health diagnostic must retain OpenCode readiness");
  deployment.stop(true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Issue #52 OpenCode runtime and health checks passed");
