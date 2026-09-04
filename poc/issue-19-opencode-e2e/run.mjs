// PROTOTYPE ONLY: issue #19 OpenCode client/server end-to-end experiment.
// This intentionally has no Atlas abstractions. Delete or rewrite it after the
// client/server assumptions are captured in the engineering plan.

import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { OpenCode } from "@opencode-ai/client";
import { Service } from "@opencode-ai/client/service";

const execFile = promisify(execFileCallback);

const POC_DIR = fileURLToPath(new URL(".", import.meta.url));
const ATLAS_DIR = resolve(POC_DIR, "../..");
const PERSISTENCE_DIR = resolve(POC_DIR, "..", "persistence");
const ARTIFACT_DIR = join(POC_DIR, "artifacts");
const SERVICE_FILE =
  process.env.OPENCODE_SERVICE_FILE ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "service.json");

const TARGET_AGENT = process.env.OPENCODE_AGENT_ID ?? "build";
const TARGET_MODEL = {
  providerID: "opencode",
  id: "muse-spark-1.3-contributor-free",
};
const REQUEST_TIMEOUT_MS = 30_000;
const EVENT_TIMEOUT_MS = 15_000;
const INTERRUPT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 5_000;

const packageManifest = JSON.parse(await readFile(join(POC_DIR, "package.json"), "utf8"));
const clientVersion = packageManifest.dependencies["@opencode-ai/client"];
const reportPath = join(
  ARTIFACT_DIR,
  `run-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}.json`,
);

const report = {
  poc: "atlas issue #19 OpenCode end-to-end client POC",
  throwaway: true,
  startedAt: new Date().toISOString(),
  launcherDirectory: ATLAS_DIR,
  pocDirectory: POC_DIR,
  clientVersion,
  expectedServerVersion: clientVersion,
  targetAgent: TARGET_AGENT,
  targetModel: TARGET_MODEL,
  serviceFile: SERVICE_FILE,
  apiBehavior: {
    client: "@opencode-ai/client Promise client",
    operations: [
      "Service.discover (then legacy service registration fallback)",
      "health.get",
      "server.get",
      "location.get",
      "agent.list",
      "event.subscribe",
      "session.create",
      "session.prompt",
      "session.wait",
      "message.list",
      "session.message",
      "session.get",
      "session.interrupt",
    ],
    endpoints: [
      "GET /api/health",
      "GET /api/server",
      "GET /api/location",
      "GET /api/agent",
      "GET /api/event (SSE)",
      "POST /api/session",
      "POST /api/session/:sessionID/prompt",
      "POST /api/session/:sessionID/wait",
      "GET /api/session/:sessionID/message",
      "GET /api/session/:sessionID/message/:messageID",
      "GET /api/session/:sessionID",
      "POST /api/session/:sessionID/interrupt",
    ],
  },
  service: {},
  authentication: {},
  persistenceDirectory: PERSISTENCE_DIR,
  runDirectory: undefined,
  sessions: [],
  events: [],
  eventCounts: {},
  checks: {},
  commands: {},
  diff: undefined,
  finalAssistantMessage: undefined,
  controlledFailure: undefined,
  interruption: undefined,
  errors: [],
  cleanup: {
    runDirectoryPreserved: false,
    sessionsPreserved: [],
    launcherUnchanged: undefined,
  },
  outcome: "running",
};

let client;
let endpoint;
let eventController;
let eventCollector;
let runDirectory;
const createdSessions = [];
const eventWaiters = [];

function truncate(value, limit = MAX_OUTPUT) {
  const text = value == null ? "" : String(value);
  return text.length > limit ? `${text.slice(0, limit)}… [truncated]` : text;
}

function errorRecord(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncate(error.message),
      reason: error.reason,
      cause: error.cause && typeof error.cause === "object" ? errorRecord(error.cause) : undefined,
    };
  }

  if (error && typeof error === "object") {
    const record = {};
    for (const [key, value] of Object.entries(error)) {
      if (key.toLowerCase().includes("password") || key.toLowerCase().includes("token")) continue;
      record[key] = typeof value === "string" ? truncate(value) : value;
    }
    return record;
  }

  return { message: truncate(error) };
}

function check(name, passed, details = {}) {
  report.checks[name] = { passed, ...details };
  if (!passed) throw new Error(`POC check failed: ${name}`);
}

async function command(file, args, cwd, timeout = REQUEST_TIMEOUT_MS) {
  const started = Date.now();
  try {
    const result = await execFile(file, args, {
      cwd,
      encoding: "utf8",
      timeout,
      maxBuffer: 1_000_000,
    });
    return {
      command: [file, ...args],
      cwd,
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    };
  } catch (error) {
    return {
      command: [file, ...args],
      cwd,
      ok: false,
      exitCode: typeof error.code === "number" ? error.code : null,
      signal: error.signal,
      timedOut: error.killed === true && error.signal === "SIGTERM",
      durationMs: Date.now() - started,
      stdout: truncate(error.stdout),
      stderr: truncate(error.stderr),
      error: errorRecord(error),
    };
  }
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function withTimeout(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function notifyEvent(event) {
  for (let index = eventWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = eventWaiters[index];
    if (!waiter.predicate(event)) continue;
    eventWaiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  }
}

function waitForEvent(predicate, milliseconds, label) {
  const existing = report.events.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolveEvent, reject) => {
    const waiter = {
      predicate,
      resolve: resolveEvent,
      reject,
      timer: setTimeout(() => {
        const index = eventWaiters.indexOf(waiter);
        if (index >= 0) eventWaiters.splice(index, 1);
        reject(new Error(`${label} not observed within ${milliseconds}ms`));
      }, milliseconds),
    };
    eventWaiters.push(waiter);
  });
}

function summarizeEvent(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const summary = {
    id: event?.id,
    created: event?.created,
    type: event?.type,
    sessionID: typeof data.sessionID === "string" ? data.sessionID : undefined,
    location: event?.location?.directory,
    dataKeys: Object.keys(data).sort(),
  };

  if (typeof data.reason === "string") summary.reason = data.reason;
  if (typeof data.status?.type === "string") summary.status = data.status.type;
  if (typeof data.delta === "string") summary.deltaLength = data.delta.length;
  if (typeof data.error === "object" && data.error !== null) summary.error = errorRecord(data.error);
  if (typeof data.command === "string") summary.command = truncate(data.command, 500);

  return summary;
}

function isRelevantEvent(event) {
  if (event?.type === "server.connected") return true;

  const data = event?.data && typeof event.data === "object" ? event.data : {};
  if (typeof data.sessionID === "string" && createdSessions.some((session) => session.id === data.sessionID)) {
    return true;
  }

  const eventDirectory =
    event?.location?.directory ??
    data.directory ??
    data.location?.directory ??
    data.info?.cwd;
  return Boolean(runDirectory && eventDirectory === runDirectory);
}

function isSessionEvent(sessionID, eventType) {
  return (event) => event.sessionID === sessionID && (!eventType || event.type === eventType);
}

async function createPersistentRunDirectory() {
  await mkdir(PERSISTENCE_DIR, { recursive: true });
  runDirectory = await realpath(
    await mkdtemp(join(PERSISTENCE_DIR, "issue-19-opencode-e2e-")),
  );
  report.persistenceDirectory = await realpath(PERSISTENCE_DIR);
  report.runDirectory = runDirectory;
  process.stdout.write(`Persistent run directory: ${runDirectory}\n`);
}

async function startEventCollector() {
  eventController = new AbortController();
  eventCollector = (async () => {
    try {
      for await (const event of client.event.subscribe({ signal: eventController.signal })) {
        if (!isRelevantEvent(event)) continue;
        const summary = summarizeEvent(event);
        report.events.push(summary);
        report.eventCounts[summary.type] = (report.eventCounts[summary.type] ?? 0) + 1;
        notifyEvent(summary);
      }
    } catch (error) {
      if (!eventController.signal.aborted) {
        report.errors.push({ stage: "event-stream", error: errorRecord(error) });
      }
    }
  })();

  const first = await waitForEvent(() => true, EVENT_TIMEOUT_MS, "first live event");
  report.checks.liveEventStream = {
    passed: true,
    firstEventType: first.type,
  };
}

async function discoverEndpoint() {
  let serviceDiscoverResult = "not-found";
  try {
    const discovered = await Service.discover({ version: clientVersion });
    if (discovered) {
      serviceDiscoverResult = "matched";
      return {
        endpoint: discovered,
        source: "@opencode-ai/client/service Service.discover",
        registrationVersion: clientVersion,
      };
    }
  } catch (error) {
    serviceDiscoverResult = "error";
    report.service.discoverError = errorRecord(error);
  }

  const raw = JSON.parse(await readFile(SERVICE_FILE, "utf8"));
  const info = raw.service ?? raw;
  if (!info.url || !info.pid) {
    throw new Error(`Service registration at ${SERVICE_FILE} has no usable url/pid (${serviceDiscoverResult})`);
  }
  if (info.version && info.version !== clientVersion) {
    throw new Error(`Service version ${info.version} does not match client ${clientVersion}`);
  }
  if (!info.password) {
    throw new Error("The configured service has no Basic Auth password; refusing an unauthenticated POC run");
  }

  return {
    endpoint: {
      url: info.url,
      auth: {
        type: "basic",
        username: "opencode",
        password: info.password,
      },
    },
    source: "legacy/local service registration fallback",
    registrationVersion: info.version,
    registrationPid: info.pid,
    serviceDiscoverResult,
  };
}

async function createThrowawayRepository() {
  const files = {
    "package.json": `${JSON.stringify(
      {
        name: "issue-19-target",
        private: true,
        type: "module",
        scripts: { test: "node verify.mjs" },
      },
      null,
      2,
    )}\n`,
    "src/greeting.mjs": `export function greeting(name) {
  return \`Hi, \${name ?? "there"}.\`;
}
`,
    "verify.mjs": `import assert from "node:assert/strict";
import { greeting } from "./src/greeting.mjs";

assert.equal(greeting("Atlas"), "Hello, Atlas!");
assert.equal(greeting(), "Hello, World!");
assert.equal(greeting(""), "Hello, World!");
assert.equal(greeting("   "), "Hello, World!");

console.log("target verification passed");
`,
    "README.md": `# Issue 19 target repository

This repository is intentionally tiny. The implementation target is
src/greeting.mjs; verify.mjs is the immutable target-project verifier.
`,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const file = join(runDirectory, relativePath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "Atlas issue #19 POC"],
    ["config", "user.email", "atlas-issue-19-poc@example.invalid"],
    ["add", "."],
    ["commit", "-m", "baseline target for issue 19 POC"],
  ]) {
    const result = await command("git", args, runDirectory);
    if (!result.ok) throw new Error(`Target repository setup failed: ${JSON.stringify(result)}`);
  }

  const sourcePath = join(runDirectory, "src/greeting.mjs");
  const verifyPath = join(runDirectory, "verify.mjs");
  const packagePath = join(runDirectory, "package.json");
  return {
    sourcePath,
    verifyPath,
    packagePath,
    baseline: {
      head: (await command("git", ["rev-parse", "HEAD"], runDirectory)).stdout.trim(),
      sourceHash: await sha256(sourcePath),
      verifyHash: await sha256(verifyPath),
      packageHash: await sha256(packagePath),
    },
  };
}

function assistantText(message) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function runHappyPath(repository) {
  const location = await client.location.get({ location: { directory: runDirectory } });
  report.checks.locationBinding = {
    passed: location.directory === runDirectory && location.project.directory === runDirectory,
    requestedDirectory: runDirectory,
    observedDirectory: location.directory,
    projectDirectory: location.project.directory,
  };
  check(
    "locationBinding",
    report.checks.locationBinding.passed,
    report.checks.locationBinding,
  );

  // Agent discovery is server/project-location scoped in this beta. The
  // configured named agents are visible at the service's default location,
  // while a fresh external project can legitimately return an empty list.
  const agents = await client.agent.list();
  const namedAgent = agents.data.find((agent) => agent.id === TARGET_AGENT);
  check("namedAgentAvailable", Boolean(namedAgent), {
    requestedAgent: TARGET_AGENT,
    availableAgents: agents.data.map((agent) => agent.id),
    discoveryLocation: agents.location.directory,
  });

  const sessionStarted = Date.now();
  const session = await client.session.create({
    title: "Atlas issue #19 POC happy path",
    agent: TARGET_AGENT,
    model: TARGET_MODEL,
    location: { directory: runDirectory },
  });
  createdSessions.push({ id: session.id, kind: "happy" });
  report.sessions.push({
    id: session.id,
    kind: "happy",
    createdAt: new Date().toISOString(),
    requestedDirectory: runDirectory,
    observedDirectory: session.location.directory,
    requestedAgent: TARGET_AGENT,
    observedAgent: session.agent,
    requestedModel: TARGET_MODEL,
    observedModel: session.model,
  });
  check("sessionDirectoryBinding", session.location.directory === runDirectory, {
    sessionID: session.id,
    requestedDirectory: runDirectory,
    observedDirectory: session.location.directory,
  });
  check("sessionAgentBinding", session.agent === TARGET_AGENT, {
    sessionID: session.id,
    requestedAgent: TARGET_AGENT,
    observedAgent: session.agent,
  });
  check(
    "sessionModelBinding",
    session.model?.providerID === TARGET_MODEL.providerID && session.model?.id === TARGET_MODEL.id,
    {
      sessionID: session.id,
      requestedModel: TARGET_MODEL,
      observedModel: session.model,
    },
  );

  const spec = `Inspect this tiny repository and implement this bounded spec.

Change only src/greeting.mjs. Make its exported greeting(name) function return
"Hello, <name>!" for a non-blank name. When name is missing or blank, use
"World". Preserve the existing ESM export.

Do not change verify.mjs, package.json, README.md, or any other file. Run the
target project's verification command exactly as \`npm test\` after making the
change. Do not ask a question; complete the work autonomously. In your final
response, summarize the change and the verification result.`;

  const promptStarted = Date.now();
  const prompt = await client.session.prompt(
    { sessionID: session.id, text: spec },
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  report.checks.promptSubmission = {
    passed: true,
    durationMs: Date.now() - promptStarted,
    inboxID: prompt.id,
    delivery: prompt.delivery,
  };

  const waitStarted = Date.now();
  await client.session.wait(
    { sessionID: session.id },
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  report.checks.sessionWait = {
    passed: true,
    durationMs: Date.now() - waitStarted,
  };

  let terminalEvent;
  try {
    terminalEvent = await waitForEvent(
      (event) =>
        isSessionEvent(session.id)(event) &&
        [
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
        ].includes(event.type),
      EVENT_TIMEOUT_MS,
      "happy-path terminal execution event",
    );
  } catch (error) {
    report.errors.push({ stage: "happy-path-terminal-event", error: errorRecord(error) });
  }

  const current = await client.session.get({ sessionID: session.id });
  const messages = await client.message.list({ sessionID: session.id, order: "asc" });
  const assistants = messages.data.filter((message) => message.type === "assistant");
  const finalAssistant = assistants.at(-1);
  if (!finalAssistant) throw new Error("No assistant message was returned after session.wait");
  const retrievedAssistant = await client.session.message({
    sessionID: session.id,
    messageID: finalAssistant.id,
  });

  report.sessions[report.sessions.length - 1].durationMs = Date.now() - sessionStarted;
  report.sessions[report.sessions.length - 1].outcome = current.outcome;
  report.sessions[report.sessions.length - 1].messageCount = messages.data.length;
  report.finalAssistantMessage = {
    id: retrievedAssistant.id,
    agent: retrievedAssistant.agent,
    finish: retrievedAssistant.finish,
    text: truncate(assistantText(retrievedAssistant)),
  };

  check(
    "completionDetected",
    terminalEvent?.type === "session.execution.succeeded" && current.outcome === "succeeded",
    {
      waitReturned: true,
      terminalEventType: terminalEvent?.type,
      successEventObserved: terminalEvent?.type === "session.execution.succeeded",
      sessionOutcome: current.outcome,
      terminalEventError: terminalEvent?.error,
    },
  );
  check("finalAssistantMessageRetrieved", retrievedAssistant.type === "assistant", {
    messageID: retrievedAssistant.id,
    finish: retrievedAssistant.finish,
  });

  return { session, current };
}

async function verifyChange(repository) {
  const sourceHash = await sha256(repository.sourcePath);
  const verifyHash = await sha256(repository.verifyPath);
  const packageHash = await sha256(repository.packagePath);
  const diff = await command("git", ["diff", "--no-ext-diff", "--no-color", "HEAD"], runDirectory);
  const status = await command("git", ["status", "--short", "--untracked-files=all"], runDirectory);
  const names = await command("git", ["diff", "--name-only", "HEAD"], runDirectory);
  const targetVerification = await command("npm", ["test"], runDirectory);

  report.commands.targetVerification = targetVerification;
  report.diff = {
    status: status.stdout.trim(),
    changedFiles: names.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    patch: diff.stdout,
  };

  check("sourceChanged", sourceHash !== repository.baseline.sourceHash, {
    before: repository.baseline.sourceHash,
    after: sourceHash,
  });
  check("immutableVerifierPreserved", verifyHash === repository.baseline.verifyHash, {
    before: repository.baseline.verifyHash,
    after: verifyHash,
  });
  check("immutablePackagePreserved", packageHash === repository.baseline.packageHash, {
    before: repository.baseline.packageHash,
    after: packageHash,
  });
  check("onlyExpectedFileChanged", report.diff.changedFiles.length === 1 && report.diff.changedFiles[0] === "src/greeting.mjs", {
    changedFiles: report.diff.changedFiles,
  });
  check("targetVerificationPassed", targetVerification.ok, {
    command: targetVerification.command,
    exitCode: targetVerification.exitCode,
    stdout: targetVerification.stdout,
    stderr: targetVerification.stderr,
  });

  const module = await import(`${pathToFileURL(repository.sourcePath).href}?poc=${randomUUID()}`);
  const cases = [
    ["Atlas", "Hello, Atlas!"],
    [undefined, "Hello, World!"],
    ["", "Hello, World!"],
    ["   ", "Hello, World!"],
  ];
  const observed = cases.map(([input, expected]) => ({
    input: input ?? "<missing>",
    expected,
    actual: module.greeting(input),
  }));
  const independentPassed = observed.every((item) => item.actual === item.expected);
  check("independentBehaviorVerification", independentPassed, { cases: observed });
  report.checks.independentBehaviorVerification = {
    ...report.checks.independentBehaviorVerification,
    verifier: "launcher-side dynamic import and assertions, separate from target verify.mjs",
  };
}

async function runControlledFailureProbe() {
  const missingSessionID = `ses_issue19_missing_${randomUUID()}`;
  let caught;
  try {
    await client.session.get(
      { sessionID: missingSessionID },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  } catch (error) {
    caught = error;
  }

  report.controlledFailure = {
    operation: "session.get",
    sessionID: missingSessionID,
    expected: "declared 404 SessionNotFoundError",
    observedError: caught ? errorRecord(caught) : undefined,
    passed: Boolean(caught),
  };
  check("controlledFailureProbe", Boolean(caught), report.controlledFailure);
}

async function runControlledInterruptionProbe() {
  const session = await client.session.create({
    title: "Atlas issue #19 POC interruption probe",
    agent: TARGET_AGENT,
    model: TARGET_MODEL,
    location: { directory: runDirectory },
  });
  createdSessions.push({ id: session.id, kind: "interruption" });
  const sessionRecord = {
    id: session.id,
    kind: "interruption",
    requestedDirectory: runDirectory,
    observedDirectory: session.location.directory,
    requestedModel: TARGET_MODEL,
    observedModel: session.model,
    promptAccepted: false,
    interruptRequested: false,
  };
  report.sessions.push(sessionRecord);

  const promptPromise = client.session.prompt(
    {
      sessionID: session.id,
      text: "Controlled interruption probe. Do not modify any files. Run exactly `sleep 30` with your shell, then summarize. Do not ask a question.",
    },
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  try {
    await waitForEvent(
      isSessionEvent(session.id, "session.execution.started"),
      INTERRUPT_TIMEOUT_MS,
      "interruption execution start event",
    );
    sessionRecord.executionStarted = true;
  } catch (error) {
    sessionRecord.executionStartError = errorRecord(error);
  }

  try {
    sessionRecord.interruptResponse = await client.session.interrupt(
      { sessionID: session.id },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    sessionRecord.interruptRequested = true;
    sessionRecord.interrupted = sessionRecord.interruptResponse?.interrupted;
  } catch (error) {
    sessionRecord.interruptError = errorRecord(error);
  }

  try {
    const accepted = await withTimeout(promptPromise, REQUEST_TIMEOUT_MS, "interruption prompt");
    sessionRecord.promptAccepted = true;
    sessionRecord.promptInboxID = accepted.id;
  } catch (error) {
    sessionRecord.promptError = errorRecord(error);
  }

  try {
    await client.session.wait(
      { sessionID: session.id },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    sessionRecord.waitReturned = true;
  } catch (error) {
    sessionRecord.waitError = errorRecord(error);
  }

  const current = await client.session.get({ sessionID: session.id }).catch((error) => ({ error: errorRecord(error) }));
  sessionRecord.outcome = current.outcome;
  sessionRecord.interruptedEventObserved = report.events.some(
    isSessionEvent(session.id, "session.execution.interrupted"),
  );
  report.interruption = {
    ...sessionRecord,
    note:
      "The deterministic missing-session probe is the required failure path. This interrupt is best-effort because the model may finish before the interrupt reaches the server.",
  };
}

async function cleanup() {
  if (eventController) eventController.abort();
  if (eventCollector) await eventCollector.catch(() => undefined);

  if (runDirectory) {
    report.cleanup.runDirectoryPreserved = true;
    report.cleanup.preservedRunDirectory = runDirectory;
  }
  report.cleanup.sessionsPreserved = createdSessions;
}

async function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  report.cleanup.launcherUnchanged =
    report.cleanup.launcherStatusBefore === report.cleanup.launcherStatusAfter;
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

try {
  await createPersistentRunDirectory();

  const launcherBefore = await command("git", ["status", "--porcelain", "--untracked-files=all"], ATLAS_DIR);
  report.cleanup.launcherStatusBefore = launcherBefore.stdout;

  const discovered = await discoverEndpoint();
  endpoint = discovered.endpoint;
  report.service = {
    source: discovered.source,
    url: endpoint.url,
    registrationVersion: discovered.registrationVersion,
    registrationPid: discovered.registrationPid,
    serviceDiscoverResult: discovered.serviceDiscoverResult,
  };
  report.authentication = {
    configured: Boolean(endpoint.auth),
    source: "local OpenCode service registration consumed by Service.headers",
    scheme: endpoint.auth?.type,
    username: endpoint.auth?.username,
    passwordRecorded: false,
  };
  if (!endpoint.auth) throw new Error("Expected configured Basic Auth on the OpenCode service");

  client = OpenCode.make({
    baseUrl: endpoint.url.endsWith("/") ? endpoint.url : `${endpoint.url}/`,
    headers: Service.headers(endpoint),
  });
  await startEventCollector();

  const health = await client.health.get({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const server = await client.server.get({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  check("healthAndVersion", health.healthy === true && health.version === clientVersion, {
    healthy: health.healthy,
    serverVersion: health.version,
    expectedVersion: clientVersion,
    pid: health.pid,
  });
  report.service.health = health;
  report.service.server = server;
  if (report.service.registrationPid && report.service.registrationPid !== health.pid) {
    throw new Error(`Service registration pid ${report.service.registrationPid} differs from health pid ${health.pid}`);
  }

  const repository = await createThrowawayRepository();
  const persistencePrefix = `${report.persistenceDirectory}${sep}`;
  report.checks.runDirectoryIsolated = {
    passed:
      runDirectory !== ATLAS_DIR &&
      resolve(runDirectory) !== resolve(ATLAS_DIR) &&
      runDirectory.startsWith(persistencePrefix),
    runDirectory,
    persistenceDirectory: report.persistenceDirectory,
    launcherDirectory: ATLAS_DIR,
  };
  check("runDirectoryIsolated", report.checks.runDirectoryIsolated.passed, report.checks.runDirectoryIsolated);

  await runHappyPath(repository);
  await verifyChange(repository);
  await runControlledFailureProbe();
  await runControlledInterruptionProbe();

  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.errors.push({ stage: "main", error: errorRecord(error) });
} finally {
  await cleanup();
  const launcherAfter = await command("git", ["status", "--porcelain", "--untracked-files=all"], ATLAS_DIR);
  report.cleanup.launcherStatusAfter = launcherAfter.stdout;
  await writeReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.outcome === "passed" ? 0 : 1;
}
