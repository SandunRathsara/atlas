import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export type AccessStatus = "available" | "unknown" | "revoked" | "transferred" | "suspended";
export type RefreshView = "access" | "specs";
export type RefreshAvailability = "never" | "available" | "partial" | "unavailable";

export type Repository = {
  githubId: string;
  installationId: string;
  organization: string;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  visibility: string | null;
  defaultBranch: string | null;
  archived: boolean;
  disabled: boolean;
  hasIssues: boolean;
  enrolledAt: string;
  removedAt: string | null;
  accessStatus: AccessStatus;
  accessReason: string | null;
};

export type Spec = {
  githubId: string;
  repositoryId: string;
  issueNumber: string;
  title: string;
  body: string;
  htmlUrl: string;
  state: "open" | "closed" | string;
  labels: string[];
  isPullRequest: boolean;
  hasSpecLabel: boolean;
  updatedAt: string | null;
  observedAt: string;
  isCurrent: boolean;
};

export type RefreshState = {
  repositoryId: string;
  view: RefreshView;
  requestedGeneration: number;
  completedGeneration: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  availability: RefreshAvailability;
  failureReason: string | null;
};

export type RepositoryInput = Omit<
  Repository,
  "enrolledAt" | "removedAt" | "accessStatus" | "accessReason"
> & {
  enrolledAt?: string;
  accessStatus?: AccessStatus;
  accessReason?: string | null;
};

export type SpecInput = Omit<Spec, "repositoryId" | "observedAt" | "isCurrent"> & {
  observedAt?: string;
};

export type SessionState =
  | "queued"
  | "preparing"
  | "running"
  | "waiting"
  | "idle"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "failed_setup";

export type SessionFilter = "active" | "all" | SessionState;

export type Session = {
  atlasId: string;
  repositoryId: string;
  specGithubId: string;
  specIssueNumber: string;
  specTitle: string;
  specBody: string;
  specHtmlUrl: string;
  submissionId: string;
  submissionOrder: number;
  submittedAt: string;
  prompt: string;
  targetKind: "default";
  targetBranch: string;
  state: SessionState;
  stateReason: string | null;
  directory: string | null;
  openCodeSessionId: string | null;
  initialMessageId: string | null;
  exactMessage: string | null;
  executionSlotHeld: boolean;
  updatedAt: string;
};

export type QueueSessionInput = {
  atlasId: string;
  repositoryId: string;
  spec: Pick<Spec, "githubId" | "issueNumber" | "title" | "body" | "htmlUrl">;
  submissionId: string;
  submissionOrderTime: string;
  prompt: string;
  targetKind: "default";
  targetBranch: string;
};

export type QueueSessionResult =
  | { kind: "created"; session: Session }
  | { kind: "existing"; session: Session }
  | { kind: "conflict"; session: Session }
  | { kind: "unfinished"; session: Session };

type PersistenceOptions = {
  path: string;
  now?: () => number;
};

type RepositoryRow = {
  github_id: string;
  installation_id: string;
  organization: string;
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  visibility: string | null;
  default_branch: string | null;
  archived: number;
  disabled: number;
  has_issues: number;
  enrolled_at: string;
  removed_at: string | null;
  access_status: AccessStatus;
  access_reason: string | null;
};

type SpecRow = {
  github_id: string;
  repository_id: string;
  issue_number: string;
  title: string;
  body: string;
  html_url: string;
  state: string;
  labels_json: string;
  is_pull_request: number;
  has_spec_label: number;
  updated_at: string | null;
  observed_at: string;
  is_current: number;
};

type RefreshRow = {
  repository_id: string;
  view: RefreshView;
  requested_generation: number;
  completed_generation: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  availability: RefreshAvailability;
  failure_reason: string | null;
};

type SessionRow = {
  atlas_id: string;
  repository_id: string;
  spec_github_id: string;
  spec_issue_number: string;
  spec_title: string;
  spec_body: string;
  spec_html_url: string;
  submission_id: string;
  submission_order: number;
  submitted_at: string;
  prompt: string;
  target_kind: "default";
  target_branch: string;
  state: SessionState;
  state_reason: string | null;
  directory: string | null;
  opencode_session_id: string | null;
  initial_message_id: string | null;
  exact_message: string | null;
  execution_slot_held: number;
  updated_at: string;
};

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE repositories (
        github_id TEXT PRIMARY KEY NOT NULL,
        installation_id TEXT NOT NULL,
        organization TEXT NOT NULL,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL,
        html_url TEXT NOT NULL,
        description TEXT,
        visibility TEXT,
        default_branch TEXT,
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        disabled INTEGER NOT NULL CHECK (disabled IN (0, 1)),
        has_issues INTEGER NOT NULL CHECK (has_issues IN (0, 1)),
        enrolled_at TEXT NOT NULL,
        removed_at TEXT,
        access_status TEXT NOT NULL CHECK (access_status IN ('available', 'unknown', 'revoked', 'transferred', 'suspended')),
        access_reason TEXT
      );

      CREATE TABLE specs (
        github_id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        issue_number TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        html_url TEXT NOT NULL,
        state TEXT NOT NULL,
        labels_json TEXT NOT NULL,
        is_pull_request INTEGER NOT NULL CHECK (is_pull_request IN (0, 1)),
        has_spec_label INTEGER NOT NULL CHECK (has_spec_label IN (0, 1)),
        updated_at TEXT,
        observed_at TEXT NOT NULL,
        is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
        UNIQUE (repository_id, issue_number)
      );

      CREATE TABLE refresh_state (
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        view TEXT NOT NULL CHECK (view IN ('access', 'specs')),
        requested_generation INTEGER NOT NULL DEFAULT 0,
        completed_generation INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        last_failure_at TEXT,
        availability TEXT NOT NULL DEFAULT 'never' CHECK (availability IN ('never', 'available', 'partial', 'unavailable')),
        failure_reason TEXT,
        PRIMARY KEY (repository_id, view)
      );

      CREATE INDEX specs_repository_current_idx
        ON specs (repository_id, is_current, state, has_spec_label, is_pull_request);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE specs ADD COLUMN was_spec INTEGER NOT NULL DEFAULT 0 CHECK (was_spec IN (0, 1));
      UPDATE specs
      SET was_spec = CASE WHEN is_pull_request = 0 AND has_spec_label = 1 THEN 1 ELSE 0 END;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE UNIQUE INDEX specs_repository_github_idx
        ON specs (repository_id, github_id);

      CREATE TABLE sessions (
        atlas_id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        spec_github_id TEXT NOT NULL,
        spec_issue_number TEXT NOT NULL,
        spec_title TEXT NOT NULL,
        spec_body TEXT NOT NULL,
        spec_html_url TEXT NOT NULL,
        submission_id TEXT NOT NULL UNIQUE,
        submission_order INTEGER NOT NULL UNIQUE CHECK (submission_order > 0),
        submitted_at TEXT NOT NULL,
        prompt TEXT NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind = 'default'),
        target_branch TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'preparing', 'running', 'waiting', 'idle', 'succeeded', 'failed', 'interrupted', 'failed_setup')),
        state_reason TEXT,
        directory TEXT,
        opencode_session_id TEXT,
        initial_message_id TEXT,
        exact_message TEXT,
        execution_slot_held INTEGER NOT NULL DEFAULT 0 CHECK (execution_slot_held IN (0, 1)),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (repository_id, spec_github_id) REFERENCES specs (repository_id, github_id),
        FOREIGN KEY (repository_id, spec_issue_number) REFERENCES specs (repository_id, issue_number)
      );

      CREATE UNIQUE INDEX sessions_unfinished_spec_idx
        ON sessions (spec_github_id)
        WHERE state IN ('queued', 'preparing', 'running', 'waiting', 'idle');

      CREATE INDEX sessions_repository_order_idx
        ON sessions (repository_id, submission_order DESC);

      CREATE INDEX sessions_spec_order_idx
        ON sessions (spec_github_id, submission_order DESC);
    `,
  },
];

const isoNow = (now: () => number) => new Date(now()).toISOString();

const toRepository = (row: RepositoryRow): Repository => ({
  githubId: row.github_id,
  installationId: row.installation_id,
  organization: row.organization,
  owner: row.owner,
  name: row.name,
  fullName: row.full_name,
  htmlUrl: row.html_url,
  description: row.description,
  visibility: row.visibility,
  defaultBranch: row.default_branch,
  archived: row.archived === 1,
  disabled: row.disabled === 1,
  hasIssues: row.has_issues === 1,
  enrolledAt: row.enrolled_at,
  removedAt: row.removed_at,
  accessStatus: row.access_status,
  accessReason: row.access_reason,
});

const toSpec = (row: SpecRow): Spec => {
  let labels: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.labels_json);
    if (Array.isArray(parsed) && parsed.every((label) => typeof label === "string")) {
      labels = parsed;
    }
  } catch {
    labels = [];
  }

  return {
    githubId: row.github_id,
    repositoryId: row.repository_id,
    issueNumber: row.issue_number,
    title: row.title,
    body: row.body,
    htmlUrl: row.html_url,
    state: row.state,
    labels,
    isPullRequest: row.is_pull_request === 1,
    hasSpecLabel: row.has_spec_label === 1,
    updatedAt: row.updated_at,
    observedAt: row.observed_at,
    isCurrent: row.is_current === 1,
  };
};

const toRefreshState = (row: RefreshRow): RefreshState => ({
  repositoryId: row.repository_id,
  view: row.view,
  requestedGeneration: row.requested_generation,
  completedGeneration: row.completed_generation,
  lastSuccessAt: row.last_success_at,
  lastFailureAt: row.last_failure_at,
  availability: row.availability,
  failureReason: row.failure_reason,
});

const toSession = (row: SessionRow): Session => ({
  atlasId: row.atlas_id,
  repositoryId: row.repository_id,
  specGithubId: row.spec_github_id,
  specIssueNumber: row.spec_issue_number,
  specTitle: row.spec_title,
  specBody: row.spec_body,
  specHtmlUrl: row.spec_html_url,
  submissionId: row.submission_id,
  submissionOrder: row.submission_order,
  submittedAt: row.submitted_at,
  prompt: row.prompt,
  targetKind: row.target_kind,
  targetBranch: row.target_branch,
  state: row.state,
  stateReason: row.state_reason,
  directory: row.directory,
  openCodeSessionId: row.opencode_session_id,
  initialMessageId: row.initial_message_id,
  exactMessage: row.exact_message,
  executionSlotHeld: row.execution_slot_held === 1,
  updatedAt: row.updated_at,
});

const integerPragma = (database: Database, pragma: string, expected: number) => {
  const row = database.query(`PRAGMA ${pragma}`).get() as Record<string, unknown> | null;
  return row && Object.values(row).some((value) => Number(value) === expected);
};

export const createPersistence = (options: PersistenceOptions) => {
  const now = options.now ?? Date.now;
  const isMemoryDatabase = options.path === ":memory:" || options.path.startsWith("file::memory:");

  if (!isMemoryDatabase) mkdirSync(dirname(options.path), { recursive: true });

  const database = new Database(options.path);
  database.exec("PRAGMA foreign_keys = ON");
  if (!integerPragma(database, "foreign_keys", 1)) {
    database.close();
    throw new Error("SQLite foreign keys could not be enabled");
  }

  const journal = database.query("PRAGMA journal_mode = WAL").get() as Record<string, unknown> | null;
  const journalMode = String(journal?.journal_mode ?? Object.values(journal ?? {})[0] ?? "").toLowerCase();
  if (!isMemoryDatabase && journalMode !== "wal") {
    database.close();
    throw new Error(`SQLite WAL mode was not enabled (effective mode: ${journalMode || "unknown"})`);
  }

  database.exec("PRAGMA synchronous = FULL");
  if (!integerPragma(database, "synchronous", 2)) {
    database.close();
    throw new Error("SQLite FULL synchronous mode could not be enabled");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedVersions = new Set(
    (database.query("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>)
      .map((row) => row.version),
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    const apply = database.transaction(() => {
      database.exec(migration.sql);
      database.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, isoNow(now));
    });
    apply();
  }

  const ensureRefreshState = (repositoryId: string, view: RefreshView) => {
    database.query(`
      INSERT INTO refresh_state (repository_id, view)
      VALUES (?, ?)
      ON CONFLICT (repository_id, view) DO NOTHING
    `).run(repositoryId, view);
  };

  const getRepository = (githubId: string) => {
    const row = database.query("SELECT * FROM repositories WHERE github_id = ?").get(githubId) as RepositoryRow | null;
    return row ? toRepository(row) : undefined;
  };

  const listRepositories = (includeRemoved = false) => {
    const rows = database.query(`
      SELECT * FROM repositories
      WHERE (? = 1 OR removed_at IS NULL)
      ORDER BY lower(full_name), github_id
    `).all(includeRemoved ? 1 : 0) as RepositoryRow[];
    return rows.map(toRepository);
  };

  const upsertRepository = (input: RepositoryInput) => {
    const enrolledAt = input.enrolledAt ?? isoNow(now);
    database.query(`
      INSERT INTO repositories (
        github_id, installation_id, organization, owner, name, full_name, html_url,
        description, visibility, default_branch, archived, disabled, has_issues,
        enrolled_at, access_status, access_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (github_id) DO UPDATE SET
        installation_id = excluded.installation_id,
        organization = excluded.organization,
        owner = excluded.owner,
        name = excluded.name,
        full_name = excluded.full_name,
        html_url = excluded.html_url,
        description = excluded.description,
        visibility = excluded.visibility,
        default_branch = excluded.default_branch,
        archived = excluded.archived,
        disabled = excluded.disabled,
        has_issues = excluded.has_issues,
        access_status = excluded.access_status,
        access_reason = excluded.access_reason
    `).run(
      input.githubId,
      input.installationId,
      input.organization,
      input.owner,
      input.name,
      input.fullName,
      input.htmlUrl,
      input.description,
      input.visibility,
      input.defaultBranch,
      input.archived ? 1 : 0,
      input.disabled ? 1 : 0,
      input.hasIssues ? 1 : 0,
      enrolledAt,
      input.accessStatus ?? "available",
      input.accessReason ?? null,
    );

    ensureRefreshState(input.githubId, "access");
    ensureRefreshState(input.githubId, "specs");
    return getRepository(input.githubId)!;
  };

  const updateAccess = (repositoryId: string, status: AccessStatus, reason: string | null) => {
    database.query(`
      UPDATE repositories SET access_status = ?, access_reason = ? WHERE github_id = ?
    `).run(status, reason, repositoryId);
  };

  const markRefreshSuccess = (repositoryId: string, view: RefreshView, reason: string | null = null) => {
    ensureRefreshState(repositoryId, view);
    const timestamp = isoNow(now);
    database.query(`
      UPDATE refresh_state
      SET completed_generation = requested_generation,
          last_success_at = ?,
          availability = 'available',
          failure_reason = ?
      WHERE repository_id = ? AND view = ?
    `).run(timestamp, reason, repositoryId, view);
  };

  const markRefreshFailure = (
    repositoryId: string,
    view: RefreshView,
    reason: string,
    availability: RefreshAvailability = "unavailable",
  ) => {
    ensureRefreshState(repositoryId, view);
    database.query(`
      UPDATE refresh_state
      SET last_failure_at = ?, availability = ?, failure_reason = ?
      WHERE repository_id = ? AND view = ?
    `).run(isoNow(now), availability, reason, repositoryId, view);
  };

  const getRefreshState = (repositoryId: string, view: RefreshView) => {
    ensureRefreshState(repositoryId, view);
    const row = database.query(`
      SELECT * FROM refresh_state WHERE repository_id = ? AND view = ?
    `).get(repositoryId, view) as RefreshRow | null;
    return row ? toRefreshState(row) : undefined;
  };

  const replaceSpecs = (
    repositoryId: string,
    specs: SpecInput[],
    observedAt = isoNow(now),
    refreshReason: string | null = null,
  ) => {
    const replace = database.transaction(() => {
      database.query("UPDATE specs SET is_current = 0 WHERE repository_id = ?").run(repositoryId);
      const upsert = database.query(`
        INSERT INTO specs (
          github_id, repository_id, issue_number, title, body, html_url, state,
          labels_json, is_pull_request, has_spec_label, updated_at, observed_at, is_current, was_spec
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (github_id) DO UPDATE SET
          repository_id = excluded.repository_id,
          issue_number = excluded.issue_number,
          title = excluded.title,
          body = excluded.body,
          html_url = excluded.html_url,
          state = excluded.state,
          labels_json = excluded.labels_json,
          is_pull_request = excluded.is_pull_request,
          has_spec_label = excluded.has_spec_label,
          updated_at = excluded.updated_at,
          observed_at = excluded.observed_at,
          is_current = 1,
          was_spec = CASE WHEN was_spec = 1 OR excluded.was_spec = 1 THEN 1 ELSE 0 END
      `);

      for (const spec of specs) {
        upsert.run(
          spec.githubId,
          repositoryId,
          spec.issueNumber,
          spec.title,
          spec.body,
          spec.htmlUrl,
          spec.state,
          JSON.stringify(spec.labels),
          spec.isPullRequest ? 1 : 0,
          spec.hasSpecLabel ? 1 : 0,
          spec.updatedAt,
          spec.observedAt ?? observedAt,
          spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest ? 1 : 0,
        );
      }

      ensureRefreshState(repositoryId, "specs");
      database.query(`
        UPDATE refresh_state
        SET completed_generation = requested_generation,
            last_success_at = ?,
            availability = 'available',
            failure_reason = ?
        WHERE repository_id = ? AND view = 'specs'
      `).run(isoNow(now), refreshReason, repositoryId);
    });
    replace();
  };

  const listSpecs = (repositoryId: string, currentOnly = true) => {
    const rows = database.query(`
      SELECT * FROM specs
      WHERE repository_id = ? AND was_spec = 1 AND (? = 0 OR (
        is_current = 1 AND state = 'open' AND has_spec_label = 1 AND is_pull_request = 0
      ))
      ORDER BY CAST(issue_number AS INTEGER), issue_number
    `).all(repositoryId, currentOnly ? 1 : 0) as SpecRow[];
    return rows.map(toSpec);
  };

  const getSpec = (repositoryId: string, issueNumber: string) => {
    const row = database.query(`
      SELECT * FROM specs WHERE repository_id = ? AND issue_number = ? AND was_spec = 1
    `).get(repositoryId, issueNumber) as SpecRow | null;
    return row ? toSpec(row) : undefined;
  };

  const getSession = (atlasId: string) => {
    const row = database.query("SELECT * FROM sessions WHERE atlas_id = ?").get(atlasId) as SessionRow | null;
    return row ? toSession(row) : undefined;
  };

  const getSessionBySubmissionId = (submissionId: string) => {
    const row = database.query("SELECT * FROM sessions WHERE submission_id = ?").get(submissionId) as SessionRow | null;
    return row ? toSession(row) : undefined;
  };

  const queueSession = (input: QueueSessionInput): QueueSessionResult => {
    let result: QueueSessionResult;
    const queue = database.transaction(() => {
      const existingRow = database.query(
        "SELECT * FROM sessions WHERE submission_id = ?",
      ).get(input.submissionId) as SessionRow | null;

      if (existingRow) {
        const existing = toSession(existingRow);
        const sameSubmission = existing.repositoryId === input.repositoryId &&
          existing.specGithubId === input.spec.githubId &&
          existing.specIssueNumber === input.spec.issueNumber &&
          existing.prompt === input.prompt;
        result = { kind: sameSubmission ? "existing" : "conflict", session: existing };
        return;
      }

      const unfinishedRow = database.query(`
        SELECT * FROM sessions
        WHERE spec_github_id = ?
          AND state IN ('queued', 'preparing', 'running', 'waiting', 'idle')
        ORDER BY submission_order
        LIMIT 1
      `).get(input.spec.githubId) as SessionRow | null;

      if (unfinishedRow) {
        result = { kind: "unfinished", session: toSession(unfinishedRow) };
        return;
      }

      const orderRow = database.query(
        "SELECT COALESCE(MAX(submission_order), 0) + 1 AS next_order FROM sessions",
      ).get() as { next_order: number };
      const submittedAt = input.submissionOrderTime;
      database.query(`
        INSERT INTO sessions (
          atlas_id, repository_id, spec_github_id, spec_issue_number, spec_title,
          spec_body, spec_html_url, submission_id, submission_order, submitted_at,
          prompt, target_kind, target_branch, state, state_reason, execution_slot_held,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?)
      `).run(
        input.atlasId,
        input.repositoryId,
        input.spec.githubId,
        input.spec.issueNumber,
        input.spec.title,
        input.spec.body,
        input.spec.htmlUrl,
        input.submissionId,
        orderRow.next_order,
        submittedAt,
        input.prompt,
        input.targetKind,
        input.targetBranch,
        "Awaiting downstream preparation.",
        submittedAt,
      );

      result = { kind: "created", session: getSession(input.atlasId)! };
    });
    queue.immediate();
    return result!;
  };

  const listSessions = (repositoryId: string, filter: SessionFilter = "active") => {
    const activeStates = "('queued', 'preparing', 'running', 'waiting', 'idle')";
    if (filter === "active") {
      const rows = database.query(`
        SELECT * FROM sessions
        WHERE repository_id = ? AND state IN ${activeStates}
        ORDER BY submission_order DESC
      `).all(repositoryId) as SessionRow[];
      return rows.map(toSession);
    }

    if (filter === "all") {
      const rows = database.query(`
        SELECT * FROM sessions
        WHERE repository_id = ?
        ORDER BY submission_order DESC
      `).all(repositoryId) as SessionRow[];
      return rows.map(toSession);
    }

    const rows = database.query(`
      SELECT * FROM sessions
      WHERE repository_id = ? AND state = ?
      ORDER BY submission_order DESC
    `).all(repositoryId, filter) as SessionRow[];
    return rows.map(toSession);
  };

  const listSessionsForSpec = (repositoryId: string, issueNumber: string) => {
    const rows = database.query(`
      SELECT * FROM sessions
      WHERE repository_id = ? AND spec_issue_number = ?
      ORDER BY submission_order DESC
    `).all(repositoryId, issueNumber) as SessionRow[];
    return rows.map(toSession);
  };

  return {
    database,
    close: () => database.close(),
    getRepository,
    listRepositories,
    upsertRepository,
    updateAccess,
    markRefreshSuccess,
    markRefreshFailure,
    getRefreshState,
    replaceSpecs,
    listSpecs,
    getSpec,
    getSession,
    getSessionBySubmissionId,
    queueSession,
    listSessions,
    listSessionsForSpec,
  };
};

export type Persistence = ReturnType<typeof createPersistence>;
