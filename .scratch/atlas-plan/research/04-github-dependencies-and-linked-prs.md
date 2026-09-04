# 04 - GitHub issue dependencies and linked PRs

Ticket: [issues/04-github-dependencies-and-linked-prs.md](../issues/04-github-dependencies-and-linked-prs.md)
Date: 2026-09-04

## Sources and method

Primary sources:

- GraphQL schema (public, official): https://docs.github.com/public/fpt/schema.docs.graphql (downloaded 2026-09-04; all field/argument facts below are quoted from it). Rendered docs: https://docs.github.com/en/graphql/reference/objects#issue and https://docs.github.com/en/graphql/reference/objects#pullrequest
- GraphQL schema changelog 2025: https://docs.github.com/en/graphql/overview/changelog/2025
- REST issue dependencies: https://docs.github.com/en/rest/issues/issue-dependencies
- REST issues (list/get): https://docs.github.com/en/rest/issues/issues
- REST issue event types: https://docs.github.com/en/rest/using-the-rest-api/issue-event-types
- REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- REST best practices (conditional requests, polling): https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- GraphQL rate and node limits: https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api
- Changelog "Dependencies on issues" (GA, 2025-08-21): https://github.blog/changelog/2025-08-21-dependencies-on-issues/
- Changelog "GraphQL API resource limits" (2025-09-01): https://github.blog/changelog/2025-09-01-graphql-api-resource-limits/
- Creating issue dependencies (docs source): https://github.com/github/docs/blob/main/content/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies.md
- Linking a PR to an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- Webhook events: https://docs.github.com/en/webhooks/webhook-events-and-payloads (#issue_dependencies, #issues, #pull_request)
- GitHub App permissions: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps and https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app

Verification: every query in this note was run live on 2026-09-04 with `gh api graphql` / `gh api` (user token, read-only, public repos `cli/cli`, `github/docs`, `ndelangen/dunezone`). "Observed" marks behaviour seen in those runs that the docs do not state.

## 1. Reading "blocked by" dependencies

### 1.1 GraphQL (recommended)

Fields on `Issue` (schema):

```graphql
blockedBy(after: String, before: String, first: Int, last: Int,
          orderBy: IssueDependencyOrder = {field: DEPENDENCY_ADDED_AT, direction: DESC}): IssueConnection!
blocking(...same args...): IssueConnection!
issueDependenciesSummary: IssueDependenciesSummary!
```

```graphql
type IssueDependenciesSummary {
  blockedBy: Int!        # "Count of issues this issue is blocked by"
  blocking: Int!         # "Count of issues this issue is blocking"
  totalBlockedBy: Int!   # "Total count of issues this issue is blocked by (open and closed)"
  totalBlocking: Int!    # "Total count of issues this issue is blocking (open and closed)"
}
enum IssueDependencyOrderField { CREATED_AT  DEPENDENCY_ADDED_AT }
```

Timeline items (schema, `IssueTimelineItemsItemType`): `BLOCKED_BY_ADDED_EVENT`, `BLOCKED_BY_REMOVED_EVENT`, `BLOCKING_ADDED_EVENT`, `BLOCKING_REMOVED_EVENT`. `BlockedByAddedEvent { actor, blockingIssue: Issue, createdAt, id }`.

History (GraphQL changelog 2025): 2025-07-30 "Field blockedBy was added to object type Issue", "Field blocking ...", "Field issueDependenciesSummary ...", plus `addBlockedBy` / `removeBlockedBy` mutations. 2025-08-14: the four timeline event types. 2025-10-15: `totalBlockedBy`, `totalBlocking`.

No preview header, no plan gate:
- `grep '@preview'` over the `Issue` type in the schema returns nothing; the fields are in the public (fpt) schema.
- Docs frontmatter (creating-issue-dependencies.md): "Issue dependencies are available for users on GitHub Free, GitHub Pro, GitHub Team, and GitHub Enterprise Cloud plans." Versions: `fpt: '*'`, `ghec: '*'`.
- GA 2025-08-21: "Dependencies on issues are now generally available! ... Issue dependencies are fully supported in the API and webhooks." Limit: "link up to 50 issues for each relationship type."

Minimal query (verified, cost 1):

```graphql
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      issueDependenciesSummary { blockedBy totalBlockedBy }
      blockedBy(first: 50) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { id number title url state repository { nameWithOwner } }
      }
    }
  }
}
```

Observed on `ndelangen/dunezone#1014`: `issueDependenciesSummary {blockedBy: 3, totalBlockedBy: 4}` while `blockedBy(first: 50)` returned `totalCount: 4` with one node `state: CLOSED`. So the `blockedBy` connection returns closed blockers too; Atlas must filter `state == OPEN` itself (or trust `issueDependenciesSummary.blockedBy` as the open count).

Pagination: the 50-per-relationship limit means `first: 50` fetches everything today; still honour `pageInfo.hasNextPage` / `after`.

Cross-repository: docs do not state whether a blocker can live in another repository (checked creating-issue-dependencies.md and the changelog). The webhook payload carries `blocking_issue_repo` and REST returns `repository_url` per blocker, so treat the blocker's repo as data: always read `repository { nameWithOwner }`.

### 1.2 REST

From https://docs.github.com/en/rest/issues/issue-dependencies :

| Method | Path | Notes |
|---|---|---|
| GET | `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` | query `per_page` (default 30, max 100), `page` (default 1). 200/301/404/410. Returns an array of Issue objects. |
| GET | `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking` | same shape |
| POST | `.../dependencies/blocked_by` body `{issue_id}` | 201; "Issues" (write) |
| DELETE | `.../dependencies/blocked_by/{issue_id}` | 200; "Issues" (write) |

Token requirements (same page): "The fine-grained token must have the following permission set: 'Issues' repository permissions (read). This endpoint can be used without authentication or the aforementioned permissions if only public resources are requested." Works with "GitHub App user access tokens, GitHub App installation access tokens, Fine-grained personal access tokens". Examples use `X-GitHub-Api-Version: 2026-03-10`; a live call with `2022-11-28` also returned 200 (observed). No preview header.

GitHub App permission table (permissions-required-for-github-apps): `GET .../dependencies/blocked_by` -> Issues, read, UAT+IAT; `GET .../dependencies/blocking` -> Issues, read.

Every REST Issue object (get, list, search, and the blocked_by array items) carries `issue_dependencies_summary: { blocked_by, blocking, total_blocked_by, total_blocking }` (documented on "Get an issue"; verified live on `dunezone#1022` -> `{blocked_by: 2, blocking: 1, total_blocked_by: 2, total_blocking: 1}`). There is no `blocked_by` array on the Issue object itself; it needs the separate endpoint. REST therefore costs 1 request per spec per poll for blockers; GraphQL folds it into the list query (section 3).

### 1.3 Webhook

`issue_dependencies` event (webhook-events-and-payloads#issue_dependencies): "This event occurs when there is activity relating to issue dependencies, such as blocking or blocked-by relationships." Actions: `blocked_by_added`, `blocked_by_removed`, `blocking_added`, `blocking_removed`. App needs "at least read-level access for the 'Issues' repository permissions". Payload: `blocked_issue_id`, `blocked_issue`, `blocking_issue_id`, `blocking_issue`, `blocking_issue_repo`. A blocker closing arrives as a normal `issues` `closed` event on the blocker itself.

## 2. Reading PRs linked to an issue

### 2.1 GraphQL (the only API that exposes closing references)

`Issue` field (schema):

```graphql
closedByPullRequestsReferences(
  after: String, before: String, first: Int, last: Int,
  excludeUserLinked: Boolean = false,   # "Exclude manually linked PRs"
  includeClosedPrs: Boolean = false,    # "Include closed PRs in results"
  orderByState: Boolean = false,        # "Return results ordered by state"
  userLinkedOnly: Boolean = false       # "Return only manually linked PRs"
): PullRequestConnection
```

Description: "List of open pull requests referenced from this issue". The `excludeUserLinked` / `userLinkedOnly` arguments show it covers both keyword closing references and manual "Development" sidebar links.

`PullRequest` fields (schema): `isDraft: Boolean!` ("Identifies if the pull request is a draft."), `merged: Boolean!` ("Whether or not the pull request was merged."), `mergedAt: DateTime`, `state: PullRequestState!` with `enum PullRequestState { CLOSED MERGED OPEN }`, plus `closed`, `closedAt`, `headRefName`, `headRefOid`, `url`, `updatedAt`, `repository { nameWithOwner }`. Draft and merged state come back in the same query as the issue; verified.

Reverse direction, on `PullRequest`: `closingIssuesReferences(after, before, first, last, excludeUserLinked = false, userLinkedOnly = false, orderBy: IssueOrder): IssueConnection`.

Observed default semantics (not documented): with `includeClosedPrs` omitted, `cli/cli#14064` returned `totalCount: 0` while `includeClosedPrs: true` returned its 5 `CLOSED` unmerged PRs; yet closed issue `cli/cli#5299` returned its `MERGED` PR #7246 even with the default. So the default hides closed-unmerged PRs but not merged ones. Atlas should always pass `includeClosedPrs: true` and decide from `state` / `merged` itself (map rule: PR closed unmerged re-enables Implement; merged = done).

Query for one issue (verified, cost 1):

```graphql
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id number title url isDraft state merged mergedAt closedAt updatedAt
          headRefName headRefOid repository { nameWithOwner }
        }
      }
    }
  }
}
```

Timeline alternative: `timelineItems(itemTypes: [CONNECTED_EVENT, DISCONNECTED_EVENT, CROSS_REFERENCED_EVENT])`. `CrossReferencedEvent` has `willCloseTarget: Boolean!`, `source`, `target`; `ConnectedEvent` has `source`, `subject`. Observed: `cli/cli#14064` (5 keyword-linked PRs) had `totalCount: 0` ConnectedEvents, so timeline events are not a substitute for `closedByPullRequestsReferences`.

### 2.2 REST

No REST endpoint returns closing references. The REST timeline exposes `connected` ("The issue or pull request was linked to another issue or pull request."), `disconnected`, and `cross-referenced` ("... was referenced from another issue or pull request.", timeline API only) events, without a will-close flag (issue-event-types page). Use GraphQL.

### 2.3 Linking rules that affect the agent's PR

From linking-a-pull-request-to-an-issue: keywords `close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved` + `#N` (or `OWNER/REPO#N`); "The special keywords in a pull request description are interpreted only when the pull request targets the repository's default branch." Manual linking: "up to ten issues" per PR via the Development sidebar. "When you merge a linked pull request into the default branch of a repository, its linked issue is automatically closed."

### 2.4 Webhooks

`pull_request` actions include `opened`, `edited` (body keyword changes), `closed`, `converted_to_draft`, `ready_for_review`, `reopened`. For `closed`: "If the action is closed and the merged key is false, the pull request was closed with unmerged commits. If the action is closed and the merged key is true, the pull request was merged." The `issues` event has no link/unlink action (its list: assigned, closed, deleted, demilestoned, edited, field_added, field_removed, labeled, locked, milestoned, opened, pinned, reopened, transferred, typed, unassigned, unlabeled, unlocked, unpinned, untyped). Manual sidebar link changes therefore have no dedicated webhook (unverified whether any other event fires); a reconcile poll covers them.

## 3. One query per repo: open `spec` issues with blockers and linked PRs

`Repository.issues(after, before, first, last, filterBy: IssueFilters, labels: [String!], orderBy: IssueOrder, states: [IssueState!]): IssueConnection!` (schema). Returns issues only, never PRs (unlike REST list issues). `IssueFilters.since: DateTime` = "List issues that have been updated at or after the given date."

```graphql
# variables: {"owner": "...", "name": "...", "labels": ["spec"], "after": null}
fragment SpecFields on Issue {
  id number title url state stateReason updatedAt
  issueDependenciesSummary { blockedBy totalBlockedBy }
  blockedBy(first: 50) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes { id number title url state repository { nameWithOwner } }
  }
  closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id number title url isDraft state merged mergedAt closedAt updatedAt
      headRefName headRefOid repository { nameWithOwner }
    }
  }
}

query SpecsForProject($owner: String!, $name: String!, $labels: [String!]!, $after: String) {
  rateLimit { cost limit remaining resetAt nodeCount }
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, states: OPEN, labels: $labels,
           orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...SpecFields }
    }
  }
}
```

Pagination: loop on `issues.pageInfo.hasNextPage` with `after = endCursor`. Inner connections almost never page (blockers are capped at 50; 20 linked PRs is generous); if an inner `hasNextPage` is true, fetch that one issue with the section 1.1 / 2.1 queries and its cursor.

Several projects in one HTTP request: alias `repository` (`r0: repository(owner:"a", name:"b") { issues(...) {...} }`, `r1: ...`). Verified with 3 repos in one call.

Measured costs (`rateLimit.cost` / `nodeCount`, live):

| Query | cost (points) | nodeCount |
|---|---|---|
| 1 repo, `issues(first: 50)` + blockedBy(50) + PRs(20) | 1 | 3,550 |
| 1 repo, `issues(first: 100)` + blockedBy(50) + PRs(20) | 2 | 7,100 |
| 3 repos aliased, each `first: 100` | 6 | 21,300 |

This matches the documented formula: "Add up the number of requests needed to fulfill each unique connection in the call. Assume every request will reach the first or last argument limits. Divide the number by 100 and round the result to the nearest whole number." Here 1 + 100 + 100 = 201 -> 2 points per repo page of 100.

Incremental variant: `filterBy: {since: $lastPollAt}` cuts the page to recently updated specs, but it is unverified whether a blocker closing or a linked PR changing draft/merge state bumps the spec's `updatedAt`. Do not rely on `since` for blocker or PR state; use it only as an optimisation on top of a periodic full reconcile.

## 4. Rate limits and the poll budget

GraphQL primary limit (rate-limits-and-node-limits page): "5,000 points per hour per user"; GitHub App installations (non-Enterprise): "5,000 points per hour per installation", "another 50 points per hour for each repository" beyond 20 and "for each user" beyond 20, capped at "12,500 points per hour"; Enterprise Cloud installations 10,000. "The REST API also has a separate primary rate limit." Node limit: "Individual calls cannot request more than 500,000 total nodes"; "Values of first and last must be within 1-100". Check cost with "the cost field on the rateLimit object" (free to include).

GraphQL secondary limits (same page): "No more than 100 concurrent requests", "No more than 2,000 points per minute", "No more than 90 seconds of CPU time per 60 seconds of real time", content creation "no more than 80 content-generating requests per minute and no more than 500 per hour".

REST primary limit: PAT "5,000 requests per hour"; App installation 5,000/hour with the same +50/repo, +50/user scaling capped at 12,500; unauthenticated 60/hour. Headers `x-ratelimit-limit`, `-remaining`, `-used`, `-reset`, `-resource`. Secondary: 100 concurrent, "No more than 900 points per minute" per endpoint, 90 s CPU per 60 s. Conditional requests: "Making a conditional request does not count against your primary rate limit if a 304 response is returned" (REST only; GraphQL is POST with no ETag support documented).

Resource limits (changelog 2025-09-01): GraphQL queries that are too expensive get "partial responses accompanied by errors indicating that resource limits were exceeded"; thresholds are not disclosed. The queries above (<= 21,300 nodes, cost <= 6) are far from the patterns it warns about.

Back-of-envelope, one GitHub App installation (5,000 points/hour), 5 projects, <= 100 open specs each, page size 100:

| Poll interval | Points per poll | Points per hour | Share of 5,000 |
|---|---|---|---|
| 60 s | 5 x 2 = 10 | 600 | 12% |
| 30 s | 10 | 1,200 | 24% |
| 15 s | 10 | 2,400 | 48% |
| 10 s | 10 | 3,600 | 72% |

Using `first: 50` when a project has <= 50 open specs halves this (1 point per repo). Floor: even 5 repos at 1 point each every 10 s is 1,800/hour. Secondary limit of 2,000 points/minute is irrelevant at these sizes. REST for the same data would be 1 list call + 1 blocked_by call per spec per poll (and no linked-PR data at all), so GraphQL is both required and cheaper.

Best practice (REST best-practices page): "You should subscribe to webhook events instead of polling the API for data." Map.md already fixes Phase 1 as a GitHub App with webhooks; the poll is the reconcile path. Suggested split: webhooks (`issues`, `issue_dependencies`, `pull_request`) drive updates; a full reconcile poll of the section 3 query every 60 s (600 points/hour for 5 repos) catches manual sidebar links and missed deliveries. Include `rateLimit { remaining resetAt }` in every poll and back off when `remaining` drops below a floor.

Permissions for the App: "Issues" read (dependencies endpoints, issue_dependencies webhook) and "Pull requests" read (PR data). GitHub's guidance for GraphQL: "For GraphQL requests, you should test your app to ensure that it has the required permissions" and "The success of an API request with an installation access token only depends on the app's permissions." Not verified with an installation token here (user token used).

## 5. Not verified

- Whether a blocker may live in a different repository / organisation (docs silent). Design for it: blockers carry `repository { nameWithOwner }`.
- The default (`includeClosedPrs: false`) semantics of `closedByPullRequestsReferences` are observed, not documented. Always pass `includeClosedPrs: true`.
- Whether any webhook fires when a PR is manually linked/unlinked in the sidebar. The `issues` event action list has none.
- Whether a blocker's state change or a linked PR's state change updates the spec's `updatedAt` (affects `filterBy.since`).
- Installation-token behaviour of these GraphQL fields (tests ran with a user token; permissions table covers the REST equivalents).
- GitHub Enterprise Server availability (docs versions list only `fpt` and `ghec`; Atlas targets github.com).
