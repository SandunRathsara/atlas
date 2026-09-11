# CODEBASE_MAP

Answers: where is today's shipped implementation? Organized by capability and concern, not directory order. Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## Executable Entry Points

| Path | Role |
|---|---|
| `src/server.ts` | UI process entry. Loads env, configures a client for the independent credential supplier, starts SQLite, GitHub client, refresh coordinator, UI + webhook `Bun.serve` listeners, and handles SIGINT/SIGTERM shutdown without owning the supplier socket. |
| `src/credential-server.ts` | Independent credential supplier process entry. Owns the existing authenticated Unix-socket boundary and survives Atlas UI restarts. |
| `package.json` `dev` / `start` | `bun run build:css` then `bun --watch src/server.ts` or `bun src/server.ts`. |
| `package.json` `credentials` | Runs the credential supplier process directly for local development. |
| `justfile#dev` | Local bootstrap then `bun run dev`. `justfile#checklist` opens the bearings previewer. |
| `src/app.ts#createApp` | Private UI Hono app; returned `AtlasApp.updatePause` is the coordinated preparation/handoff activation prerequisite. |
| `src/webhook.ts#createWebhookApp` | Webhook-only Hono app. |
| `scripts/atlas-gh.ts` | Scoped `gh` wrapper used by `deploy/bin/gh`. |
| `scripts/atlas-git-credential.ts` | Git credential helper used by preparation and `deploy/bin/git-credential-atlas`. |
| `deploy/bootstrap.sh`, `deploy/stage-release.sh`, `deploy/stage-opencode.sh`, `deploy/atlas-snapshot.sh`, `deploy/restore-rehearsal.sh`, `deploy/check-health.sh`, `deploy/check-opencode.sh`, `deploy/check-space.sh`, `deploy/capture-recovery-config.sh`, `deploy/verify-assets.sh`, `deploy/verify-opencode-commands.sh`, `deploy/verify-sqlite-wal.sh` | Operator-facing host scripts. Bootstrap installs the independent credential service without restarting OpenCode. OpenCode staging is exact-version, registry-integrity-verified, and server-only; selection follows the operator-controlled `current` symlink. Inert until applied on the host. |

The implemented inbox lives in `src/views/inbox.ts`; the deleted `src/prototype-inbox.ts` is not a runtime entry point.

UI binds `127.0.0.1:$ATLAS_PORT` (default 3000). Webhook binds `127.0.0.1:$ATLAS_WEBHOOK_PORT` (default 3001). Ports must differ.

## Capabilities and Concerns

### HTTP routing — `src/app.ts#createApp`

Returns `AtlasApp`. Options: `AppOptions`.

| Method | Path | Concern |
|---|---|---|
| GET | `/health` | Authenticated persistence + OpenCode readiness/observed-version JSON. Persistence determines HTTP status. UI app only. |
| GET | `/assets/app.css`, `/assets/app.js`, `/assets/htmx.min.js` | Static assets. |
| GET | `/` | Landing: `findLandingSession` + `atlas_visit` / `atlas_inbox`; 303 to Session, Spec list, `/inbox`, or `/repositories/new`. |
| GET | `/inbox` | Inbox page. `?repository=` is the canonical filter URL and sets/clears `atlas_inbox`; a remembered valid filter redirects a bare `/inbox` here. |
| GET | `/inbox/list` | Inbox list fragment when `HX-Request`; full page otherwise. The fragment swaps its own outerHTML every 30s with `hx-push-url="false"`. |
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
| GET | `/sessions` | Session list across all enrolled, non-removed Repositories (`?status=`, including `?status=all`). |
| GET | `/sessions/:sessionId` | Session detail + viewer. |
| GET/POST | `/sessions/:sessionId/target` | Target reconfirmation. |
| GET/POST | `/sessions/:sessionId/reservation/release` | Explicit reservation release. |
| GET | `/sessions/:sessionId/view` | Viewer fragment or page. |

Internal (not exported): `isCurrentSpec`, `isEligibleRepository`, `parseForm`, `securityHeaders`, `saveCandidate`, `refreshRepository`, `refreshPullRequests`, `enrolledInboxRepository`, `inboxLocation`, `selectedSpecForPath`, `inboxFromRequest`, `rememberInboxFilter`, `manageInboxFilter`.

### Auth — `src/auth.ts#createAuth`

Returns `{ authenticate, clearSessionCookie, createSession, endSession, isSameOrigin, matchesSharedToken, middleware, issueCsrf, restoreCsrf, validateBrowserMutation, validateLogin }`. Also `src/auth.ts#safeReturnTo`. Types: `AuthIdentity`, `AuthEnv`.

Cookie `atlas_session`: `Secure; HttpOnly; SameSite=Strict`. Bearer `Authorization` accepted. Browser mutations need same-origin + CSRF.

### Inbox cookies — `src/inbox-state.ts`

`readInboxCookie`, `readVisitCookie`, `inboxCookie`, `visitCookie`. Cookies `atlas_inbox` (`repositoryId`) and `atlas_visit` (`lastVisitAt`, `lastRepositoryId`) use `Path=/; Secure; HttpOnly; SameSite=Strict` and have no max age.

### Persistence — `src/persistence.ts#createPersistence`

Returns `Persistence`. WAL + `synchronous=FULL` + foreign keys. Migrations 1–12.

Public methods: `database`, `close`, `restoreStartup`, `checkHealth`, `getHealth`, `isHealthy`, `markUnhealthy`, `getRepository`, `listRepositories`, `upsertRepository`, `removeRepository`, `restoreRepository`, `saveRepositoryObservation`, `updateAccess`, `markAccessObservation`, `markAccessFailure`, `requestRefresh`, `acceptWebhookDelivery`, `markRefreshSuccess`, `markRefreshFailure`, `isRefreshGenerationCurrent`, `getRefreshState`, `replaceSpecs`, `replacePullRequests`, `listPullRequests`, `listPrStacks`, `listSpecs`, `getSpec`, `getSession`, `getSessionBySubmissionId`, `queueSession`, `listQueuedSessions`, `listPreparingSessions`, `reconfirmQueuedTarget`, `claimPreparation`, `setPreparationCheckpoint`, `setQueuedSessionReason`, `blockQueuedPreparation`, `requeuePreparation`, `failPreparation`, `setHandoffIntent`, `setHandoffCheckpoint`, `setHandoffCreated`, `confirmHandoffAssociation`, `recordPromptAccepted`, `markHandoffUnconfirmed`, `markOpenCodeStale`, `reconcileOpenCode`, `releaseReservation`, `listOpenCodeSessions`, `getSessionByOpenCodeSessionId`, `listSessions`, `listSessionsForSpec`, `listInbox`, `findLandingSession`.

Types: `Repository`, `Spec`, `PullRequest`, `PrStack`, `Session`, `SessionState`, `SessionFilter`, `Inbox`, `InboxRow`, `PreparationCheckpoint`, `HandoffCheckpoint`, `TargetKind`, `SessionTarget`, `ResolvedTarget`, `PublicationStatus`, `AccessStatus`, `RefreshState`, `QueueSessionResult` (`created` \| `existing` \| `conflict` \| `unfinished`), `ReservationReleaseResult` (`released` \| `already_released` \| `not_found` \| `not_terminal`).

`listInbox` selects current open exact-label Specs from enrolled Repositories, joins each latest Session by submission order, assigns Needs you/In progress/Not started/Settled groups, ranks In progress as Running → Queued → Preparing → Idle, orders by `updatedAt`, caps the displayed Settled group at 10, and computes terminal unread time from `session_history` with an `updatedAt` fallback. `findLandingSession` selects the earliest new terminal Session after `lastVisitAt`, otherwise the earliest unfinished Session with Waiting first; removed Repositories are excluded from both.

### GitHub reads — `src/github.ts#createGitHubClient`

Returns `GitHubClient`: `listInstallationRepositories`, `hasLabel`, `listIssues`, `listPullRequests`, `listStacks`, `getBranchRef`. Errors: `GitHubError`. Types: `GitHubRepository`, `GitHubIssue`, `GitHubPullRequest`, `GitHubStack`, `GitHubRef`.

GET-only REST plus GraphQL merge-state read. No PR/stack writes. Default API version in this module.

### Refresh — `src/sync.ts#createRefreshCoordinator`

Returns `RefreshCoordinator`: `{ refresh, request, wake, start, stop }`. Also `src/sync.ts#githubFailureMessage`. Views: `access` \| `specs` \| `pullRequests`. Does not create GitHub labels. Failed reads retain last complete projection.

### Webhook — `src/webhook.ts#createWebhookApp`

`POST /webhooks/github` only. `src/webhook.ts#verifyGitHubSignature` (HMAC SHA-256 `X-Hub-Signature-256`). Idempotent via `Persistence.acceptWebhookDelivery`. Accepted deliveries call `onAccepted` → `RefreshCoordinator.wake`. Relevant events include `installation`, `installation_repositories`, `repository`, `issues` (open/edit/close/reopen/label), `label`, `pull_request`, `push`, `create`, `delete`. Other events are ignored. Wake is per enrolled Repository IDs in the payload; unenrolled Repositories do not get Spec rows.

### Credentials — `src/credentials.ts#createCredentialBoundary`

Returns `CredentialBoundary`: `{ credentialsPath, registryPath, socketPath, keyPath, start, close, registerScope, resolveScope, listHelperReferences, requestToken, assertReady, installationToken, helperEnvironment }`. Also `CredentialError`, `CredentialScope`, `readGithubEnvFile`, `loadGithubEnv`, `requestCredential`.

`src/credential-server.ts` runs the Unix-socket supplier independently. Atlas creates a non-serving client boundary, so client `start`/`close` cannot own or unlink the socket. Repository-scoped App tokens and the version-1 Session scope registry are unchanged; scope records may include canonical helper paths for later release retention. `src/config.ts#loadGitHubEnv` loads browse keys from `~/.config/atlas/github.env` when unset (mode `0600`).

### Preparation — `src/preparation.ts#createPreparationService`

Returns `PreparationService`: `{ start, stop, enqueue, prepareNext, pauseForUpdate, resumeFromUpdate, credentials, sessionRoot, capacity }`. Also `DEFAULT_MIN_FREE_BYTES`, `hasRequiredFreeSpace`, `cloneGitEnvironment`.

Clones under `ATLAS_SESSION_ROOT`. Default capacity 1. Uses `scripts/atlas-git-credential.ts`, records its canonical helper/runtime paths with the Session scope, and requests credentials from the independent supplier. Strips inherited Git/GitHub tokens from clone env. May gate on `src/recovery-status.ts#readRecoveryStatus`.

### OpenCode handoff — `src/opencode.ts#createOpenCodeHandoffService`

Returns `{ start, stop, enqueue, process, pauseForUpdate, resumeFromUpdate, getClient, isReady, readiness, onEvent, onTransport, transportState }`. Discovers `@opencode-ai/client` `Service` without a server-version filter, validates endpoint/health/events, and exposes the observed version through readiness when available. Checkpoints: intent → events → create once → associate once → one exact prompt → reconcile. Update pause drains create/associate/prompt work but permits prompt-acceptance evidence and execution reconciliation that cannot duplicate an effect. Does not store a transcript.

### Safe update pause — `src/update-pause.ts#createUpdatePauseCoordinator`

Returns `{ pause, state }`. `pause()` synchronously holds preparation and handoff, coalesces overlapping requests, and resolves to `paused` with an idempotent generation-scoped `resume`, or to `timed_out` after `UPDATE_PAUSE_TIMEOUT_MS` (five minutes) after automatically removing only this pause. `AtlasApp.updatePause` exposes this boundary for the later activation workflow.

### Session viewer — `src/session-viewer.ts#createSessionViewerService`

Returns `{ hydrate }`. Also `createViewerEventReducer`, `ViewerScopeError`. Types: `SessionViewerProjection`, `ViewerConnection`, `ViewerSemanticState`, `ViewerFreshness`. Authorizes OpenCode session IDs by walking the descendant tree. No SQLite writes.

### Views — `src/views.ts`

| Symbol | Owner |
|---|---|
| `renderShell`, `renderLoginForm`, `renderLoginPage`, `PendingStartSession` | `src/views/shell.ts` |
| `InboxContext`, `renderInboxFilter`, `renderInboxGroups`, `renderInboxList`, `renderInboxPage` | `src/views/inbox.ts` |
| `renderRepositoriesPage`, `renderAddRepositoryPage`, `repositoryMatchesQuery` | `src/views/repositories.ts` |
| `renderSpecsPage`, `renderSpecDetailPage`, `renderSpecUnavailablePage` | `src/views/specs.ts` |
| `renderStartTargetOptions`, `startTargetOptions`, `targetObservation` | `src/views/targets.ts` |
| `renderPullRequestsPage` | `src/views/pull-requests.ts` |
| `renderStartSessionForm`, `renderStartSessionPage`, `renderSessionsPage`, `renderPendingStartSessionPage`, `renderPendingStartSessionFragment`, `renderTargetReconfirmationPage`, `renderTargetReconfirmationForm`, `renderReservationReleasePage`, `renderReservationReleaseForm` | `src/views/sessions.ts` |
| `renderSessionDetailPage`, `renderSessionViewerFragment` | `src/views/viewer.ts` |

Inbox navigation internals: `src/views/inbox.ts#renderInboxUtility` owns the filtered Repository utility links and their path/query current-state predicates; `utilityLink` owns their shared markup.

Shared markup: `src/views/html.ts` (`escapeHtml`, `safeExternalUrl`, `renderDocument`), `src/views/shared.ts` (`pageHeader`, `recordTable`, access labels/badges, refresh warnings, session/publication markup), `src/views/icons.ts#icon`. Theme: `src/styles.css` → `public/app.css`. Client glue: `public/app.js` preserves inbox poll focus, open details, and scroll position after outerHTML swaps.

### Recovery status — `src/recovery-status.ts#readRecoveryStatus`

Types: `RecoveryStatus`, `SpaceRecoveryStatus`, `BackupRecoveryStatus`. Atlas reads host-written status; it does not take snapshots.

## Critical Flows

**Land on `/`.** `src/app.ts#createApp` GET `/` → `src/inbox-state.ts#readVisitCookie` → `Persistence.findLandingSession` → 303 to the earliest new terminal Session, otherwise the earliest unfinished Session with Waiting first, otherwise the remembered enrolled Repository's Spec list, `/inbox` when Repositories exist, or `/repositories/new`. Every redirect writes `atlas_visit`; a selected Session/Repository also writes `atlas_inbox`.

**Inbox.** GET `/inbox` → `inboxFromRequest` (`listInbox`, cookie/query filter) → `src/views/inbox.ts#renderInboxPage` in `renderShell`; a valid remembered filter makes bare `/inbox` redirect to the canonical `?repository=` URL. GET `/inbox/list` with `HX-Request` → `renderInboxList` (self-swapping outerHTML, 30s poll, `hx-push-url="false"`). `inboxLocation` reads the path and query from `HX-Current-URL`; `selectedSpecForPath` keeps the Spec row selected across Spec, Start Session, Session target/release/view paths, while the All Sessions utility is current only for `status=all`. Sidebar Spec groups live in the `Spec inbox` navigation landmark. `renderSpecsUnavailable` warns for mixed `never`/`partial`/`unavailable` Specs refresh states without replacing cached rows or showing a false empty state. `public/app.js` restores focus, `<details>` state, and scroll after a successful poll swap. Direct visit returns the full page.

**Login.** `src/app.ts#createApp` GET `/login` → `src/auth.ts#createAuth.issueCsrf` → `src/views/shell.ts#renderLoginPage`. POST `/login` → `validateLogin` / `matchesSharedToken` → `createSession`. Unauthenticated start POSTs go through `preserveUnauthenticatedStart`.

**Enroll Repository.** GET `/repositories/new` → `GitHubClient.listInstallationRepositories` (org-filtered) → `src/views/repositories.ts#renderAddRepositoryPage`. POST `/repositories` → CSRF → `Persistence.upsertRepository` → `saveCandidate` → `RefreshCoordinator.refresh` (`access`, `specs`).

**Spec list/detail.** GET specs → `refreshRepository` → `Persistence.listSpecs` / `getSpec` → `src/views/specs.ts#renderSpecsPage` or `renderSpecDetailPage`. Current Spec: `isCurrentSpec` (open, `spec` label, not a PR).

**Start Session.** GET `.../sessions/new` → refresh access/specs/PRs → `src/views/sessions.ts#renderStartSessionPage` + `src/views/targets.ts#startTargetOptions`. POST → CSRF + target observation match → `Persistence.queueSession` → `PreparationService.enqueue`. Duplicate unfinished Spec → 409. `createPreparationService.prepareNext` → `claimPreparation` → atomically register the Session scope/helper references → request a preflight credential from the independent supplier → clone via `cloneGitEnvironment` → checkpoints through `prepared`. `createOpenCodeHandoffService` then intent → events → create → associate → one prompt → `Persistence.reconcileOpenCode`. Terminal → `refreshPullRequests` + `preparation.enqueue`.

**Safe update pause.** Later activation code calls `AtlasApp.updatePause.pause()` → `src/update-pause.ts#createUpdatePauseCoordinator` synchronously holds both services → preparation finishes any active cycle at a durable preparation/uncertainty checkpoint while handoff finishes only active create/associate/prompt work → result is `paused` with scoped `resume`. Prompt/evidence and execution reconciliation continue, so Running/Waiting/Idle Sessions do not block. At five minutes the result is `timed_out`, both update holds are removed, and unsafe in-flight work is never aborted.

**All Sessions.** GET `/sessions` → `persistence.listRepositories()` → `listSessions(repositoryId, filter)` for every enrolled, non-removed Repository → flatten and sort by submission order → `renderSessionsPage` in global mode. `?status=all` includes terminal history; default `active` includes every unfinished state.

**Webhook → refresh.** `src/server.ts` webhook listener → `createWebhookApp` POST `/webhooks/github` → `verifyGitHubSignature` → `Persistence.acceptWebhookDelivery` → `RefreshCoordinator.wake`.

**Session viewer SSE.** GET `/sessions/:sessionId` or `/view` → `createSessionViewerService.hydrate` → `src/views/viewer.ts#renderSessionDetailPage` / `renderSessionViewerFragment`. GET `/events` → `streamSSE`; emits refresh/reconcile/stale/connected/auth-expired only (no transcript).

**Reservation release.** GET/POST `/sessions/:sessionId/reservation/release` → terminal + held reservation → `Persistence.releaseReservation` → `preparation.enqueue`. SQLite only; no GitHub mutation.

**Target reconfirmation.** Queued Session blocked for explicit reconfirmation. GET/POST `/sessions/:sessionId/target` → refresh PRs → `Persistence.reconfirmQueuedTarget` → `preparation.enqueue`. Atlas does not infer a replacement.

## Shared Utilities and Infrastructure

- `src/inbox-state.ts` — `atlas_inbox` / `atlas_visit` cookie parse and set.
- `src/views/html.ts` — HTML escaping, document shell, HTMX includes.
- `src/views/shared.ts` — layout primitives, access labels/badges, refresh warnings, and Session/Repository status markup.
- `src/views/icons.ts` — Heroicons paths.
- `src/styles.css` / `public/app.css` — Tailwind + daisyUI `atlas` theme.
- `public/app.js` — client HTMX glue; preserves inbox poll focus, open `<details>`, and scroll position.
- `src/recovery-status.ts` — read-only host status.
- `src/config.ts#loadGitHubEnv` and `src/credentials.ts#loadGithubEnv` — two github.env loaders (browse keys vs App key path).

## Interfaces and State

**SQLite tables:** `schema_migrations`, `repositories`, `specs`, `refresh_state`, `pull_requests`, `pr_stacks`, `stack_members`, `sessions`, `webhook_deliveries`, `stack_reservations`, `reservation_prs`, `reservation_conflict_holds`, `session_history`.

**Session identity:** Atlas IDs `ses_<uuid>`. Unfinished states unique per Spec (`sessions_unfinished_spec_idx`).

**Inbox identity:** `InboxRow` represents one current Spec and its latest Session; `Inbox` also carries the Settled total/new counts. Browser-held `atlas_inbox` and `atlas_visit` cookies carry filter and landing state; poll continuity is transient DOM state, not SQLite state.

**GitHub:** installation token from `CredentialBoundary.installationToken`; browse may fall back to `ATLAS_GITHUB_INSTALLATION_TOKEN`.

**OpenCode:** release-installed `@opencode-ai/client` `0.0.0-beta-19135` against an independently running server with no version gate. Service file default `$XDG_STATE_HOME/opencode/service.json` or `OPENCODE_SERVICE_FILE`.

**Filesystem:** Session directories under `ATLAS_SESSION_ROOT`; credential scopes and canonical helper references in `session-scopes.json`; supplier socket `0600`, owned by `atlas-credentials.service`; stable supplier source under `/opt/atlas/services/atlas-credentials`.

**Update pause:** process-local generation and service hold flags only. Session identity, prompt, target, ordering, preparation/handoff uncertainty, execution-slot ownership, and reservations remain in existing SQLite rows/checkpoints.

## Change Hazards

- **Credential leakage and continuity.** `cloneGitEnvironment` strips inherited tokens. Supplier socket `0600`; the independent service alone owns its lifecycle and stable support tree. Atlas client shutdown must not unlink it. `scripts/atlas-gh.ts` forbids `auth token` / login. Never log tokens, keys, prompts, or auth headers.
- **Webhook surface.** Signature required. Empty secret fails boot. Webhook app has no UI, login, Session, health, or OpenCode routes.
- **OpenCode boundary.** Keep the release-installed client dependency unchanged; deployment independently selects the host executable through `/opt/atlas/tools/opencode/current`, and staging neither pairs with nor replaces Atlas client packages and never activates the server. Server version is diagnostic, not a discovery gate. Invalid discovery/health/events and later API failures must retain not-ready/stale/uncertain state and never duplicate create/prompt effects or invent terminal outcomes.
- **No GitHub mutation from Atlas.** `GitHubClient` is read-only. Reservation release and target reconfirmation change SQLite only. Agent may publish via scoped git/gh; Atlas must not grow write APIs.
- **Theme tokens.** Hex and radii live in `src/styles.css` / `DESIGN.md`. Rebuild with `bun run build:css`.
- **Two ports.** `ATLAS_WEBHOOK_PORT !== ATLAS_PORT`. Both `127.0.0.1`. Funnel webhook only.
- **WAL SQLite.** Required except in-memory. One writer. `restoreStartup` reclaims unfinished ownership; do not skip health restore.
- **One unfinished Session per Spec.** Unique index plus `queueSession` `unfinished` result. Do not add a second-start path that bypasses it.
- **Capacity and disk.** Default capacity 1. Pause on low free space or stale/paused recovery status. `ATLAS_ADMISSION_PAUSED` is operator-controlled.
- **Update pause ownership.** Resume and timeout clear only the process-local update hold. Keep operator, capacity, storage, recovery, persistence, and readiness gates independent. Never count OpenCode execution/reconciliation as drain work or abort an uncertain external operation to meet the deadline.
- **Inbox refresh and selection.** `/inbox/list` replaces the whole list root every 30 seconds; keep the stable `data-inbox-scroll`/focus restoration contract, `HX-Current-URL` selection mapping, and `hx-push-url="false"` behavior together.
- **Inbox truthfulness.** `listInbox` keeps only current Specs and the latest Session, ranks groups/states before `updatedAt`, uses terminal history for unread time, and must not turn mixed Specs refresh failures or unknown access into an empty list or a revoked-access claim.

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
| `bun run verify:issue52` | Real-client local-server discovery, runtime handoff/failure checkpoints, direct health requests, and deployment health exit contracts. |
| `bun run verify:issue55` | Independent supplier subprocess/socket continuity, client restart, atomic scope registration, invalid-scope rejection, helper references, and Git/gh helpers across fixture release selection. |
| `bun run verify:issue56` | Real-SQLite coordinated preparation/handoff pause, controlled clone/prompt effects, timeout/resume, uncertainty/no-duplicate behavior, independent restrictions, and Running/Waiting/Idle non-blocking behavior. |
| `bun run verify:inbox` | Inbox Spec projection, latest Session, group/state ordering, Settled cap, terminal unread time, and landing selection. |
| `bun run verify:landing` | GET `/` landing redirects, per-browser `atlas_visit` / `atlas_inbox`, and canonical `/inbox` filter URL. |
| `bun run verify:inbox-shell` (`scripts/verify-inbox-shell.ts`) | Desktop sidebar and navigation landmarks, canonical/filter cookie behavior, selected Spec identity, `/inbox/list` fragment contract, access semantics, and exact `status=all` utility state. |
| `bun run verify:inbox-page` | `/inbox` full/fragment pages, phone Inbox link, mixed refresh warnings, access badges, and empty/error states. |
| `bun scripts/verify-clone-scope.ts` | Clone git env + credential helper isolation. |
| `bun scripts/verify-repository-filter.ts` | `repositoryMatchesQuery` + add-repo UI. |
| `bun scripts/check-restored-state.ts` | Restore DB/schema/registry. |
| `bash deploy/verify-assets.sh` | Deploy file set + syntax. Does not enable services. |
| `bash deploy/verify-opencode-commands.sh` | Isolated server-only staging/integrity, `current` preflight selection, no-activation, and observed-version WAL command regressions. |
| `bash deploy/verify-sqlite-wal.sh` | Pinned Bun and selected OpenCode embedded-SQLite WAL safeguards. |

<!-- repo-map-synced: 60d5a38df21d5b840c768b36ce37aacecf90e059 -->
