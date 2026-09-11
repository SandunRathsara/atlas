# ARCHITECTURE

Answers: how is the system technically shaped? Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## System Boundary

Inside this repository: the Atlas TypeScript UI/webhook process, independent TypeScript credential-supplier and surviving policy/staging/activation/recovery/retention updater processes, SQLite persistence, GitHub read clients, Release discovery, Session clone/preparation, OpenCode handoff and viewer, the coordinated preparation/handoff update pause, server-rendered UI, tag-driven GitHub Release publishing, and inert host deploy assets.

Outside: GitHub (App, inventory, issues, PRs, native stacks, signed webhooks, public Releases); an independently running OpenCode V2 process selected by the operator through `/opt/atlas/tools/opencode/current`; the private host (systemd, Btrfs, Tailscale Serve/Funnel, pinned Bun/Git/gh binaries); operator-managed paths under `/opt/atlas`, `/var/lib/atlas`, `/etc/atlas`, `/var/backups/atlas`, and `/run`.

`deploy/` is inert until operator action. Its bootstrap installs/enables the independent credential and updater services, stable Atlas-only health support, and updated unit files; the bootstrap itself does not activate a Release, fully provision the host, move OpenCode data, or change Tailscale/firewall.

## Primary Stack

Bun `1.3.14`, TypeScript `7.0.2`, Hono `4.13.7`, HTMX `2.0.10`, Tailwind CSS `4.3.3` + daisyUI `5.7.28`, SQLite via `bun:sqlite`. Package manager: Bun (`package.json#packageManager`). Atlas installs OpenCode client `0.0.0-beta-19135`; the host server is independently selected through `/opt/atlas/tools/opencode/current`, and runtime discovery does not gate on its version. Host Git `2.55.0` and gh `2.100.0` (`deploy/pins.env`).

## Significant Dependencies

| Dependency | Role |
|---|---|
| `hono` | Two apps: private UI (`src/app.ts#createApp`) and webhook (`src/webhook.ts#createWebhookApp`). |
| `htmx.org` | Served at `/assets/htmx.min.js`; templates use `hx-*`. |
| `@opencode-ai/client` | Discover an independently running V2 service without a server-version filter, validate health/events, create/associate/prompt, and consume events (`src/opencode.ts#createOpenCodeHandoffService`); viewer reads (`src/session-viewer.ts#createSessionViewerService`). |
| `bun:sqlite` | Sole database (`src/persistence.ts#createPersistence`). |
| `tailwindcss` + `daisyui` | Build `public/app.css` via `bun run build:css`. Theme tokens live in `src/styles.css`, not templates. |
| Native `fetch` | GitHub REST + one GraphQL merge-state read (`src/github.ts#createGitHubClient`), public Release metadata discovery, and updater artifact downloads. No Octokit. |
| `deploy/bin/git`, `deploy/bin/gh`, `deploy/bin/git-credential-atlas` | Pinned Git; scoped gh/git credential helpers that call `scripts/atlas-gh.ts` and `scripts/atlas-git-credential.ts`. |

## Components and Dependency Direction

Dependencies flow downward. Views do not call GitHub or OpenCode. The webhook app does not import the UI app.

```
src/server.ts
  → src/release.ts#loadReleaseIdentity
  → src/updater.ts#createUpdaterClient
  → src/update-discovery.ts#createUpdateService
  → src/credentials.ts#createCredentialBoundary (non-serving client)
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
       → src/update-pause.ts#createUpdatePauseCoordinator
        → src/session-viewer.ts#createSessionViewerService
        → src/views.ts → src/views/*

src/credential-server.ts
  → src/credentials.ts#createCredentialBoundary (socket owner/supplier)

src/updater-server.ts
  → src/updater.ts#createUpdaterService (socket owner/stager/activator/recovery/retention authority)
  → src/credentials.ts#createCredentialBoundary (read-only Session helper references)
  → src/release.ts (metadata validation)
```

`createApp` starts preparation and OpenCode after wiring `onSlotReleased` / `onTerminal`, exposes their coordinated update pause as `AtlasApp.updatePause`, may restore that pause during host activation, and serves authenticated Updates status/check/policy/Install/Retry routes; it also assembles the inbox context from persistence and browser cookies for every authenticated page. `src/release.ts` validates generated release metadata; `server.ts` injects its identity into authenticated health, omits OpenCode evaluation for activation health, and starts Release discovery with the safe-pause callback independently of Session admission. Discovery writes known metadata to SQLite, evaluates the updater-owned installation policy, prefers a newer numeric build of the installed SemVer for automatic policy, and requests staging through the surviving updater client. Explicit approval or an applicable automatic decision enters the same serialized safe-pause/activation path; after checkpoint confirmation the updater owns Atlas stop/restart, atomic Release selection, identity/storage validation, rollback, helper-aware old-Release cleanup, and durable results. `src/views/inbox.ts` renders the filter, grouped Spec rows, and full-page records without calling GitHub or OpenCode. Preparation registers scopes and requests credentials through the independent supplier without owning its lifecycle, and may read `src/recovery-status.ts#readRecoveryStatus`. The updater reuses that registry's canonical helper-reference contract read-only before removing an older Release. OpenCode notifies the viewer through events; the viewer does not write SQLite.

## Integrations and State Ownership

| State | Owner | Store |
|---|---|---|
| Repository, Spec, PR, stack projections | persistence | SQLite `repositories`, `specs`, `pull_requests`, `pr_stacks`, `stack_members` |
| Refresh generations | persistence; webhook bumps, sync fills | SQLite `refresh_state` |
| Webhook delivery IDs | persistence (30-day retention) | SQLite `webhook_deliveries` |
| Session, history, reservations | persistence; preparation/handoff update checkpoints | SQLite `sessions`, `session_history`, `stack_reservations`, `reservation_prs`, `reservation_conflict_holds` |
| Schema versions | persistence | SQLite `schema_migrations` |
| Known Release candidates and discovery/request failures | update discovery via persistence | SQLite `update_discovery` |
| Installation update policy, staging plus activation target, previous Release, progress/result, health deadline, failed-tag suppression, and cleanup outcome/pending tags | independent updater | Atomic additive schema-1 `/var/lib/atlas/update-state.json` |
| Complete Release trees, active code selection, and protected old-tree cleanup | independent updater after explicit/automatic activation decision | Read-only `/opt/atlas/releases/atlas-<tag>` directories; atomic `/opt/atlas/current` symlink |
| Session clones | preparation | `ATLAS_SESSION_ROOT` (prod `/var/lib/atlas/sessions`) |
| Session→Repository scopes and helper references | Atlas credential client writes; independent supplier and updater retention read | `ATLAS_CREDENTIAL_REGISTRY_PATH` |
| Supplier socket and key | `atlas-credentials.service` | `ATLAS_SUPPLIER_SOCKET`, `ATLAS_SUPPLIER_KEY_PATH` |
| GitHub App ID / installation / PEM | operator file | `github.env` (`0600`) |
| OpenCode session/events/transcript | OpenCode process | OpenCode XDG; Atlas stores IDs and checkpoints only |
| Space/backup status | host scripts; Atlas reads | `ATLAS_RECOVERY_STATUS_PATH` |
| Inbox filter and last visit | UI app sets; browser holds | Cookies `atlas_inbox`, `atlas_visit` (`Path=/; Secure; HttpOnly; SameSite=Strict`) |
| Inbox poll continuity | `public/app.js`; browser DOM holds | Active element, open `<details>`, and scroll position are transient and restored after list swaps |
| Safe update pause | `src/update-pause.ts`; preparation/handoff report drain completion; `src/server.ts` restores during host activation | Process memory derived at startup from durable updater status; Session/checkpoint/reservation truth remains in SQLite |
| Release identity and artifact contract | Git tag + release workflow | Generated `RELEASE_METADATA.json`; published `atlas-release.json`, archive, checksum |

GitHub remains source of truth for inventory, Specs, PRs, and stacks. Browse may use `ATLAS_GITHUB_INSTALLATION_TOKEN` if App minting fails; preparation never uses that fallback.

## Runtime and Deployment

Two loopback listeners (`src/server.ts`): UI `127.0.0.1:ATLAS_PORT` (default 3000) and webhook `127.0.0.1:ATLAS_WEBHOOK_PORT` (default 3001). Ports must differ. Tailscale Serve fronts the UI; Funnel must target only the webhook port.

Production (`deploy/README.md`): user `omega`; read-only release selected at `/opt/atlas/current`; stable credential/updater sources at `/opt/atlas/services/atlas-credentials` and `/opt/atlas/services/atlas-updater`; data on `/var/lib/atlas`; secrets in `/etc/atlas`; runtime sockets in `/run/atlas` and `/run/atlas-updater`. An authoritative `vMAJOR.MINOR.PATCH+build.BUILD` tag drives the serialized `.github/workflows/release.yml`, which builds the exact frozen tagged tree and publishes immutable Linux x64 metadata/checksum/archive assets with production dependencies and built CSS. Units: `atlas-credentials.service` (owns `/run/atlas` and loads only credential inputs), root `atlas-updater.service` (owns `/run/atlas-updater`, stages public Releases, atomically selects `current`, reads canonical helper references from `/var/lib/atlas/session-scopes.json`, cleans only unprotected older Release trees, and controls only `atlas.service` through shipped code), `atlas.service` (loads `atlas.env`), independent `opencode.service` (does not load Atlas secrets and follows the operator-controlled OpenCode `current` symlink), `atlas-snapshot.timer`, `atlas-space-check.timer`. The updater unit does not import or execute `atlas.env`; candidate validation parses only its shared token/UI port as data and passes them to stable `check-health.sh`. `deploy/bootstrap.sh` installs/enables both surviving Atlas services and updated units without restarting OpenCode. Exact-version OpenCode staging verifies registry integrity but does not install, select, or restart the server. Restarting Atlas must not stop any independent service.

`AtlasApp.updatePause.pause()` synchronously holds both preparation and handoff admission, then returns `paused` only after their in-flight external operations settle at existing durable checkpoints. Its result owns an idempotent scoped `resume`. The coordinator returns `timed_out` after five minutes and resumes normal eligibility without aborting work. OpenCode execution reconciliation is outside the drain. Release discovery/staging do not invoke this prerequisite; authenticated Install/Retry or automatic policy for a newer build of the installed SemVer records the decision first, then invokes it and either records timeout abandonment or confirms the checkpoint to the surviving updater. Candidate/rollback Atlas processes start held while updater status is active and resume on its terminal result.

Required to boot: `ATLAS_SHARED_TOKEN` and `ATLAS_GITHUB_WEBHOOK_SECRET`. Origin `ATLAS_ORIGIN` is the private HTTPS URL, not the Funnel URL.

## Development Environment

- Install: `bun install --frozen-lockfile`
- Run: `just` or `just dev` (bootstraps GitHub scope and runs the credential supplier beside the watched UI); or run `bun run credentials` separately before `bun run dev` / `bun run start`
- Typecheck: `bun run check` (`tsc --noEmit`)
- CSS: `bun run build:css`
- Checklist previewer: `just checklist`
- Version-looking `v*` tag pushes run the release-only GitHub Actions workflow, which rejects malformed release identities; there is no general branch/PR CI workflow
- No formatter or linter configured
- No unified test runner; scoped regressions are `bun run verify:*` (including `verify:issue56` for safe update pause, `verify:issue58` for Release discovery/staging, `verify:issue59` for activation/recovery, `verify:issue60` for policy/automatic activation, and `verify:issue61` for retention/helper continuity), `bun scripts/verify-clone-scope.ts`, `bun scripts/verify-repository-filter.ts`, `bash deploy/verify-opencode-commands.sh`, `bash deploy/verify-assets.sh`

Local `justfile` defaults: token/webhook secret, `data/atlas.sqlite`, `~/.local/share/atlas/sessions`, 1 GiB free-space floor. GitHub settings may live in `~/.config/atlas/github.env` (regular file, mode `0600`).

## Architectural Constraints

Accepted decisions are indexed in `docs/adr/INDEX.md`; ADR-0001 makes OpenCode server version diagnostic rather than a normal runtime discovery gate, while ADR-0002 establishes immutable SemVer/global-build Releases and excludes OpenCode health/version from Atlas startup and self-update activation. Constraints from shipped code and operator docs:

- Bind UI and webhook to `127.0.0.1`. Funnel the webhook only.
- Cookie: `Path=/; Secure; HttpOnly; SameSite=Strict` for `atlas_session`, `atlas_inbox`, and `atlas_visit` (`atlas_session` also has a seven-day max age). Browser mutations need same-origin CSRF. Health is authenticated and exists only on the UI app.
- Inbox filter state is URL-canonical on `/inbox`; a valid remembered `atlas_inbox` filter redirects bare `/inbox` to `?repository=...`, while removed or invalid Repositories fall back to all enrolled Repositories.
- The `/inbox/list` fragment owns its 30-second `outerHTML` poll boundary; `public/app.js` must restore focus, open details, and scroll after a successful swap without adding history.
- GitHub client is read-only (GET plus one GraphQL merge-state query). Atlas never creates, changes, or submits PRs or stacks.
- Atlas uses its release-installed OpenCode client and discovers the independent service without a server-version filter. Endpoint/health/event validation and conservative API-failure behavior remain; Atlas does not own OpenCode lifecycle.
- The independent credential supplier mints one-Repository App tokens over a unix socket from a stable support tree. Atlas registers scopes through the existing registry but never owns the supplier socket/runtime lifecycle. Canonical helper references remain available for release retention. Tokens never appear in HTML, URLs, arguments, prompts, or logs.
- SQLite: foreign keys, WAL (except in-memory), `synchronous=FULL`. One writer; unfinished Session ownership restored at startup.
- One unfinished Session per Spec (unique partial index).
- Default global preparation capacity is one. Pause new preparation when Session storage is unavailable, below `ATLAS_MIN_FREE_BYTES`, or host space status is missing/stale/paused.
- The update pause blocks new preparation and create/associate/prompt work, drains only already in-flight Atlas-owned operations, and auto-resumes its own hold after a five-minute timeout. It does not block on OpenCode execution reconciliation or clear independent restrictions.
- Managed Git invocations must match `deploy/pins.env`.
- Theme tokens live in `src/styles.css` / `DESIGN.md`. Do not copy hex values into templates.
- Release tags are the sole release identity input. The first is
  `v0.1.0+build.1`; builds increase globally, publication is serialized, and
  existing Releases/assets are never overwritten. An untagged tree reports
  unpublished development identity.
- The Linux x64 archive contains the complete tracked tree, production
  dependencies, built CSS, generated identity/runtime/rollback metadata, and a
  checksum. Candidate health gates on Atlas identity and persistence only;
  OpenCode readiness/version remain independent diagnostics.
- Public Release discovery runs at startup/every four hours/manual request,
  retains the last successful complete candidate set on failure, and stages the
  newest eligible Release through the authenticated updater socket. Staging is
  serialized, durable across process restarts, read-only, and never changes
  `/opt/atlas/current`, pauses Session admission, or operates OpenCode.
- Approval required is the updater-persisted default. Automatic policy may
  select only a higher numeric build of the exact installed SemVer; it must not
  hide that candidate behind a newer SemVer, retry a suppressed failed tag, or
  bypass staging/runtime/rollback checks. Policy changes and overlapping checks
  share the existing per-installation discovery and activation serialization.
- Install/Retry uses the existing authenticated updater socket and an additive
  schema-1 state readable by the previous Atlas Release. The host updater
  serializes activation, validates complete staging/runtime/rollback before
  pause, atomically selects only `current`, controls only Atlas, verifies exact
  identity and persistence through `/health?activation=1` within 60 seconds,
  and durably distinguishes success, abandonment, recovered rollback, and
  rollback failure. OpenCode is neither evaluated nor controlled.
- Release retention uses actual selected/staged/activation paths plus canonical
  Session helper references, never newest-N, age, or Session state. Cleanup is
  serialized with updater work, records pending tags/outcomes in additive
  schema-1 state, retries safely after restart, and never targets stable service
  trees, Session/data paths, credentials, or operator-managed tools.

<!-- repo-map-synced: 2d96d00dc080bd7c6bc6a4e294f8e40ccb41d697 -->
