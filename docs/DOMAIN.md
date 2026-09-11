# DOMAIN

Answers: why does this system exist? Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## Problem and Outcomes

Atlas is an internal control plane for a team that already writes work as GitHub issues. It lets that team triage Specs across onboarded GitHub Repositories and start autonomous OpenCode Sessions from team-authored Specs, then observe those Sessions without Atlas itself publishing GitHub Pull requests or stacks.

Shipped outcomes: private sign-in; durable Repository, Spec, and Session records; an inbox of current Specs with landing on `/`; read-only Pull request and native-stack browsing; authenticated Session directory preparation backed by credential serving that survives Atlas UI restarts; a guarded OpenCode handoff; an awaitable safe update pause for preparation/handoff; Session viewing; Atlas-side stack reservation hold and release; immutable numbered Linux x64 Releases built from authoritative tags; public Release discovery, durable host staging, approval-driven activation, automatic code rollback, and helper-aware old-Release cleanup.

## Actors

| Actor | Role |
|---|---|
| Team member | Uses the shared team credential to enroll Repositories, browse Specs/PRs/stacks, start Sessions, watch execution, and release reservations. |
| Maintainer | Commits complete release inputs and publishes an immutable Release by pushing its authoritative tag. |
| Operator | Provisions the private host, pins binaries, supplies the shared credential, and controls admission, storage, and recovery. Not an in-app admin role. |
| Agent | The OpenCode agent that implements a Spec inside a Session. Atlas does not start, upgrade, or replace OpenCode. |
| GitHub | System of record for Repositories, Specs (issues labelled `spec`), PRs, native stacks, App installation inventory, signed webhooks, and public Releases. |
| Atlas processes | Private UI listener, loopback webhook listener, SQLite projections, independent credential supplier and surviving host updater, preparation, and OpenCode handoff. |

## Use Cases

- Sign in with the shared team credential (browser cookie or `Authorization: Bearer`).
- Enroll a Repository from the GitHub App installation inventory (org-filtered). Soft-remove it without deleting history.
- Land on `/` per visit rules; browse the inbox of current Specs (Repository as a filter).
- Browse all Sessions across enrolled Repositories, or Sessions for one Repository.
- Browse current Specs for an enrolled Repository.
- Browse Pull requests and native GitHub stacks (read-only).
- Start at most one unfinished Session per Spec, choosing a default-branch, native-stack, or standalone-parent target.
- Observe Session preparation, OpenCode handoff, and execution. Atlas does not reply, cancel, or resume OpenCode work.
- Reconfirm a queued Session target when GitHub observations drifted.
- Release a held stack reservation after confirmed terminal execution.
- Accept signed GitHub webhooks that wake background refresh of enrolled Repositories.
- Publish a numbered ready-to-run Linux x64 Release from a reviewed tag without changing dependencies during publishing.
- Check public Releases and observe durable staging without changing the active Release or Session admission.
- Approve a fully staged Release, observe activation/recovery through a brief Atlas outage, and explicitly Retry a failed candidate.
- Inspect Release retention outcomes while current, previous-working, staged, in-flight, and Session-helper-referenced Releases remain protected.

## Workflows

### Sign-in

Operator-issued `ATLAS_SHARED_TOKEN`. Browser session cookie is `Secure`, `HttpOnly`, host-only, `SameSite=Strict`, seven days, no sliding expiry. HTTP clients may send `Authorization: Bearer`. Unauthenticated Session-start POSTs preserve the form and return login.

### Enroll Repository

Team picks a candidate from the configured organization's App inventory. Atlas persists the Repository and refreshes access plus Specs. Atlas does not auto-enroll every Repository the App can see. Soft-remove keeps history; re-add is the same enroll path.

### Land and inbox

GET `/` reads the per-browser `atlas_visit` cookie and maintains the `atlas_inbox` filter cookie (`Path=/; Secure; HttpOnly; SameSite=Strict`):

1. Any Session that reached a terminal state (Succeeded, Failed, Interrupted, Failed setup) after `lastVisitAt` → 303 to that Session, earliest terminal time first.
2. Else any unfinished Session → 303 to that Session; Waiting first, then earliest `submittedAt`.
3. Else `lastRepositoryId` still enrolled → 303 to its Spec list `/repositories/:id/specs`.
4. Else no enrolled Repository → 303 to `/repositories/new`. Repositories enrolled but no Sessions ever → `/inbox`.

Cases 1–3 set `atlas_inbox` to that Repository. Every `/` redirect updates `lastVisitAt`; redirects that select a Repository also update `lastRepositoryId`. Terminal time comes from `session_history`; fall back to `updatedAt`.

The inbox lists current Specs with their latest Session. `/inbox?repository=<enrolled Repository ID>` is the canonical filtered URL; a bare `/inbox` with a remembered valid filter redirects to it. An empty or invalid filter shows all enrolled Repositories, and `repository=manage` goes to Repository management. The selected filter is remembered in `atlas_inbox` for other pages. Removed Repositories are excluded from the filter and list; direct Session links still work.

Inbox rows are grouped as Needs you (Waiting), In progress (Running, Queued, Preparing, Idle), Not started (no Session), and Settled (a terminal latest Session). In-progress states use that displayed order; rows within a state/group use descending `updatedAt`. Settled is collapsed and displays the newest 10 Specs by `updatedAt`. Its unread dot and `Settled · N new` count use terminal time from the earliest `session_history` terminal event, falling back to the Session `updatedAt`, compared with `lastVisitAt`; the count is calculated before the 10-row shelf limit. Idle is never Settled. A row links to its latest Session, or to the Spec detail when no Session exists; the same Spec remains selected through its detail, Start Session, and Session target/release/view pages.

If any relevant enrolled Repository has never completed, partially completed, or cannot complete its Specs refresh, the inbox shows a Specs-unavailable warning (including alongside cached rows) instead of claiming there is no work. Access status is separate from Session state: `unknown` means access is unverified and is shown as a warning without treating it as revoked; revoked, transferred, or suspended access remains represented with cached data but is not eligible for new Session starts. `/sessions` lists Sessions from all enrolled, non-removed Repositories; `?status=all` includes terminal history.

### Browse Specs and PRs

Atlas projects GitHub issues labelled exactly `spec` (open, not a pull request) and GitHub PRs/native stacks. If GitHub is unreachable, the enrolled Repository and last complete projection are retained. Atlas does not create the `spec` label.

### Start Session

1. Queue: CSRF-protected form with required prompt (max 20,000 characters) and an observed target. Duplicate `submission_id` with the same content is idempotent. An unfinished Session on that Spec is rejected.
2. Prepare: global execution-slot capacity (default one). Register the Session directory and helper references, request a Repository-scoped GitHub App token from the independently running supplier, and clone under `ATLAS_SESSION_ROOT` with a unique working branch. Pause when credential serving or Session storage is unavailable, below the free-space floor (default 10 GiB), or host space status says pause. Preparation never falls back to a weaker browse token.
3. Handoff: discover the independently running OpenCode service without filtering by server version, validate its endpoint/health/event stream, create once, associate once, send one exact initial message, and reconcile HTTP state. Atlas does not store a transcript copy.

### Safe update pause

Atlas exposes one coordinated process-local update pause. A request immediately
blocks new preparation and create/associate/prompt work, then completes only
after already in-flight Atlas-owned work leaves its external operation and its
durable checkpoint records completion or uncertainty. The pause preserves all
Session and reservation state. OpenCode execution-state reconciliation may
continue, so Running, Waiting, and Idle Sessions do not delay readiness.

The default deadline is five minutes. A timeout abandons and removes only the
update-owned pause; it neither kills in-flight work nor removes independent
operator, capacity, storage, recovery, persistence, or OpenCode-readiness
restrictions. A completed pause remains held until its scoped, idempotent resume
is used. This is the lifecycle prerequisite for later activation work; Release
discovery and staging do not invoke it.

### Webhook refresh

Funnel targets only `POST /webhooks/github` on the webhook port. Accepted deliveries increment refresh generations; authoritative GitHub reads run in the background. Delivery IDs are retained for 30 days.

### Stack reservation

Held for native-stack and standalone-parent admission (and for some default-branch publication cases). It is Atlas-side exclusivity, not a GitHub lock, and can outlast execution while publication is pending. Automatic release requires terminal OpenCode outcome plus qualifying publication. Explicit release is allowed only after confirmed terminal execution (`succeeded`, `failed`, or `interrupted`) and does not change GitHub.

### Publish Release

A maintainer pushes an exact `vMAJOR.MINOR.PATCH+build.BUILD` tag. The first
Release is `v0.1.0+build.1`; build numbers increase globally and never reset.
SemVer communicates intended Atlas behavior, while a behavior-preserving
dependency update may increment only the build. Publishing serializes globally,
rejects malformed/reused/older identities, builds the tagged frozen dependency
tree, and creates immutable public metadata, checksum, and a ready-to-run Linux
x64 archive. The archive starts with host-installed pinned Bun and reports the
tag-derived identity plus storage health even when OpenCode is absent. An
untagged checkout reports unpublished development identity.

### Discover and stage Release

Atlas checks all public GitHub Releases at startup, every four hours, and when a
team member uses **Check now**. It validates each published metadata document,
orders Releases by SemVer and then numeric build, and persists the complete
known candidate set. A failed check retains that set and remains distinct from a
successful check that found no newer Release.

When a newer Release is available, Atlas requests staging over an authenticated
Unix socket. The independently running updater durably records the request,
progress, host-runtime requirements, and latest result; verifies the archive
checksum and embedded metadata; and atomically creates a read-only Release tree.
Repeated requests coalesce or reuse the completed tree. `/opt/atlas/current`
and Session admission remain unchanged. The Updates page shows
rollback-incompatible manual-maintenance instructions and unmet Bun, Git, or gh
requirements, but neither Atlas process upgrades those host tools or manages
OpenCode. Approval is required; staging alone never changes the active Release.

### Approve and activate Release

A user with existing Atlas web access may choose **Install** only for the exact
available Release after staging is complete, host runtime requirements are met,
and metadata guarantees code-only rollback. Approval is durably recorded before
Atlas pauses new preparation and create/associate/prompt handoff work. Existing
work reaches safe checkpoints for at most five minutes; Running, Waiting, and
Idle Sessions do not block. Timeout abandons activation, leaves the current
Release selected, and removes only the update-owned pause.

After the checkpoint, the surviving updater stops only Atlas, atomically selects
the complete candidate, restarts Atlas, and allows 60 seconds for the expected
Release identity and healthy Atlas persistence. OpenCode and credential serving
continue; OpenCode readiness, availability, and version are neither queried nor
used by activation health. Atlas processes started during host work remain
update-paused until the durable result is terminal.

Candidate failure suppresses that exact tag and automatically selects, restarts,
and verifies the previous working Release against unchanged shared data. Atlas
reports **Recovered** only after previous identity/storage health succeeds;
otherwise it reports **Recovery failed**. Explicit **Retry** permits the failed
tag again, while a later eligible Release is unaffected. Manual-maintenance
Releases cannot use this path.

The updater removes only managed Release trees older than the selected Release
and not protected as current, previous working, staged, in-flight, or referenced
by an absolute Session helper path. Session state labels do not release helper
references. Cleanup shares durable updater serialization, runs after successful
activation/recovered rollback and on updater lifecycle reconciliation, and
rechecks helper references before removal. A cleanup failure is a separate
visible result: it neither changes a healthy selected Release nor starts another
activation. A restart resumes only durable pending cleanup still allowed by the
same current/previous/reference rules.

## Ubiquitous Language

Use these terms. Do not substitute the avoided synonyms.

**Repository**: A GitHub repository onboarded into Atlas.
_Avoid_: Project, workspace

**Spec**: An open GitHub issue labelled `spec` that describes one implementable piece of work.
_Avoid_: job, ticket, task, specification

**Blocker**: Any GitHub issue a Spec depends on through a GitHub issue dependency. Blockers do not gate Session starts in Phase 1. Atlas does not yet display Blockers.
_Avoid_: dependency, parent

**Session**: One Atlas-managed implementation attempt of a Spec, associated with an OpenCode session and its own Session directory once prepared. A Spec may have many historical Sessions, but only one unfinished Session at a time.
_Avoid_: Run, job, SpecJob, conversation, thread

**Session directory**: The dedicated copy of a Repository in which a Session works.
_Avoid_: Run directory, workspace, worktree, checkout

**Agent**: The OpenCode agent that implements a Spec inside a Session.
_Avoid_: orchestrator, worker, bot

**PR**: A GitHub pull request belonging to a Repository. A PR need not be associated with an Atlas Session.
_Avoid_: merge request

**PR stack**: An explicitly ordered group of pull requests in the same Repository, registered as a native GitHub stack. Locally prepared branches are not yet native stack members.
_Avoid_: branch chain when referring to native membership

**Stack reservation**: Exclusive ownership of a stack's next implementation by an Atlas Session, also applicable to a standalone parent PR before a stack exists. It can outlast the Session's execution while publication is pending.
_Avoid_: execution slot when referring to stack exclusivity

**Idle**: A Session for which neither live execution, explicit waiting, nor a terminal outcome is confirmed. Idle does not mean completed.
_Avoid_: completed, stalled

**Active Session**: An unfinished Session, including one that is Queued, Preparing, Running, Waiting, or Idle. Active does not necessarily mean executing.
_Avoid_: Running Session when referring to all unfinished Sessions

**Stale**: A freshness warning that Atlas's live connection is disconnected or reconciliation is incomplete. It accompanies rather than replaces a Session's semantic state.
_Avoid_: Stall, timeout, hang

**Session state** (implementation vocabulary used in the UI): `queued`, `preparing`, `running`, `waiting`, `idle` are unfinished. `succeeded`, `failed`, `interrupted` are confirmed OpenCode execution outcomes. `failed_setup` is a preparation/setup failure, not an OpenCode execution outcome.

**Starting target**: `default` (Repository default branch), `native_stack` (verified top of a native GitHub stack), or `standalone_parent` (open PR not in a native stack, based on the default branch).

**Publication status**: Atlas observation of whether the Session working branch appears as a GitHub PR. Values: `not_observed`, `unverified`, `ambiguous`, `identified`, `qualifying`, `released`. Atlas never chooses among ambiguous PRs.

**Access status**: `available`, `unknown` (unverified; not treated as revoked), `revoked`, `transferred`, `suspended`.

**Execution slot**: Global capacity for live preparation/execution. Distinct from stack reservation.

**Release**: An immutable Atlas source/dependency/deployment tree published
from an authoritative SemVer-plus-global-build tag and exact Git SHA.
_Avoid_: moving build, source snapshot

## Domain Rules

- One unfinished Session per Spec. The server enforces this.
- Blockers do not gate Session starts. Atlas does not yet display Blockers.
- Specs are open GitHub issues with the exact label `spec` and are not pull requests. Atlas does not create that label.
- Atlas never creates, changes, or submits GitHub Pull requests or stacks. Locally prepared branches are not native stack members.
- Atlas never starts, upgrades, or replaces OpenCode. Server version is diagnostic rather than a discovery gate; Atlas uses the client installed in its release and retains conservative not-ready/stale behavior when that client cannot use the service.
- Secrets and GitHub tokens never appear in HTML, URLs, arguments, prompts, or logs. Preparation never falls back to the browse installation token. If the App cannot grant requested writes, preparation stays queued instead of starting with a weaker token.
- Stopping or restarting the Atlas UI does not stop credential serving, unlink its socket, remove its runtime directory, or discard registered Session scopes/helper references.
- GitHub values used for browsing stay server-side. Inventory is filtered to the configured organization.
- If GitHub is missing or fails, keep the enrolled Repository and the last complete Specs/PR projection.
- Idle is not completed. Active is not necessarily executing. Stale overlays semantic state; lost live connection does not mean the Session failed.
- Explicit reservation release does not mutate GitHub and is refused while execution is active or uncertain.
- Target reconfirmation keeps the Session, prompt, and queue order. Atlas does not infer a replacement target.
- Partial Session resources are retained on proven setup failure or uncertainty.
- Funnel may expose only the webhook listener. The UI listener stays private.
- GET `/` landing follows rules 1–4 above. Cookies `atlas_visit` (`lastVisitAt`, `lastRepositoryId`) and `atlas_inbox` (Repository filter) are `Secure; HttpOnly; SameSite=Strict`.
- **Settled** is inbox UI grouping for Specs whose latest Session is terminal, not a Session state. Idle is never Settled.
- Inbox access and refresh warnings never replace the latest Session state; unknown access is not evidence of revocation, and an unavailable Specs refresh is not evidence of an empty inbox.
- An update pause blocks new preparation and OpenCode create/associate/prompt effects, but does not wait for Running, Waiting, or Idle Agent execution. It times out after five minutes without interrupting uncertain work and removes only its own restriction.
- Release tags are authoritative. Build numbers increase globally; published
  identities and artifacts are never replaced, and a correction uses a new
  build. Release ordering is SemVer first, then numeric build for equal SemVer.
- Atlas startup and Release activation health require exact Atlas identity and
  healthy persistence, never OpenCode readiness, availability, or version
  inspection. OpenCode diagnostics remain independent.
- Release discovery uses public GitHub Releases and validates their metadata.
  Failed checks retain the last successful candidate set. Staging is durable,
  read-only, and inactive; it neither pauses Session admission nor changes
  `/opt/atlas/current`.
- Release activation requires explicit web approval, a complete exact staged
  tree, met host runtimes, and declared code-only rollback compatibility. It
  durably serializes target/progress/result, checks exact Atlas identity and
  healthy persistence within 60 seconds, and never gates on or controls OpenCode.
  Failed tags require Retry; rollback success requires verified previous health.
- Release cleanup removes only managed trees older than current after protecting
  current, previous-working, staged, in-flight, and every helper-referenced
  Release. Cleanup outcomes and partial work are durable; failure does not alter
  activation truth, Session data, credentials, service trees, or host tools.

## Boundaries and Non-Goals

- Not a public app. Shared-token private access only.
- Does not enroll every GitHub App-visible Repository automatically.
- Does not automatically provision the host, move OpenCode data, or change Tailscale/firewall. The operator-run bootstrap is limited to the independent credential/updater services and updated unit files.
- Does not own OpenCode lifecycle, configuration, or transcripts.
- Release discovery/staging alone does not invoke the safe update pause or
  activate a Release. Automatic policy selection remains later work;
  Install/Retry are approval-driven only.
- Viewer does not reply to, cancel, or resume OpenCode permissions, forms, or inbox items.
- Does not create GitHub labels.
- Design guidelines do not introduce features or change business rules.
- Published release targets other than Linux x64, host-side dependency install,
  and automatic selection/upgrading of Bun, Git, gh, OS packages, or OpenCode.
- Phase 1 has no off-site backup. Snapshots cannot undo GitHub effects. Shared host identity `omega` is not hostile-agent isolation.

<!-- repo-map-synced: 7e89a703fe9233aa648886450b98c1051e5d2035 -->
