import { strict as assert } from "node:assert";
import {
  createPersistence,
  type RepositoryInput,
  type SessionState,
  type SpecInput,
} from "../src/persistence.ts";

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

const spec = (githubId: string, issueNumber: string, title: string, updatedAt: string): SpecInput => ({
  githubId,
  issueNumber,
  title,
  body: "body",
  htmlUrl: `https://github.com/Org/repo/issues/${issueNumber}`,
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt,
});

const persistence = createPersistence({ path: ":memory:" });
persistence.upsertRepository(repo("1", "alpha"));
persistence.upsertRepository(repo("2", "beta"));
persistence.upsertRepository(repo("3", "gone"));

persistence.replaceSpecs("1", [
  spec("spec-none", "1", "No Session", "2026-01-01T00:00:00.000Z"),
  spec("spec-queued", "2", "Queued", "2026-01-02T00:00:00.000Z"),
  spec("spec-preparing", "3", "Preparing", "2026-01-03T00:00:00.000Z"),
  spec("spec-running", "4", "Running", "2026-01-04T00:00:00.000Z"),
  spec("spec-waiting", "5", "Waiting", "2026-01-05T00:00:00.000Z"),
  spec("spec-idle", "6", "Idle", "2026-01-06T00:00:00.000Z"),
  spec("spec-succeeded", "7", "Succeeded", "2026-01-07T00:00:00.000Z"),
  spec("spec-failed", "8", "Failed", "2026-01-08T00:00:00.000Z"),
  spec("spec-interrupted", "9", "Interrupted", "2026-01-09T00:00:00.000Z"),
  spec("spec-failed-setup", "10", "Failed setup", "2026-01-10T00:00:00.000Z"),
  spec("spec-many", "11", "Many Sessions", "2026-01-11T00:00:00.000Z"),
]);
persistence.replaceSpecs("2", [
  spec("spec-beta-waiting", "20", "Beta waiting", "2026-01-20T00:00:00.000Z"),
  ...Array.from({ length: 11 }, (_, index) => spec(
    `spec-cap-${index}`,
    String(30 + index),
    `Cap ${index}`,
    `2026-05-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  )),
]);
persistence.replaceSpecs("3", [spec("spec-removed", "1", "Removed repo", "2026-01-01T00:00:00.000Z")]);
persistence.removeRepository("3");

const queue = (atlasId: string, repositoryId: string, issueNumber: string, submittedAt: string) => {
  const result = persistence.queueSession({
    atlasId,
    repositoryId,
    spec: persistence.getSpec(repositoryId, issueNumber)!,
    submissionId: `${atlasId}-sub`,
    submissionOrderTime: submittedAt,
    prompt: "go",
    targetKind: "default",
    targetBranch: "main",
  });
  assert.equal(result.kind, "created");
};

const setState = (
  atlasId: string,
  state: SessionState,
  updatedAt: string,
  extra: { terminalAt?: string; stale?: boolean } = {},
) => {
  persistence.database.query(
    "UPDATE sessions SET state = ?, updated_at = ?, opencode_freshness = ? WHERE atlas_id = ?",
  ).run(state, updatedAt, extra.stale ? "stale" : "unknown", atlasId);
  if (extra.terminalAt !== undefined) {
    persistence.database.query(
      "INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json) VALUES (?, 'terminal', ?, NULL, NULL)",
    ).run(atlasId, extra.terminalAt);
  }
};

queue("ses_queued", "1", "2", "2026-01-02T12:00:00.000Z");
setState("ses_queued", "queued", "2026-04-01T00:00:00.000Z");

queue("ses_preparing", "1", "3", "2026-01-03T12:00:00.000Z");
setState("ses_preparing", "preparing", "2026-04-02T00:00:00.000Z");

queue("ses_running", "1", "4", "2026-01-04T12:00:00.000Z");
setState("ses_running", "running", "2026-04-04T00:00:00.000Z");

queue("ses_waiting", "1", "5", "2026-01-20T12:00:00.000Z");
setState("ses_waiting", "waiting", "2026-03-01T00:00:00.000Z", { stale: true });

queue("ses_idle", "1", "6", "2026-01-06T12:00:00.000Z");
setState("ses_idle", "idle", "2026-04-03T00:00:00.000Z");

queue("ses_succeeded", "1", "7", "2026-01-07T12:00:00.000Z");
setState("ses_succeeded", "succeeded", "2026-02-10T00:00:00.000Z", { terminalAt: "2026-02-01T00:00:00.000Z" });
persistence.database.query(
  "INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json) VALUES (?, 'terminal', ?, NULL, NULL)",
).run("ses_succeeded", "2026-02-10T00:00:00.000Z");

queue("ses_failed", "1", "8", "2026-01-08T12:00:00.000Z");
setState("ses_failed", "failed", "2026-02-02T00:00:00.000Z", { terminalAt: "2026-02-02T00:00:00.000Z" });

queue("ses_interrupted", "1", "9", "2026-01-09T12:00:00.000Z");
setState("ses_interrupted", "interrupted", "2026-02-03T00:00:00.000Z", { terminalAt: "2026-02-03T00:00:00.000Z" });

queue("ses_failed_setup", "1", "10", "2026-01-10T12:00:00.000Z");
setState("ses_failed_setup", "failed_setup", "2026-02-04T00:00:00.000Z");

queue("ses_many_old", "1", "11", "2026-01-11T12:00:00.000Z");
setState("ses_many_old", "succeeded", "2026-01-15T00:00:00.000Z", { terminalAt: "2026-01-15T00:00:00.000Z" });
queue("ses_many_new", "1", "11", "2026-01-16T12:00:00.000Z");
setState("ses_many_new", "running", "2026-04-05T00:00:00.000Z");

queue("ses_beta_waiting", "2", "20", "2026-01-10T12:00:00.000Z");
setState("ses_beta_waiting", "waiting", "2026-03-02T00:00:00.000Z");

queue("ses_removed", "3", "1", "2026-01-01T12:00:00.000Z");

for (let index = 0; index < 11; index++) {
  const atlasId = `ses_cap_${index}`;
  queue(atlasId, "2", String(30 + index), `2026-05-01T01:00:${String(index).padStart(2, "0")}.000Z`);
  const terminalAt = `2026-06-01T00:00:${String(index).padStart(2, "0")}.000Z`;
  const updatedAt = index === 0
    ? "2026-07-01T00:00:00.000Z"
    : index === 10
      ? "2026-01-01T00:00:00.000Z"
      : terminalAt;
  setState(atlasId, "succeeded", updatedAt, { terminalAt });
}

const bySpec = (rows: ReturnType<typeof persistence.listInbox>["rows"]) =>
  Object.fromEntries(rows.map((row) => [row.specGithubId, row]));

const alpha = persistence.listInbox({ repositoryId: "1", lastVisitAt: "2026-01-20T00:00:00.000Z" });
const rows = bySpec(alpha.rows);

assert.equal(rows["spec-none"].group, "not_started");
assert.equal(rows["spec-none"].session, null);
assert.equal(rows["spec-none"].unread, false);

assert.equal(rows["spec-queued"].group, "in_progress");
assert.equal(rows["spec-queued"].session?.state, "queued");
assert.equal(rows["spec-preparing"].session?.state, "preparing");
assert.equal(rows["spec-running"].session?.state, "running");
assert.equal(rows["spec-idle"].group, "in_progress");
assert.equal(rows["spec-idle"].session?.state, "idle");
assert.equal(rows["spec-idle"].session?.terminalAt, null);

assert.equal(rows["spec-waiting"].group, "needs_you");
assert.equal(rows["spec-waiting"].session?.stale, true);

assert.equal(rows["spec-succeeded"].group, "settled");
assert.equal(rows["spec-succeeded"].session?.terminalAt, "2026-02-01T00:00:00.000Z");
assert.equal(rows["spec-succeeded"].unread, true);
assert.equal(rows["spec-failed"].session?.state, "failed");
assert.equal(rows["spec-interrupted"].session?.state, "interrupted");
assert.equal(rows["spec-failed-setup"].group, "settled");
assert.equal(rows["spec-failed-setup"].session?.terminalAt, "2026-02-04T00:00:00.000Z");
assert.equal(rows["spec-failed-setup"].unread, true);

assert.equal(rows["spec-many"].group, "in_progress");
assert.equal(rows["spec-many"].session?.atlasId, "ses_many_new");
assert.equal(rows["spec-many"].session?.state, "running");

const inProgress = alpha.rows.filter((row) => row.group === "in_progress").map((row) => row.specGithubId);
assert.deepEqual(inProgress, ["spec-many", "spec-running", "spec-queued", "spec-preparing", "spec-idle"]);
assert.equal(alpha.settledTotal, 4);
assert.equal(alpha.settledNew, 4);

const inbox = persistence.listInbox({ lastVisitAt: "2026-01-20T00:00:00.000Z" });
assert.equal(inbox.rows.some((row) => row.repositoryId === "3"), false);
assert.equal(inbox.rows.some((row) => row.specGithubId === "spec-removed"), false);
const needsYou = inbox.rows.filter((row) => row.group === "needs_you").map((row) => row.specGithubId);
assert.deepEqual(needsYou, ["spec-beta-waiting", "spec-waiting"]);
assert.equal(inbox.settledTotal, 15);
assert.equal(inbox.rows.filter((row) => row.group === "settled").length, 10);
assert.equal(inbox.settledNew, 15);
const settledIds = inbox.rows.filter((row) => row.group === "settled").map((row) => row.specGithubId);
assert.equal(settledIds.includes("spec-cap-0"), true);
assert.equal(settledIds.includes("spec-cap-10"), false);
assert.equal(settledIds.includes("spec-succeeded"), false);

const afterVisit = persistence.listInbox({ lastVisitAt: "2026-07-01T00:00:00.000Z" });
assert.equal(afterVisit.settledNew, 0);
assert.equal(afterVisit.rows.every((row) => row.unread === false), true);

const noVisit = persistence.listInbox();
assert.equal(noVisit.settledNew, 0);
assert.equal(noVisit.rows.every((row) => row.unread === false), true);

const filtered = persistence.listInbox({ repositoryId: "2" });
assert.equal(filtered.rows.every((row) => row.repositoryId === "2"), true);
assert.equal(filtered.rows.some((row) => row.specGithubId === "spec-waiting"), false);
const betaWaiting = filtered.rows.find((row) => row.specGithubId === "spec-beta-waiting");
assert.equal(betaWaiting?.group, "needs_you");
assert.equal(betaWaiting?.session?.stale, false);

assert.equal(persistence.findLandingSession("2026-01-01T00:00:00.000Z")?.atlasId, "ses_many_old");
assert.equal(persistence.findLandingSession("2026-01-20T00:00:00.000Z")?.atlasId, "ses_succeeded");
assert.equal(persistence.findLandingSession("2026-07-01T00:00:00.000Z")?.atlasId, "ses_beta_waiting");
assert.equal(persistence.findLandingSession("")?.atlasId, "ses_beta_waiting");

persistence.close();

const settledOnly = createPersistence({ path: ":memory:" });
settledOnly.upsertRepository(repo("1", "alpha"));
settledOnly.replaceSpecs("1", [spec("spec-done", "1", "Done", "2026-01-01T00:00:00.000Z")]);
const queued = settledOnly.queueSession({
  atlasId: "ses_done",
  repositoryId: "1",
  spec: settledOnly.getSpec("1", "1")!,
  submissionId: "ses_done-sub",
  submissionOrderTime: "2026-01-01T12:00:00.000Z",
  prompt: "go",
  targetKind: "default",
  targetBranch: "main",
});
assert.equal(queued.kind, "created");
settledOnly.database.query("UPDATE sessions SET state = ?, updated_at = ? WHERE atlas_id = ?")
  .run("succeeded", "2026-01-02T00:00:00.000Z", "ses_done");
settledOnly.database.query(
  "INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json) VALUES (?, 'terminal', ?, NULL, NULL)",
).run("ses_done", "2026-01-02T00:00:00.000Z");
assert.equal(settledOnly.findLandingSession("2026-01-03T00:00:00.000Z"), null);
assert.equal(settledOnly.findLandingSession("2026-01-01T00:00:00.000Z")?.atlasId, "ses_done");
settledOnly.close();
