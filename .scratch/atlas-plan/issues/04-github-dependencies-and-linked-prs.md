# 04 - GitHub issue dependencies and linked PRs: reading blocked-by and PR-to-issue links via the API
Type: research
Status: resolved
Blocked by:

## Question

1. How does Atlas read GitHub's native issue dependencies ("blocked by" / "blocking") for an issue? REST or GraphQL, exact fields, pagination, and whether the feature needs a plan or preview flag.
2. How does Atlas read the PRs linked to an issue (GitHub's own linked-PR data, e.g. closing references)? Exact GraphQL fields, and whether draft state and merge state are available in the same query.
3. How does Atlas list all open issues with label `spec` for a repository efficiently, including their blockers and linked PRs, in as few calls as possible?
4. Rate limits that apply, and how polling on a short interval fits within them for a handful of repos.

Answer with exact queries and source links.

## Answer

Research: [research/04-github-dependencies-and-linked-prs.md](../research/04-github-dependencies-and-linked-prs.md). All queries verified live 2026-09-04.

**1. Blocked by.** GraphQL `Issue.blockedBy(first: 50) { nodes { number state url repository { nameWithOwner } } pageInfo {...} }` plus `Issue.issueDependenciesSummary { blockedBy totalBlockedBy }` (open count vs open+closed). Added to the public schema 2025-07-30, GA 2025-08-21; no preview header, no plan gate (Free/Pro/Team/GHEC). Max 50 blockers per issue, so `first: 50` gets all; still check `hasNextPage`. The connection returns closed blockers too: filter `state == OPEN` in Atlas. REST equivalent: `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` (`per_page` max 100), needs "Issues" read; REST Issue objects also carry `issue_dependencies_summary`. Webhook: `issue_dependencies` (`blocked_by_added|removed`, `blocking_added|removed`).

**2. Linked PRs.** GraphQL only: `Issue.closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes { number url isDraft state merged mergedAt closedAt headRefName repository { nameWithOwner } } }`. Covers keyword closing references and manual sidebar links. `isDraft`, `merged`, `mergedAt`, `state (OPEN|CLOSED|MERGED)` come back in the same query. Always pass `includeClosedPrs: true`: the default hides closed-unmerged PRs but still returns merged ones (observed, undocumented). REST has no closing-reference endpoint. Webhooks: `pull_request` `opened|edited|closed(merged key)|converted_to_draft|ready_for_review`.

**3. One query per project.** `repository(owner, name) { issues(first: 100, states: OPEN, labels: ["spec"], orderBy: {field: UPDATED_AT, direction: DESC}, after: $after) { pageInfo { hasNextPage endCursor } nodes { ...SpecFields } } }` where the fragment carries `blockedBy(first: 50)` and `closedByPullRequestsReferences(first: 20, includeClosedPrs: true)` (full text in research section 3). Returns issues only, never PRs. Alias `repository` to batch several projects in one HTTP call.

**4. Rate limits.** GraphQL App installation: 5,000 points/hour (separate from REST's 5,000 requests/hour), secondary 2,000 points/minute, 500,000 nodes/query. Measured: 1 point per repo at `first: 50`, 2 points at `first: 100`, 3 repos aliased = 6 points, 21,300 nodes. Five projects polled every 30 s = 1,200 points/hour (24%); every 60 s = 600/hour. Webhooks drive updates; the poll is the reconcile path. Read `rateLimit { remaining resetAt }` in each poll and back off below a floor.

**Unverified:** cross-repo blocker rules (docs silent; read the blocker's repo from the data), any webhook for manual PR link/unlink, whether blocker or PR state changes bump the spec's `updatedAt` (so do not rely on `filterBy.since`), behaviour under an installation token (tests used a user token).
