import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { type GitHubClient, type GitHubPullRequest, type GitHubRepository } from "../src/github.ts";
import { createPersistence, type PullRequestInput, type SessionTarget, type SpecInput } from "../src/persistence.ts";
import { createRefreshCoordinator } from "../src/sync.ts";
import { targetObservation } from "../src/views.ts";

const root = mkdtempSync("/tmp/opencode/atlas-issue35-");
const repository = {
  githubId: "3500",
  installationId: "installation-35",
  organization: "Atlas",
  owner: "Atlas",
  name: "transition-fixture",
  fullName: "Atlas/transition-fixture",
  htmlUrl: "https://github.com/Atlas/transition-fixture",
  description: null,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
};
const candidate: GitHubRepository = { id: repository.githubId, ...repository };
const sha = (letter: string) => letter.repeat(40);
const spec = (number: string): SpecInput => ({
  githubId: `spec-${number}`,
  issueNumber: number,
  title: `Transition Spec ${number}`,
  body: "fixture",
  htmlUrl: `https://github.com/Atlas/transition-fixture/issues/${number}`,
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: null,
});
const pullRequest = (
  id: string,
  number: string,
  headRef: string,
  baseRef = "main",
  overrides: Partial<PullRequestInput> = {},
): PullRequestInput => ({
  githubId: id,
  number,
  title: `Pull request ${number}`,
  htmlUrl: `https://github.com/Atlas/transition-fixture/pull/${number}`,
  state: "open",
  draft: false,
  mergedAt: null,
  headRef,
  headSha: sha(headRef.slice(-1) || "a"),
  headRepositoryId: repository.githubId,
  baseRef,
  baseSha: sha(baseRef.slice(-1) || "b"),
  mergeableState: "clean",
  autoMergeEnabled: false,
  mergeQueueState: "none",
  headRefExists: true,
  observedHeadSha: sha(headRef.slice(-1) || "a"),
  updatedAt: null,
  ...overrides,
});
const stack = (id: string, number: string, members: string[], trunkRef = "main") => ({
  githubId: id,
  nodeId: null,
  number,
  trunkRef,
  open: true,
  members: members.map((pullRequestId, index) => ({ pullRequestId, position: index + 1 })),
});
const target = (kind: SessionTarget["kind"], id: string): SessionTarget => kind === "native_stack"
  ? { kind, stackId: id }
  : { kind, parentPullRequestId: id };

const queue = (
  persistence: ReturnType<typeof createPersistence>,
  sessionId: string,
  issueNumber: string,
  sessionTarget: SessionTarget,
  order: number,
) => {
  const result = persistence.queueSession({
    atlasId: sessionId,
    repositoryId: repository.githubId,
    spec: persistence.getSpec(repository.githubId, issueNumber)!,
    submissionId: `submission-${sessionId}`,
    submissionOrderTime: new Date(2026, 0, 1, 0, 0, order).toISOString(),
    prompt: `Prompt ${sessionId}`,
    targetKind: sessionTarget.kind,
    targetBranch: sessionTarget.kind === "native_stack" ? "top" : sessionTarget.kind === "standalone_parent" ? "parent" : "main",
    target: sessionTarget,
  });
  assert.equal(result.kind, "created");
};

const claim = (
  persistence: ReturnType<typeof createPersistence>,
  sessionId: string,
  sessionTarget: SessionTarget,
  layers: Array<{ id: string; number: string; branch: string }>,
  capacity = 4,
) => {
  const top = layers[layers.length - 1];
  const result = persistence.claimPreparation(sessionId, {
    directory: join(root, sessionId),
    baseBranch: top?.branch ?? "main",
    baseSha: sha(top?.branch.slice(-1) || "a"),
    workingBranch: `atlas/${sessionId}`,
    target: sessionTarget,
    resolvedTarget: {
      kind: sessionTarget.kind,
      stackId: sessionTarget.stackId ?? null,
      stackNumber: sessionTarget.stackNumber ?? null,
      parentPullRequestId: top?.id ?? null,
      parentPullRequestNumber: top?.number ?? null,
      parentPullRequestUrl: top ? `https://github.com/Atlas/transition-fixture/pull/${top.number}` : null,
      parentBranch: top?.branch ?? "main",
      trunkBranch: "main",
      layers: layers.map((layer) => ({
        pullRequestId: layer.id,
        pullRequestNumber: layer.number,
        branch: layer.branch,
        sha: sha(layer.branch.slice(-1) || "a"),
      })),
    },
  }, capacity, true);
  return result;
};

const initialPullRequests = [
  pullRequest("pr-a1", "1", "a1"),
  pullRequest("pr-a2", "2", "a2", "a1"),
  pullRequest("pr-b1", "3", "b1"),
  pullRequest("pr-b2", "4", "b2", "b1"),
  pullRequest("pr-standalone", "5", "standalone"),
];

const persistence = createPersistence({ path: ":memory:" });
persistence.upsertRepository(repository);
persistence.replaceSpecs(repository.githubId, ["101", "102", "103", "104", "105"].map(spec));
persistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("stack-a", "10", ["pr-a1", "pr-a2"]),
  stack("stack-b", "11", ["pr-b1", "pr-b2"]),
]);

queue(persistence, "ses-owner-a", "101", target("native_stack", "stack-a"), 1);
queue(persistence, "ses-owner-b", "102", target("native_stack", "stack-b"), 2);
assert(claim(persistence, "ses-owner-a", target("native_stack", "stack-a"), [
  { id: "pr-a1", number: "1", branch: "a1" },
  { id: "pr-a2", number: "2", branch: "a2" },
]));
assert(claim(persistence, "ses-owner-b", target("native_stack", "stack-b"), [
  { id: "pr-b1", number: "3", branch: "b1" },
  { id: "pr-b2", number: "4", branch: "b2" },
]));

// Two independently reserved stacks converge. Evidence, owners and original
// order remain durable; the replacement stack number is allowed to be reused.
persistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("stack-converged", "10", ["pr-a2", "pr-b1"]),
]);
const conflictHolds = persistence.database.query(`
  SELECT reservation_id FROM reservation_conflict_holds
  WHERE repository_id = ? AND stack_id = ?
  ORDER BY reservation_id
`).all(repository.githubId, "stack-converged") as Array<{ reservation_id: string }>;
assert.equal(conflictHolds.length, 2, "both owners retain a conflict hold after convergence");
assert.equal(persistence.listPrStacks(repository.githubId, false).length, 3, "recreated stack identity is retained separately");

queue(persistence, "ses-converged-waiter", "103", target("native_stack", "stack-converged"), 3);
assert.equal(claim(persistence, "ses-converged-waiter", target("native_stack", "stack-converged"), [
  { id: "pr-a2", number: "2", branch: "a2" },
  { id: "pr-b1", number: "3", branch: "b1" },
]), undefined, "new admission is blocked by both converged owners");
assert.equal(persistence.getSession("ses-converged-waiter")?.admissionBlocked, true);

// Releasing one owner removes only that owner's hold. The second owner still
// blocks the same target until its own terminal release.
persistence.reconcileOpenCode("ses-owner-a", "succeeded", "controlled terminal fixture");
assert.equal(persistence.releaseReservation("ses-owner-a").kind, "released");
assert.equal((persistence.database.query(`SELECT COUNT(*) AS count FROM reservation_conflict_holds WHERE stack_id = ?`).get("stack-converged") as { count: number }).count, 1);
assert.equal(claim(persistence, "ses-converged-waiter", target("native_stack", "stack-converged"), [
  { id: "pr-a2", number: "2", branch: "a2" },
  { id: "pr-b1", number: "3", branch: "b1" },
]), undefined, "one remaining owner continues to block admission");
persistence.reconcileOpenCode("ses-owner-b", "succeeded", "controlled terminal fixture");
assert.equal(persistence.releaseReservation("ses-owner-b").kind, "released");
assert(claim(persistence, "ses-converged-waiter", target("native_stack", "stack-converged"), [
  { id: "pr-a2", number: "2", branch: "a2" },
  { id: "pr-b1", number: "3", branch: "b1" },
]));

// A queued standalone parent joining a native stack follows the explicit
// stack identity and top, while its original target/order remain intact.
queue(persistence, "ses_00000000-0000-4000-8000-000000000104", "104", target("standalone_parent", "pr-standalone"), 4);
persistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("stack-joined", "12", ["pr-standalone"]),
  stack("stack-converged", "10", ["pr-a2", "pr-b1"]),
]);
const joined = persistence.getSession("ses_00000000-0000-4000-8000-000000000104")!;
assert.equal(joined.targetKind, "native_stack");
assert.equal(joined.targetStackId, "stack-joined");
assert.equal(joined.originalTargetKind, "standalone_parent");

// The selected stack disappears. The queued request is paused for explicit
// reconfirmation, never silently moved to the replacement identity.
persistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("stack-recreated", "12", ["pr-standalone"]),
  stack("stack-converged", "10", ["pr-a2", "pr-b1"]),
]);
const disappeared = persistence.getSession("ses_00000000-0000-4000-8000-000000000104")!;
assert.equal(disappeared.targetStackId, "stack-joined");
assert.equal(disappeared.admissionBlocked, true);
assert.match(disappeared.stateReason ?? "", /reconfirmation/u);
assert.equal(claim(persistence, "ses_00000000-0000-4000-8000-000000000104", target("native_stack", "stack-joined"), [
  { id: "pr-standalone", number: "5", branch: "standalone" },
]), undefined, "a vanished target cannot resume without explicit reconfirmation");

// One retained owner can affect two successor stacks after a split. Each
// successor waits on the same owner, without recursively retaining unrelated PRs.
const splitPersistence = createPersistence({ path: ":memory:" });
splitPersistence.upsertRepository(repository);
splitPersistence.replaceSpecs(repository.githubId, [spec("106"), spec("107"), spec("108")]);
splitPersistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("split-original", "22", ["pr-a1", "pr-a2", "pr-b1", "pr-b2"]),
]);
queue(splitPersistence, "ses-split-owner", "106", target("native_stack", "split-original"), 1);
assert(claim(splitPersistence, "ses-split-owner", target("native_stack", "split-original"), [
  { id: "pr-a1", number: "1", branch: "a1" },
  { id: "pr-a2", number: "2", branch: "a2" },
  { id: "pr-b1", number: "3", branch: "b1" },
  { id: "pr-b2", number: "4", branch: "b2" },
]));
splitPersistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("split-successor-a", "23", ["pr-a1", "pr-a2"]),
  stack("split-successor-b", "24", ["pr-b1", "pr-b2"]),
]);
queue(splitPersistence, "ses-split-waiter-a", "107", target("native_stack", "split-successor-a"), 2);
queue(splitPersistence, "ses-split-waiter-b", "108", target("native_stack", "split-successor-b"), 3);
assert.equal(claim(splitPersistence, "ses-split-waiter-a", target("native_stack", "split-successor-a"), [
  { id: "pr-a1", number: "1", branch: "a1" },
  { id: "pr-a2", number: "2", branch: "a2" },
]), undefined, "the first split successor remains owned");
assert.equal(claim(splitPersistence, "ses-split-waiter-b", target("native_stack", "split-successor-b"), [
  { id: "pr-b1", number: "3", branch: "b1" },
  { id: "pr-b2", number: "4", branch: "b2" },
]), undefined, "the retained owner also affects the second split successor");
assert.equal(splitPersistence.getSession("ses-split-waiter-a")?.admissionBlocked, true);
assert.equal(splitPersistence.getSession("ses-split-waiter-b")?.admissionBlocked, true);

persistence.replacePullRequests(repository.githubId, initialPullRequests, [
  stack("split-a", "20", ["pr-a2"]),
  stack("split-b", "21", ["pr-b1"]),
]);
queue(persistence, "ses-split-a", "105", target("native_stack", "split-a"), 5);
assert.equal(claim(persistence, "ses-split-a", target("native_stack", "split-a"), [{ id: "pr-a2", number: "2", branch: "a2" }]), undefined);

// Unknown retained evidence pauses the affected target instead of treating a
// missing PR as standalone or released.
const unknownPersistence = createPersistence({ path: ":memory:" });
unknownPersistence.upsertRepository(repository);
unknownPersistence.replaceSpecs(repository.githubId, [spec("201"), spec("202")]);
unknownPersistence.replacePullRequests(repository.githubId, [pullRequest("pr-a1", "1", "a1")], [stack("unknown-stack", "30", ["pr-a1"])]);
queue(unknownPersistence, "ses-unknown-owner", "201", target("native_stack", "unknown-stack"), 1);
assert(claim(unknownPersistence, "ses-unknown-owner", target("native_stack", "unknown-stack"), [{ id: "pr-a1", number: "1", branch: "a1" }], 2));
queue(unknownPersistence, "ses-unknown-waiter", "202", target("native_stack", "unknown-stack"), 2);
unknownPersistence.replacePullRequests(repository.githubId, [], []);
assert.equal((unknownPersistence.database.query("SELECT evidence_unknown FROM stack_reservations WHERE session_id = ?").get("ses-unknown-owner") as { evidence_unknown: number }).evidence_unknown, 1);
assert.equal(claim(unknownPersistence, "ses-unknown-waiter", target("native_stack", "unknown-stack"), [{ id: "pr-a1", number: "1", branch: "a1" }], 2), undefined);

// Replacement publication is accepted only with the same preparation parent,
// the permanent result PR above it, fresh non-draft/open evidence, and terminal
// execution. A new stack identity is not treated as the old one.
const publicationPersistence = createPersistence({ path: ":memory:" });
publicationPersistence.upsertRepository(repository);
publicationPersistence.replaceSpecs(repository.githubId, [spec("301")]);
const publicationParent = pullRequest("pr-parent", "40", "parent");
publicationPersistence.replacePullRequests(repository.githubId, [publicationParent], [stack("publication-old", "40", ["pr-parent"])]);
queue(publicationPersistence, "ses-publication", "301", target("native_stack", "publication-old"), 1);
assert(claim(publicationPersistence, "ses-publication", target("native_stack", "publication-old"), [{ id: "pr-parent", number: "40", branch: "parent" }], 2));
const publicationResult = pullRequest("pr-result", "41", "atlas/ses-publication", "parent");
publicationPersistence.replacePullRequests(repository.githubId, [publicationParent, publicationResult], [
  stack("publication-replacement", "40", ["pr-parent", "pr-result"]),
]);
assert.equal(publicationPersistence.getSession("ses-publication")?.publicationStatus, "qualifying");
publicationPersistence.reconcileOpenCode("ses-publication", "succeeded", "controlled terminal fixture");
publicationPersistence.replacePullRequests(repository.githubId, [publicationParent, publicationResult], [
  stack("publication-replacement", "40", ["pr-parent", "pr-result"]),
]);
assert.equal(publicationPersistence.getSession("ses-publication")?.reservationState, "released");

// Restart restores held ownership before any new admission.
const restartPath = join(root, "restart.sqlite");
const first = createPersistence({ path: restartPath });
first.upsertRepository(repository);
first.replaceSpecs(repository.githubId, [spec("401")]);
first.replacePullRequests(repository.githubId, [publicationParent], [stack("restart-stack", "50", ["pr-parent"])]);
queue(first, "ses-restart", "401", target("native_stack", "restart-stack"), 1);
assert(claim(first, "ses-restart", target("native_stack", "restart-stack"), [{ id: "pr-parent", number: "40", branch: "parent" }], 2));
first.close();
const afterRestart = createPersistence({ path: restartPath });
assert.equal(afterRestart.getSession("ses-restart")?.reservationState, "held");
assert.equal(afterRestart.getSession("ses-restart")?.executionSlotHeld, true);
afterRestart.close();

// The queued-target HTTP surface refreshes current projections and performs an
// explicit, identity-bound reconfirmation. The fixture client is read-only.
let currentPullRequests: PullRequestInput[] = [pullRequest("pr-standalone", "5", "standalone")];
let currentStacks = [stack("6000", "60", ["pr-standalone"])] as ReturnType<typeof stack>[];
const githubPullRequest = (input: PullRequestInput): GitHubPullRequest => ({
  id: input.githubId,
  number: input.number,
  title: input.title,
  htmlUrl: input.htmlUrl,
  state: input.state,
  draft: input.draft,
  mergedAt: input.mergedAt,
  headRef: input.headRef,
  headSha: input.headSha,
  headRepositoryId: input.headRepositoryId,
  baseRef: input.baseRef,
  baseSha: input.baseSha,
  mergeableState: input.mergeableState,
  autoMergeEnabled: input.autoMergeEnabled,
  mergeQueueState: input.mergeQueueState,
  updatedAt: input.updatedAt,
});
const github: GitHubClient = {
  listInstallationRepositories: async () => [candidate],
  hasLabel: async () => true,
  listIssues: async () => ["104"].map((number) => {
    const value = spec(number);
    return {
      id: value.githubId,
      number: value.issueNumber,
      title: value.title,
      body: value.body,
      htmlUrl: value.htmlUrl,
      state: value.state,
      labels: value.labels,
      isPullRequest: false,
      updatedAt: null,
    };
  }),
  listPullRequests: async () => currentPullRequests.map(githubPullRequest),
  listStacks: async () => currentStacks.map((value) => ({
    id: value.githubId,
    nodeId: null,
    number: value.number,
    trunkRef: value.trunkRef,
    open: value.open,
    pullRequests: value.members.map((member) => ({
      number: currentPullRequests.find((pullRequest) => pullRequest.githubId === member.pullRequestId)?.number ?? "0",
      position: member.position,
    })),
  })),
  getBranchRef: async () => ({ sha: sha("a") }),
};
const coordinator = createRefreshCoordinator({ persistence, github, organization: repository.organization, installationId: repository.installationId });
const app = createApp({
  persistence,
  sharedToken: "secret",
  github,
  githubOrganization: repository.organization,
  githubInstallationId: repository.installationId,
  refreshCoordinator: coordinator,
  globalCapacity: 1,
  sessionRoot: join(root, "http-sessions"),
  openCode: {
    start: () => undefined,
    stop: () => undefined,
    enqueue: () => undefined,
    process: async () => undefined,
    getClient: async () => { throw new Error("unused in transition fixture"); },
    onEvent: () => () => false,
    onTransport: () => () => false,
    transportState: () => "stale" as const,
  },
});
const httpTargetSession = persistence.getSession("ses_00000000-0000-4000-8000-000000000104")!;
const page = await app.fetch(new Request(`http://atlas.test/sessions/${httpTargetSession.atlasId}/target`, {
  headers: { Authorization: "Bearer secret" },
}));
assert.equal(page.status, 200);
const pageText = await page.text();
assert(pageText.includes("Reconfirm queued target"));
assert(pageText.includes("Native stack #60"));
if (Bun.env.ATLAS_ISSUE35_RENDER_PATH) await Bun.write(Bun.env.ATLAS_ISSUE35_RENDER_PATH, pageText);
const observation = targetObservation(persistence.getRepository(repository.githubId)!, persistence.listPullRequests(repository.githubId), persistence.listPrStacks(repository.githubId), { kind: "native_stack", stackId: "6000" });
const post = await app.fetch(new Request(`http://atlas.test/sessions/${httpTargetSession.atlasId}/target`, {
  method: "POST",
  headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
  body: `target=stack:6000&target_observations=${encodeURIComponent(JSON.stringify({ "stack:6000": observation }))}`,
}));
assert.equal(post.status, 303);
assert.equal(persistence.getSession(httpTargetSession.atlasId)?.targetStackId, "6000");

coordinator.stop();
splitPersistence.close();
unknownPersistence.close();
publicationPersistence.close();
persistence.close();
rmSync(root, { recursive: true, force: true });
console.log("Issue #35 controlled transition checks passed; no live GitHub mutations were performed.");
