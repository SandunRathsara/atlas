import "./isolate-opencode.ts";
import { strict as assert } from "node:assert";
import { createApp } from "../src/app.ts";
import { inboxCookie } from "../src/inbox-state.ts";
import { createPersistence } from "../src/persistence.ts";
import type { PullRequest, RefreshState } from "../src/persistence.ts";
import { renderPullRequestsPage } from "../src/views.ts";

const repository = {
  githubId: "1",
  installationId: "installation",
  organization: "Org",
  owner: "Org",
  name: "repo",
  fullName: "Org/repo",
  htmlUrl: "https://github.com/Org/repo",
  description: null,
  visibility: "public",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
  enrolledAt: "2026-01-01T00:00:00Z",
  removedAt: null,
  accessStatus: "available" as const,
  accessReason: null,
};

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  githubId: "pr-1",
  repositoryId: repository.githubId,
  number: "1",
  title: "PR",
  htmlUrl: "https://github.com/Org/repo/pull/1",
  state: "open",
  draft: false,
  mergedAt: null,
  headRef: "feature",
  headSha: "head",
  headRepositoryId: repository.githubId,
  baseRef: "main",
  baseSha: "base",
  mergeableState: "clean",
  autoMergeEnabled: false,
  mergeQueueState: "none",
  headRefExists: true,
  observedHeadSha: "head",
  updatedAt: null,
  observedAt: "2026-01-01T00:00:00Z",
  isCurrent: true,
  stack: null,
  ...overrides,
});

const pullRequestsRefresh = {
  repositoryId: repository.githubId,
  view: "pullRequests" as const,
  requestedGeneration: 0,
  completedGeneration: 0,
  lastSuccessAt: "2026-01-01T00:00:00Z",
  lastFailureAt: null,
  availability: "available" as const,
  failureReason: null,
};
const accessRefresh = { ...pullRequestsRefresh, view: "access" as const };
const render = (
  currentRepository = repository,
  currentPullRequests = [pullRequest()],
  currentPullRequestsRefresh: RefreshState = pullRequestsRefresh,
  currentAccessRefresh: RefreshState = accessRefresh,
) => renderPullRequestsPage({
  csrfToken: "csrf",
  repository: currentRepository,
  pullRequests: currentPullRequests,
  stacks: [],
  accessRefresh: currentAccessRefresh,
  refresh: currentPullRequestsRefresh,
});

const stale = render(repository, [pullRequest()], { ...pullRequestsRefresh, availability: "unavailable" as const });
assert(stale.includes("Waiting for verification"));
assert(!stale.includes("Eligible standalone target"));

const archived = render({ ...repository, archived: true });
assert(archived.includes("Not eligible"));
assert(!archived.includes("Eligible standalone target"));

const disabled = render({ ...repository, disabled: true });
assert(disabled.includes("Not eligible"));
assert(!disabled.includes("Eligible standalone target"));

const fork = render(repository, [pullRequest({ headRepositoryId: "2" })]);
assert(fork.includes("head belongs to another Repository"));
assert(!fork.includes("Eligible standalone target"));

const persistence = createPersistence({ path: ":memory:" });
persistence.upsertRepository(repository);
persistence.replacePullRequests(repository.githubId, [pullRequest()], [{
  githubId: "stack-1",
  nodeId: null,
  number: "5",
  trunkRef: "main",
  open: true,
  members: [],
}]);
persistence.upsertRepository({ ...repository, githubId: "2", name: "other", fullName: "Org/other" });
assert.doesNotThrow(
  () => persistence.replacePullRequests(repository.githubId, [pullRequest({ githubId: "pr-2", number: "2" })], [{
    githubId: "stack-2",
    nodeId: null,
    number: "5",
    trunkRef: "main",
    open: true,
    members: [],
  }]),
);
assert.equal(persistence.listPrStacks(repository.githubId, false).length, 2, "recreated native stack identities may reuse a Repository-scoped number");
assert.throws(() => persistence.replacePullRequests("2", [pullRequest()], []), /cannot move/i);
assert.throws(
  () => persistence.replacePullRequests("2", [], [{
    githubId: "stack-1",
    nodeId: null,
    number: "5",
    trunkRef: "main",
    open: true,
    members: [],
  }]),
  /cannot move/i,
);
persistence.close();

let refCalls = 0;
const githubRepository = {
  id: repository.githubId,
  owner: repository.owner,
  name: repository.name,
  fullName: repository.fullName,
  htmlUrl: repository.htmlUrl,
  description: null,
  visibility: "public",
  defaultBranch: repository.defaultBranch,
  archived: false,
  disabled: false,
  hasIssues: true,
};
const github = {
  listInstallationRepositories: async () => [githubRepository],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [{
    id: "fork-pr",
    number: "3",
    title: "Fork PR",
    htmlUrl: "https://github.com/Org/repo/pull/3",
    state: "open",
    draft: false,
    mergedAt: null,
    headRef: "feature",
    headSha: "fork-head",
    headRepositoryId: "2",
    baseRef: "main",
    baseSha: "base",
    mergeableState: "clean",
    autoMergeEnabled: false,
    mergeQueueState: "none",
    updatedAt: null,
  }],
  listStacks: async () => [],
  getBranchRef: async () => {
    refCalls += 1;
    return { sha: "wrong-repository-ref" };
  },
};
const appPersistence = createPersistence({ path: ":memory:" });
appPersistence.upsertRepository(repository);
const app = createApp({
  persistence: appPersistence,
  sharedToken: "secret",
  github,
  githubOrganization: repository.organization,
  githubInstallationId: repository.installationId,
});
const response = await app.fetch(new Request("http://atlas.test/repositories/1/pull-requests", {
  headers: { Authorization: "Bearer secret" },
}));
const body = await response.text();
assert.equal(response.status, 200);
assert.equal(refCalls, 0);
assert(body.includes("head belongs to another Repository"));
assert(!body.includes("Eligible standalone target"));

// Cross-Repository Pull requests tab: auth required, last-seen data only, frame filter honoured.
const unauthenticated = await app.fetch(new Request("http://atlas.test/pull-requests"));
assert.notEqual(unauthenticated.status, 200);
assert(!(await unauthenticated.text()).includes("Fork PR"));
appPersistence.upsertRepository({ ...repository, githubId: "2", name: "other", fullName: "Org/other" });
appPersistence.replacePullRequests("2", [pullRequest({ githubId: "other-pr", repositoryId: "2", headRepositoryId: "2", number: "9", title: "Other PR" })], []);
appPersistence.upsertRepository({ ...repository, githubId: "3", name: "gone", fullName: "Org/gone" });
appPersistence.replacePullRequests("3", [pullRequest({ githubId: "gone-pr", repositoryId: "3", headRepositoryId: "3", number: "4", title: "Removed Repository PR" })], []);
appPersistence.removeRepository("3");
const callsBefore = refCalls;
const all = await app.fetch(new Request("http://atlas.test/pull-requests", { headers: { Authorization: "Bearer secret" } }));
const allBody = await all.text();
assert.equal(all.status, 200);
assert.equal(refCalls, callsBefore, "the cross-Repository page reads stored data only");
assert(allBody.includes('data-page-heading'));
assert(allBody.includes("Fork PR") && allBody.includes("Other PR"));
assert(allBody.includes("head belongs to another Repository"));
assert(allBody.includes('href="/repositories/1/pull-requests"') && allBody.includes('href="/repositories/2/pull-requests"'));
assert(!allBody.includes("Removed Repository PR"), "removed Repositories are omitted");
const filterCookie = inboxCookie("2").split(";")[0]!;
const filteredAll = await app.fetch(new Request("http://atlas.test/pull-requests", {
  headers: { Authorization: "Bearer secret", Cookie: filterCookie },
}));
const filteredBody = await filteredAll.text();
assert.equal(filteredAll.status, 200);
assert(filteredBody.includes("Other PR"));
assert(!filteredBody.includes("Fork PR"), "the Repository filter limits the page to one Repository");
appPersistence.close();

const eligible = render();
assert(eligible.includes("Eligible standalone target"), "an eligible standalone PR says so");
assert(eligible.includes('data-target-status="eligible"'));
const emptyPage = render(repository, []);
assert(emptyPage.includes("No open pull requests"));
const unverifiedEmpty = render(repository, [], { ...pullRequestsRefresh, availability: "unavailable" as const });
assert(!unverifiedEmpty.includes("No open pull requests"), "a failed read is not shown as an empty list");
assert(unverifiedEmpty.includes("Couldn’t check GitHub just now"));

console.log("Issue #25 defect checks passed");
