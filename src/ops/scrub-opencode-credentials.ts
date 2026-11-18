// Removes saved credentials from a RESTORED copy of OpenCode's database.
// Never run this against live OpenCode data: it deletes every saved account.
//
// OpenCode 2.x keeps saved provider API keys, OAuth tokens (including MCP
// OAuth), and well-known integration tokens in the `credential` table, and
// OpenCode Console sign-ins in `account`/`control_account`. Cached well-known
// integration configuration lives in `kv` under `wellknown:` keys. A legacy
// `auth.json` is imported into `credential` and left on disk; the caller
// removes that file.
import { Database } from "bun:sqlite";

function fail(message: string): never {
  console.error(`OpenCode credential scrub failed: ${message}`);
  process.exit(1);
}

/** `atlas ops scrub-opencode-credentials <restored opencode.db>` */
export const run = (args: string[]) => {
  if (args.length !== 1) fail("usage: atlas ops scrub-opencode-credentials <restored opencode.db>");
  const path = args[0]!;

  const db = new Database(path, { readwrite: true, create: false, strict: true });
  try {
    const tables = new Set(
      db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );
    // Fail closed: without this table the credential store is unknown.
    if (!tables.has("credential")) fail("the database has no credential table, so its credential store is unknown");

    // Zero freed pages so deleted secrets do not survive in the file.
    db.run("PRAGMA secure_delete = ON");
    db.transaction(() => {
      db.run("DELETE FROM credential");
      if (tables.has("account_state")) db.run("UPDATE account_state SET active_account_id = NULL, active_org_id = NULL");
      if (tables.has("account")) db.run("DELETE FROM account");
      if (tables.has("control_account")) db.run("DELETE FROM control_account");
      if (tables.has("kv")) db.run("DELETE FROM kv WHERE key LIKE 'wellknown:%'");
    })();
    // Rebuild the file so secrets deleted before the snapshot (free pages) are
    // gone too, then fold the WAL into the database and truncate it.
    db.run("VACUUM");
    const checkpoint = db.query<{ busy: number }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (!checkpoint || checkpoint.busy !== 0) fail("the database WAL could not be checkpointed");

    const remaining = (table: string, where = "") =>
      tables.has(table) ? db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${table}" ${where}`).get()?.n ?? 0 : 0;
    const left =
      remaining("credential") + remaining("account") + remaining("control_account") + remaining("kv", "WHERE key LIKE 'wellknown:%'");
    if (left !== 0) fail("credential rows remained after the scrub");
  } finally {
    db.close();
  }
  return 0;
};
