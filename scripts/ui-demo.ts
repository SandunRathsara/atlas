// Seeded UI preview server. Run with `bun scripts/ui-demo.ts` (or `bun run demo`).
//
// Every start builds a fresh temporary SQLite database seeded through the real
// persistence API, injects fake GitHub / OpenCode / update services, and serves
// the real Atlas app plus a `/__demo` index of every screen and state. It never
// touches `data/atlas.sqlite`, `~/.config/atlas`, a live OpenCode, or the network.
import "./isolate-opencode.ts";
import type { OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode/client";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { GitHubError, type GitHubClient, type GitHubIssue, type GitHubPullRequest, type GitHubRepository, type GitHubStack } from "../src/github.ts";
import { visitCookie } from "../src/inbox-state.ts";
import { createPersistence, type RefreshView, type SessionTarget } from "../src/persistence.ts";
import { parseReleaseTag, type PublishedReleaseIdentity, type ReleaseMetadata } from "../src/release.ts";
import { createRefreshCoordinator, type RefreshCoordinator } from "../src/sync.ts";
import type { UpdateService, UpdateStatus } from "../src/update-discovery.ts";
import type { ActivationState, UpdatePolicy, UpdaterStatus } from "../src/updater.ts";

const HOST = process.env.ATLAS_DEMO_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ATLAS_DEMO_PORT ?? "4010");
const TOKEN = process.env.ATLAS_DEMO_TOKEN ?? "demo";
const ORG = "ledgerly";
const INSTALLATION = "48151623";

const BOOT = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const ago = (ms: number) => iso(BOOT - ms);

// The app serves the built stylesheet; build it once if this checkout has none yet.
const repoRoot = join(import.meta.dir, "..");
if (!existsSync(join(repoRoot, "public", "app.css"))) {
  const build = Bun.spawnSync(["bun", "run", "build:css"], { cwd: repoRoot, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("bun run build:css failed");
}
// A long-running preview must survive a bad request; log and keep serving.
process.on("uncaughtException", (error) => console.error("[demo] uncaught:", error));
process.on("unhandledRejection", (error) => console.error("[demo] unhandled rejection:", error));

const root = mkdtempSync(join(tmpdir(), "atlas-ui-demo-"));
const sessionRoot = join(root, "sessions");
mkdirSync(sessionRoot, { recursive: true });

// ---------------------------------------------------------------------------
// System warning (recovery status file read by every page shell)
// ---------------------------------------------------------------------------

const recoveryPath = join(root, "recovery-status");
process.env.ATLAS_RECOVERY_STATUS_PATH = recoveryPath;
let systemWarning = false;
const statusTime = (ms: number) => iso(ms).replace(/\.\d{3}Z$/, "Z");
const snapshotName = (ms: number) => `atlas-v1-${statusTime(ms).replace(/[-:]/g, "")}`;
const writeRecoveryStatus = () => {
  const now = Date.now();
  const lastBackup = now - (systemWarning ? 30 * HOUR : 2 * HOUR);
  const lines = systemWarning
    ? {
      space_state: "warning", space_available_bytes: String(3 * 1024 ** 3), space_metadata_percent: "91", space_reason: "free_bytes_and_metadata",
      backup_state: "failure", backup_reason: "snapshot_failed",
    }
    : {
      space_state: "healthy", space_available_bytes: String(182 * 1024 ** 3), space_metadata_percent: "22", space_reason: "none",
      backup_state: "success", backup_reason: "none",
    };
  writeFileSync(recoveryPath, [
    "version=1",
    `space_checked_at=${statusTime(now)}`,
    `space_state=${lines.space_state}`,
    `space_available_bytes=${lines.space_available_bytes}`,
    `space_metadata_percent=${lines.space_metadata_percent}`,
    `space_reason=${lines.space_reason}`,
    `backup_checked_at=${statusTime(now)}`,
    `backup_state=${lines.backup_state}`,
    `backup_last_success_at=${statusTime(lastBackup)}`,
    `backup_last_snapshot=${snapshotName(lastBackup)}`,
    `backup_reason=${lines.backup_reason}`,
  ].join("\n") + "\n");
};
writeRecoveryStatus();
setInterval(writeRecoveryStatus, 5 * MIN);

// ---------------------------------------------------------------------------
// Fake GitHub: the single source of truth projected through the real sync code
// ---------------------------------------------------------------------------

const ghRepo = (id: string, name: string, description: string | null, extra: Partial<GitHubRepository> = {}): GitHubRepository => ({
  id,
  owner: ORG,
  name,
  fullName: `${ORG}/${name}`,
  htmlUrl: `https://github.com/${ORG}/${name}`,
  description,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
  ...extra,
});

const R = {
  payments: ghRepo("1001", "payments-api", "Card and bank payment orchestration: authorizations, captures, refunds, and PSP webhooks."),
  ledger: ghRepo("1002", "ledger-service", "Double-entry ledger, balances, and end-of-day reconciliation."),
  dashboard: ghRepo("1003", "web-dashboard", "Merchant-facing dashboard for payouts, disputes, and reporting."),
  mobile: ghRepo("1004", "mobile-app", "React Native wallet app for iOS and Android."),
  infra: ghRepo("1005", "infra-terraform", "Terraform modules for the payments platform (frozen; moved to platform-iac).", { archived: true }),
  fraud: ghRepo("1006", "fraud-rules", "Rule engine and scoring thresholds for transaction risk."),
  reports: ghRepo("1007", "legacy-reports", "Nightly CSV settlement reports (being replaced by the dashboard)."),
  docs: ghRepo("1008", "docs-site", "Public API documentation and changelog."),
  sdk: ghRepo("1009", "sdk-python", "Official Python SDK for the Ledgerly API."),
  risk: ghRepo("1010", "risk-models", null),
};
const enrolledRepos = [R.payments, R.ledger, R.dashboard, R.mobile, R.infra, R.fraud, R.reports];
const inventory = [...enrolledRepos, R.docs, R.sdk, R.risk];

let issueId = 50_000;
const issue = (repo: GitHubRepository, number: number, title: string, body: string, updatedAgo: number, labels = ["spec"]): GitHubIssue => ({
  id: String(issueId++),
  number: String(number),
  title,
  body,
  htmlUrl: `${repo.htmlUrl}/issues/${number}`,
  state: "open",
  labels,
  isPullRequest: false,
  updatedAt: ago(updatedAgo),
});

const idempotencyBody = `## Problem

Merchants retry \`POST /v1/payments\` when our gateway times out. Today each retry creates a **new** authorization, so a flaky network can double-charge a cardholder.

## Goal

Accept an \`Idempotency-Key\` header and return the original response for repeated requests with the same key.

## Requirements

1. Keys are scoped per merchant and expire after **24 hours**.
2. A replay with a different request body returns \`422 idempotency_key_reused\`.
3. Concurrent requests with the same key wait for the first one to finish.
   - Lock timeout: 10 seconds
   - On timeout return \`409 request_in_progress\`

| Case | Status | Body |
|---|---|---|
| First request | 201 | New payment |
| Same key, same body | 201 | Original payment (cached) |
| Same key, different body | 422 | \`idempotency_key_reused\` |
| Same key, still running | 409 | \`request_in_progress\` |

\`\`\`ts
const key = c.req.header("Idempotency-Key");
const cached = await idempotency.lookup(merchantId, key);
if (cached) return c.json(cached.body, cached.status);
\`\`\`

## Out of scope

- Idempotency for refunds (tracked in #17)
- Dashboard UI for inspecting keys

See [Stripe's write-up](https://stripe.com/blog/idempotency) for prior art.`;

const webhookBody = `## Context

PSP webhooks (\`charge.succeeded\`, \`charge.refunded\`) are dropped when our worker restarts mid-delivery. The PSP only retries 3 times over 10 minutes.

## What to build

- Persist every inbound webhook to \`webhook_inbox\` **before** acknowledging.
- A worker drains the inbox with exponential backoff: 30s, 2m, 10m, 1h, 6h.
- After the last attempt, mark the event \`dead\` and alert \`#payments-oncall\`.

### Acceptance

- [ ] Restarting the worker during delivery loses no events
- [ ] Duplicate deliveries are processed once (dedupe on \`event.id\`)
- [ ] Metrics: \`webhook_inbox_depth\`, \`webhook_attempts_total{outcome}\`

\`\`\`sql
CREATE TABLE webhook_inbox (
  event_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL
);
\`\`\``;

const roundingBody = `## Bug

Partial refunds in JPY and KRW (zero-decimal currencies) are off by one minor unit when the refund is a percentage of the original charge.

Example: refunding 33% of ¥1,000 returns ¥329 instead of ¥330.

## Fix

Use banker's rounding (**round half to even**) everywhere amounts are derived, and centralise it in \`money.ts\`.

| Currency | Decimals | Example in | Expected out |
|---|---|---|---|
| USD | 2 | 10.005 | 10.00 |
| JPY | 0 | 329.5 | 330 |
| KWD | 3 | 1.0005 | 1.000 |

> Finance has asked that we confirm the rounding mode with them before shipping.`;

const refundBody = `Allow refunding part of a captured payment, multiple times, until the captured amount is exhausted.

- \`POST /v1/payments/:id/refunds\` with \`amount\`
- Reject when \`sum(refunds) + amount > captured\`
- Emit \`payment.refunded\` with \`partial: true\``;

const rateLimitBody = `## Summary

Add per-merchant rate limits to the public API.

- Default: **100 req/s** burst, 50 req/s sustained
- Return \`429\` with \`Retry-After\`
- Allow overrides per merchant in \`merchant_limits\``;

const scaBody = `## Strong Customer Authentication

EU cards now require 3-D Secure 2 for most card-not-present payments.

1. Detect SCA-required responses from the PSP (\`authentication_required\`).
2. Return a \`next_action.redirect_url\` to the merchant.
3. Resume the authorization on the challenge callback.

\`\`\`json
{ "status": "requires_action", "next_action": { "type": "redirect", "url": "https://acs.example/..." } }
\`\`\``;

const auditBody = `Every state change on a payment should append a row to \`payment_audit\` with actor, old state, new state, and request id. Needed for the SOC 2 audit in Q1.`;

const issues: Record<string, GitHubIssue[]> = {
  [R.payments.id]: [
    issue(R.payments, 12, "Add idempotency keys to payment creation", idempotencyBody, 3 * HOUR),
    issue(R.payments, 14, "Retry PSP webhooks with a durable inbox", webhookBody, 40 * MIN),
    issue(R.payments, 15, "Fix rounding for partial refunds in zero-decimal currencies", roundingBody, 2 * HOUR),
    issue(R.payments, 17, "Support multiple partial refunds per payment", refundBody, 26 * HOUR),
    issue(R.payments, 18, "Per-merchant API rate limits", rateLimitBody, 4 * DAY),
    issue(R.payments, 21, "3-D Secure 2 challenge flow for EU cards", scaBody, 6 * HOUR),
    issue(R.payments, 22, "Append-only audit log for payment state changes", auditBody, 12 * DAY),
    issue(R.payments, 23, "Flaky test: captures_test times out on CI", "Not a spec — just a bug report.", 5 * HOUR, ["bug"]),
  ],
  [R.ledger.id]: [
    issue(R.ledger, 7, "Nightly reconciliation against bank statements", `## Goal\n\nMatch every ledger entry against the bank's MT940 statement each night and report breaks.\n\n- Parse MT940 files from the SFTP drop\n- Match on amount + value date + reference\n- Write unmatched lines to \`reconciliation_breaks\``, 5 * HOUR),
    issue(R.ledger, 8, "Expose account balances at a point in time", `Add \`GET /v1/accounts/:id/balance?at=2026-11-01T00:00:00Z\`.\n\nBalances must be computed from entries, never cached columns.`, 9 * HOUR),
    issue(R.ledger, 9, "Multi-currency accounts with FX revaluation", `Support holding EUR, GBP, and USD in one account.\n\n1. One sub-ledger per currency\n2. Daily FX revaluation entries\n3. Report unrealised gains/losses`, 30 * MIN),
    issue(R.ledger, 10, "Reject unbalanced journal entries", "Every journal must have debits equal to credits; reject otherwise with `422 unbalanced_journal`.", 3 * DAY),
    issue(R.ledger, 11, "Archive closed periods to cold storage", "Move entries for closed accounting periods older than 2 years to the archive schema.", 2 * DAY),
    issue(R.ledger, 12, "Migrate ledger IDs to ULIDs", "Replace sequential integer IDs with ULIDs so IDs are sortable and not guessable.", 20 * HOUR),
    issue(R.ledger, 13, "Daily trial balance export", "Export a trial balance CSV to the finance bucket at 02:00 UTC.", 8 * DAY),
  ],
  [R.dashboard.id]: [
    issue(R.dashboard, 31, "Dark mode for the merchant dashboard", "Respect `prefers-color-scheme` and add a manual toggle in settings.", 2 * DAY),
    issue(R.dashboard, 32, "Payout calendar view", `Show upcoming payouts on a month calendar.\n\n- Colour by status: scheduled, in transit, paid, failed\n- Click a day to see the payouts`, 7 * HOUR),
    issue(R.dashboard, 33, "CSV export for disputes", "Merchants need to export disputes with reason codes and evidence due dates.", 1 * DAY),
  ],
  [R.mobile.id]: [],
  [R.infra.id]: [
    issue(R.infra, 4, "Rotate RDS credentials via Secrets Manager", "Use the rotation lambda instead of static passwords.", 40 * DAY),
    issue(R.infra, 5, "Move NAT gateways to one per AZ", "Reduce cross-AZ data charges.", 60 * DAY),
  ],
  [R.fraud.id]: [
    issue(R.fraud, 3, "Velocity rule: more than 5 cards per device per hour", "Block when one device fingerprint uses more than 5 distinct cards within an hour.", 2 * DAY),
    issue(R.fraud, 6, "Score explanations for analysts", "Return the top 3 contributing features with every risk score.", 5 * DAY),
  ],
  [R.reports.id]: [
    issue(R.reports, 2, "Add settlement currency to nightly CSV", "Finance needs the settlement currency column.", 90 * DAY),
  ],
};

let prId = 70_000;
const sha = (seed: string) => Bun.hash(seed).toString(16).padStart(16, "0").repeat(3).slice(0, 40);
const pr = (repo: GitHubRepository, number: number, title: string, headRef: string, extra: Partial<GitHubPullRequest> = {}): GitHubPullRequest => ({
  id: String(prId++),
  number: String(number),
  title,
  htmlUrl: `${repo.htmlUrl}/pull/${number}`,
  state: "open",
  draft: false,
  mergedAt: null,
  headRef,
  headSha: sha(`${repo.name}:${headRef}`),
  headRepositoryId: repo.id,
  baseRef: "main",
  baseSha: sha(`${repo.name}:main`),
  mergeableState: "clean",
  autoMergeEnabled: false,
  mergeQueueState: "none",
  updatedAt: ago(3 * HOUR),
  ...extra,
});

const pullRequests: Record<string, GitHubPullRequest[]> = {
  [R.payments.id]: [
    pr(R.payments, 201, "Extract payment state machine", "stack/payments-state-machine", { state: "closed", mergedAt: ago(2 * DAY), updatedAt: ago(2 * DAY) }),
    pr(R.payments, 202, "Add capture and void transitions", "stack/payments-capture-void", { baseRef: "stack/payments-state-machine", updatedAt: ago(5 * HOUR) }),
    pr(R.payments, 203, "WIP: refund transitions", "stack/payments-refunds", { draft: true, baseRef: "stack/payments-capture-void", updatedAt: ago(50 * MIN) }),
    pr(R.payments, 211, "Old PSP client wrapper", "stack/psp-client", { state: "closed", updatedAt: ago(4 * DAY) }),
    pr(R.payments, 212, "Switch to the new PSP SDK", "stack/psp-sdk", { baseRef: "stack/psp-client", updatedAt: ago(4 * DAY) }),
    pr(R.payments, 225, "Add idempotency keys to payment creation", "atlas/payments-api-12-idempotency-keys", { updatedAt: ago(35 * MIN) }),
  ],
  [R.ledger.id]: [
    pr(R.ledger, 301, "Introduce Money value object", "feature/money-value-object", { updatedAt: ago(6 * HOUR) }),
    pr(R.ledger, 302, "Backport balance fix to 2.x", "fix/balance-2x", { baseRef: "release/2.x", updatedAt: ago(1 * DAY) }),
    pr(R.ledger, 303, "Speed up entry listing with a covering index", "perf/covering-index", { updatedAt: ago(2 * DAY) }),
    pr(R.ledger, 304, "Typo fixes in README", "patch-1", { headRepositoryId: null, updatedAt: ago(3 * DAY) }),
    pr(R.ledger, 305, "Reject unbalanced journal entries", "atlas/ledger-service-10-reject-unbalanced", { state: "closed", mergedAt: ago(2 * DAY), updatedAt: ago(2 * DAY) }),
  ],
  [R.dashboard.id]: [
    pr(R.dashboard, 41, "Upgrade charts library", "deps/charts-v5", { updatedAt: ago(1 * DAY) }),
  ],
  [R.mobile.id]: [],
  [R.infra.id]: [],
  [R.fraud.id]: [],
  [R.reports.id]: [],
};
const missingHeadRefs = new Set(["perf/covering-index"]);

const stacks: Record<string, GitHubStack[]> = {
  [R.payments.id]: [
    { id: "9001", nodeId: "STK_payments_state_machine", number: "1", trunkRef: "main", open: true, pullRequests: [
      { number: "201", position: 1 }, { number: "202", position: 2 }, { number: "203", position: 3 },
    ] },
    { id: "9002", nodeId: "STK_psp_sdk", number: "2", trunkRef: "main", open: true, pullRequests: [
      { number: "211", position: 1 }, { number: "212", position: 2 },
    ] },
  ],
};

const github: GitHubClient = {
  listInstallationRepositories: async () => inventory.map((item) => ({ ...item })),
  hasLabel: async (repository) => repository.id !== R.risk.id,
  listIssues: async (repository) => (issues[repository.id] ?? []).map((item) => ({ ...item })),
  listPullRequests: async (repository) => {
    if (prFailures.has(repository.id)) throw new GitHubError("GitHub returned 502", { kind: "temporary", status: 502 });
    return (pullRequests[repository.id] ?? []).map((item) => ({ ...item }));
  },
  listStacks: async (repository) => (stacks[repository.id] ?? []).map((item) => ({ ...item })),
  getBranchRef: async (repository, branch) => missingHeadRefs.has(branch) ? null : { sha: sha(`${repository.name}:${branch}`) },
};

// ---------------------------------------------------------------------------
// Persistence + refresh coordinator (real), with two per-Repository failure modes
// ---------------------------------------------------------------------------

const persistence = createPersistence({ path: join(root, "atlas.sqlite") });
const realCoordinator = createRefreshCoordinator({ persistence, github, organization: ORG, installationId: INSTALLATION });
const unknownAccess = new Set<string>();
const prFailures = new Set<string>();
const ACCESS_UNKNOWN_REASON = "GitHub App access could not be verified.";
const PR_FAILURE_REASON = "GitHub is temporarily unavailable.";

const failViews = (repositoryId: string, views: RefreshView[], reason: string) => {
  persistence.requestRefresh(repositoryId, views);
  for (const view of views) {
    const generation = persistence.getRefreshState(repositoryId, view)!.requestedGeneration;
    if (view === "access") persistence.markAccessFailure(repositoryId, "unknown", reason, generation);
    else persistence.markRefreshFailure(repositoryId, view, reason, "unavailable", generation);
  }
};
// Publication reconciliation and admission reasons stamp `updated_at` with the
// wall clock; pin seeded Sessions back to their scripted ages so ordering holds.
const pinnedUpdatedAt = new Map<string, string>();
const pinTimes = () => {
  const pin = persistence.database.query("UPDATE sessions SET updated_at = ? WHERE atlas_id = ? AND updated_at <> ?");
  for (const [atlasId, updatedAt] of pinnedUpdatedAt) pin.run(updatedAt, atlasId, updatedAt);
};
const demoRefresh = async (repositoryId: string, views: RefreshView[]) => {
  try {
    await refreshFor(repositoryId, views);
  } finally {
    pinTimes();
  }
};
const refreshFor = async (repositoryId: string, views: RefreshView[]) => {
  if (unknownAccess.has(repositoryId)) {
    failViews(repositoryId, views, ACCESS_UNKNOWN_REASON);
    return;
  }
  if (prFailures.has(repositoryId) && views.includes("pullRequests")) {
    const rest = views.filter((view) => view !== "pullRequests");
    if (rest.length > 0) await realCoordinator.refresh(repositoryId, rest);
    failViews(repositoryId, ["pullRequests"], PR_FAILURE_REASON);
    return;
  }
  await realCoordinator.refresh(repositoryId, views);
};
const refreshCoordinator: RefreshCoordinator = {
  ...realCoordinator,
  refresh: demoRefresh,
  request: (repositoryId, views = ["access", "specs", "pullRequests"]) => void demoRefresh(repositoryId, views).catch(() => undefined),
};

for (const repo of enrolledRepos) {
  persistence.upsertRepository({
    githubId: repo.id,
    installationId: INSTALLATION,
    organization: ORG,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    description: repo.description,
    visibility: repo.visibility,
    defaultBranch: repo.defaultBranch,
    archived: repo.archived,
    disabled: repo.disabled,
    hasIssues: repo.hasIssues,
  });
  await realCoordinator.refresh(repo.id, ["access", "specs", "pullRequests"]);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

type DemoState = "queued" | "preparing" | "running" | "waiting" | "idle" | "succeeded" | "failed" | "interrupted" | "failed_setup";
type SeedSession = {
  key: string;
  label: string;
  repo: GitHubRepository;
  issue: number;
  state: DemoState;
  prompt: string;
  submittedAgo: number;
  updatedAgo: number;
  reason?: string;
  stale?: boolean;
  remote?: boolean;
  workingBranch?: string;
  target?: SessionTarget;
  targetBranch?: string;
};

const seeds: SeedSession[] = [
  { key: "failed-earlier", label: "Failed (earlier attempt)", repo: R.payments, issue: 12, state: "failed", submittedAgo: 7 * HOUR, updatedAgo: 6 * HOUR + 20 * MIN, remote: true,
    prompt: "Implement the spec. Keep the cache in Postgres.", reason: "OpenCode finished with a failed outcome: the integration suite failed (payments_idempotency_test: 3 failures).",
    workingBranch: "atlas/payments-api-12-idempotency-v1" },
  { key: "succeeded", label: "Succeeded with PR", repo: R.payments, issue: 12, state: "succeeded", submittedAgo: 3 * HOUR, updatedAgo: 35 * MIN, remote: true,
    prompt: "Implement the spec. Use Redis for the key cache, Postgres for the durable record. Add integration tests for every row of the table.",
    reason: "OpenCode reported the Session succeeded.", workingBranch: "atlas/payments-api-12-idempotency-keys" },
  { key: "running", label: "Running (live activity)", repo: R.payments, issue: 14, state: "running", submittedAgo: 25 * MIN, updatedAgo: 1 * MIN, remote: true,
    prompt: "Build the durable webhook inbox described in the spec. Start with the migration and the worker; metrics can be a follow-up commit.",
    reason: "OpenCode is working.", workingBranch: "atlas/payments-api-14-webhook-inbox" },
  { key: "waiting", label: "Waiting (Agent question)", repo: R.payments, issue: 15, state: "waiting", submittedAgo: 90 * MIN, updatedAgo: 12 * MIN, remote: true,
    prompt: "Fix the rounding bug. Add table-driven tests for every currency in the spec.",
    reason: "OpenCode is waiting for an answer.", workingBranch: "atlas/payments-api-15-refund-rounding" },
  { key: "queued", label: "Queued", repo: R.payments, issue: 17, state: "queued", submittedAgo: 8 * MIN, updatedAgo: 8 * MIN,
    prompt: "Implement partial refunds. Reuse the idempotency middleware from #12." },
  { key: "failed", label: "Failed with reason", repo: R.payments, issue: 21, state: "failed", submittedAgo: 5 * HOUR, updatedAgo: 4 * HOUR, remote: true,
    prompt: "Implement the 3DS2 challenge flow against the PSP sandbox.",
    reason: "OpenCode finished with a failed outcome: the PSP sandbox rejected every challenge callback (HTTP 401). The sandbox API key in CI looks expired.",
    workingBranch: "atlas/payments-api-21-3ds2-challenge" },
  { key: "idle", label: "Idle", repo: R.ledger, issue: 7, state: "idle", submittedAgo: 6 * HOUR, updatedAgo: 2 * HOUR, remote: true,
    prompt: "Implement the reconciliation job on top of the open state-machine stack.",
    reason: "OpenCode is idle; the Session has not reported a final outcome.", workingBranch: "atlas/ledger-service-7-reconciliation" },
  { key: "stale", label: "Stale / not live", repo: R.ledger, issue: 8, state: "running", stale: true, submittedAgo: 4 * HOUR, updatedAgo: 3 * HOUR, remote: true,
    prompt: "Add point-in-time balances. Compute from entries only.",
    reason: "OpenCode is working.", workingBranch: "atlas/ledger-service-8-balance-at" },
  { key: "preparing", label: "Preparing", repo: R.ledger, issue: 9, state: "preparing", submittedAgo: 3 * MIN, updatedAgo: 1 * MIN,
    prompt: "Start with the sub-ledger schema; leave FX revaluation for a second commit.",
    reason: "Local branch prepared; OpenCode handoff is next.", workingBranch: "atlas/ledger-service-9-multi-currency" },
  { key: "succeeded-merged", label: "Succeeded (PR merged, read)", repo: R.ledger, issue: 10, state: "succeeded", submittedAgo: 3 * DAY, updatedAgo: 2 * DAY + 4 * HOUR, remote: true,
    prompt: "Implement the spec.", reason: "OpenCode reported the Session succeeded.", workingBranch: "atlas/ledger-service-10-reject-unbalanced" },
  { key: "interrupted", label: "Interrupted", repo: R.ledger, issue: 11, state: "interrupted", submittedAgo: 2 * DAY, updatedAgo: 47 * HOUR, remote: true,
    prompt: "Archive closed periods. Do not delete anything yet.", reason: "OpenCode reported the Session was interrupted.", workingBranch: "atlas/ledger-service-11-archive-periods" },
  { key: "failed-setup", label: "Failed setup", repo: R.ledger, issue: 12, state: "failed_setup", submittedAgo: 20 * HOUR, updatedAgo: 20 * HOUR - 2 * MIN,
    prompt: "Migrate IDs to ULIDs.", reason: "Git clone failed: the GitHub App token could not read ledgerly/ledger-service." },
  { key: "succeeded-no-pr", label: "Succeeded without PR", repo: R.dashboard, issue: 31, state: "succeeded", submittedAgo: 2 * DAY, updatedAgo: 44 * HOUR, remote: true,
    prompt: "Add dark mode. Use CSS variables.", reason: "OpenCode reported the Session succeeded.", workingBranch: "atlas/web-dashboard-31-dark-mode" },
  { key: "failed-dashboard", label: "Failed (dashboard)", repo: R.dashboard, issue: 33, state: "failed", submittedAgo: 23 * HOUR, updatedAgo: 22 * HOUR, remote: true,
    prompt: "Add the CSV export.", reason: "OpenCode finished with a failed outcome: the export exceeded the 30 s request timeout on the seeded dataset.", workingBranch: "atlas/web-dashboard-33-dispute-csv" },
];

// Stack target for the Idle Session (top of the open stack).
const idleSeed = seeds.find((seed) => seed.key === "idle")!;
idleSeed.repo = R.payments;
idleSeed.issue = 18;
idleSeed.prompt = "Add the rate limiter on top of the open state-machine stack; keep the limiter in its own module.";
idleSeed.workingBranch = "atlas/payments-api-18-rate-limits";
idleSeed.target = { kind: "native_stack", stackId: "9001", stackNumber: "1" };
idleSeed.targetBranch = "stack/payments-refunds";

const atlasIds = new Map<string, string>();
const remoteIds = new Map<string, string>();
const directories = new Map<string, string>();
const terminal = new Set<DemoState>(["succeeded", "failed", "interrupted", "failed_setup"]);
const hex = (n: number) => n.toString(16).padStart(12, "0");

seeds.forEach((seed, index) => {
  const atlasId = `ses_00000000-0000-4000-8000-${hex(index + 1)}`;
  atlasIds.set(seed.key, atlasId);
  pinnedUpdatedAt.set(atlasId, ago(seed.updatedAgo));
  const spec = persistence.getSpec(seed.repo.id, String(seed.issue));
  if (!spec) throw new Error(`Missing seeded Spec ${seed.repo.name}#${seed.issue}`);
  const result = persistence.queueSession({
    atlasId,
    repositoryId: seed.repo.id,
    spec,
    submissionId: `00000000-0000-4000-9000-${hex(index + 1)}`,
    submissionOrderTime: ago(seed.submittedAgo),
    prompt: seed.prompt,
    targetKind: seed.target?.kind ?? "default",
    targetBranch: seed.targetBranch ?? "main",
    target: seed.target,
  });
  if (result.kind !== "created") throw new Error(`Seeding ${seed.key} returned ${result.kind}`);
  if (seed.state === "queued") {
    persistence.database.query("UPDATE sessions SET state_reason = ? WHERE atlas_id = ?")
      .run("Waiting for a free execution slot (1 of 1 in use).", atlasId);
    return;
  }

  const prepared = seed.state !== "failed_setup";
  const directory = prepared ? join(sessionRoot, atlasId) : null;
  if (directory) {
    mkdirSync(directory, { recursive: true });
    directories.set(seed.key, directory);
  }
  const remoteId = seed.remote ? `ses_demo${hex(index + 1)}` : null;
  if (remoteId) remoteIds.set(seed.key, remoteId);
  const accepted = Boolean(remoteId);
  const preparedAt = ago(seed.submittedAgo - 2 * MIN);
  persistence.database.query(`
    UPDATE sessions
    SET state = ?, state_reason = ?, directory = ?, base_branch = ?, base_sha = ?, working_branch = ?,
        preparation_checkpoint = ?, preparation_reason = ?, prepared_at = ?,
        handoff_checkpoint = ?, opencode_intended_session_id = ?, opencode_session_id = ?,
        initial_message_id = ?, initial_inbox_id = ?, exact_message = ?,
        opencode_freshness = ?, opencode_last_success_at = ?, opencode_last_failure_at = ?,
        execution_slot_held = ?, updated_at = ?
    WHERE atlas_id = ?
  `).run(
    seed.state,
    seed.reason ?? null,
    directory,
    prepared ? (seed.targetBranch ?? "main") : null,
    prepared ? sha(`${seed.repo.name}:${seed.targetBranch ?? "main"}:${index}`) : null,
    prepared ? seed.workingBranch ?? null : null,
    prepared ? "prepared" : "failed_setup",
    prepared ? "Full clone and local branch are ready." : seed.reason ?? null,
    prepared ? preparedAt : null,
    accepted ? "prompt_accepted" : "not_started",
    remoteId,
    remoteId,
    accepted ? `msg_demo_initial_${index + 1}` : null,
    accepted ? `inb_demo_${index + 1}` : null,
    accepted ? `${seed.prompt}\n\n---\n\nSpec: ${spec.title}\n\n${spec.body}` : null,
    seed.stale ? "stale" : accepted ? "fresh" : "unknown",
    accepted ? ago(seed.stale ? 3 * HOUR : seed.updatedAgo) : null,
    seed.stale ? ago(3 * HOUR - 5 * MIN) : null,
    ["preparing", "running", "waiting", "idle"].includes(seed.state) ? 1 : 0,
    ago(seed.updatedAgo),
    atlasId,
  );
  if (terminal.has(seed.state)) {
    persistence.database.query(
      "INSERT INTO session_history (session_id, event_kind, occurred_at, reason, details_json) VALUES (?, 'terminal', ?, ?, NULL)",
    ).run(atlasId, ago(seed.updatedAgo), seed.reason ?? null);
  }
});

// Re-project Pull requests so publication evidence links Sessions to their PRs.
for (const repo of [R.payments, R.ledger, R.dashboard]) await realCoordinator.refresh(repo.id, ["pullRequests"]);
pinTimes();

// Failure modes switch on only after the successful first projection.
persistence.removeRepository(R.reports.id);
unknownAccess.add(R.fraud.id);
await demoRefresh(R.fraud.id, ["access", "specs", "pullRequests"]);
prFailures.add(R.dashboard.id);
await demoRefresh(R.dashboard.id, ["pullRequests"]);

// ---------------------------------------------------------------------------
// Fake OpenCode
// ---------------------------------------------------------------------------

type Conversation = {
  info: SessionInfo;
  messages: Array<Record<string, unknown>>;
  active: boolean;
  children: string[];
  forms: unknown[];
  permissions: unknown[];
  shells: Array<Record<string, unknown>>;
};
const conversations = new Map<string, Conversation>();
const model = { id: "claude-sonnet-5-5", providerID: "anthropic" };
let messageSeq = 0;
const nextId = (prefix: string) => `${prefix}_demo${String(++messageSeq).padStart(5, "0")}`;

const sessionInfo = (id: string, directory: string, created: number, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "prj_demo",
  agent: "build",
  model,
  cost: 1.84,
  tokens: { input: 182_340, output: 9_812, reasoning: 2_210, cache: { read: 640_120, write: 41_002 } },
  time: { created, updated: created + 5 * MIN },
  location: { directory },
  ...extra,
} as SessionInfo);

const user = (at: number, text: string) => ({ id: nextId("msg"), time: { created: at }, type: "user", text });
const assistant = (at: number, content: unknown[]) => ({
  id: nextId("msg"), time: { created: at, completed: at + 20_000 }, type: "assistant", agent: "build", model, content, finish: "tool-calls",
});
const text = (value: string) => ({ type: "text", text: value });
const reasoning = (value: string) => ({ type: "reasoning", text: value });
const tool = (at: number, name: string, input: Record<string, unknown>, output: string, metadata: Record<string, unknown> = {}) => ({
  type: "tool", id: nextId("call"), name, time: { created: at, ran: at + 500, completed: at + 2_000 },
  state: { status: "completed", input, content: [{ type: "text", text: output }], metadata },
});
const runningTool = (at: number, name: string, input: Record<string, unknown>) => ({
  type: "tool", id: nextId("call"), name, time: { created: at, ran: at + 500 }, state: { status: "running", input, metadata: {} },
});
const shellMessage = (at: number, command: string, output: string, exit = 0) => ({
  id: nextId("msg"), time: { created: at, completed: at + 8_000 }, type: "shell", shellID: nextId("shl"), command, status: "exited", exit,
  output: { output, cursor: output.length, size: output.length, truncated: false },
});
const idle = (at: number, outcome: "succeeded" | "failed" | "interrupted") => ({ id: nextId("msg"), time: { created: at }, type: "idle", outcome });

const baseTranscript = (start: number, prompt: string, spec: string, files: { read: string; edit: string; test: string }) => [
  user(start, `${prompt}\n\nSpec: ${spec}`),
  assistant(start + 30_000, [
    reasoning("I should look at the existing request pipeline before changing anything."),
    text(`I'll start by reading the current implementation around \`${files.read}\`.`),
    tool(start + 35_000, "read", { filePath: files.read }, `     1\timport { Hono } from "hono";\n     2\timport { db } from "../db";\n     3\t\n     4\texport const payments = new Hono();\n     5\t\n     6\tpayments.post("/", async (c) => {\n     7\t  const body = await c.req.json();\n     8\t  const payment = await db.payments.create(body);\n     9\t  return c.json(payment, 201);\n    10\t});`),
    tool(start + 40_000, "grep", { pattern: "createPayment|payments.create", path: "src" }, "src/routes/payments.ts:8\nsrc/services/payments.ts:22\ntest/payments.test.ts:41"),
  ]),
  assistant(start + 90_000, [
    text("The handler writes directly to the database. I'll add the new module and wire it in."),
    tool(start + 95_000, "edit", { filePath: files.edit, oldString: "return c.json(payment, 201);", newString: "await store.save(key, payment);\n  return c.json(payment, 201);" }, "Edit applied successfully.", { diff: `--- a/${files.edit}\n+++ b/${files.edit}\n@@ -8,3 +8,4 @@\n   const payment = await db.payments.create(body);\n+  await store.save(key, payment);\n   return c.json(payment, 201);` }),
    tool(start + 110_000, "write", { filePath: files.test }, "Wrote 64 lines."),
  ]),
  shellMessage(start + 150_000, "bun test test/payments.test.ts", "bun test v1.3.14\n\ntest/payments.test.ts:\n✓ creates a payment [12.41ms]\n✓ replays the cached response for the same key [4.02ms]\n✓ rejects a reused key with a different body [3.88ms]\n\n 3 pass\n 0 fail\n 9 expect() calls\nRan 3 tests across 1 file. [182.00ms]"),
];

const addConversation = (key: string, build: (start: number, directory: string, id: string) => Partial<Conversation> & { messages: Array<Record<string, unknown>> }, extraInfo: Partial<SessionInfo> = {}) => {
  const id = remoteIds.get(key);
  const directory = directories.get(key);
  const seed = seeds.find((item) => item.key === key)!;
  if (!id || !directory) return;
  const start = BOOT - seed.submittedAgo + 2 * MIN;
  const built = build(start, directory, id);
  conversations.set(id, {
    info: sessionInfo(id, directory, start, { title: persistence.getSpec(seed.repo.id, String(seed.issue))!.title, ...extraInfo }),
    active: false,
    children: [],
    forms: [],
    permissions: [],
    shells: [],
    ...built,
  });
};

const specTitle = (key: string) => {
  const seed = seeds.find((item) => item.key === key)!;
  return persistence.getSpec(seed.repo.id, String(seed.issue))!.title;
};
const promptOf = (key: string) => seeds.find((item) => item.key === key)!.prompt;
const paymentFiles = { read: "src/routes/payments.ts", edit: "src/routes/payments.ts", test: "test/payments.test.ts" };

addConversation("succeeded", (start) => ({ messages: [
  ...baseTranscript(start, promptOf("succeeded"), specTitle("succeeded"), { ...paymentFiles, edit: "src/middleware/idempotency.ts", test: "test/idempotency.test.ts" }),
  assistant(start + 200_000, [
    text("All four cases in the table are covered. Pushing the branch and opening the Pull request."),
    tool(start + 205_000, "bash", { command: "git push -u origin atlas/payments-api-12-idempotency-keys && gh pr create --fill" }, "To github.com:ledgerly/payments-api.git\n * [new branch] atlas/payments-api-12-idempotency-keys -> atlas/payments-api-12-idempotency-keys\nhttps://github.com/ledgerly/payments-api/pull/225"),
    text("Opened **#225 Add idempotency keys to payment creation**. Summary:\n\n- `Idempotency-Key` middleware with a 24 h TTL\n- Redis lock with a 10 s timeout → `409 request_in_progress`\n- Body hash comparison → `422 idempotency_key_reused`\n- 7 new integration tests"),
  ]),
  idle(start + 240_000, "succeeded"),
] }), { outcome: "succeeded" });

addConversation("failed-earlier", (start) => ({ messages: [
  ...baseTranscript(start, promptOf("failed-earlier"), specTitle("failed-earlier"), paymentFiles).slice(0, 3),
  shellMessage(start + 160_000, "bun test test/payments_idempotency.test.ts", "bun test v1.3.14\n\n✗ concurrent requests wait for the first [10003.12ms]\n  error: Timed out after 10000ms\n✗ replay returns cached body\n  expected 201, received 500\n✗ different body returns 422\n\n 0 pass\n 3 fail", 1),
  assistant(start + 200_000, [text("Postgres advisory locks deadlock under the concurrency test. I can't make the suite pass with the Postgres-only design the prompt asked for, so I'm stopping here.")]),
  idle(start + 210_000, "failed"),
] }), { outcome: "failed" });

addConversation("failed", (start) => ({ messages: [
  user(start, `${promptOf("failed")}\n\nSpec: ${specTitle("failed")}`),
  assistant(start + 30_000, [
    text("Reading the PSP client to find where `authentication_required` surfaces."),
    tool(start + 32_000, "read", { filePath: "src/psp/client.ts" }, "    40\t  if (res.status === 402) throw new PaymentRequired(await res.json());"),
    tool(start + 40_000, "edit", { filePath: "src/psp/client.ts", oldString: "throw new PaymentRequired", newString: "return requiresAction" }, "Edit applied successfully."),
  ]),
  shellMessage(start + 90_000, "bun test test/sca.e2e.test.ts", "✗ challenge callback resumes authorization\n  PSP sandbox: 401 Unauthorized (invalid api key)\n✗ frictionless flow skips challenge\n  PSP sandbox: 401 Unauthorized (invalid api key)\n\n 0 pass\n 2 fail", 1),
  assistant(start + 120_000, [text("Every sandbox call returns **401 Unauthorized**. The `PSP_SANDBOX_KEY` in CI appears to be expired, so I can't verify the flow end to end. Stopping with a failed outcome; the code changes are on the branch.")]),
  idle(start + 125_000, "failed"),
] }), { outcome: "failed" });

let liveShellOutput = "bun test --watch test/webhooks\n";
const liveLines = [
  "✓ persists the event before acknowledging [6.1ms]",
  "✓ dedupes deliveries on event.id [2.4ms]",
  "… draining inbox: attempt 1 for evt_1Pq9 (30s backoff)",
  "✓ retries with exponential backoff [31.0ms]",
  "… draining inbox: attempt 2 for evt_1Pq9 (2m backoff)",
  "✓ marks the event dead after the last attempt [4.8ms]",
  "… re-running on file change: src/webhooks/worker.ts",
];
let liveLine = 0;
addConversation("running", (start, directory, id) => {
  const shellId = "shl_demo_live";
  const childId = `${id}_explore`;
  conversations.set(childId, {
    info: sessionInfo(childId, directory, start + 60_000, { parentID: id, agent: "explore", title: "Find webhook handlers" }),
    messages: [
      user(start + 60_000, "Find every place we acknowledge a PSP webhook and list the files."),
      assistant(start + 70_000, [
        tool(start + 71_000, "grep", { pattern: "res.status\\(200\\)|ack\\(", path: "src/webhooks" }, "src/webhooks/router.ts:31\nsrc/webhooks/psp.ts:88"),
        text("Two acknowledgement points: `src/webhooks/router.ts:31` and `src/webhooks/psp.ts:88`. Both ack before persisting."),
      ]),
      idle(start + 80_000, "succeeded"),
    ],
    active: false, children: [], forms: [], permissions: [], shells: [],
  });
  return {
    active: true,
    children: [childId],
    shells: [{ id: shellId, status: "running", command: "bun test --watch test/webhooks", cwd: directory, shell: "/bin/bash", file: "", pid: 4242, metadata: { sessionID: id }, time: { started: BOOT - 4 * MIN } }],
    messages: [
      user(start, `${promptOf("running")}\n\nSpec: ${specTitle("running")}`),
      assistant(start + 20_000, [
        text("I'll map the current acknowledgement points first with a subagent, then add the inbox table."),
        tool(start + 25_000, "task", { description: "Find webhook handlers", subagent_type: "explore" }, "Two acknowledgement points: src/webhooks/router.ts:31 and src/webhooks/psp.ts:88."),
      ]),
      assistant(start + 120_000, [
        tool(start + 122_000, "write", { filePath: "migrations/0042_webhook_inbox.sql" }, "Wrote 9 lines."),
        tool(start + 130_000, "edit", { filePath: "src/webhooks/router.ts", oldString: "return c.body(null, 200);", newString: "await inbox.persist(event);\n  return c.body(null, 200);" }, "Edit applied successfully.", { diff: "--- a/src/webhooks/router.ts\n+++ b/src/webhooks/router.ts\n@@ -29,3 +29,4 @@\n   const event = await verify(c);\n+  await inbox.persist(event);\n   return c.body(null, 200);" }),
        tool(start + 160_000, "write", { filePath: "src/webhooks/worker.ts" }, "Wrote 118 lines."),
      ]),
      shellMessage(start + 200_000, "bun run migrate", "Applying 0042_webhook_inbox.sql … done (14 ms)"),
      assistant(BOOT - 5 * MIN, [
        text("Migration applied. Running the webhook tests in watch mode while I finish the backoff schedule."),
        runningTool(BOOT - 4 * MIN, "bash", { command: "bun test --watch test/webhooks" }),
      ]),
    ],
  };
});

addConversation("waiting", (start, _directory, id) => ({
  active: false,
  forms: [{
    id: "frm_demo_rounding",
    sessionID: id,
    title: "Which rounding mode should partial refunds use?",
    fields: [
      { key: "mode", type: "string", title: "Rounding mode", required: true, options: [
        { value: "half_even", label: "Half to even (banker's rounding)", description: "Matches the spec; differs from current receipts." },
        { value: "half_up", label: "Half up", description: "Matches what merchants see on receipts today." },
      ] },
      { key: "note", type: "string", title: "Anything finance asked for?" },
    ],
  }],
  messages: [
    user(start, `${promptOf("waiting")}\n\nSpec: ${specTitle("waiting")}`),
    assistant(start + 30_000, [
      tool(start + 32_000, "read", { filePath: "src/money.ts" }, "    12\texport const round = (n: number) => Math.round(n);"),
      tool(start + 40_000, "grep", { pattern: "Math.round", path: "src" }, "src/money.ts:12\nsrc/refunds/partial.ts:57\nsrc/fx/convert.ts:33"),
    ]),
    shellMessage(start + 70_000, "bun test test/money.test.ts", "✗ JPY 33% of 1000 → 330\n  expected 330, received 329\n\n 4 pass\n 1 fail", 1),
    assistant(BOOT - 12 * MIN, [
      text("I reproduced the off-by-one. Before I change it: the spec says **round half to even**, but receipts already printed for merchants use **half up**. Switching modes changes historical totals in reports.\n\nWhich rounding mode should partial refunds use?"),
    ]),
  ],
}));

addConversation("idle", (start) => ({ messages: [
  user(start, `${promptOf("idle")}\n\nSpec: ${specTitle("idle")}`),
  assistant(start + 30_000, [
    tool(start + 31_000, "read", { filePath: "src/middleware/index.ts" }, "     1\texport * from \"./auth\";\n     2\texport * from \"./idempotency\";"),
    tool(start + 40_000, "write", { filePath: "src/middleware/rate-limit.ts" }, "Wrote 72 lines."),
  ]),
  shellMessage(start + 80_000, "bun test test/rate-limit.test.ts", "✓ allows a burst of 100\n✓ returns 429 with Retry-After\n\n 2 pass\n 0 fail"),
  assistant(start + 100_000, [text("The limiter is in place with tests. I stopped before adding per-merchant overrides because `merchant_limits` doesn't exist yet — tell me if I should create it.")]),
] }));

addConversation("stale", (start) => ({ messages: [
  user(start, `${promptOf("stale")}\n\nSpec: ${specTitle("stale")}`),
  assistant(start + 30_000, [
    text("Reading the entries table and the existing balance query."),
    tool(start + 31_000, "read", { filePath: "src/balances.ts" }, "    20\tSELECT balance FROM accounts WHERE id = $1"),
  ]),
] }));

for (const [key, outcome] of [["succeeded-merged", "succeeded"], ["interrupted", "interrupted"], ["succeeded-no-pr", "succeeded"], ["failed-dashboard", "failed"]] as const) {
  addConversation(key, (start) => ({ messages: [
    user(start, `${promptOf(key)}\n\nSpec: ${specTitle(key)}`),
    assistant(start + 30_000, [
      text("Reading the relevant module first."),
      tool(start + 31_000, "read", { filePath: "src/index.ts" }, "     1\texport {};"),
      text(outcome === "succeeded" ? "Done — changes are committed on the working branch." : outcome === "interrupted" ? "Stopping: the Session was interrupted." : "The export timed out on the seeded dataset; giving up."),
    ]),
    idle(start + 60_000, outcome),
  ] }), { outcome });
}

const openCodeListeners = new Set<(event: OpenCodeEvent) => void>();
const conversation = (id: string) => {
  const found = conversations.get(id);
  if (!found) throw new Error(`OpenCode Session ${id} not found`);
  return found;
};
const client = {
  session: {
    get: async ({ sessionID }: { sessionID: string }) => conversation(sessionID).info,
    active: async () => Object.fromEntries([...conversations].filter(([, item]) => item.active).map(([id]) => [id, { type: "running" }])),
    list: async (input: { parentID?: string }) => ({
      data: input.parentID ? (conversations.get(input.parentID)?.children ?? []).map((id) => conversation(id).info) : [],
      cursor: { next: null },
    }),
    inbox: { list: async () => [] },
    form: { list: async ({ sessionID }: { sessionID: string }) => conversations.get(sessionID)?.forms ?? [] },
  },
  message: {
    list: async (input: { sessionID: string; order?: string }) => {
      const messages = [...conversation(input.sessionID).messages];
      return { data: input.order === "desc" ? messages.reverse() : messages, cursor: { next: null } };
    },
  },
  permission: { list: async ({ sessionID }: { sessionID: string }) => conversations.get(sessionID)?.permissions ?? [] },
  shell: {
    list: async ({ location }: { location: { directory: string } }) => ({
      location,
      data: [...conversations.values()].filter((item) => item.info.location.directory === location.directory).flatMap((item) => item.shells),
    }),
    output: async ({ location }: { location: { directory: string } }) => ({
      location,
      data: { output: liveShellOutput, cursor: liveShellOutput.length, size: liveShellOutput.length, truncated: false },
    }),
  },
  agent: {
    list: async ({ location }: { location: { directory: string } }) => ({
      location,
      data: [
        { id: "build", name: "build", mode: "primary", hidden: false, request: {}, permissions: [] },
        { id: "explore", name: "explore", mode: "subagent", hidden: false, request: {}, permissions: [] },
      ],
    }),
  },
} as unknown as OpenCodeClient;

const openCode = {
  start: () => undefined,
  stop: () => undefined,
  enqueue: () => undefined,
  process: async () => undefined,
  pauseForUpdate: async () => undefined,
  resumeFromUpdate: () => undefined,
  getClient: async () => client,
  isReady: () => true,
  readiness: () => ({ ready: true, state: "connected", reason: undefined, version: "2.3.2" }),
  onEvent: (listener: (event: OpenCodeEvent) => void) => {
    openCodeListeners.add(listener);
    return () => openCodeListeners.delete(listener);
  },
  onTransport: () => () => undefined,
  transportState: () => "connected" as const,
};

// Live activity: the Running Session's watch shell prints a line every few seconds.
const runningRemote = remoteIds.get("running")!;
setInterval(() => {
  liveShellOutput += `${liveLines[liveLine % liveLines.length]}\n`;
  liveLine += 1;
  if (liveLine % 40 === 0) liveShellOutput = "bun test --watch test/webhooks\n";
  const live = conversation(runningRemote);
  live.info = { ...live.info, time: { ...live.info.time, updated: Date.now() } };
  const event = {
    id: `evt_demo_${liveLine}`,
    created: Date.now(),
    type: "session.updated",
    location: { directory: live.info.location.directory },
    data: { sessionID: runningRemote },
  } as unknown as OpenCodeEvent;
  for (const listener of openCodeListeners) {
    try {
      listener(event);
    } catch {
      // A listener failure must not stop the demo ticker.
    }
  }
}, 6_000);

// ---------------------------------------------------------------------------
// Fake updates
// ---------------------------------------------------------------------------

const identity = (tag: string, gitSha: string): PublishedReleaseIdentity => {
  const parsed = parseReleaseTag(tag);
  return { published: true, tag: parsed.tag, semver: parsed.semver, build: parsed.build, gitSha };
};
const installed = identity("v1.8.2+build.41", "4be1c0de8a51e3b7a9f2c6d0e1f4a7b8c9d0e1f2");
const metadata = (release: PublishedReleaseIdentity): ReleaseMetadata => ({
  schemaVersion: 1,
  identity: release,
  artifact: { name: `atlas-${release.semver}-linux-x64.tar.gz`, checksum: `sha256:${sha(release.tag)}${sha(release.tag).slice(0, 24)}`, os: "linux", architecture: "x64", format: "tar.gz" },
  runtime: { bun: "1.3.14", git: "2.47.1", gh: "2.63.0" },
  rollback: { codeOnlyCompatible: true, manualMaintenanceInstructions: null },
});
const installedMeta = metadata(installed);
const candidate = metadata(identity("v1.9.0+build.44", "9c3a77f02b1d4e6a8f0b2c4d6e8fa1b3c5d7e9f1"));

type UpdateMode = "current" | "ready" | "staging" | "installing" | "failed" | "check_failed";
const updateModes: UpdateMode[] = ["current", "ready", "staging", "installing", "failed", "check_failed"];
let updateMode: UpdateMode = "ready";
let updatePolicy: UpdatePolicy = "approval_required";
let checkingUntil = 0;
let tick = 0;
const stagingStates = ["requested", "downloading", "verifying", "extracting"] as const;
const activationStates: ActivationState[] = ["awaiting_checkpoint", "stopping", "selecting", "starting", "validating"];

const updateStatus = (): UpdateStatus => {
  tick += 1;
  const now = Date.now();
  const newer = updateMode !== "current";
  const activation = {
    state: "idle" as ActivationState,
    metadata: null as ReleaseMetadata | null,
    previousPath: null as string | null,
    previousMetadata: null as ReleaseMetadata | null,
    requestedAt: null as string | null,
    updatedAt: iso(now - 3 * DAY),
    deadlineAt: null as string | null,
    message: "No activation is in progress.",
    failureMessage: null as string | null,
    retry: false,
    failedTags: [] as ReleaseMetadata["identity"]["tag"][],
    lastResult: { tag: installed.tag, state: "succeeded" as const, message: "Activated and passed health checks.", at: iso(now - 3 * DAY) } as UpdaterStatus["activation"]["lastResult"],
  };
  if (updateMode === "installing") {
    Object.assign(activation, {
      state: activationStates[tick % activationStates.length]!,
      metadata: candidate,
      previousMetadata: installedMeta,
      previousPath: "/opt/atlas/releases/v1.8.2+build.41",
      requestedAt: iso(now - 40_000),
      updatedAt: iso(now),
      deadlineAt: iso(now + 5 * MIN),
      message: "Activating v1.9.0+build.44.",
    });
  }
  if (updateMode === "failed") {
    Object.assign(activation, {
      state: "rolled_back",
      metadata: candidate,
      previousMetadata: installedMeta,
      requestedAt: iso(now - 20 * MIN),
      updatedAt: iso(now - 18 * MIN),
      message: "Atlas returned to v1.8.2+build.41.",
      failureMessage: "The new release did not pass its health check within 60 s (GET /health returned 503: persistence migration 0043 failed).",
      failedTags: [candidate.identity.tag],
      lastResult: { tag: candidate.identity.tag, state: "rolled_back", message: "Health check failed; the previous release was restored.", at: iso(now - 18 * MIN) },
    });
  }
  const stageState: UpdaterStatus["state"] = !newer || updateMode === "check_failed"
    ? "idle"
    : updateMode === "staging" ? stagingStates[tick % stagingStates.length]! : "staged";
  const updater: UpdaterStatus = {
    schemaVersion: 1,
    policy: updatePolicy,
    state: stageState,
    metadata: stageState === "idle" ? null : candidate,
    requestedAt: stageState === "idle" ? null : iso(now - 10 * MIN),
    updatedAt: iso(now - 9 * MIN),
    stagedPath: stageState === "staged" ? "/opt/atlas/releases/v1.9.0+build.44" : null,
    message: stageState === "staged" ? "v1.9.0+build.44 is staged and verified." : stageState === "idle" ? "Nothing is staged." : `Staging v1.9.0+build.44: ${stageState}.`,
    requirements: { required: candidate.runtime, available: { bun: "1.3.14", git: "2.47.1", gh: "2.63.0" }, unmet: [] },
    lastResult: stageState === "staged" ? { tag: candidate.identity.tag, state: "staged", message: "Downloaded, checksum verified, extracted.", at: iso(now - 9 * MIN) } : null,
    activation,
    cleanup: { state: "idle", message: "Older releases are cleaned up after a successful activation.", updatedAt: null, pendingTags: [], removedTags: [] },
  };
  const checkFailed = updateMode === "check_failed";
  return {
    installed,
    checking: now < checkingUntil,
    discovery: {
      candidates: newer && !checkFailed ? [candidate] : [],
      lastCheckAt: iso(now - 4 * MIN),
      lastSuccessAt: iso(now - (checkFailed ? 6 * HOUR : 4 * MIN)),
      lastFailureAt: checkFailed ? iso(now - 4 * MIN) : null,
      failureReason: checkFailed ? "GitHub Releases returned 503 Service Unavailable." : null,
      stageRequestFailureAt: null,
      stageRequestFailureReason: null,
    },
    candidates: newer && !checkFailed ? [candidate] : [],
    available: newer && !checkFailed ? candidate : null,
    updater,
    updaterError: null,
  };
};

const updates: UpdateService = {
  start: () => undefined,
  stop: () => undefined,
  check: async () => {
    checkingUntil = Date.now() + 3_000;
  },
  status: async () => updateStatus(),
  setPolicy: async (policy) => {
    updatePolicy = policy;
  },
  install: async () => {
    updateMode = "installing";
  },
};

// ---------------------------------------------------------------------------
// App + demo wrapper
// ---------------------------------------------------------------------------

const app = createApp({
  persistence,
  sharedToken: TOKEN,
  github,
  githubOrganization: ORG,
  githubInstallationId: INSTALLATION,
  refreshCoordinator,
  openCode: openCode as never,
  updates,
  releaseIdentity: installed,
  sessionRoot,
  globalCapacity: 1,
  gitBinary: join(root, "no-git"),
  credentialsPath: join(root, "no-credentials"),
  credentialRegistryPath: join(root, "no-registry"),
  credentialSocketPath: join(root, "no-socket"),
  credentialKeyPath: join(root, "no-key"),
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const sessionUrl = (key: string) => `/sessions/${atlasIds.get(key)}`;
const specUrl = (repo: GitHubRepository, issueNumber: number) => `/repositories/${repo.id}/specs/${issueNumber}`;

type DemoLink = [label: string, href: string, note?: string];
const groups = (): Array<[string, DemoLink[]]> => [
  ["Inbox", [
    ["Inbox (all groups)", "/inbox"],
    ["Inbox with unread settled items", "/__demo/unread", "sets the last-visit cookie to 4 h ago, then opens the Inbox"],
    ["Inbox filtered to payments-api", `/inbox?repository=${R.payments.id}`],
    ["Inbox filtered to mobile-app (empty)", `/inbox?repository=${R.mobile.id}`],
    ["Landing redirect (/)", "/", "goes to the oldest unread outcome, else Waiting"],
  ]],
  ["Session", seeds.map((seed): DemoLink => [seed.label, sessionUrl(seed.key), `${seed.repo.name}#${seed.issue}`]).concat([
    ["Running: viewer only", `${sessionUrl("running")}/view`],
    ["Running: subagent child", `${sessionUrl("running")}/view?child=${runningRemote}_explore`],
  ])],
  ["Spec + Start Session", [
    ["Spec with Sessions (succeeded + failed)", specUrl(R.payments, 12)],
    ["Spec with no Session", specUrl(R.payments, 22)],
    ["Spec with an unfinished Session", specUrl(R.payments, 14)],
    ["Start Session (stack + standalone choices)", `${specUrl(R.payments, 22)}/sessions/new`],
    ["Start Session (standalone PR choices)", `${specUrl(R.ledger, 13)}/sessions/new`],
    ["Start Session (PR check failed)", `${specUrl(R.dashboard, 32)}/sessions/new`],
    ["Duplicate start (409)", "/__demo/act/duplicate-start", "real POST for a Spec that already has a Running Session"],
    ["Start blocked: archived Repository", `${specUrl(R.infra, 4)}/sessions/new`],
    ["Start blocked: access unknown", `${specUrl(R.fraud, 3)}/sessions/new`],
    ["Spec in archived Repository", specUrl(R.infra, 4)],
  ]],
  ["Repositories", [
    ["Repository list", "/repositories"],
    ["Repository list incl. removed", "/repositories?removed=1"],
    ["Inside payments-api (Specs)", `/repositories/${R.payments.id}/specs`],
    ["Inside mobile-app (no Specs)", `/repositories/${R.mobile.id}/specs`],
    ["Inside infra-terraform (archived)", `/repositories/${R.infra.id}/specs`],
    ["Inside fraud-rules (access unknown)", `/repositories/${R.fraud.id}/specs`],
    ["Inside legacy-reports (removed)", `/repositories/${R.reports.id}/specs`],
    ["Repository Sessions (payments-api)", `/repositories/${R.payments.id}/sessions`],
    ["Add Repository (Add / Added / Re-add)", "/repositories/new"],
    ["Add Repository search: no match", "/repositories/new?q=zzz"],
  ]],
  ["Pull requests", [
    ["Stacks: eligible 3-layer + blocked by closed layer", `/repositories/${R.payments.id}/pull-requests`],
    ["Standalone: eligible, base release/2.x, missing head ref, fork", `/repositories/${R.ledger.id}/pull-requests`],
    ["No open PRs", `/repositories/${R.mobile.id}/pull-requests`],
    ["Couldn't check GitHub", `/repositories/${R.dashboard.id}/pull-requests`],
    ["Access unknown", `/repositories/${R.fraud.id}/pull-requests`],
  ]],
  ["Sessions tab", [
    ["Active (default)", "/sessions"],
    ...([...["all", "queued", "preparing", "running", "waiting", "idle", "succeeded", "failed", "interrupted", "failed_setup"]].map((status): DemoLink => [status, `/sessions?status=${status}`])),
    ["Empty filter (mobile-app)", `/repositories/${R.mobile.id}/sessions`],
  ]],
  ["Updates", [
    ["Updates page", "/updates", `now: ${updateMode}, policy ${updatePolicy}`],
    ...updateModes.map((mode): DemoLink => [`Set: ${mode.replace("_", " ")}`, `/__demo/set/update/${mode}`]),
    ["Set policy: approval required", "/__demo/set/policy/approval_required"],
    ["Set policy: automatic", "/__demo/set/policy/automatic"],
  ]],
  ["System warning", [
    [unknownAccess.has(R.fraud.id) ? "fraud-rules access: make it OK (hides the \"Specs unavailable\" sidebar warning)" : "fraud-rules access: make it unknown", `/__demo/set/access/${unknownAccess.has(R.fraud.id) ? "ok" : "unknown"}`, `now: ${unknownAccess.has(R.fraud.id) ? "unknown" : "ok"}`],
    [systemWarning ? "Turn system warning OFF" : "Turn system warning ON", `/__demo/set/warning/${systemWarning ? "off" : "on"}`, `now: ${systemWarning ? "on" : "off"}`],
  ]],
  ["Sign in", [
    ["Sign-in page (signed out)", "/__demo/act/signed-out"],
    ["Wrong credential", "/__demo/act/bad-login"],
    ["Real sign-in form", "/login", "redirects to Repositories when already signed in"],
    ["Sign out (clears cookie)", "/__demo/signout"],
  ]],
];

const indexPage = (origin: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas UI demo</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1d21;--muted:#666;--line:#e3e3e6;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--fg:#e8e8ea;--muted:#9a9aa2;--line:#2b2d33;--accent:#8ea2ff}}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:8px 0}h2{font-size:16px;margin:24px 0 6px;border-bottom:1px solid var(--line);padding-bottom:4px}
ul{list-style:none;margin:0;padding:0}li{padding:7px 0;border-bottom:1px solid var(--line)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
small,.muted{color:var(--muted)}code{font-size:13px;background:color-mix(in srgb,var(--fg) 8%,transparent);padding:1px 5px;border-radius:4px}
</style></head><body><main>
<h1>Atlas UI demo</h1>
<p class="muted">Seeded fake data. Sign-in token: <code>${escapeHtml(TOKEN)}</code> · base <code>${escapeHtml(origin)}</code></p>
${groups().map(([title, links]) => `<h2>${escapeHtml(title)}</h2><ul>${links.map(([label, href, note]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a>${note ? ` <small>— ${escapeHtml(note)}</small>` : ""}<br><small><code>${escapeHtml(href)}</code></small></li>`).join("")}</ul>`).join("")}
</main></body></html>`;

const demoHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
};

const formFields = (html: string, formAction: string) => {
  const start = html.indexOf(`action="${formAction}"`);
  if (start < 0) return undefined;
  const end = html.indexOf("</form>", start);
  const body = html.slice(start, end);
  const fields = new URLSearchParams();
  for (const match of body.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    if (!name) continue;
    const type = /\btype="([^"]*)"/.exec(tag)?.[1] ?? "text";
    if ((type === "radio" || type === "checkbox") && !/\bchecked\b/.test(tag)) continue;
    const value = (/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    fields.set(name, value);
  }
  return fields;
};

const appRequest = (origin: string, path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return app.fetch(new Request(`${origin}${path}`, { ...init, headers }));
};

const passthrough = async (response: Response) => new Response(await response.text(), {
  status: response.status,
  headers: { ...demoHeaders },
});

const demo = async (request: Request, url: URL): Promise<Response> => {
  const origin = url.origin;
  const cookie = request.headers.get("Cookie") ?? "";
  const path = url.pathname;
  if (path === "/__demo" || path === "/__demo/") return new Response(indexPage(origin), { headers: demoHeaders });

  const set = /^\/__demo\/set\/(update|policy|warning|access)\/([a-z_]+)$/.exec(path);
  if (set) {
    const [, kind, value] = set;
    if (kind === "update" && updateModes.includes(value as UpdateMode)) {
      updateMode = value as UpdateMode;
      return redirect("/updates");
    }
    if (kind === "policy" && (value === "approval_required" || value === "automatic")) {
      updatePolicy = value;
      return redirect("/updates");
    }
    if (kind === "warning" && (value === "on" || value === "off")) {
      systemWarning = value === "on";
      writeRecoveryStatus();
      return redirect(request.headers.get("Referer")?.includes("/__demo") === false ? request.headers.get("Referer")! : "/__demo");
    }
    if (kind === "access" && (value === "unknown" || value === "ok")) {
      if (value === "unknown") {
        unknownAccess.add(R.fraud.id);
        await demoRefresh(R.fraud.id, ["access", "specs", "pullRequests"]);
      } else {
        unknownAccess.delete(R.fraud.id);
        await realCoordinator.refresh(R.fraud.id, ["access", "specs", "pullRequests"]);
      }
      return redirect("/__demo");
    }
    return new Response("Unknown demo setting", { status: 404 });
  }

  if (path === "/__demo/unread") return redirect("/inbox", [`${visitCookie(ago(4 * HOUR))}`]);
  if (path === "/__demo/signout") return redirect("/__demo", ["atlas_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"]);

  if (path === "/__demo/act/signed-out") {
    const redirected = await appRequest(origin, sessionUrl("waiting"));
    const login = redirected.headers.get("Location") ?? "/login";
    return passthrough(await appRequest(origin, login));
  }

  if (path === "/__demo/act/bad-login") {
    const page = await appRequest(origin, "/login");
    const fields = formFields(await page.text(), "/login");
    if (!fields) return new Response("Could not read the sign-in form", { status: 500 });
    fields.set("token", "wrong-token");
    return passthrough(await appRequest(origin, "/login", {
      method: "POST",
      body: fields,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    }));
  }

  if (path === "/__demo/act/duplicate-start") {
    const action = `/repositories/${R.payments.id}/specs/14/sessions`;
    const page = await appRequest(origin, `${action}/new`, { cookie });
    if (page.status !== 200) return redirect(`/login?returnTo=${encodeURIComponent("/__demo/act/duplicate-start")}`);
    const fields = formFields(await page.text(), action);
    if (!fields) return new Response("Could not read the Start Session form", { status: 500 });
    fields.set("prompt", "Try again with a smaller first commit.");
    return passthrough(await appRequest(origin, action, {
      method: "POST",
      cookie,
      body: fields,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    }));
  }

  return new Response("Unknown demo route", { status: 404 });
};

const stripSecure = (response: Response) => {
  const cookies = response.headers.getSetCookie();
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie.replace(/;\s*Secure/gi, ""));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0,
  fetch: async (request) => {
    const url = new URL(request.url);
    const response = url.pathname === "/__demo" || url.pathname.startsWith("/__demo/")
      ? await demo(request, url)
      : (pinTimes(), await app.fetch(request));
    return url.protocol === "https:" ? response : stripSecure(response);
  },
});

console.log(`Atlas UI demo: http://${HOST}:${server.port}/__demo  (token: ${TOKEN})`);
console.log(`Temporary data: ${root}`);

const shutdown = () => {
  server.stop(true);
  persistence.close();
  rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
