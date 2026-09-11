# CODEBASE_MAP

Answers: where is today's shipped implementation? Organized by capability and concern, not directory order. Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## Executable Entry Points

| Path | Role |
|---|---|
| `src/server.ts` | UI process entry. Loads env/release identity, configures independent credential/updater clients, restores an activation-owned safe pause when needed, starts SQLite, Repository refresh and Release discovery, serves UI + webhook listeners, and shuts down without owning either surviving socket. |
| `src/credential-server.ts` | Independent credential supplier process entry. Owns the existing authenticated Unix-socket boundary and survives Atlas UI restarts. |
| `src/updater-server.ts` | Independent staging/activation/recovery process entry. Reports installed host runtimes, owns the authenticated updater socket, controls only `atlas.service`, invokes stable Atlas-only health validation, and resumes durable host work after its own restart. |
| `package.json` `dev` / `start` | Development builds CSS then watches `src/server.ts`; release start runs the prebuilt tree without installing or building. |
| `package.json` `credentials` | Runs the credential supplier process directly for local development. |
| `package.json` `updater` | Runs the staging/activation/recovery updater process directly. |
| `justfile#dev` | Local bootstrap then `bun run dev`. `justfile#checklist` opens the bearings previewer. |
| `src/app.ts#createApp` | Private UI Hono app; returned `AtlasApp.updatePause` coordinates preparation/handoff for approval-driven activation and can start held while surviving host work completes. |
| `src/webhook.ts#createWebhookApp` | Webhook-only Hono app. |
| `scripts/atlas-gh.ts` | Scoped `gh` wrapper used by `deploy/bin/gh`. |
| `scripts/atlas-git-credential.ts` | Git credential helper used by preparation and `deploy/bin/git-credential-atlas`. |
| `.github/workflows/release.yml`, `scripts/build-release.sh`, `scripts/release.ts` | Serialized tag validation, exact-commit frozen build, Linux x64 archive/metadata/checksum production, and immutable GitHub Release publishing. |
| `deploy/bootstrap.sh`, `deploy/stage-release.sh`, `deploy/stage-opencode.sh`, `deploy/atlas-snapshot.sh`, `deploy/restore-rehearsal.sh`, `deploy/check-health.sh`, `deploy/check-opencode.sh`, `deploy/check-space.sh`, `deploy/capture-recovery-config.sh`, `deploy/verify-assets.sh`, `deploy/verify-opencode-commands.sh`, `deploy/verify-sqlite-wal.sh` | Operator-facing host scripts. Bootstrap installs independent credential and updater services, including stable Atlas-only health support and Atlas activation authority, without restarting OpenCode. OpenCode staging remains exact-version, registry-integrity-verified, server-only, and operator-selected. Inert until applied on the host. |

The implemented inbox lives in `src/views/inbox.ts`; the deleted `src/prototype-inbox.ts` is not a runtime entry point.

UI binds `127.0.0.1:$ATLAS_PORT` (default 3000). Webhook binds `127.0.0.1:$ATLAS_WEBHOOK_PORT` (default 3001). Ports must differ.

## Capabilities and Concerns

### HTTP routing — `src/app.ts#createApp`

Returns `AtlasApp`. Options: `AppOptions`.

| Method | Path | Concern |
|---|---|---|
| GET | `/health` | Authenticated Atlas release identity + persistence health + independent OpenCode readiness/observed-version JSON. `?activation=1` omits OpenCode evaluation for candidate validation. Persistence determines HTTP status. UI app only. |
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
| GET | `/updates` | Global Updates page: installed/available Release identities, discovery truth, host requirements, staging/activation/recovery progress/result, Install/Retry, and fixed approval-required policy. |
| GET | `/updates/status` | Updates status fragment when `HX-Request`; full page otherwise. Active checks/staging/activation poll every two seconds without history. |
| POST | `/updates/check` | Existing bearer or browser same-origin/CSRF-protected public Release check; coalesces with an in-flight check and redirects to `/updates`. |
| POST | `/updates/install` | Existing bearer or browser same-origin/CSRF-protected Install/Retry approval; durably records the exact staged candidate, invokes the safe pause, and redirects while host activation continues independently. |

Internal (not exported): `isCurrentSpec`, `isEligibleRepository`, `parseForm`, `securityHeaders`, `saveCandidate`, `refreshRepository`, `refreshPullRequests`, `enrolledInboxRepository`, `inboxLocation`, `selectedSpecForPath`, `inboxFromRequest`, `rememberInboxFilter`, `manageInboxFilter`.

### Auth — `src/auth.ts#createAuth`

Returns `{ authenticate, clearSessionCookie, createSession, endSession, isSameOrigin, matchesSharedToken, middleware, issueCsrf, restoreCsrf, validateBrowserMutation, validateLogin }`. Also `src/auth.ts#safeReturnTo`. Types: `AuthIdentity`, `AuthEnv`.

Cookie `atlas_session`: `Secure; HttpOnly; SameSite=Strict`. Bearer `Authorization` accepted. Browser mutations need same-origin + CSRF.

### Inbox cookies — `src/inbox-state.ts`

`readInboxCookie`, `readVisitCookie`, `inboxCookie`, `visitCookie`. Cookies `atlas_inbox` (`repositoryId`) and `atlas_visit` (`lastVisitAt`, `lastRepositoryId`) use `Path=/; Secure; HttpOnly; SameSite=Strict` and have no max age.

### Persistence — `src/persistence.ts#createPersistence`

Returns `Persistence`. WAL + `synchronous=FULL` + foreign keys. Migrations 1–13.

Public methods: `database`, `close`, `restoreStartup`, `checkHealth`, `getHealth`, `isHealthy`, `markUnhealthy`, `getUpdateDiscoveryState`, `recordUpdateDiscoverySuccess`, `recordUpdateDiscoveryFailure`, `recordUpdateStageRequestFailure`, `getRepository`, `listRepositories`, `upsertRepository`, `removeRepository`, `restoreRepository`, `saveRepositoryObservation`, `updateAccess`, `markAccessObservation`, `markAccessFailure`, `requestRefresh`, `acceptWebhookDelivery`, `markRefreshSuccess`, `markRefreshFailure`, `isRefreshGenerationCurrent`, `getRefreshState`, `replaceSpecs`, `replacePullRequests`, `listPullRequests`, `listPrStacks`, `listSpecs`, `getSpec`, `getSession`, `getSessionBySubmissionId`, `queueSession`, `listQueuedSessions`, `listPreparingSessions`, `reconfirmQueuedTarget`, `claimPreparation`, `setPreparationCheckpoint`, `setQueuedSessionReason`, `blockQueuedPreparation`, `requeuePreparation`, `failPreparation`, `setHandoffIntent`, `setHandoffCheckpoint`, `setHandoffCreated`, `confirmHandoffAssociation`, `recordPromptAccepted`, `markHandoffUnconfirmed`, `markOpenCodeStale`, `reconcileOpenCode`, `releaseReservation`, `listOpenCodeSessions`, `getSessionByOpenCodeSessionId`, `listSessions`, `listSessionsForSpec`, `listInbox`, `findLandingSession`.

Types: `Repository`, `Spec`, `PullRequest`, `PrStack`, `Session`, `SessionState`, `SessionFilter`, `Inbox`, `InboxRow`, `UpdateDiscoveryState`, `PreparationCheckpoint`, `HandoffCheckpoint`, `TargetKind`, `SessionTarget`, `ResolvedTarget`, `PublicationStatus`, `AccessStatus`, `RefreshState`, `QueueSessionResult` (`created` \| `existing` \| `conflict` \| `unfinished`), `ReservationReleaseResult` (`released` \| `already_released` \| `not_found` \| `not_terminal`).

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
| `renderUpdatesPage`, `renderUpdatesStatus` | `src/views/updates.ts` |

Inbox navigation internals: `src/views/inbox.ts#renderInboxUtility` owns the filtered Repository utility links and their path/query current-state predicates; `utilityLink` owns their shared markup.

Shared markup: `src/views/html.ts` (`escapeHtml`, `safeExternalUrl`, `renderDocument`), `src/views/shared.ts` (`pageHeader`, `recordTable`, access labels/badges, refresh warnings, session/publication markup), `src/views/icons.ts#icon`. Theme: `src/styles.css` → `public/app.css`. Client glue: `public/app.js` preserves inbox poll focus, open details, and scroll position after outerHTML swaps.

### Recovery status — `src/recovery-status.ts#readRecoveryStatus`

Types: `RecoveryStatus`, `SpaceRecoveryStatus`, `BackupRecoveryStatus`. Atlas reads host-written status; it does not take snapshots.

### Release identity — `src/release.ts`

`parseReleaseTag`, `compareReleaseTags`, and `validateReleaseSequence` implement
stable SemVer-first/global-build ordering beginning at `v0.1.0+build.1`.
`createReleaseMetadata`, `assertReleaseMetadata`, and `loadReleaseIdentity`
own generated schema-1 artifact/runtime/rollback metadata and the explicit
unpublished-development fallback. `scripts/release.ts` exposes validation and
metadata generation to CI; `scripts/build-release.sh` archives every tracked
file, installs the frozen production dependency tree, adds built CSS and
metadata, and emits the archive/checksum/sidecar without overwriting output.

### Release discovery — `src/update-discovery.ts#createUpdateService`

Returns `UpdateService`: `{ start, stop, check, status, install }`. Also
`createUnavailableUpdateService`, `UPDATE_CHECK_INTERVAL_MS`. Types:
`UpdateStatus`, `UpdateServiceOptions`. Lists all non-draft/non-prerelease public
GitHub Releases and validates each `atlas-release.json`; orders with
`compareReleaseTags`; persists the complete candidate set; retains it on
failure; and requests staging for the newest Release newer than the installed
published identity. Startup/manual/scheduled checks share one coalesced promise.
`install` validates the exact available/staged/runtime/rollback contract, records
approval through the updater, then converts the coordinated safe pause into one
durable activation or timeout abandonment; lost responses reconcile by status.

### Release staging, activation, and recovery — `src/updater.ts#createUpdaterService`

Returns `{ start, close, status, requestStage, prepareActivation, beginActivation, abandonActivation }`; `createUpdaterClient` returns
the UI-side authenticated Unix-socket `UpdaterClient`. Types: `UpdaterStatus`,
`UpdaterResult`, `RuntimeRequirements`, `HostRuntime`. The independent service
atomically writes `/var/lib/atlas/update-state.json`, serializes one request,
downloads the named archive/checksum, validates SHA-256 and embedded metadata,
atomically renames one complete tree under `/opt/atlas/releases`, makes it
read-only, reuses matching staged trees, and resumes an active durable request
after restart. The same additive schema-1 state stores activation target,
previous Release, progress/result, health deadline, and failed-tag suppression.
After a confirmed safe checkpoint it stops only Atlas, atomically selects the
complete candidate, restarts Atlas, and requires exact Atlas identity plus
healthy persistence within 60 seconds; failure selects/restarts/verifies the
previous Release. It has no OpenCode operation and deletes no Release trees.

## Critical Flows

**Land on `/`.** `src/app.ts#createApp` GET `/` → `src/inbox-state.ts#readVisitCookie` → `Persistence.findLandingSession` → 303 to the earliest new terminal Session, otherwise the earliest unfinished Session with Waiting first, otherwise the remembered enrolled Repository's Spec list, `/inbox` when Repositories exist, or `/repositories/new`. Every redirect writes `atlas_visit`; a selected Session/Repository also writes `atlas_inbox`.

**Inbox.** GET `/inbox` → `inboxFromRequest` (`listInbox`, cookie/query filter) → `src/views/inbox.ts#renderInboxPage` in `renderShell`; a valid remembered filter makes bare `/inbox` redirect to the canonical `?repository=` URL. GET `/inbox/list` with `HX-Request` → `renderInboxList` (self-swapping outerHTML, 30s poll, `hx-push-url="false"`). `inboxLocation` reads the path and query from `HX-Current-URL`; `selectedSpecForPath` keeps the Spec row selected across Spec, Start Session, Session target/release/view paths, while the All Sessions utility is current only for `status=all`. Sidebar Spec groups live in the `Spec inbox` navigation landmark. `renderSpecsUnavailable` warns for mixed `never`/`partial`/`unavailable` Specs refresh states without replacing cached rows or showing a false empty state. `public/app.js` restores focus, `<details>` state, and scroll after a successful poll swap. Direct visit returns the full page.

**Login.** `src/app.ts#createApp` GET `/login` → `src/auth.ts#createAuth.issueCsrf` → `src/views/shell.ts#renderLoginPage`. POST `/login` → `validateLogin` / `matchesSharedToken` → `createSession`. Unauthenticated start POSTs go through `preserveUnauthenticatedStart`.

**Enroll Repository.** GET `/repositories/new` → `GitHubClient.listInstallationRepositories` (org-filtered) → `src/views/repositories.ts#renderAddRepositoryPage`. POST `/repositories` → CSRF → `Persistence.upsertRepository` → `saveCandidate` → `RefreshCoordinator.refresh` (`access`, `specs`).

**Spec list/detail.** GET specs → `refreshRepository` → `Persistence.listSpecs` / `getSpec` → `src/views/specs.ts#renderSpecsPage` or `renderSpecDetailPage`. Current Spec: `isCurrentSpec` (open, `spec` label, not a PR).

**Start Session.** GET `.../sessions/new` → refresh access/specs/PRs → `src/views/sessions.ts#renderStartSessionPage` + `src/views/targets.ts#startTargetOptions`. POST → CSRF + target observation match → `Persistence.queueSession` → `PreparationService.enqueue`. Duplicate unfinished Spec → 409. `createPreparationService.prepareNext` → `claimPreparation` → atomically register the Session scope/helper references → request a preflight credential from the independent supplier → clone via `cloneGitEnvironment` → checkpoints through `prepared`. `createOpenCodeHandoffService` then intent → events → create → associate → one prompt → `Persistence.reconcileOpenCode`. Terminal → `refreshPullRequests` + `preparation.enqueue`.

**Safe update pause.** Later activation code calls `AtlasApp.updatePause.pause()` → `src/update-pause.ts#createUpdatePauseCoordinator` synchronously holds both services → preparation finishes any active cycle at a durable preparation/uncertainty checkpoint while handoff finishes only active create/associate/prompt work → result is `paused` with scoped `resume`. Prompt/evidence and execution reconciliation continue, so Running/Waiting/Idle Sessions do not block. At five minutes the result is `timed_out`, both update holds are removed, and unsafe in-flight work is never aborted.

**Discover/stage Release.** `src/server.ts` starts
`src/update-discovery.ts#createUpdateService` → public GitHub Release pages and
each `atlas-release.json` → `Persistence.recordUpdateDiscoverySuccess` (or a
retaining failure) → newest eligible metadata over
`src/updater.ts#createUpdaterClient` → independent `src/updater-server.ts` →
durable requested/downloading/verifying/extracting/result state → checksum and
embedded-metadata validation → atomic read-only Release tree. GET `/updates`
and `/updates/status` read both stores and prefer matching durable updater state
over a lost staging response; POST `/updates/check` uses existing
auth/same-origin/CSRF and the same coalesced path. Staging neither calls the
safe pause nor changes active selection.

**Approve/activate/recover Release.** POST `/updates/install` →
`src/update-discovery.ts#install` verifies the exact available candidate and
durable staged/runtime/rollback status → updater `prepare_activation` durably
records approval and the previous Release → `AtlasApp.updatePause.pause()` → on
timeout updater records abandonment and Atlas removes only its update pause; on
success updater `activate` continues independently. The surviving updater stops
only `atlas.service`, atomically renames the `current` symlink to the complete
candidate, restarts Atlas, and runs stable `deploy/check-health.sh` against
authenticated `/health?activation=1` for exact tag/SHA and healthy persistence.
Candidate failure suppresses that tag, atomically reselects/restarts the
previous Release, and reports recovery only after the same Atlas-only check.
Atlas processes started during active host work restore the process-local pause
until the durable updater state is terminal; normal OpenCode reconciliation is
independent and never replays creation or the initial prompt.

**All Sessions.** GET `/sessions` → `persistence.listRepositories()` → `listSessions(repositoryId, filter)` for every enrolled, non-removed Repository → flatten and sort by submission order → `renderSessionsPage` in global mode. `?status=all` includes terminal history; default `active` includes every unfinished state.

**Webhook → refresh.** `src/server.ts` webhook listener → `createWebhookApp` POST `/webhooks/github` → `verifyGitHubSignature` → `Persistence.acceptWebhookDelivery` → `RefreshCoordinator.wake`.

**Session viewer SSE.** GET `/sessions/:sessionId` or `/view` → `createSessionViewerService.hydrate` → `src/views/viewer.ts#renderSessionDetailPage` / `renderSessionViewerFragment`. GET `/events` → `streamSSE`; emits refresh/reconcile/stale/connected/auth-expired only (no transcript).

**Reservation release.** GET/POST `/sessions/:sessionId/reservation/release` → terminal + held reservation → `Persistence.releaseReservation` → `preparation.enqueue`. SQLite only; no GitHub mutation.

**Target reconfirmation.** Queued Session blocked for explicit reconfirmation. GET/POST `/sessions/:sessionId/target` → refresh PRs → `Persistence.reconfirmQueuedTarget` → `preparation.enqueue`. Atlas does not infer a replacement.

**Publish Release.** Push release tag → global Actions concurrency →
`scripts/release.ts validate` against published GitHub Release tags → frozen
install/typecheck/focused checks → `scripts/verify-release-artifact.sh` →
`scripts/build-release.sh` archives the exact tagged commit, production
dependencies, CSS, helpers/deploy assets, and `RELEASE_METADATA.json` → isolated
extraction/startup with no OpenCode → `gh release create` without overwrite.

## Shared Utilities and Infrastructure

- `src/inbox-state.ts` — `atlas_inbox` / `atlas_visit` cookie parse and set.
- `src/views/html.ts` — HTML escaping, document shell, HTMX includes.
- `src/views/shared.ts` — layout primitives, access labels/badges, refresh warnings, and Session/Repository status markup.
- `src/views/icons.ts` — Heroicons paths.
- `src/styles.css` / `public/app.css` — Tailwind + daisyUI `atlas` theme.
- `public/app.js` — client HTMX glue; preserves inbox poll focus, open `<details>`, and scroll position.
- `src/recovery-status.ts` — read-only host status.
- `src/release.ts` — tag parsing/order, metadata validation, and runtime identity.
- `src/update-discovery.ts` — public Release discovery, scheduling, candidate retention, approval/safe-pause orchestration, and updater requests.
- `src/updater.ts` — durable independent staging/activation/recovery service and authenticated socket client.
- `src/config.ts#loadGitHubEnv` and `src/credentials.ts#loadGithubEnv` — two github.env loaders (browse keys vs App key path).

## Interfaces and State

**SQLite tables:** `schema_migrations`, `repositories`, `specs`, `refresh_state`, `pull_requests`, `pr_stacks`, `stack_members`, `sessions`, `webhook_deliveries`, `stack_reservations`, `reservation_prs`, `reservation_conflict_holds`, `session_history`, `update_discovery`.

**Session identity:** Atlas IDs `ses_<uuid>`. Unfinished states unique per Spec (`sessions_unfinished_spec_idx`).

**Inbox identity:** `InboxRow` represents one current Spec and its latest Session; `Inbox` also carries the Settled total/new counts. Browser-held `atlas_inbox` and `atlas_visit` cookies carry filter and landing state; poll continuity is transient DOM state, not SQLite state.

**GitHub:** installation token from `CredentialBoundary.installationToken`; browse may fall back to `ATLAS_GITHUB_INSTALLATION_TOKEN`.

**OpenCode:** release-installed `@opencode-ai/client` `0.0.0-beta-19135` against an independently running server with no version gate. Service file default `$XDG_STATE_HOME/opencode/service.json` or `OPENCODE_SERVICE_FILE`.

**Filesystem:** Session directories under `ATLAS_SESSION_ROOT`; credential scopes and canonical helper references in `session-scopes.json`; supplier socket `0600`, owned by `atlas-credentials.service`; updater socket `0660`, owned by `atlas-updater.service`; stable service sources under `/opt/atlas/services/atlas-credentials` and `/opt/atlas/services/atlas-updater`; durable updater state at `/var/lib/atlas/update-state.json`; read-only Release trees under `/opt/atlas/releases`; atomically selected `/opt/atlas/current` symlink. No Release cleanup ships in this slice.

**Update pause:** process-local generation and service hold flags only. Session identity, prompt, target, ordering, preparation/handoff uncertainty, execution-slot ownership, and reservations remain in existing SQLite rows/checkpoints. A restarting Atlas restores the hold from durable updater activation state; terminal host status releases it.

**Release files:** a published archive contains one read-only release directory
and embedded `RELEASE_METADATA.json`; the GitHub Release also carries identical
`atlas-release.json` and a named SHA-256 sidecar. Untagged source has no metadata
file and reports `published: false`.

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
- **Release authority/immutability.** Never add a second maintained release
  version, move a published tag, overwrite an artifact, reset/reuse a global
  build, resolve latest dependencies in CI, or infer rollback safety from
  SemVer/build. The package client pin, lockfile, deployment client manifest,
  and named pin docs move together before tagging.
- **Discovery/staging truth.** A failed public Release check retains known
  candidates and must not render as a successful no-update result. Validate
  published and embedded metadata plus the named checksum before reporting a
  complete staged tree. Coalesce repeated checks/requests, keep progress/result
  durable, and never let staging change `/opt/atlas/current`, pause Session
  admission, install/build dependencies, or inspect/manage OpenCode.
- **Activation health separation.** `deploy/check-health.sh` may require exact
  candidate tag/SHA but gates only on Atlas process/persistence. Keep OpenCode
  readiness/version out of startup and activation; use the independent
  diagnostic for OpenCode.
- **Activation/recovery authority.** Approval is durable before safe pause;
  activation starts only from a complete exact staged tree with met runtimes and
  code-only rollback. Keep updater schema-1 additions readable by the previous
  Atlas Release, never shell-execute `atlas.env`, atomically replace only the
  `current` symlink, and never report rollback before previous identity/storage
  health succeeds. Failed tags require explicit Retry; later tags remain eligible.

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
| `bun run verify:issue57` | Tag/order/global-sequence rules, generated metadata and authenticated health identity, plus isolated archive contents/checksum/startup with no install, CSS build, or OpenCode. |
| `bun run verify:issue58` | Authenticated Updates HTTP/CSRF/direct-fragment behavior, startup/four-hour/manual discovery, candidate retention/failures/ordering, runtime/maintenance presentation, updater socket/archive failure/coalescing, durable restart status, and unchanged active selection/admission. |
| `bun run verify:issue59` | Authenticated Install/Retry HTTP, durable approval/lost-response coalescing, safe-pause timeout, atomic activation, Atlas-only identity/storage health, rollback/failure, failed-tag suppression, updater restart reconciliation, and unchanged shared data/OpenCode ownership. |
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

<!-- repo-map-synced: beb8cc194167a5e203714a7d5e2b3b58069761cb -->
