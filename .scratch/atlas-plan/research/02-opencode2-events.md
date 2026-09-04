# 02 - opencode2 events: SSE stream, idle/error detection, activity signals, reconnecting

Ticket: [issues/02-opencode2-events.md](../issues/02-opencode2-events.md)
Date: 2026-09-04
Target: opencode2 beta ("v2 API"). Local binary `opencode2 v0.0.0-beta-17823`. Newest npm beta packages `0.0.0-beta-19086`.

## TL;DR

- Subscribe with `@opencode-ai/client` (not `@opencode-ai/sdk`, which is an in-process host in v2): `OpenCode.make({ baseUrl, headers }).event.subscribe({ signal })` returns an `AsyncIterable<V2Event>` over `GET /api/event`. The stream is **global** (all directories, all sessions); there is no per-session or per-directory stream in the local binary.
- Envelope: `{ id, created, type, location?: { directory, workspaceID? }, data, durable?: { aggregateID, seq, version }, metadata? }`. Route by `data.sessionID`.
- **Turn finished / idle** = one of the durable terminal events `session.execution.succeeded`, `session.execution.failed` (`data.error`), `session.execution.interrupted` (`data.reason: "user" | "shutdown" | "superseded"`). Confirm or poll with `GET /api/session/active` (running map) and `POST /api/session/{id}/wait` (204 when idle).
- **Working** = `session.execution.started`. **Activity** = any `session.*` event carrying the run's `sessionID` between started and the terminal event (steps, text/reasoning deltas, tool input/called/progress/success/failed, shell, usage, retry, compaction).
- **Permission asked** = `permission.asked` (`data: { id, sessionID, action, resources, save?, metadata?, source?, message? }`); resolved by `permission.replied`. Pending list: `GET /api/session/{id}/permission`.
- **Session deleted** = `session.deleted` (`data: { sessionID }`).
- Stream is volatile by contract: "a slow consumer overflows and fails the stream, and events during disconnection are missed" (server OpenAPI). Server restart closes the stream; the client does not reconnect. After any gap, resync from `GET /api/session` + `GET /api/session/active`.
- On server restart the server itself resumes sessions that were mid-execution (up to 10 attempts) after injecting a synthetic "The server restarted while you were working" message.
- `session.status` / `session.idle` (the 1.x idle signals) are still defined in the v2 schema but no publisher was found in the v2 core/server packages. Do not rely on them.

## Sources and versions

| Source | What it is | How verified |
| --- | --- | --- |
| `/Users/alpha/.local/bin/opencode2` | Local beta binary, `opencode2 --version` -> `v0.0.0-beta-17823` | Ran `opencode2 serve --hostname 127.0.0.1 --port 47391` in `/tmp/atlas-research/oc-cwd`, fetched `/openapi.json`, curled `/api/*`. Killed afterwards. |
| Local server `GET /openapi.json` | OpenAPI 3.1.0, title "opencode HttpApi" for beta-17823 | Parsed with python. Note: `/doc` returns the web SPA, not the spec. |
| `@opencode-ai/sdk` dist-tags (`npm view @opencode-ai/sdk dist-tags`, 2026-09-04) | `latest: 1.18.27`, `beta: 0.0.0-beta-19086`, `dev: 0.0.0-dev-19094`, `next: 0.0.0-next-16233` | npm |
| `@opencode-ai/schema@0.0.0-beta-19086` | Event/session schemas (repo `packages/schema`) | `npm pack`, read `dist/*.js` |
| `@opencode-ai/server@0.0.0-beta-19086` | HTTP handlers (repo `packages/server`) | `npm pack`, read `dist/handlers/event.js`, `dist/event-feed.js`, `dist/handlers/session.js` |
| `@opencode-ai/core@0.0.0-beta-19086` | Execution/restart logic (repo `packages/core`) | `npm pack`, read `dist/session/execution/restart.js`, `dist/chunks/*` |
| `@opencode-ai/client@0.0.0-beta-19086` | HTTP client (repo `packages/client`) | `npm pack`, read `dist/promise/*` |
| `@opencode-ai/sdk@1.18.27` | Stable SDK; has `dist/v2/` subpath generated against a *newer* v2 server | `npm pack`, grep `dist/v2/gen/types.gen.d.ts` |
| https://opencode.ai/docs/server/ , https://opencode.ai/docs/sdk/ | Official docs (1.x only; no v2/beta content) | WebFetch |
| GitHub `anomalyco/opencode` branch `beta`, HEAD `b09a74591cbd4d2ea1488e56177898a13f21278d` (2026-09-04) | Source of the opencode2 beta: `packages/schema`, `packages/protocol`, `packages/server`, `packages/core`, `packages/client`, `packages/sdk`, `packages/cli` (`bin: opencode2`). No `packages/opencode` on this branch. | Subagent via `gh api` / raw.githubusercontent.com |
| GitHub `anomalyco/opencode` branch `dev` (default), HEAD `31afdd5938a6105e6b8246c861555caa84bdfe81` (2026-09-04) | 1.18.27 stable line; still has the legacy `packages/opencode` server plus in-progress `packages/server`/`packages/sdk-next` | Same |
| GitHub `anomalyco/opencode-beta` releases | Beta binaries: `v0.0.0-beta-19086` (2026-09-04), 19059, 18999, ... | `gh api` |
| Context7 `/anomalyco/opencode` | Confirmed repo rename (`sst/opencode` redirects) and beta file paths | `rtk proxy npx ctx7@latest docs` |

Version caveat: local binary is beta-17823; the npm packages are beta-19086. Beta builds are produced by `.github/workflows/publish.yml` on the `beta` branch (`GH_REPO` switched to `anomalyco/opencode-beta`; `packages/script/src/index.ts` on `beta` sets the version to `0.0.0-${CHANNEL}-${GITHUB_RUN_NUMBER}`), so `17823` and `19086` are Actions run numbers, not tags in `anomalyco/opencode`. `strings` on the local binary shows the same event names as 19086 (`session.execution.*`, `session.step.*`, `session.tool.*`, `permission.asked`, `server.connected`, `global.disposed`) and none of the `session.next.*` names that appear in the stable SDK's `dist/v2` codegen (those come from `dev`'s `packages/schema/src/session-event.ts`, not `beta`'s). Two differences found between 17823 and 19086 are called out below (Session.Info fields, `plugin.added` vs `plugin.updated`).

Repo-path map for the npm files cited below (all on branch `beta`): `@opencode-ai/schema` = `packages/schema/src/*.ts` (e.g. `session-event.ts`, `session-status-event.ts`, `session-error.ts`, `permission.ts`, `form.ts`, `event.ts`, `event-manifest.ts`, `session.ts`); `@opencode-ai/protocol` route contracts = `packages/protocol/src/groups/{event,session,server}.ts` (`/api/event` at `groups/event.ts` l.38-68, `/api/session` l.131-140 and `/api/session/active` l.220-229 in `groups/session.ts`); `@opencode-ai/server` = `packages/server/src/{handlers/event.ts,event-feed.ts,handlers/session.ts,auth.ts,options.ts}`; `@opencode-ai/core` = `packages/core/src/session/{execution.ts,run-coordinator.ts,execution/restart.ts,store.ts}`; `@opencode-ai/client` = `packages/client/src/`.

## 1. Subscribing to the stream

### Which package

`@opencode-ai/sdk@beta` is **not** an HTTP client. Its README: "In-process OpenCode host for Promise and Effect applications. The SDK executes Server's assembled HTTP router in memory, opening no listener and adding no network hop." (`@opencode-ai/sdk@0.0.0-beta-19086/README.md`). Atlas connects to an already-running server, so it needs `@opencode-ai/client@beta`.

`@opencode-ai/client@0.0.0-beta-19086/dist/promise/client.d.ts`:

```ts
export declare function make(options: ClientOptions): {
  event: { subscribe(options?: { readonly signal?: AbortSignal }): AsyncIterable<V2Event> };
  health: { get: (requestOptions?) => Promise<ServiceHealth> };   // { healthy: true, version, pid }
  session: { list, get, active, wait, interrupt, prompt, create, remove, ... };
  ...
}
```

`ClientOptions = { baseUrl: string; fetch?; headers?: RequestInit["headers"] }` (`dist/promise/generated/client.d.ts:2-6`). Auth is not built in; pass `headers: { Authorization: "Basic " + btoa("opencode:" + password) }`.

`OpenCodeEvent` type alias = `EventSubscribeOutput` = `V2Event` (`dist/promise/index.d.ts`, `dist/promise/generated/types.d.ts:7762`).

### Wire protocol

`GET /api/event` (operationId `v2.event.subscribe`). Local OpenAPI description: "Subscribe to native event payloads for the server. Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed." No query parameters.

Handler (`@opencode-ai/server@beta-19086/dist/handlers/event.js`):
- First frame is a synthetic `{ id, type: "server.connected", data: {} }` (no `created`).
- Then live bus events, each framed as `data: ${JSON.stringify(event)}\n\n` (`dist/event-feed.js` `frame()`).
- Heartbeat comment `: heartbeat\n\n` every 15 seconds (`Stream.tick("15 seconds")`).
- Headers: `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`.
- Per-subscriber `Queue.dropping(4096)`; on overflow the subscriber is removed and its stream fails with `EventFeed.SubscriberOverflow` (`dist/event-feed.js` `SubscriberCapacity = 4096`).
- Only events passing `isOpenCodeEvent` (the public manifest) are forwarded.

Observed live (beta-17823, basic auth):

```
data: {"id":"evt_06c7b549a001dpljiUAgSuSs0X","type":"server.connected","data":{}}

: heartbeat

data: {"id":"evt_06c7b54fc0018VnVJTASg0YvWm","created":1788526417148,"type":"plugin.added","location":{"directory":"/private/tmp/atlas-research/oc-cwd"},"data":{"id":"opencode.config.mcp"}}
```

### Global vs scoped

Global. `/api/event` has no directory/workspace parameter; the feed subscribes to the whole `Bus`. Scope is carried *inside* each event: optional `location: { directory, workspaceID? }` on the envelope and `sessionID` inside `data` for session events. Sessions from every directory arrive on the same stream (confirmed: `GET /api/session` listed sessions from `/Users/alpha/Developer/Maji/rekonix` while the server ran from `/tmp`).

No per-session stream exists in beta-17823. The stable SDK's `dist/v2` codegen has `GET /api/session/{sessionID}/event?after=` ("Replay durable events after an aggregate sequence, then continue with new durable events") but that path is absent from the local `/openapi.json` (verified: 404). Treat it as future.

### Auth

`opencode2 serve` prints `server password <random>` when no password is configured; every `/api/*` route returns 401 without HTTP basic auth `opencode:<password>` (verified). Bearer is rejected. The binary contains the env names `OPENCODE_SERVER_PASSWORD` and `OPENCODE_PASSWORD` (`strings`); `ServerOptions.password` exists in `@opencode-ai/server` `dist/options.d.ts`. Username default "opencode" per `@opencode-ai/server` `dist/auth.d.ts` (`Info.username`) and the 1.x docs (`OPENCODE_SERVER_USERNAME`). Not verified: whether `--password` flag or which env var the beta CLI reads.

### Client behaviour on disconnect

`@opencode-ai/client` `dist/promise/generated/client.js` `sse()` reads the body with a `TextDecoder`, splits on `\n\n`, yields `JSON.parse(data)` for `data:` lines, and simply `return`s when the body ends. `dist/shared-events.js` multiplexes one connection across subscribers, replays the cached `server.connected` to late subscribers, caps each subscriber at 4096 queued events, and on connection end calls `finish` on all subscribers (they complete, or reject if the read threw). **No automatic reconnect.** Atlas must loop: subscribe, consume, on completion/error resync then resubscribe.

## 2. Event envelope

`@opencode-ai/schema@beta-19086/dist/event.js` `durable()` / `ephemeral()`:

```ts
{ id: Event.ID,                       // "evt_..."
  created: number,                    // epoch ms
  metadata?: Record<string, unknown>,
  type: "<literal>",
  durable?: { aggregateID: string, seq: number, version: number },   // durable events only
  location?: { directory: string, workspaceID?: string },
  data: { ...event specific } }
```

Durable session events use `durable.aggregate = "sessionID"` and are persisted (event-sourced projection into SQLite, `packages/core`). Ephemeral events (`*.delta`, `session.tool.progress`, `session.usage.updated`, `session.status`, `session.idle`, `permission.*`, `server.connected`, `global.disposed`) are live-only.

## 3. Event catalogue (beta)

All from `@opencode-ai/schema@beta-19086/dist/session-event.js` unless noted. Every session event's `data` includes `sessionID`. D = durable, E = ephemeral.

### Session lifecycle

| Type | D/E | `data` | Meaning |
| --- | --- | --- | --- |
| `session.created` | D | `sessionID, projectID, location: {directory, workspaceID?}, subpath?, parentID?, slug, title?, agent?, model?, metadata?, version` | Session started (created). |
| `session.renamed` | D | `sessionID, title` | Title set (server auto-titles). |
| `session.moved` | D | `sessionID, location, projectID, subpath?` | Directory changed. |
| `session.deleted` | D | `sessionID` | Session deleted. |
| `session.forked` | D | `sessionID, parentID, boundary, ...` | Child created by fork. |
| `session.agent.selected` / `session.model.selected` | D | `sessionID, agent|model, previous?` | Config switch. |
| `session.viewed` | D | `sessionID, idle` | UI read watermark; ignore. |

### Prompt intake

| Type | D/E | `data` |
| --- | --- | --- |
| `session.inbox.enqueued` | D | `sessionID, inboxID, item: {type: "user"|"synthetic"|"compaction"|"move", payload, delivery: "steer"|"queue"}` |
| `session.inbox.delivered` | D | `sessionID, inboxID` (input consumed by the loop) |
| `session.inbox.cancelled` / `session.inbox.delivery.changed` | D | `sessionID, inboxID[, delivery]` |
| `session.synthetic` | D | `sessionID, text, description?, metadata?` (server-injected message, e.g. after restart) |

### Execution (working / done)

| Type | D/E | `data` | Meaning |
| --- | --- | --- | --- |
| `session.execution.started` | D | `sessionID` | **Assistant working.** Published when the run coordinator starts a drain; commit also `claim`s the session (`time_suspended` set). |
| `session.execution.succeeded` | D | `sessionID` | **Turn finished, idle.** Commit `release`s the session. |
| `session.execution.failed` | D | `sessionID, error: { type: string, message: string, status?: 100..599 }` | **Finished with error, idle.** `Session.StructuredError`. Also emitted by restart recovery when resume attempts exceed 10 with `error.type = "aborted"`. |
| `session.execution.interrupted` | D | `sessionID, reason: "user" \| "shutdown" \| "superseded"` | **Stopped, idle** (`user` = `/interrupt`; `shutdown` = server going down, session stays claimed for auto-resume; `superseded` = replaced by another drain). |

Source: `@opencode-ai/core@beta-19086/dist/chunks/schema-r9srg7kj.js` (`SessionExecution` layer: `started`/`settled` callbacks, `terminal()`), `dist/chunks/schema-f8wvq04h.js` (`SessionRunCoordinator`).

### Steps, text, reasoning, tools (activity)

| Type | D/E | `data` (besides `sessionID`) |
| --- | --- | --- |
| `session.step.started` | D | `assistantMessageID, agent, model, snapshot?` |
| `session.step.streamed` | D | `assistantMessageID` (provider response body finished) |
| `session.step.ended` | D | `assistantMessageID, finish, rawFinish?, providerState?, cost, tokens, snapshot?, files?` |
| `session.step.failed` | D | `assistantMessageID, error: StructuredError, finish?: "content-filter", cost?, tokens?, ...` |
| `session.text.started` / `session.text.ended` | D | `assistantMessageID, ordinal[, text, state?]` |
| `session.text.delta` | E | `assistantMessageID, ordinal, delta` |
| `session.reasoning.started` / `.ended` | D | `assistantMessageID, ordinal[, text]` |
| `session.reasoning.delta` | E | `assistantMessageID, ordinal, delta` |
| `session.tool.input.started` | D | `assistantMessageID, id, name` |
| `session.tool.input.delta` | E | `assistantMessageID, id, delta` |
| `session.tool.input.ended` | D | `assistantMessageID, id, text` |
| `session.tool.called` | D | `assistantMessageID, id, input: Record, executed: boolean, state?` (**tool running**) |
| `session.tool.progress` | E | `assistantMessageID, id, metadata: Record` (live progress of a running tool) |
| `session.tool.success` | D | `assistantMessageID, id, content: Content[], metadata?, executed, resultState?` |
| `session.tool.failed` | D | `assistantMessageID, id, error: StructuredError, content?, metadata?, executed` |
| `session.shell.started` / `session.shell.ended` | D | `shell: Shell.Info[, output]` |
| `session.usage.updated` | E | `cost, tokens` |
| `session.retry.scheduled` | D | `assistantMessageID, attempt, at, error: StructuredError` (transient provider error; loop still running) |
| `session.compaction.started` / `.delta` / `.ended` / `.failed` | D/E/D/D | `reason: "auto"|"manual", ...` |
| `session.skill.activated`, `session.instructions.updated`, `session.revert.*`, `session.message.content.updated` | D | misc |

### Permission and forms

`@opencode-ai/schema@beta-19086/dist/permission.js`, `dist/form.js`:

| Type | D/E | `data` |
| --- | --- | --- |
| `permission.asked` | E | `id: "per_...", sessionID, action: string, resources: string[], save?: string[], metadata?: Record, source?: { type: "tool", messageID, id }, message?: string` |
| `permission.replied` | E | `sessionID, requestID, reply: "once" \| "always" \| "reject"` |
| `form.created` | E | `form: Form.Info` (v2 replacement for 1.x `question.asked`) |
| `form.replied` / `form.cancelled` | E | `id, sessionID[, answer]` |

Pending requests: `GET /api/session/{sessionID}/permission` -> `{ data: Request[] }`; `GET /api/permission/request?location[directory]=...` -> `{ location, data }`. Reply: `POST /api/session/{sessionID}/permission/{requestID}/reply`. (Local OpenAPI.)

### Server / misc

| Type | D/E | `data` |
| --- | --- | --- |
| `server.connected` | E | `{}` - first frame of every `/api/event` connection (synthetic, no `created`). |
| `global.disposed` | E | `{}` - defined in `dist/server-event.js`; no publisher found in core/server 19086. Unverified. |
| `installation.updated`, `installation.update-available`, `plugin.added` (17823) / `plugin.updated` (19086), `project.updated`, `worktree.*`, `vcs.branch.updated`, `pty.*`, `shell.*`, `mcp.*`, `filesystem.changed`, `config.updated`, ... | | Noise for Atlas. |

### Defined but not published (do not depend on)

`@opencode-ai/schema@beta-19086/dist/session-status-event.js` still defines:

```ts
Status = Event.ephemeral({ type: "session.status", schema: { sessionID, status: {type:"idle"} | {type:"busy"} | {type:"retry", attempt, message, action?, next} } })
Idle   = Event.ephemeral({ type: "session.idle",   schema: { sessionID } })   // comment: "deprecated"
```

They are in the public manifest (`EventManifest.ServerDefinitions`, comment "Current events the TUI consumes from the public stream") but `grep` over `@opencode-ai/core@beta-19086` and `@opencode-ai/server@beta-19086` found no `bus.publish` of either. The binary contains each literal exactly once (schema only). The 1.x publisher is `packages/opencode/src/session/status.ts` on `dev` (in-memory `Map<SessionID, Info>` per instance; `set()` publishes `session.status` and, on idle, `session.idle`; l.26-48), and `packages/opencode` does not exist on the `beta` branch. `session.error` (1.x, `packages/schema/src/v1/session.ts` l.651-657 on `dev`) is absent from the v2 union entirely (`beta` `event-manifest.ts`: `coreDefinitions = SessionEvent.Definitions` only).

## 4. Reliable "turn finished / idle" signal

1. Primary: the durable terminal execution events for the run's `sessionID`: `session.execution.succeeded` | `session.execution.failed` | `session.execution.interrupted`. These come from `SessionRunCoordinator.settled` after the drain fiber exits, so nothing is still running for that session once they arrive. Queued prompts (`delivery: "queue"`) cause a new `session.execution.started` afterwards, so treat "idle" as "no started since last terminal".
2. Confirmation / polling: `GET /api/session/active` -> `{ data: { [sessionID]: { type: "running" } } }` ("Retrieve foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive."). Backed by the in-memory `executions` map. Verified live: `{"data":{}}` when nothing runs.
3. Blocking: `POST /api/session/{sessionID}/wait` -> 204 when idle ("Wait for a session agent loop to become idle"); implemented as `execution.awaitIdle` on the same map, returns immediately when the session has no execution. Verified live: 204 in 60 ms on an idle session. 404 `{"_tag":"SessionNotFoundError"}` for unknown ids; 503 possible.
4. Outcome after the fact: `Session.Info.outcome: "succeeded" | "failed" | "interrupted"` and `time.idle` are written by the projector on terminal events (`@opencode-ai/core@beta-19086/dist/chunks/schema-a6mq1kfm.js` `projectIdle`). **Not in beta-17823**: the local OpenAPI `Session.Info` has `time: { created, updated, archived? }` and no `outcome`. Available from 19086 onward.

Do not use `session.step.ended` as "done": a step ends before tool results are fed back and the next step starts.

## 5. Activity signals for stall detection

Reset the stall timer on any event whose `data.sessionID` matches the run and whose `type` starts with `session.` except `session.viewed`, `session.renamed`, `session.inbox.*` from Atlas itself. Highest-value ones: `session.execution.started`, `session.step.started`, `session.step.streamed`, `session.step.ended`, `session.text.delta`, `session.reasoning.delta`, `session.tool.input.delta`, `session.tool.called`, `session.tool.progress`, `session.tool.success`, `session.tool.failed`, `session.shell.started`/`ended`, `session.usage.updated`, `session.retry.scheduled`, `session.compaction.*`.

Notes:
- `session.retry.scheduled` carries `at` (epoch ms of the next attempt); a provider backoff can legitimately be silent until then. Consider extending the deadline to `at + margin`.
- `permission.asked` without a `permission.replied` means the agent is blocked on a human, not stalled. Atlas should treat "pending permission" as its own state (it has no timer in opencode2).
- Long tool runs emit `session.tool.progress` only if the tool reports progress; a silent tool (e.g. a long test suite via bash) shows nothing between `session.tool.called` and `session.tool.success`. `GET /api/shell` lists running shell commands (`ShellInfo.status: "running" | "exited" | "timeout" | "killed"`) if Atlas wants a second opinion.
- Heartbeat comments (`: heartbeat`) are transport liveness only; the client discards them.

Cancel on stall: `POST /api/session/{sessionID}/interrupt` (query `continue=true|false`) -> 204; publishes `session.execution.interrupted` with `reason: "user"`; "Idle interruption is a no-op." (Local OpenAPI.) Beta client: `session.interrupt({ sessionID, continue? })` -> `{ interrupted: boolean }`.

## 6. After an Atlas restart

1. `GET /api/health` -> `{ healthy: true, version, pid }` (verified). `pid` changes when the server restarted; useful to detect a server restart between Atlas runs.
2. `GET /api/session` -> `{ data: Session.Info[], cursor: { previous?, next? } }`, newest first by default. Query: `workspace, limit, order: asc|desc, search, parentID, directory, project, subpath, cursor` ("Items keep that order across pages; use cursor.next or cursor.previous"). Global across directories; `?directory=<run dir>` filters to one run directory (verified: empty list for the temp dir, populated without the filter). Since Atlas stores the session id per run, prefer `GET /api/session/{sessionID}` per run (404 `SessionNotFoundError` if deleted).
3. `GET /api/session/active` -> running set. Any Atlas run whose session is absent is idle; decide succeeded/failed from (a) `Session.Info.outcome` when the server is >= 19086, or (b) `GET /api/session/{sessionID}/message` (last assistant message) on 17823, or (c) the PR link on GitHub.
4. Resubscribe to `/api/event` **before** step 3 so nothing is missed between the snapshot and the subscription; then reconcile.
5. Session.Info fields (17823): `id, parentID?, fork?, projectID, agent?, model?, cost, tokens{input,output,reasoning,cache{read,write}}, time{created,updated,archived?}, title?, location{directory,workspaceID?}, subpath?, revert?`. 19086 adds `outcome?`, `time.idle?`, `time.viewed?`, `metadata?`.

## 7. Server restart behaviour

- Stream: the TCP connection closes; `@opencode-ai/client` ends the async iterable (no error if the body ended cleanly, `ClientError("Transport")` if the read threw). No replay on reconnect (`/api/event` is volatile; per-session durable replay only exists in newer builds).
- Running sessions at shutdown: the drain fiber is interrupted, `session.execution.interrupted { reason: "shutdown" }` is published **without** releasing the claim (`schema-r9srg7kj.js`: `outcome.reason === "shutdown" ? undefined : releaseOnCommit(sessionID)`), so `time_suspended` stays set in SQLite.
- On boot `SessionRestart.resumeSuspendedSessions` (`@opencode-ai/core@beta-19086/dist/session/execution/restart.js`): for each suspended top-level session not already active, increment `resume_attempts`; if `> 10` publish `session.execution.failed` with `{ type: "aborted", message: "Execution was interrupted repeatedly and will not be resumed automatically." }` and release; otherwise publish `session.synthetic` with text "The server restarted while you were working. Continue from where you left off without repeating completed work." and `execution.resume(sessionID)`. Background shell jobs that were running are reported to the session as cancelled; subagent children are resumed similarly.
- Consequence for Atlas: after reconnecting it will see `session.execution.started` for runs that were in flight, then normal activity. Atlas should not treat the gap as a stall; it should reset stall timers on reconnect.
- Not verified on 17823 (logic read from 19086 core). The `session_v2.time_suspended` column and `resume_attempts` exist in the 19086 migrations.

## 8. Stable 1.x vs beta diff

| | Stable `@opencode-ai/sdk@1.18.27` (v1 API) | Beta (`@opencode-ai/client@beta`, server 17823/19086) |
| --- | --- | --- |
| Client | `createOpencodeClient({ baseUrl, directory? })`; `client.event.subscribe()` -> `{ stream }` | `OpenCode.make({ baseUrl, headers })`; `client.event.subscribe({ signal })` -> `AsyncIterable<V2Event>` |
| Stream route | `GET /event` scoped by `x-opencode-directory` header / `?directory=` (client rewrites header to query); `GET /global/event` wraps `{ directory, payload }` | `GET /api/event`, global, no params; scope inside envelope `location` |
| Envelope | `{ type, properties }` | `{ id, created, type, location?, data, durable?, metadata? }` |
| Idle | `session.idle { sessionID }`, `session.status { sessionID, status: idle\|busy\|retry }`; `GET /session/status` -> `Record<id, SessionStatus>` | `session.execution.succeeded\|failed\|interrupted`; `GET /api/session/active`; `POST /api/session/{id}/wait` |
| Working | `session.status busy`, `message.updated`, `message.part.updated { part, delta? }` | `session.execution.started`, `session.step.*`, `session.*.delta`, `session.tool.*` |
| Error | `session.error { sessionID?, error: ProviderAuthError\|UnknownError\|MessageOutputLengthError\|MessageAbortedError\|ApiError }` | `session.execution.failed { error: {type, message, status?} }`, `session.step.failed`, `session.tool.failed`, `session.retry.scheduled` |
| Permission | `permission.updated` / `permission.asked` (`{ id, sessionID, permission, patterns, metadata, always, tool? }`), `permission.replied` | `permission.asked { id, sessionID, action, resources, save?, metadata?, source?, message? }`, `permission.replied { reply: once\|always\|reject }` |
| Questions | `question.asked/replied/rejected` | `form.created/replied/cancelled` |
| Session events | `session.created/updated/deleted { info: Session }` | `session.created { sessionID, ... }`, `session.deleted { sessionID }`, no `session.updated` (use `session.renamed`, `session.usage.updated`, ...) |
| Abort | `POST /session/:id/abort` | `POST /api/session/{id}/interrupt?continue=` |
| Prompt | `POST /session/:id/message` (waits) / `prompt_async` | `POST /api/session/{id}/prompt` (durably admits, returns inbox item; `resume: false` to not run) |
| Auth | Optional (`OPENCODE_SERVER_PASSWORD`) | Basic auth required by default; server prints a generated password |
| Persistence of events | none | Durable events stored per session (`durable.seq`); replay endpoint only in builds newer than 17823 |

The stable SDK's `dist/v2` subpath (`@opencode-ai/sdk@1.18.27/dist/v2/`) targets a *different* server generation: it is generated from `dev`'s `packages/schema/src/session-event.ts` (`session.next.*` names, `permission.v2.asked`, `question.v2.*`) and `dev`'s in-progress `packages/server`, and it includes `/api/session/{id}/event`. Neither matches the local binary, which is built from the `beta` branch (`dev...beta`: beta is ~2960 commits ahead / ~1162 behind, a divergent rewrite). Do not use it.

1.x source pointers (dev): `/event` handler `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` (directory filter l.35-40, ends stream on `server.instance.disposed` l.42-61, 10 s `server.heartbeat` l.63-66, frame `{id, type, properties}`); `/global/event` handler `handlers/global.ts` l.25-57 (`{directory, project?, workspace?, payload}`); directory resolution `middleware/workspace-routing.ts` l.86-88 (`?directory` > `x-opencode-directory` > `process.cwd()`); `GET /session/status` `groups/session.ts` l.48, 77-79 (only non-idle sessions; empty after restart); legacy event schemas `packages/schema/src/v1/session.ts` l.572-657, `v1/permission.ts` l.27-66, `v1/question.ts` l.35-66.

## 9. Not verified / open

- No live capture of `session.execution.*`, `session.step.*`, `permission.asked` on 17823 (would require an LLM prompt, which was out of bounds). Names confirmed only via `strings` on the binary and the 19086 schema.
- Whether 17823 publishes `session.status`/`session.idle` at all (no publisher in 19086 packages; literal appears once in the binary).
- Who publishes `global.disposed`, if anyone.
- Which env var / flag sets the serve password in beta (`OPENCODE_SERVER_PASSWORD` and `OPENCODE_PASSWORD` both present in the binary; neither tested).
- Exact `wait` timeout behaviour on a busy session (only the idle path was exercised) and when it returns 503.
- Whether `SessionRestart` runs in 17823 (read from 19086 core).
- The `beta` branch HEAD inspected (`b09a745...`) is newer than both 17823 and 19086; line numbers cited for `packages/protocol` and `packages/server` come from that HEAD, the payload shapes from the 19086 npm build. No mismatch was found between the two, but 17823 was only checked via `strings` and its own `/openapi.json`.
- The stable 1.x server behaviour (section 8) was read from `dev` source, not run.

## Appendix: raw captures

`GET /api/session?limit=2` (17823):

```json
{"data":[{"id":"ses_f93d06c15ffeLxX6XsmIDdwYxJ","projectID":"6da7ea13...","agent":"build","model":{"id":"...","providerID":"openai","variant":"max"},"cost":0,"tokens":{"input":57824,"output":1498,"reasoning":1241,"cache":{"read":321024,"write":0}},"time":{"created":1788521452552,"updated":1788521455008},"title":"Commit current diff","location":{"directory":"/Users/alpha/Developer/Maji/rekonix"}}, ...],
 "cursor":{"previous":"eyJhbmNob3IiOn...","next":"eyJhbmNob3IiOn..."}}
```

`GET /api/session/active` -> `{"data":{}}`. `POST /api/session/{id}/wait` -> 204. `GET /api/session/ses_doesnotexist` -> 404 `{"_tag":"SessionNotFoundError","sessionID":"ses_doesnotexist","message":"Session not found: ses_doesnotexist"}`. `GET /api/health` -> `{"healthy":true,"version":"0.0.0-beta-17823","pid":90775}`. `GET /api/location` (cwd `/tmp/...`) -> `{"directory":"/private/tmp/atlas-research/oc-cwd","project":{"id":"global","directory":"/","canonical":"/"}}`.

Local `/openapi.json` paths relevant to Atlas: `GET /api/health`, `GET /api/server`, `GET /api/location`, `GET/POST /api/session`, `GET /api/session/active`, `GET/DELETE /api/session/{sessionID}`, `POST /api/session/{sessionID}/prompt`, `POST /api/session/{sessionID}/wait`, `POST /api/session/{sessionID}/interrupt`, `GET /api/session/{sessionID}/message`, `GET /api/session/{sessionID}/permission`, `POST /api/session/{sessionID}/permission/{requestID}/reply`, `GET /api/permission/request`, `GET /api/event`, `GET /api/shell`.
