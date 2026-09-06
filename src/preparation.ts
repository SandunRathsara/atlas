import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, statfsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import type { GitHubClient, GitHubRepository } from "./github.ts";
import {
  createCredentialBoundary,
  type CredentialBoundary,
  type CredentialScope,
} from "./credentials.ts";
import type {
  Persistence,
  PreparationIntent,
  PullRequest,
  PrStack,
  Repository,
  ResolvedTarget,
  Session,
  SessionTarget,
} from "./persistence.ts";

const DEFAULT_SESSION_ROOT = "/var/lib/atlas/sessions";
const DEFAULT_CAPACITY = 1;
const DEFAULT_POLL_MS = 2_000;
export const DEFAULT_MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/u;
const BRANCH_PATTERN = /^(?!\.)(?!.*\.\.)(?!.*\/{2})(?!.*@\{)(?!.*\.$)(?!.*\/$)[A-Za-z0-9._/-]+$/u;

export const hasRequiredFreeSpace = (availableBytes: number, minimumBytes: number) =>
  Number.isFinite(availableBytes) && availableBytes >= minimumBytes;

type PreparationRefresh = {
  ok: boolean;
  repository: Repository;
};

type VerifiedTarget = {
  repository: Repository;
  candidate: GitHubRepository;
  target: SessionTarget;
  resolved: ResolvedTarget;
  sha: string;
};

type PreparationOptions = {
  persistence: Persistence;
  github: GitHubClient;
  refreshRepository: (repository: Repository) => Promise<PreparationRefresh>;
  refreshPullRequests?: (repository: Repository) => Promise<PreparationRefresh>;
  sessionRoot?: string;
  globalCapacity?: number;
  pollMs?: number;
  gitBinary?: string;
  minFreeBytes?: number;
  credentials?: CredentialBoundary;
  credentialsPath?: string;
  credentialRegistryPath?: string;
  credentialSocketPath?: string;
  credentialKeyPath?: string;
  authorizedRepositories?: readonly string[];
};

class PreparationError extends Error {}

class StorageError extends Error {}

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const safeRepositoryName = (repository: Pick<GitHubRepository, "owner" | "name">) => {
  if (!REPOSITORY_PART.test(repository.owner) || !REPOSITORY_PART.test(repository.name) || repository.owner === "." || repository.owner === ".." || repository.name === "." || repository.name === "..") {
    throw new PreparationError("GitHub Repository identity is invalid");
  }
  return `${repository.owner}/${repository.name}`;
};

const parseCapacity = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 64) {
    throw new Error("ATLAS_GLOBAL_CAPACITY must be a positive integer no greater than 64");
  }
  return parsed;
};

const parsePoll = (value: number | undefined) => {
  if (value === undefined) return DEFAULT_POLL_MS;
  if (!Number.isSafeInteger(value) || value < 100 || value > 60_000) {
    throw new Error("Preparation polling interval must be between 100 and 60000 milliseconds");
  }
  return value;
};

const parseMinFreeBytes = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("ATLAS_MIN_FREE_BYTES must be a positive integer");
  }
  return parsed;
};

const shellQuote = (value: string) => `'${value.replace(/'/gu, `'"'"'`)}'`;

const credentialHelperCommand = (
  bunBinary: string,
  helperPath: string,
  helperEnvironment: Record<string, string>,
) => {
  const socket = helperEnvironment.ATLAS_SUPPLIER_SOCKET;
  const keyPath = helperEnvironment.ATLAS_SUPPLIER_KEY_PATH;
  if (!socket || !keyPath) throw new PreparationError("Credential supplier paths are incomplete");
  return `!ATLAS_SUPPLIER_SOCKET=${shellQuote(socket)} ATLAS_SUPPLIER_KEY_PATH=${shellQuote(keyPath)} ${shellQuote(bunBinary)} ${shellQuote(helperPath)}`;
};

const readCommandOutput = async (stream: unknown) =>
  stream && typeof stream !== "number" ? await new Response(stream as ReadableStream<Uint8Array>).text() : "";

const run = async (
  binary: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string> },
): Promise<CommandResult> => {
  let processHandle: ReturnType<typeof Bun.spawn>;
  try {
    processHandle = Bun.spawn([binary, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new PreparationError("Required local preparation binary is unavailable");
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    readCommandOutput(processHandle.stdout),
    readCommandOutput(processHandle.stderr),
  ]);
  return { exitCode, stdout, stderr };
};

const gitEnvironment = (base: Record<string, string>, helperEnvironment: Record<string, string>) => ({
  ...Object.fromEntries(Object.entries(base).filter(([name]) => ![
    "ATLAS_SHARED_TOKEN",
    "ATLAS_GITHUB_INSTALLATION_TOKEN",
    "ATLAS_GITHUB_APP_PRIVATE_KEY",
    "ATLAS_GITHUB_APP_PRIVATE_KEY_PATH",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
  ].includes(name))),
  ...helperEnvironment,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "/bin/false",
});

const assertCommand = async (
  gitBinary: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string> },
  reason: string,
) => {
  const result = await run(gitBinary, args, options);
  if (result.exitCode !== 0) throw new PreparationError(reason);
  return result.stdout.trim();
};

const canonicalRemote = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.hostname !== "github.com") {
      throw new Error();
    }
    return `${url.hostname}${url.pathname.replace(/\/$/u, "")}`.toLocaleLowerCase("en-US");
  } catch {
    throw new PreparationError("Prepared Git remote is not a credential-free GitHub HTTPS remote");
  }
};

const preparationScope = (session: Session, repository: Repository): CredentialScope => ({
  atlasId: session.atlasId,
  directory: session.directory!,
  repositoryId: repository.githubId,
  fullName: repository.fullName,
});

export const createPreparationService = (options: PreparationOptions) => {
  const sessionRoot = resolve(options.sessionRoot ?? process.env.ATLAS_SESSION_ROOT ?? DEFAULT_SESSION_ROOT);
  if (!isAbsolute(sessionRoot) || sessionRoot === "/") throw new Error("ATLAS_SESSION_ROOT must be a safe absolute directory");
  const capacity = options.globalCapacity ?? parseCapacity(process.env.ATLAS_GLOBAL_CAPACITY, DEFAULT_CAPACITY);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) throw new Error("Global preparation capacity is invalid");
  const pollMs = parsePoll(options.pollMs);
  const minFreeBytes = options.minFreeBytes ?? parseMinFreeBytes(process.env.ATLAS_MIN_FREE_BYTES, DEFAULT_MIN_FREE_BYTES);
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes < 1) throw new Error("Minimum free Session storage must be a positive safe integer");
  const gitBinary = options.gitBinary ?? process.env.ATLAS_GIT_BINARY ?? Bun.which("git") ?? "/usr/bin/git";
  const authorized = options.authorizedRepositories
    ? new Set(options.authorizedRepositories.map((value) => value.toLocaleLowerCase("en-US")))
    : undefined;
  const credentials = options.credentials ?? createCredentialBoundary({
    credentialsPath: options.credentialsPath ?? process.env.ATLAS_GITHUB_ENV_PATH,
    registryPath: options.credentialRegistryPath ?? process.env.ATLAS_CREDENTIAL_REGISTRY_PATH,
    socketPath: options.credentialSocketPath ?? process.env.ATLAS_SUPPLIER_SOCKET,
    keyPath: options.credentialKeyPath ?? process.env.ATLAS_SUPPLIER_KEY_PATH,
    apiUrl: process.env.ATLAS_GITHUB_API_URL,
    authorizedRepositories: options.authorizedRepositories,
  });
  const helperPath = fileURLToPath(new URL("../scripts/atlas-git-credential.ts", import.meta.url));
  const bunBinary = process.execPath;
  let running = false;
  let started = false;
  let stopped = false;
  let pendingWake = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const ensureStorageReady = () => {
    try {
      mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
      const stat = lstatSync(sessionRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StorageError("Waiting for private Session storage.");
      if ((stat.mode & 0o077) !== 0) chmodSync(sessionRoot, 0o700);
      accessSync(sessionRoot, constants.R_OK | constants.W_OK | constants.X_OK);
      const filesystem = statfsSync(sessionRoot);
      const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
      if (!hasRequiredFreeSpace(availableBytes, minFreeBytes)) {
        throw new StorageError("Waiting for Session storage free space to recover.");
      }
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("Waiting for Session storage to become available.");
    }
  };

  const storageIssue = () => {
    try {
      ensureStorageReady();
      return undefined;
    } catch (error) {
      return error instanceof StorageError
        ? error.message
        : "Waiting for Session storage to become available.";
    }
  };

  const setReason = (session: Session, reason: string, block = false) => {
    try {
      if (block) options.persistence.blockQueuedPreparation(session.atlasId, reason);
      else options.persistence.setQueuedSessionReason(session.atlasId, reason);
      return true;
    } catch {
      // Persistence failure is intentionally not converted into a successful retry.
      return false;
    }
  };

  const safeBranch = (branch: string | null | undefined) => Boolean(branch && BRANCH_PATTERN.test(branch));

  const mergeRestriction = (pullRequest: PullRequest) => {
    if (pullRequest.autoMergeEnabled === true) return "The selected target has auto-merge enabled.";
    if (pullRequest.autoMergeEnabled === null) return "Waiting for GitHub verification of auto-merge state.";
    if (pullRequest.mergeQueueState === null) return "Waiting for GitHub verification of merge-queue state.";
    if (pullRequest.mergeQueueState !== "none") return "The selected target is in a GitHub merge queue.";
    return undefined;
  };

  const verifyStack = async (
    repository: Repository,
    candidate: GitHubRepository,
    stack: PrStack,
    pullRequests: PullRequest[],
  ): Promise<VerifiedTarget> => {
    const members = [...stack.members].sort((left, right) => left.position - right.position);
    if (members.length === 0) throw new PreparationError("Waiting for a verified native stack member order.");
    if (members.length >= 100) throw new PreparationError("The selected native stack has no room for another layer.");
    if (stack.open === null) throw new PreparationError("Waiting for native stack lifecycle verification.");
    if (!stack.open) throw new PreparationError("The selected native stack is no longer open for another layer.");
    if (!safeBranch(stack.trunkRef)) throw new PreparationError("Waiting for a verified native stack trunk.");

    const pullRequestMap = new Map(pullRequests.map((pullRequest) => [pullRequest.githubId, pullRequest]));
    const resolvedMembers = members.map((member) => pullRequestMap.get(member.pullRequestId));
    if (resolvedMembers.some((pullRequest) => !pullRequest)) throw new PreparationError("Waiting for complete native stack member verification.");
    const completeMembers = resolvedMembers as PullRequest[];
    if (completeMembers.some((pullRequest) => pullRequest.headRepositoryId !== repository.githubId)) {
      throw new PreparationError("The native stack contains a Pull request from another Repository.");
    }
    if (completeMembers.some((pullRequest) => pullRequest.state === "closed" && !pullRequest.mergedAt)) {
      throw new PreparationError("The native stack has a closed-unmerged layer and cannot be extended.");
    }
    if (completeMembers.every((pullRequest) => pullRequest.mergedAt)) {
      throw new PreparationError("The native stack is fully merged and cannot be extended.");
    }
    const top = completeMembers[completeMembers.length - 1]!;
    if (top.state !== "open") throw new PreparationError("The actual native stack top is not open.");
    const restriction = mergeRestriction(top);
    if (restriction) throw new PreparationError(restriction);
    if (completeMembers.some((pullRequest) => !safeBranch(pullRequest.headRef))) {
      throw new PreparationError("Waiting for safe native stack layer branches.");
    }
    if (!options.github.getBranchRef) throw new PreparationError("Waiting for native stack branch verification.");
    const memberBranches = [...new Set(completeMembers.map((pullRequest) => pullRequest.headRef))];
    const [memberRefs, trunkRef] = await Promise.all([
      Promise.all(memberBranches.map(async (branch) => [branch, await options.github.getBranchRef!(candidate, branch)] as const)),
      options.github.getBranchRef(candidate, stack.trunkRef!),
    ]);
    const refs = new Map(memberRefs);
    if (completeMembers.some((pullRequest) => {
      const ref = refs.get(pullRequest.headRef);
      return !ref || !SHA_PATTERN.test(ref.sha);
    })) throw new PreparationError("Waiting for verified native stack layer refs.");
    if (!trunkRef || !SHA_PATTERN.test(trunkRef.sha)) throw new PreparationError("Waiting for the verified native stack trunk ref.");

    return {
      repository,
      candidate,
      target: {
        kind: "native_stack",
        stackId: stack.githubId,
        stackNumber: stack.number,
      },
      resolved: {
        kind: "native_stack",
        stackId: stack.githubId,
        stackNumber: stack.number,
        parentPullRequestId: top.githubId,
        parentPullRequestNumber: top.number,
        parentPullRequestUrl: top.htmlUrl,
        parentBranch: top.headRef,
        trunkBranch: stack.trunkRef!,
        layers: completeMembers.map((pullRequest) => ({
          pullRequestId: pullRequest.githubId,
          pullRequestNumber: pullRequest.number,
          branch: pullRequest.headRef,
          sha: refs.get(pullRequest.headRef)!.sha,
        })),
      },
      sha: refs.get(top.headRef)!.sha,
    };
  };

  const verifyTarget = async (session: Session): Promise<VerifiedTarget> => {
    const existing = options.persistence.getRepository(session.repositoryId);
    if (!existing) throw new PreparationError("Waiting for Repository verification.");
    if (authorized && !authorized.has(existing.fullName.toLocaleLowerCase("en-US"))) {
      throw new PreparationError("Waiting: this Repository is outside the authorized preparation scope.");
    }
    if (!options.github.getBranchRef) throw new PreparationError("Waiting for GitHub branch verification.");

    const refreshed = await options.refreshRepository(existing);
    if (!refreshed.ok) throw new PreparationError("Waiting for current GitHub access and Spec verification.");
    const repositories = await options.github.listInstallationRepositories();
    const candidate = repositories.find((repository) => repository.id === session.repositoryId);
    if (!candidate || candidate.owner.toLocaleLowerCase("en-US") !== existing.organization.toLocaleLowerCase("en-US")) {
      throw new PreparationError("Waiting: GitHub access to this Repository could not be verified.");
    }
    const fullName = safeRepositoryName(candidate);
    if (authorized && !authorized.has(fullName.toLocaleLowerCase("en-US"))) {
      throw new PreparationError("Waiting: this Repository is outside the authorized preparation scope.");
    }
    if (!candidate.defaultBranch || !safeBranch(candidate.defaultBranch)) throw new PreparationError("Waiting for a safe default-branch name.");
    if (candidate.archived || candidate.disabled || !candidate.hasIssues) {
      throw new PreparationError("Waiting: this Repository is not eligible for preparation.");
    }
    const spec = options.persistence.getSpec(session.repositoryId, session.specIssueNumber);
    if (!spec || !spec.isCurrent || spec.state !== "open" || !spec.hasSpecLabel || spec.isPullRequest) {
      throw new PreparationError("Waiting for the Spec to be open and labelled exactly `spec`.");
    }
    if (session.targetKind === "default" && session.targetBranch !== candidate.defaultBranch) {
      throw new PreparationError("Waiting for explicit default-branch reconfirmation.");
    }

    if (session.targetKind !== "default") {
      if (!options.refreshPullRequests) throw new PreparationError("Waiting for current Pull request and native stack verification.");
      const pullRequestRefresh = await options.refreshPullRequests(existing);
      if (!pullRequestRefresh.ok) throw new PreparationError("Waiting for current Pull request and native stack verification.");
      const pullRequests = options.persistence.listPullRequests(session.repositoryId);
      const stacks = options.persistence.listPrStacks(session.repositoryId);

      if (session.targetKind === "native_stack") {
        const stack = stacks.find((candidateStack) => candidateStack.githubId === session.targetStackId);
        if (!stack) throw new PreparationError("Waiting for explicit target reconfirmation; the selected native stack no longer exists.");
        return verifyStack(pullRequestRefresh.repository, candidate, stack, pullRequests);
      }

      const parent = pullRequests.find((pullRequest) => pullRequest.githubId === session.targetParentPullRequestId);
      if (!parent) throw new PreparationError("Waiting for explicit target reconfirmation; the selected parent Pull request no longer exists.");
      if (parent.stack) {
        const stack = stacks.find((candidateStack) => candidateStack.githubId === parent.stack?.stackId);
        if (!stack) throw new PreparationError("Waiting for native stack verification after the selected parent changed structure.");
        return verifyStack(pullRequestRefresh.repository, candidate, stack, pullRequests);
      }
      if (parent.state !== "open") throw new PreparationError("The selected standalone parent is no longer open.");
      if (parent.headRepositoryId !== existing.githubId) throw new PreparationError("The selected parent Pull request belongs to another Repository.");
      if (parent.baseRef !== candidate.defaultBranch) throw new PreparationError("The selected standalone parent no longer targets the default branch.");
      const restriction = mergeRestriction(parent);
      if (restriction) throw new PreparationError(restriction);
      if (!safeBranch(parent.headRef)) throw new PreparationError("Waiting for a safe standalone parent branch.");
      const ref = await options.github.getBranchRef(candidate, parent.headRef);
      if (!ref || !SHA_PATTERN.test(ref.sha)) throw new PreparationError("Waiting for the verified standalone parent ref.");
      return {
        repository: pullRequestRefresh.repository,
        candidate,
        target: {
          kind: "standalone_parent",
          parentPullRequestId: parent.githubId,
          parentPullRequestNumber: parent.number,
        },
        resolved: {
          kind: "standalone_parent",
          stackId: null,
          stackNumber: null,
          parentPullRequestId: parent.githubId,
          parentPullRequestNumber: parent.number,
          parentPullRequestUrl: parent.htmlUrl,
          parentBranch: parent.headRef,
          trunkBranch: candidate.defaultBranch,
          layers: [{
            pullRequestId: parent.githubId,
            pullRequestNumber: parent.number,
            branch: parent.headRef,
            sha: ref.sha,
          }],
        },
        sha: ref.sha,
      };
    }

    const ref = await options.github.getBranchRef(candidate, candidate.defaultBranch);
    if (!ref || !SHA_PATTERN.test(ref.sha)) throw new PreparationError("Waiting for a verified default-branch commit.");
    return {
      repository: refreshed.repository,
      candidate,
      target: { kind: "default" },
      resolved: {
        kind: "default",
        stackId: null,
        stackNumber: null,
        parentPullRequestId: null,
        parentPullRequestNumber: null,
        parentPullRequestUrl: null,
        parentBranch: candidate.defaultBranch,
        trunkBranch: candidate.defaultBranch,
        layers: [],
      },
      sha: ref.sha,
    };
  };

  const intentFor = (session: Session, verified: VerifiedTarget): PreparationIntent => ({
    directory: join(sessionRoot, session.atlasId),
    baseBranch: verified.resolved.parentBranch,
    baseSha: verified.sha,
    workingBranch: `atlas/${session.atlasId}`,
    target: verified.target,
    resolvedTarget: verified.resolved,
  });

  const checkpoint = (atlasId: string, value: Parameters<Persistence["setPreparationCheckpoint"]>[1], reason: string, stateReason = reason) => {
    try {
      return options.persistence.setPreparationCheckpoint(atlasId, value, reason, stateReason);
    } catch {
      return undefined;
    }
  };

  const failSetup = (atlasId: string, reason: string) => {
    try {
      options.persistence.failPreparation(atlasId, reason);
    } catch {
      // Keep the held Preparing row if the durable release itself is uncertain.
    }
  };

  const pauseHeld = (session: Session, reason: string) => {
    const current = options.persistence.getSession(session.atlasId) ?? session;
    if (current.state !== "preparing" || current.preparationCheckpoint === "prepared") return;
    checkpoint(current.atlasId, current.preparationCheckpoint, reason, reason);
  };

  const requeueBeforeClone = (session: Session, reason: string) => {
    try {
      const current = options.persistence.requeuePreparation(session.atlasId, reason);
      if (current?.state === "queued") return;
    } catch {
      // Keep the held intent when the durable release is uncertain.
    }
    pauseHeld(session, reason);
  };

  const finishBranch = async (session: Session, repository: Repository) => {
    if (!session.directory || !session.baseSha || !session.workingBranch || !session.baseBranch) {
      checkpoint(session.atlasId, "start_unconfirmed", "Preparation intent is incomplete; manual recovery is required.", "Start unconfirmed; preparation intent is incomplete.");
      return;
    }
    if (!existsSync(session.directory)) {
      checkpoint(session.atlasId, "start_unconfirmed", "The prepared clone is missing; Atlas will not recreate uncertain resources.", "Start unconfirmed; the expected clone is missing.");
      return;
    }
    try {
      const stat = lstatSync(session.directory);
      if (!stat.isDirectory()) throw new PreparationError("Session directory is not a directory");
      if ((stat.mode & 0o077) !== 0) throw new PreparationError("Session directory permissions are not private");
      const helperEnvironment = credentials.helperEnvironment();
      const env = gitEnvironment(process.env as Record<string, string>, helperEnvironment);
      const remote = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "remote", "get-url", "origin"], { env }, "Prepared Git remote could not be read.");
      const expectedRemote = `github.com/${repository.fullName}.git`.toLocaleLowerCase("en-US");
      if (canonicalRemote(remote) !== expectedRemote) throw new PreparationError("Prepared Git remote is outside the registered Repository");
      const helperConfig = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "config", "--local", "--get-all", "credential.helper"], { env }, "Clone-local credential routing could not be verified.");
      if (!helperConfig.includes("atlas-git-credential")) throw new PreparationError("Clone-local credential routing is not Atlas-managed");
      const shallow = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", "--is-shallow-repository"], { env }, "Prepared clone completeness could not be verified.");
      if (shallow !== "false") throw new PreparationError("The Session clone is shallow; Atlas requires a full clone.");
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", `refs/remotes/origin/${session.baseBranch}^{commit}`], { env }, "The selected parent ref could not be verified in the clone.");
      const trunkBranch = session.resolvedTrunkBranch ?? session.baseBranch;
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", `refs/remotes/origin/${trunkBranch}^{commit}`], { env }, "The intended stack trunk ref could not be verified in the clone.");
      const resolvedSha = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", `${session.baseSha}^{commit}`], { env }, "The verified preparation SHA is missing from the clone.");
      if (resolvedSha.toLocaleLowerCase("en-US") !== session.baseSha.toLocaleLowerCase("en-US")) throw new PreparationError("The verified preparation SHA could not be resolved in the clone.");

      if (!checkpoint(session.atlasId, "branch_started", "Unique local working branch creation is starting.", "Full clone verified; creating the unique local branch.")) return;
      const branchResult = await run(options.gitBinary ?? gitBinary, ["-C", session.directory, "checkout", "--no-track", "-b", session.workingBranch, session.baseSha], { env });
      if (branchResult.exitCode !== 0) throw new PreparationError("The unique local working branch could not be created.");
      const upstreamResult = await run(options.gitBinary ?? gitBinary, ["-C", session.directory, "branch", "--set-upstream-to", `origin/${session.baseBranch}`, session.workingBranch], { env });
      if (upstreamResult.exitCode !== 0) throw new PreparationError("The local working branch could not be tracked safely.");
      const currentBranch = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "branch", "--show-current"], { env }, "The local working branch could not be verified.");
      const currentSha = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", "HEAD"], { env }, "The local working branch tip could not be verified.");
      const upstream = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { env }, "The local working branch tracking could not be verified.");
      if (currentBranch !== session.workingBranch || currentSha.toLocaleLowerCase("en-US") !== session.baseSha.toLocaleLowerCase("en-US") || upstream !== `origin/${session.baseBranch}`) {
        throw new PreparationError("The local working branch identity could not be verified.");
      }
      if (session.targetKind !== "default") {
        writeFileSync(
          join(session.directory, ".git", "atlas-stack.json"),
          JSON.stringify({
            version: 1,
            trunk: trunkBranch,
            layers: session.resolvedLayers,
            child: { branch: session.workingBranch, base: session.baseSha },
          }, null, 2) + "\n",
          { mode: 0o600 },
        );
      }
      checkpoint(session.atlasId, "prepared", "Full clone and unique local working branch are ready; OpenCode handoff has not started.");
    } catch (error) {
      const reason = error instanceof StorageError ? error.message : storageIssue();
      if (reason) pauseHeld(session, reason);
      else if (error instanceof PreparationError) failSetup(session.atlasId, error.message);
      else checkpoint(session.atlasId, "start_unconfirmed", "Local preparation stopped after an uncertain filesystem operation.", "Start unconfirmed; inspect the preserved local resources.");
    }
  };

  const prepareClaimed = async (session: Session, repository: Repository, candidate: GitHubRepository) => {
    if (!session.directory || !session.baseSha || !session.workingBranch) {
      failSetup(session.atlasId, "Preparation intent was incomplete before local work.");
      return;
    }
    const scope = preparationScope(session, repository);
    try {
      await credentials.start();
      credentials.registerScope(scope);
      await credentials.assertReady(scope);
    } catch (error) {
      requeueBeforeClone(session, "Waiting for the GitHub credential supplier or required Repository-scoped credentials; preparation is paused.");
      return;
    }

    try {
      ensureStorageReady();
      if (existsSync(session.directory)) {
        const stat = lstatSync(session.directory);
        if (!stat.isDirectory() || readdirSync(session.directory).length > 0) throw new PreparationError("The unique Session directory already exists and is not empty.");
      }
    } catch (error) {
      if (error instanceof PreparationError) failSetup(session.atlasId, error.message);
      else requeueBeforeClone(session, error instanceof StorageError ? error.message : "Waiting for Session storage to become available.");
      return;
    }

    if (!checkpoint(session.atlasId, "clone_started", "Authenticated full clone is starting; no remote write is performed.", "Preparing an authenticated full clone.")) return;
    try {
      const ownerName = safeRepositoryName(candidate);
      const remote = `https://github.com/${ownerName}.git`;
      const helper = `!${shellQuote(bunBinary)} ${shellQuote(helperPath)}`;
      const durableHelper = credentialHelperCommand(bunBinary, helperPath, credentials.helperEnvironment());
      const env = gitEnvironment(process.env as Record<string, string>, credentials.helperEnvironment());
      const clone = await run(options.gitBinary ?? gitBinary, [
        "-c", "credential.helper=",
        "-c", `credential.helper=${helper}`,
        "-c", "credential.useHttpPath=true",
        "clone", "--no-checkout", "--origin", "origin", remote, session.directory,
      ], { cwd: sessionRoot, env });
      if (clone.exitCode !== 0) throw new PreparationError("Authenticated full clone failed; the partial clone was retained.");
      chmodSync(session.directory, 0o700);

      const remoteValue = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "remote", "get-url", "origin"], { env }, "Cloned Git remote could not be verified.");
      if (canonicalRemote(remoteValue) !== `github.com/${ownerName}.git`.toLocaleLowerCase("en-US")) throw new PreparationError("Cloned Git remote is outside the registered Repository.");
      await run(options.gitBinary ?? gitBinary, ["-C", session.directory, "config", "--local", "--unset-all", "credential.helper"], { env });
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "config", "--local", "credential.helper", ""], { env }, "Clone-local credential fallback could not be reset.");
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "config", "--local", "--add", "credential.helper", durableHelper], { env }, "Clone-local credential helper could not be installed.");
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "config", "--local", "credential.useHttpPath", "true"], { env }, "Clone-local credential path scoping could not be enabled.");
      const shallow = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", "--is-shallow-repository"], { env }, "Clone completeness could not be verified.");
      if (shallow !== "false") throw new PreparationError("Git returned a shallow clone; Atlas requires a full clone.");
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", `refs/remotes/origin/${session.baseBranch}^{commit}`], { env }, "The selected parent ref is missing from the clone.");
      const trunkBranch = session.resolvedTrunkBranch ?? session.baseBranch;
      await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", `refs/remotes/origin/${trunkBranch}^{commit}`], { env }, "The intended stack trunk ref is missing from the clone.");
      const resolvedSha = await assertCommand(options.gitBinary ?? gitBinary, ["-C", session.directory, "rev-parse", `${session.baseSha}^{commit}`], { env }, "The verified default tip is missing from the clone.");
      if (resolvedSha.toLocaleLowerCase("en-US") !== session.baseSha.toLocaleLowerCase("en-US")) throw new PreparationError("The cloned parent tip differs from the verified preparation SHA.");
      if (!checkpoint(session.atlasId, "clone_complete", "Full clone completed and matches the verified preparation SHA.", "Full clone ready; local branch creation is next.")) return;
      await finishBranch(session = options.persistence.getSession(session.atlasId)!, repository);
    } catch (error) {
      const reason = error instanceof StorageError ? error.message : storageIssue();
      if (reason) pauseHeld(session, reason);
      else if (error instanceof PreparationError) failSetup(session.atlasId, error.message);
      else checkpoint(session.atlasId, "start_unconfirmed", "Local clone operation became uncertain; the partial clone was retained.", "Start unconfirmed; inspect the preserved clone before recovery.");
    }
  };

  const resumePreparing = async () => {
    for (const session of options.persistence.listPreparingSessions()) {
      if (session.preparationCheckpoint === "prepared" || session.preparationCheckpoint === "start_unconfirmed") continue;
      const repository = options.persistence.getRepository(session.repositoryId);
      if (!repository) continue;
      if (session.preparationCheckpoint === "clone_complete") {
        await finishBranch(session, repository);
        return true;
      }
      checkpoint(session.atlasId, "start_unconfirmed", "Preparation stopped before a proven safe next step; Atlas will not replay local work.", "Start unconfirmed; manual recovery is required before continuing.");
    }
    return false;
  };

  const prepareNext = async () => {
    const preparing = options.persistence.listPreparingSessions();
    const queued = options.persistence.listQueuedSessions();
    if (preparing.length === 0 && queued.length === 0) return;

    const storageReason = storageIssue();
    if (storageReason) {
      const unresolved = preparing.find((session) => session.preparationCheckpoint !== "prepared" && session.preparationCheckpoint !== "start_unconfirmed");
      if (unresolved) pauseHeld(unresolved, storageReason);
      else if (queued[0]) setReason(queued[0], storageReason);
      return;
    }

    if (await resumePreparing()) return;
    for (const session of queued) {
      let target: Awaited<ReturnType<typeof verifyTarget>>;
      try {
        target = await verifyTarget(session);
      } catch (error) {
        if (!setReason(session, error instanceof PreparationError ? error.message : "Waiting for safe GitHub verification.", true)) return;
        continue;
      }
      const intent = intentFor(session, target);
      let claimed: Session | undefined;
      try {
        claimed = options.persistence.claimPreparation(session.atlasId, intent, capacity, true);
      } catch {
        return;
      }
      if (!claimed) continue;
      await prepareClaimed(claimed, target.repository, target.candidate);
      return;
    }
  };

  const wake = () => {
    if (stopped || running) return;
    running = true;
    void prepareNext().catch(() => undefined).finally(() => {
      running = false;
      if (!stopped) {
        if (pendingWake) {
          pendingWake = false;
          queueMicrotask(wake);
          return;
        }
        timer = setTimeout(wake, pollMs);
        timer.unref?.();
      }
    });
  };

  const start = () => {
    if (started) return;
    started = true;
    stopped = false;
    wake();
  };

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    credentials.close();
  };

  const enqueue = () => {
    if (running) {
      pendingWake = true;
      return;
    }
    wake();
  };

  return {
    start,
    stop,
    enqueue,
    prepareNext,
    credentials,
    sessionRoot,
    capacity,
  };
};

export type PreparationService = ReturnType<typeof createPreparationService>;
