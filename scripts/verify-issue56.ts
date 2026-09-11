import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeHandoffService } from "../src/opencode.ts";
import { createPersistence, type Persistence, type RepositoryInput, type SpecInput } from "../src/persistence.ts";
import { createPreparationService } from "../src/preparation.ts";
import { createUpdatePauseCoordinator, UPDATE_PAUSE_TIMEOUT_MS } from "../src/update-pause.ts";

const root = join(tmpdir(), `atlas-issue-56-${crypto.randomUUID()}`);
mkdirSync(root, { recursive: true, mode: 0o700 });

const waitFor = async (condition: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error(message);
};

const repository: RepositoryInput = {
  githubId: "56",
  installationId: "installation",
  organization: "Acme",
  owner: "Acme",
  name: "atlas",
  fullName: "Acme/atlas",
  htmlUrl: "https://github.com/Acme/atlas",
  description: null,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
};

const spec = (issueNumber: string): SpecInput => ({
  githubId: `spec-${issueNumber}`,
  issueNumber,
  title: `Safe pause ${issueNumber}`,
  body: "Exercise the public lifecycle boundary.",
  htmlUrl: `https://github.com/Acme/atlas/issues/${issueNumber}`,
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: null,
});

const seed = (persistence: Persistence, issueNumbers: string[]) => {
  persistence.upsertRepository(repository);
  persistence.replaceSpecs(repository.githubId, issueNumbers.map(spec));
  persistence.replacePullRequests(repository.githubId, [{
    githubId: "pr-56",
    number: "56",
    title: "Fixture parent",
    htmlUrl: "https://github.com/Acme/atlas/pull/56",
    state: "open",
    draft: false,
    mergedAt: null,
    headRef: "feature",
    headSha: "a".repeat(40),
    headRepositoryId: repository.githubId,
    baseRef: "main",
    baseSha: "b".repeat(40),
    mergeableState: "clean",
    autoMergeEnabled: false,
    mergeQueueState: "none",
    headRefExists: true,
    observedHeadSha: "a".repeat(40),
    updatedAt: null,
  }], []);
  persistence.markRefreshSuccess(repository.githubId, "access");
};

const queue = (persistence: Persistence, issueNumber: string, atlasId: string, target = false) => {
  const result = persistence.queueSession({
    atlasId,
    repositoryId: repository.githubId,
    spec: persistence.getSpec(repository.githubId, issueNumber)!,
    submissionId: crypto.randomUUID(),
    submissionOrderTime: `2026-09-12T00:00:${issueNumber.padStart(2, "0")}.000Z`,
    prompt: `Implement Spec ${issueNumber} exactly once.`,
    targetKind: target ? "standalone_parent" : "default",
    targetBranch: target ? "feature" : "main",
    target: target
      ? { kind: "standalone_parent", parentPullRequestId: "pr-56", parentPullRequestNumber: "56" }
      : { kind: "default" },
  });
  assert.equal(result.kind, "created");
};

const claim = (persistence: Persistence, atlasId: string, capacity = 10, target = false) => {
  const session = persistence.getSession(atlasId)!;
  const baseBranch = target ? "feature" : "main";
  const claimed = persistence.claimPreparation(atlasId, {
    directory: join(root, atlasId),
    baseBranch,
    baseSha: "a".repeat(40),
    workingBranch: `atlas/${atlasId}`,
    ...(target ? {
      target: { kind: "standalone_parent" as const, parentPullRequestId: "pr-56", parentPullRequestNumber: "56" },
      resolvedTarget: {
        kind: "standalone_parent" as const,
        stackId: null,
        stackNumber: null,
        parentPullRequestId: "pr-56",
        parentPullRequestNumber: "56",
        parentPullRequestUrl: "https://github.com/Acme/atlas/pull/56",
        parentBranch: baseBranch,
        trunkBranch: "main",
        layers: [{ pullRequestId: "pr-56", pullRequestNumber: "56", branch: baseBranch, sha: "a".repeat(40) }],
      },
    } : {}),
  }, capacity, true);
  assert(claimed, `Session ${session.atlasId} was not claimed`);
  return claimed;
};

const fakeCredentials = {
  start: async () => undefined,
  close: () => undefined,
  registerScope: () => undefined,
  assertReady: async () => undefined,
  helperEnvironment: () => ({
    ATLAS_SUPPLIER_SOCKET: join(root, "supplier.sock"),
    ATLAS_SUPPLIER_KEY_PATH: join(root, "supplier.key"),
  }),
} as never;

const candidate = {
  id: repository.githubId,
  owner: repository.owner,
  name: repository.name,
  fullName: repository.fullName,
  htmlUrl: repository.htmlUrl,
  description: repository.description,
  visibility: repository.visibility,
  defaultBranch: repository.defaultBranch,
  archived: repository.archived,
  disabled: repository.disabled,
  hasIssues: repository.hasIssues,
};

const fakeGithub = {
  listInstallationRepositories: async () => [candidate],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [],
  listStacks: async () => [],
  getBranchRef: async () => ({ sha: "a".repeat(40) }),
};

const fakeGit = (name: string) => {
  const directory = join(root, name);
  const binary = join(directory, "git");
  const log = join(directory, "commands.log");
  const started = join(directory, "clone-started");
  const release = join(directory, "release-clone");
  const complete = join(directory, "clone-complete");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(binary, `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const directory = args[0] === "-C" ? args[1] : undefined;
const command = args[0] === "-C" ? args[2] : args[0];
if (args.includes("clone")) {
  writeFileSync(${JSON.stringify(started)}, "started");
  while (!existsSync(${JSON.stringify(release)})) await Bun.sleep(5);
  const target = args.at(-1);
  mkdirSync(join(target, ".git"), { recursive: true, mode: 0o700 });
  writeFileSync(${JSON.stringify(complete)}, "complete");
} else if (command === "remote") {
  console.log("https://github.com/Acme/atlas.git");
} else if (command === "show-ref") {
  process.exit(1);
} else if (command === "checkout") {
  writeFileSync(join(directory, ".git", "current-branch"), args[args.indexOf("-b") + 1]);
} else if (command === "branch" && args.includes("--show-current")) {
  console.log(readFileSync(join(directory, ".git", "current-branch"), "utf8"));
} else if (command === "config" && args.includes("--get-all")) {
  console.log("atlas-git-credential");
} else if (command === "rev-parse" && args.includes("--is-shallow-repository")) {
  console.log("false");
} else if (command === "rev-parse" && args.includes("--git-path")) {
  console.log(".git/gh-stack");
} else if (command === "rev-parse") {
  console.log("${"a".repeat(40)}");
}
`, { mode: 0o700 });
  chmodSync(binary, 0o700);
  const cloneCount = () => existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter((line) => JSON.parse(line).includes("clone")).length
    : 0;
  return { binary, started, release, complete, cloneCount };
};

const quietBoundary = () => {
  let paused = false;
  return {
    pauseForUpdate: async () => { paused = true; },
    resumeFromUpdate: () => { paused = false; },
    paused: () => paused,
  };
};

const preparationService = (persistence: Persistence, gitBinary: string) => createPreparationService({
  persistence,
  github: fakeGithub,
  refreshRepository: async (saved) => ({ ok: true, repository: saved }),
  sessionRoot: root,
  minFreeBytes: 1,
  gitBinary,
  credentials: fakeCredentials,
  pollMs: 60_000,
});

const verifyPreparationDrain = async () => {
  const persistence = createPersistence({ path: join(root, "preparation.sqlite") });
  seed(persistence, ["1", "2"]);
  const firstId = `ses_${crypto.randomUUID()}`;
  const secondId = `ses_${crypto.randomUUID()}`;
  queue(persistence, "1", firstId, true);
  claim(persistence, firstId, 1, true);
  queue(persistence, "2", secondId);
  const before = [persistence.getSession(firstId)!, persistence.getSession(secondId)!];
  const git = fakeGit("git-drain");
  const preparation = preparationService(persistence, git.binary);
  const openCode = quietBoundary();
  const coordinator = createUpdatePauseCoordinator({ preparation, openCode });

  const preparing = preparation.prepareNext();
  await waitFor(() => existsSync(git.started), "controlled clone did not start");
  const firstPause = coordinator.pause();
  assert.equal(firstPause, coordinator.pause(), "overlapping pause requests must share one outcome");
  let settled = false;
  void firstPause.then(() => { settled = true; });
  await Bun.sleep(20);
  assert.equal(settled, false, "pause must await an in-flight clone");
  writeFileSync(git.release, "release");
  const paused = await firstPause;
  await preparing;
  assert.equal(paused.status, "paused");
  assert.equal(coordinator.state(), "paused");
  assert.equal(persistence.getSession(firstId)?.preparationCheckpoint, "clone_complete");
  assert.equal(persistence.getSession(secondId)?.state, "queued");
  assert.equal(git.cloneCount(), 1);

  const afterPause = [persistence.getSession(firstId)!, persistence.getSession(secondId)!];
  for (let index = 0; index < before.length; index += 1) {
    assert.equal(afterPause[index]!.atlasId, before[index]!.atlasId);
    assert.equal(afterPause[index]!.prompt, before[index]!.prompt);
    assert.equal(afterPause[index]!.submissionOrder, before[index]!.submissionOrder);
    assert.equal(afterPause[index]!.targetKind, before[index]!.targetKind);
  }
  assert.equal(afterPause[0]!.reservationId, before[0]!.reservationId);
  assert.equal(afterPause[0]!.reservationState, "held");

  await preparation.prepareNext();
  assert.equal(git.cloneCount(), 1, "held pause must not restart preparation");
  process.env.ATLAS_ADMISSION_PAUSED = "1";
  try {
    assert.equal(paused.status === "paused" && paused.resume(), true);
    assert.equal(paused.status === "paused" && paused.resume(), false, "resume must be idempotent");
    await Bun.sleep(20);
    assert.equal(persistence.getSession(firstId)?.preparationCheckpoint, "clone_complete", "update resume must retain the operator pause");
  } finally {
    delete process.env.ATLAS_ADMISSION_PAUSED;
  }
  preparation.enqueue();
  await waitFor(() => persistence.getSession(firstId)?.preparationCheckpoint === "prepared", "clone-complete Session did not resume");
  assert.equal(git.cloneCount(), 1, "resumption must not clone twice");
  assert.equal(persistence.getSession(secondId)?.state, "queued", "queue order and capacity must remain intact");
  preparation.stop();
  persistence.close();
};

const verifyPreparationTimeout = async () => {
  const persistence = createPersistence({ path: join(root, "timeout.sqlite") });
  seed(persistence, ["3"]);
  const atlasId = `ses_${crypto.randomUUID()}`;
  queue(persistence, "3", atlasId);
  claim(persistence, atlasId);
  const git = fakeGit("git-timeout");
  const preparation = preparationService(persistence, git.binary);
  const coordinator = createUpdatePauseCoordinator({ preparation, openCode: quietBoundary(), timeoutMs: 30 });
  const preparing = preparation.prepareNext();
  await waitFor(() => existsSync(git.started), "timeout clone did not start");
  const outcome = await coordinator.pause();
  assert.deepEqual(outcome, { status: "timed_out", reason: "safe_checkpoint_timeout" });
  assert.equal(coordinator.state(), "active");
  assert.equal(existsSync(git.complete), false, "timeout must not kill or claim completion of in-flight work");
  assert.equal(persistence.getSession(atlasId)?.preparationCheckpoint, "clone_started");
  writeFileSync(git.release, "release");
  await preparing;
  assert.equal(persistence.getSession(atlasId)?.preparationCheckpoint, "prepared", "timed-out pause must resume eligible work");
  assert.equal(git.cloneCount(), 1);
  preparation.stop();
  persistence.close();
};

type RecordedRequest = { method: string; path: string; body?: Record<string, unknown> };

const sessionInfo = (id: string, directory: string) => ({
  id,
  projectID: "fixture",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory },
});

const openCodeFixture = async () => {
  const requests: RecordedRequest[] = [];
  const sessions = new Map<string, { directory: string }>();
  const messages = new Map<string, { id: string; sessionID: string; text: string }>();
  let holdPrompt = true;
  let loseNextPromptResponse = true;
  let promptStarted = false;
  let releasePrompt!: () => void;
  let promptRelease = new Promise<void>((resolve) => { releasePrompt = resolve; });
  let holdActive = false;
  let activeStarted = false;
  let releaseActive!: () => void;
  let activeRelease = Promise.resolve();
  const password = "safe-pause-fixture";
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const json = (value: unknown, status = 200) => Response.json(value, { status });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("Authorization") !== authorization) return json({ error: "unauthorized" }, 401);
      const body = request.method === "POST" ? JSON.parse(await request.text()) as Record<string, unknown> : undefined;
      requests.push({ method: request.method, path: url.pathname, ...(body ? { body } : {}) });
      if (url.pathname === "/api/health") return json({ healthy: true, version: "fixture" });
      if (url.pathname === "/api/event") {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"id":"connected","created":1,"type":"server.connected","data":{}}\n\n'));
          },
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      if (url.pathname === "/api/session" && request.method === "POST") {
        const id = String(body?.id);
        const directory = String((body?.location as { directory?: unknown } | undefined)?.directory);
        sessions.set(id, { directory });
        return json({ data: sessionInfo(id, directory) });
      }
      if (url.pathname === "/api/session/active") {
        if (holdActive) {
          activeStarted = true;
          await activeRelease;
        }
        return json({ data: {} });
      }
      const messageMatch = /^\/api\/session\/([^/]+)\/message\/([^/]+)$/.exec(url.pathname);
      if (messageMatch) {
        const message = messages.get(decodeURIComponent(messageMatch[2]!));
        return message ? json({ data: { ...message, timeCreated: 1, type: "user" } }) : json({ error: "not found" }, 404);
      }
      const match = /^\/api\/session\/([^/]+)(?:\/(prompt|permission|form|inbox))?$/.exec(url.pathname);
      if (match) {
        const id = decodeURIComponent(match[1]!);
        const saved = sessions.get(id);
        if (!saved) return json({ error: "not found" }, 404);
        if (!match[2]) return json({ data: sessionInfo(id, saved.directory) });
        if (match[2] === "prompt" && request.method === "POST") {
          const idValue = String(body?.id);
          const text = String(body?.text);
          messages.set(idValue, { id: idValue, sessionID: id, text });
          promptStarted = true;
          if (holdPrompt) await promptRelease;
          holdPrompt = false;
          if (loseNextPromptResponse) {
            loseNextPromptResponse = false;
            return json({ error: "response lost after acceptance" }, 500);
          }
          return json({ data: { id: idValue, sessionID: id, timeCreated: 1, type: "user", payload: { text } } });
        }
        if (match[2] === "inbox") {
          return json({ data: [...messages.values()].filter((message) => message.sessionID === id).map((message) => ({
            id: message.id,
            sessionID: id,
            timeCreated: 1,
            type: "user",
            payload: { text: message.text },
          })) });
        }
        return json({ data: [] });
      }
      return json({ error: "unexpected fixture route" }, 404);
    },
  });

  const serviceFile = join(root, "opencode-service.json");
  writeFileSync(serviceFile, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, pid: process.pid, password }), { mode: 0o600 });
  return {
    requests,
    sessions,
    serviceFile,
    promptStarted: () => promptStarted,
    releasePrompt,
    blockActive: () => {
      holdActive = true;
      activeStarted = false;
      activeRelease = new Promise<void>((resolve) => { releaseActive = () => { holdActive = false; resolve(); }; });
    },
    activeStarted: () => activeStarted,
    releaseActive: () => releaseActive(),
    stop: () => server.stop(true),
  };
};

const preparedSession = (persistence: Persistence, issueNumber: string) => {
  const atlasId = `ses_${crypto.randomUUID()}`;
  queue(persistence, issueNumber, atlasId);
  claim(persistence, atlasId);
  assert.equal(persistence.setPreparationCheckpoint(atlasId, "prepared", "Prepared for safe-pause regression")?.preparationCheckpoint, "prepared");
  return atlasId;
};

const completePersistedHandoff = (persistence: Persistence, atlasId: string) => {
  const intendedSessionId = `ses_${crypto.randomUUID()}`;
  const messageId = `msg_${crypto.randomUUID()}`;
  assert(persistence.setHandoffIntent(atlasId, intendedSessionId, messageId, "exact message"));
  assert(persistence.setHandoffCheckpoint(atlasId, "events_consuming", "events"));
  assert(persistence.setHandoffCheckpoint(atlasId, "create_sent", "create"));
  assert(persistence.setHandoffCreated(atlasId, intendedSessionId));
  assert(persistence.confirmHandoffAssociation(atlasId));
  assert(persistence.setHandoffCheckpoint(atlasId, "prompt_sent", "prompt"));
  assert(persistence.recordPromptAccepted(atlasId, messageId));
};

const verifyHandoffDrain = async () => {
  const fixture = await openCodeFixture();
  const persistence = createPersistence({ path: join(root, "handoff.sqlite") });
  seed(persistence, ["4", "5", "6"]);
  const firstId = preparedSession(persistence, "4");
  const service = createOpenCodeHandoffService({
    persistence,
    serviceFile: fixture.serviceFile,
    pollMs: 60_000,
    requestTimeoutMs: 1_000,
  });
  const preparation = quietBoundary();
  const coordinator = createUpdatePauseCoordinator({ preparation, openCode: service });
  const processing = service.process();
  await waitFor(fixture.promptStarted, "controlled prompt did not start");
  const pause = coordinator.pause();
  assert.equal(pause, coordinator.pause());
  let settled = false;
  void pause.then(() => { settled = true; });
  await Bun.sleep(20);
  assert.equal(settled, false, "pause must await an in-flight prompt transport");
  fixture.releasePrompt();
  await processing;
  const outcome = await pause;
  assert.equal(outcome.status, "paused");
  const uncertain = persistence.getSession(firstId)!;
  assert.equal(uncertain.handoffCheckpoint, "prompt_sent");
  assert(uncertain.handoffUncertainReason, "lost prompt response must remain uncertain");
  const creates = () => fixture.requests.filter((request) => request.method === "POST" && request.path === "/api/session");
  const prompts = () => fixture.requests.filter((request) => request.method === "POST" && request.path.endsWith("/prompt"));
  assert.equal(creates().length, 1);
  assert.equal(prompts().length, 1);

  const secondId = preparedSession(persistence, "5");
  service.enqueue();
  service.enqueue();
  await waitFor(() => persistence.getSession(firstId)?.handoffCheckpoint === "prompt_accepted", "prompt evidence did not reconcile while paused");
  assert.equal(persistence.getSession(secondId)?.handoffCheckpoint, "not_started");
  assert.equal(creates().length, 1, "held pause must block new create work");
  assert.equal(prompts().length, 1, "uncertain prompt must not be sent again");
  assert.equal(outcome.status === "paused" && outcome.resume(), true);
  assert.equal(outcome.status === "paused" && outcome.resume(), false);
  await waitFor(() => persistence.getSession(secondId)?.handoffCheckpoint === "prompt_accepted", "eligible handoff did not resume");
  assert.equal(creates().length, 2);
  assert.equal(prompts().length, 2);
  await service.process();
  assert.equal(creates().length, 2, "resumption must not recreate an OpenCode Session");
  assert.equal(prompts().length, 2, "resumption must keep the one-prompt contract");

  const thirdId = preparedSession(persistence, "6");
  completePersistedHandoff(persistence, thirdId);
  persistence.reconcileOpenCode(firstId, "running", "running fixture");
  persistence.reconcileOpenCode(secondId, "waiting", "waiting fixture");
  persistence.reconcileOpenCode(thirdId, "idle", "idle fixture");
  assert.deepEqual([firstId, secondId, thirdId].map((id) => persistence.getSession(id)?.state), ["running", "waiting", "idle"]);
  fixture.blockActive();
  const reconciling = service.process();
  await waitFor(fixture.activeStarted, "running Session reconciliation did not start");
  const executionPause = await coordinator.pause();
  assert.equal(executionPause.status, "paused", "running, Waiting, and Idle Sessions must not block safe pause");
  fixture.releaseActive();
  await reconciling;
  service.stop();
  assert.equal(executionPause.status === "paused" && executionPause.resume(), true);

  fixture.stop();
  persistence.close();
};

try {
  assert.equal(UPDATE_PAUSE_TIMEOUT_MS, 5 * 60 * 1_000);
  await verifyPreparationDrain();
  await verifyPreparationTimeout();
  await verifyHandoffDrain();
  console.log("Issue #56 safe preparation/handoff pause checks passed");
} finally {
  delete process.env.ATLAS_ADMISSION_PAUSED;
  rmSync(root, { recursive: true, force: true });
}
