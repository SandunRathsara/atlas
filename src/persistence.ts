import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export type AccessStatus = "available" | "unknown" | "revoked" | "transferred" | "suspended";
export type RefreshView = "access" | "specs" | "pullRequests";
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

export type StackMembership = {
  stackId: string;
  stackNodeId: string | null;
  stackNumber: string;
  position: number;
  size: number;
  trunkRef: string | null;
};

export type PullRequest = {
  githubId: string;
  repositoryId: string;
  number: string;
  title: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  mergedAt: string | null;
  headRef: string;
  headSha: string;
  headRepositoryId: string | null;
  baseRef: string;
  baseSha: string;
  mergeableState: string | null;
  autoMergeEnabled: boolean | null;
  mergeQueueState: string | null;
  headRefExists: boolean | null;
  observedHeadSha: string | null;
  updatedAt: string | null;
  observedAt: string;
  isCurrent: boolean;
  stack: StackMembership | null;
};

export type PrStackMember = {
  pullRequestId: string;
  position: number;
};

export type PrStack = {
  githubId: string;
  repositoryId: string;
  nodeId: string | null;
  number: string;
  trunkRef: string | null;
  open: boolean | null;
  observedAt: string;
  isCurrent: boolean;
  members: PrStackMember[];
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

export type PullRequestInput = Omit<PullRequest, "repositoryId" | "observedAt" | "isCurrent" | "stack"> & {
  observedAt?: string;
};

export type PrStackInput = Omit<PrStack, "repositoryId" | "observedAt" | "isCurrent" | "members"> & {
  members: PrStackMember[];
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

export type PreparationCheckpoint =
  | "queued"
  | "intent_saved"
  | "clone_started"
  | "clone_complete"
  | "branch_started"
  | "prepared"
  | "start_unconfirmed"
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
  baseBranch: string | null;
  baseSha: string | null;
  workingBranch: string | null;
  preparationCheckpoint: PreparationCheckpoint;
  preparationReason: string | null;
  preparedAt: string | null;
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

export type PreparationIntent = {
  directory: string;
  baseBranch: string;
  baseSha: string;
  workingBranch: string;
};

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

type PullRequestRow = {
  github_id: string;
  repository_id: string;
  number: string;
  title: string;
  html_url: string;
  state: string;
  draft: number;
  merged_at: string | null;
  head_ref: string;
  head_sha: string;
  head_repository_id: string | null;
  base_ref: string;
  base_sha: string;
  mergeable_state: string | null;
  auto_merge_enabled: number | null;
  merge_queue_state: string | null;
  head_ref_exists: number | null;
  observed_head_sha: string | null;
  updated_at: string | null;
  observed_at: string;
  is_current: number;
  stack_id: string | null;
  stack_node_id: string | null;
  stack_number: string | null;
  stack_position: number | null;
  stack_size: number | null;
  stack_trunk_ref: string | null;
};

type StackRow = {
  github_id: string;
  repository_id: string;
  node_id: string | null;
  number: string;
  trunk_ref: string | null;
  open: number | null;
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
  base_branch: string | null;
  base_sha: string | null;
  working_branch: string | null;
  preparation_checkpoint: PreparationCheckpoint;
  preparation_reason: string | null;
  prepared_at: string | null;
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
      CREATE TABLE refresh_state_next (
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        view TEXT NOT NULL CHECK (view IN ('access', 'specs', 'pullRequests')),
        requested_generation INTEGER NOT NULL DEFAULT 0,
        completed_generation INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        last_failure_at TEXT,
        availability TEXT NOT NULL DEFAULT 'never' CHECK (availability IN ('never', 'available', 'partial', 'unavailable')),
        failure_reason TEXT,
        PRIMARY KEY (repository_id, view)
      );

      INSERT INTO refresh_state_next
      SELECT repository_id, view, requested_generation, completed_generation,
             last_success_at, last_failure_at, availability, failure_reason
      FROM refresh_state;
      DROP TABLE refresh_state;
      ALTER TABLE refresh_state_next RENAME TO refresh_state;

      CREATE TABLE pull_requests (
        github_id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        number TEXT NOT NULL,
        title TEXT NOT NULL,
        html_url TEXT NOT NULL,
        state TEXT NOT NULL,
        draft INTEGER NOT NULL CHECK (draft IN (0, 1)),
        merged_at TEXT,
        head_ref TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        mergeable_state TEXT,
        auto_merge_enabled INTEGER CHECK (auto_merge_enabled IS NULL OR auto_merge_enabled IN (0, 1)),
        merge_queue_state TEXT,
        head_ref_exists INTEGER CHECK (head_ref_exists IS NULL OR head_ref_exists IN (0, 1)),
        observed_head_sha TEXT,
        updated_at TEXT,
        observed_at TEXT NOT NULL,
        is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
        UNIQUE (repository_id, number)
      );

      CREATE TABLE pr_stacks (
        github_id TEXT PRIMARY KEY NOT NULL,
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        node_id TEXT,
        number TEXT NOT NULL,
        trunk_ref TEXT,
        open INTEGER CHECK (open IS NULL OR open IN (0, 1)),
        observed_at TEXT NOT NULL,
        is_current INTEGER NOT NULL CHECK (is_current IN (0, 1))
      );

      CREATE TABLE stack_members (
        stack_id TEXT NOT NULL REFERENCES pr_stacks (github_id) ON DELETE CASCADE,
        pull_request_id TEXT NOT NULL REFERENCES pull_requests (github_id),
        position INTEGER NOT NULL CHECK (position > 0),
        PRIMARY KEY (stack_id, pull_request_id),
        UNIQUE (stack_id, position),
        UNIQUE (pull_request_id)
      );

      CREATE INDEX pull_requests_repository_current_idx
        ON pull_requests (repository_id, is_current, state, number);
      CREATE INDEX pr_stacks_repository_current_idx
        ON pr_stacks (repository_id, is_current, number);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE pull_requests ADD COLUMN head_repository_id TEXT;
      CREATE UNIQUE INDEX pr_stacks_repository_number_unique
        ON pr_stacks (repository_id, number);
    `,
  },
  {
    version: 5,
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
  {
    version: 6,
    sql: `
      ALTER TABLE sessions ADD COLUMN base_branch TEXT;
      ALTER TABLE sessions ADD COLUMN base_sha TEXT;
      ALTER TABLE sessions ADD COLUMN working_branch TEXT;
      ALTER TABLE sessions ADD COLUMN preparation_checkpoint TEXT NOT NULL DEFAULT 'queued'
        CHECK (preparation_checkpoint IN ('queued', 'intent_saved', 'clone_started', 'clone_complete', 'branch_started', 'prepared', 'start_unconfirmed', 'failed_setup'));
      ALTER TABLE sessions ADD COLUMN preparation_reason TEXT;
      ALTER TABLE sessions ADD COLUMN prepared_at TEXT;
      CREATE UNIQUE INDEX sessions_repository_working_branch_idx
        ON sessions (repository_id, working_branch)
        WHERE working_branch IS NOT NULL;
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE sessions ADD COLUMN admission_blocked INTEGER NOT NULL DEFAULT 0
        CHECK (admission_blocked IN (0, 1));
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

const toPullRequest = (row: PullRequestRow): PullRequest => ({
  githubId: row.github_id,
  repositoryId: row.repository_id,
  number: row.number,
  title: row.title,
  htmlUrl: row.html_url,
  state: row.state,
  draft: row.draft === 1,
  mergedAt: row.merged_at,
  headRef: row.head_ref,
  headSha: row.head_sha,
  headRepositoryId: row.head_repository_id,
  baseRef: row.base_ref,
  baseSha: row.base_sha,
  mergeableState: row.mergeable_state,
  autoMergeEnabled: row.auto_merge_enabled === null ? null : row.auto_merge_enabled === 1,
  mergeQueueState: row.merge_queue_state,
  headRefExists: row.head_ref_exists === null ? null : row.head_ref_exists === 1,
  observedHeadSha: row.observed_head_sha,
  updatedAt: row.updated_at,
  observedAt: row.observed_at,
  isCurrent: row.is_current === 1,
  stack: row.stack_id === null || row.stack_number === null || row.stack_position === null || row.stack_size === null
    ? null
    : {
      stackId: row.stack_id,
      stackNodeId: row.stack_node_id,
      stackNumber: row.stack_number,
      position: row.stack_position,
      size: row.stack_size,
      trunkRef: row.stack_trunk_ref,
    },
});

const toStack = (row: StackRow, members: PrStackMember[]): PrStack => ({
  githubId: row.github_id,
  repositoryId: row.repository_id,
  nodeId: row.node_id,
  number: row.number,
  trunkRef: row.trunk_ref,
  open: row.open === null ? null : row.open === 1,
  observedAt: row.observed_at,
  isCurrent: row.is_current === 1,
  members,
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
  baseBranch: row.base_branch,
  baseSha: row.base_sha,
  workingBranch: row.working_branch,
  preparationCheckpoint: row.preparation_checkpoint,
  preparationReason: row.preparation_reason,
  preparedAt: row.prepared_at,
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

  const replacePullRequests = (
    repositoryId: string,
    pullRequests: PullRequestInput[],
    stacks: PrStackInput[],
    observedAt = isoNow(now),
    refreshReason: string | null = null,
  ) => {
    const replace = database.transaction(() => {
      for (const pullRequest of pullRequests) {
        const existing = database.query(`
          SELECT repository_id FROM pull_requests WHERE github_id = ?
        `).get(pullRequest.githubId) as { repository_id: string } | null;
        if (existing && existing.repository_id !== repositoryId) {
          throw new Error("Pull request identity cannot move between Repositories");
        }
      }
      for (const stack of stacks) {
        const existing = database.query(`
          SELECT repository_id FROM pr_stacks WHERE github_id = ?
        `).get(stack.githubId) as { repository_id: string } | null;
        if (existing && existing.repository_id !== repositoryId) {
          throw new Error("Native stack identity cannot move between Repositories");
        }
      }

      database.query("UPDATE pull_requests SET is_current = 0 WHERE repository_id = ?").run(repositoryId);
      database.query("UPDATE pr_stacks SET is_current = 0 WHERE repository_id = ?").run(repositoryId);
      database.query(`
        DELETE FROM stack_members
        WHERE stack_id IN (SELECT github_id FROM pr_stacks WHERE repository_id = ?)
      `).run(repositoryId);

      const upsertPullRequest = database.query(`
        INSERT INTO pull_requests (
          github_id, repository_id, number, title, html_url, state, draft, merged_at,
          head_ref, head_sha, head_repository_id, base_ref, base_sha, mergeable_state, auto_merge_enabled,
          merge_queue_state, head_ref_exists, observed_head_sha, updated_at, observed_at, is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT (github_id) DO UPDATE SET
          number = excluded.number,
          title = excluded.title,
          html_url = excluded.html_url,
          state = excluded.state,
          draft = excluded.draft,
          merged_at = excluded.merged_at,
          head_ref = excluded.head_ref,
          head_sha = excluded.head_sha,
          head_repository_id = excluded.head_repository_id,
          base_ref = excluded.base_ref,
          base_sha = excluded.base_sha,
          mergeable_state = excluded.mergeable_state,
          auto_merge_enabled = excluded.auto_merge_enabled,
          merge_queue_state = excluded.merge_queue_state,
          head_ref_exists = excluded.head_ref_exists,
          observed_head_sha = excluded.observed_head_sha,
          updated_at = excluded.updated_at,
          observed_at = excluded.observed_at,
          is_current = 1
      `);

      for (const pullRequest of pullRequests) {
        upsertPullRequest.run(
          pullRequest.githubId,
          repositoryId,
          pullRequest.number,
          pullRequest.title,
          pullRequest.htmlUrl,
          pullRequest.state,
          pullRequest.draft ? 1 : 0,
          pullRequest.mergedAt,
          pullRequest.headRef,
          pullRequest.headSha,
          pullRequest.headRepositoryId,
          pullRequest.baseRef,
          pullRequest.baseSha,
          pullRequest.mergeableState,
          pullRequest.autoMergeEnabled === null ? null : pullRequest.autoMergeEnabled ? 1 : 0,
          pullRequest.mergeQueueState,
          pullRequest.headRefExists === null ? null : pullRequest.headRefExists ? 1 : 0,
          pullRequest.observedHeadSha,
          pullRequest.updatedAt,
          pullRequest.observedAt ?? observedAt,
        );
      }

      const upsertStack = database.query(`
        INSERT INTO pr_stacks (
          github_id, repository_id, node_id, number, trunk_ref, open, observed_at, is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT (github_id) DO UPDATE SET
          node_id = excluded.node_id,
          number = excluded.number,
          trunk_ref = excluded.trunk_ref,
          open = excluded.open,
          observed_at = excluded.observed_at,
          is_current = 1
      `);
      const insertMember = database.query(`
        INSERT INTO stack_members (stack_id, pull_request_id, position) VALUES (?, ?, ?)
      `);

      for (const stack of stacks) {
        upsertStack.run(
          stack.githubId,
          repositoryId,
          stack.nodeId,
          stack.number,
          stack.trunkRef,
          stack.open === null ? null : stack.open ? 1 : 0,
          stack.observedAt ?? observedAt,
        );

        for (const member of stack.members) {
          const exists = database.query(`
            SELECT 1 FROM pull_requests WHERE github_id = ? AND repository_id = ?
          `).get(member.pullRequestId, repositoryId);
          if (!exists) throw new Error("Native stack references an unprojected pull request");
          insertMember.run(stack.githubId, member.pullRequestId, member.position);
        }
      }

      ensureRefreshState(repositoryId, "pullRequests");
      database.query(`
        UPDATE refresh_state
        SET completed_generation = requested_generation,
            last_success_at = ?,
            availability = 'available',
            failure_reason = ?
        WHERE repository_id = ? AND view = 'pullRequests'
      `).run(isoNow(now), refreshReason, repositoryId);
    });
    replace();
  };

  const listPullRequests = (repositoryId: string, currentOnly = true) => {
    const rows = database.query(`
      SELECT p.*,
             s.github_id AS stack_id,
             s.node_id AS stack_node_id,
             s.number AS stack_number,
             sm.position AS stack_position,
             (SELECT COUNT(*) FROM stack_members sm2 WHERE sm2.stack_id = s.github_id) AS stack_size,
             s.trunk_ref AS stack_trunk_ref
      FROM pull_requests p
      LEFT JOIN stack_members sm ON sm.pull_request_id = p.github_id
      LEFT JOIN pr_stacks s ON s.github_id = sm.stack_id AND s.is_current = 1
      WHERE p.repository_id = ? AND (? = 0 OR p.is_current = 1)
      ORDER BY CAST(p.number AS INTEGER), p.number
    `).all(repositoryId, currentOnly ? 1 : 0) as PullRequestRow[];
    return rows.map(toPullRequest);
  };

  const listPrStacks = (repositoryId: string, currentOnly = true) => {
    const stacks = database.query(`
      SELECT * FROM pr_stacks
      WHERE repository_id = ? AND (? = 0 OR is_current = 1)
      ORDER BY CAST(number AS INTEGER), number
    `).all(repositoryId, currentOnly ? 1 : 0) as StackRow[];
    const memberRows = database.query(`
      SELECT sm.stack_id, sm.pull_request_id, sm.position
      FROM stack_members sm
      JOIN pr_stacks s ON s.github_id = sm.stack_id
      WHERE s.repository_id = ? AND (? = 0 OR s.is_current = 1)
      ORDER BY sm.stack_id, sm.position
    `).all(repositoryId, currentOnly ? 1 : 0) as Array<{
      stack_id: string;
      pull_request_id: string;
      position: number;
    }>;
    const membersByStack = new Map<string, PrStackMember[]>();
    for (const member of memberRows) {
      const members = membersByStack.get(member.stack_id) ?? [];
      members.push({ pullRequestId: member.pull_request_id, position: member.position });
      membersByStack.set(member.stack_id, members);
    }
    return stacks.map((stack) => toStack(stack, membersByStack.get(stack.github_id) ?? []));
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

  const listQueuedSessions = () => {
    const rows = database.query(`
      SELECT * FROM sessions
      WHERE state = 'queued'
      ORDER BY submission_order ASC
    `).all() as SessionRow[];
    return rows.map(toSession);
  };

  const listPreparingSessions = () => {
    const rows = database.query(`
      SELECT * FROM sessions
      WHERE state = 'preparing'
      ORDER BY submission_order ASC
    `).all() as SessionRow[];
    return rows.map(toSession);
  };

  const claimPreparation = (
    atlasId: string,
    intent: PreparationIntent,
    globalCapacity: number,
    freshlyVerified = false,
  ) => {
    if (!Number.isSafeInteger(globalCapacity) || globalCapacity < 1) {
      throw new Error("Global Session capacity must be a positive safe integer");
    }

    let claimed: Session | undefined;
    const claim = database.transaction(() => {
      const held = database.query(`
        SELECT COUNT(*) AS count
        FROM sessions
        WHERE execution_slot_held = 1
          AND state IN ('preparing', 'running', 'waiting', 'idle')
      `).get() as { count: number };
      if (held.count >= globalCapacity) return;

      if (freshlyVerified) {
        database.query(`
          UPDATE sessions
          SET admission_blocked = 0
          WHERE atlas_id = ? AND state = 'queued'
        `).run(atlasId);
      }

      const eligible = database.query(`
        WITH locally_eligible AS (
          SELECT s.atlas_id, s.submission_order
          FROM sessions s
          JOIN repositories r ON r.github_id = s.repository_id
          JOIN specs sp ON sp.repository_id = s.repository_id AND sp.github_id = s.spec_github_id
            AND sp.issue_number = s.spec_issue_number
          WHERE s.state = 'queued'
            AND r.removed_at IS NULL
            AND r.access_status = 'available'
            AND r.archived = 0
            AND r.disabled = 0
            AND r.has_issues = 1
            AND r.default_branch IS NOT NULL
            AND r.default_branch = s.target_branch
            AND sp.is_current = 1
            AND sp.state = 'open'
            AND sp.has_spec_label = 1
            AND sp.is_pull_request = 0
            AND s.admission_blocked = 0
        )
        SELECT s.*
        FROM sessions s
        JOIN locally_eligible candidate ON candidate.atlas_id = s.atlas_id
        WHERE s.atlas_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM locally_eligible older
            WHERE older.submission_order < candidate.submission_order
          )
      `).get(atlasId) as SessionRow | null;
      if (!eligible) return;

      const timestamp = isoNow(now);
      database.query(`
        UPDATE sessions
        SET state = 'preparing',
            state_reason = ?,
            directory = ?,
            base_branch = ?,
            base_sha = ?,
            working_branch = ?,
            preparation_checkpoint = 'intent_saved',
            preparation_reason = ?,
            prepared_at = NULL,
            execution_slot_held = 1,
            updated_at = ?
        WHERE atlas_id = ? AND state = 'queued'
      `).run(
        "Preparation admitted; local clone has not started.",
        intent.directory,
        intent.baseBranch,
        intent.baseSha,
        intent.workingBranch,
        "Preparation intent durably saved before filesystem work.",
        timestamp,
        atlasId,
      );
      claimed = getSession(atlasId);
    });
    claim.immediate();
    return claimed;
  };

  const setPreparationCheckpoint = (
    atlasId: string,
    checkpoint: PreparationCheckpoint,
    reason: string,
    stateReason = reason,
  ) => {
    const preparedAt = checkpoint === "prepared" ? isoNow(now) : null;
    database.query(`
      UPDATE sessions
      SET preparation_checkpoint = ?,
          preparation_reason = ?,
          state_reason = ?,
          prepared_at = ?,
          updated_at = ?
      WHERE atlas_id = ? AND state = 'preparing'
    `).run(checkpoint, reason, stateReason, preparedAt, isoNow(now), atlasId);
    return getSession(atlasId);
  };

  const setQueuedSessionReason = (atlasId: string, reason: string) => {
    database.query(`
      UPDATE sessions
      SET state_reason = ?, preparation_reason = ?, updated_at = ?
      WHERE atlas_id = ? AND state = 'queued'
    `).run(reason, reason, isoNow(now), atlasId);
    return getSession(atlasId);
  };

  const requeuePreparation = (atlasId: string, reason: string) => {
    const requeue = database.transaction(() => {
      database.query(`
        UPDATE sessions
        SET state = 'queued',
            state_reason = ?,
            preparation_checkpoint = 'queued',
            preparation_reason = ?,
            prepared_at = NULL,
            admission_blocked = 0,
            execution_slot_held = 0,
            updated_at = ?
        WHERE atlas_id = ?
          AND state = 'preparing'
          AND preparation_checkpoint = 'intent_saved'
      `).run(reason, reason, isoNow(now), atlasId);
    });
    requeue.immediate();
    return getSession(atlasId);
  };

  const blockQueuedPreparation = (atlasId: string, reason: string) => {
    database.query(`
      UPDATE sessions
      SET admission_blocked = 1,
          state_reason = ?,
          preparation_reason = ?,
          updated_at = ?
      WHERE atlas_id = ? AND state = 'queued'
    `).run(reason, reason, isoNow(now), atlasId);
    return getSession(atlasId);
  };

  const failPreparation = (atlasId: string, reason: string) => {
    const fail = database.transaction(() => {
      database.query(`
        UPDATE sessions
        SET state = 'failed_setup',
            state_reason = ?,
            preparation_checkpoint = 'failed_setup',
            preparation_reason = ?,
            prepared_at = NULL,
            execution_slot_held = 0,
            updated_at = ?
        WHERE atlas_id = ? AND state = 'preparing'
      `).run(reason, reason, isoNow(now), atlasId);
    });
    fail.immediate();
    return getSession(atlasId);
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
    replacePullRequests,
    listPullRequests,
    listPrStacks,
    listSpecs,
    getSpec,
    getSession,
    getSessionBySubmissionId,
    queueSession,
    listQueuedSessions,
    listPreparingSessions,
    claimPreparation,
    setPreparationCheckpoint,
    setQueuedSessionReason,
    blockQueuedPreparation,
    requeuePreparation,
    failPreparation,
    listSessions,
    listSessionsForSpec,
  };
};

export type Persistence = ReturnType<typeof createPersistence>;
