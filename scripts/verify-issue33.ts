import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/app.ts";
import { createOpenCodeHandoffService, APPROVED_OPENCODE_VERSION } from "../src/opencode.ts";
import { createPersistence, type Persistence, type PreparationIntent, type PrStackInput, type PullRequestInput, type RepositoryInput, type ResolvedTarget, type SessionTarget, type SpecInput } from "../src/persistence.ts";
import { createPreparationService } from "../src/preparation.ts";
import { startTargetOptions } from "../src/views.ts";
import type { CredentialBoundary } from "../src/credentials.ts";
import type { GitHubClient, GitHubRepository } from "../src/github.ts";

const root = mkdtempSync(join(tmpdir(), "atlas-issue33-"));
const now = () => Date.parse("2026-09-06T12:00:00.000Z");
const SHA = {
  main: "1".repeat(40),
  bottom: "2".repeat(40),
  top: "3".repeat(40),
  standalone: "4".repeat(40),
  newTop: "5".repeat(40),
};

const repository: RepositoryInput = {
  githubId: "1358921749",
  installationId: "99",
  organization: "SandunRathsara",
  owner: "SandunRathsara",
  name: "atlas-issue-25-live-acceptance",
  fullName: "SandunRathsara/atlas-issue-25-live-acceptance",
  htmlUrl: "https://github.com/SandunRathsara/atlas-issue-25-live-acceptance",
  description: "fixture",
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
};

const candidate: GitHubRepository = {
  id: repository.githubId,
  owner: repository.owner,
  name: repository.name,
  fullName: repository.fullName,
  htmlUrl: repository.htmlUrl,
  description: repository.description,
  visibility: repository.visibility,
  defaultBranch: repository.defaultBranch,
  archived: false,
  disabled: false,
  hasIssues: true,
};

const spec = (number: string): SpecInput => ({
  githubId: `spec-${number}`,
  issueNumber: number,
  title: `Spec ${number}`,
  body: `Body ${number}`,
  htmlUrl: `${repository.htmlUrl}/issues/${number}`,
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: "2026-09-06T10:00:00.000Z",
});

const pr = (id: string, number: string, headRef: string, headSha: string, baseRef: string, baseSha: string): PullRequestInput => ({
  githubId: id,
  number,
  title: `PR ${number}`,
  htmlUrl: `${repository.htmlUrl}/pull/${number}`,
  state: "open",
  draft: false,
  mergedAt: null,
  headRef,
  headSha,
  headRepositoryId: repository.githubId,
  baseRef,
  baseSha,
  mergeableState: "clean",
  autoMergeEnabled: false,
  mergeQueueState: "none",
  headRefExists: true,
  observedHeadSha: headSha,
  updatedAt: "2026-09-06T10:00:00.000Z",
});

const pullRequests = [
  pr("4455223934", "1", "stack-bottom", SHA.bottom, "main", SHA.main),
  pr("4455224172", "2", "stack-top", SHA.top, "stack-bottom", SHA.bottom),
  pr("4455224480", "3", "standalone", SHA.standalone, "main", SHA.main),
  pr("4455224999", "4", "new-stack-top", SHA.newTop, "stack-top", SHA.top),
];

const stack = (members = ["4455223934", "4455224172"]): PrStackInput => ({
  githubId: "901278",
  nodeId: "PRS_fixture",
  number: "5",
  trunkRef: "main",
  open: true,
  members: members.map((pullRequestId, index) => ({ pullRequestId, position: index + 1 })),
});

const stackTarget: SessionTarget = { kind: "native_stack", stackId: "901278", stackNumber: "5" };
const resolvedStack: ResolvedTarget = {
  kind: "native_stack",
  stackId: "901278",
  stackNumber: "5",
  parentPullRequestId: "4455224172",
  parentPullRequestNumber: "2",
  parentPullRequestUrl: `${repository.htmlUrl}/pull/2`,
  parentBranch: "stack-top",
  trunkBranch: "main",
  layers: [
    { pullRequestId: "4455223934", pullRequestNumber: "1", branch: "stack-bottom", sha: SHA.bottom },
    { pullRequestId: "4455224172", pullRequestNumber: "2", branch: "stack-top", sha: SHA.top },
  ],
};

const defaultResolved: ResolvedTarget = {
  kind: "default",
  stackId: null,
  stackNumber: null,
  parentPullRequestId: null,
  parentPullRequestNumber: null,
  parentPullRequestUrl: null,
  parentBranch: "main",
  trunkBranch: "main",
  layers: [],
};

const seed = (persistence: Persistence, specs = [spec("10"), spec("11"), spec("12")], stackValue = stack()) => {
  persistence.upsertRepository(repository);
  persistence.replaceSpecs(repository.githubId, specs);
  persistence.replacePullRequests(repository.githubId, pullRequests, [stackValue]);
  for (const view of ["access", "specs", "pullRequests"] as const) persistence.markRefreshSuccess(repository.githubId, view);
};

const queue = (persistence: Persistence, index: number, target: SessionTarget, targetBranch: string) => persistence.queueSession({
  atlasId: `ses_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  repositoryId: repository.githubId,
  spec: persistence.getSpec(repository.githubId, String(9 + index))!,
  submissionId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  submissionOrderTime: new Date(now() + index).toISOString(),
  prompt: `Prompt ${index}`,
  targetKind: target.kind,
  targetBranch,
  target,
});

const stackIntent = (directory: string, resolvedTarget = resolvedStack): PreparationIntent => ({
  directory,
  baseBranch: resolvedTarget.parentBranch,
  baseSha: resolvedTarget.layers.at(-1)?.sha ?? SHA.top,
  workingBranch: `atlas/${crypto.randomUUID()}`,
  target: stackTarget,
  resolvedTarget,
});

const noRefresh = {
  refresh: async () => undefined,
  request: () => undefined,
  wake: () => undefined,
  start: () => undefined,
  stop: () => undefined,
};

const noOpenCode = {
  start: () => undefined,
  stop: () => undefined,
  enqueue: () => undefined,
  process: async () => undefined,
};

const noCredentials = (base: string) => ({
  start: async () => undefined,
  close: () => undefined,
  registerScope: () => undefined,
  resolveScope: () => undefined,
  requestToken: async () => { throw new Error("disabled"); },
  assertReady: async () => undefined,
  installationToken: async () => { throw new Error("disabled"); },
  helperEnvironment: () => ({ ATLAS_SUPPLIER_SOCKET: join(base, "supplier.sock"), ATLAS_SUPPLIER_KEY_PATH: join(base, "supplier.key") }),
}) as unknown as CredentialBoundary;

const appGithub: GitHubClient = {
  listInstallationRepositories: async () => [candidate],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [],
  listStacks: async () => [],
  getBranchRef: async () => ({ sha: SHA.main }),
};

const request = (app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) =>
  app.request(`https://atlas.test${path}`, init);

const git = (rootPath: string, args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: rootPath });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
};

try {
  // A reservation conflict blocks only that queued target; the next eligible FIFO row can claim the free slot.
  {
    const persistence = createPersistence({ path: ":memory:", now });
    seed(persistence);
    const owner = queue(persistence, 1, stackTarget, "stack-top").session;
    assert(persistence.claimPreparation(owner.atlasId, stackIntent(join(root, "owner")), 1, true));
    assert.equal(persistence.reconcileOpenCode(owner.atlasId, "succeeded", "fixture terminal")?.executionSlotHeld, false);
    const blocked = queue(persistence, 2, stackTarget, "stack-top").session;
    const unrelated = queue(persistence, 3, { kind: "default" }, "main").session;
    assert.equal(persistence.claimPreparation(blocked.atlasId, stackIntent(join(root, "blocked")), 1, true), undefined);
    assert.match(persistence.getSession(blocked.atlasId)?.stateReason ?? "", /reservation/u);
    const claimed = persistence.claimPreparation(unrelated.atlasId, {
      directory: join(root, "unrelated"),
      baseBranch: "main",
      baseSha: SHA.main,
      workingBranch: "atlas/unrelated",
      target: { kind: "default" },
      resolvedTarget: defaultResolved,
    }, 1, true);
    assert.equal(claimed?.atlasId, unrelated.atlasId);
    persistence.close();
    console.log("PASS FIFO reservation fairness");
  }

  // The form carries a structural observation, so a changed top/member projection requires reconfirmation.
  {
    const persistence = createPersistence({ path: ":memory:", now });
    seed(persistence, [spec("10")]);
    const app = createApp({
      persistence,
      refreshCoordinator: noRefresh,
      github: appGithub,
      openCode: noOpenCode,
      credentials: noCredentials(root),
      sessionRoot: join(root, "http-sessions"),
      sharedToken: "secret",
      allowedOrigin: "https://atlas.test",
      githubOrganization: repository.organization,
      githubInstallationId: repository.installationId,
    });
    const formResponse = await request(app, `/repositories/${repository.githubId}/specs/10/sessions/new`, { headers: { Authorization: "Bearer secret" } });
    const formHtml = await formResponse.text();
    assert.equal(formResponse.status, 200);
    assert(formHtml.includes('name="target_observations"'));
    const before = startTargetOptions(persistence.getRepository(repository.githubId)!, persistence.listPullRequests(repository.githubId), persistence.listPrStacks(repository.githubId), persistence.getRefreshState(repository.githubId, "access"), persistence.getRefreshState(repository.githubId, "pullRequests"));
    const observed = before.find((option) => option.value === "stack:901278")!.observation;
    const observedStandalone = before.find((option) => option.value === "parent:4455224480")!.observation;
    persistence.replacePullRequests(repository.githubId, pullRequests, [stack(["4455223934", "4455224172", "4455224480"])]);
    const response = await request(app, `/repositories/${repository.githubId}/specs/10/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        submission_id: crypto.randomUUID(),
        prompt: "Keep this prompt",
        target: "stack:901278",
        target_observations: JSON.stringify({ "stack:901278": observed }),
      }),
    });
    assert.equal(response.status, 409);
    assert.equal(persistence.listSessionsForSpec(repository.githubId, "10").length, 0);
    const standaloneResponse = await request(app, `/repositories/${repository.githubId}/specs/10/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        submission_id: crypto.randomUUID(),
        prompt: "Keep this prompt too",
        target: "parent:4455224480",
        target_observations: JSON.stringify({ "parent:4455224480": observedStandalone }),
      }),
    });
    assert.equal(standaloneResponse.status, 409);
    persistence.close();
    console.log("PASS structural target reconfirmation");
  }

  // An unchanged target observation still queues the selected target.
  {
    const persistence = createPersistence({ path: ":memory:", now });
    seed(persistence, [spec("10")]);
    const storageFile = join(root, "valid-storage-file");
    writeFileSync(storageFile, "not a directory");
    const app = createApp({
      persistence,
      refreshCoordinator: noRefresh,
      github: appGithub,
      openCode: noOpenCode,
      credentials: noCredentials(root),
      sessionRoot: storageFile,
      sharedToken: "secret",
      githubOrganization: repository.organization,
      githubInstallationId: repository.installationId,
    });
    const page = await request(app, `/repositories/${repository.githubId}/specs/10/sessions/new`, { headers: { Authorization: "Bearer secret" } });
    assert.equal(page.status, 200);
    const options = startTargetOptions(persistence.getRepository(repository.githubId)!, persistence.listPullRequests(repository.githubId), persistence.listPrStacks(repository.githubId), persistence.getRefreshState(repository.githubId, "access"), persistence.getRefreshState(repository.githubId, "pullRequests"));
    const observation = options.find((option) => option.value === "stack:901278")!.observation;
    const response = await request(app, `/repositories/${repository.githubId}/specs/10/sessions`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ submission_id: crypto.randomUUID(), prompt: "Queue this target", target: "stack:901278", target_observations: JSON.stringify({ "stack:901278": observation }) }),
    });
    assert.equal(response.status, 303);
    assert.equal(persistence.listSessionsForSpec(repository.githubId, "10")[0]?.targetStackId, "901278");
    persistence.close();
    console.log("PASS unchanged target queueing");
  }

  // Browser sign-in returns the same selected non-default target with its current options.
  {
    const persistence = createPersistence({ path: ":memory:", now });
    seed(persistence, [spec("10")]);
    const app = createApp({
      persistence,
      refreshCoordinator: noRefresh,
      github: appGithub,
      openCode: noOpenCode,
      credentials: noCredentials(root),
      sessionRoot: join(root, "login-sessions"),
      sharedToken: "secret",
      allowedOrigin: "https://atlas.test",
      githubOrganization: repository.organization,
      githubInstallationId: repository.installationId,
    });
    const action = `/repositories/${repository.githubId}/specs/10/sessions`;
    const unauthenticated = await request(app, action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ submission_id: crypto.randomUUID(), prompt: "Unauthenticated prompt", target: "stack:901278" }),
    });
    assert.equal(unauthenticated.status, 401);
    const loginPage = await unauthenticated.text();
    const csrf = /name="csrf" value="([^"]+)"/u.exec(loginPage)?.[1];
    assert(csrf);
    const login = await request(app, "/login", {
      method: "POST",
      headers: { Origin: "https://atlas.test", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf,
        token: "secret",
        returnTo: action,
        pending_action: action,
        pending_submission_id: crypto.randomUUID(),
        pending_prompt: "Unauthenticated prompt",
        pending_target: "stack:901278",
      }),
    });
    assert.equal(login.status, 200);
    assert((await login.text()).includes('value="stack:901278" checked'));
    persistence.close();
    console.log("PASS sign-in target preservation");
  }

  // Preparation refuses a clone whose remote-tracking parent ref moved after verification.
  {
    const source = join(root, "source");
    const bare = join(root, "fixture.git");
    git(root, ["init", source]);
    git(source, ["config", "user.name", "Verifier"]);
    git(source, ["config", "user.email", "verifier@example.invalid"]);
    writeFileSync(join(source, "fixture.txt"), "main\n");
    git(source, ["add", "."]);
    git(source, ["commit", "-m", "main"]);
    git(source, ["branch", "-M", "main"]);
    const main = git(source, ["rev-parse", "HEAD"]);
    git(source, ["checkout", "-b", "stack-bottom"]);
    writeFileSync(join(source, "fixture.txt"), "bottom\n");
    git(source, ["commit", "-am", "bottom"]);
    const bottom = git(source, ["rev-parse", "HEAD"]);
    git(source, ["checkout", "-b", "stack-top"]);
    writeFileSync(join(source, "fixture.txt"), "top\n");
    git(source, ["commit", "-am", "top"]);
    const oldTop = git(source, ["rev-parse", "HEAD"]);
    writeFileSync(join(source, "fixture.txt"), "new top\n");
    git(source, ["commit", "-am", "new top"]);
    const actualTop = git(source, ["rev-parse", "HEAD"]);
    git(root, ["clone", "--bare", source, bare]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);

    const wrapper = join(root, "git-wrapper.sh");
    writeFileSync(wrapper, `#!/bin/sh
case " $* " in
  *" clone "*)
    dest=""
    for arg in "$@"; do dest="$arg"; done
    /usr/bin/git clone --no-checkout --origin origin '${bare}' "$dest" || exit $?
    /usr/bin/git -C "$dest" remote set-url origin 'https://github.com/${repository.fullName}.git'
    exit $?
    ;;
esac
exec /usr/bin/git "$@"
`, { mode: 0o700 });

    const stalePersistence = createPersistence({ path: ":memory:", now });
    seed(stalePersistence, [spec("10")], stack());
    const stalePrs = pullRequests.map((item) => item.githubId === "4455224172" ? { ...item, headSha: oldTop, observedHeadSha: oldTop } : item);
    stalePersistence.replacePullRequests(repository.githubId, stalePrs, [stack()]);
    const stale = queue(stalePersistence, 1, stackTarget, "stack-top").session;
    const staleGithub: GitHubClient = {
      ...appGithub,
      listInstallationRepositories: async () => [candidate],
      getBranchRef: async (_repo, branch) => ({ sha: branch === "main" ? main : branch === "stack-bottom" ? bottom : oldTop }),
    };
    const stalePreparation = createPreparationService({
      persistence: stalePersistence,
      github: staleGithub,
      refreshRepository: async (saved) => ({ ok: true, repository: saved }),
      refreshPullRequests: async (saved) => ({ ok: true, repository: saved }),
      sessionRoot: join(root, "stale-sessions"),
      minFreeBytes: 1,
      gitBinary: wrapper,
      credentials: noCredentials(root),
    });
    await stalePreparation.prepareNext();
    assert.equal(stalePersistence.getSession(stale.atlasId)?.preparationCheckpoint, "failed_setup");
    assert.match(stalePersistence.getSession(stale.atlasId)?.stateReason ?? "", /differs from/u);
    assert(!existsSync(join(stalePersistence.getSession(stale.atlasId)?.directory ?? "", ".git", "gh-stack")));
    stalePersistence.close();

    // The same full clone path builds real parent branches and the pinned gh-stack schema.
    const successPersistence = createPersistence({ path: ":memory:", now });
    seed(successPersistence, [spec("10")], stack());
    const successPrs = pullRequests.map((item) => item.githubId === "4455224172" ? { ...item, headSha: actualTop, observedHeadSha: actualTop } : item);
    successPersistence.replacePullRequests(repository.githubId, successPrs, [stack()]);
    const success = queue(successPersistence, 1, stackTarget, "stack-top").session;
    const successGithub: GitHubClient = {
      ...appGithub,
      listInstallationRepositories: async () => [candidate],
      getBranchRef: async (_repo, branch) => ({ sha: branch === "main" ? main : branch === "stack-bottom" ? bottom : actualTop }),
    };
    const successPreparation = createPreparationService({
      persistence: successPersistence,
      github: successGithub,
      refreshRepository: async (saved) => ({ ok: true, repository: saved }),
      refreshPullRequests: async (saved) => ({ ok: true, repository: saved }),
      sessionRoot: join(root, "success-sessions"),
      minFreeBytes: 1,
      gitBinary: wrapper,
      credentials: noCredentials(root),
    });
    await successPreparation.prepareNext();
    const prepared = successPersistence.getSession(success.atlasId)!;
    assert.equal(prepared.preparationCheckpoint, "prepared");
    const branchNames = git(prepared.directory!, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n");
    assert.deepEqual(new Set(branchNames), new Set(["main", "stack-bottom", "stack-top", prepared.workingBranch!]));
    const metadata = JSON.parse(readFileSync(join(prepared.directory!, ".git", "gh-stack"), "utf8")) as {
      schemaVersion: number;
      repository: string;
      stacks: Array<{ id: string; number: number; trunk: { branch: string; head: string }; branches: Array<{ branch: string; base: string }> }>;
    };
    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.repository, `github.com:${repository.fullName}`);
    assert.equal(metadata.stacks[0]!.id, "901278");
    assert.equal(metadata.stacks[0]!.number, 5);
    assert.equal(metadata.stacks[0]!.trunk.branch, "main");
    assert.equal(metadata.stacks[0]!.trunk.head, main);
    assert.deepEqual(metadata.stacks[0]!.branches.map((branch) => branch.branch), ["stack-bottom", "stack-top", prepared.workingBranch]);
    assert.deepEqual(metadata.stacks[0]!.branches.map((branch) => branch.base), [main, bottom, actualTop]);
    assert.equal(git(prepared.directory!, ["rev-parse", "refs/heads/stack-bottom"]), bottom);
    assert.equal(git(prepared.directory!, ["rev-parse", "refs/heads/stack-top"]), actualTop);
    assert.equal(git(prepared.directory!, ["rev-parse", "HEAD"]), actualTop);
    assert(!existsSync(join(prepared.directory!, ".git", "atlas-stack.json")));
    console.log("PASS exact refs and gh-stack topology");

    const service = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/api/health") return Response.json({ healthy: true, version: APPROVED_OPENCODE_VERSION });
        if (url.pathname === "/api/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","data":{}}\n\n')); } }), { headers: { "Content-Type": "text/event-stream" } });
        if (url.pathname === "/api/session" && request.method === "POST") {
          const body = await request.json() as { id: string; title: string; location: { directory: string } };
          return Response.json({ data: { id: body.id, title: body.title, location: body.location } });
        }
        const prompt = /^\/api\/session\/([^/]+)\/prompt$/u.exec(url.pathname);
        if (prompt && request.method === "POST") {
          const body = await request.json() as { id: string; text: string };
          return Response.json({ data: { id: body.id, type: "user", payload: { text: body.text } } });
        }
        const session = /^\/api\/session\/([^/]+)$/u.exec(url.pathname);
        if (session && request.method === "GET") return Response.json({ data: { id: session[1], location: { directory: prepared.directory } } });
        if (url.pathname === "/api/session/active") return Response.json({ data: {} });
        if (/\/api\/session\/[^/]+\/(permission|form|inbox)$/u.test(url.pathname)) return Response.json({ data: [] });
        return new Response("not found", { status: 404 });
      },
    });
    const serviceFile = join(root, "opencode.json");
    writeFileSync(serviceFile, JSON.stringify({ url: `http://127.0.0.1:${service.port}`, password: "fixture", version: APPROVED_OPENCODE_VERSION }));
    const handoff = createOpenCodeHandoffService({ persistence: successPersistence, serviceFile, requestTimeoutMs: 5_000 });
    await handoff.process();
    assert(successPersistence.getSession(success.atlasId)?.exactMessage?.includes("Native stack ID: 901278"));
    handoff.stop();
    service.stop(true);
    successPersistence.close();
    console.log("PASS stable native stack ID handoff");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("Issue #33 focused checks passed");
