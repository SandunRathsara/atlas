# 01 - opencode2 SDK: connect, create a session in a run directory, prompt, read result, abort
Type: research
Status: resolved
Blocked by:

## Question

Against the opencode2 beta ("version 2"), how does Atlas, from a Bun/TypeScript process:

1. Identify the right SDK package and version for the beta, and confirm the local `opencode2 v0.0.0-beta-17823` binary matches it.
2. Connect to an already-running opencode2 server at a URL (auth, headers).
3. Create a session bound to a specific directory (the run directory) on that server. Is there a per-request or per-session directory option, or does a server serve only its own cwd? If the latter, what is the cheapest way to get one session per directory?
4. Send a prompt to a session using a named agent.
5. Read the last assistant message when the session finishes.
6. Abort or cancel a running session, and delete it.

Answer with exact API names, request shapes, and source links. Flag anything that differs between the stable 1.x SDK and the beta.

## Answer

Research: [research/01-opencode2-sdk-sessions.md](../research/01-opencode2-sdk-sessions.md)

1. **Package:** `@opencode-ai/client` (Promise entry, fetch-based, Bun-safe), not `@opencode-ai/sdk` (in v2 that is an in-process embedded host). Pin the server build: `bun add @opencode-ai/client@0.0.0-beta-17823` matches the local `opencode2 v0.0.0-beta-17823` (`@opencode-ai/cli@latest`). `@beta` is `0.0.0-beta-19086` and already drifts (`interrupt` return type, new `SessionInfo.outcome`). Verify at startup: `client.health.get().version === pinned`.
2. **Connect:** `OpenCode.make({ baseUrl, headers: { authorization: "Basic " + btoa("opencode:" + password) } })`. Only HTTP Basic; Bearer is rejected. Password: `OPENCODE_SERVER_PASSWORD` (or `OPENCODE_PASSWORD`) for `opencode2 serve`; for `serve --service` it is persisted in `~/.config/opencode/service.json` (`opencode2 pair` prints it). Spec at `GET /openapi.json`.
3. **Directory binding is per session.** `client.session.create({ title, agent, location: { directory: runDir } })` stores the absolute path on the session; all `/api/session/{id}/...` calls resolve the directory from the session row (`SessionLocationMiddleware`). Session-less location routes (e.g. `agent.list({ location: { directory } })`) use `?location[directory]=` or `x-opencode-directory`. Server cwd is only a fallback, so one server serves every run directory. The path must be absolute (relative -> 500); nonexistent paths are accepted, so create the clone first.
4. **Prompt:** agent is a session property (`agent: "<Agent.ID>"`, e.g. `build`; switch with `session.switchAgent`). Then `client.session.prompt({ sessionID, text })` -> `Session.Inbox.User` (`msg_...`, `delivery: "steer"`). Unknown agent ids are not validated; check `agent.list` first.
5. **Result:** `await client.session.wait({ sessionID })` (long-polls until the agent loop is idle; pass `{ signal }`) or watch `event.subscribe()` for `session.execution.succeeded|failed|interrupted` / `session.idle`. Then `client.message.list({ sessionID, order: "desc", limit: 20 })` and take the first `type === "assistant"`; text = `content.filter(c => c.type === "text").map(c => c.text).join("")`; inspect `finish` and `error`.
6. **Abort/delete:** `client.session.interrupt({ sessionID })` (idle = no-op; 17823 returns void, 19086 `{ interrupted }`), `client.session.inbox.cancel` for queued prompts, `client.session.remove({ sessionID })` -> 204 (deletes children too). `session.active()` lists running sessions. Whether delete interrupts a running turn is unverified: interrupt, wait, then remove.

**Stable 1.x vs beta:** v1 = `@opencode-ai/sdk@1.18.27`, `createOpencodeClient({ baseUrl, directory })` with `x-opencode-directory` on every request, unprefixed routes (`POST /session`, `/session/{id}/message` with `parts` + per-message `agent`, `/abort`, `session.delete`, `/doc`). v2 = `/api/...` routes, directory on the session, `prompt` with `text`, `wait`, `interrupt`, `remove`, `/openapi.json`. The v2 docs exist only on the `beta` branch (`packages/www/src/docs/content/build/client/index.mdx`); opencode.ai/docs still documents v1.

**Unverified:** exact source commit for build 17823; `wait` 503 condition and timeout; delete-vs-running-turn semantics.
