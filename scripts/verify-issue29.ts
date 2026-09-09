import type { OpenCodeClient, OpenCodeEvent, SessionInfo, SessionMessageInfo } from "@opencode-ai/client";
import { strict as assert } from "node:assert";
import { createApp } from "../src/app.ts";
import { createPersistence } from "../src/persistence.ts";
import { createSessionViewerService, createViewerEventReducer } from "../src/session-viewer.ts";
import { renderSessionViewerFragment } from "../src/views.ts";
import type { Session } from "../src/persistence.ts";

const rootId = "ses_00000000-0000-4000-8000-000000000001";
const childId = "ses_f88fe2fc2ffeWcFJ6sdnIVMBRB";
const directory = "/var/lib/atlas/sessions/test";

const info = (id: string, parentID?: string): SessionInfo => ({
  id,
  ...(parentID ? { parentID } : {}),
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory },
  ...(id === childId ? { agent: "subagent" } : {}),
});

const messages = (id: string): SessionMessageInfo[] => id === rootId
  ? [{ id: "msg_root", time: { created: 1 }, type: "assistant", agent: "build", model: { id: "model", providerID: "provider" }, content: [
    { type: "text", text: "root" },
    { type: "reasoning", text: "old reasoning" },
    { type: "tool", id: "tool_root", name: "run", time: { created: 1 }, state: { status: "streaming", input: "{" } },
  ] }]
  : [{ id: "msg_child", time: { created: 2 }, type: "assistant", agent: "subagent", model: { id: "model", providerID: "provider" }, content: [{ type: "text", text: "child" }] }];

const atlasSession = {
  atlasId: "ses_11111111-1111-4111-8111-111111111111",
  repositoryId: "1",
  specGithubId: "spec",
  specIssueNumber: "1",
  specTitle: "Spec",
  specBody: "Body",
  specHtmlUrl: "https://example.test/spec",
  submissionId: "11111111-1111-4111-8111-111111111111",
  submissionOrder: 1,
  submittedAt: new Date(1).toISOString(),
  prompt: "prompt",
  targetKind: "default",
  targetBranch: "main",
  originalTargetBranch: "main",
  targetStackId: null,
  targetStackNumber: null,
  targetParentPullRequestId: null,
  targetParentPullRequestNumber: null,
  originalTargetKind: "default",
  originalTargetStackId: null,
  originalTargetStackNumber: null,
  originalTargetParentPullRequestId: null,
  originalTargetParentPullRequestNumber: null,
  resolvedStackId: null,
  resolvedStackNumber: null,
  resolvedParentPullRequestId: null,
  resolvedParentPullRequestNumber: null,
  resolvedParentPullRequestUrl: null,
  resolvedParentBranch: null,
  resolvedTrunkBranch: null,
  resolvedLayers: [],
  state: "running",
  stateReason: null,
  directory,
  baseBranch: "main",
  baseSha: "sha",
  workingBranch: "atlas/test",
  resultPullRequestId: null,
  resultPullRequestNumber: null,
  resultPullRequestUrl: null,
  publicationStatus: "not_observed",
  publicationReason: null,
  publicationObservedAt: null,
  preparationCheckpoint: "prepared",
  preparationReason: null,
  preparedAt: new Date(1).toISOString(),
  handoffCheckpoint: "prompt_accepted",
  opencodeIntendedSessionId: rootId,
  openCodeSessionId: rootId,
  initialMessageId: "msg_initial",
  initialInboxId: "inbox",
  exactMessage: "exact",
  handoffUncertainReason: null,
  opencodeFreshness: "fresh",
  opencodeLastSuccessAt: new Date(2).toISOString(),
  opencodeLastFailureAt: null,
  executionSlotHeld: true,
  reservationId: null,
  reservationState: null,
  reservationReason: null,
  updatedAt: new Date(2).toISOString(),
} satisfies Session;

const messageInputs: Record<string, unknown>[] = [];
let rootGets = 0;
let eventListener: ((event: OpenCodeEvent) => void) | undefined;
const client = {
  session: {
    get: async ({ sessionID }: { sessionID: string }) => {
      rootGets += 1;
      if (sessionID === rootId && rootGets === 1) {
        eventListener?.({ id: "event-overlap", created: 3, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "live" } } as OpenCodeEvent);
        eventListener?.({ id: "event-overlap", created: 3, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "live" } } as OpenCodeEvent);
        eventListener?.({ id: "event-end", created: 4, type: "session.text.ended", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, text: "authoritative" } } as OpenCodeEvent);
        eventListener?.({ id: "reasoning-end", created: 5, type: "session.reasoning.ended", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, text: "live reasoning" } } as OpenCodeEvent);
        eventListener?.({ id: "tool-input-end", created: 6, type: "session.tool.input.ended", data: { sessionID: rootId, assistantMessageID: "msg_root", id: "tool_root", text: "{\"command\":\"echo live\"}" } } as OpenCodeEvent);
        eventListener?.({ id: "tool-called", created: 7, type: "session.tool.called", data: { sessionID: rootId, assistantMessageID: "msg_root", id: "tool_root", input: { command: "echo live" }, executed: true, state: {} } } as unknown as OpenCodeEvent);
        eventListener?.({ id: "tool-progress", created: 8, type: "session.tool.progress", data: { sessionID: rootId, assistantMessageID: "msg_root", id: "tool_root", metadata: { step: "done" } } } as OpenCodeEvent);
        eventListener?.({ id: "tool-success", created: 9, type: "session.tool.success", data: { sessionID: rootId, assistantMessageID: "msg_root", id: "tool_root", content: [{ type: "text", text: "live output" }], executed: true } } as unknown as OpenCodeEvent);
      }
      return info(sessionID, sessionID === childId ? rootId : undefined);
    },
    active: async () => ({ [childId]: { type: "running" as const } }),
    list: async (input: { parentID?: string; cursor?: string }) => ({
      data: input.parentID === rootId ? [info(childId, rootId)] : [],
      cursor: { next: null },
    }),
    message: async () => messages(rootId)[0]!,
    inbox: { list: async () => [] },
  },
  message: {
    list: async (input: Record<string, unknown>) => {
      messageInputs.push(input);
      const id = input.sessionID as string;
      return { data: messages(id), cursor: { next: input.cursor ? null : "next-message" } };
    },
  },
  permission: { list: async () => [] },
  form: { list: async () => [] },
  agent: { list: async () => ({ location: { directory }, data: [{ id: "subagent", name: "subagent", mode: "subagent", hidden: false, request: {}, permissions: [] }] }) },
  shell: { list: async () => ({ location: { directory }, data: [] }) },
} as unknown as OpenCodeClient;

const viewer = createSessionViewerService({
  getClient: async () => client,
  onEvent: (listener) => {
    eventListener = listener;
    return () => { eventListener = undefined; };
  },
  transportState: () => "connected",
});

const rootProjection = await viewer.hydrate(atlasSession, { limit: 10 });
assert(rootProjection.available && rootProjection.root && rootProjection.selected, "root projection should be available");
assert(rootProjection.root.children[0]?.activeSubagent === true, "verified active descendant should be an active subagent");
const rootMessage = rootProjection.root.messages[0];
assert(rootMessage?.type === "assistant" && rootMessage.content[0]?.type === "text" && rootMessage.content[0].text === "authoritative", "live text end must replace overlapping canonical text");
assert(rootMessage?.type === "assistant" && rootMessage.content[1]?.type === "reasoning" && rootMessage.content[1].text === "live reasoning", "live reasoning end must replace overlapping canonical reasoning");
assert(rootMessage?.type === "assistant" && rootMessage.content[2]?.type === "tool" && rootMessage.content[2].state.status === "completed" && rootMessage.content[2].state.content[0]?.type === "text" && rootMessage.content[2].state.content[0].text === "live output", "live tool success must replace overlapping canonical tool state");
assert(messageInputs.some((input) => input.sessionID === rootId && input.order === "desc"), "first root message page should request the newest messages first");
assert(rootGets >= 2, "hydration overlap should trigger canonical replacement");

let emitEqualDeltas = false;
const equalDeltaClient = {
  ...client,
  session: {
    ...client.session,
    get: async ({ sessionID }: { sessionID: string }) => {
      if (emitEqualDeltas && sessionID === rootId) {
        emitEqualDeltas = false;
        eventListener?.({ id: "equal-text-1", created: 10, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "ha" } } as OpenCodeEvent);
        eventListener?.({ id: "equal-text-duplicate", created: 11, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "ha" } } as OpenCodeEvent);
        eventListener?.({ id: "equal-text-1", created: 12, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "ha" } } as OpenCodeEvent);
      }
      return info(sessionID, sessionID === childId ? rootId : undefined);
    },
  },
} as unknown as OpenCodeClient;
emitEqualDeltas = true;
const equalDeltaProjection = await createSessionViewerService({
  getClient: async () => equalDeltaClient,
  onEvent: (listener) => {
    eventListener = listener;
    return () => { eventListener = undefined; };
  },
  transportState: () => "connected",
}).hydrate(atlasSession, { limit: 10 });
const equalText = equalDeltaProjection.root?.messages[0];
assert(equalText?.type === "assistant" && equalText.content[0]?.type === "text" && equalText.content[0].text === "roothaha", "distinct equal text chunks must append while replayed event IDs deduplicate");

const terminalClient = {
  ...client,
  session: {
    ...client.session,
    active: async () => ({ [rootId]: { type: "running" as const } }),
    get: async ({ sessionID }: { sessionID: string }) => ({ ...info(sessionID), outcome: "succeeded" as const }),
  },
  permission: { list: async () => [{} as never] },
} as unknown as OpenCodeClient;
const terminalProjection = await createSessionViewerService({
  getClient: async () => terminalClient,
  transportState: () => "connected",
}).hydrate(atlasSession, { limit: 10 });
assert.equal(terminalProjection.root?.semanticState, "succeeded", "terminal outcome must precede pending and active evidence");

const shellOutputInputs: Record<string, unknown>[] = [];
const pagingClient = {
  ...client,
  session: {
    ...client.session,
    active: async () => ({}),
    list: async () => ({ data: [], cursor: { next: null } }),
  },
  message: {
    list: async () => ({
      data: [{ id: "session-shell", time: { created: 1 }, type: "shell", shellID: "shell-session", command: "long-output", status: "exited", output: { output: "initial shell bytes", cursor: 64, size: 128, truncated: true } }],
      cursor: { next: null },
    }),
  },
  shell: {
    list: async () => ({ location: { directory }, data: [] }),
    output: async (input: Record<string, unknown>) => {
      shellOutputInputs.push(input);
      return { location: { directory }, data: { output: "paged shell bytes", cursor: 128, size: 128, truncated: false } };
    },
  },
} as unknown as OpenCodeClient;
const pagedProjection = await createSessionViewerService({
  getClient: async () => pagingClient,
  transportState: () => "connected",
}).hydrate(atlasSession, { shellId: "shell-session", shellCursor: 64 });
const pagedMessage = pagedProjection.selected?.messages.find((message): message is Extract<SessionMessageInfo, { type: "shell" }> => message.type === "shell");
assert.equal(pagedMessage?.output?.output, "paged shell bytes", "shell cursor paging must replace the selected output page");
assert.equal(shellOutputInputs[0]?.cursor, 64, "shell paging must use the upstream byte cursor");

const workspaceMismatchClient = {
  ...client,
  shell: { list: async () => ({ location: { directory, workspaceID: "wrong-workspace" }, data: [] }) },
} as unknown as OpenCodeClient;
const workspaceMismatch = await createSessionViewerService({
  getClient: async () => workspaceMismatchClient,
  transportState: () => "connected",
}).hydrate(atlasSession, { limit: 10 });
assert.equal(workspaceMismatch.root?.shells.length, 0, "generic shells from another workspace must be rejected");
assert(workspaceMismatch.partialReasons.some((reason) => reason.includes("Running shell location")), "workspace mismatch must be visible as partial data");

const childProjection = await viewer.hydrate(atlasSession, { childId, cursor: "opaque", limit: 10 });
assert(childProjection.selected?.info.id === childId, "verified child should be selectable");
assert(messageInputs.some((input) => input.sessionID === childId && input.cursor === "opaque" && !Object.hasOwn(input, "order")), "cursor pages must omit order");

let unrelatedRejected = false;
try {
  await viewer.hydrate(atlasSession, { childId: "ses_00000000-0000-4000-8000-000000000099" });
} catch {
  unrelatedRejected = true;
}
assert(unrelatedRejected, "unrelated child must be rejected");

const reducer = createViewerEventReducer(rootId, directory);
const event = { id: "duplicate", created: 1, type: "session.execution.started", location: { directory }, data: { sessionID: rootId } } as OpenCodeEvent;
assert(reducer.apply(event), "first event should be accepted");
assert(!reducer.apply(event), "duplicate event should be ignored");
assert(reducer.snapshot().touchedSessionIds.length === 1, "duplicate event should not duplicate invalidation state");

const shellReducer = createViewerEventReducer(rootId, directory);
shellReducer.addKnownShells([{ id: "sh_known", metadata: { sessionID: rootId } }]);
assert(shellReducer.apply({ id: "shell-exited", created: 2, type: "shell.exited", location: { directory }, data: { id: "sh_known", status: "exited" } } as OpenCodeEvent), "shell exit should use the verified shell-to-Session mapping");

const attachmentMessage = {
  id: "user-with-file",
  time: { created: 1 },
  type: "user",
  text: "attached",
  files: [{ data: "secret-inline-data", mime: "text/plain", name: "notes.txt", source: { type: "inline" as const }, description: "safe description" }],
} as SessionMessageInfo;
const attachmentNode = {
  info: info(rootId),
  children: [],
  messages: [attachmentMessage],
  messagesLoaded: true,
  nextMessageCursor: null,
  active: false,
  semanticState: "idle" as const,
  pending: { permissions: [], forms: [], inbox: [] },
  shells: [],
  activeSubagent: false,
};
const attachmentHtml = renderSessionViewerFragment({
  session: atlasSession,
  viewer: { available: true, atlasSessionId: atlasSession.atlasId, root: attachmentNode, selected: attachmentNode, selectedSessionId: rootId, freshness: "fresh", partialReasons: [] },
  endpoint: `/sessions/${atlasSession.atlasId}/view`,
  eventsEndpoint: `/events?session=${atlasSession.atlasId}`,
});
assert(attachmentHtml.includes("notes.txt") && attachmentHtml.includes("text/plain") && attachmentHtml.includes("Inline attachment"), "user attachment metadata must be rendered");
assert(!attachmentHtml.includes("secret-inline-data"), "user attachment bytes must not be rendered");

const realShapeShellOutput = { output: "x".repeat(65_536), cursor: 65_536, size: 70_018, truncated: false };
const realShapeShellNode = {
  ...attachmentNode,
  messages: [{ id: "real-session-shell", time: { created: 1 }, type: "shell", shellID: "sh_session_real", command: "printf", status: "running", output: realShapeShellOutput }],
  shells: [{ info: { id: "sh_generic_real", command: "printf", cwd: directory, status: "running", metadata: { sessionID: rootId } }, output: realShapeShellOutput }],
};
const realShapeHtml = renderSessionViewerFragment({
  session: atlasSession,
  viewer: { available: true, atlasSessionId: atlasSession.atlasId, root: realShapeShellNode as never, selected: realShapeShellNode as never, selectedSessionId: rootId, freshness: "fresh", partialReasons: [] },
  endpoint: `/sessions/${atlasSession.atlasId}/view`,
  eventsEndpoint: `/events?session=${atlasSession.atlasId}`,
  requestUrl: `/sessions/${atlasSession.atlasId}/view?shell=sh_generic_real&shellCursor=0&limit=10`,
});
assert(realShapeHtml.includes("Output continues") && realShapeHtml.includes("Load next output page") && realShapeHtml.includes("shellCursor=65536"), "real beta-19135 shell pages must show a continuation when cursor is below size");

const stalledShapeHtml = renderSessionViewerFragment({
  session: atlasSession,
  viewer: { available: true, atlasSessionId: atlasSession.atlasId, root: { ...realShapeShellNode, messages: [] } as never, selected: { ...realShapeShellNode, messages: [] } as never, selectedSessionId: rootId, freshness: "fresh", partialReasons: [] },
  endpoint: `/sessions/${atlasSession.atlasId}/view`,
  eventsEndpoint: `/events?session=${atlasSession.atlasId}`,
  requestUrl: `/sessions/${atlasSession.atlasId}/view?shell=sh_generic_real&shellCursor=65536&limit=10`,
});
assert(stalledShapeHtml.includes("did not advance") && !stalledShapeHtml.includes("Load next output page"), "non-advancing shell cursors must not create a paging loop");

const completeShapeNode = { ...realShapeShellNode, messages: realShapeShellNode.messages.map((message) => ({ ...message, output: { ...realShapeShellOutput, output: "complete", cursor: 70_018 } })), shells: realShapeShellNode.shells.map((shell) => ({ ...shell, output: { ...realShapeShellOutput, output: "complete", cursor: 70_018 } })) };
const completeShapeHtml = renderSessionViewerFragment({
  session: atlasSession,
  viewer: { available: true, atlasSessionId: atlasSession.atlasId, root: completeShapeNode as never, selected: completeShapeNode as never, selectedSessionId: rootId, freshness: "fresh", partialReasons: [] },
  endpoint: `/sessions/${atlasSession.atlasId}/view`,
  eventsEndpoint: `/events?session=${atlasSession.atlasId}`,
  requestUrl: `/sessions/${atlasSession.atlasId}/view?shell=sh_generic_real&shellCursor=70018&limit=10`,
});
assert(!completeShapeHtml.includes("Output continues") && !completeShapeHtml.includes("Load next output page"), "complete shell output must not be labelled as incomplete");

const httpPersistence = createPersistence({ path: ":memory:" });
httpPersistence.upsertRepository({
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
httpPersistence.replaceSpecs("1", [{
  githubId: "spec-1",
  issueNumber: "1",
  title: "Viewer Spec",
  body: "Viewer body",
  htmlUrl: "https://github.com/Org/repo/issues/1",
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: null,
}]);
httpPersistence.queueSession({
  atlasId: atlasSession.atlasId,
  repositoryId: "1",
  spec: { githubId: "spec-1", issueNumber: "1", title: "Viewer Spec", body: "Viewer body", htmlUrl: "https://github.com/Org/repo/issues/1" },
  submissionId: atlasSession.submissionId,
  submissionOrderTime: atlasSession.submittedAt,
  prompt: atlasSession.prompt,
  targetKind: "default",
  targetBranch: "main",
});
httpPersistence.database.query(`
  UPDATE sessions
  SET state = 'running', directory = ?, preparation_checkpoint = 'prepared', prepared_at = ?,
      handoff_checkpoint = 'prompt_accepted', opencode_intended_session_id = ?,
      opencode_session_id = ?, initial_message_id = ?, initial_inbox_id = ?, exact_message = ?,
      opencode_freshness = 'fresh', execution_slot_held = 1, updated_at = ?
  WHERE atlas_id = ?
`).run(directory, atlasSession.submittedAt, rootId, rootId, "msg_initial", "inbox", "exact", atlasSession.submittedAt, atlasSession.atlasId);

const openCodeListeners = new Set<(event: OpenCodeEvent) => void>();
let currentToken = "secret";
const fakeOpenCode = {
  start: () => undefined,
  stop: () => undefined,
  enqueue: () => undefined,
  process: async () => undefined,
  getClient: async () => client,
  onEvent: (listener: (event: OpenCodeEvent) => void) => {
    openCodeListeners.add(listener);
    return () => openCodeListeners.delete(listener);
  },
  onTransport: () => () => undefined,
  transportState: () => "connected" as const,
};
const httpApp = createApp({
  persistence: httpPersistence,
  sharedToken: "secret",
  getSharedToken: () => currentToken,
  github: {} as never,
  openCode: fakeOpenCode as never,
});
const authHeaders = { Authorization: "Bearer secret" };
const fullView = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view`, { headers: authHeaders }));
const fullViewBody = await fullView.text();
assert.equal(fullView.status, 200);
assert(fullViewBody.includes("Live Session view"), "direct viewer URL should return a full Session page");
assert(fullViewBody.includes("Descendant Sessions"), "full viewer page should render verified descendants");

const fragmentView = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view?child=${childId}`, {
  headers: { ...authHeaders, "HX-Request": "true" },
}));
const fragmentBody = await fragmentView.text();
assert.equal(fragmentView.status, 200);
assert(fragmentBody.includes("child"), "verified child fragment should render the child conversation");
const cursorFragment = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view?cursor=opaque&limit=10`, {
  headers: { ...authHeaders, "HX-Request": "true" },
}));
assert.equal(cursorFragment.status, 200);
assert(messageInputs.some((input) => input.sessionID === rootId && input.cursor === "opaque" && !Object.hasOwn(input, "order")), "HTTP cursor route should follow opaque message cursors without order");

const unrelated = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view?child=ses_00000000-0000-4000-8000-000000000099`, { headers: authHeaders }));
assert.equal(unrelated.status, 404);
const invalidChildSchema = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view?child=not-an-opencode-session`, { headers: authHeaders }));
assert.equal(invalidChildSchema.status, 400);
const invalidCursor = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view?cursor=%00`, { headers: authHeaders }));
assert.equal(invalidCursor.status, 400);
const invalidLimit = await httpApp.fetch(new Request(`http://atlas.test/sessions/${atlasSession.atlasId}/view?limit=0`, { headers: authHeaders }));
assert.equal(invalidLimit.status, 400);

const unauthenticatedEvents = await httpApp.fetch(new Request(`http://atlas.test/events?session=${atlasSession.atlasId}`, { headers: { Accept: "text/event-stream" } }));
assert.equal(unauthenticatedEvents.status, 401);
const events = await httpApp.fetch(new Request(`http://atlas.test/events?session=${atlasSession.atlasId}`, { headers: authHeaders }));
const eventReader = events.body?.getReader();
const firstEvent = eventReader ? await eventReader.read() : { value: undefined };
assert.equal(events.status, 200);
const firstEventText = new TextDecoder().decode(firstEvent.value);
assert(firstEventText.includes("event: connected"), "authenticated SSE should send only bounded connection signals");
assert((firstEventText.match(/event: connected/g) ?? []).length === 1, "SSE should not duplicate its initial connection signal");
assert(!firstEventText.includes("root") && !firstEventText.includes("child"), "SSE must not expose transcript or child projection data");
for (const listener of openCodeListeners) listener({ id: "http-refresh", created: 4, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "live" } } as OpenCodeEvent);
const refreshEvent = eventReader ? await eventReader.read() : { value: undefined };
assert(new TextDecoder().decode(refreshEvent.value).includes("event: refresh"), "relevant upstream events should produce a bounded refresh signal");
currentToken = "rotated";
for (const listener of openCodeListeners) listener({ id: "http-auth-check", created: 5, type: "session.text.delta", data: { sessionID: rootId, assistantMessageID: "msg_root", ordinal: 0, delta: "auth" } } as OpenCodeEvent);
const postRotationRefresh = eventReader ? await eventReader.read() : { value: undefined };
const authExpiredEvent = eventReader ? await eventReader.read() : { value: undefined };
assert(new TextDecoder().decode(postRotationRefresh.value).includes("event: refresh"), "auth rotation should not turn a relevant event into transcript data");
assert(new TextDecoder().decode(authExpiredEvent.value).includes("event: auth-expired"), "existing SSE streams should detect token rotation");
await eventReader?.cancel();
httpPersistence.close();

console.log("Issue #29 focused viewer checks passed");
