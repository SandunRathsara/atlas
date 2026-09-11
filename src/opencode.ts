import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode-ai/client";
import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client";
import { Service } from "@opencode-ai/client/service";
import type { Endpoint } from "@opencode-ai/client/service";
import type { Persistence, Session } from "./persistence.ts";

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const EVENT_CONNECT_TIMEOUT_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const SESSION_ID_PATTERN = /^ses_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type OpenCodeOptions = {
  persistence: Persistence;
  onSlotReleased?: () => void;
  onTerminal?: (session: Session) => void | Promise<void>;
  serviceFile?: string;
  pollMs?: number;
  requestTimeoutMs?: number;
};

type EventEvidence = {
  executionStarted: boolean;
  status?: "idle" | "busy" | "retry";
  updatedAt: number;
};

const defaultServiceFile = () => join(
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
  "opencode",
  "service.json",
);

const withTimeout = async <T>(promise: Promise<T>, milliseconds: number, label: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const requestOptions = (milliseconds: number) => ({ signal: AbortSignal.timeout(milliseconds) });

const safeEndpoint = (endpoint: Endpoint): Endpoint | undefined => {
  if (!endpoint.auth || endpoint.auth.type !== "basic" || !endpoint.auth.username || !endpoint.auth.password) return undefined;
  try {
    const url = new URL(endpoint.url);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) return undefined;
  } catch {
    return undefined;
  }
  return endpoint;
};

const fallbackEndpoint = async (file: string): Promise<Endpoint | undefined> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const root = parsed as Record<string, unknown>;
  const service = root.service && typeof root.service === "object" && !Array.isArray(root.service)
    ? root.service as Record<string, unknown>
    : root;
  const endpointValue = service.endpoint && typeof service.endpoint === "object" && !Array.isArray(service.endpoint)
    ? service.endpoint as Record<string, unknown>
    : service;
  const url = typeof endpointValue.url === "string" ? endpointValue.url : undefined;
  const password = typeof endpointValue.password === "string"
    ? endpointValue.password
    : typeof service.password === "string"
      ? service.password
      : typeof root.password === "string" ? root.password : undefined;
  if (!url || !password) return undefined;

  return safeEndpoint({
    url,
    auth: { type: "basic", username: "opencode", password },
  });
};

const discoverEndpoint = async (file: string) => {
  const discovered = await Service.discover({ file }).catch(() => undefined);
  const endpoint = discovered ?? await fallbackEndpoint(file);
  return endpoint ? safeEndpoint(endpoint) : undefined;
};

const sessionId = () => `ses_${crypto.randomUUID()}`;
const messageId = () => `msg_${crypto.randomUUID()}`;

const initialMessage = (session: Session, repository: { fullName: string; htmlUrl: string }) => [
  "## Atlas handoff context",
  `Repository: ${repository.fullName}`,
  `Repository URL: ${repository.htmlUrl}`,
  `Spec: #${session.specIssueNumber}: ${session.specTitle}`,
  `Spec URL: ${session.specHtmlUrl}`,
  "",
  "### Spec body at submission",
  session.specBody,
  "",
  "### Resolved starting facts",
  `Target: ${session.targetKind === "native_stack" ? `native stack #${session.targetStackNumber ?? "unknown"}` : session.targetKind === "standalone_parent" ? `standalone parent #${session.targetParentPullRequestNumber ?? "unknown"}` : "default branch"}`,
  `Starting base branch: ${session.resolvedParentBranch ?? session.baseBranch ?? session.targetBranch}`,
  `Trunk branch: ${session.resolvedTrunkBranch ?? session.baseBranch ?? session.targetBranch}`,
  ...(session.targetKind === "native_stack" ? [`Native stack ID: ${session.resolvedStackId ?? session.targetStackId ?? "unknown"}`] : []),
  ...(session.resolvedParentPullRequestId ? [
    `Parent PR: #${session.resolvedParentPullRequestNumber ?? "unknown"}`,
    `Parent PR URL: ${session.resolvedParentPullRequestUrl ?? "unknown"}`,
    `Parent PR identity: ${session.resolvedParentPullRequestId}`,
  ] : []),
  ...(session.resolvedLayers.length > 0
    ? [`Ordered parent layers: ${session.resolvedLayers.map((layer) => `#${layer.pullRequestNumber} ${layer.branch}`).join(" → ")}`]
    : []),
  `Preparation commit: ${session.baseSha ?? "unknown"}`,
  `Working branch: ${session.workingBranch ?? "unknown"}`,
  `Session directory: ${session.directory ?? "unknown"}`,
  "The new layer is prepared locally and has not been published to GitHub.",
  "",
  "## Initial prompt",
  session.prompt,
].join("\n");

const eventData = (event: OpenCodeEvent) => {
  const value = (event as unknown as { data?: unknown }).data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
};

const eventLocation = (event: OpenCodeEvent) => {
  const location = (event as unknown as { location?: { directory?: unknown } }).location;
  return typeof location?.directory === "string" ? location.directory : undefined;
};

const eventSessionId = (event: OpenCodeEvent) => {
  const value = eventData(event).sessionID;
  return typeof value === "string" ? value : undefined;
};

const isTerminalState = (state: Session["state"]) =>
  state === "succeeded" || state === "failed" || state === "interrupted";

const terminalStateForEvent = (type: string): Extract<Session["state"], "succeeded" | "failed" | "interrupted"> | undefined => {
  if (type === "session.execution.succeeded") return "succeeded";
  if (type === "session.execution.failed") return "failed";
  if (type === "session.execution.interrupted") return "interrupted";
  return undefined;
};

export const createOpenCodeHandoffService = (options: OpenCodeOptions) => {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error("OpenCode polling interval is invalid");
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) throw new Error("OpenCode request timeout is invalid");

  const serviceFile = options.serviceFile ?? process.env.OPENCODE_SERVICE_FILE ?? defaultServiceFile();
  let client: OpenCodeClient | undefined;
  let streamController: AbortController | undefined;
  let streamReady = false;
  let retryAt = 0;
  let retryDelay = 1_000;
  let running = false;
  let pendingWake = false;
  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectionPromise: Promise<OpenCodeClient> | undefined;
  let transportState: "connected" | "stale" = "stale";
  let readinessReason: string | undefined = "OpenCode connection is not established.";
  let observedVersion: string | undefined;
  const eventListeners = new Set<(event: OpenCodeEvent) => void>();
  const transportListeners = new Set<(state: "connected" | "stale", reason?: string) => void>();
  const evidence = new Map<string, EventEvidence>();

  const notifyEvent = (event: OpenCodeEvent) => {
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch {
        // A viewer or browser stream cannot interrupt the shared observer.
      }
    }
  };

  const notifyTransport = (state: "connected" | "stale", reason?: string) => {
    for (const listener of transportListeners) {
      try {
        listener(state, reason);
      } catch {
        // A status consumer cannot interrupt connection recovery.
      }
    }
  };

  const markStaleSessions = (reason: string) => {
    try {
      for (const session of options.persistence.listOpenCodeSessions()) {
        if (session.preparationCheckpoint === "prepared" || session.handoffCheckpoint !== "not_started") {
          try {
            options.persistence.markOpenCodeStale(session.atlasId, reason);
          } catch {
            options.persistence.markUnhealthy("Atlas persistence is unavailable; OpenCode freshness could not be saved.");
          }
        }
      }
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; OpenCode reconciliation is paused.");
    }
  };

  const resetStream = (reason: string) => {
    streamReady = false;
    client = undefined;
    evidence.clear();
    readinessReason = reason;
    retryAt = Date.now() + retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    markStaleSessions(reason);
    if (transportState !== "stale") {
      transportState = "stale";
      notifyTransport("stale", reason);
    }
    scheduleReconnect();
  };

  const consumeEvents = async (
    iterator: AsyncIterator<OpenCodeEvent>,
    first: IteratorResult<OpenCodeEvent>,
    controller: AbortController,
  ) => {
    let next: IteratorResult<OpenCodeEvent>;
    try {
      next = await first;
      while (!next.done) {
        const event = next.value;
        notifyEvent(event);
        const remoteId = eventSessionId(event);
        if (remoteId) {
          const session = options.persistence.listOpenCodeSessions().find((candidate) =>
            candidate.openCodeSessionId === remoteId || candidate.opencodeIntendedSessionId === remoteId,
          );
          if (session && (!eventLocation(event) || eventLocation(event) === session.directory)) {
            const type = (event as unknown as { type?: string }).type ?? "";
            const current = evidence.get(remoteId) ?? { executionStarted: false, updatedAt: Date.now() };
            const terminal = terminalStateForEvent(type);
            if (type === "session.execution.started") current.executionStarted = true;
            if (terminal || type === "session.idle") {
              current.executionStarted = false;
              current.status = "idle";
            }
            if (type === "session.status") {
              const status = eventData(event).status;
              const statusType = status && typeof status === "object" && !Array.isArray(status)
                ? (status as Record<string, unknown>).type
                : undefined;
              if (statusType === "idle" || statusType === "busy" || statusType === "retry") current.status = statusType;
            }
            current.updatedAt = Date.now();
            evidence.set(remoteId, current);
            enqueue();
          }
        }
        next = await iterator.next();
      }
    } finally {
      if (!controller.signal.aborted && streamController === controller) {
        resetStream("OpenCode event stream disconnected; canonical reconciliation is pending.");
      }
    }
  };

  const connectClient = async () => {
    if (client && streamReady) return client;
    if (Date.now() < retryAt) throw new Error("OpenCode service retry delay is active");

    const endpoint = await discoverEndpoint(serviceFile);
    if (!endpoint) {
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      throw new Error("OpenCode service is unavailable or has invalid discovery data");
    }

    observedVersion = undefined;
    const nextClient = OpenCode.make({
      baseUrl: endpoint.url.endsWith("/") ? endpoint.url : `${endpoint.url}/`,
      headers: Service.headers(endpoint),
    });
    let health;
    try {
      health = await nextClient.health.get(requestOptions(requestTimeoutMs));
    } catch (error) {
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      throw error;
    }
    const healthValue = health as unknown as { healthy?: unknown; version?: unknown };
    if (healthValue?.healthy !== true) {
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      throw new Error("OpenCode service did not report healthy");
    }
    observedVersion = typeof healthValue.version === "string" && healthValue.version.length > 0
      ? healthValue.version
      : undefined;

    const controller = new AbortController();
    const iterator = nextClient.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]();
    let first: IteratorResult<OpenCodeEvent>;
    try {
      first = await withTimeout(iterator.next(), EVENT_CONNECT_TIMEOUT_MS, "OpenCode event subscription did not begin");
    } catch (error) {
      controller.abort();
      await iterator.return?.();
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      throw error;
    }
    if (first.done) {
      controller.abort();
      retryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      throw new Error("OpenCode event subscription ended before handoff");
    }

    client = nextClient;
    streamController = controller;
    streamReady = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    retryDelay = 1_000;
    if (transportState !== "connected") {
      transportState = "connected";
      readinessReason = undefined;
      notifyTransport("connected");
    }
    void consumeEvents(iterator, first, controller).catch(() => undefined);
    return nextClient;
  };

  const ensureClient = async () => {
    if (client && streamReady) return client;
    if (!connectionPromise) {
      connectionPromise = connectClient()
        .catch((error) => {
          readinessReason = error instanceof Error ? error.message : "OpenCode service connection failed.";
          throw error;
        })
        .finally(() => {
          connectionPromise = undefined;
        });
    }
    return connectionPromise;
  };

  const scheduleReconnect = () => {
    if (stopped || streamReady || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void ensureClient().catch(() => scheduleReconnect());
    }, Math.max(1, retryAt - Date.now()));
    reconnectTimer.unref?.();
  };

  const saveIntent = (session: Session) => {
    if (!session.directory || !session.baseSha || !session.workingBranch) return undefined;
    try {
      const repository = options.persistence.getRepository(session.repositoryId);
      if (!repository) return undefined;
      const intendedSessionId = session.opencodeIntendedSessionId ?? sessionId();
      const intendedMessageId = session.initialMessageId ?? messageId();
      if (!SESSION_ID_PATTERN.test(intendedSessionId) || !MESSAGE_ID_PATTERN.test(intendedMessageId)) return undefined;
      const exactMessage = session.exactMessage ?? initialMessage(session, repository);
      return options.persistence.setHandoffIntent(
        session.atlasId,
        intendedSessionId,
        intendedMessageId,
        exactMessage,
      );
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; the OpenCode handoff intent was not confirmed.");
      return undefined;
    }
  };

  const setHandoffCreated = (atlasId: string, opencodeSessionId: string) => {
    try {
      return options.persistence.setHandoffCreated(atlasId, opencodeSessionId);
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; the OpenCode Session association was not confirmed.");
      return undefined;
    }
  };

  const confirmHandoffAssociation = (atlasId: string) => {
    try {
      return options.persistence.confirmHandoffAssociation(atlasId);
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; the OpenCode Session association was not confirmed.");
      return undefined;
    }
  };

  const recordPromptAccepted = (atlasId: string, inboxId: string) => {
    try {
      return options.persistence.recordPromptAccepted(atlasId, inboxId);
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; the initial prompt acceptance was not confirmed.");
      return undefined;
    }
  };

  const requestSession = async (activeClient: OpenCodeClient, session: Session) => {
    const remoteId = session.openCodeSessionId ?? session.opencodeIntendedSessionId;
    if (!remoteId || !session.directory) return undefined;
    try {
      const info = await activeClient.session.get(
        { sessionID: remoteId },
        requestOptions(requestTimeoutMs),
      );
      if (info.id !== remoteId || info.location.directory !== session.directory) return undefined;
      return info;
    } catch {
      return undefined;
    }
  };

  const markUnconfirmed = (atlasId: string, reason: string) => {
    try {
      options.persistence.markHandoffUnconfirmed(atlasId, reason);
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; the uncertain OpenCode handoff remains held.");
    }
  };

  const promptEvidence = async (activeClient: OpenCodeClient, session: Session) => {
    if (!session.openCodeSessionId || !session.initialMessageId || !session.exactMessage) return undefined;
    try {
      const message = await activeClient.session.message(
        { sessionID: session.openCodeSessionId, messageID: session.initialMessageId },
        requestOptions(requestTimeoutMs),
      );
      if (message.type === "user" && message.id === session.initialMessageId && message.text === session.exactMessage) {
        return message.id;
      }
    } catch {
      // The message may still be represented in the inbox while persistence catches up.
    }

    try {
      const inbox = await activeClient.session.inbox.list(
        { sessionID: session.openCodeSessionId },
        requestOptions(requestTimeoutMs),
      );
      const match = inbox.find((item) =>
        item.type === "user" &&
        item.id === session.initialMessageId &&
        item.payload.text === session.exactMessage,
      );
      return match?.id;
    } catch {
      return undefined;
    }
  };

  const reconcileExecution = async (activeClient: OpenCodeClient, session: Session) => {
    if (!session.openCodeSessionId) return;
    try {
      const [info, active, permissions, forms] = await Promise.all([
        activeClient.session.get({ sessionID: session.openCodeSessionId }, requestOptions(requestTimeoutMs)),
        activeClient.session.active(requestOptions(requestTimeoutMs)),
        activeClient.permission.list({ sessionID: session.openCodeSessionId }, requestOptions(requestTimeoutMs)),
        activeClient.form.list({ sessionID: session.openCodeSessionId }, requestOptions(requestTimeoutMs)),
      ]);
      if (info.location.directory !== session.directory) throw new Error("OpenCode Session location changed");

      const currentEvidence = evidence.get(session.openCodeSessionId);
      const remoteActive = Object.prototype.hasOwnProperty.call(active, session.openCodeSessionId);
      const retrying = currentEvidence?.status === "retry";
      const busy = remoteActive || currentEvidence?.executionStarted === true || currentEvidence?.status === "busy";
      const nextState = info.outcome === "succeeded"
        ? "succeeded"
        : info.outcome === "failed"
          ? "failed"
          : info.outcome === "interrupted"
            ? "interrupted"
            : permissions.length > 0 || forms.length > 0 || retrying
              ? "waiting"
              : busy ? "running" : "idle";
      const reason = info.outcome
        ? `OpenCode confirmed a ${info.outcome} outcome.`
        : permissions.length > 0
          ? "OpenCode is waiting for a permission request."
          : forms.length > 0
            ? "OpenCode is waiting for a form response."
            : retrying
              ? "OpenCode is waiting to retry after a provider error."
              : busy
                ? "OpenCode reports active execution."
                : "OpenCode is idle without a terminal outcome.";
      let reconciled: Session | undefined;
      try {
        reconciled = options.persistence.reconcileOpenCode(session.atlasId, nextState, reason);
      } catch {
        options.persistence.markUnhealthy("Atlas persistence is unavailable; the OpenCode execution state was not confirmed.");
        return undefined;
      }
      if (isTerminalState(nextState)) {
        options.onSlotReleased?.();
        const terminalSession = reconciled ?? options.persistence.getSession(session.atlasId) ?? session;
        void Promise.resolve(options.onTerminal?.(terminalSession)).catch(() => undefined);
      }
      return reconciled;
    } catch {
      try {
        options.persistence.markOpenCodeStale(
          session.atlasId,
          "OpenCode HTTP reconciliation is incomplete; the last semantic state and execution slot are retained.",
        );
      } catch {
        options.persistence.markUnhealthy("Atlas persistence is unavailable; the OpenCode reconciliation result was not saved.");
      }
      return undefined;
    }
  };

  const setHandoffCheckpoint = (
    session: Session,
    checkpoint: Parameters<Persistence["setHandoffCheckpoint"]>[1],
    reason: string,
  ) => {
    try {
      return options.persistence.setHandoffCheckpoint(session.atlasId, checkpoint, reason);
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; the OpenCode handoff checkpoint was not confirmed.");
      return undefined;
    }
  };

  const processSession = async (initial: Session, activeClient: OpenCodeClient) => {
    let session = options.persistence.getSession(initial.atlasId) ?? initial;
    if (session.preparationCheckpoint !== "prepared" && session.handoffCheckpoint === "not_started") return;
    if (process.env.ATLAS_ADMISSION_PAUSED === "1" && ["not_started", "intent_saved", "events_consuming"].includes(session.handoffCheckpoint)) return;

    if (session.handoffCheckpoint === "not_started") {
      session = saveIntent(session) ?? session;
      if (session.handoffCheckpoint === "not_started") return;
    }

    if (session.handoffCheckpoint === "intent_saved") {
      session = setHandoffCheckpoint(
        session,
        "events_consuming",
        "OpenCode event consumption is active; the directory-bound Session has not been created.",
      ) ?? session;
    }

    if (session.handoffCheckpoint === "events_consuming") {
      session = setHandoffCheckpoint(
        session,
        "create_sent",
        "OpenCode Session creation was sent once; Atlas will reconcile the saved identity instead of retrying it.",
      ) ?? session;
      if (session.handoffCheckpoint !== "create_sent" || !session.opencodeIntendedSessionId || !session.directory) return;
      try {
        const created = await activeClient.session.create({
          id: session.opencodeIntendedSessionId,
          title: `Spec #${session.specIssueNumber}: ${session.specTitle}`,
          location: { directory: session.directory },
          metadata: { atlasSessionId: session.atlasId },
        }, requestOptions(requestTimeoutMs));
        if (created.id !== session.opencodeIntendedSessionId || created.location.directory !== session.directory) throw new Error("OpenCode Session binding did not match Atlas intent");
        const confirmed = setHandoffCreated(session.atlasId, created.id);
        if (!confirmed || confirmed.handoffCheckpoint !== "create_confirmed") throw new Error("OpenCode create checkpoint could not be saved");
        session = confirmed;
      } catch {
        markUnconfirmed(
          session.atlasId,
          "OpenCode Session creation response was not durably confirmed; inspect the saved identity before any retry.",
        );
        return;
      }
    }

    if (session.handoffCheckpoint === "create_sent" || session.handoffCheckpoint === "create_confirmed") {
      const info = await requestSession(activeClient, session);
      if (!info) {
        markUnconfirmed(
          session.atlasId,
          "OpenCode Session creation or association is unconfirmed; Atlas will not create it again.",
        );
        return;
      }
      try {
        if (session.handoffCheckpoint === "create_sent") {
          const created = setHandoffCreated(session.atlasId, info.id);
          if (!created) {
            markUnconfirmed(
              session.atlasId,
              "OpenCode Session association was observed but could not be durably saved; Atlas will not prompt or create it again.",
            );
            return;
          }
          session = created;
        }
        const associated = confirmHandoffAssociation(session.atlasId);
        if (!associated) {
          markUnconfirmed(
            session.atlasId,
            "OpenCode Session association was observed but could not be durably saved; Atlas will not prompt or create it again.",
          );
          return;
        }
        session = associated;
      } catch {
        markUnconfirmed(
          session.atlasId,
          "OpenCode Session association was observed but could not be durably saved; Atlas will not prompt or create it again.",
        );
        return;
      }
    }

    if (session.handoffCheckpoint === "associated") {
      if (process.env.ATLAS_ADMISSION_PAUSED === "1") return;
      session = setHandoffCheckpoint(
        session,
        "prompt_sent",
        "The initial prompt was sent once; Atlas will reconcile message/inbox evidence instead of resending it.",
      ) ?? session;
      if (session.handoffCheckpoint !== "prompt_sent" || !session.openCodeSessionId || !session.initialMessageId || !session.exactMessage) return;
      try {
        const accepted = await activeClient.session.prompt({
          sessionID: session.openCodeSessionId,
          id: session.initialMessageId,
          text: session.exactMessage,
        }, requestOptions(requestTimeoutMs));
        if (accepted.id !== session.initialMessageId) throw new Error("OpenCode returned a different inbox identity");
        const recorded = recordPromptAccepted(session.atlasId, accepted.id);
        if (!recorded) {
          markUnconfirmed(
            session.atlasId,
            "Initial prompt acceptance was observed but could not be durably saved; Atlas will not resend the prompt.",
          );
          return;
        }
        session = recorded;
      } catch {
        markUnconfirmed(
          session.atlasId,
          "Initial prompt acceptance was not durably confirmed; Atlas will not resend the prompt.",
        );
        return;
      }
    }

    if (session.handoffCheckpoint === "prompt_sent") {
      const acceptedId = await promptEvidence(activeClient, session);
      if (!acceptedId) {
        markUnconfirmed(
          session.atlasId,
          "Initial prompt acceptance remains unconfirmed; inspect the saved message identity before any retry.",
        );
        return;
      }
      try {
        const recorded = recordPromptAccepted(session.atlasId, acceptedId);
        if (!recorded) {
          markUnconfirmed(
            session.atlasId,
            "Initial prompt evidence was found but its acceptance could not be durably saved; Atlas will not resend the prompt.",
          );
          return;
        }
        session = recorded;
      } catch {
        markUnconfirmed(
          session.atlasId,
          "Initial prompt evidence was found but its acceptance could not be durably saved; Atlas will not resend the prompt.",
        );
        return;
      }
    }

    if (session.handoffCheckpoint === "prompt_accepted") {
      await reconcileExecution(activeClient, session);
    }
  };

  const runCycle = async () => {
    let sessions: Session[];
    try {
      sessions = options.persistence.listOpenCodeSessions();
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; OpenCode reconciliation is paused.");
      return;
    }

    let activeClient: OpenCodeClient;
    try {
      activeClient = await ensureClient();
    } catch (error) {
      const reason = error instanceof Error && error.message.includes("retry delay")
        ? "OpenCode is unavailable or waiting for its retry delay; Atlas is retaining the preparation slot."
        : "OpenCode is unavailable or incompatible; launches are paused until the service is healthy.";
      markStaleSessions(reason);
      return;
    }

    if (sessions.length === 0) return;

    for (const session of sessions) {
      if (activeClient !== client || !streamReady) return;
      try {
        await processSession(session, activeClient);
      } catch {
        options.persistence.markUnhealthy("Atlas persistence is unavailable; OpenCode reconciliation is paused.");
        return;
      }
    }
  };

  const wake = () => {
    if (stopped || running) {
      if (running) pendingWake = true;
      return;
    }
    running = true;
    void runCycle().catch(() => undefined).finally(() => {
      running = false;
      if (stopped) return;
      if (pendingWake) {
        pendingWake = false;
        queueMicrotask(wake);
        return;
      }
      const now = Date.now();
      const nextDelay = retryAt > now ? retryAt - now : pollMs;
      timer = setTimeout(wake, Math.max(1, nextDelay));
      timer.unref?.();
    });
  };

  const start = () => {
    if (started) return;
    started = true;
    stopped = false;
    evidence.clear();
    markStaleSessions("OpenCode connection is being re-established; canonical reconciliation is pending.");
    wake();
  };

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    timer = undefined;
    reconnectTimer = undefined;
    streamController?.abort();
    streamController = undefined;
    streamReady = false;
    client = undefined;
    connectionPromise = undefined;
    transportState = "stale";
  };

  const enqueue = () => {
    if (running) {
      pendingWake = true;
      return;
    }
    wake();
  };

  const onEvent = (listener: (event: OpenCodeEvent) => void) => {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  };

  const onTransport = (listener: (state: "connected" | "stale", reason?: string) => void) => {
    transportListeners.add(listener);
    return () => transportListeners.delete(listener);
  };

  return {
    start,
    stop,
    enqueue,
    process: runCycle,
    getClient: ensureClient,
    isReady: () => Boolean(client && streamReady && transportState === "connected"),
    readiness: () => ({
      ready: Boolean(client && streamReady && transportState === "connected"),
      state: transportState,
      reason: readinessReason,
      version: observedVersion,
    }),
    onEvent,
    onTransport,
    transportState: () => transportState,
  };
};

type OpenCodeHandoffImplementation = ReturnType<typeof createOpenCodeHandoffService>;
export type OpenCodeHandoffService = Omit<OpenCodeHandoffImplementation, "isReady" | "readiness"> & {
  isReady?: OpenCodeHandoffImplementation["isReady"];
  readiness?: OpenCodeHandoffImplementation["readiness"];
};
