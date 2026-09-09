# Native GitHub PR stacks and local preparation

**Reconstructed:** 2026-09-05. **Status:** documentation/source research, not original empirical evidence or an implementation report.

**Conclusion:** Atlas can prepare a child branch and local stack tracking without publishing anything. GitHub native membership is a separate, explicit operation over existing PRs. Later agent/human publication is supported by the documented APIs and official CLI, but the Atlas installation-token workflow has not been integration-tested.

## Authority and versions

- **Accepted Atlas policy:** [Start-session contract: initial prompt, spec context, and OpenCode request](https://github.com/SandunRathsara/atlas/issues/9#issuecomment-5550733490), resolved 2026-09-05. This supersedes the earlier interview checkpoint.
- **GitHub API:** current documentation retrieved 2026-09-05; native stacks remain **public preview**, subject to change. The REST page recommends API version `2026-03-10`. [REST][rest] [API overview][overview]
- **Official `github/gh-stack`:** source/docs pinned to commit [`2bd699a544a09cb5c45a013d03416e0894b0454e`](https://github.com/github/gh-stack/commit/2bd699a544a09cb5c45a013d03416e0894b0454e), committed 2026-08-27. Local tracking schema version is **1**. No release-tag equivalence is claimed. [Tracking source][tracking]
- **Documentation mismatch:** the pinned README says GitHub CLI v2.0+; the current [GitHub quickstart](https://docs.github.com/en/pull-requests/get-started/stacked-prs-quickstart#prerequisites) requires `gh` 2.90.0+ and Git 2.20+. Deployment must choose/test a compatible toolchain rather than rely on the README minimum.
- Context7 was queried with `library GitHub` first, then `docs /websites/github_en`. It returned general PR/API material, not the new stack contract. The stack-specific evidence below comes directly from GitHub's current docs and pinned first-party source.

No stack API writes, pushes, bootstrap commits, PR creation, provisioning, or publication experiments were performed. This reconstructs the missing note from available sources; it does not recover or assert the original session's observations.

## Accepted Atlas policy — not native GitHub guarantees

The following is a focused extract of the [final resolution][policy], not a new design decision:

- Offer the default branch, an existing **native stack selecting its top**, or an eligible standalone PR. Same Repository only; do not list native members as standalone parents.
- Prepare a dedicated full clone and unique local working branch. Default work uses the latest default-branch commit; stacked work uses the selected top/parent's head commit. Record the exact preparation SHA.
- Prepare local tracking only: **no bootstrap commit, placeholder push, startup draft PR, or new native member registration**. The prompt must explicitly say the layer is local and unpublished, and include parent PR URL, immediate parent branch, trunk, native identity if present, working branch, and preparation SHA.
- Agents/humans own later commits, pushes, PR creation and native membership. Atlas observes; it does not repair, rebase, merge, retarget or change readiness for them.
- Disable unavailable targets with a reason, never silently fall back or mutate an existing PR to make it eligible. Open/draft parents need not pass CI or have approval just to be selected.
- Immediate structural changes require reconfirmation; new commits on the same parent branch are accepted. Queued stack requests follow the latest eligible top when admitted; unusable queued targets pause instead of silently retargeting.
- Atlas serializes work per stack/standalone parent and associates the resulting PR using Repository + unique head branch. Automatic reservation release requires confirmed terminal execution **and** the resulting PR being a native member ready for review. Publication is not required for execution to become terminal.
- There is a specific default-work exception: an unfinished default-branch Session's standalone PR queues child requests behind its owner; after terminal execution and parent readiness, the first child can be prepared without that parent already having native membership.

Queue identity migration, outside changes, lifecycle transitions, restart reconciliation and detailed release rules are settled by [PR-stack projection and reservation reconciliation](https://github.com/SandunRathsara/atlas/issues/21#issuecomment-5550956896); see [the reconstructed transition note](issue-21-native-stack-transitions.md). This note does not duplicate those algorithms. Atlas reservations are not native GitHub locks.

## Verified native facts

### Identity, membership, order and trunk

| Concern | Documented contract |
|---|---|
| Explicit membership | PR REST resources expose `stack`; standalone PRs have `stack: null`. A matching base/head chain is necessary to register a stack, not proof that registration happened. [Overview][overview] [Pinned REST][pinned-rest] |
| REST identity | Stack resources expose global integer `id`, repository-scoped integer `number`, global `node_id`, and API `url`. Routes use **`stack_number`**, not `id` or a PR number. [REST][rest] [Pinned REST][pinned-rest] |
| Read routes | `GET /repos/{owner}/{repo}/stacks`; optional `pull_request=<PR number>` membership filter; `GET /repos/{owner}/{repo}/stacks/{stack_number}`. Repository lists are paginated (`per_page` maximum 100, default 30). [REST][rest] |
| REST member order | `pull_requests` is ordered **bottom to top**, not by PR number or timestamp. Entries include `number`, `state`, `draft`, `merged_at`, and `head.ref`/`head.sha`. [Pinned REST][pinned-rest] [Client decoder][client] |
| PR membership fields | `stack.id`, `number`, `size`, 1-based `position`, `base.ref`, `base.sha`. Position 1 is bottom; `position == size` identifies the top. [Pinned REST][pinned-rest] [FAQ][faq] |
| Trunk versus parent | A PR's own `base.ref` is its immediate parent; `stack.base.ref` is the whole stack's target/trunk. Trunk can be a non-default branch. Stack list/detail guarantees `base.ref`, not a trunk SHA; do not require the richer PR membership `base.sha` on every stack resource. [Pinned REST][pinned-rest] [About stacks][about] |
| GraphQL identity | `PullRequest.stack` and `stackEntry` are nullable. `PullRequestStack` has Node `id`, repository-scoped `number`, `size`, `baseRefName`, and paginated `entries`. [Schema][graphql] [Pinned GraphQL][pinned-graphql] |
| GraphQL order | Each `PullRequestStackEntry` has its own Node `id`, 1-based `position`, nullable `pullRequest` and `stack`. Read all required pages and use positions; a first page is not a complete stack. `entries` supports `after`, `before`, `first`, `last`. [Schema][graphql] |
| Native size limit | Creation requires at least **2 PRs**; a stack can contain at most **100 PRs**. The create payload allows 2–100 numbers; add accepts 1–100 new numbers, but this does not override the total-stack cap. Pagination's 100 is a different limit. [Pinned REST][pinned-rest] [FAQ][faq] |
| Repository boundary | All branches must be in the same repository; cross-fork stacks are unsupported. [About stacks][about] |

There is no dedicated `top` field in these documented stack schemas. Top follows explicit member order/position. **Top member** and **eligible starting target** are different questions: a stack's `open` flag only means it contains an open PR; it does not prove that its top is usable. [Pinned REST][pinned-rest]

Do not confuse three identities: REST numeric stack `id`, GraphQL/REST Node ID, and repository-scoped stack `number`. The pinned local client stores the REST integer ID converted to a string in its local `Stack.ID`; that local string is **not** the GraphQL Node ID. [Checkout source][checkout] [Client][client]

### Registration and access

| Operation | Documented requirements |
|---|---|
| Create native stack | `POST /repos/{owner}/{repo}/stacks` with `{"pull_requests":[bottomPR,...,topPR]}`. PRs already exist in that Repository; each later PR's base ref equals the previous PR's head ref. Success: 201. [REST][rest] |
| Append native members | `POST /repos/{owner}/{repo}/stacks/{stack_number}/add` with only the ordered new PR numbers. First new PR targets the current top's head branch. Success: 200. [REST][rest] |
| GraphQL writes | No native-stack mutations; GraphQL stack support is read-only. Ordinary PR creation is separate from native registration. [Overview][overview] [Client][client] |
| App read permissions | GitHub's **Pull requests** permission table lists stack list/get with **read**, supporting both user access tokens (UAT) and installation access tokens (IAT). [App permissions][permissions] |
| App write permissions | The same table lists create/add/unstack with **write**, also UAT and IAT. These documented capabilities do not establish that Atlas's actual installation is configured or operational. [App permissions][permissions] |
| Git publication access | Separately, Git-over-HTTPS using an installation token requires **Contents** permission. Permission to call stack endpoints is not permission to push branches or bypass repository rules. [Installation authentication][installation] |

**Headers:** the current REST stack reference recommends `Accept: application/vnd.github+json`, `Authorization: Bearer <token>`, and `X-GitHub-Api-Version: 2026-03-10`. It specifies **no stack-specific preview media type/header**. The pinned client's `NewClient` supplies `api.ClientOptions{Host: host}` and its stack methods use ordinary REST calls without adding a stack preview header. This is documentation/source evidence, not a packet capture or proof of every host/version's behavior. [REST][rest] [Client][client]

The pinned docs say unavailable/not-enabled stack endpoints can return 404. A 404 alone must not be treated as proof that a Repository has no stacks or that a PR is standalone; access/resource failures can also produce 404. [Pinned REST][pinned-rest] [REST status codes][rest]

## Local preparation: feasible without native writes

### What the pinned CLI actually separates

- `gh stack init --base <trunk> <branch...>` adopts existing local branches and creates missing ones in the supplied bottom-to-top order. It saves local tracking and checks out the last branch. **It does not create commits, push, create PRs, or register membership.** It can perform remote PR lookup and fetch/materialize a missing trunk; “local-only” means no remote mutation, not necessarily offline. It can enable local Git `rerere`. [Init source][init]
- On a tracked top branch, `gh stack add <unique-child>` without `-m`, `-A`, or `-u` creates/checks out a child at the current branch tip, records its base SHA, and saves tracking. No commit is necessary: child and parent may initially point to the same commit. Existing names can be adopted, so Atlas must enforce its **new unique branch** invariant separately. [Add source][add]
- Tracking lives in Git's directory as `gh-stack` (normally `.git/gh-stack`), not a committed project file. Schema 1 stores repository context, trunk, ordered branches, base SHAs and optional PR/native identities. A local branch can have **no `pullRequest` reference**. This is local workflow metadata, not server membership or a native reservation. [Tracking source][tracking]

### Candidate preparation paths — source-derived, not tested recipes

| Selected target | Local-only construction |
|---|---|
| Default branch | Materialize the validated default tip; initialize a local one-branch stack with explicit trunk and unique child. Native registration is unnecessary and impossible with no PRs. |
| Standalone PR | Fetch/materialize the validated parent branch and its own base/trunk. `init --base <trunk> <parent> <unique-child>` adopts the parent and creates the child from it, preserving the parent as a layer. There is still no native stack identity. |
| Existing native stack | Import its explicit ordered members and trunk into local tracking, check out the validated top, then plain `add <unique-child>`. Keep the existing native identity associated with the imported stack; the new child has no native PR/member yet. |

These paths follow [init][init], [add][add] and [checkout/import][checkout]. They require explicit validation of actual refs/SHAs. Do **not** initialize only the child with the selected parent as `--base` and assume equivalent tracking: that treats the parent as trunk, omitting the intended parent layer and real trunk from the local publication model.

**Checkout safety caveat:** `gh stack checkout <stack-number>` has a read/fetch/local-import path suitable for a fresh clone, but the command is not universally read-only. On a composition conflict its interactive menu can invoke `Unstack` remotely. It also has lookup fallbacks and best-effort fetch behavior. Atlas must not blindly use its whole interactive workflow as a preparation primitive; the non-mutating path and exact preparation SHA need validation. This note does not choose the implementation adapter. [Checkout source][checkout]

Do not use `push`, `submit`, `link` or `sync` during Atlas preparation: they have publication effects. In particular, `sync` can push and register existing PRs, and `link` can push branches/create PRs/update bases despite its name. [Pinned README][readme]

## Later agent/human publication

The documented sequence is feasible **after real work is committed**:

1. Publish the child's branch and create its PR against the immediate parent's branch.
2. If the parent is standalone, create a native stack from `[parentPR, childPR]`; if a native stack exists, append `[childPR]` to its current top after fresh validation.
3. Observe actual PR readiness and native membership separately from local tracking and command exit status.

The REST create/add contracts directly support that separation. No startup placeholder or bootstrap PR is needed. [REST][rest]

The official CLI provides an implementation path via `gh stack submit`: it pushes branches, finds/creates PRs, then creates/adopts/extends native membership. Its `updateStack` implementation uses `AddToStack` with a delta; an outdated `syncStack` comment mentions PUT, but **PUT is not the documented append contract**. [Submit source][submit] [Client][client]

`submit` is **not a child-only or observation-only operation**: it processes active ancestors too, can adjust existing PR bases, disable auto-merge, and with `--open` mark existing drafts ready. `--auto` creates new drafts by default. Several PR/stack failures are warning-only, so command success is not proof that a native member was published. These behaviors make it an agent-owned workflow choice, not authorization for Atlas to run it automatically. [Submit source][submit]

## Unverified and deferred

- **No live App test:** documented IAT support is verified, but actual Atlas clone/fetch/push, GraphQL PR creation, native create/add, readiness changes and repository-rule interactions were not exercised.
- **No local integration test:** no full-clone preparation or subsequent `gh stack submit` run proved the reconstructed paths end to end. Missing/deleted refs, adopted branch mismatches and source/doc drift need tests before deployment claims.
- **No preview-header experiment:** no authenticated stack response was compared across API versions/headers; absence of a documented special header is not empirical verification.
- **Eligibility details are in the reconciliation decision:** the sources here establish explicit membership and the 100-member cap, not Atlas's complete eligibility matrix. Apply that decision and its accepted evidence limits; never manufacture eligibility through remote mutation.
- **Credential delivery/renewal remains deployment work:** this note does not establish secrets wiring, token refresh, descendant shells or restart survival. See the final issue resolution's deployment boundary.
- **Reconciliation intentionally excluded:** no rules for identity replacement, close/merge/unstack transitions, outside publication races, response loss, stale reads, durable reservation migration or recovery are reconstructed here.

## Primary sources

[policy]: https://github.com/SandunRathsara/atlas/issues/9#issuecomment-5550733490
[rest]: https://docs.github.com/en/rest/pulls/stacks
[overview]: https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks
[about]: https://docs.github.com/en/pull-requests/get-started/about-stacked-prs
[graphql]: https://docs.github.com/en/graphql/reference/pulls#object-pullrequeststack
[permissions]: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-pull-requests
[installation]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation#using-an-installation-access-token-to-authenticate-as-an-app-installation
[pinned-rest]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/reference/rest-api.md
[pinned-graphql]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/reference/graphql-api.md
[faq]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/faq.md
[readme]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/README.md
[init]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/cmd/init.go
[add]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/cmd/add.go
[checkout]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/cmd/checkout.go
[submit]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/cmd/submit.go
[tracking]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/internal/stack/stack.go
[client]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/internal/github/github.go
