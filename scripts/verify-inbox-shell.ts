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
const runningId = "ses_22222222-2222-4222-8222-222222222222";
const doneId = "ses_33333333-3333-4333-8333-333333333333";

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

const cookieJson = (name: string, value: unknown) =>
  `${name}=${encodeURIComponent(JSON.stringify(value))}`;

const parsedCookies = (response: Response) => {
  const cookies: Record<string, { value: unknown; header: string }> = {};
  for (const header of response.headers.getSetCookie()) {
    const assign = header.split(";", 1)[0]!;
    const separator = assign.indexOf("=");
    const name = assign.slice(0, separator);
    const raw = assign.slice(separator + 1);
    let value: unknown = raw;
    try {
      value = JSON.parse(decodeURIComponent(raw));
    } catch {
      value = decodeURIComponent(raw);
    }
    cookies[name] = { value, header };
  }
  return cookies;
};

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

const setState = (
  db: Persistence,
  atlasId: string,
  state: SessionState,
  updatedAt: string,
  extra: { terminalAt?: string; stale?: boolean } = {},
) => {
  db.database.query(
    "UPDATE sessions SET state = ?, updated_at = ?, opencode_freshness = ? WHERE atlas_id = ?",
  ).run(state, updatedAt, extra.stale ? "stale" : "unknown", atlasId);
  if (extra.terminalAt !== undefined) {
    db.database.query(
      "INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json) VALUES (?, 'terminal', ?, NULL, NULL)",
    ).run(atlasId, extra.terminalAt);
  }
};

const seed = (db: Persistence) => {
  db.upsertRepository(repo("1", "alpha"));
  db.upsertRepository(repo("2", "beta"));
  db.replaceSpecs("1", [
    spec("spec-wait", "1", "Waiting spec"),
    spec("spec-run", "2", "Running spec"),
    spec("spec-none", "3", "No session spec"),
    spec("spec-done", "4", "Settled spec"),
  ]);
  db.replaceSpecs("2", [spec("spec-beta", "8", "Beta spec")]);
  queue(db, waitingId, "1", "1", "2026-03-01T00:00:00.000Z");
  setState(db, waitingId, "waiting", "2026-03-02T00:00:00.000Z", { stale: true });
  queue(db, runningId, "1", "2", "2026-03-03T00:00:00.000Z");
  setState(db, runningId, "running", "2026-03-04T00:00:00.000Z");
  queue(db, doneId, "1", "4", "2026-02-01T00:00:00.000Z");
  setState(db, doneId, "succeeded", "2026-03-20T00:00:00.000Z", { terminalAt: "2026-03-20T00:00:00.000Z" });
};

const assertShell = (body: string) => {
  assert(body.includes("lg:w-72"));
  assert(body.includes('name="repository"'));
  assert(body.includes('action="/inbox" method="get"'));
  assert(body.includes('id="inbox-repository"'));
  assert(body.includes(">All Repositories</option>"));
  assert(body.includes(">Manage Repositories…</option>"));
  assert(body.includes('aria-label="Add a Repository"'));
  assert(body.includes('id="inbox-list"'));
  assert(body.includes('hx-trigger="every 30s"'));
  assert(body.includes('hx-push-url="false"'));
  assert(body.includes('hx-get="/inbox/list"'));
  assert(body.includes('hx-swap="outerHTML"'));
  assert(body.includes("data-inbox-scroll"));
  assert(!body.includes("inbox-list-body"));
  assert(!body.includes('hx-target="#inbox-list-body"'));
  assert(!body.includes('hx-select="#inbox-list-body"'));
  assert(!body.includes('hx-trigger="change"'));
  assert(!body.includes("data-focus-on-swap"));
  assert(!body.includes("No Repository selected"));
  assert(!body.includes('uppercase tracking-wide text-faint">Atlas</p>'));
  assert(!body.includes('uppercase tracking-wide text-faint">Repository</p>'));
};

{
  const db = persistence();
  const app = mount(db);
  const unauth = await request(app, "/inbox/list");
  assert.equal(unauth.status, 303);
  assert.equal(unauth.headers.get("Location")?.startsWith("/login?returnTo="), true);
  db.close();
}

{
  const db = persistence();
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Cache-Control"), "private, no-store");
  assert.equal(page.headers.get("Vary"), "HX-Request");
  const body = await page.text();
  assertShell(body);
  assert(body.includes("Add a Repository"));
  assert(!body.includes("Needs you"));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  assert.equal(page.status, 200);
  const body = await page.text();
  assertShell(body);
  assert(!body.includes('hx-trigger="change"'));
  assert(body.includes("uppercase tracking-wide text-faint"));
  assert(body.includes("Needs you"));
  assert(body.includes("In progress"));
  assert(body.includes("Not started"));
  assert(body.includes("Settled"));
  assert(body.includes("Waiting spec"));
  assert(body.includes("border-l-2 border-l-warning"));
  assert(body.includes(">Stale</span>"));
  assert(body.includes(">No Session</span>"));
  assert(body.includes(">alpha</p>"));
  assert(body.includes(">beta</p>"));
  assert(body.includes(">All Repositories</p>"));
  assert(body.includes("View all Sessions"));
  assert(body.includes('id="inbox-view-all-sessions"'));
  assert(body.includes('href="/sessions?status=all"'));
  assert(body.includes(`href="/sessions/${waitingId}"`));
  assert(body.includes("/repositories/1/specs/3"));
  assert(body.includes(`href="/sessions/${doneId}"`));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const filtered = await request(app, "/inbox?repository=1", auth);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.headers.get("Cache-Control"), "private, no-store");
  assert.equal(filtered.headers.get("Vary"), "HX-Request");
  assert.deepEqual(parsedCookies(filtered).atlas_inbox.value, { repositoryId: "1" });
  const body = await filtered.text();
  assert(body.includes(">Org/alpha</p>"));
  assert(body.includes("Waiting spec"));
  assert(!body.includes(">alpha</p>"));
  assert(!body.includes("Beta spec"));
  assert.equal(body.split("Pull requests").length - 1, 2);
  assert(body.includes("All Sessions"));
  assert(body.includes("Open on GitHub"));
  assert(body.includes("View all Sessions"));
  assert(body.includes("/repositories/1/pull-requests"));
  assert(body.includes('href="/repositories/1/sessions?status=all"'));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const managed = await request(app, "/inbox?repository=manage", auth);
  assert.equal(managed.status, 303);
  assert.equal(managed.headers.get("Location"), "/repositories");
  assert.equal(managed.headers.get("Cache-Control"), "private, no-store");
  assert.equal(managed.headers.get("Vary"), "HX-Request");
  assert.equal(parsedCookies(managed).atlas_inbox, undefined);

  const hx = await request(app, "/inbox/list?repository=manage", { ...auth, "HX-Request": "true" });
  assert.equal(hx.status, 200);
  assert.equal(hx.headers.get("HX-Redirect"), "/repositories");
  assert.equal(hx.headers.get("Cache-Control"), "private, no-store");
  assert.equal(hx.headers.get("Vary"), "HX-Request");
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const canonical = await request(app, "/inbox", {
    ...auth,
    Cookie: cookieJson("atlas_inbox", { repositoryId: "1" }),
  });
  assert.equal(canonical.status, 303);
  assert.equal(canonical.headers.get("Location"), "/inbox?repository=1");
  assert.equal(canonical.headers.get("Cache-Control"), "private, no-store");
  assert.equal(canonical.headers.get("Vary"), "HX-Request");
  db.close();
}

{
  const db = persistence();
  seed(db);
  db.removeRepository("1");
  const app = mount(db);
  const fallback = await request(app, "/inbox", {
    ...auth,
    Cookie: cookieJson("atlas_inbox", { repositoryId: "1" }),
  });
  assert.equal(fallback.status, 200);
  const body = await fallback.text();
  assert(body.includes(">All Repositories</p>"));
  assert(!body.includes(">Org/alpha</p>"));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const fragment = await request(app, "/inbox/list", { ...auth, "HX-Request": "true" });
  assert.equal(fragment.status, 200);
  const body = await fragment.text();
  assert(body.includes('id="inbox-list"'));
  assert(body.includes('hx-trigger="every 30s"'));
  assert(body.includes('hx-swap="outerHTML"'));
  assert(body.includes("data-inbox-scroll"));
  assert(!body.includes("inbox-list-body"));
  assert(!body.includes('hx-target="#inbox-list-body"'));
  assert(!body.includes('hx-select="#inbox-list-body"'));
  assert(body.includes('hx-push-url="false"'));
  assert(!body.includes("<!doctype html>"));
  assert(body.includes("Needs you"));

  const full = await request(app, "/inbox/list", auth);
  assert.equal(full.status, 200);
  const fullBody = await full.text();
  assert(fullBody.includes("<!doctype html>"));
  assertShell(fullBody);
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const selected = await request(app, `/sessions/${waitingId}`, auth);
  const body = await selected.text();
  assert(/id="inbox-1-1"[^>]*aria-current="page"/.test(body));
  assert(body.includes("bg-brand-tint"));
  assert(body.includes("border-l-brand-readable"));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  for (const currentUrl of [
    "/repositories/1/specs/1",
    "/repositories/1/specs/1/sessions/new",
    `/sessions/${waitingId}/target`,
    `/sessions/${waitingId}/reservation/release`,
    `/sessions/${waitingId}/view`,
  ]) {
    const response = await request(app, "/inbox/list", {
      ...auth,
      "HX-Request": "true",
      "HX-Current-URL": `http://atlas.test${currentUrl}`,
    });
    assert.equal(response.status, 200);
    assert(/id="inbox-1-1"[^>]*aria-current="page"/.test(await response.text()));
  }
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const visit = await request(app, "/inbox", {
    ...auth,
    Cookie: cookieJson("atlas_visit", { lastVisitAt: "2026-03-01T00:00:00.000Z" }),
  });
  const body = await visit.text();
  assert(body.includes("Settled · 1 new"));
  assert(body.includes("inline-block size-2"));
  assert(body.includes("sr-only\">New</span>"));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const specs = await request(app, "/repositories/1/specs", {
    ...auth,
    Cookie: cookieJson("atlas_inbox", { repositoryId: "1" }),
  });
  const body = await specs.text();
  assertShell(body);
  assert(!body.includes('hx-trigger="change"'));
  assert(body.includes(">Org/alpha</p>"));
  assert(body.includes("Needs you"));

  const scopedQuery = await request(app, "/repositories/1/specs?repository=2", {
    ...auth,
    Cookie: cookieJson("atlas_inbox", { repositoryId: "1" }),
  });
  const scopedBody = await scopedQuery.text();
  assert(scopedBody.includes('<option value="1" selected>Org/alpha</option>'));
  assert(!scopedBody.includes('<option value="2" selected>Org/beta</option>'));
  db.close();
}

{
  const db = persistence();
  seed(db);
  db.updateAccess("2", "unknown", "GitHub timed out");
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  const body = await page.text();
  assert(body.includes("Beta spec"));
  assert(body.includes(">Access unknown</span>"));
  assert(body.includes("badge-warning"));
  assert(!body.includes(">Access unavailable</span>"));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const sessions = await request(app, "/sessions?status=all", auth);
  assert.equal(sessions.status, 200);
  const body = await sessions.text();
  assert(body.includes("All Sessions"));
  assert(body.includes("Org/alpha"));
  assert(body.includes(`href="/sessions/${waitingId}"`));
  assert(body.includes('href="/sessions?status=all"'));
  db.close();
}

{
  const db = persistence();
  seed(db);
  const app = mount(db);
  const prs = await request(app, "/repositories/1/pull-requests", {
    ...auth,
    Cookie: cookieJson("atlas_inbox", { repositoryId: "1" }),
  });
  const body = await prs.text();
  assert(body.includes('aria-current="page"'));
  assert(body.includes("/repositories/1/pull-requests"));
  assert(body.includes("bg-brand-tint"));
  db.close();
}

console.log("Inbox shell checks passed");
