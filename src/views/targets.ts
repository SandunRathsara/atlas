import type { PrStack, PullRequest, RefreshState, Repository, TargetKind } from "../persistence.ts";
import { escapeHtml } from "./html.ts";
import { statusBadge } from "./shared.ts";

export type TargetStatus = {
  kind: "eligible" | "warning" | "disabled";
  label: string;
  reason: string;
};

const refreshIsCurrent = (refresh: RefreshState | undefined) => Boolean(
  refresh &&
  refresh.availability === "available" &&
  refresh.requestedGeneration <= refresh.completedGeneration,
);

const repositoryTargetStatus = (repository: Repository): TargetStatus | undefined => {
  if (repository.archived) {
    return { kind: "disabled", label: "Not eligible", reason: "Archived Repositories are browsable but cannot start Sessions." };
  }
  if (repository.disabled) {
    return { kind: "disabled", label: "Not eligible", reason: "Disabled Repositories are browsable but cannot start Sessions." };
  }
  if (!repository.hasIssues) {
    return { kind: "disabled", label: "Not eligible", reason: "GitHub Issues are disabled for this Repository." };
  }
  if (repository.removedAt) {
    return { kind: "disabled", label: "Not eligible", reason: "This Repository was removed from Atlas; new starts are disabled." };
  }
  if (repository.accessStatus === "unknown") {
    return { kind: "warning", label: "Waiting for verification", reason: "GitHub access for this Repository could not be verified." };
  }
  if (repository.accessStatus === "revoked") {
    return { kind: "disabled", label: "Not eligible", reason: "GitHub App access to this Repository is unavailable." };
  }
  if (repository.accessStatus === "transferred") {
    return { kind: "disabled", label: "Not eligible", reason: "This Repository is outside the configured organization." };
  }
  if (repository.accessStatus === "suspended") {
    return { kind: "disabled", label: "Not eligible", reason: "The GitHub App installation is suspended for this Repository." };
  }
  if (!repository.defaultBranch) {
    return { kind: "warning", label: "Waiting for verification", reason: "The Repository default branch is not currently known." };
  }
  return undefined;
};

export const targetVerificationStatus = (
  repository: Repository,
  accessRefresh: RefreshState | undefined,
  pullRequestsRefresh: RefreshState | undefined,
): TargetStatus | undefined => {
  const repositoryStatus = repositoryTargetStatus(repository);
  if (repositoryStatus) return repositoryStatus;
  if (!refreshIsCurrent(accessRefresh) || !refreshIsCurrent(pullRequestsRefresh)) {
    return { kind: "warning", label: "Waiting for verification", reason: "Current Repository access and Pull request/stack reads are required before a target can be eligible." };
  }
  return undefined;
};

export const targetBadgeClass = (kind: TargetStatus["kind"]) =>
  kind === "eligible" ? "badge-success" : kind === "warning" ? "badge-warning" : "badge-error";

export const pullRequestLifecycle = (pullRequest: PullRequest) => {
  if (pullRequest.mergedAt) return "Merged";
  if (pullRequest.state === "open") return pullRequest.draft ? "Draft" : "Open";
  return "Closed";
};

export const pullRequestStateBadge = (pullRequest: PullRequest) => {
  const className = pullRequest.mergedAt
    ? "badge-success"
    : pullRequest.state === "open"
      ? pullRequest.draft ? "badge-warning" : "badge-info"
      : "badge-neutral";
  return statusBadge(className, pullRequestLifecycle(pullRequest));
};

const mergeRestriction = (pullRequest: PullRequest): string | undefined => {
  if (pullRequest.autoMergeEnabled === true) return "Auto-merge is enabled on the top layer.";
  if (pullRequest.autoMergeEnabled === null) return "Auto-merge state could not be verified.";
  if (pullRequest.mergeQueueState === null) return "Merge-queue state could not be verified.";
  if (pullRequest.mergeQueueState !== "none") return "The top layer is in a GitHub merge queue.";
  return undefined;
};

export const standaloneStatus = (repository: Repository, pullRequest: PullRequest, targetGate?: TargetStatus): TargetStatus => {
  if (targetGate) return targetGate;
  if (pullRequest.state !== "open") {
    return { kind: "disabled", label: "Not eligible", reason: "The standalone parent is not open." };
  }
  if (pullRequest.headRepositoryId === null || pullRequest.headRepositoryId === undefined) {
    return { kind: "warning", label: "Waiting for verification", reason: "The Pull request head Repository could not be verified." };
  }
  if (pullRequest.headRepositoryId !== repository.githubId) {
    return { kind: "disabled", label: "Not eligible", reason: "The Pull request head belongs to another Repository." };
  }
  if (pullRequest.baseRef !== repository.defaultBranch) {
    return {
      kind: "disabled",
      label: "Not eligible",
      reason: `This standalone parent targets ${pullRequest.baseRef}, not the Repository default branch ${repository.defaultBranch}.`,
    };
  }
  if (pullRequest.headRefExists === null) {
    return { kind: "warning", label: "Waiting for verification", reason: "The current head branch ref has not been verified." };
  }
  if (!pullRequest.headRefExists) {
    return { kind: "disabled", label: "Not eligible", reason: "The required head branch ref is missing." };
  }
  const restriction = mergeRestriction(pullRequest);
  if (restriction) {
    return { kind: restriction.includes("could not") ? "warning" : "disabled", label: restriction.includes("could not") ? "Waiting for verification" : "Not eligible", reason: restriction };
  }
  return { kind: "eligible", label: "Eligible standalone target", reason: "Open, verified outside a native stack, and based on the Repository default branch." };
};

export const stackStatus = (
  repository: Repository,
  stack: PrStack,
  pullRequests: Map<string, PullRequest>,
  targetGate?: TargetStatus,
): TargetStatus => {
  if (targetGate) return targetGate;
  if (stack.members.length === 0) {
    return { kind: "warning", label: "Waiting for verification", reason: "The native stack has no verified ordered members." };
  }
  if (stack.open === null) {
    return { kind: "warning", label: "Waiting for verification", reason: "The native stack lifecycle could not be verified." };
  }
  if (!stack.open) {
    return { kind: "disabled", label: "Not eligible", reason: "The native stack is not open for another layer." };
  }
  if (stack.members.length >= 100) {
    return { kind: "disabled", label: "Not eligible", reason: "This native stack already has 100 members and cannot be extended." };
  }
  if (!stack.trunkRef) {
    return { kind: "warning", label: "Waiting for verification", reason: "The native stack trunk is not currently known." };
  }

  const members = [...stack.members].sort((left, right) => left.position - right.position);
  const memberPullRequests = members.map((member) => pullRequests.get(member.pullRequestId));
  if (memberPullRequests.some((pullRequest) => !pullRequest)) {
    return { kind: "warning", label: "Waiting for verification", reason: "One or more native stack members could not be reconciled." };
  }
  const resolvedMembers = memberPullRequests as PullRequest[];
  if (resolvedMembers.some((pullRequest) => pullRequest.headRepositoryId === null || pullRequest.headRepositoryId === undefined)) {
    return { kind: "warning", label: "Waiting for verification", reason: "A native stack member's head Repository could not be verified." };
  }
  if (resolvedMembers.some((pullRequest) => pullRequest.headRepositoryId !== repository.githubId)) {
    return { kind: "disabled", label: "Not eligible", reason: "A native stack member belongs to another Repository." };
  }
  if (resolvedMembers.some((pullRequest) => pullRequest.state === "closed" && !pullRequest.mergedAt)) {
    return { kind: "disabled", label: "Not eligible", reason: "A closed-unmerged layer blocks this native stack." };
  }
  if (resolvedMembers.every((pullRequest) => pullRequest.mergedAt)) {
    return { kind: "disabled", label: "Not eligible", reason: "Every native stack layer is merged; the completed stack cannot be extended." };
  }

  const top = resolvedMembers[resolvedMembers.length - 1]!;
  if (top.state !== "open") {
    return {
      kind: "disabled",
      label: "Not eligible",
      reason: top.mergedAt ? "The actual top layer is merged; this stack cannot be extended." : "The actual top layer is closed-unmerged.",
    };
  }
  if (top.headRefExists === null) {
    return { kind: "warning", label: "Waiting for verification", reason: "The actual top branch ref has not been verified." };
  }
  if (!top.headRefExists) {
    return { kind: "disabled", label: "Not eligible", reason: "The actual top branch ref is missing." };
  }
  const restriction = mergeRestriction(top);
  if (restriction) {
    return { kind: restriction.includes("could not") ? "warning" : "disabled", label: restriction.includes("could not") ? "Waiting for verification" : "Not eligible", reason: restriction };
  }
  return { kind: "eligible", label: "Eligible native stack target", reason: "The explicit native order and actual top are verified; the next layer would follow this top." };
};

type StartTargetOption = {
  value: string;
  kind: TargetKind;
  label: string;
  reason: string;
  status: TargetStatus;
  observation: string;
};

export const targetObservation = (
  repository: Repository,
  pullRequests: PullRequest[] = [],
  stacks: PrStack[] = [],
  target: { kind: TargetKind; stackId?: string | null; parentPullRequestId?: string | null },
) => {
  const pullRequestMap = new Map(pullRequests.map((pullRequest) => [pullRequest.githubId, pullRequest]));
  if (target.kind === "default") {
    return JSON.stringify({ kind: "default", branch: repository.defaultBranch });
  }

  if (target.kind === "native_stack") {
    const stack = stacks.find((candidate) => candidate.githubId === target.stackId);
    return JSON.stringify({
      kind: "native_stack",
      id: target.stackId ?? null,
      stack: stack
        ? {
          nodeId: stack.nodeId,
          number: stack.number,
          trunk: stack.trunkRef,
          open: stack.open,
          members: [...stack.members]
            .sort((left, right) => left.position - right.position)
            .map((member) => {
              const pullRequest = pullRequestMap.get(member.pullRequestId);
              return {
                id: member.pullRequestId,
                position: member.position,
                head: pullRequest?.headRef ?? null,
                base: pullRequest?.baseRef ?? null,
              };
            }),
        }
        : null,
    });
  }

  const parent = pullRequests.find((pullRequest) => pullRequest.githubId === target.parentPullRequestId);
  return JSON.stringify({
    kind: "standalone_parent",
    id: target.parentPullRequestId ?? null,
    parent: parent
      ? {
        number: parent.number,
        head: parent.headRef,
        base: parent.baseRef,
        stack: parent.stack
          ? {
            id: parent.stack.stackId,
            number: parent.stack.stackNumber,
            position: parent.stack.position,
            size: parent.stack.size,
            trunk: parent.stack.trunkRef,
          }
          : null,
      }
      : null,
  });
};

export const startTargetOptions = (
  repository: Repository,
  pullRequests: PullRequest[] = [],
  stacks: PrStack[] = [],
  accessRefresh?: RefreshState,
  pullRequestsRefresh?: RefreshState,
): StartTargetOption[] => {
  const options: StartTargetOption[] = [];
  const defaultStatus = repositoryTargetStatus(repository) ?? {
    kind: "eligible" as const,
    label: "Eligible default branch",
    reason: "The latest verified default-branch commit will be used when preparation is admitted.",
  };
  options.push({
    value: "default",
    kind: "default",
    label: `Default branch · ${repository.defaultBranch ?? "unknown"}`,
    reason: defaultStatus.reason,
    status: defaultStatus,
    observation: targetObservation(repository, pullRequests, stacks, { kind: "default" }),
  });

  const pullRequestMap = new Map(pullRequests.map((pullRequest) => [pullRequest.githubId, pullRequest]));
  const targetGate = targetVerificationStatus(repository, accessRefresh, pullRequestsRefresh);
  for (const stack of stacks) {
    const status = stackStatus(repository, stack, pullRequestMap, targetGate);
    const members = [...stack.members].sort((left, right) => left.position - right.position);
    const top = members[members.length - 1];
    const topPullRequest = top ? pullRequestMap.get(top.pullRequestId) : undefined;
    options.push({
      value: `stack:${stack.githubId}`,
      kind: "native_stack",
      label: `Native stack #${stack.number}${topPullRequest ? ` · top #${topPullRequest.number}` : ""}`,
      reason: status.reason,
      status,
      observation: targetObservation(repository, pullRequests, stacks, { kind: "native_stack", stackId: stack.githubId }),
    });
  }

  for (const pullRequest of pullRequests.filter((candidate) => candidate.isCurrent && candidate.state === "open" && !candidate.stack)) {
    const status = standaloneStatus(repository, pullRequest, targetGate);
    options.push({
      value: `parent:${pullRequest.githubId}`,
      kind: "standalone_parent",
      label: `Standalone parent #${pullRequest.number} · ${pullRequest.title}`,
      reason: status.reason,
      status,
      observation: targetObservation(repository, pullRequests, stacks, { kind: "standalone_parent", parentPullRequestId: pullRequest.githubId }),
    });
  }
  return options;
};

export const renderStartTargetOptions = (
  repository: Repository,
  pullRequests: PullRequest[] | undefined,
  stacks: PrStack[] | undefined,
  accessRefresh: RefreshState | undefined,
  pullRequestsRefresh: RefreshState | undefined,
  selected: string,
  targetInvalid = false,
  targetErrorId = "target-reconfirmation-error",
) => {
  const options = startTargetOptions(repository, pullRequests, stacks, accessRefresh, pullRequestsRefresh);
  const observations = Object.fromEntries(options.map((option) => [option.value, option.observation]));
  const targetHelp = options.length === 1
    ? `<p class="mt-2 text-sm leading-normal text-faint">Native stack and standalone parent choices appear after a complete Pull request/stack read.</p>`
    : "";
  return `<fieldset class="mt-8 max-w-3xl" aria-describedby="${targetInvalid ? `target-help ${targetErrorId}` : "target-help"}">
    <legend class="label mb-2 block p-0">Starting target</legend>
    <input type="hidden" name="target_observations" value="${escapeHtml(JSON.stringify(observations))}">
    <div class="grid gap-3">
      ${options.map((option) => `<label class="flex items-start gap-3 rounded-field border border-control-border bg-base-100 p-3 ${option.status.kind === "eligible" ? "cursor-pointer" : "opacity-90"}">
        <input class="radio radio-primary mt-1" type="radio" name="target" value="${escapeHtml(option.value)}"${option.value === selected ? " checked" : ""}${option.status.kind === "eligible" ? "" : " disabled"}${targetInvalid ? ' aria-invalid="true"' : ""}>
        <span class="min-w-0"><span class="block break-words font-medium">${escapeHtml(option.label)}</span><span class="mt-1 block text-sm leading-normal ${option.status.kind === "eligible" ? "text-muted" : option.status.kind === "warning" ? "text-warning" : "text-error"}">${escapeHtml(option.status.label)} · ${escapeHtml(option.reason)}</span></span>
      </label>`).join("")}
    </div>
    <p id="target-help" class="mt-2 text-sm leading-normal text-faint">Atlas prepares a local child only. It never pushes, creates a Pull request, or registers native membership.</p>
    ${targetHelp}
  </fieldset>`;
};
