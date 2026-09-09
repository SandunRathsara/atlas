# Atlas Phase 1 engineering plan

Status: implementation handoff assembled on 2026-09-05 from approved decisions, with the four missing research assets reconstructed. Application and deployment verification remain downstream work.

Origin: [Atlas Phase 1 engineering plan][map] → [Assemble the Phase 1 Atlas engineering plan in docs/][assembly]. This is an implementation handoff for `/to-tickets` and `/implement-spec`, not a claim that Atlas or its deployment already exists.

## 1. Destination and authority

Deliver this complete journey:

1. Explicitly onboard a GitHub Repository accessible through the team's GitHub App installation.
2. Browse its **Specs**, active open/draft **Pull requests**, and Atlas-created **Sessions**.
3. Open a Spec's initial-prompt form, then submit it to create one Session.
4. Find that attempt from both the Spec's history and the Repository's Sessions view.
5. Inspect the preserved Session live through a view-only, TUI-like timeline and verified active-subagent view.

Starting work supports the default branch, a native PR stack, or an eligible standalone parent PR. Atlas prepares a local child branch; it does not publish or repair PRs. Durable reservations prevent competing Atlas handoffs to the same stack.

### Reading order and precedence

- [CONTEXT.md](../CONTEXT.md) is the glossary. User-facing language is **Repository**, never Project. Session is the implementation attempt; no separate Run/job aggregate.
- [DESIGN.md](../DESIGN.md) governs visual and interaction rules. Read it before UI work and reference it in downstream tickets; do not copy its palette, component rules, or acceptance checklist here.
- The linked resolution comments below hold the approved decisions. This plan consolidates them without expanding their scope. Research establishes API facts, not new product policy.
- [The feasibility handoff](feasibilty-study-handoff.md), early research examples, and prototypes are historical where they differ from this plan.

Explicitly reconciled older wording:

| Earlier wording | Phase 1 contract |
| --- | --- |
| No frontend build step | The [approved UI baseline][ui-reconciliation] permits a CSS-only build; server-rendered HTMX, no client-side framework. |
| PR-list-only; no Session–PR association | [Start-session][start] and [stack reconciliation][stacks] add local stack preparation, PR correlation, reservation/publication gates and narrow admission actions. |
| Removal blocked while any Session is unfinished | Later [stack][stacks], [persistence][persistence] and [HTTP][http] resolutions permit removal while preserving queued work, ownership and execution; admissions stop. |
| Running filter | **Active** includes every unfinished Session, not only Running. |
| Inactivity-based stale detection | Stale means transport disconnection or incomplete reconciliation; no inactivity threshold. |
| POC deletes resources or fixes an agent/model | Final POC preserves resources; production start omits agent/model selections and uses effective OpenCode defaults. |
| POC merely records version drift | Recovery/deployment pause launches until an operator validates the approved client/server pairing. |
| Private bearer-only browser access | Shared-token sign-in creates a seven-day browser cookie under the later HTTP contract. |

**UI scope flag:** `DESIGN.md` contains “Show Blockers as context,” while the map explicitly excludes blocker visualization. Its purpose/authority section says design rules do not introduce features. Therefore Phase 1 does not add a Blockers panel or dependency gate. This flags the wording conflict without changing the guide or expanding scope.

## 2. Architecture and ownership

Use TypeScript on Bun, Hono, plain `bun:sqlite`, server-rendered HTML with HTMX, and browser SSE. The CSS pipeline follows `DESIGN.md`. One Atlas process serves separate private-UI and public-webhook listeners. No ORM, event broker, browser JSON hydration API, frontend component framework, or duplicate transcript database.

| Owner | Canonical responsibilities |
| --- | --- |
| GitHub | Repository identity/access/metadata; issues and `spec` membership; PR identities, state and native stack membership/order. |
| Atlas / SQLite | Enrollment; immutable handoff identity/content; queue order and startup checkpoints; execution-slot ownership; stack reservations and release history; Session associations; durable refresh work. |
| OpenCode | Execution, messages, tools, shells, permissions/forms, subagents and persisted outcomes. HTTP projections are canonical; upstream SSE is a live-only overlay. |
| Browser | Page-local focus, selection, expanded panels and unsent input. Not durable execution state or credential storage. |
| systemd / operator | Independent service lifecycles, pinned deployment, secrets, disk safeguards, snapshots and recovery. |

Keep implementation boundaries around these responsibilities: persistence/admission, GitHub reads and credentials, OpenCode handoff/observation, and HTTP/rendering. These are responsibilities, not a mandate for one-interface-per-class layers or a plugin architecture. Reuse projections for full pages and fragments.

### Fixed operational context

- One team, one GitHub organization and one App installation; no forks or cross-Repository start targets.
- One full clone per Session at `/var/lib/atlas/sessions/<session-id>`. Atlas must not substitute Git worktrees; OpenCode may manage its own worktrees.
- Connect to an already-running OpenCode V2 server using pinned `@opencode-ai/client`, not the embedded `@opencode-ai/sdk` or stable V1 APIs.
- Validated client/server baseline: `0.0.0-beta-19135`. [Final POC][poc] proves the handoff, observation and preservation path, not all production failure scenarios.
- Priority order: Autonomy > Observability > Reliability > Cost > Speed > Recoverability.

## 3. Repository journey

Sources: [Repository onboarding][onboarding], [HTTP surface][http], [UI prototype][ui].

### Enrollment

App access is an eligibility inventory, not automatic enrollment. List accessible Repositories in the configured organization; **Add repository** saves one by stable GitHub Repository ID. Duplicate additions return the same record. Begin Specs/PR synchronization after enrollment; failure retains enrollment with a warning.

Archived Repositories and Repositories without a default-branch commit may be browsed but cannot start Sessions. Missing `spec` label or disabled Issues does not prevent enrollment: explain the empty Specs view, without creating labels or changing GitHub settings. There are no per-Repository settings.

Renames update metadata without changing identity. Transfer outside the organization, suspension, missing permissions, confirmed access removal, archive state or unusable default branch blocks new starts and queued launches. Temporary verification failure means unknown access, not confirmed removal. Resume only after current eligibility is verified; skip blocked Repositories without losing original queue order.

**Remove from Atlas** hides the Repository from ordinary browsing and stops admissions. Preserve Sessions, queued prompts, reservations, PR associations, directories and ongoing OpenCode execution. A Removed repositories filter and direct Session links retain access to history. Re-adding the same GitHub ID restores it after verification; a different Repository reusing the name inherits nothing. Terminal-only reservation release remains available from preserved history.

### Repository views

Retain the approved **A + C interaction model** under `DESIGN.md`: Operations rail for Repository browsing; Terminal desk for Session detail. Prototype-only variant/state controls are not production controls.

| View | Required behavior |
| --- | --- |
| Specs | Open non-PR GitHub issues with label name exactly `spec`; title/identity, GitHub link, associated Session indicators, and start-form link when permitted. |
| Spec detail | Current issue data where available, retained handoff history where no longer active, and links to every associated Atlas attempt. |
| Pull requests | Active open/draft PRs with GitHub links and native-stack/eligibility information needed by starts. No GitHub mutation controls. |
| Sessions | Atlas-created attempts only, including Queued/preparation records without an OpenCode ID. Default `status=active`; explicit lifecycle and All filters; freshness separate from semantic state. |
| Session detail | Repository/Spec identity, immutable initial context, queue/preparation reasons, execution state/freshness, publication/reservation state, root timeline and descendant view. |

Preserve filters and scroll/selection context during catch-up. Loading, never-synced/unavailable, genuinely empty, no-filter-matches, error and retained-stale data are distinct presentations. Do not label an outage an empty list or an execution failure.

## 4. Session lifecycle and admission

Sources: [Session lifecycle][lifecycle], [Failure handling][failure], [Recovery][recovery].

One Spec may have any number of historical Sessions, but at most one unfinished attempt, including Queued. A Session exists before its clone/OpenCode resources. Subagents share the parent's admission slot and are not independently scheduled by Atlas.

| Label | Required evidence / responsibility | Holds global slot? |
| --- | --- | --- |
| Queued | Durably accepted Atlas request awaiting admission. | No |
| Preparing | Atlas has claimed admission and is preparing/handover-checkpointing resources. | Yes |
| Running | Fresh `session.active()` evidence, unmatched execution-start event, or fresh busy status. | Yes |
| Waiting | Explicit pending permission/form or fresh retry status. | Yes |
| Idle | Neither execution, explicit waiting nor terminal outcome confirmed. Not completion. | Yes |
| Succeeded / Failed / Interrupted | Confirmed `Session.Info.outcome` from OpenCode HTTP. | No |
| Failed — setup | Atlas proves execution could not have started; do not fabricate an OpenCode outcome. | No |

Once execution is observed, semantic precedence is terminal outcome → Waiting → Running → Idle. Do not apply an old outcome snapshot over evidence of a newer execution; reconcile instead. Atlas does not reopen terminal attempts or steer execution through its UI.

**Stale** overlays the last-known semantic state when upstream SSE is disconnected or required HTTP reconciliation is incomplete. Browser disconnection is likewise a page freshness warning, not a durable execution transition. **Start unconfirmed** is a reason attached to an unresolved start, not a ninth semantic state.

The configurable global cap starts at **1** across all Repositories. Select the oldest eligible queued Session using stable submission order, skipping blocked targets/Repositories. Preparing, Waiting and Idle retain their slots indefinitely until confirmed terminal state or proven setup failure. Stale, missing resources, response loss, PR readiness and PR merge never free an execution slot.

Claim the global slot and applicable reservation in the same short SQLite write transaction that advances Queued to Preparing. Recheck one-unfinished-per-Spec, capacity, eligibility evidence/invalidation and all local ownership. Perform network reads outside transactions. Database serialization excludes competing Atlas admissions, not external GitHub writers.

## 5. Start-session handoff

Source: [Start-session contract][start], refined by [persistence][persistence] and [stack reconciliation][stacks].

### Form and immutable content

Start Session opens an initial-prompt form; opening or cancelling creates nothing. Offer default branch, an existing native stack (selecting its actual top), or an eligible standalone parent. Native members must not also appear as standalone parents.

- Reject whitespace-only input and more than **20,000 characters**; preserve the user's unchanged text.
- Refresh Spec eligibility at submission: open, still labelled `spec`, accessible and in the eligible Repository. Preserve input on any rejection.
- Use a durable submission identity that survives retry/refresh. Repeating an identical submission returns the same Session, even after later state changes. Same identity with different content is a conflict. A distinct submission while the Spec has an unfinished attempt returns that attempt's link and retains unsent input.
- No Atlas agent/model selectors. Omit those fields so OpenCode resolves effective defaults, including location configuration.
- Initial title: `Spec #<number>: <title>`. IDs, not titles, bind the attempt.
- Store submission-time Spec URL/title/body and unchanged user prompt. Send a clearly separated context section followed by that prompt. Context includes Repository, resolved starting base and, for stacked work, parent PR URL, immediate parent branch, trunk, stack identity if present, unique working branch and exact preparation SHA. State that the new layer is only locally prepared.

### Durable ordering

1. Validate and atomically save the submission, immutable content, target intent and monotonic order as a **Queued** Atlas Session. Return its detail URL immediately; do not finish preparation on the HTTP request path.
2. When eligible, obtain fresh target/ref/access evidence; atomically acquire the global slot and relevant reservation and persist preparation intent.
3. Create the dedicated full clone, unique working branch and authenticated tool environment. Default work uses the latest default-branch commit at preparation; stacked work uses the selected current parent/top head SHA. Save actual resolved context.
4. Before remote writes, persist stable, schema-valid caller-generated OpenCode session/create and initial-message identities, the intended location and the exact message to send. Intended identity and confirmed remote association are separate checkpoints.
5. Begin consuming the upstream event subscription. Create the OpenCode session bound to the absolute Session directory; durably save the confirmed association **before** submitting its initial prompt.
6. Submit once. Persist confirmed prompt/inbox acceptance. Acceptance is not execution completion; observe/reconcile HTTP state and outcome thereafter.

Record each safe checkpoint so recovery can resume only a next step proven not to duplicate remote work. A lost create/prompt response or failed checkpoint write leaves **Start unconfirmed**, holding admission. Look up saved IDs, correlation/location and initial message/inbox evidence; never repeat uncertain creates/prompts as a read probe. Same-ID prompt deduplication is not permission to resend: it can wake execution.

Preserve clone, remote Session and partial resources on failure. A confirmed failure before execution could begin—including after a proven create but before any prompt—may become Failed — setup. Ambiguity cannot be converted into setup failure to unblock the queue.

### Local stacking boundary

Prepare a unique local child branch and local tracking; do not push a placeholder, add a bootstrap commit, create a startup draft PR, or register native membership. Existing native APIs require existing PRs. OpenCode/humans own subsequent commits, publishing and native membership; Atlas only observes.

Use the [reconstructed native-stack note](research/issue-9-native-github-pr-stacks.md#local-preparation-feasible-without-native-writes) for the pinned local tracking model: real trunk, ordered existing parent layers and a new unpublished child, with verified SHAs. A child-only stack using the selected parent as trunk loses the intended publication relationship. The official CLI's init/plain-add paths provide local preparation primitives, but whole interactive checkout may offer remote unstack on conflict; submit/link/sync can publish or alter existing PRs. Do not invoke those mutating workflows as Atlas preparation or observation. Pin and verify the non-mutating preparation path before declaring it ready.

Refresh targets immediately before preparation. For an immediate request, structural target changes require reconfirmation with prompt retained; new commits on the same parent branch are accepted and recorded. Queued work targeting the same surviving native stack follows its latest eligible top, including added layers, without reconfirmation merely for that change. A vanished target requires explicit selection of a current target; never silently fall back to default.

## 6. Native stacks, queues and publication

Source: [PR-stack projection and reservation reconciliation][stacks]. The [persistence refinement][persistence] defines durable evidence and conflict holds.

### Eligibility

GitHub's explicit identity and bottom-to-top membership are authoritative; the actual final entry is top. Do not infer stacks from branch chains or silently skip an unusable top.

| Target / condition | Atlas admission rule |
| --- | --- |
| Native stack | Same Repository; any existing trunk; usable current top and required refs. |
| Standalone parent | Open PR with verified absence of native membership, targeting the Repository default branch. |
| Non-default legacy branch chain | Disabled; requires external native conversion. Atlas does not convert it. |
| Draft, failing CI, missing approvals | Alone, these do not disqualify a target. |
| Known merging/merge-queued or auto-merging parent | Disabled. |
| Closed-unmerged layer, missing required branch, unusable top | Disabled with reason. Merged lower members are not closed-unmerged blockers. |
| Fully merged stack or 100 members | Cannot extend. |
| Failed/inconsistent API, preview or access evidence | “Waiting for GitHub verification”; no empty/deleted inference or fallback. |

Atlas never modifies existing PRs, readiness, bases, branches, merges or stacks to manufacture eligibility.

### Ownership and structural change

Keep execution slots separate from reservations. Terminal execution releases the global slot even if publication keeps a stack reserved.

- Queue identity is stable Repository + native stack identity, or permanent standalone parent PR identity before membership. Names and local tracking are not ownership keys.
- When a standalone parent joins a verified native stack, associate its waiting requests and reservation with that stack, preserving original submission order.
- When independently reserved targets converge, preserve **every** owner. Combine waiting queues by original order, show a conflict and block admission until every existing owner releases. Do not choose a winning Session or overwrite ownership.
- If a stack is dismantled/restructured, retain original/accepted ownership and observed permanent PR evidence. Follow actual current membership of known PRs and block successor targets. Do not claim unrelated targets by matching names or recursively add unrelated members of replacement stacks.
- Record multi-owner conflict holds until each involved reservation releases, even if PRs subsequently move. Membership loss is not release.
- If the queue target disappeared, explicit reconfirmation preserves the same Session, prompt and original order while moving it to the selected verified target. It releases no reservation and does not retarget executing work.
- Before admission/release, verify relevant PRs, native membership/order and operation-required refs. Unknown owner location pauses the potentially affected scope rather than admitting through guessed absence. Unrelated Repositories need not pause.

GitHub offers no future-layer lock or atomic read-and-reserve operation for Atlas. Known unsafe state blocks starts, but no verified read-only method detects every external direct asynchronous merge. Report external changes; do not cancel running work or repair GitHub. Exclusivity is between Atlas admissions only.

### Publication identity and reservation release

Discover the result by Repository and the unique Session working branch, searching historical closed/merged PRs as well as open ones. Once verified, save the permanent resulting-PR identity and never switch it when a later PR reuses that branch name. Ambiguous initial matches or rename/reuse before identification show **Publication could not be verified** and retain ownership. No branch-incarnation identity proves undetected delete/recreate continuity.

Automatic release requires **confirmed terminal execution plus fresh qualifying publication**:

- Identified result is non-draft, open or merged, and belongs to the intended native stack. Closed-unmerged or uncertain publication does not qualify.
- A replacement stack qualifies only if fresh reads verify the same preparation-parent PR and permanently identified result as members, result above parent, result non-draft and open/merged. This does not treat the new stack identity as the old one.
- A merged result need not retain its head ref merely to prove publication. Verify branches required by the specific operation, not a blanket live-head rule.
- Historical readiness alone is insufficient. Once validly released, later ready-to-draft reversal never resurrects the old reservation; later starts validate current target state independently.
- Default-branch-owner exception: if an unfinished default-branch Session publishes a standalone parent, requests targeting it queue behind that owner. Its first child may proceed after owner terminal + parent ready, without requiring native membership first.

Explicit human release requires confirmed terminal execution, even during GitHub outage or Repository removal. Show a warning about unpublished/unverified work; release only that owner's reservation. No deletion, cancellation, branch/PR mutation, or bypass of next-start eligibility. Active or uncertain execution cannot be released. Repeating an already-completed release is harmless.

## 7. OpenCode observation and Session detail

Sources: [Final POC][poc], [Session viewer contract][viewer], [published exact API/event research][viewer-research]. Use that pinned artifact for payload discriminants and reducer details; do not use earlier V1 or older-beta examples.

### HTTP projections

| Client operation | Responsibility |
| --- | --- |
| `Service.discover()` / `Service.headers()` | Discover the registered endpoint and reuse private authentication without printing it. Never hard-code the dynamic port. |
| `health.get()` | Authenticated health/version readiness; mismatch pauses launches pending validation. |
| `session.get({ sessionID })` | Canonical identity, location and outcome. |
| `message.list({ sessionID, order: "asc", limit })` | Projected conversation pages, not just post-compaction context. |
| `session.message({ sessionID, messageID })` | Replace/reconcile an individual touched message. |
| `session.list({ parentID, ... })` | Paginate direct children and recurse. |
| `session.active()` | Current process-owned foreground execution evidence. Absence is inactivity, not completion. |
| `permission.list`, `form.list`, `session.inbox.list` | Pending collections; queued inbox work is not “waiting for user.” |
| `agent.get/list` at the child's location | Resolve agent mode for conservative subagent classification. |
| `shell.list` / `shell.output` at a verified location | Running generic shells and byte-cursor output; associate by explicit Session metadata, never directory alone. |

Follow opaque message/session cursors; initial message order is ascending, subsequent cursor requests omit `order`. Deduplicate by stable IDs and accept a legitimate empty final page. `session.context` is post-compaction model context, not the complete transcript. `session.wait` only waits for idle; it does not prove success.

Render the typed message union and assistant text/public reasoning/tool parts, including streaming input, running progress, completed output and structured errors. Render session shell messages and safe linked file metadata without arbitrary filesystem reads. Opaque provider state is not hidden reasoning Atlas can reconstruct. Generic shell listing is running-only and cannot recover every exited shell missed offline.

Initially hydrate the root and verified descendant tree; page older messages and load child conversations on expansion. A requested child must be verified as an actual descendant of this Atlas Session. An active descendant is a proven active subagent only when its agent mode is `subagent` or `all`; unresolved modes remain “active child session.” Fork provenance alone does not prove a subagent. Missing descendants produce partial/unavailable states, not invented completeness.

### Live reconciliation

1. Begin **consuming**, not just constructing, `event.subscribe()` before hydration. Buffer quickly; the stream is global across Sessions/locations.
2. Filter by stored Session/descendant IDs and verified location/shell correlation. Hydrate canonical HTTP projections.
3. Apply keyed live overlays, deduplicating event IDs and message/tool IDs. Text/reasoning end events replace authoritative content; avoid double-appending overlapping deltas.
4. Re-fetch records/collections touched during hydration overlap before declaring fresh. Invalidation during a read schedules another pass; older responses cannot overwrite newer projections.
5. Terminal execution events trigger `session.get` outcome reconciliation before slot release. Relationship events refresh the tree; pending-request events reconcile their collections.
6. On error/closure, retain visible content and last-known state, mark Stale, reconnect and repeat HTTP reconciliation. Retry connections with increasing delays capped at **30 seconds**. Discard old transient signals as evidence of present freshness.

Use `session.execution.*`, message/text/reasoning/tool events, permission/form events and relationship events as documented in the viewer artifact. HTTP snapshots remain canonical. No exact replay of missed transient deltas, progress, answered requests or short-lived shells is promised; event IDs and Last-Event-ID do not establish replay. No separate durable browser event log is needed.

Atlas execution detail is view-only: no follow-up prompts, permission/form replies, cancel, steer, resume, agent/model configuration or orchestration. Direct OpenCode intervention remains possible outside Atlas.

## 8. GitHub ingress and reconciliation

Sources: [GitHub App research][github-app], [Webhook ingress and reconciliation][webhooks], with [stack][stacks] and [persistence][persistence] extensions.

### App access and native read contract

The browsing minimum is repository **Metadata: read**, **Issues: read**, **Pull requests: read**, and **Contents: read**. The approved authenticated agent publication path additionally needs **Contents: write** for pushes and **Pull requests: write** for PR/native-stack publication. This is the permission consequence of the later start contract, not permission for Atlas itself to publish. Do not silently add issue-write, workflow, administration or organization permissions for unspecified agent commands; endpoint/ruleset support must be verified for the actual installation.

Mint installation tokens using an App-key-signed RS256 JWT and `POST /app/installations/{installation_id}/access_tokens`; JWT lifetime is at most ten minutes, installation tokens expire after one hour. Agent tokens explicitly select exactly one `repository_ids` entry and the required granted permissions. Keep token creation/cache/renewal server-side, separate from browser data. Use the existing App research and [reconstructed authentication note](research/issue-9-start-session-defaults-and-github-auth.md) for exact fields and runtime caveats; no production token-minting result is claimed here.

For stacks, use `GET /repos/{owner}/{repo}/stacks` (including the optional PR-number membership filter) and detail at `/stacks/{stack_number}`, plus detailed PR reads. Distinguish the global native ID, Node ID and Repository-scoped stack number; routes use the number. REST detail embeds ordered members; paginate REST inventories and GraphQL `entries` connections, not invented detail-page parameters. GraphQL `PullRequest.stack`/`stackEntry` is read-only. Current docs recommend API version `2026-03-10` and standard GitHub JSON Accept; no stack-specific preview header was documented. Native stacks are preview nonetheless: an unavailable/404 endpoint cannot establish an empty stack inventory or standalone membership. See [native API research](research/issue-9-native-github-pr-stacks.md) for source pins and exact fields.

### Public boundary

The host is behind CGNAT. Private Tailscale HTTPS serves the UI; public Tailscale Funnel forwards only to a separate loopback webhook listener. Serve/Funnel use separate externally served ports. Funnel must never target the full UI app. OpenCode remains private.

For `POST /webhooks/github`:

1. Verify `X-Hub-Signature-256` as HMAC-SHA256 over the unmodified raw body with timing-safe verification before trusted parsing.
2. Validate event/action, `X-GitHub-Delivery`, configured organization/installation and Repository scope; valid ignored events/ping do not create domain records.
3. In one SQLite transaction, insert the unique delivery receipt and increment/coalesce requested refresh generations.
4. Return `202` for durably accepted refresh work, success for already-committed duplicates or valid ignored/ping deliveries, and non-2xx on verification/storage failure. Acknowledge within **10 seconds**, without fetching GitHub on the request path.

Webhooks signal current reads; they never start Sessions or overwrite newer projections with payload snapshots. Do not depend on automatic GitHub retry.

### Observer coverage

Watch `installation`, `installation_repositories`, `repository`, `issues`, `label`, and `pull_request` families. Cover access/suspension/permission changes, metadata/lifecycle, Spec edits/state/label membership, and PR opening, head changes, readiness, closing, merging, queue/auto-merge state and `stacked` membership joins. Relevant ref changes must invalidate affected observations; use the stack research to wire available ref signals, with periodic and pre-action reads covering missing events.

The earlier browse-only omission of ref observation is refined by stack-aware admission. This does not add push-triggered workflow automation. `opened` precedes native membership; a complete unstack/restructure feed was not verified. Discover removals and recreated identities through authoritative inventory/detail reconciliation, not event absence. Dependency/comment/review automation and blocker visualization remain excluded.

### Durable refresh loop

- Refresh on startup, reconnect, relevant webhook and every **five minutes**. Paginate accessible inventory and complete Spec/PR/native-stack lists; separately read referenced historical PRs and required refs.
- Serialize refreshes per Repository. Capture requested generation before reads and complete only that generation on success; newer signals remain pending.
- Read outside transactions, then commit complete validated observations, membership/order and ownership effects together. An older completion must not override newer access invalidation or justify admission.
- Failed/partial lists never remove active membership or history. Preserve the last complete snapshot; retry safe reads with increasing delays and GitHub rate-limit guidance. Do not archive raw webhook/API payloads or build a replay broker.
- Warn immediately on failed sync or after **ten minutes** without success; show per-view last-success times. Access, Specs and PR/stack freshness are separate. Initial unavailability is not an empty list.
- Freshly verify action gates before start preparation or automatic reservation release, irrespective of a recent cache timestamp. Unknown required facts block the affected scope.

## 9. Persistence contract

Source: [Persistence model][persistence]. Use prepared, parameterized plain SQL through `bun:sqlite`; this logical layout is concrete enough to implement without inventing another domain layer.

| Table | Identity and required contents |
| --- | --- |
| `repositories` | Stable GitHub ID, organization/installation, current owner/name/URL/default branch, enrollment/removal/access/eligibility. Preserve removed/inaccessible rows. |
| `specs` | Permanent issue ID, Repository FK, number, current title/body/URL, open/label membership and observation. Unique Repository/number; retain referenced history. |
| `pull_requests` | Permanent ID, Repository/number, title/URL, state/draft, head/base identity and observed SHAs, merge/queue/auto-merge/observation facts. Include referenced closed/merged PRs; unknown is not false. |
| `pr_stacks` | Explicit native identity, Repository/native number, trunk, lifecycle/observation. Recreated identities are new records. |
| `stack_members` | Stack/PR FKs and ordinal; one current stack per PR and unique position in a stack. Cache, not ownership. |
| `sessions` | Atlas ID; Repository/Spec; immutable submission ID/order/time and prompt/Spec snapshot; original/current target; resolved parent/trunk/base/SHA/unique working branch; directory; intended create/session/message IDs and confirmed OpenCode association/checkpoints; exact sent message; frozen result PR FK; semantic/terminal evidence, held-slot flag, reasons, resource availability and freshness. |
| `stack_reservations` | Owner Session, original/accepted target association, held/released state, release time/type/reason and publication evidence. No unique-current-target rule: multiple valid owners can converge. |
| `reservation_prs` | Reservation + permanent PR identity with evidence role (observed reserved member, preparation parent, result). Retained evidence, not active-list cache. |
| `reservation_conflict_holds` | Target + involved reservation, retained until that owner releases; not a duplicate table of every derived membership edge. |
| `session_history` | Small append-only admission/reconfirmation/reservation/release/startup/terminal checkpoints with times, reasons and limited details. Not event sourcing. |
| `refresh_state` | Repository/data-view key, requested/completed generations, success time, failure/availability and invalidation. Requested > completed means pending. |
| `webhook_deliveries` | Unique delivery ID and received time; **30-day** deduplication. No raw payload archive. |
| `schema_migrations` | Ordered applied migration version/time. |

Use columns for identities, FKs, state, ordering, ownership and timestamps; JSON only for immutable handoff context and small diagnostic/history details that need no filtering. Check target kind against the corresponding Repository-scoped stack or permanent parent PR reference; default work has neither. Preserve original intent, reconfirmed queue target and resolved preparation facts distinctly.

Choose lossless handling for GitHub/SQLite integer identities rather than rounding through JavaScript numbers beyond their safe range. Verify bindings and effective PRAGMA results, not merely absence of exceptions. These are implementation safeguards described in the [reconstructed persistence evidence](research/issue-15-native-stack-reservation-model.md), not additional domain abstractions.

Enforce unique submission identity, one unfinished Session per Spec via partial uniqueness, unique OpenCode association within configured server scope, and unique working branch per Repository. Validate same-Repository relationships using constraints and transactions. Stable monotonic submission order resolves FIFO ties; mutable titles/timestamps alone are insufficient.

Keep current state directly queryable. Derive currently affected reservation targets from freshly verified membership of retained PR evidence; preserve original/accepted ownership and durable conflict holds. Commit observation, retained evidence, queue reassociation, holds and admission decisions atomically. Never recursively claim unrelated PRs or use a false single-owner-per-stack constraint.

Enable and verify `foreign_keys=ON`, WAL mode and `synchronous=FULL`. Use short synchronous transactions and immediate writes for admission/ownership reconciliation. Atomically confirm terminal state and release its slot. Database failures stop admissions without releasing resources or pretending success.

Apply numbered SQL migrations before serving/admitting; each migration and its ledger entry are transactional. Failure stops startup, never resets the database. Previously committed migrations may remain. Validate deployed Bun/embedded SQLite versions/settings rather than assuming local macOS behavior proves Linux behavior.

GitHub projections are replaceable caches; immutable handoffs, associations, reservations and history are not. Remove active-list membership only after a complete successful refresh. Prune only unreferenced caches and expired webhook receipts; never prune unfinished refresh work or referenced historical PRs on that schedule. OpenCode transcripts, tools, permissions, forms, shells and child aggregates remain upstream, not a second canonical SQLite copy. Keep credentials out of these records and diagnostic/history payloads.

## 10. HTTP, authentication and browser behavior

Source: [HTTP surface][http]. Repository path IDs are stable GitHub IDs; Session path IDs are Atlas IDs. Validate every nested entity and requested descendant; never accept an arbitrary upstream Session ID or filesystem path.

| Method / route | Contract |
| --- | --- |
| `GET /` | Redirect to `/repositories`. |
| `GET /login`, `POST /login` | Shared-token sign-in; validated same-origin relative return path. |
| `POST /logout` | End this browser sign-in and clear its cookie. |
| `GET /repositories` | Enrolled list; URL filter for removed history. |
| `GET /repositories/new`, `POST /repositories` | Eligible inventory and explicit idempotent enrollment/re-add; redirect to Specs. |
| `GET /repositories/:id` | Redirect to Specs. |
| `GET /repositories/:id/specs` | Active Specs and Session indicators. |
| `GET /repositories/:id/pull-requests` | Active PRs and required native-stack information. |
| `GET /repositories/:id/sessions` | Default Active; explicit status/all filters. |
| `GET /repositories/:id/specs/:number` | Current/retained Spec and attempt history. |
| `GET /repositories/:id/specs/:number/sessions/new` | Initial prompt/target form only. |
| `POST /repositories/:id/specs/:number/sessions` | Durably submit once; immediately redirect to Atlas Session detail. |
| `POST /repositories/:id/remove` | Stop admissions, preserve work/history. |
| `GET /sessions/:id` | Full retained detail and view-only execution. |
| `GET /sessions/:id/target`, `POST /sessions/:id/target` | Queued-target reconfirmation form/action. |
| `GET /sessions/:id/reservation/release`, `POST /sessions/:id/reservation/release` | Warning then terminal-only owner release; recheck on POST. |
| `GET /sessions/:id/view` | Allowlisted HTML panel/message-page projection, including verified descendants. |
| `GET /events` | Authenticated page-scoped SSE invalidation and shared operational status. |
| `POST /webhooks/github` | Signed public-webhook-only listener. |

Use bounded validated list parameters and stable ordering in GET URLs; upstream cursor paging governs messages. Navigable URLs always support full pages and restoration. Explicit allowlisted fragment requests use the same rendering/projection logic, with appropriate `Vary` where `HX-Request` selects the variant. Authenticated/sensitive responses are private and non-cacheable.

Ordinary successful POSTs use `303 See Other`. Enhanced POSTs use a non-3xx response with `HX-Redirect`; do not rely on HTMX response headers on redirects. Explicitly handle intended `409`/`422` value-preserving form fragments, while keeping `401` and unexpected errors out of normal content swaps. Follow the remainder of `DESIGN.md`'s interaction contract rather than duplicating it here.

### Browser authentication and input safety

- Shared bearer credential remains the entry secret; private HTTP clients may still use it. Browser sign-in lasts **seven days, non-sliding**, with a Secure, HttpOnly, host-only, SameSite cookie over private HTTPS. No accounts/roles system.
- Verify authentication on every page, fragment, action and SSE connection. Token rotation invalidates sign-ins; logout ends the current sign-in. End/revalidate streams so existing connections do not bypass expiry/logout/rotation indefinitely.
- Never expose the raw token through URLs, HTML, browser-readable state, persistent web storage, logs or SSE. Credential supplier and OpenCode authentication are separate concerns.
- Protect cookie-authenticated mutations, including login, using origin checks and CSRF protection as applicable; SameSite alone is insufficient. Reject unsafe return URLs, oversized bodies, malformed IDs and arbitrary fragment selectors. No permissive cross-origin access.
- Unauthenticated full-page GETs go to login; fragment/mutation requests return `401`, preserving an editing form in memory. After sign-in, explicitly retry the same form identity; no automatic POST resubmission or persistent prompt storage. Reload/tab closure preservation is not promised.
- Treat GitHub text, prompts, model/tool output and filenames as untrusted. Escape text; sanitize supported Markdown/links. Never execute supplied HTML/scripts or expose arbitrary filesystem/upstream proxy routes.

### Live browser projections and errors

One page-scoped SSE connection carries bounded named `refresh`/`reconcile` signals, not transcripts or a duplicate execution-state API. A small page controller fetches affected HTML projections, coalesces bursts and rejects older responses. Subscribe before reconciliation; repeat on browser or upstream reconnect. Close old streams on navigation. A healthy browser connection does not conceal upstream Stale state.

| Status | Meaning |
| --- | --- |
| `400` / `413` | Malformed/excessive input; no action. |
| `401` | Authentication needed/expired; invalid webhook signature also rejected. |
| `403` | CSRF/request-safety failure or prohibited action. |
| `404` | Unknown entity/route or unrelated descendant. Preserved removed entities still have historical pages. |
| `409` | Active-attempt conflict, structural target change, changed action eligibility, or submission identity reused with different content. |
| `422` | Field validation; retain values and explain. |
| `503` | Required service/storage unavailable before acceptance; do not claim success. |
| `500` | Sanitized unexpected failure; reconcile uncertain mutations by saved identity. |

Cached browsing during upstream outage can remain `200` with warnings. Once submission is durably accepted, later preparation failure does not roll it back. Automatic retries are only safe reads/reconciliation/reconnection, never create/prompt or other mutation retries.

Show compact shared OpenCode availability/compatibility, disk and backup-health/last-success notices. Keep Repository access/Spec/PR sync warnings separate from Session Stale. No separate admin dashboard, public health data or added operational controls.

## 11. Failure, restart and retention

Sources: [Failure handling][failure], [Recovery][recovery], later [reservation][stacks] and [persistence][persistence] refinements.

| Situation | Required response |
| --- | --- |
| Confirmed token/access/clone/setup failure before execution | Failed — setup; release execution slot, retain created resources/history. New attempt only through a fresh form after terminal state. |
| Lost create/prompt response or failed association/checkpoint write | Start unconfirmed; retain slot and unfinished-Spec exclusion, reconcile saved identities, never replay. |
| Known OpenCode outage/incompatible version | Pause all affected launches, retain cached views/warnings; health/version validation and reconciliation before resuming. |
| Repository access failure / shared GitHub auth outage | Pause affected Repository scope, skip it in the global queue; do not repeatedly fail queued attempts. |
| Persistence unhealthy | Stop new admission; already-running OpenCode work continues; preserve resources and reconcile uncertain writes. |
| Provider/tool/server error diagnostic | Show failed step/time/safe reason; only confirmed Session outcome establishes execution failure. |
| Expected clone/OpenCode record missing for unfinished attempt | Retain last state, slot and ownership; show unavailable/recovery warning and investigate. No automatic recreate or terminal inference. |
| Resource missing for terminal attempt | Retain recorded outcome and history; resource unavailable, slot remains released. |

On startup restore unfinished attempts, held slots and reservations **before admission**. Start disconnected/unreconciled regardless of a stored connected flag. Check durable preparation checkpoint before interpreting null/missing resources; a Queued attempt may legitimately have none. Continue only provably safe unsent steps; otherwise reconcile and require direct OpenCode investigation if ambiguity persists.

After server restart rediscover/authenticate, validate the pairing, resubscribe and hydrate. Atlas does not resume old prompts; OpenCode owns any native execution/recovery behavior. A server outage does not prove Interrupted. A missing Session may indicate wrong service/storage rather than deletion.

Preserve all terminal Sessions, clones and partial setup resources. No automatic deletion or cleanup-on-retry. Manual resource cleanup is only for confirmed-terminal attempts, with exact positively identified Session/directory scope; retain Atlas handoff/history and mark removed resources unavailable. Cleanup does not silently discard reservations. No cleanup of active or uncertain work.

## 12. Deployment and operator handoff

Sources: [Server inventory][inventory], [Phase 1 deployment][deployment]. Inventory is dated **2026-09-05**, not a claim of current readiness: Nemeton had 4 cores/8 threads, 15 GiB RAM and 116 GiB free in the encrypted Btrfs pool; no pinned Bun, reboot-managed OpenCode, configured TLS ingress or real Atlas backup regime. Its beta `18999` server was not the validated beta `19135` pairing. Leave the unused exFAT disk untouched.

### Services and paths

Run independent boot-enabled system-level Atlas and OpenCode units as existing user `omega`, preserving identity/settings/history. Use explicit executables, `HOME=/home/omega`, deliberate PATH and working directories. Atlas works from `/opt/atlas/current`; OpenCode uses a stable directory unrelated to a Session clone. Pin Bun and the approved OpenCode pairing; never depend on interactive mise shims.

Use bounded `Restart=on-failure` with a short delay. Atlas restart must not stop OpenCode or agents. systemd owns OpenCode; Atlas discovers rather than starts/upgrades/replaces it. Health checks distinguish process/database health from dependency readiness and never restart OpenCode merely because an agent is busy/waiting.

| Path | Purpose |
| --- | --- |
| `/opt/atlas/releases/<release>`, `/opt/atlas/current` | Pinned immutable releases and selected release. |
| `/var/lib/atlas` | One Btrfs subvolume: Atlas SQLite, OpenCode persisted data, full Session directories and protected required-configuration recovery copies. |
| `/var/lib/atlas/sessions/<session-id>` | Dedicated full Session clone. |
| `/etc/atlas` | Restricted configuration/secret files and App key, outside clones/repository. |
| `/var/backups/atlas` | Restricted read-only local recovery snapshots, outside source subvolume. |
| `/run/atlas` | Runtime-only IPC/status, never durable identity. |

One approved stopped-writer setup window co-locates existing OpenCode data in the snapshot subvolume. Inventory real configuration/data paths; moving only its database is insufficient. Preserve supported path/discovery behavior, settings and history; never move an open database. Retain originals until validation succeeds. Recreate/discover runtime registration rather than trusting a restored live endpoint.

The snapshot source must use ordinary directories, with no nested subvolumes/external mounts silently omitted. Symlinks do not include external targets. Verify agent-created worktree/data scope before claiming complete saved-work coverage. Refresh protected configuration copies whenever configuration changes.

### Repository-scoped Git and gh

Provision real Git/gh binaries, a host-managed `gh` launcher, Git credential helper and Atlas-local token supplier. Helpers live outside clones and ship with Atlas. Supplier authorization comes from registered Session→Repository mapping, never an arbitrary requested Repository. Mint installation tokens scoped to exactly that Repository and approved permissions; cache outside clones and renew before expiry. Never fall back to a human login, SSH key or wider installation token.

Set controlled launcher PATH on the shared OpenCode service at startup. Configure the helper for initial clone and clone-local Git configuration, clearing inherited fallback helpers and validating exact HTTPS GitHub host/Repository path. Keep credential-free remotes; tokens flow through Git's credential pipe. The gh launcher resolves registered Session directory, obtains a current token on invocation and passes it only to the real gh child environment, with controlled external config, conflicting auth/target variables cleared and credential-revealing debug disabled. Fail closed outside registered scope or when supplier unavailable; do not replay uncertain mutating commands.

Implement canonical registered-directory resolution and authenticated/restricted supplier IPC, including nested directories and symlinks. Configure Git to include the HTTP path in credential requests and terminate fallback on helper failure; an empty helper response alone is not fail-closed. Inspect askpass, URL rewrites, SSH and inherited CLI configuration so they cannot accidentally select another identity. Exact source-backed safeguards are in the reconstructed authentication note.

Prove ordinary/nested shells, nested directories, subagents, login-shell overrides and OpenCode restart keep routing correctly before execution readiness. Do not assume transient Session environment inheritance or persistence. Correct trusted shell wiring if it bypasses the launcher. Long-lived command credentials do not refresh magically mid-process.

Use restrictive secret files, typically `0600`; App key never enters clones or agent prompts. Do not inherit Atlas's secret-bearing environment into shells or expose credentials in URLs, arguments, logs, issues or UI diagnostics. The shared `omega` identity is **not hostile-agent isolation**: these measures prevent accidental leakage, not deliberate same-user access.

### Snapshots, disk and restore

- Daily systemd timer with catch-up; retain **7 daily / 4 weekly** read-only snapshots (one may satisfy both). Prune only expired, positively identified Atlas backup snapshots, never live Sessions.
- Snapshot the complete shared subvolume including each SQLite database and matching WAL/journal. No sequential live-database copies, forced-checkpoint substitute, scheduled agent interruption, service stop or freeze for daily backups.
- This is crash-recoverable saved state, not running-process restoration or an application-wide transaction. Edits may be incomplete and external GitHub effects cannot be rolled back. Verify actual embedded SQLite versions/settings, including known WAL safety issues.
- The [reconstructed SQLite evidence](research/issue-15-native-stack-reservation-model.md#deployment-caveats-requiring-verification) identifies the WAL-reset corruption fix in **3.51.3+**, with backports **3.44.6 / 3.50.7**. Verify the actual embedded builds used by Bun and OpenCode include the fix; the host SQLite CLI version is insufficient.
- Same-disk snapshots are not disaster backups. Host/disk loss, privileged deletion or lost encryption access may destroy both source and recovery points. **No off-site backup** in Phase 1.
- Conditional recovery targets: at most **24 hours** data loss and manual recovery within **one working day**, only when scheduled snapshots succeeded and a usable local snapshot survives. Display failure and last-success time; do not promise guaranteed protection.
- Warn below **20 GiB free**; pause new preparation below **10 GiB**. Monitor the shared Btrfs pool/metadata, not apparent snapshot sizes. Resume after space and ordinary checks recover. Running agents can still exhaust disk; never automatically interrupt/delete them.
- Backup failure warns but does not itself block Sessions if space permits. Bound journal retention and OpenCode/file logs separately; no prompts, contents, auth headers, tokens or keys in Atlas logs. Concrete log bounds are provisioning configuration, not a reason to delete unrelated host logs.

Restore with writers stopped and admission disabled. Preserve current/damaged data when feasible; restore a matched snapshot to a writable location with correct paths/ownership, validate integrity and associations, recreate discovery and reconcile GitHub/OpenCode before launches. Never restart old prompts automatically. Rehearse in isolation before deployment readiness: enrollment, Session associations, conversation history and saved files, without launching agents or exposing restored webhooks/credential endpoints. Confirm encryption/recovery access.

### Release procedure and manual readiness

1. Provision privileged directories/subvolume, pinned binaries, restricted configuration, independent units, credential routing, TLS/listener/firewall boundaries and snapshot timer. Exact hostnames/ports and secrets remain private deployment configuration.
2. Deploy manually over SSH into a versioned release. No CI deployment pipeline or automatic upgrades.
3. For upgrades, pause launches and drain Active Sessions. Waiting/unfinished work may block indefinitely; defer for an explicit operator decision rather than force interruption. Preserve publication reservations independently.
4. Take a pre-upgrade snapshot; record runtime/client/server/release versions, migrate safely and select the release. Validate health, reconciliation, private/public routing and scoped credentials before admission.
5. Rollback with compatible binaries **and matching data** when schema/data changed. Reconcile external GitHub effects with admission closed; routine Atlas deployment must not unnecessarily restart OpenCode.

Before declaring deployment ready, manually verify reboot persistence, private UI authentication and public webhook-only exclusion of login/events/Session/health/OpenCode paths; valid/invalid webhook handling; authenticated Repository-scoped Git/gh operations, renewal/expiry and denial against another private Repository; fail-closed supplier behavior; preserved-session reopen; disk/backup warnings and isolated restore. These are future acceptance obligations, not results of this document assembly.

## 13. Downstream slicing and completion boundary

Use `/to-tickets` to turn this plan into dependency-linked, end-to-end implementation slices. Do not create another decision map for already-settled policy or turn this order into horizontal framework scaffolding:

1. Minimal pinned Atlas runtime, SQLite migrations and private authenticated shell; deployment/credential prerequisites explicitly tracked.
2. App inventory → explicit enrollment → synchronized Specs/PR views with retained history and durable webhook refreshes.
3. Spec form → durable default-branch Session → safe authenticated clone/create/prompt handoff → preserved detail and Spec/Session associations.
4. Canonical live root/descendant viewer, lifecycle evidence, reconnection and failure/restart safeguards.
5. Native target selection/local preparation, per-stack queues, identity reconciliation, publication gates and narrow reconfirm/release controls integrated with the same admission path.
6. Production service/storage/ingress/credential rollout, snapshots, isolated restore rehearsal and complete journey verification.

Each slice references its relevant plan sections, resolution links and `DESIGN.md` for UI. The full Phase 1 journey is not complete with only default-branch starts or only a happy-path viewer. Verify duplicate/lost responses, uncertain handoff retention, removed access, stale projections, stack convergence/recreation and resource-loss behavior as applicable; never use verification as permission to mutate unrelated Repositories or force active execution to end.

For changed screens/workflows, run the applicable acceptance checks in `DESIGN.md` and report actual rendered verification and gaps. Source inspection alone is not visual verification. This planning session changes no screens and makes no rendered-UI claim.

### Explicitly outside Phase 1

- Creating/researching/planning Specs; Atlas consumes team-authored `spec` issues.
- Other organizations, multiple installations, other code hosts, forks and GitHub Projects.
- Blocker visualization or dependency-gated starts. Historical dependency research is reference only.
- Atlas publishing/repairing PRs/stacks after local preparation, review automation or using PR state as execution completion.
- OpenCode steering, follow-ups, permission/form replies, cancel/resume controls; orchestrator/worker scheduling or independent subagent limits.
- Inactivity timers, automatic interruption and maximum Session duration.
- Agent/model/provider configuration, permission policy, compaction policy, system prompts, token/cost accounting and budgets.
- External notifications, off-site backups and host/disk-loss recovery guarantees.
- Automated tests, automatic history cleanup, deployment automation and later product phases.

## 14. Evidence and reconstructed assets

The following missing notes were reconstructed with the user's authorization. Their new source checks do not recreate the original observations; each distinguishes native facts, approved Atlas policy and unverified behavior. They are part of this local handoff and must travel with the plan when published:

- [Start defaults and GitHub authentication](research/issue-9-start-session-defaults-and-github-auth.md).
- [Native GitHub PR stacks and local preparation](research/issue-9-native-github-pr-stacks.md).
- [Native stack transitions](research/issue-21-native-stack-transitions.md).
- [Native stack reservation persistence model](research/issue-15-native-stack-reservation-model.md).

Existing assets:

- [Pinned OpenCode viewer research][viewer-research] (published immutable artifact; includes exact methods/events/paging and public API gaps).
- [Final OpenCode POC source][poc-source] (preserved Sessions; earlier cleanup behavior superseded).
- [Throwaway A + C UI prototype][ui-source] (interaction evidence, not production styling authority).
- [Design theme research](research/design-theme.md) and [design interaction research](research/design-interactions.md), subordinate to current `DESIGN.md`.

### Decision coverage index

Every closed child of the map is accounted for, including superseded research and the invalidated stale ticket:

| Decision / evidence | Plan use |
| --- | --- |
| [OpenCode client/session API][client-research] | Network client and directory binding; older version/default/cleanup examples superseded by final POC/start/deployment. |
| [OpenCode events][events-research] | Global live-only stream and reconciliation; older inactivity/outcome inference superseded. |
| [GitHub App permissions/tokens/webhooks][github-app] | App identity and signed delivery; URL-embedded token examples are not production credential policy. |
| [GitHub issue dependencies and linked PRs][dependencies-research] | Retained reference; no dependency gating or inferred Session publication from issue closing links. |
| [Server inventory][inventory] | Deployment prerequisites and dated capacity/version facts. |
| [A + C UI prototype][ui] | Repository rail and Session desk; current design/build authority explicitly reconciled. |
| [Session lifecycle][lifecycle] | Aggregate, states, cap, Active and retention. |
| [Start-session contract][start] | Form, immutable handoff, local preparation, scope amendments. |
| [Invalidated stale-session detection][invalidated-stale] | Explicit exclusion of inactivity-based state/interruption. |
| [Failure handling][failure] | Proven setup failure versus uncertainty; preservation. |
| [Restart and recovery][recovery] | Restored ownership, no replay, reconnect and version gate. |
| [Webhook ingress/reconciliation][webhooks] | Separate listeners, durable invalidation and refresh cadence. |
| [Repository onboarding][onboarding] | Explicit enrollment and stable identity; removal refined by later decisions. |
| [Persistence model][persistence] | Concrete logical tables, invariants and ownership transactions. |
| [HTTP surface][http] | Routes, cookie sign-in, fragments/SSE, error and control boundaries. |
| [Phase 1 deployment][deployment] | Services, credential routing, data scope, snapshots and rollout. |
| [Final OpenCode POC][poc] | Validated pairing, execution acceptance/outcome and preservation evidence. |
| [OpenCode viewer contract][viewer] | Canonical hydration, live overlays and verified subagents. |
| [PR-stack reconciliation][stacks] | Native identities, eligibility, multiple-owner holds and release evidence. |

[map]: https://github.com/SandunRathsara/atlas/issues/1
[assembly]: https://github.com/SandunRathsara/atlas/issues/18
[ui-reconciliation]: https://github.com/SandunRathsara/atlas/issues/18#issuecomment-5552280494
[client-research]: https://github.com/SandunRathsara/atlas/issues/2
[events-research]: https://github.com/SandunRathsara/atlas/issues/3
[github-app]: https://github.com/SandunRathsara/atlas/issues/4
[dependencies-research]: https://github.com/SandunRathsara/atlas/issues/5
[inventory]: https://github.com/SandunRathsara/atlas/issues/6#issuecomment-5550333276
[ui]: https://github.com/SandunRathsara/atlas/issues/7#issuecomment-5550372759
[lifecycle]: https://github.com/SandunRathsara/atlas/issues/8#issuecomment-5550342457
[start]: https://github.com/SandunRathsara/atlas/issues/9#issuecomment-5550733490
[invalidated-stale]: https://github.com/SandunRathsara/atlas/issues/10#issuecomment-5550256015
[failure]: https://github.com/SandunRathsara/atlas/issues/11#issuecomment-5550585549
[recovery]: https://github.com/SandunRathsara/atlas/issues/12#issuecomment-5550594090
[webhooks]: https://github.com/SandunRathsara/atlas/issues/13#issuecomment-5550606846
[onboarding]: https://github.com/SandunRathsara/atlas/issues/14#issuecomment-5550684942
[persistence]: https://github.com/SandunRathsara/atlas/issues/15#issuecomment-5551092831
[http]: https://github.com/SandunRathsara/atlas/issues/16#issuecomment-5551236459
[deployment]: https://github.com/SandunRathsara/atlas/issues/17#issuecomment-5550786789
[poc]: https://github.com/SandunRathsara/atlas/issues/19#issuecomment-5550163845
[viewer]: https://github.com/SandunRathsara/atlas/issues/20#issuecomment-5550246023
[stacks]: https://github.com/SandunRathsara/atlas/issues/21#issuecomment-5550956896
[viewer-research]: https://github.com/SandunRathsara/atlas/blob/637748917a976fb9ad9247b67e22d96af4cab499/docs/research/issue-20-opencode-session-viewer-contract.md
[poc-source]: https://github.com/SandunRathsara/atlas/tree/5ff26b164ae6d7d8a650b6c882d1db680dc71fff/poc/issue-19-opencode-e2e
[ui-source]: https://github.com/SandunRathsara/atlas/tree/prototype/atlas-phase-1-ui/prototype
