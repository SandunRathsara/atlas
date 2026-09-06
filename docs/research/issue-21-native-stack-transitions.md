# Native stack transitions

**Reconstructed on 2026-09-05.** This is a new evidence-based reconstruction, not a recovered verbatim copy of the missing note. GitHub native stacks are public preview. First-party extension evidence is pinned to `github/gh-stack` commit `2bd699a544a09cb5c45a013d03416e0894b0454e`; GitHub Docs reflect the reconstruction date. [APIs]

**Authority:** [PR-stack projection and reservation reconciliation][Resolution] controls Atlas policy. Its body and all comments were read, including the earlier provisional checkpoints. Those checkpoints are not competing final decisions. This note separates native facts from the accepted Atlas queue/publication/release contract.

**Method:** Context7 library resolution followed by a docs query; direct GitHub Docs reads; read-only issue and pinned source retrieval. No live mutations, stack-transition experiments, provisioning, secret reads, tracker changes, commits, application implementation, or tests. No claim below relies on a newly performed live schema introspection or observed transition experiment. Earlier research mentioned in the issue is not presented as having been repeated here.

## Bottom line

- Merge and close do **not** mean removal from native membership. Unstack can preserve a smaller, locked stack. [FAQ] [REST]
- Recreating a stack is a new identity, even if it reuses PRs. A surviving old stack and a newly created stack may both exist. [REST] [Submit]
- Readiness can reverse. Current publication verification and reservation release are **Atlas policy**, not GitHub lifecycle semantics. [Stage] [Resolution]
- `stacked` reports a join; no complete removal/restructure event stream was verified. Current reads plus reconciliation are necessary. [Hooks] [Events]
- Branch names/SHAs do not prove branch-incarnation continuity. The documented async merge observer needs a request UUID; absence of queue/auto-merge state does not prove no external direct merge is pending. [Refs] [Merge] [Client]

## 1. Authoritative native read surface

| Read | What it establishes | Important boundary |
| --- | --- | --- |
| `GET /repos/{owner}/{repo}/stacks` | Repository inventory; optional `pull_request` number filter; `page`/`per_page` pagination, maximum 100 per page. | A failed request is not an empty inventory. |
| `GET /repos/{owner}/{repo}/stacks/{stack_number}` | Explicit stack `id`, repository-scoped `number`, `node_id`, base ref, `open`, creation time and members. | Stack `open` alone does not establish eligibility or every PR's state. |
| Detailed PR REST resource | Its explicit `stack` object, including size, position and ultimate base; detailed lifecycle/readiness facts. | A direct PR base branch is not necessarily the stack trunk. |
| Read-only GraphQL `PullRequest.stack` / `stackEntry` | Stack node identity and entry position; `entries` is a paginated connection. | Read every page; a partial connection cannot establish top or absence. |
| Exact Git ref read | Whether the required named ref currently exists and its target SHA. | Stored PR head metadata is not a live-ref check. |

Sources: [REST], [APIs], [GraphQL], [Refs]. The REST inventory member schema includes `number`, `state` (`open`/`closed`), `draft`, `merged_at`, and head ref/SHA. Thus distinguish closed-unmerged from merged, rather than treating every `closed` PR as abandoned. The pinned client preserves REST member ordering bottom-to-top in `RemoteStack.PRNumbers`. GraphQL positions start at 1 nearest the base. The actual last member is top, not the last open member. [REST] [Client] [GraphQL]

The documented REST detail response has an embedded member array, not separate member-page parameters. Pagination applies to the REST inventory and GraphQL entry connection; do not invent REST pagination parameters for the detail endpoint. [REST] [GraphQL]

Native creation requires explicit registration of an ordered PR list with adjacent base/head refs matching. Append adds only new PRs to the actual existing top. Branch-chain compatibility is a creation precondition, **not proof of existing membership**. Same-repository branches, any repository trunk branch, and a maximum of 100 PRs are documented. [REST] [FAQ]

## 2. Native transition matrix

| Transition | Documented outcome | What must not be inferred |
| --- | --- | --- |
| Merge a bottom or middle PR | Selected PR and unmerged PRs below it merge into the trunk; upper PRs remain open. Lowest unmerged PR is retargeted to the trunk and remaining branches undergo cascading rebase. Merged members remain associated. [FAQ] | Do not remove merged entries or reconstruct membership from the now-changed base branches. |
| Merge every member | Stack is complete and cannot extend. The CLI starts a new stack for additional local branches; original remote stack remains untouched. [FAQ] [Submit] | A new local layer is not an extension of the old native identity. |
| Close an unmerged middle PR | Stack relationship remains; PRs above it are blocked from merging. Structural replacement requires unstack/recreation. [FAQ] | Closure is not unstacking. This statement does not settle all closed-top append edge cases. |
| Unstack removable members | Open, draft and closed-unmerged PRs can leave; merged and queued members remain. REST returns `200` with survivors, or `204` when none remain and the stack dissolves. [FAQ] [REST] | A successful unstack does not necessarily delete the stack. |
| Unstack with every member locked | REST documents `422`; concurrent modification can produce `409`. [REST] | Error or conflict is not evidence of removal or successor identity. |
| Restructure using pinned CLI | `modify` changes local branches/metadata; later `submit` unstacks the old remote grouping and creates another. [Modify] [Submit] | Local metadata, a success message, or a preserved PR number does not establish native identity continuity. |
| Mark ready, then convert to draft | An open PR can return to draft and cannot merge until ready again. [Stage] | Readiness is not monotonic and is not Session completion. |

### Merge atomicity is scoped

Stacks require the asynchronous merge API, not legacy synchronous REST merge or GraphQL merge mutation. Direct merge of the selected group is atomic. Queue admission of the group is atomic, but queued PRs are subsequently evaluated bottom-up; a failed PR and its descendants can be ejected while lower PRs are unaffected. Do not describe eventual queue landing as one guaranteed atomic merge of the whole stack. [APIs] [FAQ] [Merge]

### Locked survivors and source caveats

`internal/github/github.go` implements `Unstack` with separate returned-stack and `dissolved` results. Its comment also mentions auto-merge-enabled survivors, whereas the pinned FAQ says auto-merge is currently unsupported on stacked PRs. Treat that source comment as defensive client evidence, not proof of a supported native auto-merge transition. REST's contract is broader: non-removable PRs remain, with queued PRs given as an example. Merged retention is explicit in the FAQ. [Client] [FAQ] [REST]

`cmd/submit.go:handlePendingModify` calls `Unstack`, discards its survivor/dissolution results, then clears the old local identity so synchronization can create a new stack. Its wording about deleting/clearing the old stack must not override the server's survivor contract. `maybeForkFromMergedBase` separately documents leaving the fully merged remote stack intact. These are pinned client implementation facts, not experimentally verified server outcomes. [Submit]

`modify`'s local merged-row locks and local filesystem lock are not remote next-layer reservations. The documented native endpoints expose create, append and unstack, not an Atlas reservation primitive. [Modify] [REST]

## 3. Readiness, historical evidence and webhooks

**Documented:** PR creation precedes membership. `pull_request.opened` has no stack because the PR has not joined one yet. `pull_request` action `stacked` reports joining and includes matching top-level `stack` and nested `pull_request.stack` objects. Later lifecycle payloads include nested stack metadata while the PR is a member. [Hooks] [FAQ] [APIs]

The current general webhook reference lists `stacked`, `ready_for_review`, `converted_to_draft`, `closed`, `reopened`, `synchronize`, `enqueued`, `dequeued`, and auto-merge changes among PR actions. Its action list does not list `unstacked`. **This is a coverage finding, not proof GitHub emits no other useful signals.** No complete unstack/reorder/recreation feed was verified. [Events]

**Evidence limits:**

- A historical ready event and a later membership read do not prove readiness and membership were simultaneous. A retained event payload may supply evidence for that event, but exact historical stack payload coverage was not verified here. [Hooks] [Resolution]
- Current `draft: false` plus current native membership can establish the present publication relationship without reconstructing every past transition. Whether that releases an Atlas reservation is a separate product decision. [REST] [Resolution]
- Ref `create`/`delete` and `push` signals are useful invalidations, not a durable branch-incarnation ledger. The webhook reference also documents delivery-size limits and push-event suppression for very large multi-branch pushes. [Events]
- Webhooks are observations of earlier events, not an atomic current-state snapshot. Atlas's accepted policy is to refresh on events, reconcile every five minutes, and refresh again before admission/release. [Resolution]

## 4. Branch rename, deletion and reuse

### What primary sources actually establish

- **GitHub-side rename:** GitHub updates base branches of open PRs, but closes an open PR when its head branch is renamed. This is general PR behavior; it is not a complete native-stack transition specification for renaming a trunk or intermediate branch. [Rename]
- **Local CLI rename:** pinned `modify` renames a local branch and tracking metadata; next `submit` pushes the new name and recreates the stack. That is not equivalent to invoking GitHub's branch-rename operation. Do not assume the old remote branch or original PR is automatically renamed. [Modify] [Submit]
- **Deletion/restoration:** the documented PR-page deletion workflow permits deletion for closed/merged PRs when no other open PR references the branch, and permits restoring a closed PR's head branch. These UI constraints do not establish every Git/API deletion behavior or native stack consequence. [Delete]
- **Current ref existence:** `GET .../git/ref/heads/{branch}` checks an exact ref. Matching-ref lookup can return prefix matches even when the exact branch is absent. Git refs can be rewritten and the REST API exposes create/update/delete operations. [Refs]
- **Identity gap:** the ref schema includes `node_id`, but the reviewed documentation gives no guarantee that it uniquely identifies each delete/recreate incarnation. Name, SHA and an undocumented interpretation of node ID cannot prove continuity across an unobserved deletion/recreation. [Refs]

### Accepted Atlas consequence, not native behavior

Discover publication through the Session's unique working branch and stable Repository identity, including historical closed/merged PRs. Persist the resulting permanent PR identity. Never switch it because another PR later uses the name. Initial ambiguity or rename/reuse before identification means **“Publication could not be verified”** and retains ownership; do not automatically adopt a replacement. Undetected ref reuse remains a stated detection limit. [Resolution]

The pinned client contains open-only `first: 1` branch lookup and another latest-PR lookup; these are CLI convenience paths, **not** sufficient implementations of Atlas's historical/ambiguity-aware publication contract. [Client] [Resolution]

## 5. External direct merges: what can be detected?

The async API documents submission through `PUT .../pulls/{n}/merge-async`, followed by read-only `GET .../pulls/{n}/merge-async/{uuid}`. Pending submission provides the UUID. Poll results distinguish `pending`, `merged`, `enqueued`, and `failed`; `enqueued` ends that async request, not the PR's journey through the merge queue. Results expire 24 hours after their most recent update. [Merge]

The documented conflict response to another submission can return an existing UUID. **Submitting is a mutation, not an acceptable read-only detection probe.** No submission was performed. No documented endpoint to enumerate every externally initiated pending direct-merge request by PR without its UUID was found in the reviewed sources. This is a bounded research finding, not a universal claim about GitHub internals. [Merge] [APIs]

The pinned client reads `mergeQueueEntry` and `autoMergeRequest`; those identify queue/auto-merge state, not every direct asynchronous operation. Null queue/auto-merge values therefore do not establish absence of a pending direct merge. Nor does mergeability establish exclusive access. [Client] [Merge]

Atlas accepts this race: block known unsafe state, freshly recheck before preparation, report outside target changes, and neither repair GitHub nor cancel already-running execution. There is no documented future-layer lock or atomic GitHub read-and-Atlas-reserve transaction. Exclusivity is between Atlas admissions, not against external writers. [Resolution] [REST]

## 6. Accepted Atlas policy (not GitHub semantics)

All rules in this section come from the final [Resolution], including refinements absent from earlier checkpoints.

### Eligibility

- Use explicit same-Repository native stacks, rooted on any existing trunk. A standalone parent must be open, lack native membership and target the Repository default branch. Other legacy chains need external conversion; Atlas does not repair them.
- Disable known merging/queued/auto-merging parents, closed-unmerged layers, required missing refs, unusable tops, full 100-member stacks and fully merged stacks. Do not skip an unusable top or expose native members as standalone targets.
- Draft state, failing CI and missing approval **alone** do not disqualify implementation targets. This is not GitHub merge eligibility.
- Unknown preview/access/API state disables affected starts with reasons; do not interpret it as an empty/deleted stack or silently fall back to default.

### Identity, queue movement and reservations

- Ownership keys are stable Repository/native stack identities, or permanent standalone parent PR identity before membership; never mutable branch names or local tracking.
- When a standalone parent joins a stack, associate its queue and reservation with the actual stack. Combine waiting queues by original submission order, preserving every reservation owner. Converged ownership blocks new starts until all owners release; existing execution continues.
- A surviving stack follows its actual latest eligible top. Ordinary new layers/head commits need no reconfirmation; an ineligible survivor pauses with a reason.
- A removed target requires explicit selection of a current target. Reconfirmation preserves Session, prompt and original order; it releases nothing and bypasses no eligibility/reservation/global/per-Spec gate.
- A dismantled reserved stack keeps its original reservation. Track actual membership of known permanent PR identities and block successor targets until release. Do not claim unrelated targets by matching branch names.
- Save queue reassociations, reservations and admission atomically; recheck ownership before admission. Stack reservations are distinct from global execution slots. Admit oldest eligible requests while skipping blocked targets.

### Publication and release

- PR state never establishes Session completion. Automatic release requires **confirmed terminal execution** plus fresh verification of the permanently identified publication PR: non-draft, open or merged, in the intended native stack.
- A replacement stack qualifies only when fresh reads verify the same preparation parent and identified result are both members, with result above parent, non-draft and open or merged. This verifies a relationship; it does not equate old/new stack identity.
- A merged publication does not need a surviving head branch merely to prove publication. Verify branches required for the specific operation, not every historical head indiscriminately.
- Closed-unmerged, ambiguous or uncertain publication retains ownership for explicit terminal-only release. Historical readiness alone is insufficient. Once validly released, later draft conversion does not resurrect the reservation; future starts validate current state independently.
- Default-branch-owner exception: its standalone published parent may unblock its first child after owner terminal and parent ready, without native membership first.
- Explicit release requires confirmed terminal execution, warns about unverified/unpublished work, releases only that owner's reservation, and changes no GitHub state. It does not bypass fresh eligibility for the next start. Never release active or uncertain execution.

### Observation, recovery and Repository removal

- Use native REST inventory/detail and detailed PR reads, with read-only GraphQL as needed. Paginate inventory/connections and verify required exact refs. Never run mutating CLI synchronization as observation.
- Events trigger refresh; existing five-minute reconciliation catches missed changes. Refresh relevant PRs, membership/order and operation-required branches before admission or automatic release, and recheck immediately before preparation.
- Failed/inconsistent reads pause affected queues with **“Waiting for GitHub verification”**, not unrelated Repositories. Outage/restart never clears durable ownership; restore reservations before admission independently of execution slots.
- Removal from Atlas stops admissions but preserves execution, queues, associations, reservations and history. Re-adding the same GitHub Repository identity restores that history subject to verification; another repository using its name inherits nothing. Terminal-only explicit release remains available during removal/outage.

## 7. Remaining evidence gaps — accepted, not permission to experiment

| Gap | Safe interpretation under the resolution |
| --- | --- |
| Exact closed-top append behavior and all lock combinations | Do not infer native acceptance from append's base/head rule; Atlas already disables closed-unmerged/unusable targets. |
| Stack outcomes for every trunk/head/intermediate rename, ref deletion, restoration and reuse | Re-read explicit identities, PRs, membership and required refs; never infer repair or continuity. |
| Complete unstack/restructure webhook coverage and exact historical payloads | Reconcile current inventory/known PRs; missed history cannot authorize release. |
| Historical simultaneous membership and readiness | Require current publication verification; otherwise retain for terminal-only explicit release. |
| Every external pending direct merge without its UUID | State the exclusion limit; block known unsafe facts and recheck, without mutation probes. |
| Preview schema/access changes or inconsistent multi-request reads | Pause affected decisions, not ownership; no default/empty-stack fallback. |

These limitations were explicitly accepted in the PR-stack reconciliation resolution. They do not reopen the settled policy or imply implementation/testing has occurred. [Resolution]

## Sources

Pinned links below all use the requested commit. GitHub Docs links were read on the reconstruction date.

[Resolution]: https://github.com/SandunRathsara/atlas/issues/21#issuecomment-5550956896
[REST]: https://docs.github.com/en/rest/pulls/stacks
[APIs]: https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks
[FAQ]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/faq.md
[Hooks]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/reference/webhooks.md
[GraphQL]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/reference/graphql-api.md
[Merge]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/reference/merge-api.md
[Modify]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/guides/modify.md
[Submit]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/cmd/submit.go#L489-L681
[Client]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/internal/github/github.go
[Stage]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/changing-the-stage-of-a-pull-request
[Events]: https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
[Rename]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/renaming-a-branch
[Delete]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/deleting-and-restoring-branches-in-a-pull-request
[Refs]: https://docs.github.com/en/rest/git/refs#get-a-reference
