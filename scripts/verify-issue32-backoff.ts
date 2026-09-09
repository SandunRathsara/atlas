import { strict as assert } from "node:assert";
import { createApp } from "../src/app.ts";
import { GitHubError, type GitHubClient, type GitHubRepository } from "../src/github.ts";
import { createPersistence } from "../src/persistence.ts";
import { createRefreshCoordinator } from "../src/sync.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (predicate()) return;
    await wait(10);
  }
  assert.fail(message);
};

const repository: GitHubRepository = {
  id: "7007",
  owner: "Org",
  name: "backoff-repo",
  fullName: "Org/backoff-repo",
  htmlUrl: "https://github.com/Org/backoff-repo",
  description: null,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
};
const spec = {
  githubId: "issue-7007",
  issueNumber: "70",
  title: "Backoff Spec",
  body: "Current body",
  htmlUrl: "https://github.com/Org/backoff-repo/issues/70",
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: null,
};
const queuedSessionId = "ses_00000000-0000-4000-8000-000000007007";
const persistence = createPersistence({ path: ":memory:" });
persistence.upsertRepository({ githubId: repository.id, ...repository, installationId: "installation-1", organization: "Org" });
persistence.replaceSpecs(repository.id, [spec]);
persistence.markRefreshSuccess(repository.id, "access");
persistence.queueSession({
  atlasId: queuedSessionId,
  repositoryId: repository.id,
  spec,
  submissionId: "00000000-0000-4000-8000-000000007007",
  submissionOrderTime: "2026-01-01T00:00:00.000Z",
  prompt: "Keep this queued while the Repository is removed.",
  targetKind: "default",
  targetBranch: "main",
});
persistence.removeRepository(repository.id);

let pullRequestReads = 0;
let specReads = 0;
const github: GitHubClient = {
  listInstallationRepositories: async () => [repository],
  hasLabel: async () => true,
  listIssues: async () => {
    specReads += 1;
    return [{
      id: spec.githubId,
      number: spec.issueNumber,
      title: spec.title,
      body: spec.body,
      htmlUrl: spec.htmlUrl,
      state: spec.state,
      labels: spec.labels,
      isPullRequest: false,
      updatedAt: null,
    }];
  },
  listPullRequests: async () => {
    pullRequestReads += 1;
    if (pullRequestReads === 1) throw new GitHubError("temporary PR read failure", { kind: "temporary" });
    return [];
  },
  listStacks: async () => [],
  getBranchRef: async () => ({ sha: "a".repeat(40) }),
};
const coordinator = createRefreshCoordinator({
  persistence,
  github,
  organization: "Org",
  installationId: "installation-1",
});

coordinator.request(repository.id, ["pullRequests"]);
await waitFor(() => {
  const state = persistence.getRefreshState(repository.id, "pullRequests")!;
  return state.availability === "unavailable" && state.requestedGeneration > state.completedGeneration;
}, "PR refresh did not enter retry backoff");

const app = createApp({
  persistence,
  sharedToken: "secret",
  github,
  githubOrganization: "Org",
  githubInstallationId: "installation-1",
  refreshCoordinator: coordinator,
  openCode: {
    start: () => undefined,
    stop: () => undefined,
    enqueue: () => undefined,
    process: async () => undefined,
    getClient: async () => { throw new Error("unused in backoff check"); },
    onEvent: () => () => false,
    onTransport: () => () => false,
    transportState: () => "stale" as const,
  },
  sessionRoot: "/tmp/opencode/atlas-issue-32-backoff-sessions",
});
const auth = { Authorization: "Bearer secret" };

const readdWhileBackoff = await app.fetch(new Request("http://atlas.test/repositories", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
  body: "csrf=ignored&repository_id=7007",
}));
assert.equal(readdWhileBackoff.status, 303);
assert(persistence.getRepository(repository.id)?.removedAt, "backoff re-add must stay removed");
assert.equal(specReads, 0, "backoff re-add must not read Specs through stale cache");
assert.equal(pullRequestReads, 1);
const accessAfterBackoffReadd = persistence.getRefreshState(repository.id, "access")!;
const specsAfterBackoffReadd = persistence.getRefreshState(repository.id, "specs")!;
assert(accessAfterBackoffReadd.requestedGeneration > accessAfterBackoffReadd.completedGeneration);
assert(specsAfterBackoffReadd.requestedGeneration > specsAfterBackoffReadd.completedGeneration);

const start = await app.fetch(new Request("http://atlas.test/repositories/7007/specs/70/sessions", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
  body: "csrf=ignored&submission_id=00000000-0000-4000-8000-000000007008&prompt=Do+not+use+stale+eligibility",
}));
assert.equal(start.status, 503, "Start Session must wait for current validation during backoff");
assert.equal(persistence.listSessionsForSpec(repository.id, spec.issueNumber).length, 1, "stale eligibility must not queue another Session");
assert.equal(persistence.getSession(queuedSessionId)?.state, "queued", "removed queued work must remain queued");
assert.equal(persistence.getSession(queuedSessionId)?.executionSlotHeld, false);
assert(persistence.getRepository(repository.id)?.removedAt);

await waitFor(() => {
  const access = persistence.getRefreshState(repository.id, "access")!;
  const specs = persistence.getRefreshState(repository.id, "specs")!;
  return access.requestedGeneration <= access.completedGeneration && specs.requestedGeneration <= specs.completedGeneration;
}, "refresh backoff did not eventually complete current Access/Specs generations");
assert.equal(pullRequestReads, 2, "retry must perform the delayed PR read once");

const readdAfterCurrentSync = await app.fetch(new Request("http://atlas.test/repositories", {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
  body: "csrf=ignored&repository_id=7007",
}));
assert.equal(readdAfterCurrentSync.status, 303);
assert.equal(persistence.getRepository(repository.id)?.removedAt, null, "explicit re-add clears removal only after current validation");
assert(specReads > 0, "successful re-add must perform a current Specs read");

coordinator.stop();
persistence.close();
console.log("Issue #32 backoff/re-add/current-validation/queue check passed");
