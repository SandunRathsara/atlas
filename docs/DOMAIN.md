# DOMAIN

Answers: why does this system exist? Populated and kept current by `/refresh-repo-map`. Do not hand-edit outside that workflow.

## Problem and Outcomes

Atlas is an internal control plane for a team that already writes work as GitHub issues. It lets that team triage Specs across onboarded GitHub Repositories and start autonomous OpenCode Sessions from team-authored Specs, then observe those Sessions without Atlas itself publishing GitHub Pull requests or stacks.

Shipped outcomes: private sign-in; durable Repository, Spec, and Session records; an inbox of current Specs with landing on `/`; read-only Pull request and native-stack browsing; authenticated Session directory preparation; a guarded OpenCode handoff; Session viewing; Atlas-side stack reservation hold and release.

## Actors

| Actor | Role |
|---|---|
| Team member | Uses the shared team credential to enroll Repositories, browse Specs/PRs/stacks, start Sessions, watch execution, and release reservations. |
| Operator | Provisions the private host, pins binaries, supplies the shared credential, and controls admission, storage, and recovery. Not an in-app admin role. |
| Agent | The OpenCode agent that implements a Spec inside a Session. Atlas does not start, upgrade, or replace OpenCode. |
| GitHub | System of record for Repositories, Specs (issues labelled `spec`), PRs, native stacks, App installation inventory, and signed webhooks. |
| Atlas process | Private UI listener, loopback webhook listener, SQLite projections, credential supplier, preparation, and OpenCode handoff. |

## Use Cases

- Sign in with the shared team credential (browser cookie or `Authorization: Bearer`).
- Enroll a Repository from the GitHub App installation inventory (org-filtered). Soft-remove it without deleting history.
- Land on `/` per visit rules; browse the inbox of current Specs (Repository as a filter).
- Browse current Specs for an enrolled Repository.
- Browse Pull requests and native GitHub stacks (read-only).
- Start at most one unfinished Session per Spec, choosing a default-branch, native-stack, or standalone-parent target.
- Observe Session preparation, OpenCode handoff, and execution. Atlas does not reply, cancel, or resume OpenCode work.
- Reconfirm a queued Session target when GitHub observations drifted.
- Release a held stack reservation after confirmed terminal execution.
- Accept signed GitHub webhooks that wake background refresh of enrolled Repositories.

## Workflows

### Sign-in

Operator-issued `ATLAS_SHARED_TOKEN`. Browser session cookie is `Secure`, `HttpOnly`, host-only, `SameSite=Strict`, seven days, no sliding expiry. HTTP clients may send `Authorization: Bearer`. Unauthenticated Session-start POSTs preserve the form and return login.

### Enroll Repository

Team picks a candidate from the configured organization's App inventory. Atlas persists the Repository and refreshes access plus Specs. Atlas does not auto-enroll every Repository the App can see. Soft-remove keeps history; re-add is the same enroll path.

### Land and inbox

GET `/` reads cookies `atlas_visit` and `atlas_inbox` (`Secure; HttpOnly; SameSite=Strict`, per browser):

1. Any Session that reached a terminal state (Succeeded, Failed, Interrupted, Failed setup) after `lastVisitAt` → 303 to that Session, earliest terminal time first.
2. Else any unfinished Session → 303 to that Session; Waiting first, then earliest `submittedAt`.
3. Else `lastRepositoryId` still enrolled → 303 to its Spec list `/repositories/:id/specs`.
4. Else no enrolled Repository → 303 to `/repositories/new`. Repositories enrolled but no Sessions ever → `/inbox`.

Cases 1–3 set `atlas_inbox` to that Repository. Every `/` redirect updates `lastVisitAt` and `lastRepositoryId`. Terminal time comes from `session_history`; fall back to `updatedAt`.

The inbox lists current Specs with their latest Session. Filter lives in `/inbox?repository=` and `atlas_inbox`. Removed Repositories are excluded from the filter and list; direct Session links still work. **Settled** is a UI group (collapsed shelf, newest 10 Specs whose latest Session is terminal), not a Session state.

### Browse Specs and PRs

Atlas projects GitHub issues labelled exactly `spec` (open, not a pull request) and GitHub PRs/native stacks. If GitHub is unreachable, the enrolled Repository and last complete projection are retained. Atlas does not create the `spec` label.

### Start Session

1. Queue: CSRF-protected form with required prompt (max 20,000 characters) and an observed target. Duplicate `submission_id` with the same content is idempotent. An unfinished Session on that Spec is rejected.
2. Prepare: global execution-slot capacity (default one). Clone a Session directory under `ATLAS_SESSION_ROOT` with a unique working branch. Pause when Session storage is missing, below the free-space floor (default 10 GiB), or host space status says pause. Production preparation mints a Repository-scoped GitHub App token; it never falls back to a weaker browse token.
3. Handoff: discover the pinned OpenCode service, consume events, create once, associate once, send one exact initial message, reconcile HTTP state. Atlas does not store a transcript copy.

### Webhook refresh

Funnel targets only `POST /webhooks/github` on the webhook port. Accepted deliveries increment refresh generations; authoritative GitHub reads run in the background. Delivery IDs are retained for 30 days.

### Stack reservation

Held for native-stack and standalone-parent admission (and for some default-branch publication cases). It is Atlas-side exclusivity, not a GitHub lock, and can outlast execution while publication is pending. Automatic release requires terminal OpenCode outcome plus qualifying publication. Explicit release is allowed only after confirmed terminal execution (`succeeded`, `failed`, or `interrupted`) and does not change GitHub.

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

## Domain Rules

- One unfinished Session per Spec. The server enforces this.
- Blockers do not gate Session starts. Atlas does not yet display Blockers.
- Specs are open GitHub issues with the exact label `spec` and are not pull requests. Atlas does not create that label.
- Atlas never creates, changes, or submits GitHub Pull requests or stacks. Locally prepared branches are not native stack members.
- Atlas never starts, upgrades, or replaces OpenCode. OpenCode must report the pinned baseline `0.0.0-beta-19135`.
- Secrets and GitHub tokens never appear in HTML, URLs, arguments, prompts, or logs. Preparation never falls back to the browse installation token. If the App cannot grant requested writes, preparation stays queued instead of starting with a weaker token.
- GitHub values used for browsing stay server-side. Inventory is filtered to the configured organization.
- If GitHub is missing or fails, keep the enrolled Repository and the last complete Specs/PR projection.
- Idle is not completed. Active is not necessarily executing. Stale overlays semantic state; lost live connection does not mean the Session failed.
- Explicit reservation release does not mutate GitHub and is refused while execution is active or uncertain.
- Target reconfirmation keeps the Session, prompt, and queue order. Atlas does not infer a replacement target.
- Partial Session resources are retained on proven setup failure or uncertainty.
- Funnel may expose only the webhook listener. The UI listener stays private.
- GET `/` landing follows rules 1–4 above. Cookies `atlas_visit` (`lastVisitAt`, `lastRepositoryId`) and `atlas_inbox` (Repository filter) are `Secure; HttpOnly; SameSite=Strict`.
- **Settled** is inbox UI grouping for Specs whose latest Session is terminal, not a Session state. Idle is never Settled.

## Boundaries and Non-Goals

- Not a public app. Shared-token private access only.
- Does not enroll every GitHub App-visible Repository automatically.
- Does not provision the host, enable systemd units, move OpenCode data, or change Tailscale/firewall (`deploy/` is inert until an operator applies it).
- Does not own OpenCode lifecycle, configuration, or transcripts.
- Viewer does not reply to, cancel, or resume OpenCode permissions, forms, or inbox items.
- Does not create GitHub labels.
- Design guidelines do not introduce features or change business rules.
- Phase 1 has no off-site backup. Snapshots cannot undo GitHub effects. Shared host identity `omega` is not hostile-agent isolation.

<!-- repo-map-synced: 4b188a3fa180e349011dd02434ec69bf7792b02f -->
