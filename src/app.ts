import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createAuth,
  safeReturnTo,
  type AuthEnv,
} from "./auth.ts";
import {
  createGitHubClient,
  type GitHubClient,
  type GitHubRepository,
} from "./github.ts";
import {
  createPersistence,
  type Persistence,
  type Repository,
} from "./persistence.ts";
import {
  createRefreshCoordinator,
  githubFailureMessage,
  type RefreshCoordinator,
} from "./sync.ts";
import {
  renderAddRepositoryPage,
  renderLoginForm,
  renderLoginPage,
  renderPullRequestsPage,
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
  refreshCoordinator?: RefreshCoordinator;
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

  const refreshCoordinator = options.refreshCoordinator ?? createRefreshCoordinator({
    persistence,
    github,
    organization,
    installationId,
    now: options.now,
  });

  const refreshRepository = async (existing: Repository) => {
    await refreshCoordinator.refresh(existing.githubId, ["access", "specs"]);
    const repository = persistence.getRepository(existing.githubId)!;
    const access = persistence.getRefreshState(existing.githubId, "access");
    const specs = persistence.getRefreshState(existing.githubId, "specs");
    return {
      ok: repository.accessStatus === "available" && access?.availability === "available" && specs?.availability === "available",
      repository,
    };
  };

  const refreshPullRequests = async (existing: Repository) => {
    await refreshCoordinator.refresh(existing.githubId, ["access", "pullRequests"]);
    const repository = persistence.getRepository(existing.githubId)!;
    const access = persistence.getRefreshState(existing.githubId, "access");
    const pullRequests = persistence.getRefreshState(existing.githubId, "pullRequests");
    return {
      ok: repository.accessStatus === "available" && access?.availability === "available" && pullRequests?.availability === "available",
      repository,
    };
  };

  const saveCandidate = async (candidate: GitHubRepository) => {
    const repository = persistence.upsertRepository({
      githubId: candidate.id,
      installationId,
      organization,
      owner: candidate.owner,
      name: candidate.name,
      fullName: candidate.fullName,
      htmlUrl: candidate.htmlUrl,
      description: candidate.description,
      visibility: candidate.visibility,
      defaultBranch: candidate.defaultBranch,
      archived: candidate.archived,
      disabled: candidate.disabled,
      hasIssues: candidate.hasIssues,
    });
    const result = await refreshRepository(repository);
    return { ...result, repository: persistence.getRepository(repository.githubId)! };
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

  app.get("/repositories/:repositoryId/pull-requests", async (c) => {
    const repositoryId = c.req.param("repositoryId");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    const existing = persistence.getRepository(repositoryId);
    if (!existing) return c.text("Repository not found", 404);

    await refreshPullRequests(existing);
    const repository = persistence.getRepository(repositoryId)!;
    const pullRequests = persistence.listPullRequests(repositoryId);
    const stacks = persistence.listPrStacks(repositoryId);
    const accessRefresh = persistence.getRefreshState(repositoryId, "access");
    const refresh = persistence.getRefreshState(repositoryId, "pullRequests");
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);
    return c.html(renderPullRequestsPage({
      csrfToken,
      repository,
      pullRequests,
      stacks,
      accessRefresh,
      refresh,
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
