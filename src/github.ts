const DEFAULT_API_VERSION = "2026-03-10";
const PAGE_SIZE = 100;
const MAX_PAGES = 10_000;

export type GitHubRepository = {
  id: string;
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
};

export type GitHubIssue = {
  id: string;
  number: string;
  title: string;
  body: string;
  htmlUrl: string;
  state: string;
  labels: string[];
  isPullRequest: boolean;
  updatedAt: string | null;
};

export type GitHubPullRequest = {
  id: string;
  number: string;
  title: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  mergedAt: string | null;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  mergeableState: string | null;
  autoMergeEnabled: boolean | null;
  mergeQueueState: string | null;
  updatedAt: string | null;
};

export type GitHubStack = {
  id: string;
  nodeId: string | null;
  number: string;
  trunkRef: string | null;
  open: boolean | null;
  pullRequests: Array<{
    number: string;
    position: number;
  }>;
};

export type GitHubRef = {
  sha: string;
};

export class GitHubError extends Error {
  readonly status: number | undefined;
  readonly kind: "configuration" | "access" | "suspended" | "not-found" | "temporary" | "invalid";

  constructor(
    message: string,
    options: {
      status?: number;
      kind: GitHubError["kind"];
    },
  ) {
    super(message);
    this.name = "GitHubError";
    this.status = options.status;
    this.kind = options.kind;
  }
}

export type GitHubClient = {
  listInstallationRepositories: () => Promise<GitHubRepository[]>;
  hasLabel: (repository: GitHubRepository, labelName: string) => Promise<boolean>;
  listIssues: (repository: GitHubRepository) => Promise<GitHubIssue[]>;
  listPullRequests?: (repository: GitHubRepository) => Promise<GitHubPullRequest[]>;
  listStacks?: (repository: GitHubRepository) => Promise<GitHubStack[]>;
  getBranchRef?: (repository: GitHubRepository, branch: string) => Promise<GitHubRef | null>;
};

export type GitHubClientOptions = {
  organization: string;
  installationId: string;
  getToken: () => string | undefined;
  baseUrl?: string;
  apiVersion?: string;
  fetcher?: typeof fetch;
};

const object = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubError(`GitHub returned an invalid ${field}`, { kind: "invalid" });
  }
  return value as Record<string, unknown>;
};

const string = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new GitHubError(`GitHub returned an invalid ${field}`, { kind: "invalid" });
  }
  return value;
};

const nullableString = (value: unknown, field: string): string | null =>
  value === null || value === undefined ? null : string(value, field);

const boolean = (value: unknown, field: string) => {
  if (typeof value !== "boolean") {
    throw new GitHubError(`GitHub returned an invalid ${field}`, { kind: "invalid" });
  }
  return value;
};

const losslessInteger = (value: unknown, field: string) => {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new GitHubError(`GitHub returned an invalid ${field}`, { kind: "invalid" });
};

const issueNumber = (value: unknown) => {
  const number = losslessInteger(value, "issue number");
  if (number === "0") {
    throw new GitHubError("GitHub returned an invalid issue number", { kind: "invalid" });
  }
  return number;
};

const parseLabels = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new GitHubError("GitHub returned invalid issue labels", { kind: "invalid" });
  }

  return value.map((label) => {
    if (typeof label === "string") return label;
    return string(object(label, "issue label").name, "issue label name");
  });
};

const parseRepository = (value: unknown): GitHubRepository => {
  const item = object(value, "repository");
  const owner = object(item.owner, "repository owner");
  const id = losslessInteger(item.id, "repository id");
  const ownerLogin = string(owner.login, "repository owner login");
  const name = string(item.name, "repository name");
  const fullName = string(item.full_name, "repository full name");
  const htmlUrl = string(item.html_url, "repository URL");

  return {
    id,
    owner: ownerLogin,
    name,
    fullName,
    htmlUrl,
    description: nullableString(item.description, "repository description"),
    visibility: nullableString(item.visibility, "repository visibility"),
    defaultBranch: nullableString(item.default_branch, "repository default branch"),
    archived: boolean(item.archived, "repository archived state"),
    disabled: boolean(item.disabled, "repository disabled state"),
    hasIssues: boolean(item.has_issues, "repository Issues state"),
  };
};

const parseIssue = (value: unknown): GitHubIssue => {
  const item = object(value, "issue");
  return {
    id: losslessInteger(item.id, "issue id"),
    number: issueNumber(item.number),
    title: string(item.title, "issue title"),
    body: nullableString(item.body, "issue body") ?? "",
    htmlUrl: string(item.html_url, "issue URL"),
    state: string(item.state, "issue state"),
    labels: parseLabels(item.labels),
    isPullRequest: item.pull_request !== undefined,
    updatedAt: nullableString(item.updated_at, "issue updated time"),
  };
};

const optionalBoolean = (value: unknown, field: string): boolean | null => {
  if (value === null || value === undefined) return null;
  return boolean(value, field);
};

const parsePullRequest = (value: unknown): GitHubPullRequest => {
  const item = object(value, "pull request");
  const head = object(item.head, "pull request head");
  const base = object(item.base, "pull request base");
  const autoMerge = item.auto_merge;
  const mergeQueue = item.merge_queue_entry ?? item.merge_queue;

  return {
    id: losslessInteger(item.id, "pull request id"),
    number: issueNumber(item.number),
    title: string(item.title, "pull request title"),
    htmlUrl: string(item.html_url, "pull request URL"),
    state: string(item.state, "pull request state"),
    draft: boolean(item.draft, "pull request draft state"),
    mergedAt: nullableString(item.merged_at, "pull request merge time"),
    headRef: string(head.ref, "pull request head ref"),
    headSha: string(head.sha, "pull request head SHA"),
    baseRef: string(base.ref, "pull request base ref"),
    baseSha: string(base.sha, "pull request base SHA"),
    mergeableState: nullableString(item.mergeable_state, "pull request mergeable state"),
    autoMergeEnabled: autoMerge === undefined ? null : autoMerge !== null,
    mergeQueueState: mergeQueue === undefined
      ? null
      : mergeQueue === null
        ? "none"
        : typeof mergeQueue === "object" && !Array.isArray(mergeQueue) && typeof (mergeQueue as Record<string, unknown>).state === "string"
          ? (mergeQueue as Record<string, unknown>).state as string
          : "queued",
    updatedAt: nullableString(item.updated_at, "pull request updated time"),
  };
};

const parseStack = (value: unknown): GitHubStack => {
  const item = object(value, "native stack");
  const base = item.base && typeof item.base === "object" && !Array.isArray(item.base)
    ? item.base as Record<string, unknown>
    : undefined;
  const members = item.pull_requests;
  if (!Array.isArray(members)) {
    throw new GitHubError("GitHub returned an invalid native stack member list", { kind: "invalid" });
  }

  return {
    id: losslessInteger(item.id, "native stack id"),
    nodeId: nullableString(item.node_id, "native stack node ID"),
    number: losslessInteger(item.number, "native stack number"),
    trunkRef: nullableString(item.base_ref ?? base?.ref, "native stack trunk ref"),
    open: optionalBoolean(item.open, "native stack open state"),
    pullRequests: members.map((member, index) => {
      const parsed = object(member, "native stack member");
      const position = parsed.position === undefined ? index + 1 : Number(parsed.position);
      if (!Number.isSafeInteger(position) || position < 1) {
        throw new GitHubError("GitHub returned an invalid native stack member position", { kind: "invalid" });
      }
      return {
        number: issueNumber(parsed.number),
        position,
      };
    }).sort((left, right) => left.position - right.position),
  };
};

const nextLink = (header: string | null) => {
  for (const value of header?.split(",") ?? []) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="?([^";]+)"?/i.exec(value);
    if (match?.[2].split(" ").includes("next")) return match[1];
  }
  return undefined;
};

const nextPageUrl = (url: string) => {
  const next = new URL(url);
  const page = Number(next.searchParams.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1) return undefined;
  next.searchParams.set("page", String(page + 1));
  return next.toString();
};

const isTemporaryStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

export const createGitHubClient = (options: GitHubClientOptions): GitHubClient => {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;

  const request = async (pathOrUrl: string, init: Pick<RequestInit, "method" | "body"> = {}) => {
    const token = options.getToken();
    if (!token) {
      throw new GitHubError("GitHub App credentials are not configured", { kind: "configuration" });
    }
    if (!options.organization || !options.installationId) {
      throw new GitHubError("GitHub App organization or installation is not configured", { kind: "configuration" });
    }

    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    try {
      if (new URL(url).origin !== new URL(baseUrl).origin) {
        throw new GitHubError("GitHub returned an unsafe pagination URL", { kind: "invalid" });
      }
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError("GitHub returned an invalid request URL", { kind: "invalid" });
    }
    let response: Response;
    try {
      response = await fetcher(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": apiVersion,
          "User-Agent": "Atlas",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        redirect: "manual",
      });
    } catch {
      throw new GitHubError("GitHub could not be reached", { kind: "temporary" });
    }

    if (!response.ok) {
      const status = response.status;
      let errorMessage = "";
      try {
        const payload = JSON.parse(await response.text()) as unknown;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const message = (payload as Record<string, unknown>).message;
          if (typeof message === "string") errorMessage = message;
        }
      } catch {
        // The status still gives us a safe access/temporary classification.
      }
      const kind = status === 401 || status === 403
        ? /suspend/i.test(errorMessage) ? "suspended" : "access"
        : status === 404
          ? "not-found"
          : isTemporaryStatus(status)
            ? "temporary"
            : "invalid";
      throw new GitHubError(`GitHub request failed with status ${status}`, { status, kind });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await response.text()) as unknown;
    } catch {
      throw new GitHubError("GitHub returned invalid JSON", { status: response.status, kind: "invalid" });
    }

    return { payload, next: nextLink(response.headers.get("Link")) };
  };

  const paginated = async <T>(path: string, parse: (value: unknown) => T[]) => {
    const results: T[] = [];
    let next: string | undefined = `${baseUrl}${path}`;
    let pages = 0;

    while (next) {
      pages += 1;
      if (pages > MAX_PAGES) {
        throw new GitHubError("GitHub pagination did not finish", { kind: "invalid" });
      }

      const page = await request(next);
      const values = parse(page.payload);
      results.push(...values);
      next = page.next ?? (values.length === PAGE_SIZE ? nextPageUrl(next) : undefined);
    }

    return results;
  };

  const repositoryPath = (repository: GitHubRepository, suffix: string) =>
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}${suffix}`;

  const getPullRequest = async (repository: GitHubRepository, number: string) => {
    const response = await request(repositoryPath(repository, `/pulls/${encodeURIComponent(number)}`));
    return parsePullRequest(response.payload);
  };

  const getPullRequestMergeState = async (repository: GitHubRepository, number: string) => {
    const response = await request("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){autoMergeRequest{mergeMethod} mergeQueueEntry{state}}}}`,
        variables: {
          owner: repository.owner,
          name: repository.name,
          number: Number(number),
        },
      }),
    });
    const payload = object(response.payload, "GraphQL response");
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new GitHubError("GitHub returned an invalid Pull request merge state", { kind: "invalid" });
    }
    const data = object(payload.data, "GraphQL data");
    const repositoryData = object(data.repository, "GraphQL repository");
    const pullRequest = object(repositoryData.pullRequest, "GraphQL Pull request");
    const autoMerge = pullRequest.autoMergeRequest;
    const mergeQueue = pullRequest.mergeQueueEntry;
    return {
      autoMergeEnabled: autoMerge === null ? false : autoMerge !== undefined,
      mergeQueueState: mergeQueue === null ? "none" : mergeQueue === undefined ? null : "queued",
    };
  };

  return {
    listInstallationRepositories: () => paginated(
      `/installation/repositories?per_page=${PAGE_SIZE}&page=1`,
      (payload) => {
        const response = object(payload, "installation repository response");
        if (!Array.isArray(response.repositories)) {
          throw new GitHubError("GitHub returned an invalid repository inventory", { kind: "invalid" });
        }
        return response.repositories.map(parseRepository);
      },
    ),

    hasLabel: async (repository, labelName) => {
      try {
        const response = await request(repositoryPath(repository, `/labels/${encodeURIComponent(labelName)}`));
        const label = object(response.payload, "repository label");
        return label.name === labelName;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return false;
        throw error;
      }
    },

    listIssues: (repository) => paginated(
      `${repositoryPath(repository, "/issues")}?state=all&per_page=${PAGE_SIZE}&page=1`,
      (payload) => {
        if (!Array.isArray(payload)) {
          throw new GitHubError("GitHub returned an invalid issue list", { kind: "invalid" });
        }
        return payload.map(parseIssue);
      },
    ),

    listPullRequests: async (repository) => {
      const summaries = await paginated(
        `${repositoryPath(repository, "/pulls")}?state=all&per_page=${PAGE_SIZE}&page=1`,
        (payload) => {
          if (!Array.isArray(payload)) {
            throw new GitHubError("GitHub returned an invalid pull request list", { kind: "invalid" });
          }
          return payload.map((item) => {
            const parsed = object(item, "pull request");
            return issueNumber(parsed.number);
          });
        },
      );
      const pullRequests: GitHubPullRequest[] = [];
      for (const number of summaries) {
        const pullRequest = await getPullRequest(repository, number);
        const mergeState = pullRequest.state === "open"
          ? await getPullRequestMergeState(repository, number)
          : undefined;
        pullRequests.push(mergeState ? { ...pullRequest, ...mergeState } : pullRequest);
      }
      return pullRequests;
    },

    listStacks: async (repository) => {
      const summaries = await paginated(
        `${repositoryPath(repository, "/stacks")}?per_page=${PAGE_SIZE}&page=1`,
        (payload) => {
          if (!Array.isArray(payload)) {
            throw new GitHubError("GitHub returned an invalid native stack inventory", { kind: "invalid" });
          }
          return payload.map((item) => {
            const parsed = object(item, "native stack");
            return losslessInteger(parsed.number, "native stack number");
          });
        },
      );
      const stacks: GitHubStack[] = [];
      for (const number of summaries) {
        const response = await request(repositoryPath(repository, `/stacks/${encodeURIComponent(number)}`));
        stacks.push(parseStack(response.payload));
      }
      return stacks;
    },

    getBranchRef: async (repository, branch) => {
      try {
        const response = await request(repositoryPath(repository, `/git/ref/heads/${encodeURIComponent(branch)}`));
        const item = object(response.payload, "branch ref");
        const objectValue = object(item.object, "branch ref object");
        return { sha: string(objectValue.sha, "branch ref SHA") };
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
      }
    },
  };
};
