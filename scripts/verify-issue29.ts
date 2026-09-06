import type { OpenCodeClient, OpenCodeEvent, SessionInfo, SessionMessageInfo } from "@opencode-ai/client";
import { strict as assert } from "node:assert";
import { createApp } from "../src/app.ts";
import { createPersistence } from "../src/persistence.ts";
import { createSessionViewerService, createViewerEventReducer } from "../src/session-viewer.ts";
import type { Session } from "../src/persistence.ts";

const rootId = "ses_00000000-0000-4000-8000-000000000001";
const childId = "ses_00000000-0000-4000-8000-000000000002";
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
  ? [{ id: "msg_root", time: { created: 1 }, type: "user", text: "root" }]
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
  state: "running",
  stateReason: null,
  directory,
  baseBranch: "main",
  baseSha: "sha",
  workingBranch: "atlas/test",
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
assert(messageInputs.some((input) => input.sessionID === rootId && input.order === "asc"), "first root message page should request ascending order");
assert(rootGets >= 2, "hydration overlap should trigger canonical replacement");

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
