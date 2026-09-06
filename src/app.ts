import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
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
  type RefreshState,
  type Repository,
  type Session,
  type SessionFilter,
} from "./persistence.ts";
import { createPreparationService } from "./preparation.ts";
import type { CredentialBoundary } from "./credentials.ts";
import { createOpenCodeHandoffService } from "./opencode.ts";
import type { OpenCodeHandoffService } from "./opencode.ts";
import {
  createSessionViewerService,
  ViewerScopeError,
  type SessionViewerProjection,
} from "./session-viewer.ts";
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
  renderPendingStartSessionPage,
  renderRepositoriesPage,
  renderSessionDetailPage,
  renderSessionViewerFragment,
  renderSessionsPage,
  renderStartSessionForm,
  renderStartSessionPage,
  renderSpecDetailPage,
  renderSpecUnavailablePage,
  renderSpecsPage,
  type PendingStartSession,
} from "./views.ts";

const MAX_FORM_BYTES = 512 * 1024;
const MAX_TOKEN_LENGTH = 8 * 1024;
const MAX_PROMPT_CHARACTERS = 20_000;
const repositoryIdPattern = /^[1-9]\d{0,19}$/;
const issueNumberPattern = /^[1-9]\d{0,9}$/;
const submissionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionIdPattern = /^ses_[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// OpenCode's Session.ID schema only requires the `ses` prefix. The viewer
// still authorizes the value by walking the canonical descendant tree.
const openCodeSessionIdPattern = /^ses[^\u0000-\u001f\u007f]{0,255}$/u;
const startSessionPathPattern = /^\/repositories\/([1-9]\d{0,19})\/specs\/([1-9]\d{0,9})\/sessions$/;
const sessionFilters = new Set<SessionFilter>([
  "active",
  "all",
  "queued",
  "preparing",
  "running",
  "waiting",
  "idle",
  "succeeded",
  "failed",
  "interrupted",
  "failed_setup",
]);

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
  sessionRoot?: string;
  globalCapacity?: number;
  credentialsPath?: string;
  credentialRegistryPath?: string;
  credentialSocketPath?: string;
  credentialKeyPath?: string;
  authorizedRepositories?: readonly string[];
  gitBinary?: string;
  credentials?: CredentialBoundary;
  persistence?: Persistence;
  refreshCoordinator?: RefreshCoordinator;
  openCode?: OpenCodeHandoffService;
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

const isCurrentSpec = (spec: { isCurrent: boolean; state: string; hasSpecLabel: boolean; isPullRequest: boolean }) =>
  spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest;

const isEligibleRepository = (repository: Repository) =>
  repository.accessStatus === "available" &&
  !repository.removedAt &&
  !repository.archived &&
  !repository.disabled &&
  repository.hasIssues &&
  Boolean(repository.defaultBranch);

const promptCharacterCount = (prompt: string) => Array.from(prompt).length;

const refreshIsCurrent = (state: RefreshState | undefined, minimumGeneration: number) => Boolean(
  state &&
  state.availability === "available" &&
  state.requestedGeneration >= minimumGeneration &&
  state.requestedGeneration <= state.completedGeneration,
);

const nextRefreshGeneration = (persistence: Persistence, repositoryId: string, view: "access" | "specs" | "pullRequests") =>
  (persistence.getRefreshState(repositoryId, view)?.requestedGeneration ?? 0) + 1;

const sessionLocation = (session: Pick<Session, "atlasId">) => `/sessions/${encodeURIComponent(session.atlasId)}`;

const viewerLimit = (value: string | undefined) => {
  if (value === undefined || value === "") return 40;
  if (!/^\d{1,3}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : undefined;
};

const viewerCursor = (value: string | undefined) => {
  if (!value) return undefined;
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
};

const viewerShellId = (value: string | undefined) => {
  if (value === undefined) return undefined;
  return /^[A-Za-z0-9._:-]{1,256}$/u.test(value) ? value : null;
};

const viewerShellCursor = (value: string | undefined) => {
  if (value === undefined || value === "") return undefined;
  if (!/^\d{1,16}$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const openCodeEventData = (event: unknown) => {
  const value = (event as { data?: unknown })?.data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
};

const openCodeEventSessionId = (event: unknown) => {
  const data = openCodeEventData(event);
  if (typeof data.sessionID === "string") return data.sessionID;
  const form = data.form;
  if (form && typeof form === "object" && !Array.isArray(form) && typeof (form as Record<string, unknown>).sessionID === "string") {
    return (form as Record<string, unknown>).sessionID as string;
  }
  return undefined;
};

const openCodeEventLocation = (event: unknown) => {
  const location = (event as { location?: { directory?: unknown } })?.location;
  return typeof location?.directory === "string" ? location.directory : undefined;
};

const isViewerEventRelevant = (
  event: unknown,
  scope: { remoteSessionId?: string; directory?: string; repositoryId?: string },
  repositorySessions: readonly Session[],
) => {
  const type = (event as { type?: unknown })?.type;
  if (typeof type !== "string") return false;
  if (type === "server.connected") return false;
  const location = openCodeEventLocation(event);
  if (scope.directory && location && location !== scope.directory) return false;
  const sessionId = openCodeEventSessionId(event);
  if (scope.remoteSessionId && sessionId === scope.remoteSessionId) return true;
  const data = openCodeEventData(event);
  if (scope.remoteSessionId && (type === "session.created" || type === "session.forked") && data.parentID === scope.remoteSessionId) return true;
  if (scope.remoteSessionId && scope.directory === location && type.startsWith("session.")) return true;
  if (scope.repositoryId && repositorySessions.some((session) =>
    session.openCodeSessionId === sessionId ||
    (session.directory && location === session.directory),
  )) return true;
  return false;
};

const pendingStartSession = (form: Record<string, unknown>): PendingStartSession | undefined => {
  const action = stringField(form.pending_action);
  const submissionId = stringField(form.pending_submission_id);
  const prompt = stringField(form.pending_prompt);
  if (!action || !startSessionPathPattern.test(action) || !submissionId || !submissionIdPattern.test(submissionId) || prompt === undefined) {
    return undefined;
  }
  return { action, submissionId, prompt };
};

const redirectToSession = (c: Context, session: Pick<Session, "atlasId">) => {
  const destination = sessionLocation(session);
  if (isHtmx(c)) {
    c.header("HX-Redirect", destination);
    return c.body(null, 200);
  }
  return c.redirect(destination, 303);
};

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

  const refreshCoordinator = options.refreshCoordinator ?? createRefreshCoordinator({
    persistence,
    github,
    organization,
    installationId,
    now: options.now,
  });

  const refreshRepository = async (existing: Repository) => {
    const accessGeneration = nextRefreshGeneration(persistence, existing.githubId, "access");
    const specsGeneration = nextRefreshGeneration(persistence, existing.githubId, "specs");
    await refreshCoordinator.refresh(existing.githubId, ["access", "specs"]);
    const repository = persistence.getRepository(existing.githubId)!;
    const access = persistence.getRefreshState(existing.githubId, "access");
    const specs = persistence.getRefreshState(existing.githubId, "specs");
    return {
      ok: repository.accessStatus === "available" && refreshIsCurrent(access, accessGeneration) && refreshIsCurrent(specs, specsGeneration),
      repository,
    };
  };

  const refreshPullRequests = async (existing: Repository) => {
    const accessGeneration = nextRefreshGeneration(persistence, existing.githubId, "access");
    const pullRequestsGeneration = nextRefreshGeneration(persistence, existing.githubId, "pullRequests");
    await refreshCoordinator.refresh(existing.githubId, ["access", "pullRequests"]);
    const repository = persistence.getRepository(existing.githubId)!;
    const access = persistence.getRefreshState(existing.githubId, "access");
    const pullRequests = persistence.getRefreshState(existing.githubId, "pullRequests");
    return {
      ok: repository.accessStatus === "available" && refreshIsCurrent(access, accessGeneration) && refreshIsCurrent(pullRequests, pullRequestsGeneration),
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
    if (result.ok && result.repository.removedAt) persistence.restoreRepository(result.repository.githubId);
    return { ...result, repository: persistence.getRepository(repository.githubId)! };
  };

  const preparation = createPreparationService({
    persistence,
    github,
    refreshRepository,
    sessionRoot: options.sessionRoot,
    globalCapacity: options.globalCapacity,
    credentialsPath: options.credentialsPath,
    credentialRegistryPath: options.credentialRegistryPath,
    credentialSocketPath: options.credentialSocketPath,
    credentialKeyPath: options.credentialKeyPath,
    authorizedRepositories: options.authorizedRepositories,
    gitBinary: options.gitBinary,
    credentials: options.credentials,
  });
  const openCode = options.openCode ?? createOpenCodeHandoffService({
    persistence,
    onSlotReleased: preparation.enqueue,
  });
  const sessionViewer = createSessionViewerService(openCode);
  preparation.start();
  openCode.start();

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
    const pending = pendingStartSession(form);
    const csrf = stringField(form.csrf);
    if (!auth.validateLogin(c, csrf)) {
      const nextCsrf = auth.issueCsrf();
      const error = "This sign-in form expired or was rejected. Try again.";
      if (isHtmx(c)) return c.html(renderLoginForm({ csrfToken: nextCsrf, error, returnTo, pending }), 403);
      return c.html(renderLoginPage({ csrfToken: nextCsrf, error, returnTo, pending }), 403);
    }

    const token = stringField(form.token) ?? "";
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !auth.matchesSharedToken(token)) {
      const nextCsrf = auth.issueCsrf();
      const content = renderLoginForm({
        csrfToken: nextCsrf,
        error: "The shared credential was not accepted.",
        returnTo,
        pending,
      });

      if (isHtmx(c)) return c.html(content, 422);
      return c.html(renderLoginPage({ csrfToken: nextCsrf, error: "The shared credential was not accepted.", returnTo, pending }), 422);
    }

    const session = auth.createSession();
    c.header("Set-Cookie", session.cookie);

    if (pending) {
      const match = startSessionPathPattern.exec(pending.action);
      const repository = match ? persistence.getRepository(match[1]) : undefined;
      const spec = repository && match ? persistence.getSpec(match[1], match[2]) : undefined;
      const retryOptions = {
        ...pending,
        csrfToken: auth.issueCsrf(session.identity.sessionId),
      };

      if (isHtmx(c)) c.header("HX-Retarget", "body");
      if (repository && spec) {
        return c.html(renderStartSessionPage({
          ...retryOptions,
          repository,
          spec,
          notice: "Signed in. Review the preserved form, then choose Start Session to retry it.",
          accessRefresh: persistence.getRefreshState(repository.githubId, "access"),
          specsRefresh: persistence.getRefreshState(repository.githubId, "specs"),
        }), 200);
      }
      return c.html(renderPendingStartSessionPage(retryOptions), 200);
    }

    if (isHtmx(c)) {
      c.header("HX-Redirect", returnTo);
      return c.body(null, 200);
    }

    return c.redirect(returnTo, 303);
  });

  const preserveUnauthenticatedStart: MiddlewareHandler = async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method !== "POST" || isHtmx(c) || !startSessionPathPattern.test(path) || auth.authenticate(c)) {
      await next();
      return;
    }

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed Session request", 400);
    }

    const submittedSubmissionId = stringField(form.submission_id);
    const pending: PendingStartSession = {
      action: path,
      submissionId: submittedSubmissionId && submissionIdPattern.test(submittedSubmissionId)
        ? submittedSubmissionId
        : crypto.randomUUID(),
      prompt: stringField(form.prompt) ?? "",
    };
    const csrfToken = auth.issueCsrf();
    setPrivateHtmlHeaders(c);
    c.header("WWW-Authenticate", 'Bearer realm="Atlas"');
    return c.html(renderLoginPage({
      csrfToken,
      returnTo: path,
      pending,
      error: "Your sign-in is required. Sign in, then review and retry this preserved form.",
    }), 401);
  };

  app.use("/repositories", preserveUnauthenticatedStart);
  app.use("/repositories/*", preserveUnauthenticatedStart);

  app.use("/repositories", auth.middleware);
  app.use("/repositories/*", auth.middleware);
  app.use("/sessions", auth.middleware);
  app.use("/sessions/*", auth.middleware);
  app.use("/events", auth.middleware);

  app.get("/events", (c) => {
    const sessionId = c.req.query("session");
    const repositoryId = c.req.query("repository");
    if ((sessionId && !sessionIdPattern.test(sessionId)) || (repositoryId && !repositoryIdPattern.test(repositoryId))) {
      return c.text("Invalid event scope", 400);
    }
    if (!sessionId && !repositoryId) return c.text("An event scope is required", 400);

    const scopedSession = sessionId ? persistence.getSession(sessionId) : undefined;
    const scopedRepository = repositoryId ? persistence.getRepository(repositoryId) : scopedSession ? persistence.getRepository(scopedSession.repositoryId) : undefined;
    if (sessionId && !scopedSession) return c.text("Session not found", 404);
    if (repositoryId && !scopedRepository) return c.text("Repository not found", 404);
    if (scopedSession && repositoryId && scopedSession.repositoryId !== repositoryId) return c.text("Event scope does not match the Session Repository", 404);
    if (!scopedRepository) return c.text("Repository not found", 404);

    const initialIdentity = c.get("auth");
    const scope = {
      remoteSessionId: scopedSession?.openCodeSessionId ?? undefined,
      directory: scopedSession?.directory ?? undefined,
      repositoryId: scopedRepository.githubId,
    };

    setPrivateHtmlHeaders(c);
    c.header("Connection", "keep-alive");
    return streamSSE(c, async (stream) => {
      let wake: (() => void) | undefined;
      let closed = false;
      const queue: Array<{ event: string; data: string }> = [];
      const enqueue = (event: string, data: Record<string, unknown>) => {
        if (closed) return;
        const existing = queue.find((item) => item.event === event);
        const encoded = JSON.stringify(data);
        if (existing) existing.data = encoded;
        else queue.push({ event, data: encoded });
        wake?.();
        wake = undefined;
      };

      const unsubscribeEvent = openCode.onEvent((event) => {
        const sessions = scopedSession
          ? [scopedSession]
          : persistence.listOpenCodeSessions().filter((candidate) => candidate.repositoryId === scopedRepository.githubId);
        if (!isViewerEventRelevant(event, scope, sessions)) return;
        enqueue("refresh", { scope: sessionId ? "session" : "repository", reason: "OpenCode projection changed" });
      });
      const unsubscribeTransport = openCode.onTransport((state, reason) => {
        enqueue(state === "connected" ? "reconcile" : "stale", {
          scope: sessionId ? "session" : "repository",
          ...(reason ? { reason } : {}),
        });
      });

      stream.onAbort(() => {
        closed = true;
        unsubscribeEvent();
        unsubscribeTransport();
        wake?.();
        wake = undefined;
      });

      const connection = openCode.getClient().then(() => {
        enqueue("connected", { scope: sessionId ? "session" : "repository" });
      }).catch(() => {
        enqueue("stale", {
          scope: sessionId ? "session" : "repository",
          reason: "OpenCode connection is unavailable; canonical reconciliation is pending.",
        });
      });

      while (!closed && !stream.aborted && !stream.closed) {
        const current = auth.authenticate(c);
        if (!current || (initialIdentity.type === "browser" && current.type !== "browser")) {
          enqueue("auth-expired", { scope: sessionId ? "session" : "repository" });
        }

        const next = queue.shift();
        if (next) {
          await stream.writeSSE(next);
          if (next.event === "auth-expired") break;
          continue;
        }

        await Promise.race([
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
          stream.sleep(15_000).then(() => undefined),
        ]);
      }
      await connection.catch(() => undefined);
      unsubscribeEvent();
      unsubscribeTransport();
    });
  });

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
    return c.html(renderRepositoriesPage(csrfToken, repositories, includeRemoved));
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

    const enrolled = new Map(persistence.listRepositories(true).map((repository) => [repository.githubId, repository]));
    const repositoryForms = available.map((repository) => ({
      repository,
      enrolled: enrolled.has(repository.id),
      removedAt: enrolled.get(repository.id)?.removedAt,
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

  app.post("/repositories/:repositoryId/remove", async (c) => {
    setPrivateHtmlHeaders(c);
    const repositoryId = c.req.param("repositoryId");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    if (!persistence.getRepository(repositoryId)) return c.text("Repository not found", 404);

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed Repository removal request", 400);
    }

    const identity = c.get("auth");
    if (!auth.validateBrowserMutation(c, identity, stringField(form.csrf))) {
      return c.text("Request rejected", 403);
    }

    try {
      persistence.removeRepository(repositoryId);
    } catch {
      return c.text("Atlas could not save the Repository removal.", 503);
    }
    preparation.enqueue();

    const destination = "/repositories?removed=1";
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
    const sessionsBySpec = new Map(
      specs.map((spec) => [spec.issueNumber, persistence.listSessionsForSpec(repositoryId, spec.issueNumber)]),
    );
    const accessRefresh = persistence.getRefreshState(repositoryId, "access");
    const specsRefresh = persistence.getRefreshState(repositoryId, "specs");
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);
    return c.html(renderSpecsPage({
      csrfToken,
      repository,
      specs,
      sessionsBySpec,
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
    const sessions = persistence.listSessionsForSpec(repositoryId, issueNumber);
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
      sessions,
      accessRefresh,
      specsRefresh,
    }));
  });

  app.get("/repositories/:repositoryId/specs/:issueNumber/sessions/new", async (c) => {
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

    if (!result.ok) {
      return c.html(renderSpecUnavailablePage({
        csrfToken,
        repository,
        accessRefresh,
        specsRefresh,
      }), 503);
    }

    if (!spec || !isCurrentSpec(spec)) return c.text("Spec is not currently eligible", 404);
    if (!isEligibleRepository(repository)) {
      return c.html(renderSpecDetailPage({
        csrfToken,
        repository,
        spec,
        sessions: persistence.listSessionsForSpec(repositoryId, issueNumber),
        accessRefresh,
        specsRefresh,
      }), 409);
    }

    return c.html(renderStartSessionPage({
      csrfToken,
      repository,
      spec,
      submissionId: crypto.randomUUID(),
      prompt: "",
      accessRefresh,
      specsRefresh,
    }));
  });

  app.post("/repositories/:repositoryId/specs/:issueNumber/sessions", async (c) => {
    const repositoryId = c.req.param("repositoryId");
    const issueNumber = c.req.param("issueNumber");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    if (!issueNumberPattern.test(issueNumber)) return c.text("Invalid issue number", 400);

    const existing = persistence.getRepository(repositoryId);
    if (!existing) return c.text("Repository not found", 404);
    const knownSpec = persistence.getSpec(repositoryId, issueNumber);
    if (!knownSpec) return c.text("Spec not found", 404);

    let form: Record<string, unknown>;
    try {
      form = await parseForm(c.req.raw);
    } catch (error) {
      if (error instanceof FormBodyTooLarge) return c.text("Request body is too large", 413);
      return c.text("Malformed Session request", 400);
    }

    const prompt = stringField(form.prompt) ?? "";
    const submittedSubmissionId = stringField(form.submission_id);
    const submissionId = submittedSubmissionId && submissionIdPattern.test(submittedSubmissionId)
      ? submittedSubmissionId
      : crypto.randomUUID();
    const identity = c.get("auth");
    const action = `/repositories/${encodeURIComponent(repositoryId)}/specs/${encodeURIComponent(issueNumber)}/sessions`;

    const renderError = (
      status: 403 | 409 | 422 | 503,
      error: string,
      repository: Repository = persistence.getRepository(repositoryId)!,
      spec = persistence.getSpec(repositoryId, issueNumber) ?? knownSpec,
      existingSession?: Session,
    ) => {
      const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
      const options = {
        action,
        csrfToken,
        submissionId,
        prompt,
        error,
        existingSession,
      };
      setPrivateHtmlHeaders(c);
      if (isHtmx(c)) return c.html(renderStartSessionForm(options), status);
      return c.html(renderStartSessionPage({
        ...options,
        repository,
        spec,
        accessRefresh: persistence.getRefreshState(repositoryId, "access"),
        specsRefresh: persistence.getRefreshState(repositoryId, "specs"),
      }), status);
    };

    setPrivateHtmlHeaders(c);
    if (!auth.validateBrowserMutation(c, identity, stringField(form.csrf))) {
      return renderError(403, "This form expired or was rejected. Reload the form and try again.");
    }

    const priorSubmission = submittedSubmissionId && submissionIdPattern.test(submittedSubmissionId)
      ? persistence.getSessionBySubmissionId(submittedSubmissionId)
      : undefined;
    if (priorSubmission) {
      const sameSubmission = priorSubmission.repositoryId === repositoryId &&
        priorSubmission.specGithubId === knownSpec.githubId &&
        priorSubmission.specIssueNumber === issueNumber &&
        priorSubmission.prompt === prompt;
      if (sameSubmission) return redirectToSession(c, priorSubmission);
      return renderError(409, "This submission identity was already used with different Session content.", existing, knownSpec);
    }

    if (!submittedSubmissionId || !submissionIdPattern.test(submittedSubmissionId)) {
      return renderError(422, "Refresh the Start Session form before submitting again.");
    }
    if (prompt.trim().length === 0) {
      return renderError(422, "Enter an initial prompt before starting the Session.");
    }
    if (promptCharacterCount(prompt) > MAX_PROMPT_CHARACTERS) {
      return renderError(422, `The initial prompt must be ${MAX_PROMPT_CHARACTERS.toLocaleString()} characters or fewer.`);
    }

    let refreshResult: SyncResult;
    try {
      refreshResult = await refreshRepository(existing);
    } catch {
      return renderError(503, "GitHub eligibility could not be verified. No Session was queued.");
    }

    const repository = persistence.getRepository(repositoryId)!;
    const spec = persistence.getSpec(repositoryId, issueNumber);
    if (!refreshResult.ok) {
      return renderError(503, "GitHub eligibility could not be verified. No Session was queued.", repository, spec ?? knownSpec);
    }
    if (!isEligibleRepository(repository)) {
      return renderError(409, "This Repository is not currently eligible for a new Session.", repository, spec ?? knownSpec);
    }
    if (!spec || !isCurrentSpec(spec)) {
      return renderError(409, "This Spec is no longer open, labelled exactly `spec`, and eligible in this Repository.", repository, spec ?? knownSpec);
    }

    let result: ReturnType<Persistence["queueSession"]>;
    try {
      result = persistence.queueSession({
        atlasId: `ses_${crypto.randomUUID()}`,
        repositoryId,
        spec,
        submissionId: submittedSubmissionId,
        submissionOrderTime: new Date(now()).toISOString(),
        prompt,
        targetKind: "default",
        targetBranch: repository.defaultBranch!,
      });
    } catch {
      return renderError(503, "Atlas could not save this Session. No Session was queued; keep this form and try again.", repository, spec);
    }

    if (result.kind === "created" || result.kind === "existing") {
      preparation.enqueue();
      return redirectToSession(c, result.session);
    }
    if (result.kind === "conflict") {
      return renderError(409, "This submission identity was already used with different Session content.", repository, spec, result.session);
    }
    return renderError(
      409,
      "This Spec already has an unfinished Session. Review that attempt before starting another.",
      repository,
      spec,
      result.session,
    );
  });

  app.get("/repositories/:repositoryId/sessions", (c) => {
    const repositoryId = c.req.param("repositoryId");
    if (!repositoryIdPattern.test(repositoryId)) return c.text("Invalid Repository ID", 400);
    const repository = persistence.getRepository(repositoryId);
    if (!repository) return c.text("Repository not found", 404);

    const requestedFilter = c.req.query("status") ?? "active";
    if (!sessionFilters.has(requestedFilter as SessionFilter)) return c.text("Invalid Session status filter", 400);
    const filter = requestedFilter as SessionFilter;
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    setPrivateHtmlHeaders(c);
    return c.html(renderSessionsPage({
      csrfToken,
      repository,
      sessions: persistence.listSessions(repositoryId, filter),
      filter,
    }));
  });

  app.get("/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!sessionIdPattern.test(sessionId)) return c.text("Invalid Session ID", 400);
    const session = persistence.getSession(sessionId);
    if (!session) return c.text("Session not found", 404);
    const repository = persistence.getRepository(session.repositoryId);
    if (!repository) return c.text("Repository not found", 404);
    const identity = c.get("auth");
    const csrfToken = auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined);
    let viewer: SessionViewerProjection | undefined;
    try {
      viewer = await sessionViewer.hydrate(session);
    } catch {
      viewer = undefined;
    }
    setPrivateHtmlHeaders(c);
    return c.html(renderSessionDetailPage({
      csrfToken,
      repository,
      session,
      viewer,
    }));
  });

  app.get("/sessions/:sessionId/view", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!sessionIdPattern.test(sessionId)) return c.text("Invalid Session ID", 400);
    const session = persistence.getSession(sessionId);
    if (!session) return c.text("Session not found", 404);
    if (!persistence.getRepository(session.repositoryId)) return c.text("Repository not found", 404);

    const childId = c.req.query("child");
    if (childId !== undefined && !openCodeSessionIdPattern.test(childId)) return c.text("Invalid child OpenCode Session ID", 400);
    const cursorValue = viewerCursor(c.req.query("cursor"));
    if (cursorValue === null) return c.text("Invalid message cursor", 400);
    const shellId = viewerShellId(c.req.query("shell"));
    if (shellId === null) return c.text("Invalid shell ID", 400);
    const shellCursor = viewerShellCursor(c.req.query("shellCursor"));
    if (shellCursor === null || (!shellId && shellCursor !== undefined)) return c.text("Invalid shell output cursor", 400);
    const limit = viewerLimit(c.req.query("limit"));
    if (limit === undefined) return c.text("Invalid viewer page size", 400);

    let projection: SessionViewerProjection;
    try {
      projection = await sessionViewer.hydrate(session, {
        childId,
        cursor: cursorValue,
        shellId,
        shellCursor,
        limit,
      });
    } catch (error) {
      if (error instanceof ViewerScopeError) return c.text("Child Session is not a verified descendant", 404);
      return c.text("Session viewer unavailable", 503);
    }

    setPrivateHtmlHeaders(c);
    const repository = persistence.getRepository(session.repositoryId)!;
    const requestUrl = new URL(c.req.url);
    const viewerRequestUrl = `${requestUrl.pathname}${requestUrl.search}`;
    if (!isHtmx(c)) {
      const identity = c.get("auth");
      return c.html(renderSessionDetailPage({
        csrfToken: auth.issueCsrf(identity.type === "browser" ? identity.sessionId : undefined),
        repository,
        session,
        viewer: projection,
        viewerRequestUrl,
        viewerLimit: limit,
      }));
    }
    return c.html(renderSessionViewerFragment({
      session,
      viewer: projection,
      endpoint: `/sessions/${encodeURIComponent(session.atlasId)}/view`,
      eventsEndpoint: `/events?session=${encodeURIComponent(session.atlasId)}`,
      requestUrl: viewerRequestUrl,
      limit,
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
