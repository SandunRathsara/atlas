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
const NOW_ISO = "2026-04-01T00:00:00.000Z";
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

const signIn = async (app: ReturnType<typeof createApp>) => {
  const page = await app.fetch(new Request("http://atlas.test/login"));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  assert(csrf);
  const response = await app.fetch(new Request("http://atlas.test/login", {
    method: "POST",
    headers: {
      Origin: "http://atlas.test",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ csrf, token: TOKEN, returnTo: "/" }).toString(),
    redirect: "manual",
  }));
  const session = response.headers.getSetCookie().find((value) => value.startsWith("atlas_session="));
  assert(session);
  return session.slice(0, session.indexOf(";"));
};

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

const assertCookieFlags = (header: string) => {
  assert(header.includes("Path=/"));
  assert(header.includes("Secure"));
  assert(header.includes("HttpOnly"));
  assert(header.includes("SameSite=Strict"));
  assert(!/Max-Age/i.test(header));
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
  terminalAt?: string,
) => {
  db.database.query("UPDATE sessions SET state = ?, updated_at = ? WHERE atlas_id = ?")
    .run(state, updatedAt, atlasId);
  if (terminalAt !== undefined) {
    db.database.query(
      "INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json) VALUES (?, 'terminal', ?, NULL, NULL)",
    ).run(atlasId, terminalAt);
  }
};

{
  const db = persistence();
  const app = mount(db);
  const unauth = await request(app, "/");
  assert.equal(unauth.status, 303);
  assert.equal(unauth.headers.get("Location"), "/login?returnTo=%2F");
  const inbox = await request(app, "/inbox");
  assert.equal(inbox.status, 303);
  assert.equal(inbox.headers.get("Location")?.startsWith("/login?returnTo="), true);
  db.close();
}

{
  const db = persistence();
  const app = mount(db);
  const response = await request(app, "/", auth);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/repositories/new");
  const cookies = parsedCookies(response);
  assert.deepEqual(cookies.atlas_visit.value, { lastVisitAt: NOW_ISO });
  assertCookieFlags(cookies.atlas_visit.header);
  assert.equal(cookies.atlas_inbox, undefined);
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.upsertRepository(repo("2", "beta"));
  const app = mount(db);
  const response = await request(app, "/", auth);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/inbox");
  const cookies = parsedCookies(response);
  assert.deepEqual(cookies.atlas_visit.value, { lastVisitAt: NOW_ISO });
  assert.equal(cookies.atlas_inbox, undefined);
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.replaceSpecs("1", [spec("spec-wait", "1", "Waiting"), spec("spec-run", "2", "Running")]);
  queue(db, runningId, "1", "2", "2026-01-01T00:00:00.000Z");
  setState(db, runningId, "running", "2026-01-02T00:00:00.000Z");
  queue(db, waitingId, "1", "1", "2026-03-01T00:00:00.000Z");
  setState(db, waitingId, "waiting", "2026-03-02T00:00:00.000Z");
  const app = mount(db);
  const fresh = await request(app, "/", auth);
  assert.equal(fresh.status, 303);
  assert.equal(fresh.headers.get("Location"), `/sessions/${waitingId}`);
  const cookies = parsedCookies(fresh);
  assert.deepEqual(cookies.atlas_visit.value, { lastVisitAt: NOW_ISO, lastRepositoryId: "1" });
  assert.deepEqual(cookies.atlas_inbox.value, { repositoryId: "1" });
  assertCookieFlags(cookies.atlas_inbox.header);
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.replaceSpecs("1", [spec("spec-done", "1", "Done")]);
  queue(db, doneId, "1", "1", "2026-01-01T00:00:00.000Z");
  setState(db, doneId, "succeeded", "2026-02-02T00:00:00.000Z", "2026-02-02T00:00:00.000Z");
  const app = mount(db);
  const afterFinish = await request(app, "/", {
    ...auth,
    Cookie: cookieJson("atlas_visit", { lastVisitAt: "2026-02-01T00:00:00.000Z", lastRepositoryId: "1" }),
  });
  assert.equal(afterFinish.status, 303);
  assert.equal(afterFinish.headers.get("Location"), `/sessions/${doneId}`);
  const seen = await request(app, "/", {
    ...auth,
    Cookie: cookieJson("atlas_visit", { lastVisitAt: "2026-03-01T00:00:00.000Z", lastRepositoryId: "1" }),
  });
  assert.equal(seen.status, 303);
  assert.equal(seen.headers.get("Location"), "/repositories/1/specs");
  const seenCookies = parsedCookies(seen);
  assert.deepEqual(seenCookies.atlas_inbox.value, { repositoryId: "1" });
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.upsertRepository(repo("2", "beta"));
  db.removeRepository("1");
  const app = mount(db);
  const response = await request(app, "/", {
    ...auth,
    Cookie: cookieJson("atlas_visit", { lastVisitAt: NOW_ISO, lastRepositoryId: "1" }),
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/inbox");
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.removeRepository("1");
  const app = mount(db);
  const response = await request(app, "/", {
    ...auth,
    Cookie: cookieJson("atlas_visit", { lastVisitAt: NOW_ISO, lastRepositoryId: "1" }),
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/repositories/new");
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  db.upsertRepository(repo("2", "beta"));
  const app = mount(db);
  const jarA = await signIn(app);
  const jarB = await signIn(app);
  assert.notEqual(jarA, jarB);
  const fromA = await request(app, "/", {
    Cookie: `${jarA}; ${cookieJson("atlas_visit", { lastVisitAt: NOW_ISO, lastRepositoryId: "1" })}`,
  });
  const fromB = await request(app, "/", {
    Cookie: `${jarB}; ${cookieJson("atlas_visit", { lastVisitAt: NOW_ISO, lastRepositoryId: "2" })}`,
  });
  assert.equal(fromA.headers.get("Location"), "/repositories/1/specs");
  assert.equal(fromB.headers.get("Location"), "/repositories/2/specs");
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  const app = mount(db);
  const page = await request(app, "/inbox", auth);
  assert.equal(page.status, 200);
  const body = await page.text();
  assert(body.includes("Inbox | Atlas"));
  assert.equal(page.headers.get("Location"), null);

  const filtered = await request(app, "/inbox?repository=1", auth);
  assert.equal(filtered.status, 200);
  const filteredCookies = parsedCookies(filtered);
  assert.deepEqual(filteredCookies.atlas_inbox.value, { repositoryId: "1" });
  assertCookieFlags(filteredCookies.atlas_inbox.header);

  const cleared = await request(app, "/inbox?repository=", auth);
  assert.equal(cleared.status, 200);
  assert.deepEqual(parsedCookies(cleared).atlas_inbox.value, {});
  db.close();
}

{
  const db = persistence();
  db.upsertRepository(repo("1", "alpha"));
  const app = mount(db);
  const response = await request(app, "/", {
    ...auth,
    Cookie: "atlas_visit=not-json",
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "/inbox");
  db.close();
}

console.log("Landing checks passed");
