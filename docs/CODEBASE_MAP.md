# CODEBASE_MAP

Answers: where is today's shipped implementation? Organized by capability and concern, not directory order. Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## Executable Entry Points

| Path | Role |
|---|---|
| `src/cli.ts` | The only entry point: the compiled `atlas` binary and `bun src/cli.ts`. Lazily loads one subcommand: `serve`, `credentials`, `updater`, `gh`, `git-credential`, `setup`, `ops`, `version`. Each module exports `run(args)`. |
| `src/server.ts#run` (`atlas serve`) | UI process. Loads env and release identity (`src/runtime.ts#defaultReleaseRoot` or `ATLAS_RELEASE_ROOT`), configures independent credential/updater clients, restores an activation-owned safe pause when needed, starts SQLite, Repository refresh and Release discovery, serves UI + webhook listeners, and shuts down without owning either surviving socket. |
| `src/credential-server.ts#run` (`atlas credentials`) | Independent credential supplier process. Owns the authenticated Unix-socket boundary and survives Atlas UI restarts. |
| `src/updater-server.ts#run` (`atlas updater`) | Independent root policy/staging/activation/recovery/retention process. Reports host git/gh versions, owns the updater socket, reads canonical Session helper references, controls only `atlas.service`, checks activation health in-process (`checkActivationHealth`), and resumes durable host work after its own restart. Runs candidates as `ATLAS_SERVICE_USER`, never as root. Takes only tags over the socket and fetches each Release's metadata itself. |
| `src/commands/gh.ts#run` (`atlas gh`) | Scoped `gh` wrapper behind the Release `bin/gh` shim. Skips shims on `PATH` by `RELEASE_SHIM_MARKER`. |
| `src/commands/git-credential.ts#run` (`atlas git-credential`) | Git credential helper used by preparation and the Release `bin/git-credential-atlas` shim. Fails closed with `quit=true`. |
| `src/commands/setup.ts` → `src/setup/run.ts#runSetup` (`atlas setup`) | Root installer: fresh install, safe re-run, or adopt of the older Bun/source-tree layout. See **Install and setup**. |
| `src/commands/ops.ts#run` (`atlas ops <tool>`) | Operator tools shipped in the binary. Shell tools from `deploy/*.sh` are embedded as text, written to a private temp folder, and run with `ATLAS_BIN` set to this binary: `snapshot`, `check-space`, `capture-recovery-config`, `restore-rehearsal`, `verify-sqlite-wal`, `install-opencode-config`, `check-health`, `stage-opencode`. In-process: `scrub-opencode-credentials` and `check-restored-state` (`src/ops/*.ts`), `sqlite-version`. |
| `src/commands/version.ts#run` (`atlas version [--json]`) | Prints the embedded identity (`src/release.ts#embeddedReleaseIdentity`); from source, the identity `serve` would load. |
| `package.json` `dev` / `start` / `credentials` / `updater` | Development runs of `bun src/cli.ts <subcommand>`; `dev` builds CSS and watches `serve`. |
| `justfile#dev` | Local bootstrap then `bun run dev`. `justfile#checklist` opens the bearings previewer. |
| `src/app.ts#createApp` | Private UI Hono app; returned `AtlasApp.updatePause` coordinates preparation/handoff for explicit or same-SemVer automatic activation and can start held while surviving host work completes. |
| `src/webhook.ts#createWebhookApp` | Webhook-only Hono app. |
| `install.sh` | POSIX `sh` installer (fourth Release asset), root only (`curl … | sudo sh`; without root it prints the `sudo sh` command and downloads nothing). Refuses non-Linux-x64 or musl, downloads the binary, sidecar and metadata (latest or `--version`/`ATLAS_VERSION`) into a new root-only folder under `/var/tmp` (`TMPDIR` ignored; binary `0500`), checks SHA-256 and metadata, then runs `atlas setup --source-dir <folder> …`. With no terminal and no answers it keeps that folder and prints the command to run as root. Never lays out `/opt/atlas`. Whole script is one function called on the last line. Test hooks `ATLAS_INSTALL_BASE_URL`, `ATLAS_INSTALL_TMP_PARENT`. |
| `scripts/build-binary.ts` (`build:binary`) | Builds CSS, then `bun build --compile --target=bun-linux-x64-baseline src/cli.ts`, defining `__ATLAS_RELEASE_TAG__`/`__ATLAS_RELEASE_SHA__`. |
| `scripts/build-release.ts` (`build:release`), `scripts/release.ts` | The only Release producer: clean checkout at `HEAD`, `@opencode/client` agreement across `package.json`/`bun.lock`/`node_modules`, then exactly `atlas-linux-x64`, `.sha256`, schema-2 `atlas-release.json`, `install.sh`. `scripts/release.ts validate` checks the next tag against published tags. |
| `.github/workflows/check.yml` | PRs: fast tier (install, typecheck, CSS, `deploy/verify-*.sh`, clone-scope, repository-filter). Push to `main` and `workflow_call`: full tier (every `verify:*` script plus a throwaway `scripts/verify-release-artifact.sh` build). Read-only token. |
| `.github/workflows/release.yml` | Manual `workflow_dispatch` (`bump`, `dry_run`). Jobs: plan (allowlist `RELEASERS`, `main` only, next tag, pins SHA) → gate (`check.yml` full tier) → build (read token, `verify-release-artifact.sh`, digest) → publish (write token, no checkout, re-verify, `gh release create` makes tag + Release). Maintainer guide: `.github/release/README.md`. |
| `deploy/*.sh` | Operator tools (`atlas-snapshot.sh`, `check-space.sh`, `capture-recovery-config.sh`, `restore-rehearsal.sh`, `verify-sqlite-wal.sh`, `install-opencode-config.sh`, `check-health.sh`, `stage-opencode.sh`, `lib/recovery-status.sh`) are embedded and run through `atlas ops`. Normal health keeps OpenCode readiness and prints any version warning without failing. OpenCode staging stays exact-version (`@opencode/cli-linux-x64`, `bin/opencode`), registry-integrity-verified, server-only, and operator-selected. `deploy/verify-assets.sh` and `deploy/verify-opencode-commands.sh` are repo checks, not shipped. |
| `deploy/opencode/opencode.json`, `deploy/install-opencode-config.sh` | Shipped headless OpenCode global config (`update: disable`; allow `read` on `*.env`/`*.env.*`; deny `question` by permission and by `tool.use` policy; deny `tool.use` on `external_directory:/etc/atlas/*`, `read:/etc/atlas`, `read:/etc/atlas/*`). `atlas setup` (`src/setup/run.ts#writeOpenCodeConfig`), `atlas ops install-opencode-config`, and `restore-rehearsal` all install it with the script into `<XDG_CONFIG_HOME>/opencode/opencode.json` (setup: `<dataDir>/opencode-config`). Every write runs as the config home's owner: root drops privileges with `setpriv`, any other non-owner caller is refused; `jq` must be on `/usr/bin:/bin`. Idempotent, mode `0400`, keeps a differing prior file as `.replaced-<UTC>` (hard link), refuses symlinks and a sibling `opencode.jsonc`, never restarts OpenCode. The rendered `opencode.service` refuses to start without it. |
| `src/ops/scrub-opencode-credentials.ts` (`atlas ops scrub-opencode-credentials`) | Restore-only, called by `restore-rehearsal.sh`. Deletes saved credentials from a restored `opencode.db` (`credential`, `account`, `control_account`, `account_state` active ids, `wellknown:` `kv` rows), then `VACUUM`s and truncates the WAL. Fails closed if there is no `credential` table. Never run against live OpenCode data. |

The implemented inbox lives in `src/views/inbox.ts`; the deleted `src/prototype-inbox.ts` is not a runtime entry point.

UI binds `127.0.0.1:$ATLAS_PORT` (default 3000). Webhook binds `127.0.0.1:$ATLAS_WEBHOOK_PORT` (default 3001). Ports must differ.

## Capabilities and Concerns

### HTTP routing — `src/app.ts#createApp`

Returns `AtlasApp`. Options: `AppOptions`.

| Method | Path | Concern |
|---|---|---|
| GET | `/health` | Authenticated Atlas release identity + persistence health + independent OpenCode readiness/observed-version JSON. `openCode` also carries `clientVersion` and `versionWarning` (string or `null`), built in `currentOpenCodeReadiness`; both are diagnostics only. `?activation=1` omits the whole `openCode` object for candidate validation. Persistence determines HTTP status. UI app only. |
| GET | `/assets/app.css`, `/assets/app.js`, `/assets/theme.js`, `/assets/htmx.min.js`, `/assets/fonts/{inter,geist-mono}.woff2` | Static assets listed in `src/assets.ts#staticAssets` (`with { type: "file" }` imports: real paths from source, embedded in the binary). `public/app.css` must be built first. |
| GET | `/assets/icon.svg` | Atlas mark tab icon, inline in `src/app.ts` (no `favicon.ico` request). |
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
| GET | `/pull-requests` | PRs + stacks across enrolled Repositories, or the filtered one (`src/views/pull-requests.ts#renderAllPullRequestsPage`). Honors the Inbox filter. |
| GET | `/more` | Phone/tablet More tab: Updates, theme, sign-out (`src/views/shell.ts#renderMorePage`). |
| GET | `/sessions/:sessionId` | Session detail + viewer. |
| GET/POST | `/sessions/:sessionId/target` | Target reconfirmation. |
| GET/POST | `/sessions/:sessionId/reservation/release` | Explicit reservation release. |
| GET | `/sessions/:sessionId/view` | Viewer fragment or page. |
| GET | `/updates` | Global Updates page: installed/available Release identities, discovery truth, host requirements, staging/activation/recovery/cleanup progress and results, Install/Retry, and persistent approval-required/automatic policy controls. |
| GET | `/updates/status` | `#updates-live-status` fragment when `HX-Request`; full page otherwise. Active checks/staging/activation/cleanup poll every two seconds without replacing the policy form or adding history. |
| POST | `/updates/check` | Existing bearer or browser same-origin/CSRF-protected public Release check; coalesces with an in-flight check and redirects to `/updates`. HTMX receives value-preserving page HTML on rejection. |
| POST | `/updates/install` | Existing bearer or browser same-origin/CSRF-protected Install/Retry approval with parsed `ReleaseTag`; durably records the exact staged candidate, invokes the safe pause, and redirects while host activation continues independently. Rejection returns retryable page HTML. |
| POST | `/updates/policy` | Existing bearer or browser same-origin/CSRF-protected installation policy change; persists through the updater, re-evaluates retained candidates, and starts one coalesced check. Rejection preserves the submitted policy in page HTML. |

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

Returns `CredentialBoundary`: `{ credentialsPath, registryPath, socketPath, keyPath, start, close, registerScope, resolveScope, listHelperReferences, requestToken, assertReady, installationToken, helperEnvironment }`. Also `CredentialError`, `CredentialScope`, `readGithubEnvFile`, `loadGithubEnv`, `readSessionHelperReferences`, `requestCredential`. The standalone reader requires an absolute canonical path, expected owner UID, exact `0600` regular file, and valid registry contents for root updater use.

`src/credential-server.ts` runs the Unix-socket supplier independently. Atlas creates a non-serving client boundary, so client `start`/`close` cannot own or unlink the socket. Repository-scoped App tokens and the version-1 Session scope registry are unchanged; scope records may include canonical helper paths consumed by Release retention. `src/config.ts#loadGitHubEnv` loads browse keys from `~/.config/atlas/github.env` when unset (mode `0600`).

### Preparation — `src/preparation.ts#createPreparationService`

Returns `PreparationService`: `{ start, stop, enqueue, prepareNext, pauseForUpdate, resumeFromUpdate, credentials, sessionRoot, capacity }`. Also `DEFAULT_MIN_FREE_BYTES`, `hasRequiredFreeSpace`, `cloneGitEnvironment`.

Clones under `ATLAS_SESSION_ROOT`. Default capacity 1. Uses `atlas git-credential` through `src/runtime.ts#selfCommand` (the binary itself, or Bun + `src/cli.ts` from source), records `selfHelperPaths()` as the Session's helper references, and requests credentials from the independent supplier. Strips inherited Git/GitHub tokens from clone env. May gate on `src/recovery-status.ts#readRecoveryStatus`. Shares `src/activity-gate.ts#createActivityGate` with OpenCode handoff for balanced active-operation accounting and pause waiters.

### OpenCode handoff — `src/opencode.ts#createOpenCodeHandoffService`

Returns `{ start, stop, enqueue, process, pauseForUpdate, resumeFromUpdate, getClient, isReady, readiness, onEvent, onTransport, transportState }`. Discovers `@opencode/client` `Service` without a server-version filter, probes readiness with `client.server.info()` (`GET /api/info`; any object answer is ready, its `version` is diagnostic), validates the event stream, and exposes the observed version through readiness when available. Also exports `openCodeClientVersion` (`@opencode/client/package.json` imported as JSON, so it is fixed at build time; `null` if unusable) and `openCodeVersionWarning` (text only when client and server major.minor differ; never feeds readiness, discovery, handoff, or updates). Checkpoints: intent → events → create once → associate once → one exact prompt → reconcile. Prompt read-back uses `session.message.get` then `session.inbox.list`; execution reconciliation (`reconcileExecution`) reads `session.get`, `session.active`, `permission.list`, `session.form.list`, `session.inbox.list`, and `experimental.job.list` (running jobs for the tree), and compares location by directory only. A root `outcome` becomes terminal (and releases the slot) only when the tree is quiet: root inactive, no running job, empty root inbox, no verified descendant active (`descendantActivity`/`listChildren`: child names its parent and shares the directory, max 256 nodes / depth 32, same rule as the viewer), and no evidence event raced the reads (`EventEvidence.seq`). Otherwise the Session stays `running` (reason names child Sessions or undelivered input); an incomplete bounded walk also stays `running`; any read failure marks it stale and keeps the slot. A confirmed terminal outcome on a quiet tree wins over a leftover pending permission/form (so a stale item cannot hold the slot forever); without one, a pending permission/form or provider retry makes it `waiting`. A run genuinely blocked on a permission/form keeps its root in `session.active()`, so the tree is live and the outcome is not trusted. On 2.3.2, interrupting a blocked run clears the pending item with `outcome: "interrupted"`, and pending items do not survive an OpenCode restart (OpenCode resumes the run itself; Atlas sends nothing). A terminal event whose `outcome` is not yet readable stays `running` for `OUTCOME_CONFIRM_MS` (10 s). Provider-retry `waiting` comes from `session.retry.scheduled` or, after reconnect, the latest assistant message's `retry` (`readableRetry`); real progress (`PROGRESS_EVENT`, `session.execution.*`) clears it, `session.step.started` does not. `session.status`/`session.idle` handlers are kept for forward compatibility only (2.3.2 never emitted them in testing). Verified children are tracked from same-directory `session.created` events (`descendantRoots`). `resetStream` clears the observed server version. Update pause uses `src/activity-gate.ts#createActivityGate` to drain create/associate/prompt work but permits prompt-acceptance evidence and execution reconciliation that cannot duplicate an effect. Does not store a transcript.

### Safe update pause — `src/update-pause.ts#createUpdatePauseCoordinator`

Returns `{ pause, hold, state }`. `pause()` synchronously holds preparation and handoff, coalesces overlapping requests, and resolves to `paused` with an idempotent generation-scoped `resume`, or to `timed_out` after `UPDATE_PAUSE_TIMEOUT_MS` (five minutes) after automatically removing only this pause. `hold()` uses the same drain without a deadline for restart safety. `restoreUpdatePauseUntilUpdaterSettles` keeps that hold through unavailable/active updater status and releases it only on terminal status. `AtlasApp.updatePause` exposes the boundary to explicit/automatic activation and startup recovery.

### Session viewer — `src/session-viewer.ts#createSessionViewerService`

Returns `{ hydrate }`. Also `createViewerEventReducer`, `ViewerScopeError`. Types: `SessionViewerProjection`, `ViewerConnection`, `ViewerSemanticState`, `ViewerFreshness`. Authorizes OpenCode session IDs by walking the descendant tree. No SQLite writes. Locations are directory-only (`locationInput`, `sameLocation`; a workspace-bound answer is not the Session's location). Pending forms come from `session.form.list`. A node's `outcome` ranks above `active` (`initialSemanticState`). Live tool overlays carry `called.native`, `result.metadata`, and `result.native`; result metadata wins over progress metadata.

### Views — `src/views.ts`

| Symbol | Owner |
|---|---|
| `renderShell`, `ShellHeader`, `renderMorePage`, `renderLoginForm`, `renderLoginPage`, `PendingStartSession` | `src/views/shell.ts` |
| `tabForPath`, `renderSideNav`, `renderTabBar`, `repositoryFilter`, `inboxItemHref`, `renderLiveList`, `themeControl`, `renderAccountMenu`, `systemWarnings`, `renderWarningStrip` | `src/views/frame.ts` (frame chrome used by `renderShell`) |
| `renderSessionsPage` | `src/views/session-list.ts` (sorted by `submittedAt` desc) |
| `renderMarkdown` | `src/views/markdown.ts` (safe Markdown for Spec bodies; wide tables scroll in place) |
| `InboxContext`, `renderInboxFilter`, `renderInboxGroups`, `renderInboxList`, `renderInboxPage` | `src/views/inbox.ts` |
| `renderRepositoriesPage`, `renderAddRepositoryPage`, `repositoryMatchesQuery` | `src/views/repositories.ts` |
| `renderSpecsPage`, `renderSpecDetailPage`, `renderSpecUnavailablePage` | `src/views/specs.ts` |
| `renderStartTargetOptions`, `startTargetOptions`, `targetObservation` | `src/views/targets.ts` |
| `renderPullRequestsPage`, `renderAllPullRequestsPage` | `src/views/pull-requests.ts` |
| `renderStartSessionForm`, `renderStartSessionPage`, `renderSessionsPage`, `renderPendingStartSessionPage`, `renderPendingStartSessionFragment`, `renderTargetReconfirmationPage`, `renderTargetReconfirmationForm`, `renderReservationReleasePage`, `renderReservationReleaseForm` | `src/views/sessions.ts` |
| `renderSessionDetailPage`, `renderSessionViewerFragment`, `renderSessionLiveCards` | `src/views/viewer.ts` (`renderSessionLiveCards`: status/now/result cards swapped over SSE) |
| `renderUpdatesPage`, `renderUpdatesStatus` | `src/views/updates.ts` |

Inbox navigation internals: `src/views/inbox.ts#renderInboxUtility` owns the filtered Repository utility links and their path/query current-state predicates; `utilityLink` owns their shared markup.

Viewer message rendering (`src/views/viewer.ts#renderViewerMessage`) includes an `idle` message as "Execution <outcome>" plus its error text.

Shared markup: `src/views/html.ts` (`escapeHtml`, `safeExternalUrl`, `renderDocument`), `src/views/kit.ts` (the UI kit: status tiles/pills, rows, groups, `pageTitle`, `segmented`, `button`, `settingsRow`, `banner`, `moreMenu`, `confirmAction`, `prose`, `terminalWell`, `relativeTime`), `src/views/shared.ts` (`repositoryPage` — the Repository header + Specs/Sessions/PRs segments — access labels/notices, Session state/target/publication labels). The OpenCode paused-launch and `data-opencode-version-warning` mismatch banners render only on Session detail (`src/views/viewer.ts#renderSessionDetailPage`), `src/views/icons.ts#icon`. Theme: `src/styles.css` → `public/app.css`. Client glue: `public/app.js` preserves inbox poll focus, open details, and scroll position after outerHTML swaps, and adopts the Inbox desktop pane (`adoptPane`: demotes its h1, renames clashing ids).

### Recovery status — `src/recovery-status.ts#readRecoveryStatus`

Types: `RecoveryStatus`, `SpaceRecoveryStatus`, `BackupRecoveryStatus`. Atlas reads host-written status; it does not take snapshots. The root timers write it through `deploy/lib/recovery-status.sh`, which resolves only the folder and, when the folder is not root's, reads and writes as its owner via `setpriv`.

### Release identity — `src/release.ts`

`ReleaseTag` brands validated tag strings. `parseReleaseTag`, `compareReleaseTags`, and `validateReleaseSequence` implement
stable SemVer-first/global-build ordering beginning at `v0.1.0+build.1`.
`createReleaseMetadata` and `assertReleaseMetadata` own schema-2 metadata
(`identity`, `asset` name/checksum/sha256/size, `minimumHostTools`,
`openCodeClient`, `rollback`); schema 1 and unknown schemas are refused.
`embeddedReleaseIdentity` reads the identity compiled into the binary;
`loadReleaseIdentity` prefers it and refuses a disagreeing
`RELEASE_METADATA.json`; from source the file decides and its absence means
unpublished development. Asset names: `RELEASE_ASSET_NAME`,
`RELEASE_CHECKSUM_NAME`.

### Release folder — `src/release-layout.ts#buildReleaseFolder`

The single builder of `<root>/atlas-<tag>/` (`atlas`, `RELEASE_METADATA.json`,
`bin/gh`, `bin/git-credential-atlas`, `bin/git`). Used by updater staging,
`installShippedSupportServices`, and `atlas setup`. Copies the binary to a temp
sibling, checks size and SHA-256 of the copy before anything runs, runs
`atlas version --json` (as `runAs` via `setpriv` under root; refuses root),
refuses an identity mismatch, writes read-only files, fsyncs, and renames. An
intact existing folder is reused (`releaseFolderIntact`); a non-intact one is
refused. Also `gitWrapperText` (host git with minimum-version check,
`ATLAS_REAL_GIT`) and `unprivilegedCommandPrefix`. Shim text and
`RELEASE_SHIM_MARKER` live in `src/shims.ts`; minimums in
`src/host-tools.ts#MINIMUM_HOST_TOOLS` (git 2.36.0, gh 2.3.0).

### Units — `src/units.ts`

`renderUnits` renders `atlas.service` (`<prefix>/current/atlas serve`),
`atlas-credentials.service` and root `atlas-updater.service`
(`<prefix>/services/current/atlas credentials|updater`, `ATLAS_SERVICE_USER`),
and `opencode.service` for a chosen user/group/home/paths. Refuses root.
`renderMaintenanceUnits` renders the Btrfs snapshot and space-check
services/timers that run `<prefix>/current/atlas ops …`. No checked-in units.

### Install and setup — `src/setup/run.ts#runSetup`

Order: read the Release (`--source-dir` with `atlas-release.json`, or the
folder next to the binary; the folder and every parent must be root-owned and
not group/other-writable, and it is copied to setup's own root-only folder and
re-checked) and the host (unit and `atlas.env` trusted only when root-only;
otherwise `atlas.env` secrets are kept and its paths dropped) (`readExisting`: `layout` none →
fresh, current → re-run, Bun/`src/server.ts` unit → adopt) → `preflight`
(`src/setup/preflight.ts`: systemd, `setpriv`, `getent`, git, gh at minimums
stop setup; git/gh under `/home` or `/root` or changeable by non-root also stop
it; `--version` probes run as `nobody` via `SetupHost.runAs`; missing OpenCode
warns) → answers (`src/setup/answers.ts#parseSetupArgs`: flags > answers file >
existing config > prompt) → service account (default `atlas`; `useradd
--system` only with consent or `--create-user`; root refused; an account that
can become root (`privilegeReasons`: privileged groups or sudo rules) needs a
yes or `--allow-privileged-user`; re-run/adopt keep the unit's user and warn) → `--dry-run` plan → adopt: Session
check (read as the service user through `atlas ops session-summary`), backup
of units + every `/etc/atlas` file + `etc-atlas-owners.json` (`recordConfigOwners`) + `ROLLBACK.txt` (symlink
targets recorded, not copied; `restoreAdopt` puts owners/modes back), stop old services → folders (`/etc/atlas` `root:<group> 0750`;
data folder contents created as the service user), App key at the fixed
`/etc/atlas/github-app.pem`, keys and env files (`atlas.env` root `0600`, the
rest `root:<group> 0640`; any file whose text changes is backed up first),
`buildReleaseFolder`, `current` (never moved to an older Release),
`installShippedSupportServices`, `/usr/local/bin/atlas` link, units,
maintenance units only on Btrfs, OpenCode config → start and poll `/health`
→ optional `src/setup/tailscale.ts#setUpTailscale` (serve only; an existing
or unreadable serve config is replaced only after a yes; prints `funnelHint`). Adopt failure restores the old install if the database schema
did not change. All host access goes through `src/setup/host.ts#SetupHost`
(`--root` prefix, fake commands in checks); writes use `src/setup/files.ts`
(atomic replace, never chmod/chown in place, no symlink follow, unsafe parents
refused, backup before change).

### Release discovery — `src/update-discovery.ts#createUpdateService`

Returns `UpdateService`: `{ start, stop, check, status, setPolicy, install }`. Also
`createUnavailableUpdateService`, `UPDATE_CHECK_INTERVAL_MS`. Types:
`UpdateStatus`, `UpdateServiceOptions`. Lists all non-draft/non-prerelease public
GitHub Releases and validates each `atlas-release.json`; orders with
`compareReleaseTags`; persists the complete candidate set; retains it on
failure; and requests staging for the policy-selected Release newer than the
installed published identity. Approval policy selects the newest Release;
automatic policy first selects the highest numeric build of the exact installed
SemVer, without hiding it behind a newer SemVer. Startup/manual/scheduled checks
share one coalesced promise and automatic staging completion feeds the existing
activation path. `install` and automatic activation validate the exact
available/staged/runtime/rollback contract, serialize overlapping requests,
record the decision through the updater, then convert the coordinated safe pause
into one durable activation or timeout abandonment; lost responses reconcile by
status.

### Release staging, activation, recovery, and retention — `src/updater.ts#createUpdaterService`

Returns `{ start, close, status, setPolicy, requestStage, prepareActivation, beginActivation, abandonActivation }`; exported `installShippedSupportServices` builds the candidate's binary into a support bundle with `buildReleaseFolder` and atomically selects it; `createUpdaterClient` returns
the UI-side authenticated Unix-socket `UpdaterClient`. Types: `UpdaterStatus`,
`UpdaterResult`, `UpdatePolicy`, `CleanupStatus`, `RuntimeRequirements`, `HostRuntime`; release-bearing results and suppression/cleanup collections use validated `ReleaseTag`. The independent service
atomically writes `/var/lib/atlas-updater/update-state.json` (root-only
`StateDirectory`; a file not owned by the updater or group/other-writable is
ignored), serializes one request, takes only a tag from the socket, fetches
that tag's `atlas-release.json` itself (64 KiB cap), refuses a build not above
the active one, then downloads over HTTPS only (at most five https redirects,
streamed with size caps; the binary must match the metadata size) the named
binary and its `.sha256` sidecar, and builds the Release
folder under `/opt/atlas/releases` with `buildReleaseFolder` (SHA-256 before
execution, identity check as the service user). It reuses intact staged
folders and resumes an active durable request after restart. The same schema-2
state stores activation target, installation policy, previous Release,
progress/result, health deadline, failed-tag suppression, and cleanup
targets/outcomes. A schema-1 (tarball-era) state file resets to idle but keeps
its policy; missing policy reads as approval required.
Immediately before safe pause it revalidates host git/gh against
`minimumHostTools`. After a confirmed safe checkpoint it stops only Atlas, atomically selects the
complete candidate, restarts Atlas, and requires exact Atlas identity plus
healthy persistence within 60 seconds; failure selects/restarts/verifies the
previous Release only if its recorded folder is still intact (otherwise
`rollback_failed`). After candidate health succeeds, it builds the candidate
binary into a read-only support bundle under `/opt/atlas/services/releases`
and atomically selects `/opt/atlas/services/current` (never replacing a
selected bundle of a higher build) without restarting the running services. It then removes only managed Release folders older than current
after protecting current, previous-working, staged/in-flight, and every tree
containing a canonical Session helper reference. Cleanup targets/outcomes are
durable, partial cleanup is re-evaluated after restart, and failure remains
separate from healthy activation. It has no OpenCode operation and never targets
support bundles, Session/data paths, credentials, or host tools.

## Critical Flows

**Land on `/`.** `src/app.ts#createApp` GET `/` → `src/inbox-state.ts#readVisitCookie` → `Persistence.findLandingSession` → 303 to the earliest new terminal Session, otherwise the earliest unfinished Session with Waiting first, otherwise the remembered enrolled Repository's Spec list, `/inbox` when Repositories exist, or `/repositories/new`. Every redirect writes `atlas_visit`; a selected Session/Repository also writes `atlas_inbox`.

**Inbox.** GET `/inbox` → `inboxFromRequest` (`listInbox`, cookie/query filter) → `src/views/inbox.ts#renderInboxPage` in `renderShell`; a valid remembered filter makes bare `/inbox` redirect to the canonical `?repository=` URL. GET `/inbox/list` with `HX-Request` → `renderInboxList` (self-swapping outerHTML, 30s poll, `hx-push-url="false"`). `inboxLocation` reads the path and query from `HX-Current-URL`; `selectedSpecForPath` keeps the Spec row selected across Spec, Start Session, Session target/release/view paths, while the All Sessions utility is current only for `status=all`. Sidebar Spec groups live in the `Spec inbox` navigation landmark. `renderSpecsUnavailable` warns for mixed `never`/`partial`/`unavailable` Specs refresh states without replacing cached rows or showing a false empty state. `public/app.js` restores focus, `<details>` state, and scroll after a successful poll swap. Direct visit returns the full page.

**Login.** `src/app.ts#createApp` GET `/login` → `src/auth.ts#createAuth.issueCsrf` → `src/views/shell.ts#renderLoginPage`. POST `/login` → `validateLogin` / `matchesSharedToken` → `createSession`. Unauthenticated start POSTs go through `preserveUnauthenticatedStart`.

**Enroll Repository.** GET `/repositories/new` → `GitHubClient.listInstallationRepositories` (org-filtered) → `src/views/repositories.ts#renderAddRepositoryPage`. POST `/repositories` → CSRF → `Persistence.upsertRepository` → `saveCandidate` → `RefreshCoordinator.refresh` (`access`, `specs`).

**Spec list/detail.** GET specs → `refreshRepository` → `Persistence.listSpecs` / `getSpec` → `src/views/specs.ts#renderSpecsPage` or `renderSpecDetailPage`. Current Spec: `isCurrentSpec` (open, `spec` label, not a PR).

**Start Session.** GET `.../sessions/new` → refresh access/specs/PRs → `src/views/sessions.ts#renderStartSessionPage` + `src/views/targets.ts#startTargetOptions`. POST → CSRF + target observation match → `Persistence.queueSession` → `PreparationService.enqueue`. Duplicate unfinished Spec → 409. `createPreparationService.prepareNext` → `claimPreparation` → atomically register the Session scope/helper references → request a preflight credential from the independent supplier → clone via `cloneGitEnvironment` → checkpoints through `prepared`. `createOpenCodeHandoffService` then intent → events → create → associate → one prompt → `Persistence.reconcileOpenCode`. Terminal → `refreshPullRequests` + `preparation.enqueue`.

**Safe update pause.** Later activation code calls `AtlasApp.updatePause.pause()` → `src/update-pause.ts#createUpdatePauseCoordinator` synchronously holds both services through their shared `src/activity-gate.ts` accounting → preparation finishes any active cycle at a durable preparation/uncertainty checkpoint while handoff finishes only active create/associate/prompt work → result is `paused` with scoped `resume`. Prompt/evidence and execution reconciliation continue, so Running/Waiting/Idle Sessions do not block. At five minutes the ordinary result is `timed_out`, both update holds are removed, and unsafe in-flight work is never aborted. Published-process startup instead uses deadline-free `hold()` while updater status is unavailable or active.

**Discover/stage Release.** `src/server.ts` starts
`src/update-discovery.ts#createUpdateService` → public GitHub Release pages and
each `atlas-release.json` → `Persistence.recordUpdateDiscoverySuccess` (or a
retaining failure) → updater policy selects newest overall in approval mode or
the highest newer numeric build of the exact installed SemVer in automatic mode
→ selected tag over
`src/updater.ts#createUpdaterClient` → independent `src/updater-server.ts` →
self-fetched metadata + forward-only check → durable
requested/downloading/verifying/preparing/result state → binary and
sidecar download, sidecar check → `src/release-layout.ts#buildReleaseFolder`
(SHA-256, identity as the service user) → atomic read-only Release folder. GET `/updates`
and `/updates/status` read both stores and prefer matching durable updater state
over a lost staging response; POST `/updates/check` uses existing
auth/same-origin/CSRF and the same coalesced path. Staging neither calls the
safe pause nor changes active selection.

**Configure/activate/recover Release.** POST `/updates/policy` persists the
installation-local default/automatic selection through updater `set_policy`,
then re-evaluates known candidates and requests one coalesced check. Startup,
scheduled, manual, and policy wakeups can automatically enter activation only
for a higher build of the installed SemVer; failed tags and SemVer changes remain
explicit. That path and POST `/updates/install` →
`src/update-discovery.ts#activateCandidate` verifies the exact available candidate
and durable staged/runtime/rollback status → updater revalidates host runtimes and `prepare_activation`
durably records the decision and previous Release →
`AtlasApp.updatePause.pause()` → on timeout updater records abandonment and Atlas
removes only its update pause; on success updater `activate` continues
independently. The surviving updater stops
only `atlas.service`, atomically renames the `current` symlink to the complete
candidate, restarts Atlas, and runs `src/updater-server.ts#checkActivationHealth`
(shared token and UI port read from `atlas.env` as data) against
authenticated `/health?activation=1` for exact tag/SHA and healthy persistence.
Candidate failure suppresses that tag from automatic activation, atomically
reselects/restarts the previous Release, and reports recovery only after the
same Atlas-only check. Retry can permit that tag; a later same-SemVer build stays
eligible. After successful candidate health it builds an immutable support
bundle from the candidate binary, atomically selects `/opt/atlas/services/current`, and leaves the
already-running credential/updater processes untouched.
Atlas processes started during active host work restore the process-local pause
until the durable updater state is terminal; normal OpenCode reconciliation is
independent and never replays creation or the initial prompt. Before publishing
successful activation or recovered rollback, the updater applies retention from
the resulting selection and Session helper registry; a cleanup failure is shown
separately without changing the activation result. Startup and completed staging
also reconcile the same durable cleanup rules.

**All Sessions.** GET `/sessions` → `persistence.listRepositories()` → `listSessions(repositoryId, filter)` for every enrolled, non-removed Repository → flatten and sort by `submittedAt` desc (tie-break submission order) → `renderSessionsPage` in global mode. `?status=all` includes terminal history; default `active` includes every unfinished state.

**Webhook → refresh.** `src/server.ts` webhook listener → `createWebhookApp` POST `/webhooks/github` → `verifyGitHubSignature` → `Persistence.acceptWebhookDelivery` → `RefreshCoordinator.wake`.

**Session viewer SSE.** GET `/sessions/:sessionId` or `/view` → `createSessionViewerService.hydrate` → `src/views/viewer.ts#renderSessionDetailPage` / `renderSessionViewerFragment`. GET `/events` → `streamSSE`; emits refresh/reconcile/stale/connected/auth-expired only (no transcript).

**Reservation release.** GET/POST `/sessions/:sessionId/reservation/release` → terminal + held reservation → `Persistence.releaseReservation` → `preparation.enqueue`. SQLite only; no GitHub mutation.

**Target reconfirmation.** Queued Session blocked for explicit reconfirmation. GET/POST `/sessions/:sessionId/target` → refresh PRs → `Persistence.reconfirmQueuedTarget` → `preparation.enqueue`. Atlas does not infer a replacement.

**Publish Release.** A listed releaser runs `.github/workflows/release.yml`
on `main` with a bump → plan: allowlist, `main` only, pin the SHA, next tag
from published Releases (`scripts/release.ts validate`) → gate: `check.yml`
full tier on that SHA → build: `scripts/verify-release-artifact.sh` →
`scripts/build-release.ts` → `scripts/build-binary.ts`, then sidecar,
schema-2 metadata, `install.sh`; the binary runs with no Bun on `PATH` and
answers `/health` → upload with a digest → publish (no checkout): re-check
digest and checksum, one `gh release create` makes tag + Release. Nothing is
tagged if any earlier job fails; `dry_run` stops before publishing.

**Install / re-run / adopt.** `curl … | sudo sh` → `install.sh` (root only) →
download into a root-only `/var/tmp` folder + SHA-256 →
`atlas setup --source-dir <folder>` → `src/setup/run.ts#runSetup`
(see **Install and setup**). Re-run keeps secrets and config unless
`--rotate-*` or answers change them, backs up changed files to
`/var/backups/atlas/setup-<time>/`, and restarts services only when something
changed. Adopt keeps the existing service user (warning once if it is privileged),
moves secrets it owned to `root:<group> 0640`, and stops `atlas` →
`atlas-updater` → `atlas-credentials`, never OpenCode.

## Shared Utilities and Infrastructure

- `src/inbox-state.ts` — `atlas_inbox` / `atlas_visit` cookie parse and set.
- `src/views/html.ts` — HTML escaping, document shell, HTMX includes.
- `src/views/kit.ts` — UI kit (see Views).
- `src/views/shared.ts` — `repositoryPage`, access labels/notices, and Session/Repository labels.
- `src/views/icons.ts` — inline SVG icon paths (`icon()`).
- `src/styles.css` / `public/app.css` — Tailwind build; Look A tokens (`--a-*`, `--t-*`, `--f-*`, light + dark), fonts, kit and frame CSS. Page slices: `src/styles/{inbox,session,spec,repos,prs,lists}.css`.
- `public/theme.js` — sets `data-theme` before first paint from the saved Light/Dark choice (Auto = none).
- `scripts/ui-demo.ts` — `bun run demo`: seeded in-memory Atlas with fake GitHub/OpenCode on port 4141, `/__demo` index of every screen and state flip.
- `public/app.js` — client HTMX glue; preserves inbox poll focus, open `<details>`, and scroll position.
- `src/recovery-status.ts` — read-only host status.
- `src/activity-gate.ts` — shared balanced active-operation and pause-waiter accounting for preparation and handoff.
- `src/release.ts` — tag parsing/order, schema-2 metadata validation, and embedded/runtime identity.
- `src/runtime.ts` — `isCompiledBinary`, `selfCommand`, `selfHelperPaths`, `defaultReleaseRoot`: the one place that knows binary vs source.
- `src/assets.ts` — static asset table (embedded in the binary). `src/embedded-files.d.ts` types the file/text imports.
- `src/release-layout.ts`, `src/shims.ts`, `src/host-tools.ts` — Release folder builder, shim text, host-tool minimums and version compare.
- `src/units.ts` — systemd unit templates (services and Btrfs maintenance).
- `src/setup/*` — `atlas setup` (answers, host seam, atomic files, preflight, run, Tailscale).
- `src/commands/*`, `src/ops/*` — small subcommands and in-process `atlas ops` tools.
- `src/update-discovery.ts` — public Release discovery, scheduling, policy candidate selection, automatic/explicit safe-pause orchestration, and updater requests.
- `src/updater.ts` — durable independent policy/staging/activation/recovery/retention service and authenticated socket client.
- `src/config.ts#loadGitHubEnv` and `src/credentials.ts#loadGithubEnv` — two github.env loaders (browse keys vs App key path).
- `scripts/isolate-opencode.ts` — side-effect import that points `OPENCODE_SERVICE_FILE` at a non-existent temp path so verifiers never discover a live OpenCode. Imported first by `verify-issue25`, `verify-issue29`, `verify-issue32-backoff`, `verify-issue52`, `verify-issue56`, `verify-issue58`, `verify-issue59`, `verify-issue60`, `verify-inbox-page`, `verify-inbox-shell`, `verify-landing`, and `verify-release`. New verifiers that build the app or handoff must import it too.

## Interfaces and State

**SQLite tables:** `schema_migrations`, `repositories`, `specs`, `refresh_state`, `pull_requests`, `pr_stacks`, `stack_members`, `sessions`, `webhook_deliveries`, `stack_reservations`, `reservation_prs`, `reservation_conflict_holds`, `session_history`, `update_discovery`.

**Session identity:** Atlas IDs `ses_<uuid>`. Unfinished states unique per Spec (`sessions_unfinished_spec_idx`).

**Inbox identity:** `InboxRow` represents one current Spec and its latest Session; `Inbox` also carries the Settled total/new counts. Browser-held `atlas_inbox` and `atlas_visit` cookies carry filter and landing state; poll continuity is transient DOM state, not SQLite state.

**GitHub:** installation token from `CredentialBoundary.installationToken`; browse may fall back to `ATLAS_GITHUB_INSTALLATION_TOKEN`.

**OpenCode:** `@opencode/client` `2.3.2` compiled into the binary (exact pin in `package.json` and `bun.lock`; reported as `openCodeClient` in metadata) against an independently running server with no version gate. Service file default `$XDG_STATE_HOME/opencode/service.json` or `OPENCODE_SERVICE_FILE`. Host: default `/opt/atlas/tools/opencode/current/bin/opencode` (setup `--opencode` may choose another path; `src/setup/preflight.ts#DEFAULT_OPENCODE`) on `127.0.0.1:49475`, `--log-level warn`, `XDG_CONFIG_HOME=/var/lib/atlas/opencode-config` holding the headless `opencode/opencode.json`.

**Filesystem:** Session directories under `ATLAS_SESSION_ROOT`; credential scopes and canonical helper references in owner-controlled exact-`0600` `session-scopes.json`; supplier socket `0600`, owned by `atlas-credentials.service`; updater socket `0660`, owned by `atlas-updater.service`; immutable service bundles under `/opt/atlas/services/releases` with atomically selected `/opt/atlas/services/current`; durable updater policy/staging/activation/cleanup state at root-only `/var/lib/atlas-updater/update-state.json` (the updater sees the data folder read-only); read-only Release folders under `/opt/atlas/releases`; atomically selected `/opt/atlas/current` symlink. Cleanup is confined to older managed Release directories and retains actual selected/staged/in-flight/helper-referenced folders; support bundles are outside its boundary.

**Update pause:** process-local generation and service hold flags only. Session identity, prompt, target, ordering, preparation/handoff uncertainty, execution-slot ownership, and reservations remain in existing SQLite rows/checkpoints. A restarting Atlas restores the hold from durable updater activation state; terminal host status releases it.

**Update policy:** updater state stores `approval_required` by default or
`automatic` per installation. Automatic selection is a higher numeric build of
the exact process-installed SemVer only; candidates, failed-tag suppression,
runtime/rollback eligibility, and activation progress remain in their existing
stores and paths.

**Release files:** a GitHub Release carries `atlas-linux-x64`,
`atlas-linux-x64.sha256`, schema-2 `atlas-release.json`, and `install.sh`. An
installed Release folder holds the binary, a byte-equal
`RELEASE_METADATA.json`, and generated `bin/` shims. The identity is also
compiled into the binary. Untagged source has no metadata file and reports
`published: false`.

**Host layout written by setup:** `/opt/atlas/{releases,current,services}`,
`/usr/local/bin/atlas` → `/opt/atlas/current/atlas`, `/etc/atlas` (`root:<group> 0750`) with
`atlas.env` (root `0600`) and `github.env`, `github-app.pem`, `supplier.key`,
`updater.key` (`root:<group> 0640`), `/var/lib/atlas` (service user `0700`),
`/var/lib/atlas-updater` (root, `0700`), units in `/etc/systemd/system`,
backups in `/var/backups/atlas`. The service user defaults to a dedicated
`atlas` system account (home `<data>/home`). `src/credentials.ts` accepts a
secret that is root-owned and not group-writable or other-readable.

## Change Hazards

- **Credential leakage and continuity.** `cloneGitEnvironment` strips inherited tokens. Supplier socket `0600`; the independent service alone owns its lifecycle and selected immutable support bundle. Atlas client shutdown must not unlink it. `src/commands/gh.ts` forbids `auth token` / login / refresh / setup-git and `--debug`. Never log tokens, keys, prompts, or auth headers.
- **Webhook surface.** Signature required. Empty secret fails boot. Webhook app has no UI, login, Session, health, or OpenCode routes.
- **OpenCode boundary.** Keep the release-installed client dependency unchanged; deployment independently selects the host executable through `/opt/atlas/tools/opencode/current`, and staging neither pairs with nor replaces Atlas client packages and never activates the server. Server version is diagnostic, not a discovery gate; the major.minor skew warning must never feed readiness, HTTP status, handoff, or the update path, and stays out of `/health?activation=1` and the Updates page. Invalid discovery/`/api/info`/events and later API failures must retain not-ready/stale/uncertain state and never duplicate create/prompt effects or invent terminal outcomes.
- **No blind create/prompt retry.** The read-back design (`prompt_sent` → `session.message.get`/`session.inbox.list`; `create_sent` → `session.get`) is load-bearing. Re-sending `session.create` with the saved ID returns the existing Session (200). Re-sending `session.prompt` with the same message ID is not a no-op and not a reliable dedupe signal: 2.3.2 returns the same inbox item (new `time.created`) with no second user message or model call, but after the round has finished it starts an empty execution round and appends an extra `idle` message; during a running round it does nothing. The issue52/issue56 fakes count repeated prompt IDs and assert zero.
- **Session tree, not root outcome.** Stable 2.x always runs `subagent` children in the background; a child's report is enqueued to the parent's inbox and re-wakes it. Never record a terminal state from `Session.Info.outcome` alone. Default `experimental.subagent_depth` is 1; nested children need 2+.
- **Known reconcile/viewer limits.** The viewer ranks `outcome` above `active` (asserted by `scripts/verify-issue29.ts`), so during a later root round it can show succeeded while the Session is `running`. Permissions/forms are read for the root only, so a child waiting on one shows the Session `running`, not `waiting`. Tree-quiet detection has a residual window (child-report enqueue to parent restart, ~0–17 ms on the server; never observed, not provably closed); the inbox check covers the root only. The viewer has no live streaming text; text appears when a block ends.
- **Experimental OpenCode API.** Upstream labels the stable 2.x HTTP API experimental with no cross-minor compatibility promise. Keep `@opencode/client` an exact pin; `package.json`, `bun.lock`, and the installed package must agree (`scripts/build-release.ts` refuses otherwise and rejects any `@opencode-ai/` lock entry). Client bumps may rename calls (as with `session.message.get`, `session.form.list`, `server.info`) or event fields (tool `native`/`metadata`).
- **Headless OpenCode config.** Keep `deploy/opencode/opencode.json` and the `deploy/verify-assets.sh` `jq` contract together. `.env` allows must stay `permissions` (policies only deny); the `question` deny needs both the permission and the global policy. A cloned Repository's own `opencode.json(c)`/`.opencode/` can still override permissions and make a Session wait. The `/etc/atlas` policies close only the read/grep/glob tools; the shell tool runs as the service user. The installer must never manage OpenCode lifecycle or write as root into an owner's config home.
- **OpenCode credentials in the database.** Stable keeps provider keys and OAuth tokens in `opencode.db` (`credential` table); a legacy `auth.json` is imported and left on disk. Restored copies must go through `atlas ops scrub-opencode-credentials` (`src/ops/scrub-opencode-credentials.ts`) and the `auth.json` removal in `deploy/restore-rehearsal.sh`.
- **Verifier isolation.** A verifier that builds the app or handoff without first importing `scripts/isolate-opencode.ts` can discover and act on the operator's live OpenCode.
- **No GitHub mutation from Atlas.** `GitHubClient` is read-only. Reservation release and target reconfirmation change SQLite only. Agent may publish via scoped git/gh; Atlas must not grow write APIs.
- **Theme tokens.** Hex values live only in `src/styles.css` (light and dark blocks must stay in step) and are described in `DESIGN.md`. Rebuild with `bun run build:css` (`public/app.css` is generated, not committed, and must exist before anything imports `src/assets.ts`).
- **Binary vs source.** Branch on `src/runtime.ts` only. New runtime files must be embedded (`with { type: "file" }` or `"text"`) and new subcommands use a literal `import()` in `src/cli.ts`, or `bun build --compile` will miss them. Nothing at runtime may need Bun, `node_modules`, or a source tree on the host.
- **Updater trust.** The socket carries tags only; never let it accept caller metadata. Keep staging/activation forward-only, downloads https-only and size-capped, and state root-only.
- **Root never runs an unverified binary.** Every Release folder comes from `buildReleaseFolder`: hash the copy before running it, run it only as the unprivileged service user, refuse identity mismatch, never overwrite a non-intact folder. Do not add a second folder builder (setup, staging, and support bundles share it).
- **Units come from `src/units.ts` only.** There are no checked-in unit files; `deploy/verify-assets.sh` renders and checks them. Services refuse `root` as user/group.
- **Setup safety.** Root never acts on a path the service account can change: no symlink follows, safe parents only, replace-not-edit, and everything inside the data folder is done as that account. Preflight must stay change-free. Re-runs keep secrets unless `--rotate-*`, back up before changing, and never move `current` to an older Release. Adopt backs up and stops services before writing and restores only when the database schema is unchanged. Setup never restarts OpenCode outside a fresh install, never touches the firewall, and never runs `tailscale funnel`. Keep host access behind `SetupHost` so `scripts/verify-setup.ts` can fake it.
- **Release pipeline trust.** Only the publish job has a write token, and it runs no repo code. Keep Actions pinned to commit SHAs, the `RELEASERS` allowlist in both plan and publish, and the asset set exactly four files.
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
  SemVer/build. The package client pin (`@opencode/client`) and lockfile move
  together before a release is cut.
- **Discovery/staging truth.** A failed public Release check retains known
  candidates and must not render as a successful no-update result. Validate
  published and embedded metadata plus the named checksum before reporting a
  complete staged tree. Coalesce repeated checks/requests, keep progress/result
  durable, and never let staging change `/opt/atlas/current`, pause Session
  admission, install/build dependencies, or inspect/manage OpenCode.
- **Updates interaction boundary.** Poll only `#updates-live-status`; keep the
  policy form outside its `outerHTML` replacement. Mutation forms disable submit
  during HTMX requests, expose labelled pending states, and return page-shaped,
  value-preserving failures with retry and Inbox guidance.
- **Activation health separation.** Normal operator `atlas ops check-health`
  requires Atlas process/persistence and OpenCode readiness. Only
  `src/updater-server.ts#checkActivationHealth` may gate candidate activation; it
  requires exact tag/SHA and Atlas persistence from `/health?activation=1`, with
  OpenCode omitted.
- **Activation/recovery authority.** The explicit or policy decision is durable before safe pause;
  activation starts only from a complete exact staged tree with runtimes
  revalidated immediately before the pause and
  code-only rollback. Keep updater schema-2 additions readable by the previous
  Atlas Release, never shell-execute `atlas.env`, atomically replace only the
  `current` symlink, and never report rollback before previous identity/storage
  health succeeds. Failed tags require explicit Retry; later tags remain eligible.
- **Surviving-service immutability.** The candidate binary is built into a new
  read-only support bundle only after candidate health, then one stable support
  symlink is replaced atomically. Do not overwrite a running service's source or
  restart credential/updater services during activation.
- **Release retention authority.** Keep current, previous-working, staged,
  in-flight, and canonical Session-helper-referenced Release folders. Never infer
  disposability from age counts or Session state. Persist cleanup targets before
  removal, re-evaluate them after restart, and keep cleanup failure separate
  from activation/recovery truth. Support bundles and non-Release host/data
  paths are outside the deletion boundary. Root reads of the helper registry
  require its expected owner and exact `0600` regular-file mode.
- **Automatic activation boundary.** Never infer automatic eligibility from the
  global build alone: SemVer must exactly match the installed identity and build
  must be numerically higher. Re-evaluate durable policy/suppression before
  activation, preserve an already running lifecycle across policy changes, and
  use the same staging, safe-pause, runtime, rollback, and updater path.

## Verification Map

| Command | Capability |
|---|---|
| `bun run check` | Typecheck (`tsc --noEmit`). |
| CI (`.github/workflows/check.yml`) | PR: fast tier. `main`: every `verify:*` script plus a packaging check. The release gate reuses the full tier. |
| `bun run build:css` | Tailwind asset `public/app.css`. |
| `bun run verify:issue31` | Webhook HMAC, GitHub rate-limit delay, refresh wake-during-backoff. |
| `bun run verify:issue25` | PR list / stack projection views. |
| `bun run verify:migrations` | Persistence migrations, session/reservation schema. |
| `bun run verify:issue27` | Credential boundary, socket, scope, symlink. |
| `bun run verify:issue27-fixes` | Preparation free space, App token mint, clone admission. |
| `bun run verify:issue32` | Refresh coordinator retry backoff. |
| `bun run verify:issue29` | Session viewer hydrate, SSE (no transcript leak), 2.3.2 tool overlay `native`/`metadata` fields, and Session-scoped `session.form.list`. |
| `bun run verify:issue52` | Real-client discovery against a 2.3.2-shaped local server (`/api/info`, `_tag` errors, create ID dedupe, `session.message.get`), runtime handoff/failure checkpoints, a repeated-prompt-ID counter that must stay 0, Session-tree scenarios (`background-subagent-tree`, `tree-read-failure`, `provider-retry`, `provider-retry-after-restart`, `terminal-event-race`, `pending-items`: active root + pending permission/form with an old outcome stays `waiting` with the slot held; quiet tree + outcome + leftover permission/form goes terminal, releases the slot, one terminal callback), installed `clientVersion` and major.minor `versionWarning` cases, warning absent from activation health and the Updates page but shown on Session detail, warning never changing readiness/HTTP status, and normal operator health/OpenCode-readiness exit contracts including a non-failing warning. |
| `bun run verify:issue55` | Independent supplier subprocess/socket continuity, client restart, atomic scope registration, invalid-scope rejection, helper references, and Git/gh helpers across fixture release selection. |
| `bun run verify:issue56` | Real-SQLite coordinated preparation/handoff pause against a 2.3.2-shaped OpenCode fixture, controlled clone/prompt effects, timeout/resume, deadline-free restart hold, uncertainty/no-duplicate behavior (repeated-prompt-ID counter must stay 0; fixture serves `/api/experimental/job`), independent restrictions, and Running/Waiting/Idle non-blocking behavior. |
| `bun run verify:issue57` | `scripts/verify-release.ts` (tag/order/global-sequence rules, schema-2 metadata, embedded identity, authenticated health identity) then `scripts/verify-release-artifact.sh` (builds the four files from a clean checkout, checks sidecar and metadata, runs the binary with no Bun on `PATH`, `/health` and `/health?activation=1` with OpenCode not ready and the pinned `clientVersion`). |
| `bun run verify:binary` | Compiled binary from an empty folder with no Bun: `version`, dispatcher/help, fail-closed `git-credential`/`gh` and their shims, `serve` health identity and embedded assets. |
| `bun run verify:setup` | `atlas setup` under `--root <tmp>` with a fake host: fresh (tools probed as `nobody`, data folders made by the service user), service-account creation/refusal/privileged checks, unsafe source/tool paths, dry run, idempotent re-run, rotation, preflight stops, health failure, Btrfs units, adopt (data/secrets unchanged, backup, stop order, Session gate, automatic restore incl. `/etc/atlas` owners/modes), every Tailscale branch. |
| `bun run verify:install-script` | Real `install.sh` against a local HTTP fixture: latest/pinned URLs, bad version, SHA/metadata mismatch, aarch64, musl, not root (refused before download), root-only `/var/tmp` folder, exit codes, no-terminal handoff, temp cleanup, `sh -n`/`dash -n`/`shellcheck -s sh`. |
| `bash scripts/e2e-install-docker.sh [image…]` | Manual, needs Docker. Ubuntu 24.04 and Debian 12 systemd containers with stock git/gh: non-root refusals, real fresh install via `install.sh | sudo sh` with `--create-user`, owners/modes, recovery-status symlink safety, update by re-run, a failed adopt that restores (owners/modes too), and adopt of the older Bun layout. Not in CI. |
| `bash scripts/e2e-install-docker.sh --published [tag] [image…]` | Manual, needs Docker and the internet. Installs a published Release (default: latest) from github.com exactly as `docs/INSTALL.md` says, then checks identity, owners/modes, the app's release check and the root updater refusing a non-newer tag. Not in CI. |
| `bun run verify:issue58` | Authenticated Updates HTTP/CSRF/value-preserving mutation failures, isolated live-status polling, labelled pending states, responsive global navigation, startup/four-hour/manual discovery, candidate retention/failures/ordering, runtime/maintenance presentation, updater socket/binary download failure/coalescing, durable restart status, and unchanged active selection/admission. |
| `bun run verify:issue59` | Authenticated Install/Retry HTTP, durable approval/lost-response coalescing, safe-pause timeout and conservative startup reconciliation, runtime revalidation, atomic activation/support-bundle selection, Atlas-only identity/storage health, rollback/failure, failed-tag suppression, updater restart reconciliation, and unchanged shared data/OpenCode ownership. |
| `bun run verify:issue60` | Default/persisted policy, authenticated policy HTTP/CSRF, same-SemVer numeric candidate selection ahead of newer SemVer, startup/scheduled/manual parity, existing-path automatic activation, overlap serialization, policy-change continuity, failed-build restart suppression/Retry, and later-build eligibility. |
| `bun run verify:issue61` | Public updater status, strict owner/mode registry reads, validated persisted Release tags, current/previous/staged/in-flight/helper-reference retention, unused old-tree removal, successful/recovered cleanup, partial-failure restart, visible independent outcomes, and callable older credential helper continuity. |
| `bun run verify:inbox` | Inbox Spec projection, latest Session, group/state ordering, Settled cap, terminal unread time, and landing selection. |
| `bun run verify:landing` | GET `/` landing redirects, per-browser `atlas_visit` / `atlas_inbox`, and canonical `/inbox` filter URL. |
| `bun run verify:inbox-shell` (`scripts/verify-inbox-shell.ts`) | Desktop sidebar and navigation landmarks, canonical/filter cookie behavior, selected Spec identity, `/inbox/list` fragment contract, access semantics, and exact `status=all` utility state. |
| `bun run verify:inbox-page` | `/inbox` full/fragment pages, phone Inbox link, mixed refresh warnings, access badges, and empty/error states. |
| `bun scripts/verify-clone-scope.ts` | Clone git env + credential helper isolation. |
| `bun scripts/verify-repository-filter.ts` | `repositoryMatchesQuery` + add-repo UI. |
| `atlas ops check-restored-state` | Restore DB/schema/registry (`src/ops/check-restored-state.ts`). |
| `bash deploy/verify-assets.sh` | Deploy file set + syntax, retired tarball-era files stay gone, recovery tools need no Bun/pins/source tree, units rendered by `src/units.ts` (including `opencode.service` `ExecStart` `--log-level warn`, `--port 49475`, headless-config precondition), headless config `jq` safety contract (three `/etc/atlas` deny policies, deny-only `policies`), and the restore credential-scrub and `auth.json` removal calls. Does not enable services. |
| `bash deploy/verify-opencode-commands.sh` | Isolated server-only `bin/opencode` staging/integrity, `current` preflight selection, no-activation, embedded-Bun WAL probe (scrubbed env; rejects unfixed SQLite, missing Bun runtime, or a second embedded SQLite build), headless config installer (modes, idempotence, backup, `opencode.jsonc`/symlink refusal, no lifecycle, non-owner refusal, and root-to-owner privilege drop via a user namespace when available), and the credential scrub fixture (WAL-only and free-page secrets removed, unrelated rows kept, unknown store and missing file refused). |
| `atlas ops verify-sqlite-wal` | Host-only, writers stopped. The binary's own SQLite (`atlas ops sqlite-version`) plus the selected OpenCode executable's own SQLite, read through its embedded Bun runtime (`BUN_BE_BUN=1`, `bun:sqlite`) in a throwaway scrubbed environment; requires exactly one embedded SQLite source ID. Assumes OpenCode uses `bun:sqlite`; a build without the embedded Bun CLI or with a second SQLite build fails closed. |

<!-- repo-map-synced: b711a769e49c7d26dfdabb45b88111b4cbf43f41 -->
