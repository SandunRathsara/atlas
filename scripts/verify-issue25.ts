import { strict as assert } from "node:assert";
import { createApp } from "../src/app.ts";
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
appPersistence.close();

console.log("Issue #25 defect checks passed");
