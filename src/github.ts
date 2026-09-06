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

  const request = async (pathOrUrl: string) => {
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
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": apiVersion,
          "User-Agent": "Atlas",
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
  };
};
