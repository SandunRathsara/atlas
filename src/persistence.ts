import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export type AccessStatus = "available" | "unknown" | "revoked" | "transferred" | "suspended";
export type RefreshView = "access" | "specs" | "pullRequests";
export type RefreshAvailability = "never" | "available" | "partial" | "unavailable";
export const refreshViews: RefreshView[] = ["access", "specs", "pullRequests"];

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

export type HandoffCheckpoint =
  | "not_started"
  | "intent_saved"
  | "events_consuming"
  | "create_sent"
  | "create_confirmed"
  | "associated"
  | "prompt_sent"
  | "prompt_accepted";

export type OpenCodeFreshness = "unknown" | "fresh" | "stale";

export type SessionFilter = "active" | "all" | SessionState;

export type TargetKind = "default" | "native_stack" | "standalone_parent";

export type SessionTarget = {
  kind: TargetKind;
  stackId?: string | null;
  stackNumber?: string | null;
  parentPullRequestId?: string | null;
  parentPullRequestNumber?: string | null;
};

export type ResolvedTarget = {
  kind: TargetKind;
  stackId: string | null;
  stackNumber: string | null;
  parentPullRequestId: string | null;
  parentPullRequestNumber: string | null;
  parentPullRequestUrl: string | null;
  parentBranch: string;
  trunkBranch: string;
  layers: Array<{
    pullRequestId: string;
    pullRequestNumber: string;
    branch: string;
    sha: string;
  }>;
};

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
  targetKind: TargetKind;
  targetBranch: string;
  originalTargetBranch: string;
  targetStackId: string | null;
  targetStackNumber: string | null;
  targetParentPullRequestId: string | null;
  targetParentPullRequestNumber: string | null;
  originalTargetKind: TargetKind;
  originalTargetStackId: string | null;
  originalTargetStackNumber: string | null;
  originalTargetParentPullRequestId: string | null;
  originalTargetParentPullRequestNumber: string | null;
  state: SessionState;
  stateReason: string | null;
  directory: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  workingBranch: string | null;
  resolvedStackId: string | null;
  resolvedStackNumber: string | null;
  resolvedParentPullRequestId: string | null;
  resolvedParentPullRequestNumber: string | null;
  resolvedParentPullRequestUrl: string | null;
  resolvedParentBranch: string | null;
  resolvedTrunkBranch: string | null;
  resolvedLayers: ResolvedTarget["layers"];
  preparationCheckpoint: PreparationCheckpoint;
  preparationReason: string | null;
  preparedAt: string | null;
  handoffCheckpoint: HandoffCheckpoint;
  opencodeIntendedSessionId: string | null;
  openCodeSessionId: string | null;
  initialMessageId: string | null;
  initialInboxId: string | null;
  exactMessage: string | null;
  handoffUncertainReason: string | null;
  opencodeFreshness: OpenCodeFreshness;
  opencodeLastSuccessAt: string | null;
  opencodeLastFailureAt: string | null;
  executionSlotHeld: boolean;
  reservationId: string | null;
  reservationState: "held" | "released" | null;
  reservationReason: string | null;
  updatedAt: string;
};

export type QueueSessionInput = {
  atlasId: string;
  repositoryId: string;
  spec: Pick<Spec, "githubId" | "issueNumber" | "title" | "body" | "htmlUrl">;
  submissionId: string;
  submissionOrderTime: string;
  prompt: string;
  targetKind: TargetKind;
  targetBranch: string;
  target?: SessionTarget;
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
  target?: SessionTarget;
  resolvedTarget?: ResolvedTarget;
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
  target_kind: TargetKind;
  target_branch: string;
  target_stack_id: string | null;
  target_stack_number: string | null;
  target_parent_pull_request_id: string | null;
  target_parent_pull_request_number: string | null;
  original_target_kind: TargetKind;
  original_target_branch: string;
  original_target_stack_id: string | null;
  original_target_stack_number: string | null;
  original_target_parent_pull_request_id: string | null;
  original_target_parent_pull_request_number: string | null;
  state: SessionState;
  state_reason: string | null;
  directory: string | null;
  base_branch: string | null;
  base_sha: string | null;
  working_branch: string | null;
  resolved_stack_id: string | null;
  resolved_stack_number: string | null;
  resolved_parent_pull_request_id: string | null;
  resolved_parent_pull_request_number: string | null;
  resolved_parent_pull_request_url: string | null;
  resolved_parent_branch: string | null;
  resolved_trunk_branch: string | null;
  resolved_layers_json: string | null;
  preparation_checkpoint: PreparationCheckpoint;
  preparation_reason: string | null;
  prepared_at: string | null;
  handoff_checkpoint: HandoffCheckpoint;
  opencode_intended_session_id: string | null;
  opencode_session_id: string | null;
  initial_message_id: string | null;
  initial_inbox_id: string | null;
  exact_message: string | null;
  handoff_uncertain_reason: string | null;
  opencode_freshness: OpenCodeFreshness;
  opencode_last_success_at: string | null;
  opencode_last_failure_at: string | null;
  execution_slot_held: number;
  reservation_id?: string | null;
  reservation_state?: "held" | "released" | null;
  reservation_reason?: string | null;
  updated_at: string;
};

const sessionsMigrationSql = `
      CREATE UNIQUE INDEX IF NOT EXISTS specs_repository_github_idx
        ON specs (repository_id, github_id);

      CREATE TABLE IF NOT EXISTS sessions (
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

      CREATE UNIQUE INDEX IF NOT EXISTS sessions_unfinished_spec_idx
        ON sessions (spec_github_id)
        WHERE state IN ('queued', 'preparing', 'running', 'waiting', 'idle');

      CREATE INDEX IF NOT EXISTS sessions_repository_order_idx
        ON sessions (repository_id, submission_order DESC);

      CREATE INDEX IF NOT EXISTS sessions_spec_order_idx
        ON sessions (spec_github_id, submission_order DESC);
    `;

const webhookMigrationSql = `
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        delivery_id TEXT PRIMARY KEY NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS webhook_deliveries_received_idx
        ON webhook_deliveries (received_at);
    `;

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
    sql: sessionsMigrationSql,
  },
  {
    version: 6,
    sql: webhookMigrationSql,
  },
  {
    version: 7,
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
    version: 8,
    sql: `
      ALTER TABLE sessions ADD COLUMN admission_blocked INTEGER NOT NULL DEFAULT 0
        CHECK (admission_blocked IN (0, 1));
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE sessions ADD COLUMN handoff_checkpoint TEXT NOT NULL DEFAULT 'not_started'
        CHECK (handoff_checkpoint IN ('not_started', 'intent_saved', 'events_consuming', 'create_sent', 'create_confirmed', 'associated', 'prompt_sent', 'prompt_accepted'));
      ALTER TABLE sessions ADD COLUMN opencode_intended_session_id TEXT;
      ALTER TABLE sessions ADD COLUMN initial_inbox_id TEXT;
      ALTER TABLE sessions ADD COLUMN handoff_uncertain_reason TEXT;
      ALTER TABLE sessions ADD COLUMN opencode_freshness TEXT NOT NULL DEFAULT 'unknown'
        CHECK (opencode_freshness IN ('unknown', 'fresh', 'stale'));
      ALTER TABLE sessions ADD COLUMN opencode_last_success_at TEXT;
      ALTER TABLE sessions ADD COLUMN opencode_last_failure_at TEXT;
      CREATE UNIQUE INDEX sessions_opencode_intended_session_idx
        ON sessions (opencode_intended_session_id)
        WHERE opencode_intended_session_id IS NOT NULL;
      CREATE UNIQUE INDEX sessions_opencode_session_idx
        ON sessions (opencode_session_id)
        WHERE opencode_session_id IS NOT NULL;
      CREATE UNIQUE INDEX sessions_initial_message_idx
        ON sessions (initial_message_id)
        WHERE initial_message_id IS NOT NULL;
    `,
  },
  {
    version: 10,
    sql: `
      DROP INDEX IF EXISTS sessions_unfinished_spec_idx;
      DROP INDEX IF EXISTS sessions_repository_order_idx;
      DROP INDEX IF EXISTS sessions_spec_order_idx;
      DROP INDEX IF EXISTS sessions_repository_working_branch_idx;
      DROP INDEX IF EXISTS sessions_opencode_intended_session_idx;
      DROP INDEX IF EXISTS sessions_opencode_session_idx;
      DROP INDEX IF EXISTS sessions_initial_message_idx;

      ALTER TABLE sessions RENAME TO sessions_legacy;

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
        target_kind TEXT NOT NULL CHECK (target_kind IN ('default', 'native_stack', 'standalone_parent')),
        target_branch TEXT NOT NULL,
        target_stack_id TEXT,
        target_stack_number TEXT,
        target_parent_pull_request_id TEXT,
        target_parent_pull_request_number TEXT,
        original_target_kind TEXT NOT NULL CHECK (original_target_kind IN ('default', 'native_stack', 'standalone_parent')),
        original_target_branch TEXT NOT NULL,
        original_target_stack_id TEXT,
        original_target_stack_number TEXT,
        original_target_parent_pull_request_id TEXT,
        original_target_parent_pull_request_number TEXT,
        state TEXT NOT NULL CHECK (state IN ('queued', 'preparing', 'running', 'waiting', 'idle', 'succeeded', 'failed', 'interrupted', 'failed_setup')),
        state_reason TEXT,
        directory TEXT,
        base_branch TEXT,
        base_sha TEXT,
        working_branch TEXT,
        resolved_stack_id TEXT,
        resolved_stack_number TEXT,
        resolved_parent_pull_request_id TEXT,
        resolved_parent_pull_request_number TEXT,
        resolved_parent_pull_request_url TEXT,
        resolved_parent_branch TEXT,
        resolved_trunk_branch TEXT,
        resolved_layers_json TEXT,
        preparation_checkpoint TEXT NOT NULL DEFAULT 'queued'
          CHECK (preparation_checkpoint IN ('queued', 'intent_saved', 'clone_started', 'clone_complete', 'branch_started', 'prepared', 'start_unconfirmed', 'failed_setup')),
        preparation_reason TEXT,
        prepared_at TEXT,
        opencode_session_id TEXT,
        initial_message_id TEXT,
        exact_message TEXT,
        execution_slot_held INTEGER NOT NULL DEFAULT 0 CHECK (execution_slot_held IN (0, 1)),
        updated_at TEXT NOT NULL,
        admission_blocked INTEGER NOT NULL DEFAULT 0 CHECK (admission_blocked IN (0, 1)),
        handoff_checkpoint TEXT NOT NULL DEFAULT 'not_started'
          CHECK (handoff_checkpoint IN ('not_started', 'intent_saved', 'events_consuming', 'create_sent', 'create_confirmed', 'associated', 'prompt_sent', 'prompt_accepted')),
        opencode_intended_session_id TEXT,
        initial_inbox_id TEXT,
        handoff_uncertain_reason TEXT,
        opencode_freshness TEXT NOT NULL DEFAULT 'unknown'
          CHECK (opencode_freshness IN ('unknown', 'fresh', 'stale')),
        opencode_last_success_at TEXT,
        opencode_last_failure_at TEXT,
        FOREIGN KEY (repository_id, spec_github_id) REFERENCES specs (repository_id, github_id),
        FOREIGN KEY (repository_id, spec_issue_number) REFERENCES specs (repository_id, issue_number)
      );

      INSERT INTO sessions (
        atlas_id, repository_id, spec_github_id, spec_issue_number, spec_title,
        spec_body, spec_html_url, submission_id, submission_order, submitted_at,
        prompt, target_kind, target_branch, original_target_kind, original_target_branch,
        state, state_reason, directory, base_branch, base_sha, working_branch,
        preparation_checkpoint, preparation_reason, prepared_at,
        opencode_session_id, initial_message_id, exact_message, execution_slot_held,
        updated_at, admission_blocked, handoff_checkpoint,
        opencode_intended_session_id, initial_inbox_id, handoff_uncertain_reason,
        opencode_freshness, opencode_last_success_at, opencode_last_failure_at
      )
      SELECT
        atlas_id, repository_id, spec_github_id, spec_issue_number, spec_title,
        spec_body, spec_html_url, submission_id, submission_order, submitted_at,
        prompt, target_kind, target_branch, target_kind, target_branch,
        state, state_reason, directory, base_branch, base_sha, working_branch,
        preparation_checkpoint, preparation_reason, prepared_at,
        opencode_session_id, initial_message_id, exact_message, execution_slot_held,
        updated_at, admission_blocked, handoff_checkpoint,
        opencode_intended_session_id, initial_inbox_id, handoff_uncertain_reason,
        opencode_freshness, opencode_last_success_at, opencode_last_failure_at
      FROM sessions_legacy;

      DROP TABLE sessions_legacy;

      CREATE UNIQUE INDEX sessions_unfinished_spec_idx
        ON sessions (spec_github_id)
        WHERE state IN ('queued', 'preparing', 'running', 'waiting', 'idle');
      CREATE INDEX sessions_repository_order_idx
        ON sessions (repository_id, submission_order DESC);
      CREATE INDEX sessions_spec_order_idx
        ON sessions (spec_github_id, submission_order DESC);
      CREATE UNIQUE INDEX sessions_repository_working_branch_idx
        ON sessions (repository_id, working_branch)
        WHERE working_branch IS NOT NULL;
      CREATE UNIQUE INDEX sessions_opencode_intended_session_idx
        ON sessions (opencode_intended_session_id)
        WHERE opencode_intended_session_id IS NOT NULL;
      CREATE UNIQUE INDEX sessions_opencode_session_idx
        ON sessions (opencode_session_id)
        WHERE opencode_session_id IS NOT NULL;
      CREATE UNIQUE INDEX sessions_initial_message_idx
        ON sessions (initial_message_id)
        WHERE initial_message_id IS NOT NULL;

      CREATE TABLE stack_reservations (
        reservation_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL UNIQUE REFERENCES sessions (atlas_id),
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        original_target_kind TEXT NOT NULL CHECK (original_target_kind IN ('native_stack', 'standalone_parent')),
        original_stack_id TEXT,
        original_stack_number TEXT,
        original_parent_pull_request_id TEXT,
        original_parent_pull_request_number TEXT,
        accepted_target_kind TEXT NOT NULL CHECK (accepted_target_kind IN ('native_stack', 'standalone_parent')),
        accepted_stack_id TEXT,
        accepted_stack_number TEXT,
        accepted_parent_pull_request_id TEXT,
        accepted_parent_pull_request_number TEXT,
        state TEXT NOT NULL CHECK (state IN ('held', 'released')),
        held_at TEXT NOT NULL,
        released_at TEXT,
        release_kind TEXT,
        release_reason TEXT,
        publication_evidence TEXT
      );

      CREATE INDEX stack_reservations_target_idx
        ON stack_reservations (repository_id, accepted_target_kind, accepted_stack_id, accepted_parent_pull_request_id, state);
      CREATE INDEX stack_reservations_session_idx
        ON stack_reservations (session_id);

      CREATE TABLE reservation_prs (
        reservation_id TEXT NOT NULL REFERENCES stack_reservations (reservation_id),
        pull_request_id TEXT NOT NULL REFERENCES pull_requests (github_id),
        evidence_role TEXT NOT NULL CHECK (evidence_role IN ('observed_member', 'preparation_parent', 'result')),
        observed_at TEXT NOT NULL,
        PRIMARY KEY (reservation_id, pull_request_id, evidence_role)
      );

      CREATE INDEX reservation_prs_pull_request_idx
        ON reservation_prs (pull_request_id, reservation_id);

      CREATE TABLE reservation_conflict_holds (
        reservation_id TEXT NOT NULL REFERENCES stack_reservations (reservation_id),
        repository_id TEXT NOT NULL REFERENCES repositories (github_id),
        target_kind TEXT NOT NULL CHECK (target_kind IN ('native_stack', 'standalone_parent')),
        stack_id TEXT,
        stack_number TEXT,
        parent_pull_request_id TEXT,
        parent_pull_request_number TEXT,
        created_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (reservation_id, target_kind, stack_id, parent_pull_request_id)
      );

      CREATE INDEX reservation_conflict_target_idx
        ON reservation_conflict_holds (repository_id, target_kind, stack_id, parent_pull_request_id);

      CREATE TABLE session_history (
        history_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions (atlas_id),
        event_kind TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        reason TEXT,
        details_json TEXT
      );

      CREATE INDEX session_history_session_idx
        ON session_history (session_id, history_id);
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
  originalTargetBranch: row.original_target_branch,
  targetStackId: row.target_stack_id,
  targetStackNumber: row.target_stack_number,
  targetParentPullRequestId: row.target_parent_pull_request_id,
  targetParentPullRequestNumber: row.target_parent_pull_request_number,
  originalTargetKind: row.original_target_kind,
  originalTargetStackId: row.original_target_stack_id,
  originalTargetStackNumber: row.original_target_stack_number,
  originalTargetParentPullRequestId: row.original_target_parent_pull_request_id,
  originalTargetParentPullRequestNumber: row.original_target_parent_pull_request_number,
  state: row.state,
  stateReason: row.state_reason,
  directory: row.directory,
  baseBranch: row.base_branch,
  baseSha: row.base_sha,
  workingBranch: row.working_branch,
  resolvedStackId: row.resolved_stack_id,
  resolvedStackNumber: row.resolved_stack_number,
  resolvedParentPullRequestId: row.resolved_parent_pull_request_id,
  resolvedParentPullRequestNumber: row.resolved_parent_pull_request_number,
  resolvedParentPullRequestUrl: row.resolved_parent_pull_request_url,
  resolvedParentBranch: row.resolved_parent_branch,
  resolvedTrunkBranch: row.resolved_trunk_branch,
  resolvedLayers: (() => {
    if (!row.resolved_layers_json) return [];
    try {
      const value: unknown = JSON.parse(row.resolved_layers_json);
      return Array.isArray(value) ? value.filter((layer): layer is ResolvedTarget["layers"][number] => Boolean(
        layer && typeof layer === "object" &&
        typeof (layer as Record<string, unknown>).pullRequestId === "string" &&
        typeof (layer as Record<string, unknown>).pullRequestNumber === "string" &&
        typeof (layer as Record<string, unknown>).branch === "string" &&
        typeof (layer as Record<string, unknown>).sha === "string",
      )) : [];
    } catch {
      return [];
    }
  })(),
  preparationCheckpoint: row.preparation_checkpoint,
  preparationReason: row.preparation_reason,
  preparedAt: row.prepared_at,
  handoffCheckpoint: row.handoff_checkpoint,
  opencodeIntendedSessionId: row.opencode_intended_session_id,
  openCodeSessionId: row.opencode_session_id,
  initialMessageId: row.initial_message_id,
  initialInboxId: row.initial_inbox_id,
  exactMessage: row.exact_message,
  handoffUncertainReason: row.handoff_uncertain_reason,
  opencodeFreshness: row.opencode_freshness,
  opencodeLastSuccessAt: row.opencode_last_success_at,
  opencodeLastFailureAt: row.opencode_last_failure_at,
  executionSlotHeld: row.execution_slot_held === 1,
  reservationId: row.reservation_id ?? null,
  reservationState: row.reservation_state ?? null,
  reservationReason: row.reservation_reason ?? null,
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

  // Parent branches recorded different schemas as migrations 5 and 6.
  const hasTable = (name: string) => Boolean(database.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
  const hasSessionColumn = (name: string) => hasTable("sessions") &&
    (database.query("PRAGMA table_info(sessions)").all() as Array<{ name: string }>)
      .some((column) => column.name === name);
  const repairMigrationLineage = database.transaction(() => {
    const versionFiveApplied = Boolean(database.query(
      "SELECT 1 FROM schema_migrations WHERE version = 5",
    ).get());
    if (versionFiveApplied && !hasTable("sessions") && hasTable("webhook_deliveries")) {
      database.exec(sessionsMigrationSql);
    }

    const versionSixApplied = Boolean(database.query(
      "SELECT 1 FROM schema_migrations WHERE version = 6",
    ).get());
    const preparationWasRecordedAtSix = versionSixApplied && hasSessionColumn("preparation_checkpoint");
    if (!preparationWasRecordedAtSix) return;

    if (!hasTable("webhook_deliveries")) database.exec(webhookMigrationSql);
    const versionSevenApplied = Boolean(database.query(
      "SELECT 1 FROM schema_migrations WHERE version = 7",
    ).get());
    if (!versionSevenApplied) {
      database.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(7, isoNow(now));
    }
    const versionEightApplied = Boolean(database.query(
      "SELECT 1 FROM schema_migrations WHERE version = 8",
    ).get());
    if (hasSessionColumn("admission_blocked") && !versionEightApplied) {
      database.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(8, isoNow(now));
    }
  });
  repairMigrationLineage();

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

  const upsertRepositoryRow = (input: RepositoryInput) => {
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
  };

  const upsertRepository = (input: RepositoryInput) => {
    upsertRepositoryRow(input);
    for (const view of refreshViews) ensureRefreshState(input.githubId, view);
    return getRepository(input.githubId)!;
  };

  const saveRepositoryObservation = (
    input: RepositoryInput,
    generation: number,
    refreshReason: string | null = null,
  ) => {
    const save = database.transaction(() => {
      const state = database.query(`
        SELECT requested_generation FROM refresh_state
        WHERE repository_id = ? AND view = 'access'
      `).get(input.githubId) as { requested_generation: number } | null;
      if (!state || state.requested_generation !== generation) return false;

      upsertRepositoryRow(input);
      for (const view of refreshViews) ensureRefreshState(input.githubId, view);
      database.query(`
        UPDATE refresh_state
        SET completed_generation = ?, last_success_at = ?, availability = 'available', failure_reason = ?
        WHERE repository_id = ? AND view = 'access' AND requested_generation = ?
      `).run(generation, isoNow(now), refreshReason, input.githubId, generation);
      return true;
    });
    return save();
  };

  const updateAccess = (repositoryId: string, status: AccessStatus, reason: string | null) => {
    database.query(`
      UPDATE repositories SET access_status = ?, access_reason = ? WHERE github_id = ?
    `).run(status, reason, repositoryId);
  };

  const markAccessObservation = (
    repositoryId: string,
    status: AccessStatus,
    reason: string | null,
    generation: number,
  ) => {
    const observe = database.transaction(() => {
      const state = database.query(`
        SELECT requested_generation FROM refresh_state
        WHERE repository_id = ? AND view = 'access'
      `).get(repositoryId) as { requested_generation: number } | null;
      if (!state || state.requested_generation !== generation) return false;
      database.query(`
        UPDATE repositories SET access_status = ?, access_reason = ? WHERE github_id = ?
      `).run(status, reason, repositoryId);
      database.query(`
        UPDATE refresh_state
        SET completed_generation = ?, last_success_at = ?, availability = 'available', failure_reason = ?
        WHERE repository_id = ? AND view = 'access' AND requested_generation = ?
      `).run(generation, isoNow(now), reason, repositoryId, generation);
      return true;
    });
    return observe();
  };

  const markAccessFailure = (
    repositoryId: string,
    status: AccessStatus,
    reason: string,
    generation: number,
  ) => {
    const fail = database.transaction(() => {
      const state = database.query(`
        SELECT requested_generation FROM refresh_state
        WHERE repository_id = ? AND view = 'access'
      `).get(repositoryId) as { requested_generation: number } | null;
      if (!state || state.requested_generation !== generation) return false;
      database.query(`
        UPDATE repositories SET access_status = ?, access_reason = ? WHERE github_id = ?
      `).run(status, reason, repositoryId);
      database.query(`
        UPDATE refresh_state
        SET last_failure_at = ?, availability = 'unavailable', failure_reason = ?
        WHERE repository_id = ? AND view = 'access' AND requested_generation = ?
      `).run(isoNow(now), reason, repositoryId, generation);
      return true;
    });
    return fail();
  };

  const requestRefresh = (repositoryId: string, views: RefreshView[] = refreshViews) => {
    const requestedViews = [...new Set(views)];
    const request = database.transaction(() => {
      for (const view of requestedViews) {
        ensureRefreshState(repositoryId, view);
        database.query(`
          UPDATE refresh_state
          SET requested_generation = requested_generation + 1
          WHERE repository_id = ? AND view = ?
        `).run(repositoryId, view);
      }
    });
    request();
  };

  const acceptWebhookDelivery = ({
    deliveryId,
    repositoryIds,
    views = refreshViews,
    receivedAt = isoNow(now),
  }: {
    deliveryId: string;
    repositoryIds: string[];
    views?: RefreshView[];
    receivedAt?: string;
  }) => {
    const accepted = database.transaction(() => {
      database.query(`
        DELETE FROM webhook_deliveries
        WHERE received_at <= ?
      `).run(new Date(now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      const duplicate = database.query(`
        SELECT 1 FROM webhook_deliveries WHERE delivery_id = ?
      `).get(deliveryId);
      if (duplicate) return false;

      database.query(`
        INSERT INTO webhook_deliveries (delivery_id, received_at) VALUES (?, ?)
      `).run(deliveryId, receivedAt);

      const uniqueRepositories = [...new Set(repositoryIds)];
      const uniqueViews = [...new Set(views)];
      for (const repositoryId of uniqueRepositories) {
        const repository = database.query(
          "SELECT 1 FROM repositories WHERE github_id = ?",
        ).get(repositoryId);
        if (!repository) continue;
        for (const view of uniqueViews) {
          ensureRefreshState(repositoryId, view);
          database.query(`
            UPDATE refresh_state
            SET requested_generation = requested_generation + 1
            WHERE repository_id = ? AND view = ?
          `).run(repositoryId, view);
        }
      }
      return true;
    });
    return accepted();
  };

  const markRefreshSuccess = (
    repositoryId: string,
    view: RefreshView,
    reason: string | null = null,
    generation?: number,
  ) => {
    ensureRefreshState(repositoryId, view);
    const timestamp = isoNow(now);
    if (generation === undefined) {
      database.query(`
        UPDATE refresh_state
        SET completed_generation = requested_generation,
            last_success_at = ?,
            availability = 'available',
            failure_reason = ?
        WHERE repository_id = ? AND view = ?
      `).run(timestamp, reason, repositoryId, view);
      return true;
    }

    const result = database.query(`
      UPDATE refresh_state
      SET completed_generation = ?,
          last_success_at = ?,
          availability = 'available',
          failure_reason = ?
      WHERE repository_id = ? AND view = ? AND requested_generation = ?
    `).run(generation, timestamp, reason, repositoryId, view, generation);
    return result.changes > 0;
  };

  const markRefreshFailure = (
    repositoryId: string,
    view: RefreshView,
    reason: string,
    availability: RefreshAvailability = "unavailable",
    generation?: number,
  ) => {
    ensureRefreshState(repositoryId, view);
    const query = generation === undefined ? `
      UPDATE refresh_state
      SET last_failure_at = ?, availability = ?, failure_reason = ?
      WHERE repository_id = ? AND view = ?
    ` : `
      UPDATE refresh_state
      SET last_failure_at = ?, availability = ?, failure_reason = ?
      WHERE repository_id = ? AND view = ? AND requested_generation = ?
    `;
    const result = generation === undefined
      ? database.query(query).run(isoNow(now), availability, reason, repositoryId, view)
      : database.query(query).run(isoNow(now), availability, reason, repositoryId, view, generation);
    return result.changes > 0;
  };

  const isRefreshGenerationCurrent = (repositoryId: string, view: RefreshView, generation: number) => {
    const row = database.query(`
      SELECT requested_generation FROM refresh_state WHERE repository_id = ? AND view = ?
    `).get(repositoryId, view) as { requested_generation: number } | null;
    return row?.requested_generation === generation;
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
    generation?: number,
  ) => {
    const replace = database.transaction(() => {
      if (generation !== undefined && !isRefreshGenerationCurrent(repositoryId, "specs", generation)) return false;
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
      if (generation === undefined) {
        database.query(`
          UPDATE refresh_state
          SET completed_generation = requested_generation,
              last_success_at = ?,
              availability = 'available',
              failure_reason = ?
          WHERE repository_id = ? AND view = 'specs'
        `).run(isoNow(now), refreshReason, repositoryId);
      } else {
        database.query(`
          UPDATE refresh_state
          SET completed_generation = ?,
              last_success_at = ?,
              availability = 'available',
              failure_reason = ?
          WHERE repository_id = ? AND view = 'specs' AND requested_generation = ?
        `).run(generation, isoNow(now), refreshReason, repositoryId, generation);
      }
      return true;
    });
    return replace();
  };

  const replacePullRequests = (
    repositoryId: string,
    pullRequests: PullRequestInput[],
    stacks: PrStackInput[],
    observedAt = isoNow(now),
    refreshReason: string | null = null,
    generation?: number,
  ) => {
    const replace = database.transaction(() => {
      if (generation !== undefined && !isRefreshGenerationCurrent(repositoryId, "pullRequests", generation)) return false;
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
      if (generation === undefined) {
        database.query(`
          UPDATE refresh_state
          SET completed_generation = requested_generation,
              last_success_at = ?,
              availability = 'available',
              failure_reason = ?
          WHERE repository_id = ? AND view = 'pullRequests'
        `).run(isoNow(now), refreshReason, repositoryId);
      } else {
        database.query(`
          UPDATE refresh_state
          SET completed_generation = ?,
              last_success_at = ?,
              availability = 'available',
              failure_reason = ?
          WHERE repository_id = ? AND view = 'pullRequests' AND requested_generation = ?
        `).run(generation, isoNow(now), refreshReason, repositoryId, generation);
      }
      return true;
    });
    return replace();
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

  const sessionSelect = `
    SELECT s.*,
           r.reservation_id,
           r.state AS reservation_state,
           r.release_reason AS reservation_reason
    FROM sessions s
    LEFT JOIN stack_reservations r ON r.session_id = s.atlas_id
  `;

  const targetColumns = (target: SessionTarget): [
    TargetKind,
    string | null,
    string | null,
    string | null,
    string | null,
  ] => [
    target.kind,
    target.stackId ?? null,
    target.stackNumber ?? null,
    target.parentPullRequestId ?? null,
    target.parentPullRequestNumber ?? null,
  ];

  const targetFromSession = (session: Session): SessionTarget => ({
    kind: session.targetKind,
    stackId: session.targetStackId,
    stackNumber: session.targetStackNumber,
    parentPullRequestId: session.targetParentPullRequestId,
    parentPullRequestNumber: session.targetParentPullRequestNumber,
  });

  const getSession = (atlasId: string) => {
    const row = database.query(`${sessionSelect} WHERE s.atlas_id = ?`).get(atlasId) as SessionRow | null;
    return row ? toSession(row) : undefined;
  };

  const getSessionBySubmissionId = (submissionId: string) => {
    const row = database.query(`${sessionSelect} WHERE s.submission_id = ?`).get(submissionId) as SessionRow | null;
    return row ? toSession(row) : undefined;
  };

  const queueSession = (input: QueueSessionInput): QueueSessionResult => {
    const target: SessionTarget = input.target ?? { kind: input.targetKind };
    if (target.kind === "native_stack" && !target.stackId) {
      throw new Error("Native stack target identity is required");
    }
    if (target.kind === "standalone_parent" && !target.parentPullRequestId) {
      throw new Error("Standalone parent target identity is required");
    }

    const [targetKind, targetStackId, targetStackNumber, targetParentPullRequestId, targetParentPullRequestNumber] = targetColumns(target);
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
          existing.prompt === input.prompt &&
          existing.originalTargetKind === target.kind &&
          existing.originalTargetStackId === (target.stackId ?? null) &&
          existing.originalTargetStackNumber === (target.stackNumber ?? null) &&
          existing.originalTargetParentPullRequestId === (target.parentPullRequestId ?? null) &&
          existing.originalTargetParentPullRequestNumber === (target.parentPullRequestNumber ?? null);
        result = { kind: sameSubmission ? "existing" : "conflict", session: existing };
        return;
      }

      const unfinishedRow = database.query(`
        ${sessionSelect}
        WHERE s.spec_github_id = ?
          AND s.state IN ('queued', 'preparing', 'running', 'waiting', 'idle')
        ORDER BY s.submission_order
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
          prompt, target_kind, target_branch, target_stack_id, target_stack_number,
          target_parent_pull_request_id, target_parent_pull_request_number,
          original_target_kind, original_target_branch, original_target_stack_id, original_target_stack_number,
          original_target_parent_pull_request_id, original_target_parent_pull_request_number,
          state, state_reason, execution_slot_held, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?)
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
        targetKind,
        input.targetBranch,
        targetStackId,
        targetStackNumber,
        targetParentPullRequestId,
        targetParentPullRequestNumber,
        targetKind,
        input.targetBranch,
        targetStackId,
        targetStackNumber,
        targetParentPullRequestId,
        targetParentPullRequestNumber,
        "Awaiting downstream preparation.",
        submittedAt,
      );

      database.query(`
        INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
        VALUES (?, 'queued', ?, ?, ?)
      `).run(
        input.atlasId,
        submittedAt,
        "Session durably queued before local preparation.",
        JSON.stringify({ target }),
      );

      result = { kind: "created", session: getSession(input.atlasId)! };
    });
    queue.immediate();
    return result!;
  };

  const listQueuedSessions = () => {
    const rows = database.query(`
      ${sessionSelect}
      WHERE s.state = 'queued'
      ORDER BY s.submission_order ASC
    `).all() as SessionRow[];
    return rows.map(toSession);
  };

  const listPreparingSessions = () => {
    const rows = database.query(`
      ${sessionSelect}
      WHERE s.state = 'preparing'
      ORDER BY s.submission_order ASC
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
             AND (
               (s.target_kind = 'default' AND r.default_branch = s.target_branch)
               OR s.target_kind IN ('native_stack', 'standalone_parent')
             )
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

      const current = toSession(eligible);
      const target = intent.target ?? targetFromSession(current);
      if (target.kind !== "default") {
        const conflict = database.query(`
          SELECT DISTINCT r.reservation_id
          FROM stack_reservations r
          LEFT JOIN reservation_prs rp ON rp.reservation_id = r.reservation_id
          LEFT JOIN stack_members sm ON sm.pull_request_id = rp.pull_request_id
          LEFT JOIN reservation_conflict_holds h ON h.reservation_id = r.reservation_id
          WHERE r.repository_id = ?
            AND r.state = 'held'
            AND r.session_id != ?
            AND (
              (${target.kind === "native_stack" ? "r.accepted_target_kind = 'native_stack' AND r.accepted_stack_id = ?" : "0"})
              OR (${target.kind === "standalone_parent" ? "r.accepted_target_kind = 'standalone_parent' AND r.accepted_parent_pull_request_id = ?" : "0"})
              OR (${target.kind === "native_stack" ? "sm.stack_id = ?" : "0"})
              OR (${target.kind === "standalone_parent" ? "rp.pull_request_id = ?" : "0"})
              OR (${target.kind === "native_stack" ? "h.target_kind = 'native_stack' AND h.stack_id = ?" : "0"})
              OR (${target.kind === "standalone_parent" ? "h.target_kind = 'standalone_parent' AND h.parent_pull_request_id = ?" : "0"})
            )
          LIMIT 1
        `).get(
          current.repositoryId,
          atlasId,
          ...(target.kind === "native_stack" ? [target.stackId ?? null] : []),
          ...(target.kind === "standalone_parent" ? [target.parentPullRequestId ?? null] : []),
          ...(target.kind === "native_stack" ? [target.stackId ?? null] : []),
          ...(target.kind === "standalone_parent" ? [target.parentPullRequestId ?? null] : []),
          ...(target.kind === "native_stack" ? [target.stackId ?? null] : []),
          ...(target.kind === "standalone_parent" ? [target.parentPullRequestId ?? null] : []),
        ) as { reservation_id: string } | null;
        if (conflict) {
          const holdValues = target.kind === "native_stack"
            ? ["native_stack", target.stackId ?? null, target.stackNumber ?? null, null, null]
            : ["standalone_parent", null, null, target.parentPullRequestId ?? null, target.parentPullRequestNumber ?? null];
          database.query(`
            INSERT INTO reservation_conflict_holds (
              reservation_id, repository_id, target_kind, stack_id, stack_number,
              parent_pull_request_id, parent_pull_request_number, created_at, reason
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM reservation_conflict_holds
              WHERE reservation_id = ? AND target_kind = ?
                AND stack_id IS ? AND parent_pull_request_id IS ?
            )
          `).run(
            conflict.reservation_id,
            current.repositoryId,
            ...holdValues,
            isoNow(now),
            "Another held reservation owns this target or retained evidence.",
            conflict.reservation_id,
            holdValues[0],
            holdValues[1],
            holdValues[3],
          );
          return;
        }
      }

      const resolved = intent.resolvedTarget ?? {
        kind: target.kind,
        stackId: target.stackId ?? null,
        stackNumber: target.stackNumber ?? null,
        parentPullRequestId: target.parentPullRequestId ?? null,
        parentPullRequestNumber: target.parentPullRequestNumber ?? null,
        parentPullRequestUrl: null,
        parentBranch: intent.baseBranch,
        trunkBranch: intent.baseBranch,
        layers: [],
      } satisfies ResolvedTarget;
      const [currentKind, currentStackId, currentStackNumber, currentParentId, currentParentNumber] = targetColumns(target);
      const existingReservation = target.kind === "default" ? null : database.query(`
        SELECT reservation_id FROM stack_reservations
        WHERE session_id = ? AND state = 'held'
      `).get(atlasId) as { reservation_id: string } | null;
      const reservationId = target.kind === "default"
        ? null
        : existingReservation?.reservation_id ?? `res_${crypto.randomUUID()}`;
      const timestamp = isoNow(now);

      if (reservationId && !existingReservation) {
        database.query(`
          INSERT INTO stack_reservations (
            reservation_id, session_id, repository_id,
            original_target_kind, original_stack_id, original_stack_number,
            original_parent_pull_request_id, original_parent_pull_request_number,
            accepted_target_kind, accepted_stack_id, accepted_stack_number,
            accepted_parent_pull_request_id, accepted_parent_pull_request_number,
            state, held_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?)
        `).run(
          reservationId,
          atlasId,
          current.repositoryId,
          current.originalTargetKind,
          current.originalTargetStackId,
          current.originalTargetStackNumber,
          current.originalTargetParentPullRequestId,
          current.originalTargetParentPullRequestNumber,
          currentKind,
          currentStackId,
          currentStackNumber,
          currentParentId,
          currentParentNumber,
          timestamp,
        );
      }
      if (reservationId && existingReservation) {
        database.query(`
          UPDATE stack_reservations
          SET accepted_target_kind = ?,
              accepted_stack_id = ?,
              accepted_stack_number = ?,
              accepted_parent_pull_request_id = ?,
              accepted_parent_pull_request_number = ?
          WHERE reservation_id = ? AND state = 'held'
        `).run(
          currentKind,
          currentStackId,
          currentStackNumber,
          currentParentId,
          currentParentNumber,
          reservationId,
        );
      }

      if (reservationId) {
        const addEvidence = database.query(`
          INSERT OR IGNORE INTO reservation_prs (reservation_id, pull_request_id, evidence_role, observed_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const layer of resolved.layers) addEvidence.run(reservationId, layer.pullRequestId, "observed_member", timestamp);
        if (resolved.parentPullRequestId) addEvidence.run(reservationId, resolved.parentPullRequestId, "preparation_parent", timestamp);
      }

      const updated = database.query(`
        UPDATE sessions
        SET state = 'preparing',
            state_reason = ?,
            directory = ?,
            target_kind = ?,
            target_branch = ?,
            target_stack_id = ?,
            target_stack_number = ?,
            target_parent_pull_request_id = ?,
            target_parent_pull_request_number = ?,
            base_branch = ?,
            base_sha = ?,
            working_branch = ?,
            resolved_stack_id = ?,
            resolved_stack_number = ?,
            resolved_parent_pull_request_id = ?,
            resolved_parent_pull_request_number = ?,
            resolved_parent_pull_request_url = ?,
            resolved_parent_branch = ?,
            resolved_trunk_branch = ?,
            resolved_layers_json = ?,
            preparation_checkpoint = 'intent_saved',
            preparation_reason = ?,
            prepared_at = NULL,
            execution_slot_held = 1,
            updated_at = ?
        WHERE atlas_id = ? AND state = 'queued'
      `).run(
        "Preparation admitted; local clone has not started.",
        intent.directory,
        currentKind,
        resolved.parentBranch,
        currentStackId,
        currentStackNumber,
        currentParentId,
        currentParentNumber,
        resolved.parentBranch,
        intent.baseSha,
        intent.workingBranch,
        resolved.stackId,
        resolved.stackNumber,
        resolved.parentPullRequestId,
        resolved.parentPullRequestNumber,
        resolved.parentPullRequestUrl,
        resolved.parentBranch,
        resolved.trunkBranch,
        JSON.stringify(resolved.layers),
        "Preparation intent durably saved before filesystem work.",
        timestamp,
        atlasId,
      );
      if (updated.changes !== 1) throw new Error("Preparation claim changed before admission");
      database.query(`
        INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
        VALUES (?, 'admitted', ?, ?, ?)
      `).run(
        atlasId,
        timestamp,
        "Global execution slot and target reservation claimed atomically before local preparation.",
        JSON.stringify({ reservationId, target, resolved }),
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

  const setHandoffIntent = (
    atlasId: string,
    intendedSessionId: string,
    messageId: string,
    exactMessage: string,
  ) => {
    const save = database.transaction(() => {
      database.query(`
        UPDATE sessions
        SET handoff_checkpoint = 'intent_saved',
            opencode_intended_session_id = ?,
            initial_message_id = ?,
            exact_message = ?,
            handoff_uncertain_reason = NULL,
            opencode_freshness = 'unknown',
            opencode_last_failure_at = NULL,
            state_reason = ?,
            updated_at = ?
        WHERE atlas_id = ?
          AND state = 'preparing'
          AND preparation_checkpoint = 'prepared'
          AND handoff_checkpoint = 'not_started'
      `).run(
        intendedSessionId,
        messageId,
        exactMessage,
        "OpenCode handoff intent saved; the compatible service has not been contacted.",
        isoNow(now),
        atlasId,
      );
    });
    save.immediate();
    return getSession(atlasId);
  };

  const setHandoffCheckpoint = (
    atlasId: string,
    checkpoint: HandoffCheckpoint,
    reason: string,
  ) => {
    database.query(`
      UPDATE sessions
      SET handoff_checkpoint = ?, state_reason = ?, updated_at = ?
      WHERE atlas_id = ?
        AND state = 'preparing'
        AND handoff_checkpoint != 'prompt_accepted'
    `).run(checkpoint, reason, isoNow(now), atlasId);
    return getSession(atlasId);
  };

  const setHandoffCreated = (atlasId: string, opencodeSessionId: string) => {
    const save = database.transaction(() => {
      const existing = database.query(`
        SELECT opencode_session_id FROM sessions WHERE atlas_id = ?
      `).get(atlasId) as { opencode_session_id: string | null } | null;
      if (!existing) return;
      if (existing.opencode_session_id && existing.opencode_session_id !== opencodeSessionId) {
        throw new Error("OpenCode Session association cannot change");
      }
      database.query(`
        UPDATE sessions
        SET handoff_checkpoint = 'create_confirmed',
            opencode_session_id = ?,
            handoff_uncertain_reason = NULL,
            opencode_freshness = 'fresh',
            opencode_last_success_at = ?,
            opencode_last_failure_at = NULL,
            state_reason = ?,
            updated_at = ?
        WHERE atlas_id = ?
          AND state = 'preparing'
          AND handoff_checkpoint = 'create_sent'
      `).run(
        opencodeSessionId,
        isoNow(now),
        "OpenCode Session created; its directory binding is being reconciled before prompting.",
        isoNow(now),
        atlasId,
      );
    });
    save.immediate();
    return getSession(atlasId);
  };

  const confirmHandoffAssociation = (atlasId: string) => {
    database.query(`
      UPDATE sessions
      SET handoff_checkpoint = 'associated',
          handoff_uncertain_reason = NULL,
          opencode_freshness = 'fresh',
          opencode_last_success_at = ?,
          opencode_last_failure_at = NULL,
          state_reason = ?,
          updated_at = ?
      WHERE atlas_id = ?
        AND state = 'preparing'
        AND handoff_checkpoint = 'create_confirmed'
        AND opencode_session_id IS NOT NULL
    `).run(
      isoNow(now),
      "OpenCode Session association confirmed; the initial prompt has not been sent.",
      isoNow(now),
      atlasId,
    );
    return getSession(atlasId);
  };

  const recordPromptAccepted = (atlasId: string, inboxId: string) => {
    database.query(`
      UPDATE sessions
      SET handoff_checkpoint = 'prompt_accepted',
          initial_inbox_id = ?,
          handoff_uncertain_reason = NULL,
          opencode_freshness = 'fresh',
          opencode_last_success_at = ?,
          opencode_last_failure_at = NULL,
          state_reason = ?,
          updated_at = ?
      WHERE atlas_id = ?
        AND state = 'preparing'
        AND handoff_checkpoint = 'prompt_sent'
        AND opencode_session_id IS NOT NULL
    `).run(
      inboxId,
      isoNow(now),
      "Initial prompt accepted by OpenCode; execution state is being reconciled.",
      isoNow(now),
      atlasId,
    );
    return getSession(atlasId);
  };

  const markHandoffUnconfirmed = (atlasId: string, reason: string) => {
    database.query(`
      UPDATE sessions
      SET handoff_uncertain_reason = ?,
          opencode_freshness = 'stale',
          opencode_last_failure_at = ?,
          state_reason = ?,
          updated_at = ?
      WHERE atlas_id = ?
        AND state IN ('preparing', 'running', 'waiting', 'idle')
    `).run(reason, isoNow(now), reason, isoNow(now), atlasId);
    return getSession(atlasId);
  };

  const markOpenCodeStale = (atlasId: string, reason: string) => {
    database.query(`
      UPDATE sessions
      SET opencode_freshness = 'stale',
          opencode_last_failure_at = ?,
          state_reason = ?,
          updated_at = ?
      WHERE atlas_id = ?
        AND state IN ('preparing', 'running', 'waiting', 'idle')
    `).run(isoNow(now), reason, isoNow(now), atlasId);
    return getSession(atlasId);
  };

  const reconcileOpenCode = (
    atlasId: string,
    state: Extract<SessionState, "running" | "waiting" | "idle" | "succeeded" | "failed" | "interrupted">,
    reason: string,
  ) => {
    const terminal = state === "succeeded" || state === "failed" || state === "interrupted";
    const reconcile = database.transaction(() => {
      const current = database.query("SELECT state FROM sessions WHERE atlas_id = ?").get(atlasId) as { state: SessionState } | null;
      if (!current) return;
      if ((current.state === "succeeded" || current.state === "failed" || current.state === "interrupted") && !terminal) return;
      const updated = database.query(`
        UPDATE sessions
        SET state = ?,
            state_reason = ?,
            execution_slot_held = ?,
            handoff_uncertain_reason = NULL,
            opencode_freshness = 'fresh',
            opencode_last_success_at = ?,
            updated_at = ?
        WHERE atlas_id = ?
          AND state IN ('preparing', 'running', 'waiting', 'idle')
      `).run(
        state,
        reason,
        terminal ? 0 : 1,
        isoNow(now),
        isoNow(now),
        atlasId,
      );
      if (updated.changes > 0) {
        database.query(`
          INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          atlasId,
          terminal ? "terminal" : "execution_state",
          isoNow(now),
          reason,
          JSON.stringify({ state, executionSlotHeld: !terminal }),
        );
      }
    });
    reconcile.immediate();
    return getSession(atlasId);
  };

  const listOpenCodeSessions = () => {
    const rows = database.query(`
      ${sessionSelect}
      WHERE s.state IN ('preparing', 'running', 'waiting', 'idle')
        AND (
          s.preparation_checkpoint = 'prepared'
          OR s.handoff_checkpoint != 'not_started'
          OR s.opencode_session_id IS NOT NULL
        )
      ORDER BY s.submission_order ASC
    `).all() as SessionRow[];
    return rows.map(toSession);
  };

  const getSessionByOpenCodeSessionId = (opencodeSessionId: string) => {
    const row = database.query(
      `${sessionSelect} WHERE s.opencode_session_id = ?`,
    ).get(opencodeSessionId) as SessionRow | null;
    return row ? toSession(row) : undefined;
  };

  const listSessions = (repositoryId: string, filter: SessionFilter = "active") => {
    const activeStates = "('queued', 'preparing', 'running', 'waiting', 'idle')";
    if (filter === "active") {
      const rows = database.query(`
        ${sessionSelect}
        WHERE s.repository_id = ? AND s.state IN ${activeStates}
        ORDER BY s.submission_order DESC
      `).all(repositoryId) as SessionRow[];
      return rows.map(toSession);
    }

    if (filter === "all") {
      const rows = database.query(`
        ${sessionSelect}
        WHERE s.repository_id = ?
        ORDER BY s.submission_order DESC
      `).all(repositoryId) as SessionRow[];
      return rows.map(toSession);
    }

    const rows = database.query(`
      ${sessionSelect}
      WHERE s.repository_id = ? AND s.state = ?
      ORDER BY s.submission_order DESC
    `).all(repositoryId, filter) as SessionRow[];
    return rows.map(toSession);
  };

  const listSessionsForSpec = (repositoryId: string, issueNumber: string) => {
    const rows = database.query(`
      ${sessionSelect}
      WHERE s.repository_id = ? AND s.spec_issue_number = ?
      ORDER BY s.submission_order DESC
    `).all(repositoryId, issueNumber) as SessionRow[];
    return rows.map(toSession);
  };

  return {
    database,
    close: () => database.close(),
    getRepository,
    listRepositories,
    upsertRepository,
    saveRepositoryObservation,
    updateAccess,
    markAccessObservation,
    markAccessFailure,
    requestRefresh,
    acceptWebhookDelivery,
    markRefreshSuccess,
    markRefreshFailure,
    isRefreshGenerationCurrent,
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
    setHandoffIntent,
    setHandoffCheckpoint,
    setHandoffCreated,
    confirmHandoffAssociation,
    recordPromptAccepted,
    markHandoffUnconfirmed,
    markOpenCodeStale,
    reconcileOpenCode,
    listOpenCodeSessions,
    getSessionByOpenCodeSessionId,
    listSessions,
    listSessionsForSpec,
  };
};

export type Persistence = ReturnType<typeof createPersistence>;
