import type {
  AgentInfo,
  FormInfo,
  OpenCodeClient,
  OpenCodeEvent,
  PermissionRequest,
  SessionInfo,
  SessionInboxInfo,
  SessionMessageInfo,
  SessionStatus,
  ShellInfo,
} from "@opencode-ai/client";
import type { MessageListInput, SessionListInput } from "@opencode-ai/client";
import type { Session } from "./persistence.ts";

export const DEFAULT_VIEWER_MESSAGE_LIMIT = 40;
export const MAX_VIEWER_MESSAGE_LIMIT = 100;
const MAX_DESCENDANTS = 256;
const MAX_DESCENDANT_DEPTH = 32;
const MAX_SHELL_OUTPUT_BYTES = 64 * 1024;

export type ViewerSemanticState = "running" | "waiting" | "idle" | "succeeded" | "failed" | "interrupted";
export type ViewerFreshness = "fresh" | "stale" | "partial";

export type ViewerShell = {
  info: ShellInfo;
  output?: {
    output: string;
    cursor: number;
    size: number;
    truncated: boolean;
  };
  outputUnavailable?: boolean;
};

export type ViewerPending = {
  permissions: PermissionRequest[];
  forms: FormInfo[];
  inbox: SessionInboxInfo[];
};

export type ViewerSessionNode = {
  info: SessionInfo;
  children: ViewerSessionNode[];
  messages: SessionMessageInfo[];
  messagesLoaded: boolean;
  nextMessageCursor: string | null;
  active: boolean;
  semanticState: ViewerSemanticState;
  pending: ViewerPending;
  shells: ViewerShell[];
  agentMode?: AgentInfo["mode"];
  activeSubagent: boolean;
  unavailableReason?: string;
};

export type SessionViewerProjection = {
  available: boolean;
  atlasSessionId: string;
  root?: ViewerSessionNode;
  selected?: ViewerSessionNode;
  selectedSessionId?: string;
  freshness: ViewerFreshness;
  staleReason?: string;
  partialReasons: string[];
};

export type ViewerConnection = {
  getClient: () => Promise<OpenCodeClient>;
  onEvent?: (listener: (event: OpenCodeEvent) => void) => () => void;
  onTransport?: (listener: (state: "connected" | "stale", reason?: string) => void) => () => void;
  transportState?: () => "connected" | "stale";
};

export class ViewerScopeError extends Error {
  constructor(message = "The requested Session is not a verified descendant") {
    super(message);
    this.name = "ViewerScopeError";
  }
}

type ViewerEventData = Record<string, unknown>;

const eventData = (event: OpenCodeEvent): ViewerEventData => {
  const value = (event as unknown as { data?: unknown }).data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ViewerEventData
    : {};
};

const stringValue = (value: unknown) => typeof value === "string" ? value : undefined;

const eventLocation = (event: OpenCodeEvent) => {
  const location = (event as unknown as { location?: { directory?: unknown } }).location;
  return stringValue(location?.directory);
};

const eventSessionId = (event: OpenCodeEvent) => {
  const data = eventData(event);
  const direct = stringValue(data.sessionID);
  if (direct) return direct;
  const form = data.form;
  if (form && typeof form === "object" && !Array.isArray(form)) return stringValue((form as Record<string, unknown>).sessionID);
  const info = data.info;
  if (info && typeof info === "object" && !Array.isArray(info)) {
    const metadata = (info as Record<string, unknown>).metadata;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      return stringValue((metadata as Record<string, unknown>).sessionID);
    }
  }
  return undefined;
};

const eventRecordId = (event: OpenCodeEvent) => stringValue((event as unknown as { id?: unknown }).id);

const locationInput = (info: Pick<SessionInfo, "location">) => ({
  directory: info.location.directory,
  ...(info.location.workspaceID ? { workspace: info.location.workspaceID } : {}),
});

const errorLabel = (label: string) => `${label} is unavailable; the visible Session data may be partial.`;

const terminalState = (outcome: SessionInfo["outcome"]): ViewerSemanticState | undefined => {
  if (outcome === "succeeded" || outcome === "failed" || outcome === "interrupted") return outcome;
  return undefined;
};

const statusType = (status: SessionStatus | undefined) => status?.type;

const initialSemanticState = (
  info: SessionInfo,
  pending: ViewerPending,
  active: boolean,
): ViewerSemanticState => {
  if (pending.permissions.length > 0 || pending.forms.length > 0) return "waiting";
  if (active) return "running";
  const terminal = terminalState(info.outcome);
  return terminal ?? "idle";
};

const listPages = async <T>(
  read: (cursor?: string) => Promise<{ data: T[]; cursor?: { next?: string | null } }>,
  maxPages = MAX_DESCENDANTS,
) => {
  const result: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await read(cursor);
    result.push(...response.data);
    const next = response.cursor?.next ?? undefined;
    if (!next) return { data: result, complete: true };
    cursor = next;
  }
  return { data: result, complete: false };
};

export type ViewerEventSnapshot = {
  revision: number;
  seenEventCount: number;
  duplicateEventCount: number;
  touchedSessionIds: string[];
  touchedMessageIds: string[];
  treeInvalidated: boolean;
  pendingInvalidated: boolean;
  semanticBySession: ReadonlyMap<string, ViewerSemanticState>;
};

/**
 * Reduces only the live overlay. HTTP projections remain authoritative for
 * message content, relationships, pending records, and terminal outcomes.
 */
export const createViewerEventReducer = (rootSessionId: string, rootDirectory?: string) => {
  const seen = new Set<string>();
  const knownSessions = new Set([rootSessionId]);
  const touchedSessions = new Set<string>();
  const touchedMessages = new Set<string>();
  const semanticBySession = new Map<string, ViewerSemanticState>();
  let duplicateEventCount = 0;
  let revision = 0;
  let treeInvalidated = false;
  let pendingInvalidated = false;

  const acceptsLocation = (event: OpenCodeEvent) => {
    const location = eventLocation(event);
    return !rootDirectory || !location || location === rootDirectory;
  };

  const markSession = (sessionId: string | undefined) => {
    if (!sessionId || !knownSessions.has(sessionId)) return false;
    touchedSessions.add(sessionId);
    return true;
  };

  const apply = (event: OpenCodeEvent) => {
    const id = eventRecordId(event);
    if (id && seen.has(id)) {
      duplicateEventCount += 1;
      return false;
    }
    if (id) seen.add(id);
    if (!acceptsLocation(event)) return false;

    const type = stringValue((event as unknown as { type?: unknown }).type) ?? "";
    const data = eventData(event);
    const sessionId = eventSessionId(event);
    const parentId = stringValue(data.parentID);

    if (type === "session.created" || type === "session.forked" || type === "session.deleted") {
      if (!markSession(sessionId) && !markSession(parentId)) return false;
      if (sessionId) touchedSessions.add(sessionId);
      treeInvalidated = true;
      revision += 1;
      return true;
    }

    if (type === "shell.created" || type === "shell.exited" || type === "shell.deleted") {
      const info = data.info;
      const shell = info && typeof info === "object" && !Array.isArray(info) ? info as Record<string, unknown> : undefined;
      const metadata = shell?.metadata;
      const correlated = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? stringValue((metadata as Record<string, unknown>).sessionID)
        : undefined;
      if (!markSession(correlated)) return false;
      touchedSessions.add(correlated!);
      revision += 1;
      return true;
    }

    if (!sessionId || !knownSessions.has(sessionId)) return false;
    touchedSessions.add(sessionId);

    if (type === "permission.asked" || type === "permission.replied" || type === "form.created" || type === "form.replied" || type === "form.cancelled" || type === "session.inbox.enqueued" || type === "session.inbox.delivered" || type === "session.inbox.cancelled") {
      pendingInvalidated = true;
    }

    if (type === "session.execution.started" || type === "session.status") {
      const status = data.status && typeof data.status === "object" && !Array.isArray(data.status)
        ? data.status as SessionStatus
        : undefined;
      if (type === "session.execution.started" || statusType(status) === "busy") semanticBySession.set(sessionId, "running");
      if (statusType(status) === "retry") semanticBySession.set(sessionId, "waiting");
      if (statusType(status) === "idle") semanticBySession.set(sessionId, "idle");
    }
    if (type === "session.idle") semanticBySession.set(sessionId, "idle");
    if (type === "session.execution.succeeded" || type === "session.execution.failed" || type === "session.execution.interrupted") {
      // The event is an invalidation. Session.Info.outcome remains canonical.
      semanticBySession.delete(sessionId);
    }

    if (type.startsWith("session.message.") || type.startsWith("session.step.") || type.startsWith("session.text.") || type.startsWith("session.reasoning.") || type.startsWith("session.tool.") || type === "session.retry.scheduled" || type === "session.shell.started" || type === "session.shell.ended") {
      const messageId = stringValue(data.messageID) ?? stringValue(data.assistantMessageID);
      if (messageId) touchedMessages.add(messageId);
    }
    revision += 1;
    return true;
  };

  const addKnownSessions = (ids: Iterable<string>) => {
    for (const id of ids) knownSessions.add(id);
  };

  const snapshot = (): ViewerEventSnapshot => ({
    revision,
    seenEventCount: seen.size,
    duplicateEventCount,
    touchedSessionIds: [...touchedSessions],
    touchedMessageIds: [...touchedMessages],
    treeInvalidated,
    pendingInvalidated,
    semanticBySession: new Map(semanticBySession),
  });

  return { apply, addKnownSessions, snapshot };
};

const applyLiveOverlay = (root: ViewerSessionNode, snapshot: ViewerEventSnapshot) => {
  const visit = (node: ViewerSessionNode) => {
    const live = snapshot.semanticBySession.get(node.info.id);
    if (live === "running" || live === "waiting") node.semanticState = live;
    if (live === "idle" && !node.info.outcome) node.semanticState = live;
    for (const child of node.children) visit(child);
  };
  visit(root);
};

type BuildOptions = {
  client: OpenCodeClient;
  atlasSession: Session;
  requestedChildId?: string;
  cursor?: string;
  limit: number;
  partialReasons: string[];
  eventReducer: ReturnType<typeof createViewerEventReducer>;
};

const createViewerNode = (
  info: SessionInfo,
  activeIds: ReadonlySet<string>,
  pending: ViewerPending,
  shells: ViewerShell[],
  agentMode: AgentInfo["mode"] | undefined,
): ViewerSessionNode => ({
  info,
  children: [],
  messages: [],
  messagesLoaded: false,
  nextMessageCursor: null,
  active: activeIds.has(info.id),
  semanticState: initialSemanticState(info, pending, activeIds.has(info.id)),
  pending,
  shells,
  agentMode,
  activeSubagent: activeIds.has(info.id) && (agentMode === "subagent" || agentMode === "all"),
});

const readMessagePage = async (client: OpenCodeClient, sessionId: string, cursor: string | undefined, limit: number) => {
  const input: MessageListInput = cursor
    ? { sessionID: sessionId, cursor, limit }
    : { sessionID: sessionId, order: "asc", limit };
  return client.message.list(input);
};

const readChildren = async (client: OpenCodeClient, parentId: string, limit: number) => {
  const pages = await listPages<SessionInfo>((cursor) => {
    const input: SessionListInput = cursor
      ? { parentID: parentId, cursor, limit }
      : { parentID: parentId, order: "asc", limit };
    return client.session.list(input);
  });
  return pages;
};

const readPending = async (client: OpenCodeClient, info: SessionInfo, partialReasons: string[]): Promise<ViewerPending> => {
  const read = async <T>(label: string, operation: () => Promise<T>, fallback: T) => {
    try {
      return await operation();
    } catch {
      partialReasons.push(errorLabel(label));
      return fallback;
    }
  };
  const [permissions, forms, inbox] = await Promise.all([
    read("Pending permission requests", () => client.permission.list({ sessionID: info.id }), []),
    read("Pending forms", () => client.form.list({ sessionID: info.id }), []),
    read("Session inbox", () => client.session.inbox.list({ sessionID: info.id }), []),
  ]);
  return { permissions, forms, inbox };
};

const readShells = async (client: OpenCodeClient, info: SessionInfo, partialReasons: string[]) => {
  try {
    const response = await client.shell.list({ location: locationInput(info) });
    if (response.location.directory !== info.location.directory) {
      partialReasons.push(errorLabel("Running shell location"));
      return [];
    }

    const shells = response.data.filter((shell) => {
      const metadata = shell.metadata;
      return metadata && typeof metadata === "object" && metadata.sessionID === info.id;
    });
    return Promise.all(shells.map(async (shell): Promise<ViewerShell> => {
      try {
        const output = await client.shell.output({
          id: shell.id,
          location: locationInput(info),
          cursor: 0,
          limit: MAX_SHELL_OUTPUT_BYTES,
        });
        return { info: shell, output: output.data };
      } catch {
        return { info: shell, outputUnavailable: true };
      }
    }));
  } catch {
    partialReasons.push(errorLabel("Running shells"));
    return [];
  }
};

const readAgentMode = async (client: OpenCodeClient, info: SessionInfo, partialReasons: string[]) => {
  if (!info.agent) return undefined;
  try {
    const response = await client.agent.list({ location: locationInput(info) });
    if (response.location.directory !== info.location.directory) {
      partialReasons.push(errorLabel("Agent definition location"));
      return undefined;
    }
    return response.data.find((agent) => agent.id === info.agent || agent.name === info.agent)?.mode;
  } catch {
    partialReasons.push(errorLabel("Agent mode"));
    return undefined;
  }
};

const findNode = (root: ViewerSessionNode, id: string): ViewerSessionNode | undefined => {
  if (root.info.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
};

const buildSnapshot = async (options: BuildOptions, rootInfo: SessionInfo, activeIds: ReadonlySet<string>) => {
  const { client, atlasSession, requestedChildId, limit, partialReasons } = options;
  const seen = new Set<string>([rootInfo.id]);
  let nodeCount = 1;

  const buildTree = async (info: SessionInfo, depth: number): Promise<ViewerSessionNode> => {
    const pending = await readPending(client, info, partialReasons);
    const [shells, agentMode] = await Promise.all([
      readShells(client, info, partialReasons),
      readAgentMode(client, info, partialReasons),
    ]);
    const node = createViewerNode(info, activeIds, pending, shells, agentMode);
    options.eventReducer.addKnownSessions([info.id]);
    if (depth >= MAX_DESCENDANT_DEPTH || nodeCount >= MAX_DESCENDANTS) {
      partialReasons.push("The descendant tree is bounded; deeper child Sessions are not shown.");
      return node;
    }

    let children;
    try {
      children = await readChildren(client, info.id, limit);
      if (!children.complete) partialReasons.push("The descendant list is incomplete after the paging limit.");
    } catch {
      partialReasons.push(errorLabel("Descendant Sessions"));
      return node;
    }

    for (const child of children.data) {
      if (child.parentID !== info.id || child.location.directory !== atlasSession.directory) {
        partialReasons.push("An unverified child Session was omitted.");
        continue;
      }
      if (seen.has(child.id)) {
        partialReasons.push("A repeated child Session was omitted.");
        continue;
      }
      seen.add(child.id);
      nodeCount += 1;
      node.children.push(await buildTree(child, depth + 1));
      if (nodeCount >= MAX_DESCENDANTS) break;
    }
    return node;
  };

  const root = await buildTree(rootInfo, 0);
  const selected = requestedChildId ? findNode(root, requestedChildId) : root;
  if (!selected) throw new ViewerScopeError();

  const readMessages = async (node: ViewerSessionNode, cursor?: string) => {
    try {
      const page = await readMessagePage(client, node.info.id, cursor, limit);
      const seen = new Set<string>();
      node.messages = page.data.filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      });
      node.messagesLoaded = true;
      node.nextMessageCursor = page.cursor?.next ?? null;
    } catch {
      node.unavailableReason = errorLabel("Session messages");
      partialReasons.push(node.info.id === root.info.id ? errorLabel("Session messages") : errorLabel("Child Session messages"));
    }
  };

  await readMessages(root, selected.info.id === root.info.id ? options.cursor : undefined);
  if (selected.info.id !== root.info.id) await readMessages(selected, options.cursor);

  return { root, selected };
};

const availableProjection = (atlasSession: Session, root: ViewerSessionNode, selected: ViewerSessionNode, partialReasons: string[], staleReason?: string): SessionViewerProjection => ({
  available: true,
  atlasSessionId: atlasSession.atlasId,
  root,
  selected,
  selectedSessionId: selected.info.id,
  freshness: staleReason ? "stale" : partialReasons.length > 0 ? "partial" : "fresh",
  staleReason,
  partialReasons: [...new Set(partialReasons)],
});

export const createSessionViewerService = (connection: ViewerConnection) => {
  const MAX_RECONCILIATION_PASSES = 3;

  const hydrate = async (
    atlasSession: Session,
    options: { childId?: string; cursor?: string; limit?: number } = {},
  ): Promise<SessionViewerProjection> => {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_VIEWER_MESSAGE_LIMIT, 1), MAX_VIEWER_MESSAGE_LIMIT);
    const partialReasons: string[] = [];
    const remoteSessionId = atlasSession.openCodeSessionId;
    if (!remoteSessionId || !atlasSession.directory) {
      return {
        available: false,
        atlasSessionId: atlasSession.atlasId,
        freshness: "partial",
        partialReasons: ["OpenCode execution history is not available before the Session is associated and prepared."],
      };
    }

    const reducer = createViewerEventReducer(remoteSessionId, atlasSession.directory);
    const unsubscribeEvent = connection.onEvent?.((event) => reducer.apply(event));
    let transportStale = connection.transportState?.() === "stale";
    const unsubscribeTransport = connection.onTransport?.((state, reason) => {
      transportStale = state === "stale";
      if (reason && state === "stale") partialReasons.push(reason);
    });

    try {
      const client = await connection.getClient();
      const hydrationRevision = reducer.snapshot().revision;
      let rootInfo: SessionInfo;
      try {
        rootInfo = await client.session.get({ sessionID: remoteSessionId });
      } catch {
        return {
          available: false,
          atlasSessionId: atlasSession.atlasId,
          freshness: transportStale ? "stale" : "partial",
          staleReason: transportStale ? "OpenCode transport is disconnected; preserved Session content is not currently available." : undefined,
          partialReasons: ["OpenCode Session history is unavailable; missing resources are not treated as an empty Session."],
        };
      }
      if (rootInfo.id !== remoteSessionId || rootInfo.location.directory !== atlasSession.directory) {
        return {
          available: false,
          atlasSessionId: atlasSession.atlasId,
          freshness: "partial",
          partialReasons: ["OpenCode Session identity or location did not match the preserved Atlas Session."],
        };
      }

      const active = await client.session.active().catch(() => {
        partialReasons.push(errorLabel("Active execution"));
        return {};
      });
      const activeIds = new Set(Object.keys(active));
      let result = await buildSnapshot({
        client,
        atlasSession,
        requestedChildId: options.childId,
        cursor: options.cursor,
        limit,
        partialReasons,
        eventReducer: reducer,
      }, rootInfo, activeIds);
      let reconciliationStaleReason: string | undefined;
      let reconciliationBaseline = hydrationRevision;
      for (let pass = 0; pass < MAX_RECONCILIATION_PASSES; pass += 1) {
        const overlap = reducer.snapshot();
        if (overlap.revision <= reconciliationBaseline) break;
        reconciliationBaseline = overlap.revision;
        try {
          const refreshedRootInfo = await client.session.get({ sessionID: remoteSessionId });
          if (refreshedRootInfo.id !== remoteSessionId || refreshedRootInfo.location.directory !== atlasSession.directory) {
            throw new Error("OpenCode Session identity changed during reconciliation");
          }
          const refreshedActive = await client.session.active().catch(() => active);
          result = await buildSnapshot({
            client,
            atlasSession,
            requestedChildId: options.childId,
            cursor: options.cursor,
            limit,
            partialReasons,
            eventReducer: reducer,
          }, refreshedRootInfo, new Set(Object.keys(refreshedActive)));
        } catch (error) {
          if (error instanceof ViewerScopeError) throw error;
          reconciliationStaleReason = "Live changes overlapped canonical hydration; the last verified projection is retained until reconciliation succeeds.";
          partialReasons.push(reconciliationStaleReason);
          break;
        }
      }
      if (!reconciliationStaleReason && reducer.snapshot().revision > reconciliationBaseline) {
        reconciliationStaleReason = "Live changes continued during canonical hydration; the visible projection may be briefly behind OpenCode.";
        partialReasons.push(reconciliationStaleReason);
      }
      applyLiveOverlay(result.root, reducer.snapshot());
      const staleReason = reconciliationStaleReason ?? (transportStale ? "OpenCode transport is disconnected; this projection is retained until canonical reconciliation succeeds." : undefined);
      return availableProjection(atlasSession, result.root, result.selected, partialReasons, staleReason);
    } catch (error) {
      if (error instanceof ViewerScopeError) throw error;
      return {
        available: false,
        atlasSessionId: atlasSession.atlasId,
        freshness: transportStale ? "stale" : "partial",
        staleReason: transportStale ? "OpenCode transport is disconnected; canonical reconciliation is pending." : undefined,
        partialReasons: ["OpenCode Session hydration is incomplete; visible history is not claimed complete."],
      };
    } finally {
      unsubscribeEvent?.();
      unsubscribeTransport?.();
    }
  };

  return { hydrate };
};
