# OpenCode V2 session viewer contract

Research for [Atlas issue #20](https://github.com/SandunRathsara/atlas/issues/20), verified 2026-09-05.

## Decision

Atlas must treat OpenCode's HTTP projections as canonical persisted state and `client.event.subscribe()` as a live-only, lossy, low-latency overlay. A viewer starts the event consumer before hydration, reconciles from HTTP, and repeats that reconciliation after every disconnect. It must never derive a terminal outcome from inactivity or claim that missed transient events were replayed.

## Required HTTP snapshot

These are the Promise-client calls for opening one session. The generated client and the HTTP reference expose the same contract.[^client-declarations] [^api]

| Projection | Exact call | Use |
| --- | --- | --- |
| Session | `client.session.get({ sessionID })` | Identity, location, parent/fork links, selected agent/model, usage, timestamps, and durable `outcome`. |
| Complete transcript | `client.message.list({ sessionID, order: "asc", limit })` | Page through every projected message in display order. |
| One message | `client.session.message({ sessionID, messageID })` | Replace/reconcile a message touched by live events. |
| Direct children | `client.session.list({ parentID: sessionID, order: "asc", limit })` | Discover each level of the session tree; recurse and paginate. |
| Current execution | `client.session.active()` | Map of session ID to `{ type: "running" }`; an absent ID is inactive. It only covers foreground drains owned by that OpenCode process.[^openapi] |
| Pending approvals | `client.permission.list({ sessionID })` | Pending `Permission.Request[]`. |
| Pending inputs | `client.session.inbox.list({ sessionID })` | Durable enqueued work not yet delivered. Do not call this “waiting for user.” |
| Pending forms | `client.form.list({ sessionID })` | Pending structured forms. |
| Running generic shells | `client.shell.list({ location: { directory, workspace } })` | Running shells for the session's location; associate by `Shell.Info.metadata.sessionID` when present. The input uses `workspace`, while `Session.Info.location` returns `workspaceID`. |
| Shell output | `client.shell.output({ id, cursor, limit, location })` | Captured combined output, paged by absolute byte cursor. |
| Agent definitions | `client.agent.list({ location })` or `client.agent.get({ agentID, location })` | Resolve a child session's agent `mode`. |

Key snapshot fields are:[^pinned-types]

- `Session.Info`: `id`, optional `parentID`, optional `fork { sessionID, boundary }`, `projectID`, optional `agent/model`, `cost`, `tokens`, optional `outcome`, `time { created, updated, idle?, viewed?, archived? }`, optional `title`, `location { directory, workspaceID? }`, and optional `subpath/metadata/revert`.
- `outcome`: exactly `succeeded | failed | interrupted`.
- `Permission.Request`: `id`, `sessionID`, `action`, `resources`, and optional `save`, `metadata`, `source { type: "tool", messageID, id }`, and `message`.
- `Form.Info`: `id`, `sessionID`, `title`, optional `metadata`, and typed `fields`.
- `Shell.Info`: `id`, `status`, `command`, `cwd`, `shell`, `file`, optional `pid/exit`, `metadata`, and `time { started, completed? }`.
- Message/session list responses: `{ data, cursor: { previous?, next? } }`.

### Pagination rule

For messages, request the first page with `order: "asc"`, then follow `response.cursor.next` with:

```ts
await client.message.list({ sessionID, cursor: next, limit })
```

Do **not** send `order` with a cursor. Keep the returned order and deduplicate by message `id`. Stop only when `cursor.next` is null/absent. The pinned build can return a cursor on the last non-empty page and an empty final page with both cursors null; that empty page is valid. Session-list pagination also returns opaque `previous`/`next` cursors.[^openapi] [^pinned-types]

`client.session.context({ sessionID })` is not a transcript API: it returns active model context after the latest compaction. `client.session.wait({ sessionID })` only waits for the agent loop to become idle; it is useful for automation, not viewer hydration or outcome classification.[^openapi]

## Persisted message model

`Session.Message.Info` is this discriminated union:[^pinned-types]

```text
agent-switched | model-switched | location-switched | user | synthetic |
system | skill | shell | assistant | compaction
```

All messages have `id` and `time.created`; variants carry their own fields. Important variants:

- `user`: `text`, optional `files`, `agents`, and `skills`.
- `shell`: `shellID`, `command`, `status`, optional `exit` and paged-output snapshot; status is `running | exited | timeout | killed`.
- `compaction`: `status: running | completed | failed`, `reason`, and summary/error fields.
- `assistant`: `agent`, `model`, ordered `content`, timestamps, optional snapshot, finish/error/retry, cost, and tokens.

Assistant `content` is an ordered union:

| `type` | Stable fields |
| --- | --- |
| `text` | `text`; optional opaque provider `state`. |
| `reasoning` | `text`; optional `time.created/completed`; optional opaque provider `state`. Render only public `text`. |
| `tool` | `id`, `name`, `time.created/ran/completed`, optional `executed`, and `state`. |

Tool `state.status` is the UI contract:

| Status | Fields |
| --- | --- |
| `streaming` | Raw partial `input: string`. |
| `running` | Parsed JSON `input` and JSON `metadata` (progress snapshot). |
| `completed` | Parsed `input`, non-empty `content`, optional `metadata`. |
| `error` | Parsed `input`, structured `error`, optional non-empty `content` and `metadata`. |

Tool content is `text { text }` or `file { uri, mime, name? }`. `metadata`, `providerState`, and `providerResultState` are opaque JSON: preserve them, but do not make undocumented keys part of Atlas's stable UI contract.[^pinned-types]

## Live event reducer

Every native event has `type`, `id`, usually `created`, optional `location`, and event-specific `data`. Filter session events by `data.sessionID`; filter location events by `event.location` and shell ID.[^pinned-types]

| Concern | Events and reducer effect |
| --- | --- |
| Execution | `session.execution.started` marks running. `session.execution.succeeded`, `.failed`, `.interrupted` stop running and trigger `session.get`; failed carries `error`, interrupted carries `reason: user | shutdown | superseded`. |
| Assistant step | `session.step.started` creates/resets the assistant message keyed by `assistantMessageID`; `.streamed` stamps streaming; `.ended` writes finish/usage/snapshot; `.failed` writes structured error. |
| Text | `session.text.started` creates the part at `ordinal`; `.delta` appends `delta`; `.ended` replaces it with authoritative `text`. |
| Reasoning | `session.reasoning.started`, `.delta`, `.ended` mirror text and carry optional state/timestamps. |
| Tool input | `session.tool.input.started`, `.delta`, `.ended`, keyed by `assistantMessageID` + tool `id`; ended replaces raw input text. |
| Tool run | `session.tool.called` changes the tool to running with parsed `input`; `.progress` replaces progress `metadata`; `.success` or `.failed` writes the terminal tool state/content/error. |
| Shell transcript | `session.shell.started` creates a session `shell` message; `.ended` replaces status, exit, output, and completion time. |
| Generic shell | `shell.created`, `.exited`, `.deleted`, keyed by shell `id`; created includes `Shell.Info`. These events are location-scoped, not intrinsically session-scoped. |
| Approval | `permission.asked` upserts `data` by request `id`; `.replied` removes `requestID`. Replies are `once | always | reject`.[^permissions] |
| Form | `form.created` upserts `data.form`; `form.replied` and `.cancelled` remove it. |
| Session status | `session.status` replaces `status`; `session.idle` means the loop became idle. Status is exactly `idle | busy | retry`; retry includes `attempt`, `message`, `next`, and optional `action`. |
| Relationships | `session.created`, `.forked`, `.deleted` invalidate/reload session-tree projections. |
| Full content correction | `session.message.content.updated` replaces the assistant message's whole `content` array. |
| Retry detail | `session.retry.scheduled` writes assistant `retry { attempt, at, error }`. |

Correlation and payload fields are stable enough to avoid guesswork: text/reasoning events use `sessionID`, `assistantMessageID`, and `ordinal`; tool events replace `ordinal` with tool `id`; tool success adds `content`, optional `metadata/resultState`, and `executed`; tool failure adds structured `error`, optional `content/metadata/resultState`, and `executed`. `Session.StructuredError` is `{ type, message, status? }`.[^pinned-types]

The package's first-party Solid data layer demonstrates these keyed reducer rules, exact replacement on `*.ended`, event/HTTP race handling, and terminal-event revalidation.[^data-reducer]

## Hydration and reconnect algorithm

1. Create `client.event.subscribe({ signal })` **and begin consuming it** into a fast in-memory queue. The connection is lazy, so creating the iterable is not enough.
2. Treat `server.connected` as transport establishment. Filter only after enqueueing; the shared stream spans all locations.
3. In parallel, load the full HTTP snapshot above for the root and known descendants.
4. Install the HTTP snapshot, then reduce buffered events by `event.id` and stable message/tool IDs. End events replace content; they do not append it.
5. While still queueing new events, re-fetch any session/message/pending collection touched during the overlap, then reduce the new queue before declaring the view fresh. HTTP replacement resolves ambiguous partial-delta races.
6. Continue reducing live events. On terminal execution events, re-fetch `session.get` so `Session.Info.outcome` remains authoritative.
7. If the iterator ends, errors, aborts, or the connection is otherwise lost, mark transport freshness **stale**. Start a new consumer, repeat the full HTTP reconciliation, then clear stale.

The official client contract is explicit: subscriptions are live-only, have no replay, do not reconnect automatically, and a source failure ends current subscribers. A late native subscriber receives only the current `server.connected`, not old business events. Consumers must buffer before slow work.[^client]

The Promise client shares one lazy event connection per client. Cancelling one subscriber affects only that iterator; the last subscriber leaving closes the source. The pinned implementation caps each subscriber queue at 4,096 events and fails an overflowing subscriber.[^client] [^shared-events]

### Experimental durable log

`client.session.log({ sessionID, after, follow })` reads the experimental durable session log after the exclusive aggregate `seq`; `follow: true` continues live and `log.synced { aggregateID, seq? }` marks synchronization.[^openapi] [^pinned-types]

It is optional and must be version-gated. Its `SessionEventDurable` union excludes ephemeral text/reasoning/tool-input deltas, tool progress, `session.status`, permission/form events, and generic `shell.*` events. It therefore cannot replace HTTP reconciliation or the native SSE stream.

## UI state mapping

Keep **semantic state** and **transport freshness** separate. “Stale” is Atlas state, not an OpenCode `SessionStatus` or outcome.

| Atlas presentation | Exact evidence | Guardrail |
| --- | --- | --- |
| `stale` | Event source is down, or reconnect HTTP reconciliation is incomplete. | Overlay the last semantic state; do not mutate it into an OpenCode status. |
| `waiting` — permission | `client.permission.list({ sessionID })` is non-empty, or unmatched `permission.asked`. | Pending request is explicit evidence. |
| `waiting` — form | `client.form.list({ sessionID })` is non-empty, or unmatched `form.created`. | Pending form is explicit evidence. |
| `waiting` — retry | Latest fresh `session.status` is `{ type: "retry", attempt, message, next, action? }`; action is `{ reason, provider, title, message, label, link? }`. | Preserve those fields exactly. |
| `live` | Fresh `session.active()[sessionID]?.type === "running"`, unmatched `session.execution.started`, or fresh `session.status` is `busy`. | Pending explicit waiting causes take display precedence. |
| `succeeded` | Fresh `Session.Info.outcome === "succeeded"`. | A success event is only a prompt to refresh the projection. |
| `failed` | Fresh `Session.Info.outcome === "failed"`. | Show structured step/execution error when available. |
| `interrupted` | Fresh `Session.Info.outcome === "interrupted"`. | A live event may additionally provide `user | shutdown | superseded`. |

If the session is inactive and has no outcome, it is merely idle/unresolved; do not call it succeeded. `session.idle`, `SessionStatus { type: "idle" }`, an empty inbox, or silence are not terminal evidence. While a new execution is active, current running/waiting evidence takes precedence over an older hydrated outcome.

Do not infer “waiting” from queued inbox work, a running shell, unfinished tool content, elapsed time, or an active child. Those facts may be displayed separately but have no documented waiting meaning.

## Parent, child, and active-subagent contract

1. Read `Session.Info.parentID` for the upward link.
2. Fetch and paginate direct children with `client.session.list({ parentID })`; recurse for all descendants.
3. Refresh the tree on `session.created`, `session.forked`, and `session.deleted`.
4. Fetch `client.session.active()` and intersect its keys with descendants.
5. Resolve each child's `Session.Info.agent` through `client.agent.get/list` at that child's location. `Agent.Info.mode` is `primary | subagent | all`.
6. Label an active descendant an **active subagent** only when its agent mode is `subagent` or `all`. If the agent is missing/unresolvable, call it an active child session, not a proven subagent.

OpenCode documents that subagents run with fresh context in child sessions; `subagent` mode is child-only and `all` can run as primary or child.[^agents] `Session.Info.fork { sessionID, boundary }` and `session.forked` describe fork provenance. Forking alone is not proof that a child is a subagent.

## Reopen a preserved session by ID

1. Reconnect to the same OpenCode service/instance and authentication context used to create the session.
2. Start/buffer the event subscription.
3. Call `client.session.get({ sessionID })`. Treat `SessionNotFoundError` as deleted, wrong server, or unavailable storage—not as an empty session.
4. Use the returned location for location-scoped agent and shell calls.
5. Hydrate all message pages, pending permission/inbox/form collections, direct children recursively, and `session.active()`.
6. Apply buffered events and reconcile as above.

No resume API is required to view an idle preserved session. The validated POC aborted its event subscriber while deliberately retaining the sessions and working directory; `session.get` recorded the succeeded and interrupted outcomes, and both preserved IDs were reopened in follow-up validation.[^poc-readme] [^poc-run]

## Public API gaps and fidelity limits

| Gap | Consequence |
| --- | --- |
| No SSE replay/resume cursor | Atlas cannot reconstruct the exact sequence/timing of deltas, progress updates, answered approvals, or short-lived shells missed while disconnected. It can recover projected final state. |
| No HTTP `session.status` snapshot | A `retry` detail can be missed during disconnect. `session.active()` only says running and is limited to foreground drains owned by the current OpenCode process. |
| Generic `shell.list` returns only running commands | Exited generic shell rows are not recoverable from that endpoint. Session shell messages and assistant tool results remain the durable viewer sources when projected. |
| Opaque provider state | Public reasoning is only the reasoning part's `text`. The POC observed an empty reasoning text with opaque encrypted provider state; Atlas cannot reconstruct hidden reasoning. |
| No durable “created by subagent tool” flag | Parent links plus agent mode support conservative classification, but forks or API-created children must not be relabeled as subagents without evidence. |
| TUI-local state is not a session projection | Focus, viewport, expanded rows, draft prompt, toast history, and local display preferences cannot be restored as session facts. |

The public docs do not define a pixel-for-pixel TUI viewer contract. Under this ticket's allowed sources, no additional persisted session field was proven to be visible only in the TUI. The list above is therefore a boundary statement, not a claim that undocumented TUI internals were exhaustively audited.

## Version and evidence

- Official source of truth: OpenCode V2 docs and OpenAPI fetched 2026-09-05. The docs mark the V2 API/client beta; the OpenAPI document reports `info.version: 0.0.1`.[^client] [^openapi]
- Validated package: `@opencode-ai/client@0.0.0-beta-19135`; the POC server reported the same version.[^poc-pin] [^poc-run]
- Validated POC branch commit: [`5ff26b164ae6d7d8a650b6c882d1db680dc71fff`](https://github.com/SandunRathsara/atlas/tree/5ff26b164ae6d7d8a650b6c882d1db680dc71fff/poc/issue-19-opencode-e2e).
- Latest successful local report: `run-2026-09-05T06-15-48-193Z-72806.json`, SHA-256 `2426069d27e7df019e3ee12c3a1ccca72fb8f1ac047dd759022ee1506f2e554a`. It recorded successful persistence/reopen, live SSE, projected messages, `session.wait`, `succeeded`, and controlled `interrupted` behavior.
- Because the contract is beta, Atlas should pin the package/server pair and rerun the POC plus schema/reducer checks before upgrading.

[^client]: [OpenCode V2 JavaScript client guide](https://opencode.ai/v2/docs/build/client)
[^api]: [OpenCode V2 HTTP API reference](https://opencode.ai/v2/docs/api)
[^openapi]: [OpenCode V2 OpenAPI JSON](https://opencode.ai/v2/openapi.json)
[^agents]: [OpenCode V2 agents guide](https://opencode.ai/v2/docs/agents/)
[^permissions]: [OpenCode V2 permissions guide](https://opencode.ai/v2/docs/permissions/)
[^client-declarations]: [`@opencode-ai/client@0.0.0-beta-19135` generated Promise client](https://unpkg.com/@opencode-ai/client@0.0.0-beta-19135/dist/promise/generated/client.d.ts)
[^pinned-types]: [`@opencode-ai/client@0.0.0-beta-19135` generated types](https://unpkg.com/@opencode-ai/client@0.0.0-beta-19135/dist/promise/generated/types.d.ts)
[^shared-events]: [`@opencode-ai/client@0.0.0-beta-19135` shared event implementation](https://unpkg.com/@opencode-ai/client@0.0.0-beta-19135/dist/shared-events.js)
[^data-reducer]: [`@opencode-ai/client@0.0.0-beta-19135` first-party Solid data reducer](https://unpkg.com/@opencode-ai/client@0.0.0-beta-19135/dist/solid/data.js)
[^poc-pin]: [Validated POC package pin](https://github.com/SandunRathsara/atlas/blob/5ff26b164ae6d7d8a650b6c882d1db680dc71fff/poc/issue-19-opencode-e2e/package.json)
[^poc-readme]: [Validated POC contract and preservation notes](https://github.com/SandunRathsara/atlas/blob/5ff26b164ae6d7d8a650b6c882d1db680dc71fff/poc/issue-19-opencode-e2e/README.md)
[^poc-run]: [Validated POC implementation](https://github.com/SandunRathsara/atlas/blob/5ff26b164ae6d7d8a650b6c882d1db680dc71fff/poc/issue-19-opencode-e2e/run.mjs)
