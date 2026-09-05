// PROTOTYPE ONLY: issue #19 OpenCode client/server end-to-end experiment.
// This intentionally has no Atlas abstractions. Delete or rewrite it after the
// client/server assumptions are captured in the engineering plan.

import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenCode } from "@opencode-ai/client";
import { Service } from "@opencode-ai/client/service";

const execFile = promisify(execFileCallback);

const POC_DIR = fileURLToPath(new URL(".", import.meta.url));
const ATLAS_DIR = resolve(POC_DIR, "../..");
const PERSISTENCE_DIR = resolve(POC_DIR, "..", "persistence");
const RUN_DIRECTORY = resolve(PERSISTENCE_DIR, "issue-19-opencode-e2e");
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
const initialPrompt = process.argv[2];

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

async function bindTargetDirectory() {
  try {
    runDirectory = await realpath(RUN_DIRECTORY);
  } catch (error) {
    throw new Error(
      `Target directory must already exist at ${RUN_DIRECTORY}: ${errorRecord(error).message}`,
    );
  }
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
    // ponytail: accept any healthy beta service; update the SDK only when its API breaks.
    const discovered = await Service.discover();
    if (discovered) {
      serviceDiscoverResult = "matched";
      return {
        endpoint: discovered,
        source: "@opencode-ai/client/service Service.discover",
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

function assistantText(message) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function runHappyPath() {
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
    title: "OpenCode POC happy path",
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

  const promptStarted = Date.now();
  const prompt = await client.session.prompt(
    { sessionID: session.id, text: initialPrompt },
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

async function captureTargetState(label) {
  const commands = {
    gitRoot: await command("git", ["rev-parse", "--show-toplevel"], runDirectory),
    head: await command("git", ["rev-parse", "HEAD"], runDirectory),
    status: await command("git", ["status", "--short", "--untracked-files=all"], runDirectory),
    diff: await command("git", ["diff", "--no-ext-diff", "--no-color"], runDirectory),
    stagedDiff: await command("git", ["diff", "--cached", "--no-ext-diff", "--no-color"], runDirectory),
    names: await command("git", ["diff", "--name-only"], runDirectory),
    stagedNames: await command("git", ["diff", "--cached", "--name-only"], runDirectory),
  };
  report.commands[`targetState${label}`] = commands;

  const root = commands.gitRoot.stdout.trim();
  const changedFiles = [
    ...commands.names.stdout.split("\n"),
    ...commands.stagedNames.stdout.split("\n"),
  ].map((line) => line.trim()).filter(Boolean);

  return {
    gitRoot: commands.gitRoot.ok && root ? await realpath(root) : undefined,
    head: commands.head.ok ? commands.head.stdout.trim() : undefined,
    status: commands.status.stdout.trim(),
    changedFiles: [...new Set(changedFiles)],
    patch: {
      unstaged: commands.diff.stdout,
      staged: commands.stagedDiff.stdout,
    },
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
    title: "OpenCode POC interruption probe",
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
  if (!initialPrompt?.trim()) {
    throw new Error('Missing initial prompt. Usage: npm run poc "<prompt>"');
  }

  await bindTargetDirectory();

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
  check("health", health.healthy === true, {
    healthy: health.healthy,
    serverVersion: health.version,
    clientVersion,
    pid: health.pid,
  });
  report.service.health = health;
  report.service.server = server;
  if (report.service.registrationPid && report.service.registrationPid !== health.pid) {
    throw new Error(`Service registration pid ${report.service.registrationPid} differs from health pid ${health.pid}`);
  }

  const targetBefore = await captureTargetState("Before");
  report.target = {
    directory: runDirectory,
    before: targetBefore,
  };
  const persistencePrefix = `${report.persistenceDirectory}${sep}`;
  report.checks.runDirectoryIsolated = {
    passed:
      runDirectory !== ATLAS_DIR &&
      resolve(runDirectory) !== resolve(ATLAS_DIR) &&
      runDirectory.startsWith(persistencePrefix) &&
      targetBefore.gitRoot === runDirectory,
    runDirectory,
    persistenceDirectory: report.persistenceDirectory,
    launcherDirectory: ATLAS_DIR,
    gitRoot: targetBefore.gitRoot,
  };
  check("runDirectoryIsolated", report.checks.runDirectoryIsolated.passed, report.checks.runDirectoryIsolated);

  await runHappyPath();
  await runControlledFailureProbe();
  await runControlledInterruptionProbe();
  report.target.after = await captureTargetState("After");
  report.diff = {
    before: report.target.before,
    after: report.target.after,
  };

  report.outcome = "passed";
} catch (error) {
  report.outcome = "failed";
  report.errors.push({ stage: "main", error: errorRecord(error) });
} finally {
  await cleanup();
  if (runDirectory && report.target?.before && !report.target.after) {
    try {
      report.target.after = await captureTargetState("After");
      report.diff = {
        before: report.target.before,
        after: report.target.after,
      };
    } catch (error) {
      report.errors.push({ stage: "target-state-after", error: errorRecord(error) });
    }
  }
  const launcherAfter = await command("git", ["status", "--porcelain", "--untracked-files=all"], ATLAS_DIR);
  report.cleanup.launcherStatusAfter = launcherAfter.stdout;
  await writeReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.outcome === "passed" ? 0 : 1;
}
