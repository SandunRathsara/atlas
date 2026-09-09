import { Database } from "bun:sqlite";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

const [atlasPath, openCodePath, restoreRoot, registryPath, historyManifestPath] = process.argv.slice(2);
if (!atlasPath || !openCodePath || !restoreRoot || !registryPath || !historyManifestPath) {
  throw new Error("usage: check-restored-state ATLAS_DB OPENCODE_DB RESTORE_ROOT REGISTRY HISTORY_MANIFEST");
}

const regularFile = (path: string) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("required restore input is not a regular file");
};

for (const path of [atlasPath, openCodePath, registryPath, historyManifestPath]) regularFile(path);
const rootStat = lstatSync(restoreRoot);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("restore target is not an ordinary directory");

const atlas = new Database(atlasPath, { create: false, strict: true });
const openCode = new Database(openCodePath, { create: false, strict: true });

const integrity = (database: Database, label: string) => {
  const rows = database.query("PRAGMA integrity_check").values() as unknown[][];
  if (rows.length !== 1 || rows[0]?.[0] !== "ok") throw new Error(`${label} integrity check failed`);
};

integrity(atlas, "Atlas database");
integrity(openCode, "OpenCode database");
if ((atlas.query("PRAGMA foreign_key_check").values() as unknown[][]).length !== 0) {
  throw new Error("Atlas foreign-key check failed");
}

const tables = new Set((atlas.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name));
for (const table of [
  "schema_migrations", "repositories", "specs", "pull_requests", "pr_stacks", "stack_members",
  "sessions", "stack_reservations", "reservation_prs", "reservation_conflict_holds", "session_history",
]) {
  if (!tables.has(table)) throw new Error("Atlas database schema does not match this release");
}
const migration = atlas.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number } | null;
if (migration?.version !== 12) throw new Error("Atlas migration version does not match this release");

const associationChecks = [
  `SELECT 1 FROM sessions s JOIN repositories r ON r.github_id = s.repository_id
   LEFT JOIN pull_requests p ON p.github_id = s.result_pull_request_id
   WHERE s.result_pull_request_id IS NOT NULL AND (p.github_id IS NULL OR p.repository_id <> s.repository_id) LIMIT 1`,
  `SELECT 1 FROM stack_members m JOIN pr_stacks st ON st.github_id = m.stack_id
   JOIN pull_requests p ON p.github_id = m.pull_request_id WHERE st.repository_id <> p.repository_id LIMIT 1`,
  `SELECT 1 FROM stack_reservations sr JOIN sessions s ON s.atlas_id = sr.session_id
   WHERE sr.repository_id <> s.repository_id LIMIT 1`,
  `SELECT 1 FROM reservation_prs rp JOIN stack_reservations sr ON sr.reservation_id = rp.reservation_id
   JOIN pull_requests p ON p.github_id = rp.pull_request_id WHERE sr.repository_id <> p.repository_id LIMIT 1`,
  `SELECT 1 FROM reservation_conflict_holds h JOIN stack_reservations sr ON sr.reservation_id = h.reservation_id
   WHERE h.repository_id <> sr.repository_id LIMIT 1`,
];
if (associationChecks.some((sql) => atlas.query(sql).get())) throw new Error("restored Repository, Session, PR, or reservation associations are inconsistent");

type RestoredSession = {
  atlas_id: string;
  repository_id: string;
  full_name: string;
  directory: string | null;
  preparation_checkpoint: string;
  opencode_session_id: string | null;
  initial_message_id: string | null;
};
const sessions = atlas.query(`SELECT s.atlas_id, s.repository_id, r.full_name, s.directory,
  s.preparation_checkpoint, s.opencode_session_id, s.initial_message_id
  FROM sessions s JOIN repositories r ON r.github_id = s.repository_id`).all() as RestoredSession[];
const sessionById = new Map(sessions.map((session) => [session.atlas_id, session]));
for (const session of sessions) {
  if (!session.directory || ["queued", "intent_saved"].includes(session.preparation_checkpoint)) continue;
  const prefix = "/var/lib/atlas/";
  if (!session.directory.startsWith(prefix)) throw new Error("a restored Session directory is outside the shared snapshot scope");
  const mapped = join(restoreRoot, session.directory.slice(prefix.length));
  const remainder = relative(restoreRoot, mapped);
  if (isAbsolute(remainder) || remainder.startsWith("..")) throw new Error("a restored Session directory escaped the rehearsal target");
  const stat = lstatSync(mapped);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("a recorded Session directory is missing from the restore");
  const git = lstatSync(join(mapped, ".git"));
  if (git.isSymbolicLink() || (!git.isDirectory() && !git.isFile())) throw new Error("a restored Session Git directory is unsafe");
}

const registry = JSON.parse(readFileSync(registryPath, "utf8")) as { version?: unknown; scopes?: unknown };
if (registry.version !== 1 || !Array.isArray(registry.scopes)) throw new Error("restored Session scope registry is malformed");
const scopedSessions = new Set<string>();
for (const value of registry.scopes) {
  if (!value || typeof value !== "object") throw new Error("restored Session scope registry is malformed");
  const scope = value as Record<string, unknown>;
  const session = typeof scope.atlasId === "string" ? sessionById.get(scope.atlasId) : undefined;
  if (!session || scope.repositoryId !== session.repository_id || scope.fullName !== session.full_name || scope.directory !== session.directory) {
    throw new Error("restored Session-to-Repository credential association is inconsistent");
  }
  if (scopedSessions.has(session.atlas_id)) throw new Error("restored Session scope registry contains duplicate associations");
  scopedSessions.add(session.atlas_id);
}
for (const session of sessions) {
  if (session.directory && !["queued", "intent_saved"].includes(session.preparation_checkpoint) && !scopedSessions.has(session.atlas_id)) {
    throw new Error("a restored prepared Session lacks its Repository credential association");
  }
}

const historyLines = readFileSync(historyManifestPath, "utf8").trim().split(/\r?\n/u).filter(Boolean);
if (historyLines.length === 0) throw new Error("conversation history manifest is empty");
const expectedHistory = new Map<string, { remote: string; message: string | null }>();
for (const line of historyLines) {
  const fields = line.split("\t");
  if (fields.length !== 3 || !/^ses_[0-9a-f-]+$/iu.test(fields[0]!) || !/^ses[^\s\u0000-\u001f]+$/u.test(fields[1]!) || (fields[2] !== "-" && !/^msg[^\s\u0000-\u001f]+$/u.test(fields[2]!))) {
    throw new Error("conversation history manifest is malformed");
  }
  if (expectedHistory.has(fields[0]!)) throw new Error("conversation history manifest contains duplicate Sessions");
  expectedHistory.set(fields[0]!, { remote: fields[1]!, message: fields[2] === "-" ? null : fields[2]! });
}
const associated = sessions.filter((session) => session.opencode_session_id);
if (associated.length !== expectedHistory.size) throw new Error("conversation history manifest does not cover every associated Session");
if (!associated.some((session) => session.initial_message_id)) throw new Error("no restored conversation contains a recorded initial message");
for (const session of associated) {
  const expected = expectedHistory.get(session.atlas_id);
  if (!expected || expected.remote !== session.opencode_session_id || expected.message !== session.initial_message_id) {
    throw new Error("restored Atlas/OpenCode history association differs from the pre-snapshot manifest");
  }
}

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const openCodeTables = (openCode.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(({ name }) => name);
const persistedInOpenCode = (needle: string) => openCodeTables.some((table) => {
  const columns = openCode.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  return columns.some(({ name }) => {
    try {
      return Boolean(openCode.query(`SELECT 1 FROM ${quoteIdentifier(table)} WHERE instr(CAST(${quoteIdentifier(name)} AS TEXT), ?) > 0 LIMIT 1`).get(needle));
    } catch {
      return false;
    }
  });
});
for (const expected of expectedHistory.values()) {
  if (!persistedInOpenCode(expected.remote) || (expected.message && !persistedInOpenCode(expected.message))) {
    throw new Error("restored OpenCode conversation history is incomplete");
  }
}

const counts = atlas.query(`SELECT
  (SELECT COUNT(*) FROM repositories) AS repositories,
  (SELECT COUNT(*) FROM sessions) AS sessions,
  (SELECT COUNT(*) FROM stack_reservations) AS reservations,
  (SELECT COUNT(*) FROM session_history) AS history`).get() as Record<string, number>;
atlas.close();
openCode.close();
console.log(`restore state verified: ${counts.repositories} Repositories, ${counts.sessions} Sessions, ${counts.reservations} reservations, ${counts.history} history records`);
