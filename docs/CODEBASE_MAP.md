# CODEBASE_MAP

Answers: where is today's shipped implementation? Organized by capability and concern, not directory order. Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## Executable Entry Points

| Path | Role |
|---|---|
| `src/server.ts` | Process entry. Loads env, starts credential supplier, SQLite, GitHub client, refresh coordinator, UI + webhook `Bun.serve` listeners, SIGINT/SIGTERM shutdown. |
| `package.json` `dev` / `start` | `bun run build:css` then `bun --watch src/server.ts` or `bun src/server.ts`. |
| `justfile#dev` | Local bootstrap then `bun run dev`. `justfile#checklist` opens the bearings previewer. |
| `src/app.ts#createApp` | Private UI Hono app. |
| `src/webhook.ts#createWebhookApp` | Webhook-only Hono app. |
| `scripts/atlas-gh.ts` | Scoped `gh` wrapper used by `deploy/bin/gh`. |
| `scripts/atlas-git-credential.ts` | Git credential helper used by preparation and `deploy/bin/git-credential-atlas`. |
| `deploy/stage-release.sh`, `deploy/stage-opencode.sh`, `deploy/atlas-snapshot.sh`, `deploy/restore-rehearsal.sh`, `deploy/check-health.sh`, `deploy/check-opencode.sh`, `deploy/check-space.sh`, `deploy/capture-recovery-config.sh`, `deploy/verify-assets.sh`, `deploy/verify-sqlite-wal.sh` | Operator-facing host scripts. Inert until applied on the host. |

UI binds `127.0.0.1:$ATLAS_PORT` (default 3000). Webhook binds `127.0.0.1:$ATLAS_WEBHOOK_PORT` (default 3001). Ports must differ.

## Capabilities and Concerns

### HTTP routing — `src/app.ts#createApp`

Returns `AtlasApp`. Options: `AppOptions`.

| Method | Path | Concern |
|---|---|---|
| GET | `/health` | Authenticated persistence + OpenCode pin JSON. UI app only. |
| GET | `/assets/app.css`, `/assets/app.js`, `/assets/htmx.min.js` | Static assets. |
| GET | `/` | 303 `/repositories`. |
| GET/POST | `/login` | Shared-token sign-in. |
| POST | `/logout` | Sign-out. |
| GET | `/events` | SSE for Session or Repository scope. |
| GET | `/repositories` | Enrolled list (`?removed=1`). |
| GET | `/repositories/new` | Inventory enroll UI. |
| POST | `/repositories` | Enroll. |
| POST | `/repositories/:repositoryId/remove` | Soft-remove. |
| GET | `/repositories/:repositoryId` | 303 specs. |
| GET | `/repositories/:repositoryId/specs` | Spec list. |
| GET | `/repositories/:repositoryId/specs/:issueNumber` | Spec detail. |
| GET | `.../sessions/new` | Start Session form. |
| POST | `.../sessions` | Queue Session. |
| GET | `/repositories/:repositoryId/pull-requests` | PRs + native stacks. |
| GET | `/repositories/:repositoryId/sessions` | Session list (`?status=`). |
| GET | `/sessions/:sessionId` | Session detail + viewer. |
| GET/POST | `/sessions/:sessionId/target` | Target reconfirmation. |
| GET/POST | `/sessions/:sessionId/reservation/release` | Explicit reservation release. |
| GET | `/sessions/:sessionId/view` | Viewer fragment or page. |

Internal (not exported): `isCurrentSpec`, `isEligibleRepository`, `parseForm`, `securityHeaders`, `saveCandidate`, `refreshRepository`, `refreshPullRequests`.

### Auth — `src/auth.ts#createAuth`

Returns `{ authenticate, clearSessionCookie, createSession, endSession, isSameOrigin, matchesSharedToken, middleware, issueCsrf, restoreCsrf, validateBrowserMutation, validateLogin }`. Also `src/auth.ts#safeReturnTo`. Types: `AuthIdentity`, `AuthEnv`.

Cookie `atlas_session`: `Secure; HttpOnly; SameSite=Strict`. Bearer `Authorization` accepted. Browser mutations need same-origin + CSRF.

### Persistence — `src/persistence.ts#createPersistence`

Returns `Persistence`. WAL + `synchronous=FULL` + foreign keys. Migrations 1–12.

Public methods: `database`, `close`, `restoreStartup`, `checkHealth`, `getHealth`, `isHealthy`, `markUnhealthy`, `getRepository`, `listRepositories`, `upsertRepository`, `removeRepository`, `restoreRepository`, `saveRepositoryObservation`, `updateAccess`, `markAccessObservation`, `markAccessFailure`, `requestRefresh`, `acceptWebhookDelivery`, `markRefreshSuccess`, `markRefreshFailure`, `isRefreshGenerationCurrent`, `getRefreshState`, `replaceSpecs`, `replacePullRequests`, `listPullRequests`, `listPrStacks`, `listSpecs`, `getSpec`, `getSession`, `getSessionBySubmissionId`, `queueSession`, `listQueuedSessions`, `listPreparingSessions`, `reconfirmQueuedTarget`, `claimPreparation`, `setPreparationCheckpoint`, `setQueuedSessionReason`, `blockQueuedPreparation`, `requeuePreparation`, `failPreparation`, `setHandoffIntent`, `setHandoffCheckpoint`, `setHandoffCreated`, `confirmHandoffAssociation`, `recordPromptAccepted`, `markHandoffUnconfirmed`, `markOpenCodeStale`, `reconcileOpenCode`, `releaseReservation`, `listOpenCodeSessions`, `getSessionByOpenCodeSessionId`, `listSessions`, `listSessionsForSpec`.

Types: `Repository`, `Spec`, `PullRequest`, `PrStack`, `Session`, `SessionState`, `PreparationCheckpoint`, `HandoffCheckpoint`, `TargetKind`, `SessionTarget`, `ResolvedTarget`, `PublicationStatus`, `AccessStatus`, `RefreshState`, `QueueSessionResult` (`created` \| `existing` \| `conflict` \| `unfinished`), `ReservationReleaseResult` (`released` \| `already_released` \| `not_found` \| `not_terminal`).

### GitHub reads — `src/github.ts#createGitHubClient`

Returns `GitHubClient`: `listInstallationRepositories`, `hasLabel`, `listIssues`, `listPullRequests`, `listStacks`, `getBranchRef`. Errors: `GitHubError`. Types: `GitHubRepository`, `GitHubIssue`, `GitHubPullRequest`, `GitHubStack`, `GitHubRef`.

GET-only REST plus GraphQL merge-state read. No PR/stack writes. Default API version in this module.

### Refresh — `src/sync.ts#createRefreshCoordinator`

Returns `RefreshCoordinator`: `{ refresh, request, wake, start, stop }`. Also `src/sync.ts#githubFailureMessage`. Views: `access` \| `specs` \| `pullRequests`. Does not create GitHub labels. Failed reads retain last complete projection.

### Webhook — `src/webhook.ts#createWebhookApp`

`POST /webhooks/github` only. `src/webhook.ts#verifyGitHubSignature` (HMAC SHA-256 `X-Hub-Signature-256`). Idempotent via `Persistence.acceptWebhookDelivery`. Accepted deliveries call `onAccepted` → `RefreshCoordinator.wake`. Relevant events include `installation`, `installation_repositories`, `repository`, `issues` (open/edit/close/reopen/label), `label`, `pull_request`, `push`, `create`, `delete`. Other events are ignored. Wake is per enrolled Repository IDs in the payload; unenrolled Repositories do not get Spec rows.

### Credentials — `src/credentials.ts#createCredentialBoundary`

Returns `CredentialBoundary`: `{ credentialsPath, registryPath, socketPath, keyPath, start, close, registerScope, resolveScope, requestToken, assertReady, installationToken, helperEnvironment }`. Also `CredentialError`, `CredentialScope`, `readGithubEnvFile`, `loadGithubEnv`, `requestCredential`.

Unix-socket supplier. Repository-scoped App tokens. `src/config.ts#loadGitHubEnv` loads browse keys from `~/.config/atlas/github.env` when unset (mode `0600`).

### Preparation — `src/preparation.ts#createPreparationService`

Returns `PreparationService`: `{ start, stop, enqueue, prepareNext, credentials, sessionRoot, capacity }`. Also `DEFAULT_MIN_FREE_BYTES`, `hasRequiredFreeSpace`, `cloneGitEnvironment`.

Clones under `ATLAS_SESSION_ROOT`. Default capacity 1. Uses `scripts/atlas-git-credential.ts`. Strips inherited Git/GitHub tokens from clone env. May gate on `src/recovery-status.ts#readRecoveryStatus`.

### OpenCode handoff — `src/opencode.ts#createOpenCodeHandoffService`

Returns `{ start, stop, enqueue, process, getClient, isReady, readiness, onEvent, onTransport, transportState }`. Pin: `src/opencode.ts#APPROVED_OPENCODE_VERSION` (`0.0.0-beta-19135`). Discovers `@opencode-ai/client` `Service`. Checkpoints: intent → events → create once → associate once → one exact prompt → reconcile. Does not store a transcript.

### Session viewer — `src/session-viewer.ts#createSessionViewerService`

Returns `{ hydrate }`. Also `createViewerEventReducer`, `ViewerScopeError`. Types: `SessionViewerProjection`, `ViewerConnection`, `ViewerSemanticState`, `ViewerFreshness`. Authorizes OpenCode session IDs by walking the descendant tree. No SQLite writes.

### Views — `src/views.ts`

| Symbol | Owner |
|---|---|
| `renderLoginForm`, `renderLoginPage`, `PendingStartSession` | `src/views/shell.ts` |
| `renderRepositoriesPage`, `renderAddRepositoryPage`, `repositoryMatchesQuery` | `src/views/repositories.ts` |
| `renderSpecsPage`, `renderSpecDetailPage`, `renderSpecUnavailablePage` | `src/views/specs.ts` |
| `renderStartTargetOptions`, `startTargetOptions`, `targetObservation` | `src/views/targets.ts` |
| `renderPullRequestsPage` | `src/views/pull-requests.ts` |
| `renderStartSessionForm`, `renderStartSessionPage`, `renderSessionsPage`, `renderPendingStartSessionPage`, `renderPendingStartSessionFragment`, `renderTargetReconfirmationPage`, `renderTargetReconfirmationForm`, `renderReservationReleasePage`, `renderReservationReleaseForm` | `src/views/sessions.ts` |
| `renderSessionDetailPage`, `renderSessionViewerFragment` | `src/views/viewer.ts` |

Shared markup: `src/views/html.ts` (`escapeHtml`, `safeExternalUrl`, `renderDocument`), `src/views/shared.ts` (`pageHeader`, `recordTable`, access/session/publication badges), `src/views/icons.ts#icon`. Theme: `src/styles.css` → `public/app.css`. Client glue: `public/app.js`.

### Recovery status — `src/recovery-status.ts#readRecoveryStatus`

Types: `RecoveryStatus`, `SpaceRecoveryStatus`, `BackupRecoveryStatus`. Atlas reads host-written status; it does not take snapshots.

## Critical Flows

**Login.** `src/app.ts#createApp` GET `/login` → `src/auth.ts#createAuth.issueCsrf` → `src/views/shell.ts#renderLoginPage`. POST `/login` → `validateLogin` / `matchesSharedToken` → `createSession`. Unauthenticated start POSTs go through `preserveUnauthenticatedStart`.

**Enroll Repository.** GET `/repositories/new` → `GitHubClient.listInstallationRepositories` (org-filtered) → `src/views/repositories.ts#renderAddRepositoryPage`. POST `/repositories` → CSRF → `Persistence.upsertRepository` → `saveCandidate` → `RefreshCoordinator.refresh` (`access`, `specs`).

**Spec list/detail.** GET specs → `refreshRepository` → `Persistence.listSpecs` / `getSpec` → `src/views/specs.ts#renderSpecsPage` or `renderSpecDetailPage`. Current Spec: `isCurrentSpec` (open, `spec` label, not a PR).

**Start Session.** GET `.../sessions/new` → refresh access/specs/PRs → `src/views/sessions.ts#renderStartSessionPage` + `src/views/targets.ts#startTargetOptions`. POST → CSRF + target observation match → `Persistence.queueSession` → `PreparationService.enqueue`. Duplicate unfinished Spec → 409. `createPreparationService.prepareNext` → `claimPreparation` → clone via `cloneGitEnvironment` → checkpoints through `prepared`. `createOpenCodeHandoffService` then intent → events → create → associate → one prompt → `Persistence.reconcileOpenCode`. Terminal → `refreshPullRequests` + `preparation.enqueue`.

**Webhook → refresh.** `src/server.ts` webhook listener → `createWebhookApp` POST `/webhooks/github` → `verifyGitHubSignature` → `Persistence.acceptWebhookDelivery` → `RefreshCoordinator.wake`.

**Session viewer SSE.** GET `/sessions/:sessionId` or `/view` → `createSessionViewerService.hydrate` → `src/views/viewer.ts#renderSessionDetailPage` / `renderSessionViewerFragment`. GET `/events` → `streamSSE`; emits refresh/reconcile/stale/connected/auth-expired only (no transcript).

**Reservation release.** GET/POST `/sessions/:sessionId/reservation/release` → terminal + held reservation → `Persistence.releaseReservation` → `preparation.enqueue`. SQLite only; no GitHub mutation.

**Target reconfirmation.** Queued Session blocked for explicit reconfirmation. GET/POST `/sessions/:sessionId/target` → refresh PRs → `Persistence.reconfirmQueuedTarget` → `preparation.enqueue`. Atlas does not infer a replacement.

## Shared Utilities and Infrastructure

- `src/views/html.ts` — HTML escaping, document shell, HTMX includes.
- `src/views/shared.ts` — layout primitives and Session/Repository status markup.
- `src/views/icons.ts` — Heroicons paths.
- `src/styles.css` / `public/app.css` — Tailwind + daisyUI `atlas` theme.
- `public/app.js` — client HTMX glue.
- `src/recovery-status.ts` — read-only host status.
- `src/config.ts#loadGitHubEnv` and `src/credentials.ts#loadGithubEnv` — two github.env loaders (browse keys vs App key path).

## Interfaces and State

**SQLite tables:** `schema_migrations`, `repositories`, `specs`, `refresh_state`, `pull_requests`, `pr_stacks`, `stack_members`, `sessions`, `webhook_deliveries`, `stack_reservations`, `reservation_prs`, `reservation_conflict_holds`, `session_history`.

**Session identity:** Atlas IDs `ses_<uuid>`. Unfinished states unique per Spec (`sessions_unfinished_spec_idx`).

**GitHub:** installation token from `CredentialBoundary.installationToken`; browse may fall back to `ATLAS_GITHUB_INSTALLATION_TOKEN`.

**OpenCode:** `@opencode-ai/client` against pin `0.0.0-beta-19135`. Service file default `$XDG_STATE_HOME/opencode/service.json` or `OPENCODE_SERVICE_FILE`.

**Filesystem:** Session directories under `ATLAS_SESSION_ROOT`; credential scopes in `session-scopes.json`; supplier socket `0600`.

## Change Hazards

- **Credential leakage.** `cloneGitEnvironment` strips inherited tokens. Supplier socket `0600`. `scripts/atlas-gh.ts` forbids `auth token` / login. Never log tokens, keys, prompts, or auth headers.
- **Webhook surface.** Signature required. Empty secret fails boot. Webhook app has no UI, login, Session, health, or OpenCode routes.
- **OpenCode pin.** `APPROVED_OPENCODE_VERSION`, `package.json` `@opencode-ai/client`, and `deploy/pins.env` must match. Mismatch → handoff not ready.
- **No GitHub mutation from Atlas.** `GitHubClient` is read-only. Reservation release and target reconfirmation change SQLite only. Agent may publish via scoped git/gh; Atlas must not grow write APIs.
- **Theme tokens.** Hex and radii live in `src/styles.css` / `DESIGN.md`. Rebuild with `bun run build:css`.
- **Two ports.** `ATLAS_WEBHOOK_PORT !== ATLAS_PORT`. Both `127.0.0.1`. Funnel webhook only.
- **WAL SQLite.** Required except in-memory. One writer. `restoreStartup` reclaims unfinished ownership; do not skip health restore.
- **One unfinished Session per Spec.** Unique index plus `queueSession` `unfinished` result. Do not add a second-start path that bypasses it.
- **Capacity and disk.** Default capacity 1. Pause on low free space or stale/paused recovery status. `ATLAS_ADMISSION_PAUSED` is operator-controlled.

## Verification Map

| Command | Capability |
|---|---|
| `bun run check` | Typecheck (`tsc --noEmit`). |
| `bun run build:css` | Tailwind/daisyUI asset. |
| `bun run verify:issue31` | Webhook HMAC, GitHub rate-limit delay, refresh wake-during-backoff. |
| `bun run verify:issue25` | PR list / stack projection views. |
| `bun run verify:migrations` | Persistence migrations, session/reservation schema. |
| `bun run verify:issue27` | Credential boundary, socket, scope, symlink. |
| `bun run verify:issue27-fixes` | Preparation free space, App token mint, clone admission. |
| `bun run verify:issue32` | Refresh coordinator retry backoff. |
| `bun run verify:issue29` | Session viewer hydrate, SSE (no transcript leak). |
| `bun scripts/verify-clone-scope.ts` | Clone git env + credential helper isolation. |
| `bun scripts/verify-repository-filter.ts` | `repositoryMatchesQuery` + add-repo UI. |
| `bun scripts/check-restored-state.ts` | Restore DB/schema/registry. |
| `bash deploy/verify-assets.sh` | Deploy file set + syntax. Does not enable services. |
| `bash deploy/verify-sqlite-wal.sh` | Bun/OpenCode SQLite WAL pin. |

<!-- repo-map-synced: e64cae76bc7bc138c532617bac116b08c4c4b5d0 -->
