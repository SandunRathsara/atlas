import type { PrStack, PullRequest, RefreshState, Repository, TargetKind } from "../persistence.ts";
import { escapeHtml } from "./html.ts";
import { icon } from "./icons.ts";
import { banner } from "./kit.ts";

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

export const pullRequestLifecycle = (pullRequest: PullRequest) => {
  if (pullRequest.mergedAt) return "Merged";
  if (pullRequest.state === "open") return pullRequest.draft ? "Draft" : "Open";
  return "Closed";
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
  /** Short picker title, e.g. "Default branch · main", "PR stack #3", "On top of PR #42". */
  title: string;
  /** One plain line under the title when the option is usable. */
  context: string;
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
    title: `Default branch · ${repository.defaultBranch ?? "unknown"}`,
    context: repository.defaultBranch ? `Start fresh from the latest ${repository.defaultBranch}` : "Start fresh from the default branch",
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
      title: `PR stack #${stack.number}`,
      context: topPullRequest ? `Adds a layer on top of PR #${topPullRequest.number} · ${topPullRequest.title}` : "Adds a layer on top of the stack",
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
      title: `On top of PR #${pullRequest.number}`,
      context: pullRequest.title,
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
  const gate = targetVerificationStatus(repository, accessRefresh, pullRequestsRefresh);
  const unchecked = gate?.kind === "warning" && options[0]?.status.kind === "eligible"
    ? banner({ title: "Couldn’t check GitHub just now", body: "Pull requests and stacks can’t be used until Atlas finishes a current check. The default branch still works.", className: "sp-pick-note" })
    : "";
  const rows = options.map((option, index) => {
    const id = `start-target-${index}`;
    const usable = option.status.kind === "eligible";
    const sub = usable
      ? option.context
      : `${option.status.kind === "warning" ? "Not checked yet" : "Can’t use"}: ${option.reason}`;
    return `<label class="ax-setrow ax-pick${usable ? "" : " ax-off"}" for="${id}">
        <input type="radio" id="${id}" name="target" value="${escapeHtml(option.value)}"${option.value === selected ? " checked" : ""}${usable ? "" : " disabled"}${targetInvalid ? ' aria-invalid="true"' : ""}>
        <span class="ax-setrow-main"><b>${escapeHtml(option.title)}</b><span class="${usable ? "" : `sp-pick-why sp-pick-${option.status.kind}`}">${escapeHtml(sub)}</span></span>${icon("check", 20, "ax-tick")}
      </label>`;
  }).join("");
  const targetHelp = options.length === 1
    ? " Pull requests and stacks show up here after a complete Pull request read."
    : "";
  return `<fieldset class="sp-pick" aria-describedby="${targetInvalid ? `target-help ${targetErrorId}` : "target-help"}">
    <legend class="ax-group-label">Start from</legend>
    <input type="hidden" name="target_observations" value="${escapeHtml(JSON.stringify(observations))}">
    ${unchecked}
    <div class="ax-group">${rows}</div>
    <p id="target-help" class="ax-group-foot">Atlas works on a local copy only. It never pushes, opens a Pull request or changes a stack.${targetHelp}</p>
  </fieldset>`;
};
