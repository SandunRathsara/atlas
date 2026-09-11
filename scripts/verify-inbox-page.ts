import { strict as assert } from "node:assert";
import { createApp } from "../src/app.ts";
import {
  createPersistence,
  type Persistence,
  type RepositoryInput,
  type SessionState,
  type SpecInput,
} from "../src/persistence.ts";

const TOKEN = "secret";
const NOW = Date.parse("2026-04-01T00:00:00.000Z");
const waitingId = "ses_11111111-1111-4111-8111-111111111111";

const github = {
  listInstallationRepositories: async () => [],
  hasLabel: async () => true,
  listIssues: async () => [],
  listPullRequests: async () => [],
  listStacks: async () => [],
  getBranchRef: async () => ({ sha: "abc" }),
};

const repo = (githubId: string, name: string): RepositoryInput => ({
  githubId,
  installationId: "installation",
  organization: "Org",
  owner: "Org",
  name,
  fullName: `Org/${name}`,
  htmlUrl: `https://github.com/Org/${name}`,
  description: null,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
});

const spec = (githubId: string, issueNumber: string, title: string): SpecInput => ({
  githubId,
  issueNumber,
  title,
  body: "body",
  htmlUrl: `https://github.com/Org/repo/issues/${issueNumber}`,
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const persistence = () => createPersistence({ path: ":memory:", now: () => NOW });

const mount = (db: Persistence) =>
  createApp({
    persistence: db,
    sharedToken: TOKEN,
    github,
    githubOrganization: "Org",
    githubInstallationId: "installation",
    now: () => NOW,
  });

const request = (app: ReturnType<typeof createApp>, path: string, headers: HeadersInit = {}) =>
  app.fetch(new Request(`http://atlas.test${path}`, { headers, redirect: "manual" }));

const auth = { Authorization: `Bearer ${TOKEN}` };

const queue = (
  db: Persistence,
  atlasId: string,
  repositoryId: string,
  issueNumber: string,
  submittedAt: string,
) => {
  const result = db.queueSession({
    atlasId,
    repositoryId,
    spec: db.getSpec(repositoryId, issueNumber)!,
    submissionId: `${atlasId}-sub`,
    submissionOrderTime: submittedAt,
    prompt: "go",
    targetKind: "default",
    targetBranch: "main",
  });
  assert.equal(result.kind, "created");
};

const setState = (db: Persistence, atlasId: string, state: SessionState, updatedAt: string) => {
  db.database.query(
    "UPDATE sessions SET state = ?, updated_at = ? WHERE atlas_id = ?",
  ).run(state, updatedAt, atlasId);
};

const assertInboxPageChrome = (body: string) => {
  assert(body.includes('id="page-title"'));
  assert(body.includes("data-page-heading>Inbox</h1>"));
  assert(body.includes('class="btn btn-ghost lg:hidden" href="/inbox"'));
  assert(body.includes("Inbox</a>"));
  assert(body.includes("Sign out"));
  assert(!body.includes("data-mobile-navigation"));
  assert(body.includes('id="inbox-page-repository"'));
  assert(body.includes('id="inbox-repository"'));
};

{
  const db = persistence();
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  assert.equal(page.status, 200);
  const body = await page.text();
  assertInboxPageChrome(body);
  assert(body.includes("Add a Repository"));
  assert(body.includes('name="repository" disabled'));
  assert(!body.includes("No work yet"));
  assert(!body.includes("Needs you"));
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.replaceSpecs("1", []);
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  const body = await page.text();
  assertInboxPageChrome(body);
  assert(body.includes("No work yet"));
  assert(!body.includes("No matches"));
  assert(!body.includes("Specs unavailable"));
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.upsertRepository(repo("2", "beta"));
  db.replaceSpecs("1", [spec("spec-wait", "1", "Waiting spec")]);
  db.replaceSpecs("2", []);
  queue(db, waitingId, "1", "1", "2026-03-01T00:00:00.000Z");
  setState(db, waitingId, "waiting", "2026-03-02T00:00:00.000Z");
  const app = mount(db);
  const page = await request(app, "/inbox?repository=2", auth);
  const body = await page.text();
  assertInboxPageChrome(body);
  assert(body.includes("No matches"));
  assert(body.includes("Show all Repositories"));
  assert(body.includes('href="/inbox?repository="'));
  assert(body.includes("Pull requests"));
  assert(body.includes("All Sessions"));
  assert(body.includes("Open on GitHub"));
  assert(!body.includes("No work yet"));
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  const app = mount(db);
  const never = await request(app, "/inbox", auth);
  const neverBody = await never.text();
  assert(neverBody.includes("Specs unavailable"));
  assert(!neverBody.includes("No work yet"));

  db.markRefreshFailure("1", "specs", "GitHub timed out");
  const failed = await request(app, "/inbox", auth);
  const failedBody = await failed.text();
  assert(failedBody.includes("Specs unavailable"));
  assert(failedBody.includes("GitHub timed out"));
  assert(!failedBody.includes("No work yet"));
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.replaceSpecs("1", [spec("spec-wait", "1", "Waiting spec")]);
  db.updateAccess("1", "revoked", "missing from installation");
  queue(db, waitingId, "1", "1", "2026-03-01T00:00:00.000Z");
  setState(db, waitingId, "waiting", "2026-03-02T00:00:00.000Z");
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  const body = await page.text();
  assertInboxPageChrome(body);
  assert(body.includes("Waiting spec"));
  assert(body.includes("badge-error"));
  assert(body.includes("Access unavailable"));
  assert(body.includes("table-compact"));
  assert(body.includes("md:hidden"));
  assert(body.includes("hidden md:block"));
  assert(body.includes("Needs you"));
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.replaceSpecs("1", [spec("spec-wait", "1", "Waiting spec")]);
  const app = mount(db);
  const full = await request(app, "/inbox/list", auth);
  assert.equal(full.status, 200);
  const fullBody = await full.text();
  assert(fullBody.includes("<!doctype html>"));
  assertInboxPageChrome(fullBody);
  assert(fullBody.includes("Waiting spec"));

  const fragment = await request(app, "/inbox/list", { ...auth, "HX-Request": "true" });
  const fragmentBody = await fragment.text();
  assert(!fragmentBody.includes("<!doctype html>"));
  assert(!fragmentBody.includes("data-mobile-navigation"));
  db.close();
}

console.log("Inbox page checks passed");
