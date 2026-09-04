# 02 - opencode2 events: SSE stream, idle and error detection, activity signals, reconnecting
Type: research
Status: resolved
Blocked by:

## Question

Against the opencode2 beta ("version 2"):

1. How does Atlas subscribe to the server's event stream (SSE) via the SDK? Is the stream global or per session?
2. Catalogue the event types. Which ones signal: session started, assistant working, tool running, assistant idle or done, error, session deleted, permission asked?
3. What is the reliable signal that a session has finished its turn and is idle?
4. Which events count as "activity" for stall detection?
5. After Atlas restarts: how does it list existing sessions, read their status, and resume watching them?
6. What happens to the stream when the server restarts?

Answer with exact event names, payload shapes, and source links. Flag anything that differs between the stable 1.x SDK and the beta.

## Answer

Research: [research/02-opencode2-events.md](../research/02-opencode2-events.md)

1. **Subscribe**: use `@opencode-ai/client@beta` (the beta `@opencode-ai/sdk` is an in-process host, not an HTTP client). `OpenCode.make({ baseUrl, headers: { Authorization: "Basic " + btoa("opencode:" + pw) } }).event.subscribe({ signal })` -> `AsyncIterable<V2Event>` over `GET /api/event`. The stream is **global** (all directories, all sessions, no params); route by `data.sessionID`. First frame `server.connected`, heartbeat comment every 15 s, 4096-event dropping queue per subscriber (overflow fails the stream), no client auto-reconnect. Basic auth is required on every `/api/*` route; `opencode2 serve` prints a generated password.
2. **Envelope**: `{ id, created, type, location?: {directory, workspaceID?}, data, durable?: {aggregateID, seq, version} }`. Key events (`data` always has `sessionID`):
   - started: `session.created` (`projectID, location, agent?, model?, ...`)
   - working: `session.execution.started`
   - tool running: `session.tool.called` (`id, input, executed`), `session.tool.progress`, then `session.tool.success` / `session.tool.failed` (`error: {type, message, status?}`)
   - done/idle: `session.execution.succeeded` | `session.execution.failed` (`error`) | `session.execution.interrupted` (`reason: user|shutdown|superseded`)
   - error: `session.execution.failed`, `session.step.failed`, `session.retry.scheduled` (transient, has `at`)
   - deleted: `session.deleted`
   - permission: `permission.asked` (`id, sessionID, action, resources, save?, metadata?, source?, message?`) / `permission.replied` (`reply: once|always|reject`); questions are now `form.created/replied/cancelled`
3. **Idle signal**: the durable terminal `session.execution.*` event for the session. Confirm with `GET /api/session/active` (`{data: {[id]: {type:"running"}}}`) or block on `POST /api/session/{id}/wait` (204 when idle). `session.status`/`session.idle` are still in the schema but have no publisher in the v2 core/server; do not rely on them.
4. **Activity**: any `session.*` event with the run's `sessionID` between started and terminal (step/text/reasoning/tool deltas, tool called/progress/success/failed, shell, usage, retry, compaction). Treat pending `permission.asked` as "blocked on human", not a stall. `session.retry.scheduled.at` gives the next attempt time. Cancel with `POST /api/session/{id}/interrupt`.
5. **After Atlas restart**: `GET /api/health` (`pid` reveals a server restart), resubscribe to `/api/event` first, then `GET /api/session/{id}` per stored run id (or `GET /api/session?directory=<run dir>`; list is global, cursor-paginated), then `GET /api/session/active` to split running vs idle. On beta-17823 `Session.Info` has no `outcome`/`time.idle` (added in 19086), so idle outcome comes from the last message or the PR.
6. **Server restart**: stream closes with no replay ("events during disconnection are missed"). In-flight sessions get `session.execution.interrupted {reason:"shutdown"}` and stay claimed; on boot the server injects a synthetic "The server restarted while you were working" message and auto-resumes them (max 10 attempts, then `session.execution.failed {type:"aborted"}`). Atlas should reconnect, resync, and reset stall timers.

**1.x vs beta**: v1 `/event` is per-directory (`x-opencode-directory`) with `{type, properties}` envelopes, `session.idle`/`session.status`/`session.error`, `GET /session/status`, `POST /session/:id/abort`. Beta: `/api/event` global, `{id, created, type, location?, data}` envelopes, `session.execution.*`, `/api/session/active`, `/wait`, `/interrupt`, mandatory basic auth. The stable SDK's `dist/v2` subpath targets a newer server (`session.next.*` names, `/api/session/{id}/event` replay) that the local binary does not have.

**Unverified**: no live capture of `session.execution.*`/`permission.asked` (needs an LLM prompt); whether 17823 emits `session.status`; which env var sets the password; restart-resume logic read from 19086 core, not 17823.
