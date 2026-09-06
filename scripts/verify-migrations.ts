import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createPersistence } from "../src/persistence.ts";

const root = mkdtempSync("/tmp/opencode/atlas-migrations-");
const repository = {
  githubId: "1",
  installationId: "installation",
  organization: "Org",
  owner: "Org",
  name: "repo",
  fullName: "Org/repo",
  htmlUrl: "https://github.com/Org/repo",
  description: null,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
};
const spec = {
  githubId: "issue-1",
  issueNumber: "7",
  title: "Spec",
  body: "body",
  htmlUrl: "https://github.com/Org/repo/issues/7",
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: null,
};
const sessionId = "ses_00000000-0000-4000-8000-000000000001";

const seed = (path: string) => {
  const persistence = createPersistence({ path });
  persistence.upsertRepository(repository);
  persistence.replaceSpecs(repository.githubId, [spec]);
  persistence.queueSession({
    atlasId: sessionId,
    repositoryId: repository.githubId,
    spec,
    submissionId: "00000000-0000-4000-8000-000000000001",
    submissionOrderTime: "2026-01-01T00:00:00.000Z",
    prompt: "Implement the Spec",
    targetKind: "default",
    targetBranch: "main",
  });
  persistence.database.query(
    "INSERT INTO webhook_deliveries (delivery_id, received_at) VALUES (?, ?)",
  ).run("delivery-1", "2026-01-01T00:00:00.000Z");
  return persistence;
};

const prepareParent = (path: string, parent: "v4" | "26-v5" | "31-v5" | "27-v7") => {
  const persistence = seed(path);
  if (parent === "v4") {
    persistence.database.exec(`
      DROP INDEX IF EXISTS sessions_unfinished_spec_idx;
      DROP INDEX IF EXISTS sessions_repository_order_idx;
      DROP INDEX IF EXISTS sessions_spec_order_idx;
      DROP TABLE sessions;
      DROP INDEX IF EXISTS specs_repository_github_idx;
      DROP INDEX IF EXISTS webhook_deliveries_received_idx;
      DROP TABLE webhook_deliveries;
      DELETE FROM schema_migrations WHERE version >= 5;
    `);
  } else if (parent === "26-v5") {
    persistence.database.exec(`
      DROP INDEX IF EXISTS webhook_deliveries_received_idx;
      DROP TABLE webhook_deliveries;
      DELETE FROM schema_migrations WHERE version = 6;
    `);
  } else if (parent === "31-v5") {
    persistence.database.exec(`
      DROP INDEX IF EXISTS sessions_unfinished_spec_idx;
      DROP INDEX IF EXISTS sessions_repository_order_idx;
      DROP INDEX IF EXISTS sessions_spec_order_idx;
      DROP TABLE sessions;
      DROP INDEX IF EXISTS specs_repository_github_idx;
      DELETE FROM schema_migrations WHERE version >= 6;
    `);
  }
  if (parent === "27-v7") {
    persistence.database.exec(`
      DROP INDEX IF EXISTS webhook_deliveries_received_idx;
      DROP TABLE webhook_deliveries;
      DELETE FROM schema_migrations WHERE version IN (6, 8);
      INSERT INTO schema_migrations (version, applied_at) VALUES (6, '2026-01-01T00:00:00.000Z');
    `);
  }
  persistence.close();
};

const verify = (path: string, expectedSession: boolean, expectedDelivery: boolean, expectedData = true) => {
  const persistence = createPersistence({ path });
  const versions = (persistence.database.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  ).all() as Array<{ version: number }>).map(({ version }) => version);
  assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(Boolean(persistence.getRepository(repository.githubId)), expectedData);
  assert.equal(Boolean(persistence.getSpec(repository.githubId, spec.issueNumber)), expectedData);
  assert.equal(Boolean(persistence.getSession(sessionId)), expectedSession);
  const delivery = persistence.database.query(
    "SELECT 1 FROM webhook_deliveries WHERE delivery_id = ?",
  ).get("delivery-1");
  assert.equal(Boolean(delivery), expectedDelivery);
  const indexes = (persistence.database.query(
    "SELECT name FROM sqlite_master WHERE type = 'index'",
  ).all() as Array<{ name: string }>).map(({ name }) => name);
  assert(indexes.includes("specs_repository_github_idx"));
  persistence.close();
};

try {
  const fresh = join(root, "fresh.sqlite");
  const freshPersistence = createPersistence({ path: fresh });
  freshPersistence.close();
  verify(fresh, false, false, false);

  const mainline = join(root, "mainline-v4.sqlite");
  prepareParent(mainline, "v4");
  verify(mainline, false, false);

  const issue26 = join(root, "issue26-v5.sqlite");
  prepareParent(issue26, "26-v5");
  verify(issue26, true, false);

  const issue31 = join(root, "issue31-v5.sqlite");
  prepareParent(issue31, "31-v5");
  verify(issue31, false, true);

  const issue27 = join(root, "issue27-v7.sqlite");
  prepareParent(issue27, "27-v7");
  verify(issue27, true, false);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("Migration compatibility checks passed");
