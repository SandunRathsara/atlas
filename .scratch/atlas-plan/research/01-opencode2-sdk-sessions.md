# opencode2 beta: connect, create a session in a run directory, prompt, read result, abort

Ticket: [issues/01-opencode2-sdk-sessions.md](../issues/01-opencode2-sdk-sessions.md)
Researched: 2026-09-04. Everything below was checked against primary sources (binary, npm tarballs, the `anomalyco/opencode` `beta` branch, a live isolated server). Unverified points are marked **[unverified]**.

## TL;DR

- **Package:** `@opencode-ai/client` (Promise entry), NOT `@opencode-ai/sdk`. In v2 the `sdk` package is an in-process embedded host; `client` is the network client. Pin the exact server build: `@opencode-ai/client@0.0.0-beta-17823` for the local binary (or `@beta` = `0.0.0-beta-19086` if the server is upgraded). [S2][S4][S5]
- **Directory binding:** per **session**, not per server. `POST /api/session` takes `location: { directory }` and stores it on the session row; every `/api/session/{id}/...` route resolves the directory from that row. Location-scoped routes without a session (e.g. `/api/agent`) take `x-opencode-directory` (URL-encoded) or `?location[directory]=`. Server cwd is only the fallback. [S6][S7][S10]
- **Auth:** HTTP Basic, username `opencode`, password from `OPENCODE_SERVER_PASSWORD` (or `OPENCODE_PASSWORD`) for `opencode2 serve`; for `serve --service` a persisted random password (`opencode2 pair` prints it). Bearer is rejected. [S8][S10]
- **Flow:** `session.create` -> `session.prompt` -> `session.wait` (long-poll until idle) -> `message.list(order desc)` first `type === "assistant"` -> `session.interrupt` / `session.remove`. [S7][S10][S11]

## 1. Package and version

| Fact | Value | Source |
|---|---|---|
| Local binary | `opencode2 v0.0.0-beta-17823`, symlink to `~/.local/lib/node_modules/@opencode-ai/cli/bin/opencode2.exe`; `package.json` = `@opencode-ai/cli@0.0.0-beta-17823`, repo `anomalyco/opencode` | [S1] |
| `@opencode-ai/cli` dist-tags | `latest` = `next` = `0.0.0-beta-17823`, `beta` = `0.0.0-beta-19086`, `dev` = `0.0.0-dev-19094` | [S2] |
| `@opencode-ai/client` dist-tags | `latest` = `0.0.0` (placeholder), `beta` = `0.0.0-beta-19086`, `dev` = `0.0.0-dev-19094`, `next` = `0.0.0-next-17444`. `0.0.0-beta-17823` exists. | [S2] |
| `@opencode-ai/sdk` dist-tags | `latest` = `1.18.27` (stable v1), `beta` = `0.0.0-beta-19086`. `0.0.0-beta-17823` does NOT exist (npm 404). | [S2] |
| What `sdk@beta` is | "In-process OpenCode host ... opening no listener and adding no network hop" (README). Depends on `@opencode-ai/server`, `core`, `effect`. Not for connecting to a running server. | [S5] |
| What `client@beta` is | "TypeScript client for the OpenCode HTTP API. Use it when your application connects to an OpenCode server over the network." Root entry is Promise/fetch based; runtime imports only `./generated/index.js` and `./client-error.js` (no `effect`, no Node builtins) so it runs on Bun. `effect` is an optional peer. | [S4][S11] |
| Source branch | Beta builds publish from branch `beta` (`.github/workflows/publish.yml`, `GH_REPO: anomalyco/opencode-beta`). Releases: `v0.0.0-beta-17823` 2026-08-21, `v0.0.0-beta-19086` 2026-09-04. No git tags for beta builds in `anomalyco/opencode`; exact commit of 17823 **[unverified]**. `dev` branch has diverged (CLI bin renamed, `packages/sdk-next`), so cite `beta`. | [S3] |
| Version check | Server `GET /api/health` returns `{ healthy: true, version, pid }`; local returns `"0.0.0-beta-17823"`. The CLI itself refuses mismatched server/client versions (`versionBelongsToChannel`, exact match). Atlas should compare `health.get().version` with the pinned client version at startup. | [S8][S10] |

Install: `bun add @opencode-ai/client@0.0.0-beta-17823` (match the binary). Docs say `bun add @opencode-ai/client@beta` and warn "Method names, inputs, and outputs may change before the stable release." [S4]

## 2. Connect to a running server

```ts
import { OpenCode } from "@opencode-ai/client"

const client = OpenCode.make({
  baseUrl: "http://opencode-host:4096",
  headers: { authorization: "Basic " + btoa(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`) },
})
```

- `ClientOptions = { baseUrl: string; fetch?: typeof fetch; headers?: RequestInit["headers"] }`. Every operation takes `RequestOptions = { signal?: AbortSignal; headers? }` as its last argument. [S11]
- Auth is HTTP Basic only. Username defaults to `opencode` (`OPENCODE_SERVER_USERNAME` overrides). 401 carries `www-authenticate: Basic realm="Secure Area"`. Bearer -> 401. [S8][S10]
- Password source depends on how the server was started (`packages/cli/src/server-process.ts`):
  - `opencode2 serve` (foreground): `OPENCODE_PASSWORD` or `OPENCODE_SERVER_PASSWORD`; if neither is set a random one is generated and printed as `server password <value>`. Default hostname `127.0.0.1`; `--port` optional.
  - `opencode2 serve --service` (background service): password from `~/.config/opencode/service.json` (`opencode2 service set password <value>`), else generated once and persisted; default port `0xc0de` = 49374; registration in `~/.local/state/opencode/service.json` (`$XDG_STATE_HOME`). `opencode2 pair` prints URLs, username, password. [S8]
- Optional same-host discovery: `import { Service } from "@opencode-ai/client/service"`; `Service.discover()` -> `{ url, auth: { type: "basic", username, password } }`; `Service.headers(endpoint)` -> `{ authorization }`. Node-only (uses `node:fs`), fine on Bun. [S4][S11]
- OpenAPI 3.1 spec: `GET /openapi.json` (auth required). `/doc` returns the web UI HTML on 17823, not the spec. [S9][S10]

## 3. Bind a session to the run directory

**Answer: per session. No per-server cwd needed, one server serves any number of directories.**

- `POST /api/session` body `{ id?, title?, agent?, model?, location?: { directory, workspaceID? }, metadata? (19086+) }` -> `{ data: Session.Info }`. Handler: `location: ctx.payload.location ?? { directory: process.cwd() }`. [S7][S6]
- All `/api/session/{sessionID}/...` routes use `SessionLocationMiddleware`, which reads `SessionTable.directory` for that session from the DB and provides it as the Location. The directory travels with the session. [S6]
- Location-scoped, session-less routes (`/api/agent`, `/api/location`, `/api/model`, ...) resolve `?location[directory]=` first, then `x-opencode-directory` (percent-decoded), then `process.cwd()`. In the client: `client.agent.list({ location: { directory } })`. [S6][S11]
- `directory` must be absolute (`AbsolutePath`). Live: relative path -> HTTP 500; a nonexistent absolute path is accepted (session gets `projectID: "global"`), so Atlas must create the clone first and validate itself. `projectID` for a git clone is derived from the repo (`packages/core/src/project.ts`, git remote / root commit hash). [S10]
- Listing per directory: `GET /api/session?directory=<abs>`; observed it returns only that directory's sessions. [S10]
- Side effect: the server writes snapshot git dirs under `$XDG_DATA_HOME/opencode/snapshot/<projectID>/...` for each project it touches. [S10]

```ts
const session = await client.session.create({
  title: `spec #${issue.number}`,
  agent: "atlas-implementer",          // Agent.ID string, see 4
  location: { directory: runDir },     // absolute path to the clone
})
// session.id: "ses_...", session.location.directory === runDir, session.projectID
```

## 4. Prompt with a named agent

- Agent is set on the session: `agent?: Agent.ID` (a branded string; ids observed: `build`, `plan`, `general`, `explore`, ...). Can be changed later with `POST /api/session/{id}/agent` (`client.session.switchAgent({ sessionID, agent })`). Unknown agent names are accepted at create time (no validation) **[observed]**; check `client.agent.list({ location: { directory } })` first and prefer `mode: "primary"` agents. [S7][S10][S11]
- `POST /api/session/{sessionID}/prompt` body `{ id?, text, files?, agents?, skills?, metadata?, delivery?: "steer" | "queue", resume?: boolean }` -> `{ data: Session.Inbox.User }` (`{ id: "msg_...", sessionID, timeCreated, type: "user", payload: { text, ... }, delivery }`). Description: "Durably admit one session input and schedule agent-loop execution unless resume is false." Errors: 409 ConflictError, 400 InvalidRequestError, 404 SessionNotFoundError. `delivery` defaults to `"steer"`. The `agents` array is for @-mentioning subagents, not for choosing the session agent. [S7][S10][S11]

```ts
await client.session.prompt({ sessionID: session.id, text: specPrompt })
```

## 5. Read the last assistant message when the session finishes

Two ways to know it finished:

1. `client.session.wait({ sessionID })` -> `POST /api/session/{id}/wait`, "Wait for a session agent loop to become idle." 204 when idle (returns immediately on an idle session, ~2 ms; returned after 2.5 s once a prompted turn finished). Core: `execution.awaitIdle(sessionID)`. Errors: 404, 503 ServiceUnavailableError (condition **[unverified]**). No documented server-side timeout **[unverified]**; pass `{ signal }` to bound it. [S7][S10]
2. `client.event.subscribe({ signal })` -> `GET /api/event` SSE, `AsyncIterable<V2Event>`. Relevant events (`data.sessionID`): `session.execution.started`, `session.execution.succeeded`, `session.execution.failed` (`data.error`), `session.execution.interrupted` (`data.reason: "user" | "shutdown" | "superseded"`), `session.idle`, `session.status` (`data.status.type: "idle" | "busy" | "retry"`), `permission.asked`. Live-only, no replay, no auto-reconnect; the first event after connect is `server.connected`. [S4][S11]

Then read messages: `client.message.list({ sessionID, order: "desc", limit: 20 })` -> `GET /api/session/{id}/message` -> `{ data: SessionMessageInfo[], cursor: { previous?, next? } }`; `limit` max 200. Pick the first item with `type === "assistant"`:

```ts
type Assistant = { type: "assistant"; id; agent; model; finish?: "stop"|"length"|"tool-calls"|"content-filter"|"error"|"unknown";
  error?: SessionStructuredError; time: { created; completed? };
  content: Array<{ type: "text"; text } | { type: "reasoning"; ... } | { type: "tool"; name; state; ... }> }
const last = page.data.find(m => m.type === "assistant")
const text = last?.content.filter(c => c.type === "text").map(c => c.text).join("")
```

Observed after one prompt: `[assistant {finish:"stop", content:[reasoning,text]}, user {text}]`. Alternatives: `client.session.context({ sessionID })` (messages since last compaction), `client.session.get` (19086 adds `outcome: "succeeded" | "failed" | "interrupted"` and `time.idle`; absent on 17823). [S10][S11][S12]

## 6. Abort and delete

| Op | HTTP | Client | Notes |
|---|---|---|---|
| Interrupt running turn | `POST /api/session/{id}/interrupt?continue=` | `client.session.interrupt({ sessionID, continue? })` | "Interrupt active execution owned by this OpenCode process. Idle interruption is a no-op." 17823: 204 / `Promise<void>`. 19086: `{ interrupted: boolean }`. Emits `session.execution.interrupted` with `reason: "user"`. [S7][S11][S12] |
| Cancel a queued prompt | `DELETE /api/session/{id}/inbox/{inboxID}` | `client.session.inbox.cancel({ sessionID, inboxID })` | inboxID = the `msg_` id returned by `prompt`; 409 if already delivered. [S9] |
| Delete session | `DELETE /api/session/{id}` | `client.session.remove({ sessionID })` | 204; "Delete a session and its child sessions." Afterwards GET -> 404 `{ _tag: "SessionNotFoundError" }`. Whether delete interrupts a running turn first is **[unverified]**; interrupt, wait, then remove. [S7][S10] |
| Active sessions | `GET /api/session/active` | `client.session.active()` | `{ [sessionID]: { type: "running" } }`; absent = inactive. Cheap liveness check for stall detection. [S9][S11] |

Errors are JSON `{ _tag, message, ... }` (e.g. `SessionNotFoundError`, `ConflictError`, `UnauthorizedError`). Client-side failures throw `ClientError` with `reason: "Transport" | "UnexpectedStatus" | "UnsupportedContentType" | "MalformedResponse" | "SseEventTooLarge"`. [S11]

## Stable 1.x vs beta v2

| | Stable `@opencode-ai/sdk@1.18.27` (v1) | Beta `@opencode-ai/client@0.0.0-beta-*` (v2) |
|---|---|---|
| Client | `createOpencodeClient({ baseUrl, directory?, headers?, fetch? })`; `directory` becomes `x-opencode-directory` header on every request | `OpenCode.make({ baseUrl, headers?, fetch? })`; no client-wide directory, directory lives on the session |
| Routes | unprefixed: `POST /session`, `POST /session/{id}/message`, `POST /session/{id}/prompt_async`, `POST /session/{id}/abort`, `DELETE /session/{id}`, `GET /session/{id}/message`, `GET /event`, `GET /global/event` | `/api/...`: `POST /api/session`, `POST /api/session/{id}/prompt`, `POST /api/session/{id}/interrupt`, `POST /api/session/{id}/wait`, `DELETE /api/session/{id}`, `GET /api/session/{id}/message`, `GET /api/event` |
| Create | `session.create({ body: { parentID?, title? }, query: { directory? } })` | `session.create({ title?, agent?, model?, location: { directory } })` |
| Prompt | `session.prompt({ path: { id }, body: { parts: [{ type: "text", text }], agent?, model?: { providerID, modelID }, noReply?, system?, tools? } })` (agent per message) | `session.prompt({ sessionID, text, files?, agents?, skills?, delivery?, resume? })` (agent per session) |
| Wait | none (poll or events) | `session.wait({ sessionID })` |
| Abort | `session.abort({ path: { id } })` -> boolean | `session.interrupt({ sessionID })` |
| Delete | `session.delete({ path: { id } })` -> boolean | `session.remove({ sessionID })` -> void |
| Messages | `session.messages()` -> `{ info: Message, parts: Part[] }[]` | `message.list()` -> `{ data: SessionMessageInfo[], cursor }`, paginated |
| Auth | Basic via `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` | same scheme; `OPENCODE_PASSWORD` also accepted; service mode persists a generated password |
| Spec | `GET /doc` | `GET /openapi.json` |
| Docs | https://opencode.ai/docs/sdk/ and /docs/server/ (v1 only, no v2 mention) | `packages/www/src/docs/content/build/client/index.mdx` on branch `beta`; not yet published (opencode.ai/docs/build/client and dev.opencode.ai/... -> 404 on 2026-09-04) |

Also: `@opencode-ai/sdk@1.18.27` ships a `./v2` subpath (`createOpencodeClient({ baseUrl, directory })` over `/api/...` routes, hey-api generated). It targets the 1.x server's experimental httpapi (`packages/opencode/src/server/routes/instance/httpapi/`), not the opencode2 server; compatibility with `opencode2 serve` **[unverified]**, do not use. [S13]

## 17823 vs 19086 drift (why pinning matters)

Client surface diff (`dist/promise/generated/client.d.ts`): `session.interrupt` `void` -> `{ interrupted }`; `session.command` returns `SessionInboxUser` -> `void`; added `session.stats`, `session.messageUpdate`, `session.view`, `plugin.awaitActivation/check/update`, `credential.activate`, `project.update`, `rpc.call`, `experimental.persistentPty.*`, `workspace.create/destroy`, `vcs.base/branches`. Types: `SessionCreateInput` + `metadata`; `SessionInfo` + `outcome`, `time.idle`, `time.viewed`, `metadata`; `SessionMessageAssistant.time` + `streamed`; event union gains `session.viewed`, `session.step.streamed`, `session.message.content.updated`, credential/project/persistent-pty events, `rpc`; drops `integration.connection.updated`, `plugin.added`. `SessionPromptInput`, `MessageListInput`, `LocationRef` unchanged. Peer `effect` `4.0.0-rc.110` -> `rc.112` (optional). [S12]

## Unverified / open

- Exact source commit for build 17823 (no git tag; releases live in `anomalyco/opencode-beta`, `targetCommitish: main`).
- Whether `DELETE /api/session/{id}` interrupts a running turn; when `wait` returns 503; whether `wait` has a server-side timeout.
- The probe's prompt got a real assistant reply with no credentials configured (isolated HOME/XDG); which provider answered was not checked. Model/provider setup is out of Atlas scope anyway.
- ctx7 (`/anomalyco/opencode`) only returned v1 SDK material; `/anomalyco/opencode-sdk-js` is a Stainless-generated repo last pushed 2026-02-03 and is not the v2 client.

## Sources

- [S1] Local binary: `/Users/alpha/.local/bin/opencode2 --version`, `--help`, `serve --help`; `/Users/alpha/.local/lib/node_modules/@opencode-ai/cli/package.json` (2026-09-04).
- [S2] `npm view @opencode-ai/{cli,sdk,client,schema,protocol,server,core} dist-tags --json`; `npm view @opencode-ai/client@0.0.0-beta-17823 version`; `npm view @opencode-ai/sdk@0.0.0-beta-17823` (404). Tarballs unpacked to `/tmp/oc2-sdk/` (ephemeral).
- [S3] https://github.com/anomalyco/opencode (sst/opencode 301-redirects there; default branch `dev` @ `31afdd5938a6105e6b8246c861555caa84bdfe81`), branch `beta` @ `b09a74591cbd4d2ea1488e56177898a13f21278d` (2026-09-04); `.github/workflows/publish.yml` lines 9, 64, 317; https://github.com/anomalyco/opencode-beta/releases/tag/v0.0.0-beta-17823 and `/v0.0.0-beta-19086`.
- [S4] `packages/www/src/docs/content/build/client/index.mdx` and `build/client/effect.mdx` @ beta `b09a745`.
- [S5] `packages/www/src/docs/content/build/sdk/index.mdx` @ beta `b09a745`; `@opencode-ai/sdk@0.0.0-beta-19086` README and `package.json`.
- [S6] `packages/server/src/location.ts` @ beta `b09a745` (lines 45-46) and dev `31afdd5` (lines 31-39); `packages/server/src/middleware/session-location.ts` (dev `31afdd5`, lines 30-63); `packages/server/src/handlers/session.ts` @ beta (lines 113-127).
- [S7] `packages/protocol/src/groups/session.ts` @ beta `b09a745` (session.create L170-187, session.prompt L338-358, session.wait L463-476, session.interrupt L666-685); `packages/protocol/src/groups/message.ts` and `groups/event.ts` (dev `31afdd5`); `packages/protocol/src/api.ts` (title "opencode HttpApi").
- [S8] `packages/server/src/auth.ts` (dev `31afdd5`, lines 31-32, 53-56); `packages/cli/src/env.ts`, `packages/cli/src/server-process.ts` (lines 55-80), `packages/cli/src/services/service-config.ts` (`filename`, `defaultPort`, `password`), `packages/cli/src/commands/handlers/pair.ts`, `packages/cli/src/commands/commands.ts` (L364-391, L407-420) @ beta `b09a745`; `packages/client/src/promise/service.ts` L128; `packages/www/src/docs/content/troubleshooting.mdx` L149-166; `packages/web/src/content/docs/server.mdx` L37-42 (= https://opencode.ai/docs/server/).
- [S9] OpenAPI document served by the local binary at `GET /openapi.json` (title "opencode HttpApi", version "0.0.1"); `packages/cli/src/commands/handlers/api.ts` (fetches `/openapi.json`).
- [S10] Live probe 2026-09-04: `opencode2 serve --hostname 127.0.0.1 --port <random>` in a temp cwd with `XDG_*_HOME`/`HOME` pointed at temp dirs and `OPENCODE_SERVER_PASSWORD` set; curl against `/api/health`, `/api/server`, `/api/location`, `/api/agent`, `/api/session` (create x4, get, list?directory=, delete), `/wait`, `/interrupt`, `/prompt`, `/message`, `/active`; process killed afterwards. Script: `/tmp/oc2-probe3.sh` (ephemeral).
- [S11] `@opencode-ai/client@0.0.0-beta-19086` `dist/promise/generated/client.d.ts` (ClientOptions L2-10, method table), `dist/promise/generated/types.d.ts` (SessionCreateInput, SessionPromptInput, SessionInfo, SessionMessageAssistant, MessageListInput, V2Event, SessionIdle, SessionExecution*, SessionStatus, AgentInfo), `dist/promise/generated/client-error.d.ts`, `dist/service.d.ts`, `dist/promise/index.js`.
- [S12] `diff` of the same files between `@opencode-ai/client@0.0.0-beta-17823` and `@0.0.0-beta-19086`.
- [S13] `@opencode-ai/sdk@1.18.27` `dist/client.d.ts`, `dist/gen/types.gen.d.ts` (SessionCreateData, SessionPromptData), `dist/v2/client.d.ts`; `packages/sdk/js/src/client.ts` L20-49 and `src/v2/client.ts` (dev `31afdd5`); `packages/web/src/content/docs/sdk.mdx` (= https://opencode.ai/docs/sdk/); ctx7 `/anomalyco/opencode` docs excerpt of `packages/sdk/js/src/gen/sdk.gen.ts`.
