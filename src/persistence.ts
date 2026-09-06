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

export type PublicationStatus =
  | "not_observed"
  | "unverified"
  | "ambiguous"
  | "identified"
  | "qualifying"
  | "released";

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
  resultPullRequestId: string | null;
  resultPullRequestNumber: string | null;
  resultPullRequestUrl: string | null;
  publicationStatus: PublicationStatus;
  publicationReason: string | null;
  publicationObservedAt: string | null;
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
  reservationConflictCount?: number;
  admissionBlocked?: boolean;
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

export type ReservationReleaseResult =
  | { kind: "released"; session: Session }
  | { kind: "already_released"; session: Session }
  | { kind: "not_found"; session: Session }
  | { kind: "not_terminal"; session: Session };

export type TargetReconfirmationResult =
  | { kind: "updated"; session: Session }
  | { kind: "not_queued"; session: Session }
  | { kind: "not_found"; session: undefined };

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
  result_pull_request_id: string | null;
  publication_status: PublicationStatus;
  publication_reason: string | null;
  publication_observed_at: string | null;
  publication_pr_number?: string | null;
  publication_pr_url?: string | null;
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
  reservation_conflict_count?: number;
  admission_blocked: number;
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
  {
    version: 11,
    sql: `
      ALTER TABLE sessions ADD COLUMN result_pull_request_id TEXT REFERENCES pull_requests (github_id);
      ALTER TABLE sessions ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'not_observed'
        CHECK (publication_status IN ('not_observed', 'unverified', 'ambiguous', 'identified', 'qualifying', 'released'));
      ALTER TABLE sessions ADD COLUMN publication_reason TEXT;
      ALTER TABLE sessions ADD COLUMN publication_observed_at TEXT;
      CREATE INDEX sessions_result_pull_request_idx
        ON sessions (result_pull_request_id)
        WHERE result_pull_request_id IS NOT NULL;
      `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE stack_reservations ADD COLUMN evidence_unknown INTEGER NOT NULL DEFAULT 0
        CHECK (evidence_unknown IN (0, 1));
      ALTER TABLE stack_reservations ADD COLUMN evidence_reason TEXT;
      DROP INDEX IF EXISTS pr_stacks_repository_number_unique;
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
  resultPullRequestId: row.result_pull_request_id,
  resultPullRequestNumber: row.publication_pr_number ?? null,
  resultPullRequestUrl: row.publication_pr_url ?? null,
  publicationStatus: row.publication_status,
  publicationReason: row.publication_reason,
  publicationObservedAt: row.publication_observed_at,
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
  reservationConflictCount: row.reservation_conflict_count ?? 0,
  admissionBlocked: row.admission_blocked === 1,
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

  const removeRepository = (githubId: string) => {
    database.query(`
      UPDATE repositories
      SET removed_at = COALESCE(removed_at, ?)
      WHERE github_id = ?
    `).run(isoNow(now), githubId);
    return getRepository(githubId);
  };

  const restoreRepository = (githubId: string) => {
    database.query(`
      UPDATE repositories SET removed_at = NULL WHERE github_id = ?
    `).run(githubId);
    return getRepository(githubId);
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

  type PublicationPullRequestRow = {
    github_id: string;
    number: string;
    html_url: string;
    state: string;
    draft: number;
    merged_at: string | null;
    head_ref: string;
    base_ref: string;
    is_current: number;
    stack_id: string | null;
    stack_position: number | null;
  };

  const publicationPullRequest = (repositoryId: string, pullRequestId: string) => database.query(`
    SELECT p.github_id, p.number, p.html_url, p.state, p.draft, p.merged_at, p.head_ref, p.base_ref, p.is_current,
           s.github_id AS stack_id, sm.position AS stack_position
    FROM pull_requests p
    LEFT JOIN stack_members sm ON sm.pull_request_id = p.github_id
    LEFT JOIN pr_stacks s ON s.github_id = sm.stack_id AND s.is_current = 1
    WHERE p.repository_id = ? AND p.github_id = ?
  `).get(repositoryId, pullRequestId) as PublicationPullRequestRow | null;

  const publicationBranchMatches = (repositoryId: string, branch: string) => database.query(`
    SELECT p.github_id, p.number, p.html_url, p.state, p.draft, p.merged_at, p.head_ref, p.base_ref, p.is_current,
           s.github_id AS stack_id, sm.position AS stack_position
    FROM pull_requests p
    LEFT JOIN stack_members sm ON sm.pull_request_id = p.github_id
    LEFT JOIN pr_stacks s ON s.github_id = sm.stack_id AND s.is_current = 1
    WHERE p.repository_id = ? AND p.head_ref = ?
      AND (p.head_repository_id = ? OR (p.head_repository_id IS NULL AND p.merged_at IS NOT NULL))
    ORDER BY p.is_current DESC, p.github_id
  `).all(repositoryId, branch, repositoryId) as PublicationPullRequestRow[];

  const stackPosition = (stackId: string, pullRequestId: string) => {
    const row = database.query(`
      SELECT position FROM stack_members WHERE stack_id = ? AND pull_request_id = ?
    `).get(stackId, pullRequestId) as { position: number } | null;
    return row?.position ?? null;
  };

  const publicationQualification = (session: SessionRow, result: PublicationPullRequestRow) => {
    if (result.draft === 1) return "The identified publication Pull request is still a draft; the reservation remains held.";
    if (result.state !== "open" && result.merged_at === null) return "The identified publication Pull request is closed without a confirmed merge; the reservation remains held.";

    if (session.target_kind === "default") {
      if (result.stack_id !== null) return "The default-branch owner's publication is not a verified standalone parent; the first-child exception does not apply.";
      if (result.base_ref !== session.target_branch) return "The default-branch owner's publication does not target the reserved default branch; the first-child exception does not apply.";
      return undefined;
    }

    const parentId = session.resolved_parent_pull_request_id ?? session.target_parent_pull_request_id;
    if (!parentId || !result.stack_id) return "The identified publication Pull request is not in a verified native stack above its preparation parent.";
    const parentPosition = stackPosition(result.stack_id, parentId);
    if (parentPosition === null || result.stack_position === null || result.stack_position <= parentPosition) {
      return "The identified publication Pull request is not verified above the preparation parent in its current native stack.";
    }
    return undefined;
  };

  const terminalExecution = (state: SessionState) =>
    state === "succeeded" || state === "failed" || state === "interrupted";

  const publicationEvidence = (status: PublicationStatus, resultId: string | null, reason: string, observedAt: string) =>
    JSON.stringify({ status, resultPullRequestId: resultId, reason, observedAt });

  const reconcilePublications = (repositoryId: string, observedAt: string) => {
    const rows = database.query(`
      SELECT * FROM sessions
      WHERE repository_id = ? AND working_branch IS NOT NULL
      ORDER BY submission_order
    `).all(repositoryId) as SessionRow[];
    const updateSession = database.query(`
      UPDATE sessions
      SET result_pull_request_id = COALESCE(?, result_pull_request_id),
          publication_status = ?,
          publication_reason = ?,
          publication_observed_at = ?,
          updated_at = ?
      WHERE atlas_id = ?
    `);
    const addResultEvidence = database.query(`
      INSERT OR IGNORE INTO reservation_prs (reservation_id, pull_request_id, evidence_role, observed_at)
      VALUES (?, ?, 'result', ?)
    `);
    const reservationForSession = database.query(`
      SELECT reservation_id, state FROM stack_reservations WHERE session_id = ?
    `);
    const addDefaultReservation = database.query(`
      INSERT INTO stack_reservations (
        reservation_id, session_id, repository_id,
        original_target_kind, original_parent_pull_request_id, original_parent_pull_request_number,
        accepted_target_kind, accepted_parent_pull_request_id, accepted_parent_pull_request_number,
        state, held_at, publication_evidence
      ) VALUES (?, ?, ?, 'standalone_parent', ?, ?, 'standalone_parent', ?, ?, 'held', ?, ?)
    `);
    const addAmbiguousConflictHold = database.query(`
      INSERT OR IGNORE INTO reservation_conflict_holds (
        reservation_id, repository_id, target_kind, stack_id, stack_number,
        parent_pull_request_id, parent_pull_request_number, created_at, reason
      ) VALUES (?, ?, 'standalone_parent', NULL, NULL, ?, ?, ?, ?)
    `);
    const addHistory = database.query(`
      INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateEvidence = database.query(`
      UPDATE stack_reservations
      SET publication_evidence = ?
      WHERE reservation_id = ? AND state = 'held'
    `);
    type ReservationRef = { reservation_id: string; state: "held" | "released" };
    const retainAmbiguousDefaultOwnership = (
      session: SessionRow,
      reservation: ReservationRef | null,
      matches: PublicationPullRequestRow[],
      status: PublicationStatus,
      reason: string,
    ): ReservationRef | null => {
      if (!reservation && session.target_kind === "default") {
        const reservationId = `res_${crypto.randomUUID()}`;
        addDefaultReservation.run(
          reservationId,
          session.atlas_id,
          repositoryId,
          null,
          null,
          null,
          null,
          observedAt,
          publicationEvidence(status, null, reason, observedAt),
        );
        addHistory.run(
          session.atlas_id,
          "publication_reservation_created",
          observedAt,
          "A default-branch Session has ambiguous publication; each candidate standalone parent remains reserved until owner release.",
          JSON.stringify({ reservationId, candidatePullRequestIds: matches.map((match) => match.github_id) }),
        );
        reservation = { reservation_id: reservationId, state: "held" };
      }
      if (reservation?.state === "held") {
        for (const match of matches) {
          addAmbiguousConflictHold.run(
            reservation.reservation_id,
            repositoryId,
            match.github_id,
            match.number,
            observedAt,
            "Ambiguous publication ownership retains this candidate target until the owner is explicitly released.",
          );
        }
        updateEvidence.run(publicationEvidence(status, null, reason, observedAt), reservation.reservation_id);
      }
      return reservation;
    };
    const release = database.query(`
      UPDATE stack_reservations
      SET state = 'released', released_at = ?, release_kind = 'automatic', release_reason = ?, publication_evidence = ?
      WHERE reservation_id = ? AND state = 'held'
    `);
    const deleteConflictHolds = database.query(
      "DELETE FROM reservation_conflict_holds WHERE reservation_id = ?",
    );

    for (const session of rows) {
      if (session.publication_status === "released") continue;

      let result = session.result_pull_request_id
        ? publicationPullRequest(repositoryId, session.result_pull_request_id)
        : null;
      let resultId = session.result_pull_request_id;
      let status: PublicationStatus = session.publication_status;
      let reason = session.publication_reason ?? "Publication has not been checked yet.";
      let reservation = reservationForSession.get(session.atlas_id) as ReservationRef | null;

      if (!resultId) {
        const matches = publicationBranchMatches(repositoryId, session.working_branch!);
        if (status === "ambiguous") {
          reservation = retainAmbiguousDefaultOwnership(session, reservation, matches, status, reason);
          continue;
        }
        if (matches.length > 1) {
          status = "ambiguous";
          reason = "Publication could not be verified: multiple Pull requests use the unique working branch; Atlas will not choose one.";
          updateSession.run(null, status, reason, observedAt, isoNow(now), session.atlas_id);
          addHistory.run(session.atlas_id, "publication_ambiguous", observedAt, reason, JSON.stringify({ branch: session.working_branch }));
          reservation = retainAmbiguousDefaultOwnership(session, reservation, matches, status, reason);
          continue;
        }
        const match = matches[0];
        if (!match || match.is_current !== 1) {
          status = "unverified";
          reason = "Publication could not be verified: no current Pull request uses the unique working branch in this Repository.";
          updateSession.run(null, status, reason, observedAt, isoNow(now), session.atlas_id);
          continue;
        }
        result = match;
        resultId = match.github_id;
        status = "identified";
        reason = `Publication identified as Pull request #${match.number} by Repository and the unique working branch.`;
        updateSession.run(resultId, status, reason, observedAt, isoNow(now), session.atlas_id);
        addHistory.run(session.atlas_id, "publication_identified", observedAt, reason, JSON.stringify({ pullRequestId: resultId, branch: session.working_branch }));
      }

      if (!resultId || !result || result.is_current !== 1) {
        status = status === "ambiguous" ? status : "identified";
        reason = "The permanently identified publication is not in the current complete Pull request projection; Atlas will not replace it.";
        updateSession.run(resultId, status, reason, observedAt, isoNow(now), session.atlas_id);
        continue;
      }

      if (!reservation && session.target_kind === "default") {
        const reservationId = `res_${crypto.randomUUID()}`;
        const evidence = publicationEvidence("identified", resultId, reason, observedAt);
        addDefaultReservation.run(
          reservationId,
          session.atlas_id,
          repositoryId,
          resultId,
          result.number,
          resultId,
          result.number,
          observedAt,
          evidence,
        );
        addResultEvidence.run(reservationId, resultId, observedAt);
        addHistory.run(
          session.atlas_id,
          "publication_reservation_created",
          observedAt,
          "A default-branch Session published a standalone parent; its first-child target is reserved until owner release.",
          JSON.stringify({ reservationId, resultPullRequestId: resultId }),
        );
        reservation = { reservation_id: reservationId, state: "held" };
      }

      if (reservation && reservation.state === "held") {
        addResultEvidence.run(reservation.reservation_id, resultId, observedAt);
      }

      const qualificationReason = publicationQualification(session, result);
      if (qualificationReason) {
        status = "identified";
        reason = qualificationReason;
        updateSession.run(resultId, status, reason, observedAt, isoNow(now), session.atlas_id);
        if (reservation?.state === "held") {
          updateEvidence.run(publicationEvidence(status, resultId, reason, observedAt), reservation.reservation_id);
        }
        continue;
      }

      if (!terminalExecution(session.state)) {
        status = "qualifying";
        reason = "Fresh GitHub evidence shows a qualifying publication; the reservation remains held until confirmed terminal execution.";
        updateSession.run(resultId, status, reason, observedAt, isoNow(now), session.atlas_id);
        if (reservation?.state === "held") updateEvidence.run(publicationEvidence(status, resultId, reason, observedAt), reservation.reservation_id);
        continue;
      }

      if (reservation?.state !== "held") {
        status = "qualifying";
        reason = "Fresh publication is qualifying; no held reservation remains for this Session.";
        updateSession.run(resultId, status, reason, observedAt, isoNow(now), session.atlas_id);
        continue;
      }

      status = "released";
      reason = "Reservation automatically released after confirmed terminal execution and fresh qualifying publication.";
      const evidence = publicationEvidence(status, resultId, reason, observedAt);
      release.run(observedAt, reason, evidence, reservation.reservation_id);
      deleteConflictHolds.run(reservation.reservation_id);
      updateSession.run(resultId, status, reason, observedAt, isoNow(now), session.atlas_id);
      addHistory.run(session.atlas_id, "reservation_released", observedAt, reason, JSON.stringify({ reservationId: reservation.reservation_id, releaseKind: "automatic", resultPullRequestId: resultId }));
    }
  };

  type ReservationTarget = {
    kind: "native_stack" | "standalone_parent";
    stackId: string | null;
    stackNumber: string | null;
    parentPullRequestId: string | null;
    parentPullRequestNumber: string | null;
  };

  type ReservationRow = {
    reservation_id: string;
    session_id: string;
    accepted_target_kind: "native_stack" | "standalone_parent";
    accepted_stack_id: string | null;
    accepted_stack_number: string | null;
    accepted_parent_pull_request_id: string | null;
    accepted_parent_pull_request_number: string | null;
    state: "held" | "released";
    evidence_unknown: number;
    evidence_reason: string | null;
  };

  const reservationTargetKey = (target: ReservationTarget) => target.kind === "native_stack"
    ? target.stackId ? `native_stack:${target.stackId}` : null
    : target.parentPullRequestId ? `standalone_parent:${target.parentPullRequestId}` : null;

  const reservationTargetFromRow = (row: ReservationRow): ReservationTarget => ({
    kind: row.accepted_target_kind,
    stackId: row.accepted_stack_id,
    stackNumber: row.accepted_stack_number,
    parentPullRequestId: row.accepted_parent_pull_request_id,
    parentPullRequestNumber: row.accepted_parent_pull_request_number,
  });

  const reconcileReservations = (repositoryId: string, observedAt: string) => {
    const reservations = database.query(`
      SELECT reservation_id, session_id, accepted_target_kind, accepted_stack_id,
             accepted_stack_number, accepted_parent_pull_request_id,
             accepted_parent_pull_request_number, state, evidence_unknown, evidence_reason
      FROM stack_reservations
      WHERE repository_id = ? AND state = 'held'
      ORDER BY held_at, reservation_id
    `).all(repositoryId) as ReservationRow[];

    const addHistory = database.query(`
      INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const parentStackRows = database.query(`
      SELECT s.atlas_id, st.github_id AS stack_id, st.number AS stack_number,
             top_pr.head_ref AS top_branch
      FROM sessions s
      JOIN stack_members parent_member ON parent_member.pull_request_id = s.target_parent_pull_request_id
      JOIN pr_stacks st ON st.github_id = parent_member.stack_id AND st.is_current = 1
      JOIN stack_members top_member ON top_member.stack_id = st.github_id
      JOIN pull_requests top_pr ON top_pr.github_id = top_member.pull_request_id
      WHERE s.repository_id = ?
        AND s.state = 'queued'
        AND s.target_kind = 'standalone_parent'
        AND top_member.position = (
          SELECT MAX(last_member.position)
          FROM stack_members last_member
          WHERE last_member.stack_id = st.github_id
        )
      ORDER BY s.submission_order, s.atlas_id
    `).all(repositoryId) as Array<{
      atlas_id: string;
      stack_id: string;
      stack_number: string;
      top_branch: string;
    }>;

    // A standalone parent joining a verified stack is an explicit association,
    // not branch-name inference. Keep the original target for history/FIFO.
    for (const row of parentStackRows) {
      const changed = database.query(`
        UPDATE sessions
        SET target_kind = 'native_stack',
            target_stack_id = ?,
            target_stack_number = ?,
            target_parent_pull_request_id = NULL,
            target_parent_pull_request_number = NULL,
            target_branch = ?,
            admission_blocked = 0,
            state_reason = ?,
            preparation_reason = ?,
            updated_at = ?
        WHERE atlas_id = ? AND state = 'queued' AND target_kind = 'standalone_parent'
          AND NOT (admission_blocked = 1 AND COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%')
      `).run(
        row.stack_id,
        row.stack_number,
        row.top_branch,
        `The selected standalone parent now belongs to native stack #${row.stack_number}; following its verified current top.`,
        `The selected standalone parent now belongs to native stack #${row.stack_number}; following its verified current top.`,
        isoNow(now),
        row.atlas_id,
      );
      if (changed.changes > 0) {
        addHistory.run(
          row.atlas_id,
          "target_associated",
          observedAt,
          `The standalone parent joined native stack #${row.stack_number}; the queued request now follows the actual stack identity and top.`,
          JSON.stringify({ stackId: row.stack_id, stackNumber: row.stack_number }),
        );
      }
    }

    const currentStackTargets = database.query(`
      SELECT s.atlas_id, st.number AS stack_number, top_pr.head_ref AS top_branch
      FROM sessions s
      JOIN pr_stacks st ON st.github_id = s.target_stack_id AND st.is_current = 1
      JOIN stack_members top_member ON top_member.stack_id = st.github_id
      JOIN pull_requests top_pr ON top_pr.github_id = top_member.pull_request_id AND top_pr.is_current = 1
      WHERE s.repository_id = ?
        AND s.state = 'queued'
        AND s.target_kind = 'native_stack'
        AND top_member.position = (
          SELECT MAX(last_member.position)
          FROM stack_members last_member
          WHERE last_member.stack_id = st.github_id
        )
      ORDER BY s.submission_order, s.atlas_id
    `).all(repositoryId) as Array<{
      atlas_id: string;
      stack_number: string;
      top_branch: string;
    }>;
    for (const row of currentStackTargets) {
      database.query(`
        UPDATE sessions
        SET target_stack_number = ?, target_branch = ?, updated_at = ?
        WHERE atlas_id = ? AND state = 'queued'
          AND (target_stack_number IS NOT ? OR target_branch IS NOT ?)
      `).run(row.stack_number, row.top_branch, isoNow(now), row.atlas_id, row.stack_number, row.top_branch);
    }

    const vanishedTargets = database.query(`
      SELECT atlas_id, target_kind, target_stack_id, target_parent_pull_request_id
      FROM sessions
      WHERE repository_id = ? AND state = 'queued' AND (
        (target_kind = 'native_stack' AND NOT EXISTS (
          SELECT 1 FROM pr_stacks WHERE github_id = sessions.target_stack_id AND repository_id = ? AND is_current = 1
        ))
        OR (target_kind = 'standalone_parent' AND NOT EXISTS (
          SELECT 1 FROM pull_requests WHERE github_id = sessions.target_parent_pull_request_id AND repository_id = ? AND is_current = 1
        ))
      )
        AND state_reason NOT LIKE 'Waiting for explicit target reconfirmation%'
      ORDER BY submission_order, atlas_id
    `).all(repositoryId, repositoryId, repositoryId) as Array<{
      atlas_id: string;
      target_kind: TargetKind;
      target_stack_id: string | null;
      target_parent_pull_request_id: string | null;
    }>;
    for (const target of vanishedTargets) {
      const reason = target.target_kind === "native_stack"
        ? "Waiting for explicit target reconfirmation; the selected native stack no longer exists in the complete GitHub projection."
        : "Waiting for explicit target reconfirmation; the selected standalone parent no longer exists in the complete GitHub projection.";
      database.query(`
        UPDATE sessions
        SET admission_blocked = 1, state_reason = ?, preparation_reason = ?, updated_at = ?
        WHERE atlas_id = ? AND state = 'queued'
      `).run(reason, reason, isoNow(now), target.atlas_id);
      addHistory.run(target.atlas_id, "target_disappeared", observedAt, reason, JSON.stringify({
        targetKind: target.target_kind,
        stackId: target.target_stack_id,
        parentPullRequestId: target.target_parent_pull_request_id,
      }));
    }

    const reservationAssociation = database.query(`
      SELECT r.reservation_id, r.session_id, r.accepted_parent_pull_request_id,
             sm.stack_id, st.number AS stack_number
      FROM stack_reservations r
      JOIN stack_members sm ON sm.pull_request_id = r.accepted_parent_pull_request_id
      JOIN pr_stacks st ON st.github_id = sm.stack_id AND st.is_current = 1
      WHERE r.repository_id = ?
        AND r.state = 'held'
        AND r.accepted_target_kind = 'standalone_parent'
    `).all(repositoryId) as Array<{
      reservation_id: string;
      session_id: string;
      accepted_parent_pull_request_id: string;
      stack_id: string;
      stack_number: string;
    }>;
    for (const row of reservationAssociation) {
      const changed = database.query(`
        UPDATE stack_reservations
        SET accepted_target_kind = 'native_stack',
            accepted_stack_id = ?,
            accepted_stack_number = ?
        WHERE reservation_id = ? AND state = 'held' AND accepted_target_kind = 'standalone_parent'
      `).run(row.stack_id, row.stack_number, row.reservation_id);
      if (changed.changes > 0) {
        const owner = reservations.find((candidate) => candidate.reservation_id === row.reservation_id);
        if (owner) {
          owner.accepted_target_kind = "native_stack";
          owner.accepted_stack_id = row.stack_id;
          owner.accepted_stack_number = row.stack_number;
        }
        addHistory.run(
          row.session_id,
          "reservation_target_associated",
          observedAt,
          `The reserved standalone parent joined native stack #${row.stack_number}; ownership follows the explicit stack identity.`,
          JSON.stringify({ reservationId: row.reservation_id, stackId: row.stack_id, stackNumber: row.stack_number }),
        );
      }
    }

    const targetOwners = new Map<string, { target: ReservationTarget; reservations: Set<string> }>();
    const unknownReservations = new Set<string>();
    const updateEvidence = database.query(`
      UPDATE stack_reservations
      SET evidence_unknown = ?, evidence_reason = ?
      WHERE reservation_id = ? AND state = 'held'
    `);
    const evidenceRows = database.query(`
      SELECT rp.pull_request_id, p.is_current, p.number AS pull_request_number,
             sm.stack_id, st.number AS stack_number
      FROM reservation_prs rp
      LEFT JOIN pull_requests p ON p.github_id = rp.pull_request_id AND p.repository_id = ?
      LEFT JOIN stack_members sm ON sm.pull_request_id = p.github_id
      LEFT JOIN pr_stacks st ON st.github_id = sm.stack_id AND st.is_current = 1
      WHERE rp.reservation_id = ?
    `);

    for (const reservation of reservations) {
      const targetSet = new Map<string, ReservationTarget>();
      const accepted = reservationTargetFromRow(reservation);
      const acceptedKey = reservationTargetKey(accepted);
      if (acceptedKey) targetSet.set(acceptedKey, accepted);

      let unknown = false;
      const evidence = evidenceRows.all(repositoryId, reservation.reservation_id) as Array<{
        pull_request_id: string;
        is_current: number | null;
        pull_request_number: string | null;
        stack_id: string | null;
        stack_number: string | null;
      }>;
      for (const row of evidence) {
        if (row.is_current !== 1) {
          unknown = true;
          continue;
        }
        if (row.stack_id && row.stack_number) {
          const target: ReservationTarget = {
            kind: "native_stack",
            stackId: row.stack_id,
            stackNumber: row.stack_number,
            parentPullRequestId: null,
            parentPullRequestNumber: null,
          };
          const key = reservationTargetKey(target);
          if (key) targetSet.set(key, target);
        } else if (row.pull_request_number) {
          const target: ReservationTarget = {
            kind: "standalone_parent",
            stackId: null,
            stackNumber: null,
            parentPullRequestId: row.pull_request_id,
            parentPullRequestNumber: row.pull_request_number,
          };
          const key = reservationTargetKey(target);
          if (key) targetSet.set(key, target);
        }
      }

      const evidenceReason = unknown
        ? "Waiting for GitHub verification of a retained reservation PR's current location; Atlas will not infer absence."
        : null;
      updateEvidence.run(unknown ? 1 : 0, evidenceReason, reservation.reservation_id);
      if (unknown) unknownReservations.add(reservation.reservation_id);

      for (const target of targetSet.values()) {
        const key = reservationTargetKey(target);
        if (!key) continue;
        const owners = targetOwners.get(key) ?? { target, reservations: new Set<string>() };
        owners.reservations.add(reservation.reservation_id);
        targetOwners.set(key, owners);
      }
    }

    // Clear only the scoped pause this reconciler owns; target disappearance and
    // other eligibility decisions remain blocked until explicit reconfirmation.
    database.query(`
      UPDATE sessions
      SET admission_blocked = 0, updated_at = ?
      WHERE repository_id = ? AND state = 'queued' AND admission_blocked = 1
        AND state_reason LIKE 'Waiting for GitHub verification of a retained reservation PR%'
    `).run(isoNow(now), repositoryId);

    const addHold = database.query(`
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
    `);
    const markQueuedConflict = (target: ReservationTarget, reason: string) => {
      if (target.kind === "native_stack" && target.stackId) {
        database.query(`
          UPDATE sessions
          SET admission_blocked = 1,
              state_reason = CASE WHEN COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%' THEN state_reason ELSE ? END,
              preparation_reason = CASE WHEN COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%' THEN preparation_reason ELSE ? END,
              updated_at = ?
          WHERE repository_id = ? AND state = 'queued' AND target_kind = 'native_stack' AND target_stack_id = ?
        `).run(reason, reason, isoNow(now), repositoryId, target.stackId);
      } else if (target.kind === "standalone_parent" && target.parentPullRequestId) {
        database.query(`
          UPDATE sessions
          SET admission_blocked = 1,
              state_reason = CASE WHEN COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%' THEN state_reason ELSE ? END,
              preparation_reason = CASE WHEN COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%' THEN preparation_reason ELSE ? END,
              updated_at = ?
          WHERE repository_id = ? AND state = 'queued' AND target_kind = 'standalone_parent' AND target_parent_pull_request_id = ?
        `).run(reason, reason, isoNow(now), repositoryId, target.parentPullRequestId);
      }
    };

    for (const { target, reservations: owners } of targetOwners.values()) {
      if (owners.size < 2) continue;
      const reason = "Reservation conflict: multiple Atlas owners affect this target; new admission waits until every owner releases.";
      for (const reservationId of owners) {
        const values = target.kind === "native_stack"
          ? ["native_stack", target.stackId, target.stackNumber, null, null]
          : ["standalone_parent", null, null, target.parentPullRequestId, target.parentPullRequestNumber];
        const result = addHold.run(
          reservationId,
          repositoryId,
          ...values,
          observedAt,
          reason,
          reservationId,
          values[0],
          values[1],
          values[3],
        );
        if (result.changes > 0) {
          const owner = reservations.find((candidate) => candidate.reservation_id === reservationId);
          if (owner) addHistory.run(owner.session_id, "reservation_conflict", observedAt, reason, JSON.stringify({ target, reservationIds: [...owners] }));
        }
      }
      markQueuedConflict(target, reason);
    }

    if (unknownReservations.size > 0) {
      const reason = "Waiting for GitHub verification of a retained reservation PR's current location; Atlas will not infer absence.";
      database.query(`
        UPDATE sessions
        SET admission_blocked = 1,
            state_reason = CASE WHEN COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%' THEN state_reason ELSE ? END,
            preparation_reason = CASE WHEN COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%' THEN preparation_reason ELSE ? END,
            updated_at = ?
        WHERE repository_id = ? AND state = 'queued' AND target_kind != 'default'
      `).run(reason, reason, isoNow(now), repositoryId);
    }

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

      // A complete Pull request read is the fresh publication evidence boundary.
      reconcilePublications(repositoryId, observedAt);
      reconcileReservations(repositoryId, observedAt);

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
           publication_pr.number AS publication_pr_number,
           publication_pr.html_url AS publication_pr_url,
           r.reservation_id,
           r.state AS reservation_state,
           COALESCE(r.release_reason, r.evidence_reason) AS reservation_reason,
           (SELECT COUNT(*) FROM reservation_conflict_holds h
            WHERE h.reservation_id = r.reservation_id) AS reservation_conflict_count
    FROM sessions s
    LEFT JOIN pull_requests publication_pr ON publication_pr.github_id = s.result_pull_request_id
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

  const reconfirmQueuedTarget = (
    atlasId: string,
    target: SessionTarget,
    targetBranch: string,
    reason = "Queued target was explicitly reconfirmed against a fresh GitHub projection.",
  ): TargetReconfirmationResult => {
    let result!: TargetReconfirmationResult;
    const [targetKind, targetStackId, targetStackNumber, targetParentId, targetParentNumber] = targetColumns(target);
    const reconfirm = database.transaction(() => {
      const current = getSession(atlasId);
      if (!current) {
        result = { kind: "not_found", session: undefined };
        return;
      }
      if (current.state !== "queued") {
        result = { kind: "not_queued", session: current };
        return;
      }
      const timestamp = isoNow(now);
      database.query(`
        UPDATE sessions
        SET target_kind = ?,
            target_branch = ?,
            target_stack_id = ?,
            target_stack_number = ?,
            target_parent_pull_request_id = ?,
            target_parent_pull_request_number = ?,
            admission_blocked = 0,
            state_reason = ?,
            preparation_reason = ?,
            updated_at = ?
        WHERE atlas_id = ? AND state = 'queued'
      `).run(
        targetKind,
        targetBranch,
        targetStackId,
        targetStackNumber,
        targetParentId,
        targetParentNumber,
        reason,
        reason,
        timestamp,
        atlasId,
      );
      database.query(`
        INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
        VALUES (?, 'target_reconfirmed', ?, ?, ?)
      `).run(atlasId, timestamp, reason, JSON.stringify({ target }));
      result = { kind: "updated", session: getSession(atlasId)! };
    });
    reconfirm.immediate();
    return result;
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
            AND NOT (admission_blocked = 1 AND COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%')
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
              r.evidence_unknown = 1
              OR
              (${target.kind === "native_stack" ? "r.accepted_target_kind = 'native_stack' AND r.accepted_stack_id = ?" : "0"})
              OR (${target.kind === "standalone_parent" ? "r.accepted_target_kind = 'standalone_parent' AND r.accepted_parent_pull_request_id = ?" : "0"})
              OR (${target.kind === "native_stack" ? "sm.stack_id = ?" : "0"})
              OR (${target.kind === "standalone_parent" ? "rp.pull_request_id = ?" : "0"})
              OR (${target.kind === "native_stack" ? "h.target_kind = 'native_stack' AND h.stack_id = ?" : "0"})
              OR (${target.kind === "standalone_parent" ? "h.target_kind = 'standalone_parent' AND h.parent_pull_request_id = ?" : "0"})
            )
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
          const conflictReason = "Waiting for another Session's stack reservation to release before preparation.";
          database.query(`
            UPDATE sessions
            SET admission_blocked = 1,
                state_reason = ?,
                preparation_reason = ?,
                updated_at = ?
            WHERE atlas_id = ? AND state = 'queued'
          `).run(conflictReason, conflictReason, isoNow(now), atlasId);
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
            conflictReason,
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
        AND NOT (admission_blocked = 1 AND COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%')
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
        AND NOT (admission_blocked = 1 AND COALESCE(state_reason, '') LIKE 'Waiting for explicit target reconfirmation%')
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

  const releaseReservation = (atlasId: string, reason = "Reservation explicitly released after confirmed terminal execution; publication was not treated as verified."): ReservationReleaseResult => {
    let result!: ReservationReleaseResult;
    const release = database.transaction(() => {
      const current = getSession(atlasId);
      if (!current) throw new Error("Session not found");
      if (!terminalExecution(current.state)) {
        result = { kind: "not_terminal", session: current };
        return;
      }

      const reservation = database.query(`
        SELECT reservation_id, state FROM stack_reservations WHERE session_id = ?
      `).get(atlasId) as { reservation_id: string; state: "held" | "released" } | null;
      if (!reservation) {
        result = { kind: "not_found", session: current };
        return;
      }
      if (reservation.state === "released") {
        result = { kind: "already_released", session: current };
        return;
      }

      const timestamp = isoNow(now);
      database.query(`
        UPDATE stack_reservations
        SET state = 'released', released_at = ?, release_kind = 'explicit', release_reason = ?,
            publication_evidence = ?
        WHERE reservation_id = ? AND state = 'held'
      `).run(
        timestamp,
        reason,
        publicationEvidence("released", current.resultPullRequestId, reason, timestamp),
        reservation.reservation_id,
      );
      database.query("DELETE FROM reservation_conflict_holds WHERE reservation_id = ?").run(reservation.reservation_id);
      database.query(`
        UPDATE sessions
        SET publication_status = 'released', publication_reason = ?, publication_observed_at = ?, updated_at = ?
        WHERE atlas_id = ?
      `).run(reason, timestamp, timestamp, atlasId);
      database.query(`
        INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json)
        VALUES (?, 'reservation_released', ?, ?, ?)
      `).run(
        atlasId,
        timestamp,
        reason,
        JSON.stringify({ reservationId: reservation.reservation_id, releaseKind: "explicit", resultPullRequestId: current.resultPullRequestId }),
      );
      result = { kind: "released", session: getSession(atlasId)! };
    });
    release.immediate();
    return result;
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
    removeRepository,
    restoreRepository,
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
    reconfirmQueuedTarget,
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
    releaseReservation,
    listOpenCodeSessions,
    getSessionByOpenCodeSessionId,
    listSessions,
    listSessionsForSpec,
  };
};

export type Persistence = ReturnType<typeof createPersistence>;
