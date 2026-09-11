import type { PrStack, PullRequest, RefreshState, Repository } from "../persistence.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";
import {
  accessNotice,
  emptyState,
  recordTable,
  refreshLine,
  refreshWarning,
  renderRepositoryHeading,
  statusBadge,
} from "./shared.ts";
import { renderShell, type InboxContext } from "./shell.ts";
import {
  pullRequestStateBadge,
  stackStatus,
  standaloneStatus,
  targetBadgeClass,
  type TargetStatus,
  targetVerificationStatus,
} from "./targets.ts";

const pullRequestLink = (pullRequest: PullRequest) => {
  const url = safeExternalUrl(pullRequest.htmlUrl);
  const label = `#${escapeHtml(pullRequest.number)} ${escapeHtml(pullRequest.title)}`;
  return url
    ? `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : label;
};

const pullRequestIdentity = (pullRequest: PullRequest, detail: string) =>
  `${pullRequestLink(pullRequest)}<p class="mt-1 text-sm text-muted">${detail}</p>`;

const stackMeta = (stack: PrStack) =>
  `Trunk: <code class="font-mono text-base-content">${escapeHtml(stack.trunkRef ?? "unknown")}</code> · Global ID: <code class="font-mono text-base-content">${escapeHtml(stack.githubId)}</code>${
    stack.nodeId ? ` · Node ID: <code class="font-mono text-base-content">${escapeHtml(stack.nodeId)}</code>` : ""
  }`;

const headRefStatus = (pullRequest: PullRequest) =>
  pullRequest.headRefExists === true
    ? `Verified at <code class="font-mono">${escapeHtml(pullRequest.observedHeadSha ?? "unknown SHA")}</code>`
    : pullRequest.headRefExists === false
      ? "Missing"
      : "Unknown";

const membershipLine = (pullRequest: PullRequest) =>
  pullRequest.stack
    ? `Native stack #${escapeHtml(pullRequest.stack.stackNumber)}, position ${pullRequest.stack.position} of ${pullRequest.stack.size}`
    : "Standalone Pull request";

const stackMembers = (stack: PrStack, pullRequests: Map<string, PullRequest>) => {
  const members = [...stack.members].sort((left, right) => left.position - right.position);
  const topPosition = members[members.length - 1]?.position;
  return `<ol class="grid gap-2" aria-label="Native stack #${escapeHtml(stack.number)} ordered members">${
    members.map((member) => {
      const pullRequest = pullRequests.get(member.pullRequestId);
      return `<li class="flex flex-wrap items-center justify-between gap-2">
        <span class="min-w-0 break-words"><span class="mr-2 font-mono text-sm text-muted">${member.position}.</span>${
          pullRequest ? pullRequestLink(pullRequest) : `<span class="text-warning">Pull request unavailable</span>`
        }</span>
        <span class="flex flex-wrap items-center gap-1">${
          pullRequest ? pullRequestStateBadge(pullRequest) : ""
        }${member.position === topPosition ? statusBadge("badge-info", "Top") : ""}</span>
      </li>`;
    }).join("")
  }</ol>`;
};

const renderStackRows = (
  repository: Repository,
  stack: PrStack,
  pullRequests: Map<string, PullRequest>,
  targetGate?: TargetStatus,
) => {
  const status = stackStatus(repository, stack, pullRequests, targetGate);
  const identity = `<span class="font-medium">Native stack #${escapeHtml(stack.number)}</span>
    <p class="mt-1 text-sm text-muted">${stackMeta(stack)}</p>
    <p class="mt-2 text-sm leading-normal text-muted">${escapeHtml(status.reason)}</p>`;
  const members = stackMembers(stack, pullRequests);
  const badge = statusBadge(targetBadgeClass(status.kind), status.label);
  return {
    row: `<tr>
      <td class="align-top">
        <div class="flex gap-2">
          ${icon("code-bracket", 20)}
          <div class="min-w-0">${identity}</div>
        </div>
      </td>
      <td class="align-top">${badge}</td>
      <td class="align-top">${members}</td>
    </tr>`,
    stacked: `<li class="p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">${identity}</div>
        ${badge}
      </div>
      <div class="mt-3">${members}</div>
    </li>`,
  };
};

const renderActiveRows = (pullRequest: PullRequest) => {
  const identity = pullRequestIdentity(pullRequest, membershipLine(pullRequest));
  const badge = pullRequestStateBadge(pullRequest);
  return {
    row: `<tr>
      <td class="align-top">
        <div class="flex gap-2">
          ${icon("code-bracket", 20)}
          <div class="min-w-0">${identity}</div>
        </div>
      </td>
      <td class="align-top">${badge}</td>
      <td class="align-top break-words font-mono">${escapeHtml(pullRequest.headRef)}</td>
      <td class="align-top break-words font-mono">${escapeHtml(pullRequest.baseRef)}</td>
      <td class="align-top">${headRefStatus(pullRequest)}</td>
      <td class="align-top whitespace-nowrap tabular-nums text-muted">${formatTime(pullRequest.updatedAt)}</td>
    </tr>`,
    stacked: `<li class="p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">${identity}</div>
        ${badge}
      </div>
      <dl class="mt-3 grid gap-3 text-sm">
        <div><dt class="font-medium text-muted">Head</dt><dd class="mt-1 break-words font-mono">${escapeHtml(pullRequest.headRef)}</dd></div>
        <div><dt class="font-medium text-muted">Base</dt><dd class="mt-1 break-words font-mono">${escapeHtml(pullRequest.baseRef)}</dd></div>
        <div><dt class="font-medium text-muted">Head ref</dt><dd class="mt-1 break-words">${headRefStatus(pullRequest)}</dd></div>
        <div><dt class="font-medium text-muted">Updated</dt><dd class="mt-1">${formatTime(pullRequest.updatedAt)}</dd></div>
      </dl>
    </li>`,
  };
};

const renderStandaloneRows = (repository: Repository, pullRequest: PullRequest, targetGate?: TargetStatus) => {
  const status = standaloneStatus(repository, pullRequest, targetGate);
  const identity = `${pullRequestIdentity(
    pullRequest,
    `Standalone candidate · base <code class="font-mono text-base-content">${escapeHtml(pullRequest.baseRef)}</code>`,
  )}<p class="mt-2 text-sm leading-normal text-muted">${escapeHtml(status.reason)}</p>`;
  const badge = statusBadge(targetBadgeClass(status.kind), status.label);
  return {
    row: `<tr>
      <td class="align-top">
        <div class="flex gap-2">
          ${icon("code-bracket", 20)}
          <div class="min-w-0">${identity}</div>
        </div>
      </td>
      <td class="align-top">${badge}</td>
    </tr>`,
    stacked: `<li class="p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">${identity}</div>
        ${badge}
      </div>
    </li>`,
  };
};

const section = (id: string, title: string, description: string, table: string) =>
  `<section class="mt-8" aria-labelledby="${id}"><h2 id="${id}" class="text-base font-semibold">${title}</h2>${
    description ? `<p class="mt-2 max-w-prose text-base leading-normal text-muted">${description}</p>` : ""
  }${table}</section>`;

export const renderPullRequestsPage = ({
  csrfToken,
  repository,
  pullRequests,
  stacks,
  accessRefresh,
  refresh,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  pullRequests: PullRequest[];
  stacks: PrStack[];
  accessRefresh?: RefreshState;
  refresh?: RefreshState;
  inbox?: InboxContext;
}) => {
  const activePullRequests = pullRequests.filter((pullRequest) => pullRequest.isCurrent && pullRequest.state === "open");
  const pullRequestMap = new Map(pullRequests.map((pullRequest) => [pullRequest.githubId, pullRequest]));
  const standalone = activePullRequests.filter((pullRequest) => !pullRequest.stack);
  const targetGate = targetVerificationStatus(repository, accessRefresh, refresh);
  const canShowEmptyState = refresh?.availability === "available"
    && refresh.requestedGeneration <= refresh.completedGeneration;
  const notice = refreshWarning("Pull requests", refresh);
  const empty = canShowEmptyState && activePullRequests.length === 0 && stacks.length === 0
    ? emptyState(
      "No active Pull requests or native stacks",
      "Open GitHub Pull requests and explicitly registered native stacks appear here.",
    )
    : "";
  const stackRows = stacks.map((stack) => renderStackRows(repository, stack, pullRequestMap, targetGate));
  const activeRows = activePullRequests.map(renderActiveRows);
  const standaloneRows = standalone.map((pullRequest) => renderStandaloneRows(repository, pullRequest, targetGate));
  const stackList = stacks.length > 0
    ? section(
      "native-stacks-heading",
      "Native PR stacks",
      "GitHub's explicit bottom-to-top order is shown here. Atlas does not infer stacks from branch names or change GitHub state.",
      recordTable({
        label: "Native PR stacks",
        headers: ["Stack", "State", "Members"],
        rows: stackRows.map((entry) => entry.row),
        stacked: stackRows.map((entry) => entry.stacked),
      }),
    )
    : "";
  const activeList = activePullRequests.length > 0
    ? section(
      "active-pull-requests-heading",
      "Active Pull requests",
      "",
      recordTable({
        label: "Active Pull requests",
        headers: ["Pull request", "State", "Head", "Base", "Head ref", "Updated"],
        rows: activeRows.map((entry) => entry.row),
        stacked: activeRows.map((entry) => entry.stacked),
      }),
    )
    : "";
  const standaloneList = standalone.length > 0
    ? section(
      "standalone-targets-heading",
      "Standalone target classification",
      "Only open Pull requests outside an explicit native stack are considered here. Classification is read-only; no start or GitHub mutation is available in this slice.",
      recordTable({
        label: "Standalone target classification",
        headers: ["Pull request", "State"],
        rows: standaloneRows.map((entry) => entry.row),
        stacked: standaloneRows.map((entry) => entry.stacked),
      }),
    )
    : "";

  return renderShell({
    title: `${repository.fullName} Pull requests`,
    csrfToken,
    inbox,
    content: `${renderRepositoryHeading(repository, "Pull requests", "Active GitHub Pull requests, explicit native stack order, and read-only starting-target classification.", csrfToken)}
      ${accessNotice(repository)}
      ${refreshWarning("Access", accessRefresh)}
      ${notice}
      <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Pull requests", refresh)}</p>
      ${empty}
      ${stackList}
      ${activeList}
      ${standaloneList}`,
  });
};
