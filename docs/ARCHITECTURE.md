# ARCHITECTURE

Answers: how is the system technically shaped? Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## System Boundary

Inside this repository: the Atlas TypeScript process (private UI + loopback webhook), SQLite persistence, GitHub read client, credential supplier, Session clone/preparation, OpenCode handoff and viewer, server-rendered UI, and inert host deploy assets.

Outside: GitHub (App, inventory, issues, PRs, native stacks, signed webhooks); an independently running OpenCode V2 process; the private host (systemd, Btrfs, Tailscale Serve/Funnel, pinned Bun/Git/gh/OpenCode binaries); operator-managed paths under `/opt/atlas`, `/var/lib/atlas`, `/etc/atlas`, `/var/backups/atlas`, and `/run/atlas`.

`deploy/` does not provision the host, enable units, move OpenCode data, or change Tailscale/firewall.

## Primary Stack

Bun `1.3.14`, TypeScript `7.0.2`, Hono `4.13.7`, HTMX `2.0.10`, Tailwind CSS `4.3.3` + daisyUI `5.7.28`, SQLite via `bun:sqlite`. Package manager: Bun (`package.json#packageManager`). OpenCode client/binary pin: `0.0.0-beta-19135`. Host Git `2.55.0` and gh `2.100.0` (`deploy/pins.env`).

## Significant Dependencies

| Dependency | Role |
|---|---|
| `hono` | Two apps: private UI (`src/app.ts#createApp`) and webhook (`src/webhook.ts#createWebhookApp`). |
| `htmx.org` | Served at `/assets/htmx.min.js`; templates use `hx-*`. |
| `@opencode-ai/client` | Discover pinned V2, create/associate/prompt, consume events (`src/opencode.ts#createOpenCodeHandoffService`); viewer reads (`src/session-viewer.ts#createSessionViewerService`). |
| `bun:sqlite` | Sole database (`src/persistence.ts#createPersistence`). |
| `tailwindcss` + `daisyui` | Build `public/app.css` via `bun run build:css`. Theme tokens live in `src/styles.css`, not templates. |
| Native `fetch` | GitHub REST + one GraphQL merge-state read (`src/github.ts#createGitHubClient`). No Octokit. |
| `deploy/bin/git`, `deploy/bin/gh`, `deploy/bin/git-credential-atlas` | Pinned Git; scoped gh/git credential helpers that call `scripts/atlas-gh.ts` and `scripts/atlas-git-credential.ts`. |

## Components and Dependency Direction

Dependencies flow downward. Views do not call GitHub or OpenCode. The webhook app does not import the UI app.

```
src/server.ts
  → src/credentials.ts#createCredentialBoundary
  → src/config.ts#loadGitHubEnv
  → src/persistence.ts#createPersistence
  → src/github.ts#createGitHubClient
  → src/sync.ts#createRefreshCoordinator
  → src/webhook.ts#createWebhookApp
  → src/app.ts#createApp
       → src/auth.ts#createAuth
       → src/inbox-state.ts
       → src/preparation.ts#createPreparationService
       → src/opencode.ts#createOpenCodeHandoffService
       → src/session-viewer.ts#createSessionViewerService
       → src/views.ts → src/views/*
```

`createApp` starts preparation and OpenCode after wiring `onSlotReleased` / `onTerminal`. Preparation may read `src/recovery-status.ts#readRecoveryStatus`. OpenCode notifies the viewer through events; the viewer does not write SQLite.

## Integrations and State Ownership

| State | Owner | Store |
|---|---|---|
| Repository, Spec, PR, stack projections | persistence | SQLite `repositories`, `specs`, `pull_requests`, `pr_stacks`, `stack_members` |
| Refresh generations | persistence; webhook bumps, sync fills | SQLite `refresh_state` |
| Webhook delivery IDs | persistence (30-day retention) | SQLite `webhook_deliveries` |
| Session, history, reservations | persistence; preparation/handoff update checkpoints | SQLite `sessions`, `session_history`, `stack_reservations`, `reservation_prs`, `reservation_conflict_holds` |
| Schema versions | persistence | SQLite `schema_migrations` |
| Session clones | preparation | `ATLAS_SESSION_ROOT` (prod `/var/lib/atlas/sessions`) |
| Session→Repository scopes | credentials | `ATLAS_CREDENTIAL_REGISTRY_PATH` |
| Supplier socket and key | credentials | `ATLAS_SUPPLIER_SOCKET`, `ATLAS_SUPPLIER_KEY_PATH` |
| GitHub App ID / installation / PEM | operator file | `github.env` (`0600`) |
| OpenCode session/events/transcript | OpenCode process | OpenCode XDG; Atlas stores IDs and checkpoints only |
| Space/backup status | host scripts; Atlas reads | `ATLAS_RECOVERY_STATUS_PATH` |
| Inbox filter and last visit | UI app sets; browser holds | Cookies `atlas_inbox`, `atlas_visit` (`Secure; HttpOnly; SameSite=Strict`) |

GitHub remains source of truth for inventory, Specs, PRs, and stacks. Browse may use `ATLAS_GITHUB_INSTALLATION_TOKEN` if App minting fails; preparation never uses that fallback.

## Runtime and Deployment

Two loopback listeners (`src/server.ts`): UI `127.0.0.1:ATLAS_PORT` (default 3000) and webhook `127.0.0.1:ATLAS_WEBHOOK_PORT` (default 3001). Ports must differ. Tailscale Serve fronts the UI; Funnel must target only the webhook port.

Production (`deploy/README.md`): user `omega`; read-only release at `/opt/atlas/current`; data on `/var/lib/atlas`; secrets in `/etc/atlas`; runtime sockets in `/run/atlas`. Units: `atlas.service` (loads `atlas.env`), independent `opencode.service` (does not load Atlas secrets), `atlas-snapshot.timer`, `atlas-space-check.timer`. Restarting Atlas must not stop OpenCode.

Required to boot: `ATLAS_SHARED_TOKEN` and `ATLAS_GITHUB_WEBHOOK_SECRET`. Origin `ATLAS_ORIGIN` is the private HTTPS URL, not the Funnel URL.

## Development Environment

- Install: `bun install --frozen-lockfile`
- Run: `just` or `just dev` (bootstraps GitHub scope, then `bun run dev`); or `bun run dev` / `bun run start` after env is set
- Typecheck: `bun run check` (`tsc --noEmit`)
- CSS: `bun run build:css`
- Checklist previewer: `just checklist`
- No CI workflow in this repository
- No formatter or linter configured
- No unified test runner; scoped regressions are `bun run verify:*`, `bun scripts/verify-clone-scope.ts`, `bun scripts/verify-repository-filter.ts`, `bash deploy/verify-assets.sh`

Local `justfile` defaults: token/webhook secret, `data/atlas.sqlite`, `~/.local/share/atlas/sessions`, 1 GiB free-space floor. GitHub settings may live in `~/.config/atlas/github.env` (regular file, mode `0600`).

## Architectural Constraints

No accepted ADRs (`docs/adr/INDEX.md` is empty). Constraints from shipped code and operator docs:

- Bind UI and webhook to `127.0.0.1`. Funnel the webhook only.
- Cookie: `Secure; HttpOnly; SameSite=Strict` (`atlas_session`, `atlas_inbox`, `atlas_visit`). Browser mutations need same-origin CSRF. Health is authenticated and exists only on the UI app.
- GitHub client is read-only (GET plus one GraphQL merge-state query). Atlas never creates, changes, or submits PRs or stacks.
- OpenCode must report `0.0.0-beta-19135`. Atlas does not own OpenCode lifecycle.
- Credential supplier mints one-Repository App tokens over a unix socket. Tokens never appear in HTML, URLs, arguments, prompts, or logs.
- SQLite: foreign keys, WAL (except in-memory), `synchronous=FULL`. One writer; unfinished Session ownership restored at startup.
- One unfinished Session per Spec (unique partial index).
- Default global preparation capacity is one. Pause new preparation when Session storage is unavailable, below `ATLAS_MIN_FREE_BYTES`, or host space status is missing/stale/paused.
- Managed Git invocations must match `deploy/pins.env`.
- Theme tokens live in `src/styles.css` / `DESIGN.md`. Do not copy hex values into templates.

<!-- repo-map-synced: 4b188a3fa180e349011dd02434ec69bf7792b02f -->
