import {
  GitHubError,
  type GitHubClient,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepository,
} from "./github.ts";
import {
  refreshViews,
  type Persistence,
  type PrStackInput,
  type PullRequestInput,
  type RefreshView,
  type Repository,
} from "./persistence.ts";

const FIVE_MINUTES = 5 * 60 * 1000;
const RETRY_DELAYS = [1_000, 5_000, 15_000, 30_000, 60_000, FIVE_MINUTES];

export type RefreshCoordinator = {
  refresh: (repositoryId: string, views: RefreshView[]) => Promise<void>;
  request: (repositoryId: string, views?: RefreshView[]) => void;
  wake: (repositoryIds: string[]) => void;
  start: () => void;
  stop: () => void;
};

export type RefreshCoordinatorOptions = {
  persistence: Persistence;
  github: GitHubClient;
  organization: string;
  installationId: string;
  now?: () => number;
};

type RefreshPassResult = {
  failed: boolean;
  retryAfterMs?: number;
};

const repositoryInput = (
  repository: GitHubRepository,
  organization: string,
  installationId: string,
  accessStatus: Repository["accessStatus"] = "available",
  accessReason: string | null = null,
) => ({
  githubId: repository.id,
  installationId,
  organization,
  owner: repository.owner,
  name: repository.name,
  fullName: repository.fullName,
  htmlUrl: repository.htmlUrl,
  description: repository.description,
  visibility: repository.visibility,
  defaultBranch: repository.defaultBranch,
  archived: repository.archived,
  disabled: repository.disabled,
  hasIssues: repository.hasIssues,
  accessStatus,
  accessReason,
});

export const githubFailureMessage = (error: unknown) => {
  if (error instanceof GitHubError) {
    if (error.kind === "configuration") return "GitHub App access is not configured for this Atlas instance.";
    if (error.kind === "access") return "GitHub App access could not be verified.";
    if (error.kind === "suspended") return "The GitHub App installation is suspended.";
    if (error.kind === "temporary") return "GitHub is temporarily unavailable.";
    if (error.kind === "not-found") return "GitHub could not find the requested Repository.";
  }
  return "GitHub synchronization failed. Existing Atlas data was retained.";
};

const hasExactSpecLabel = (issue: GitHubIssue) => issue.labels.some((label) => label === "spec");

export const createRefreshCoordinator = (options: RefreshCoordinatorOptions): RefreshCoordinator => {
  const now = options.now ?? Date.now;
  const locks = new Map<string, Promise<void>>();
  const wakeAfter = new Set<string>();
  const retryAttempts = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let interval: ReturnType<typeof setInterval> | undefined;

  const saveSpecs = async (repository: Repository, githubRepository: GitHubRepository, generation: number) => {
    if (!githubRepository.hasIssues) {
      options.persistence.replaceSpecs(
        repository.githubId,
        [],
        undefined,
        "GitHub Issues are disabled for this Repository; no Specs can be listed.",
        generation,
      );
      return;
    }

    const issues = await options.github.listIssues(githubRepository);
    const hasLabel = await options.github.hasLabel(githubRepository, "spec");
    if (!hasLabel) {
      options.persistence.replaceSpecs(
        repository.githubId,
        [],
        undefined,
        "No exact `spec` label exists in this Repository. Atlas does not create labels.",
        generation,
      );
      return;
    }

    const observedAt = new Date(now()).toISOString();
    options.persistence.replaceSpecs(
      repository.githubId,
      issues.map((issue) => ({
        githubId: issue.id,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        htmlUrl: issue.htmlUrl,
        state: issue.state,
        labels: issue.labels,
        isPullRequest: issue.isPullRequest,
        hasSpecLabel: hasExactSpecLabel(issue),
        updatedAt: issue.updatedAt,
        observedAt,
      })),
      observedAt,
      null,
      generation,
    );
  };

  const savePullRequests = async (repository: Repository, githubRepository: GitHubRepository, generation: number) => {
    if (!options.github.listPullRequests || !options.github.listStacks || !options.github.getBranchRef) {
      throw new GitHubError("Native Pull request browsing is not configured", { kind: "configuration" });
    }

    const pullRequests = await options.github.listPullRequests(githubRepository);
    const stacks = await options.github.listStacks(githubRepository);
    const headRefs = new Set(
      pullRequests
        .filter((pullRequest) => pullRequest.state === "open" && pullRequest.headRepositoryId === githubRepository.id)
        .map((pullRequest) => pullRequest.headRef),
    );
    const refs = new Map<string, string | null>();
    for (const branch of headRefs) {
      const ref = await options.github.getBranchRef(githubRepository, branch);
      refs.set(branch, ref?.sha ?? null);
    }

    const observedAt = new Date(now()).toISOString();
    const pullRequestInputs: PullRequestInput[] = pullRequests.map((pullRequest: GitHubPullRequest) => {
      const sameRepository = pullRequest.headRepositoryId === githubRepository.id;
      const observedHeadSha = pullRequest.state === "open" && sameRepository ? refs.get(pullRequest.headRef) ?? null : null;
      return {
        githubId: pullRequest.id,
        number: pullRequest.number,
        title: pullRequest.title,
        htmlUrl: pullRequest.htmlUrl,
        state: pullRequest.state,
        draft: pullRequest.draft,
        mergedAt: pullRequest.mergedAt,
        headRef: pullRequest.headRef,
        headSha: pullRequest.headSha,
        headRepositoryId: pullRequest.headRepositoryId ?? null,
        baseRef: pullRequest.baseRef,
        baseSha: pullRequest.baseSha,
        mergeableState: pullRequest.mergeableState,
        autoMergeEnabled: pullRequest.autoMergeEnabled,
        mergeQueueState: pullRequest.mergeQueueState,
        headRefExists: pullRequest.state === "open" && sameRepository ? observedHeadSha !== null : null,
        observedHeadSha,
        updatedAt: pullRequest.updatedAt,
        observedAt,
      };
    });
    const pullRequestByNumber = new Map(pullRequests.map((pullRequest) => [pullRequest.number, pullRequest]));
    const stackInputs: PrStackInput[] = stacks.map((stack) => ({
      githubId: stack.id,
      nodeId: stack.nodeId,
      number: stack.number,
      trunkRef: stack.trunkRef,
      open: stack.open,
      observedAt,
      members: stack.pullRequests.map((member) => {
        const pullRequest = pullRequestByNumber.get(member.number);
        if (!pullRequest) {
          throw new GitHubError("Native stack member was not in the complete Pull request projection", { kind: "invalid" });
        }
        return { pullRequestId: pullRequest.id, position: member.position };
      }),
    }));

    options.persistence.replacePullRequests(repository.githubId, pullRequestInputs, stackInputs, observedAt, null, generation);
  };

  const markMissingRepository = (repository: Repository, generations: Map<RefreshView, number>, reason: string) => {
    const accessGeneration = generations.get("access");
    if (accessGeneration !== undefined) {
      options.persistence.markAccessObservation(repository.githubId, "revoked", reason, accessGeneration);
    }
    for (const view of ["specs", "pullRequests"] as const) {
      const generation = generations.get(view);
      if (generation !== undefined) options.persistence.markRefreshFailure(repository.githubId, view, reason, "unavailable", generation);
    }
  };

  const runPass = async (repositoryId: string, views: RefreshView[]): Promise<RefreshPassResult> => {
    const generations = new Map<RefreshView, number>();
    for (const view of views) {
      const state = options.persistence.getRefreshState(repositoryId, view);
      if (state && state.requestedGeneration > state.completedGeneration) generations.set(view, state.requestedGeneration);
    }
    if (generations.size === 0) return { failed: false };

    const existing = options.persistence.getRepository(repositoryId);
    if (!existing) return { failed: false };

    let inventory: GitHubRepository[];
    try {
      inventory = await options.github.listInstallationRepositories();
    } catch (error) {
      const reason = githubFailureMessage(error);
      const accessGeneration = generations.get("access");
      if (accessGeneration !== undefined) {
        const status = error instanceof GitHubError && error.kind === "suspended" ? "suspended" : "unknown";
        options.persistence.markAccessFailure(repositoryId, status, reason, accessGeneration);
      }
      for (const [view, generation] of generations) {
        options.persistence.markRefreshFailure(repositoryId, view, reason, "unavailable", generation);
      }
      return {
        failed: true,
        retryAfterMs: error instanceof GitHubError ? error.retryAfterMs : undefined,
      };
    }

    const candidate = inventory.find((item) => item.id === existing.githubId);
    if (!candidate) {
      markMissingRepository(existing, generations, "Repository was not present in the last complete GitHub App inventory.");
      if (generations.has("access")) {
        options.persistence.markRefreshSuccess(
          repositoryId,
          "access",
          "Repository was not present in the last complete GitHub App inventory.",
          generations.get("access"),
        );
      }
      return { failed: generations.has("specs") || generations.has("pullRequests") };
    }

    if (candidate.owner.toLocaleLowerCase() !== options.organization.toLocaleLowerCase()) {
      const reason = "Repository is now outside the configured organization.";
      const accessGeneration = generations.get("access");
      if (accessGeneration !== undefined) {
        options.persistence.saveRepositoryObservation(
          repositoryInput(candidate, options.organization, options.installationId, "transferred", reason),
          accessGeneration,
          reason,
        );
      }
      for (const view of ["specs", "pullRequests"] as const) {
        const generation = generations.get(view);
        if (generation !== undefined) options.persistence.markRefreshFailure(repositoryId, view, reason, "unavailable", generation);
      }
      return { failed: generations.has("specs") || generations.has("pullRequests") };
    }

    const accessGeneration = generations.get("access");
    if (accessGeneration !== undefined) {
      options.persistence.saveRepositoryObservation(
        repositoryInput(candidate, options.organization, options.installationId),
        accessGeneration,
      );
    }

    const repository = options.persistence.getRepository(repositoryId)!;
    let failed = false;
    let retryAfterMs = 0;
    const specsGeneration = generations.get("specs");
    if (specsGeneration !== undefined) {
      try {
        await saveSpecs(repository, candidate, specsGeneration);
      } catch (error) {
        failed = true;
        retryAfterMs = Math.max(retryAfterMs, error instanceof GitHubError ? error.retryAfterMs ?? 0 : 0);
        options.persistence.markRefreshFailure(repositoryId, "specs", githubFailureMessage(error), "unavailable", specsGeneration);
      }
    }

    const pullRequestsGeneration = generations.get("pullRequests");
    if (pullRequestsGeneration !== undefined) {
      try {
        await savePullRequests(repository, candidate, pullRequestsGeneration);
      } catch (error) {
        failed = true;
        retryAfterMs = Math.max(retryAfterMs, error instanceof GitHubError ? error.retryAfterMs ?? 0 : 0);
        options.persistence.markRefreshFailure(repositoryId, "pullRequests", githubFailureMessage(error), "unavailable", pullRequestsGeneration);
      }
    }

    return { failed, retryAfterMs: retryAfterMs || undefined };
  };

  const scheduleRetry = (repositoryId: string, retryAfterMs = 0) => {
    if (retryTimers.has(repositoryId)) return;
    const attempt = retryAttempts.get(repositoryId) ?? 0;
    retryAttempts.set(repositoryId, Math.min(attempt + 1, RETRY_DELAYS.length - 1));
    const delay = Math.max(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]!, retryAfterMs);
    const timer = setTimeout(() => {
      retryTimers.delete(repositoryId);
      schedule(repositoryId);
    }, delay);
    (timer as { unref?: () => void }).unref?.();
    retryTimers.set(repositoryId, timer);
  };

  const process = async (repositoryId: string) => {
    let result: RefreshPassResult = { failed: false };
    for (let pass = 0; pass < 8; pass += 1) {
      result = await runPass(repositoryId, refreshViews);
      if (result.failed) break;

      const pending = refreshViews.some((view) => {
        const state = options.persistence.getRefreshState(repositoryId, view);
        return state !== undefined && state.requestedGeneration > state.completedGeneration;
      });
      if (!pending) break;
    }
    if (result.failed) scheduleRetry(repositoryId, result.retryAfterMs);
    else retryAttempts.delete(repositoryId);
  };

  const schedule = (repositoryId: string): Promise<void> => {
    const current = locks.get(repositoryId);
    if (current) {
      wakeAfter.add(repositoryId);
      return current;
    }
    if (retryTimers.has(repositoryId)) return Promise.resolve();

    const run = process(repositoryId)
      .catch(() => scheduleRetry(repositoryId))
      .finally(() => {
        locks.delete(repositoryId);
        if (wakeAfter.delete(repositoryId)) schedule(repositoryId);
      });
    locks.set(repositoryId, run);
    return run;
  };

  const request = (repositoryId: string, views: RefreshView[] = refreshViews) => {
    options.persistence.requestRefresh(repositoryId, views);
    void schedule(repositoryId);
  };

  const refresh = async (repositoryId: string, views: RefreshView[]) => {
    options.persistence.requestRefresh(repositoryId, views);
    await schedule(repositoryId);
  };

  const wake = (repositoryIds: string[]) => {
    for (const repositoryId of new Set(repositoryIds)) void schedule(repositoryId);
  };

  const start = () => {
    if (interval) return;
    const reconcile = () => {
      for (const repository of options.persistence.listRepositories(true)) request(repository.githubId);
    };
    reconcile();
    interval = setInterval(reconcile, FIVE_MINUTES);
  };

  const stop = () => {
    if (interval) clearInterval(interval);
    interval = undefined;
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    wakeAfter.clear();
  };

  return { refresh, request, wake, start, stop };
};
