# Atlas engineering plan

Label: wayfinder:map
Source: docs/feasibilty-study-handoff.md (superseded in parts; see Out of scope)
Glossary: CONTEXT.md

## Destination

A phased engineering plan in `docs/` for Atlas: a Bun + Hono + HTMX web app that lists `spec`-labelled GitHub issues per project, shows blockers, starts one opencode2 run per spec in an isolated clone, and shows run and PR status. Every plan area has a locked decision. Phase 1 is implementation-grade. Written for agents to execute via `/to-tickets` and `/implement-spec`; humans skim it.

## Notes

**Working style**
- The user has ADHD. Keep every message short and scannable.
- Skills: `grilling` + `domain-modeling` for decisions, `research` for docs, `prototype` for UI.
- Library docs: `rtk proxy npx ctx7@latest library|docs ...` before answering from memory.
- Tracker: local markdown. Map here, tickets in `issues/`, research notes in `research/`.
- Priorities from the handoff still hold: Autonomy > Observability > Reliability > Cost > Speed > Recoverability.

**Settled at charting**
- Stack: TypeScript on Bun, Hono, SQLite, HTMX server-rendered pages, SSE for live status. No build step.
- opencode2: target the beta ("version 2"). Local binary: `opencode2 v0.0.0-beta-17823`. Atlas uses only the `@opencode-ai/client` package (see the sessions decision) and connects to an already-running server at a configured URL.
- GitHub: Atlas is a GitHub App with webhooks in Phase 1. Blocking = GitHub's native issue dependencies. Run to PR link = GitHub's own linked-PR data (no research needed).
- Isolation: one full `git clone` per run into a run directory. Never worktrees; those belong to the agent. Local mirror as a speed-up is Phase 2+.
- Run rules: one active run per spec. Implement re-enabled after a run ends or its PR closes unmerged. Merged PR or closed issue = done. Global cap on concurrent runs.
- Stalls: stall detection only, no max duration. On stall: cancel session, mark run STALLED.
- Tenancy: single team, static bearer token, private network.
- Server: Omarchy (Arch-based), root access, Docker available. Run Atlas as a systemd service.
- Plan depth: all areas decided; Phase 1 implementation-grade; later phases low-res.

## Decisions so far

<!-- one line per resolved ticket: [title](issues/NN-slug.md): gist -->
- [opencode2 SDK sessions](issues/01-opencode2-sdk-sessions.md): one server, per-session directory via `session.create({ agent, location: { directory } })`; use `@opencode-ai/client` pinned to `0.0.0-beta-17823` (not `@opencode-ai/sdk`); HTTP Basic auth `opencode:<OPENCODE_SERVER_PASSWORD>`; flow prompt, `session.wait`, `message.list` desc first assistant, `interrupt` then `remove`; clone before create (nonexistent dirs accepted). Docs live only on the `beta` branch.
- [opencode2 events](issues/02-opencode2-events.md): global SSE at `/api/event` via `event.subscribe()`, no replay, no auto-reconnect; turn done = `session.execution.succeeded|failed|interrupted` (confirm with `session.wait` or `/api/session/active`); any `session.*` event for the run is activity; `permission.asked` = waiting on a human, not a stall; after a server restart in-flight sessions get `interrupted{shutdown}` and the server auto-resumes them (read from a newer beta, unverified on 17823).
- [GitHub App for Atlas](issues/03-github-app.md): permissions Issues, Pull requests, Contents, Metadata; JWT then 1-hour installation token, clone as `x-access-token:TOKEN@github.com`; webhooks `issues`, `pull_request` (merged = closed + `merged: true`), and `issue_dependencies` for blocker changes; verify `X-Hub-Signature-256` via `@octokit/webhooks`; `octokit@5` + `@octokit/webhooks@14` + `hono@4.13`.
- [GitHub issue dependencies and linked PRs](issues/04-github-dependencies-and-linked-prs.md): GraphQL `Issue.blockedBy` (GA, no gate) filtered to open; linked PRs via `closedByPullRequestsReferences(includeClosedPrs: true)` with draft and merged state; one query per project lists open `spec` issues with both; webhook `issue_dependencies` exists; polling 5 repos every 30s uses about a quarter of the App rate limit.

## Not yet specified

- Notifying humans when a run ends or stalls. Scope unconfirmed.
- Follow-up runs when a PR gets review comments. Scope unconfirmed.
- Retention of old run records in the database (run directories are covered by failure handling).
- Spec drift: the issue is edited while a run is active.
- Phase 2+ contents at low resolution.

## Out of scope

- Worker sessions, task worktrees, orchestrator-worker protocol. The agent on opencode2 owns all of it.
- LLM provider, models, cost and token tracking, budgets. Handled by the opencode2 server.
- opencode2 server configuration: permissions, compaction, agent definition and prompt.
- Automated tests of any kind. AIs are banned from writing tests for Atlas.
- Max run duration.
- Handoff sections on Git worktrees, task integration, workers, concurrency limits per worker.
