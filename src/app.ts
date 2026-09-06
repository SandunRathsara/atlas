import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createAuth,
  safeReturnTo,
  type AuthEnv,
} from "./auth.ts";
import {
  createGitHubClient,
  GitHubError,
  type GitHubClient,
  type GitHubIssue,
  type GitHubRepository,
} from "./github.ts";
import {
  createPersistence,
  type Persistence,
  type Repository,
} from "./persistence.ts";
import {
  renderAddRepositoryPage,
  renderLoginForm,
  renderLoginPage,
  renderRepositoriesPage,
  renderSpecDetailPage,
  renderSpecUnavailablePage,
  renderSpecsPage,
} from "./views.ts";

const MAX_FORM_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 8 * 1024;
const repositoryIdPattern = /^[1-9]\d{0,19}$/;
const issueNumberPattern = /^[1-9]\d{0,9}$/;

export type AppOptions = {
  allowedOrigin?: string;
  databasePath?: string;
  getSharedToken?: () => string | undefined;
  github?: GitHubClient;
  githubApiUrl?: string;
  githubInstallationId?: string;
  githubOrganization?: string;
  githubToken?: () => string | undefined;
  now?: () => number;
  persistence?: Persistence;
  sharedToken?: string;
};

const isHtmx = (c: { req: { header: (name: string) => string | undefined } }) =>
  c.req.header("HX-Request") === "true";

const stringField = (value: unknown) => (typeof value === "string" ? value : undefined);

const tooLarge = (contentLength: string | undefined) => {
  if (!contentLength) return false;
  const length = Number(contentLength);
  return !Number.isSafeInteger(length) || length < 0 || length > MAX_FORM_BYTES;
};

class FormBodyTooLarge extends Error {}

const parseForm = async (request: Request): Promise<Record<string, unknown>> => {
  if (tooLarge(request.headers.get("Content-Length") ?? undefined)) {
    throw new FormBodyTooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) return Object.create(null) as Record<string, unknown>;

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > MAX_FORM_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FormBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (body.byteLength === 0) return Object.create(null) as Record<string, unknown>;

  const formData = await new Request(request, { body }).formData();
  const form: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of formData.entries()) {
    const existing = form[key];
    form[key] = existing === undefined
      ? value
      : Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
  }
  return form;
};

const setPrivateHtmlHeaders = (c: { header: (name: string, value: string) => void }) => {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "HX-Request");
};

const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
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

const githubFailureMessage = (error: unknown) => {
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

type SyncResult = {
  ok: boolean;
  repository: Repository;
};

export const createApp = (options: AppOptions) => {
  const auth = createAuth(options);
  const persistence = options.persistence ?? createPersistence({
    path: options.databasePath ?? ":memory:",
    now: options.now,
  });
  const organization = options.githubOrganization ?? Bun.env.ATLAS_GITHUB_ORGANIZATION ?? "";
  const installationId = options.githubInstallationId ?? Bun.env.ATLAS_GITHUB_INSTALLATION_ID ?? "";
  const github = options.github ?? createGitHubClient({
    organization,
    installationId,
    getToken: options.githubToken ?? (() => Bun.env.ATLAS_GITHUB_INSTALLATION_TOKEN),
    baseUrl: options.githubApiUrl ?? Bun.env.ATLAS_GITHUB_API_URL,
  });
  const app = new Hono<AuthEnv>();

  const now = options.now ?? Date.now;

  const saveSpecs = async (repository: Repository, githubRepository: GitHubRepository) => {
    if (!githubRepository.hasIssues) {
      persistence.replaceSpecs(
        repository.githubId,
        [],
        undefined,
        "GitHub Issues are disabled for this Repository; no Specs can be listed.",
      );
      return;
    }

    const issues = await github.listIssues(githubRepository);
    const hasLabel = await github.hasLabel(githubRepository, "spec");
    if (!hasLabel) {
      persistence.replaceSpecs(
        repository.githubId,
        [],
        undefined,
        "No exact `spec` label exists in this Repository. Atlas does not create labels.",
      );
      return;
    }

    const observedAt = new Date(now()).toISOString();
    persistence.replaceSpecs(
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
    );
  };

  const saveCandidate = async (candidate: GitHubRepository) => {
    const repository = persistence.upsertRepository(repositoryInput(candidate, organization, installationId));
    persistence.markRefreshSuccess(repository.githubId, "access");
    try {
      await saveSpecs(repository, candidate);
      return { ok: true, repository } satisfies SyncResult;
    } catch (error) {
      const reason = githubFailureMessage(error);
      if (error instanceof GitHubError && (error.kind === "access" || error.kind === "not-found" || error.kind === "suspended")) {
        persistence.updateAccess(
          repository.githubId,
          error.kind === "suspended" ? "suspended" : "unknown",
          reason,
        );
      }
      persistence.markRefreshFailure(repository.githubId, "specs", reason);
      return { ok: false, repository: persistence.getRepository(repository.githubId)! } satisfies SyncResult;
    }
  };

  const refreshRepository = async (existing: Repository): Promise<SyncResult> => {
    let inventory: GitHubRepository[];
    try {
      inventory = await github.listInstallationRepositories();
    } catch (error) {
      const reason = githubFailureMessage(error);
      const status = error instanceof GitHubError && error.kind === "suspended" ? "suspended" : "unknown";
      persistence.updateAccess(existing.githubId, status, reason);
      persistence.markRefreshFailure(existing.githubId, "access", reason);
      persistence.markRefreshFailure(existing.githubId, "specs", reason);
      return { ok: false, repository: persistence.getRepository(existing.githubId)! };
    }

    const candidate = inventory.find((item) => item.id === existing.githubId);

    if (!candidate) {
      const reason = "Repository was not present in the last complete GitHub App inventory.";
      persistence.updateAccess(existing.githubId, "revoked", reason);
      persistence.markRefreshSuccess(existing.githubId, "access", reason);
      persistence.markRefreshFailure(existing.githubId, "specs", reason);
      return { ok: false, repository: persistence.getRepository(existing.githubId)! };
    }

    if (candidate.owner.toLocaleLowerCase() !== organization.toLocaleLowerCase()) {
      const reason = "Repository is now outside the configured organization.";
      const repository = persistence.upsertRepository(
        repositoryInput(candidate, organization, installationId, "transferred", reason),
      );
      persistence.markRefreshSuccess(repository.githubId, "access", reason);
      persistence.markRefreshFailure(repository.githubId, "specs", reason);
      return { ok: false, repository };
    }

    return saveCandidate(candidate);
  };

  const scopedInventory = async () => {
    const inventory = await github.listInstallationRepositories();
    return inventory.filter((repository) =>
      repository.owner.toLocaleLowerCase() === organization.toLocaleLowerCase(),
    );
  };

  app.use("*", securityHeaders);

  app.get("/assets/app.css", () =>
    new Response(Bun.file(new URL("../public/app.css", import.meta.url)), {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "text/css; charset=UTF-8",
      },
    }),
  );

  app.get("/assets/app.js", () =>
    new Response(Bun.file(new URL("../public/app.js", import.meta.url)), {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "text/javascript; charset=UTF-8",
      },
    }),
  );

  app.get("/assets/htmx.min.js", () =>
    new Response(Bun.file(new URL("../node_modules/htmx.org/dist/htmx.min.js", import.meta.url)), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "text/javascript; charset=UTF-8",
      },
    }),
  );

  app.get("/", (c) => c.redirect("/repositories", 303));

  app.get("/login", (c) => {
    setPrivateHtmlHeaders(c);
    const identity = auth.authenticate(c);
    if (identity) return c.redirect("/repositories", 303);

    const returnTo = safeReturnTo(c.req.query("returnTo"));
    const csrfToken = auth.issueCsrf();
    return c.html(renderLoginPage({ csrfToken, returnTo }));
  });

  app.post("/login", async (c) => {
    setPrivateHtmlHeaders(c);

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed sign-in request", 400);
    }

    const returnTo = safeReturnTo(stringField(form.returnTo));
    const csrf = stringField(form.csrf);
    if (!auth.validateLogin(c, csrf)) {
      return c.text("Request rejected", 403);
    }

    const token = stringField(form.token) ?? "";
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !auth.matchesSharedToken(token)) {
      const nextCsrf = auth.issueCsrf();
      const content = renderLoginForm({
        csrfToken: nextCsrf,
        error: "The shared credential was not accepted.",
        returnTo,
      });

      if (isHtmx(c)) return c.html(content, 422);
      return c.html(renderLoginPage({ csrfToken: nextCsrf, error: "The shared credential was not accepted.", returnTo }), 422);
    }

    const session = auth.createSession();
    c.header("Set-Cookie", session.cookie);

    if (isHtmx(c)) {
      c.header("HX-Redirect", returnTo);
      return c.body(null, 200);
    }

    return c.redirect(returnTo, 303);
  });

  app.use("/repositories", auth.middleware);
  app.use("/repositories/*", auth.middleware);

  app.get("/repositories", (c) => {
    const identity = c.get("auth");
    const includeRemoved = c.req.query("removed") === "1";
    const repositories = persistence.listRepositories(includeRemoved).map((repository) => ({
      repository,
      accessRefresh: persistence.getRefreshState(repository.githubId, "access"),
      specsRefresh: persistence.getRefreshState(repository.githubId, "specs"),
    }));
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);
    return c.html(renderRepositoriesPage(csrfToken, repositories));
  });

  app.get("/repositories/new", async (c) => {
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    let available: GitHubRepository[] = [];
    let error: string | undefined;

    try {
      available = await scopedInventory();
    } catch (reason) {
      error = githubFailureMessage(reason);
    }

    const enrolled = new Set(persistence.listRepositories(true).map((repository) => repository.githubId));
    const repositoryForms = available.map((repository) => ({
      repository,
      enrolled: enrolled.has(repository.id),
      csrfToken: auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined),
    }));

    setPrivateHtmlHeaders(c);
    return c.html(renderAddRepositoryPage({ csrfToken, available: repositoryForms, error }));
  });

  app.post("/repositories", async (c) => {
    setPrivateHtmlHeaders(c);
    const identity = c.get("auth");
    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed Repository request", 400);
    }

    if (!auth.validateBrowserMutation(c, identity, stringField(form.csrf))) {
      return c.text("Request rejected", 403);
    }

    const repositoryId = stringField(form.repository_id);
    if (!repositoryId || !repositoryIdPattern.test(repositoryId)) {
      return c.text("Invalid Repository ID", 400);
    }

    let inventory: GitHubRepository[];
    try {
      inventory = await scopedInventory();
    } catch (error) {
      return c.text(githubFailureMessage(error), 503);
    }

    const candidate = inventory.find((repository) => repository.id === repositoryId);
    if (!candidate) return c.text("Repository is not available to the configured GitHub App installation", 404);

    const result = await saveCandidate(candidate);
    const destination = `/repositories/${encodeURIComponent(result.repository.githubId)}/specs`;
    if (isHtmx(c)) {
      c.header("HX-Redirect", destination);
      return c.body(null, 200);
    }
    return c.redirect(destination, 303);
  });

  app.get("/repositories/:repositoryId", (c) => {
    const repositoryId = c.req.param("repositoryId");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    if (!persistence.getRepository(repositoryId)) return c.text("Repository not found", 404);
    return c.redirect(`/repositories/${encodeURIComponent(repositoryId)}/specs`, 303);
  });

  app.get("/repositories/:repositoryId/specs", async (c) => {
    const repositoryId = c.req.param("repositoryId");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    const existing = persistence.getRepository(repositoryId);
    if (!existing) return c.text("Repository not found", 404);

    await refreshRepository(existing);
    const repository = persistence.getRepository(repositoryId)!;
    const specs = persistence.listSpecs(repositoryId);
    const accessRefresh = persistence.getRefreshState(repositoryId, "access");
    const specsRefresh = persistence.getRefreshState(repositoryId, "specs");
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);
    return c.html(renderSpecsPage({
      csrfToken,
      repository,
      specs,
      accessRefresh,
      specsRefresh,
    }));
  });

  app.get("/repositories/:repositoryId/specs/:issueNumber", async (c) => {
    const repositoryId = c.req.param("repositoryId");
    const issueNumber = c.req.param("issueNumber");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    if (!issueNumberPattern.test(issueNumber)) return c.text("Invalid issue number", 400);
    const existing = persistence.getRepository(repositoryId);
    if (!existing) return c.text("Repository not found", 404);

    const result = await refreshRepository(existing);
    const repository = persistence.getRepository(repositoryId)!;
    const spec = persistence.getSpec(repositoryId, issueNumber);
    const accessRefresh = persistence.getRefreshState(repositoryId, "access");
    const specsRefresh = persistence.getRefreshState(repositoryId, "specs");
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);

    if (!spec) {
      if (!result.ok) {
        return c.html(renderSpecUnavailablePage({
          csrfToken,
          repository,
          accessRefresh,
          specsRefresh,
        }), 503);
      }
      return c.text("Spec not found", 404);
    }

    return c.html(renderSpecDetailPage({
      csrfToken,
      repository,
      spec,
      accessRefresh,
      specsRefresh,
    }));
  });

  app.post("/logout", auth.middleware, async (c) => {
    setPrivateHtmlHeaders(c);
    const identity = c.get("auth");

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed sign-out request", 400);
    }

    if (!auth.validateBrowserMutation(c, identity, stringField(form.csrf))) {
      return c.text("Request rejected", 403);
    }

    auth.endSession(identity);
    c.header("Set-Cookie", auth.clearSessionCookie());

    if (isHtmx(c)) {
      c.header("HX-Redirect", "/login");
      return c.body(null, 200);
    }

    return c.redirect("/login", 303);
  });

  return app;
};

export type AtlasApp = ReturnType<typeof createApp>;
