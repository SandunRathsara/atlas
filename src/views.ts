import type { GitHubRepository } from "./github.ts";
import type { PrStack, PullRequest, RefreshState, Repository, Session, SessionFilter, SessionState, Spec } from "./persistence.ts";
import { DEFAULT_VIEWER_MESSAGE_LIMIT } from "./session-viewer.ts";
import type { SessionViewerProjection, ViewerSessionNode } from "./session-viewer.ts";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

const safeExternalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
};

const formatTime = (value: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : `${date.toISOString().replace("T", " ").replace(".000Z", " UTC")}`;
};

const htmxConfig =
  '{"reportValidityOfForms":true,"includeIndicatorStyles":false,"historyRestoreAsHxRequest":false,"responseHandling":[{"code":"204","swap":false},{"code":"409","swap":true,"error":false},{"code":"422","swap":true,"error":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":false,"error":true},{"code":"...","swap":true}]}';

const document = (title: string, content: string) => `<!doctype html>
<html lang="en" data-theme="dim">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="htmx-config" content='${htmxConfig}'>
    <title>${escapeHtml(title)} | Atlas</title>
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/htmx.min.js" defer></script>
    <script src="/assets/app.js" defer></script>
  </head>
  <body class="atlas-backdrop min-h-screen bg-base-200 font-sans text-base-content">
    ${content}
  </body>
</html>`;

const skipLink = `<a class="atlas-skip-link" href="#main-content">Skip to main content</a>`;

export type PendingStartSession = {
  action: string;
  submissionId: string;
  prompt: string;
};

export const renderLoginForm = ({
  csrfToken,
  error,
  returnTo,
  pending,
}: {
  csrfToken: string;
  error?: string;
  returnTo: string;
  pending?: PendingStartSession;
}) => {
  const errorMarkup = error
    ? `<p id="login-error" class="alert alert-error mt-6 leading-normal" tabindex="-1" data-focus-on-swap>${escapeHtml(error)}</p>`
    : "";
  const errorAttribute = error ? ' aria-describedby="login-error" aria-invalid="true"' : "";
  const pendingMarkup = pending
    ? `<input type="hidden" name="pending_action" value="${escapeHtml(pending.action)}">
    <input type="hidden" name="pending_submission_id" value="${escapeHtml(pending.submissionId)}">
    <textarea hidden name="pending_prompt">${escapeHtml(pending.prompt)}</textarea>
    <div class="alert alert-info mt-6 leading-normal" role="status">Sign in to review and retry the preserved Start Session form. Atlas will not resubmit it automatically.</div>`
    : "";

  return `<form id="login-form" class="mt-8 max-w-md" action="/login" method="post" autocomplete="on" hx-post="/login" hx-target="#login-form" hx-swap="outerHTML" hx-indicator="#login-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    ${pendingMarkup}
    <div>
      <label class="label mb-2 block p-0" for="shared-token">Shared access credential</label>
      <input id="shared-token" class="input input-bordered min-h-11 w-full border-control-border bg-base-100 text-base-content" name="token" type="password" autocomplete="current-password" required${errorAttribute}>
      <p class="mt-2 text-sm leading-normal text-muted">Use the credential provided by your Atlas operator.</p>
    </div>
    ${errorMarkup}
    <div class="mt-8 flex flex-wrap items-center gap-4">
      <button class="btn btn-primary min-h-11 border border-control-border" type="submit">Sign in</button>
      <span id="login-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing in...</span>
    </div>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

export const renderLoginPage = (options: {
  csrfToken: string;
  error?: string;
  returnTo: string;
  pending?: PendingStartSession;
}) =>
  document(
    "Sign in",
    `${skipLink}
    <header class="atlas-glass border-b border-base-content/16">
      <div class="mx-auto flex min-h-20 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <div>
          <p class="text-lg font-semibold tracking-tight">Atlas</p>
          <p class="text-sm text-muted">Private sign-in</p>
        </div>
      </div>
    </header>
    <main id="main-content" class="mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <section class="atlas-glass w-full rounded-box p-6 sm:p-10 lg:max-w-2xl">
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Private access</p>
        <h1 class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Sign in to Atlas</h1>
        <p class="mt-4 max-w-prose leading-relaxed text-muted">Use the shared team credential to open the private Atlas Repository view.</p>
        ${renderLoginForm(options)}
      </section>
    </main>`,
  );

const renderLogoutForm = (csrfToken: string) => `<form id="logout-form" class="flex flex-wrap items-center gap-3" action="/logout" method="post" hx-post="/logout" hx-target="#logout-form" hx-swap="none" hx-indicator="#logout-progress" hx-disabled-elt="button[type='submit']">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
  <button class="btn btn-ghost min-h-11 border border-control-border" type="submit">Sign out</button>
  <span id="logout-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing out...</span>
</form>`;

type ActivePage = "repositories" | "new-repository" | "specs" | "spec" | "pull-requests" | "sessions";

const repositoryLink = (repository: Pick<Repository, "githubId">) => `/repositories/${encodeURIComponent(repository.githubId)}/specs`;
const pullRequestsLink = (repository: Pick<Repository, "githubId">) => `/repositories/${encodeURIComponent(repository.githubId)}/pull-requests`;
const sessionsLink = (repository: Pick<Repository, "githubId">) => `/repositories/${encodeURIComponent(repository.githubId)}/sessions`;

const renderRepositoryNav = (repository: Repository, active: ActivePage) => `<div class="mt-6 border-t border-base-300 pt-4">
  <p class="px-4 py-2 text-sm font-medium uppercase tracking-[0.16em] text-muted">Repository</p>
  <a class="block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${active === "specs" || active === "spec" ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${repositoryLink(repository)}"${active === "specs" || active === "spec" ? ' aria-current="page"' : ""}>Specs</a>
  <a class="mt-1 block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${active === "pull-requests" ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${pullRequestsLink(repository)}"${active === "pull-requests" ? ' aria-current="page"' : ""}>Pull requests</a>
  <a class="mt-1 block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${active === "sessions" ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${sessionsLink(repository)}"${active === "sessions" ? ' aria-current="page"' : ""}>Sessions</a>
</div>`;

const renderShell = ({
  title,
  active,
  repository,
  csrfToken,
  historyDisabled,
  content,
}: {
  title: string;
  active: ActivePage;
  repository?: Repository;
  csrfToken: string;
  historyDisabled?: boolean;
  content: string;
}) => {
  const repositoryName = repository?.fullName ?? "No Repository selected";
  const repositoriesActive = active === "repositories" || active === "new-repository";
  const specsActive = active === "specs" || active === "spec";
  const pullRequestsActive = active === "pull-requests";
  const sessionsActive = active === "sessions";
  const mobileLinks = `<a class="block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${repositoriesActive ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="/repositories"${repositoriesActive ? ' aria-current="page"' : ""}>Repositories</a>
    ${repository ? `<a class="mt-1 block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${specsActive ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${repositoryLink(repository)}"${specsActive ? ' aria-current="page"' : ""}>Specs</a>
    <a class="mt-1 block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${pullRequestsActive ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${pullRequestsLink(repository)}"${pullRequestsActive ? ' aria-current="page"' : ""}>Pull requests</a>
    <a class="mt-1 block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${sessionsActive ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${sessionsLink(repository)}"${sessionsActive ? ' aria-current="page"' : ""}>Sessions</a>` : ""}`;

  return document(
    title,
    `${skipLink}
    <header class="atlas-glass sticky top-0 z-20 border-b border-base-content/16">
      <div class="relative mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div class="flex min-w-0 items-center gap-4">
          <a class="rounded-field px-1 py-2 text-lg font-semibold tracking-tight text-base-content" href="/repositories">Atlas</a>
          <span class="hidden max-w-[18rem] truncate text-sm text-muted sm:inline" title="${escapeHtml(repositoryName)}">${escapeHtml(repositoryName)}</span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <details class="lg:hidden" data-mobile-navigation>
            <summary class="btn btn-ghost min-h-11 list-none border border-control-border" data-mobile-navigation-trigger aria-label="Open primary navigation">Navigation</summary>
            <nav class="absolute right-4 top-full z-30 w-64 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 p-3 shadow-xl" aria-label="Primary navigation">
              ${mobileLinks}
            </nav>
          </details>
          ${renderLogoutForm(csrfToken)}
        </div>
      </div>
    </header>
    <div class="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-8">
      <aside class="atlas-glass hidden self-start rounded-box p-3 lg:block" aria-label="Primary navigation">
        <p class="px-4 py-3 text-sm font-medium uppercase tracking-[0.16em] text-muted">Atlas</p>
        <nav>
          <a class="block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${active === "repositories" || active === "new-repository" ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="/repositories"${active === "repositories" || active === "new-repository" ? ' aria-current="page"' : ""}>Repositories</a>
          ${repository ? renderRepositoryNav(repository, active) : ""}
        </nav>
      </aside>
       <main id="main-content" class="min-w-0" aria-labelledby="page-title"${historyDisabled ? ' hx-history="false"' : ""}>
        <div id="global-status" class="sr-only" role="status" aria-atomic="true">Signed in to Atlas.</div>
        ${content}
      </main>
    </div>`,
  );
};

const accessLabel = (repository: Repository) => {
  if (repository.removedAt) return "Removed from Atlas";
  if (repository.accessStatus === "unknown") return "Access unknown";
  if (repository.accessStatus === "revoked") return "Access unavailable";
  if (repository.accessStatus === "transferred") return "Transferred out of scope";
  if (repository.accessStatus === "suspended") return "App suspended";
  if (repository.archived) return "Archived";
  if (repository.disabled) return "Disabled";
  return "Available";
};

const accessBadgeClass = (repository: Repository) => {
  if (repository.removedAt) return "badge-warning";
  if (repository.accessStatus === "unknown" || repository.accessStatus === "transferred" || repository.accessStatus === "suspended") {
    return "badge-warning";
  }
  if (repository.accessStatus === "revoked" || repository.disabled) return "badge-error";
  if (repository.archived) return "badge-warning";
  return "badge-success";
};

const eligibilityNotice = (repository: Repository) => {
  const reasons = [
    repository.archived ? "Archived Repositories remain browsable, but cannot start Sessions." : "",
    repository.disabled ? "Disabled Repositories remain browsable, but cannot start Sessions." : "",
    !repository.defaultBranch ? "This Repository has no default-branch commit, so it cannot start Sessions." : "",
  ].filter(Boolean);
  return reasons.join(" ");
};

const refreshLine = (label: string, refresh: RefreshState | undefined) => {
  if (!refresh || refresh.availability === "never") return `${label}: never synchronized`;
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return `${label}: last complete sync ${formatTime(refresh.lastSuccessAt)}; refresh pending`;
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return `${label}: last complete sync ${formatTime(refresh.lastSuccessAt)}; latest sync unavailable`;
  }
  return `${label}: synced ${formatTime(refresh.lastSuccessAt)}`;
};

const refreshWarning = (label: string, refresh: RefreshState | undefined) => {
  if (!refresh || refresh.availability === "never") {
    const verb = label === "Access" ? "has" : "have";
    return `<div class="alert alert-info mt-6 leading-normal" role="status"><div><strong>${escapeHtml(label)} ${verb} not synchronized yet.</strong> An unavailable first read is not shown as an empty list.</div></div>`;
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>${escapeHtml(label)} synchronization is unavailable.</strong> Last complete sync: ${formatTime(refresh.lastSuccessAt)}. Cached data is retained.</div></div>`;
  }
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="status"><div><strong>${escapeHtml(label)} synchronization is pending.</strong> Showing the last complete sync from ${formatTime(refresh.lastSuccessAt)}.</div></div>`;
  }
  if (refresh.failureReason) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="status">${escapeHtml(refresh.failureReason)}</div>`;
  }
  if (refresh.lastSuccessAt && Date.now() - new Date(refresh.lastSuccessAt).valueOf() >= 10 * 60 * 1000) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>${escapeHtml(label)} synchronization is overdue.</strong> No successful sync has completed for ten minutes. Last complete sync: ${formatTime(refresh.lastSuccessAt)}.</div></div>`;
  }
  return "";
};

type RepositoryListEntry = {
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
};

const repositoryAction = (repository: Repository, csrfToken: string) => {
  const id = encodeURIComponent(repository.githubId);
  const action = repository.removedAt ? "/repositories" : `/repositories/${id}/remove`;
  const label = repository.removedAt ? "Re-add Repository" : "Remove from Atlas";
  const progress = repository.removedAt ? "Re-adding Repository..." : "Removing Repository...";
  const buttonClass = repository.removedAt ? "btn-primary" : "btn-error";
  return `<form id="repository-action-${escapeHtml(repository.githubId)}" class="flex flex-wrap items-center gap-3" action="${action}" method="post" hx-post="${action}" hx-target="none" hx-swap="none" hx-indicator="#repository-progress-${escapeHtml(repository.githubId)}" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    ${repository.removedAt ? `<input type="hidden" name="repository_id" value="${escapeHtml(repository.githubId)}">` : ""}
    <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
    <button class="btn ${buttonClass} min-h-11 border border-control-border" type="submit">${label}</button>
    <span id="repository-progress-${escapeHtml(repository.githubId)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">${progress}</span>
  </form>`;
};

export const renderRepositoriesPage = (
  csrfToken: string,
  repositories: RepositoryListEntry[] = [],
  includeRemoved = false,
) => {
  const list = repositories.length === 0
    ? `<div class="mt-8 rounded-box bg-base-100 p-6">
        <p class="text-lg font-semibold">No Repositories enrolled</p>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">Atlas does not enroll every Repository available to the GitHub App. Add one explicitly to begin browsing.</p>
        <a class="btn btn-primary mt-6 min-h-11 border border-control-border" href="/repositories/new">Add a Repository</a>
      </div>`
    : `<ul class="mt-8 grid gap-4" aria-label="${includeRemoved ? "Enrolled and removed Repositories" : "Enrolled Repositories"}">${repositories.map(({ repository, accessRefresh, specsRefresh }) => `
         <li class="rounded-box bg-base-100 p-3 sm:p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
              <h2 class="mt-2 break-words text-lg font-semibold"><a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${repositoryLink(repository)}">${escapeHtml(repository.name)}</a></h2>
              ${repository.description ? `<p class="mt-2 max-w-prose leading-normal text-muted">${escapeHtml(repository.description)}</p>` : ""}
               <p class="mt-3 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
               ${repository.defaultBranch ? "" : `<p class="mt-2 text-sm text-warning">No default-branch commit; cannot start Sessions.</p>`}
               ${repository.removedAt ? `<p class="mt-2 text-sm text-warning">Removed from Atlas; Sessions and local resources are preserved.</p>` : ""}
             </div>
            <span class="badge ${accessBadgeClass(repository)}">${accessLabel(repository)}</span>
           </div>
           <div class="mt-5 grid gap-2 text-sm text-muted sm:grid-cols-2">
             <span>${refreshLine("Access", accessRefresh)}</span>
             <span>${refreshLine("Specs", specsRefresh)}</span>
           </div>
           ${refreshWarning("Access", accessRefresh)}
           ${refreshWarning("Specs", specsRefresh)}
           <div class="mt-5 flex flex-wrap items-center gap-3">
             <a class="btn btn-primary min-h-11 border border-control-border" href="${repositoryLink(repository)}">Browse Specs</a>
             <a class="btn btn-ghost min-h-11 border border-control-border" href="${pullRequestsLink(repository)}">Browse Pull requests</a>
             ${safeExternalUrl(repository.htmlUrl) ? `<a class="btn btn-ghost min-h-11 border border-control-border" href="${escapeHtml(safeExternalUrl(repository.htmlUrl))}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
             ${repositoryAction(repository, csrfToken)}
           </div>
         </li>`).join("")}</ul>`;

  return renderShell({
    title: "Repositories",
    active: "repositories",
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
      <div class="flex flex-wrap items-start justify-between gap-6">
         <div>
          <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Operations</p>
          <h1 id="page-title" class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Repositories</h1>
          <p class="mt-4 max-w-prose leading-relaxed text-muted">Choose which GitHub Repositories Atlas should browse. App access is eligibility, not enrollment.</p>
         </div>
         <div class="flex flex-wrap items-center gap-3">
           <a class="btn btn-primary min-h-11 border border-control-border" href="/repositories/new">Add a Repository</a>
           ${includeRemoved
             ? `<a class="btn btn-ghost min-h-11 border border-control-border" href="/repositories">Hide removed Repositories</a>`
             : `<a class="btn btn-ghost min-h-11 border border-control-border" href="/repositories?removed=1">Show removed Repositories</a>`}
         </div>
       </div>
      ${list}
    </section>`,
  });
};

type AvailableRepository = {
  repository: GitHubRepository;
  enrolled: boolean;
  removedAt?: string | null;
  csrfToken: string;
};

export const renderAddRepositoryPage = ({
  csrfToken,
  available,
  error,
}: {
  csrfToken: string;
  available: AvailableRepository[];
  error?: string;
}) => {
  const errorMarkup = error
    ? `<div class="alert alert-warning mt-6 leading-normal" role="alert">${escapeHtml(error)}</div>`
    : "";
  const list = available.length === 0 && !error
    ? `<div class="mt-8 rounded-box bg-base-100 p-6">
        <p class="text-lg font-semibold">No Repositories available</p>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">The configured GitHub App installation has no Repositories in the allowed organization, or none could be verified.</p>
      </div>`
    : available.length > 0
      ? `<ul class="mt-8 grid gap-4" aria-label="Repositories available to Atlas">${available.map(({ repository, enrolled, removedAt, csrfToken: repositoryCsrf }) => `
          <li class="rounded-box bg-base-100 p-3 sm:p-6">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
                <h2 class="mt-2 break-words text-lg font-semibold">${escapeHtml(repository.name)}</h2>
                ${repository.description ? `<p class="mt-2 max-w-prose leading-normal text-muted">${escapeHtml(repository.description)}</p>` : ""}
                <p class="mt-3 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
                ${repository.defaultBranch ? "" : `<p class="mt-2 text-sm text-warning">No default-branch commit; browsing only.</p>`}
              </div>
              <span class="badge ${repository.archived || repository.disabled ? "badge-warning" : "badge-info"}">${repository.archived ? "Archived" : repository.disabled ? "Disabled" : "Available"} for browsing</span>
            </div>
            <div class="mt-5 flex flex-wrap items-center gap-3">
              ${removedAt
                ? `<form id="add-repository-${escapeHtml(repository.id)}" action="/repositories" method="post" hx-post="/repositories" hx-target="none" hx-swap="none" hx-indicator="#add-progress-${escapeHtml(repository.id)}" hx-disabled-elt="button[type='submit']"><input type="hidden" name="csrf" value="${escapeHtml(repositoryCsrf || csrfToken)}"><input type="hidden" name="repository_id" value="${escapeHtml(repository.id)}"><span data-form-status class="sr-only" role="status" aria-live="polite"></span><button class="btn btn-primary min-h-11 border border-control-border" type="submit">Re-add Repository</button><span id="add-progress-${escapeHtml(repository.id)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Re-adding Repository...</span></form><span class="text-sm text-warning">Removed from Atlas; history is preserved.</span>`
                : enrolled
                  ? `<a class="btn btn-primary min-h-11 border border-control-border" href="${repositoryLink({ githubId: repository.id })}">Open Specs</a><span class="text-sm text-muted">Already enrolled; adding again keeps the same Repository.</span>`
                  : `<form id="add-repository-${escapeHtml(repository.id)}" action="/repositories" method="post" hx-post="/repositories" hx-target="none" hx-swap="none" hx-indicator="#add-progress-${escapeHtml(repository.id)}" hx-disabled-elt="button[type='submit']"><input type="hidden" name="csrf" value="${escapeHtml(repositoryCsrf || csrfToken)}"><input type="hidden" name="repository_id" value="${escapeHtml(repository.id)}"><span data-form-status class="sr-only" role="status" aria-live="polite"></span><button class="btn btn-primary min-h-11 border border-control-border" type="submit">Add Repository</button><span id="add-progress-${escapeHtml(repository.id)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Adding Repository...</span></form>`}
              ${safeExternalUrl(repository.htmlUrl) ? `<a class="btn btn-ghost min-h-11 border border-control-border" href="${escapeHtml(safeExternalUrl(repository.htmlUrl))}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
            </div>
          </li>`).join("")}</ul>`
      : "";

  return renderShell({
    title: "Add Repository",
    active: "new-repository",
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">GitHub App access</p>
      <h1 id="page-title" class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Add a Repository</h1>
      <p class="mt-4 max-w-prose leading-relaxed text-muted">Select a Repository that is available to the configured App installation. Atlas will save it before attempting its first Specs synchronization.</p>
      ${errorMarkup}
      ${list}
      <a class="btn btn-ghost mt-8 min-h-11 border border-control-border" href="/repositories">Back to Repositories</a>
    </section>`,
  });
};

const accessNotice = (repository: Repository) => {
  return [
    repository.removedAt
      ? `<div class="alert alert-warning mt-6 leading-normal" role="status"><div><strong>This Repository was removed from Atlas.</strong> Existing queued and executing Sessions, history, associations, and local resources are preserved. New starts are disabled until the same GitHub Repository is re-added and verified.</div></div>`
      : "",
    repository.accessStatus === "unknown"
      ? `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>GitHub access could not be verified.</strong> Showing the last complete Atlas data when available. This does not confirm that access was removed.</div></div>`
      : "",
    repository.accessStatus === "revoked"
      ? `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>GitHub App access is unavailable.</strong> This Repository was not present in the last complete installation inventory. Cached data is retained; Atlas will not treat it as eligible for new work.</div></div>`
      : "",
    repository.accessStatus === "transferred"
      ? `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>Repository is outside the configured organization.</strong> Its cached data is retained and new work is paused.</div></div>`
      : "",
    repository.accessStatus === "suspended"
      ? `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>The GitHub App installation is suspended.</strong> Cached data is retained and new work is paused.</div></div>`
      : "",
  ].filter(Boolean).join("");
};

const specsNotice = (refresh: RefreshState | undefined, specs: Spec[]) => {
  if (!refresh || refresh.availability === "never") {
    return `<div class="alert alert-info mt-6 leading-normal" role="status"><div><strong>Specs have not synchronized yet.</strong> An unavailable first read is not shown as an empty list.</div></div>`;
  }
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="status"><div><strong>Specs synchronization is pending.</strong> ${specs.length > 0 ? `Showing the last complete sync from ${formatTime(refresh.lastSuccessAt)}.` : "No complete Specs sync is available yet."}</div></div>`;
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    const cached = specs.length > 0 ? ` Showing ${specs.length} Specs from the last complete sync at ${formatTime(refresh.lastSuccessAt)}.` : " No complete Specs sync is available yet.";
    return `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>Specs synchronization is unavailable.</strong>${cached} Known membership was not removed.</div></div>`;
  }
  if (refresh.lastSuccessAt && Date.now() - new Date(refresh.lastSuccessAt).valueOf() >= 10 * 60 * 1000) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>Specs synchronization is overdue.</strong> Last complete sync: ${formatTime(refresh.lastSuccessAt)}.</div></div>`;
  }
  if (refresh.failureReason) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="status">${escapeHtml(refresh.failureReason)}</div>`;
  }
  return "";
};

const renderRepositoryHeading = (repository: Repository, title: string, description: string, csrfToken?: string) => {
  const githubUrl = safeExternalUrl(repository.htmlUrl);
  const eligibility = eligibilityNotice(repository);
  return `<div class="flex flex-wrap items-start justify-between gap-6">
    <div class="min-w-0">
      <p class="font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
      <h1 id="page-title" class="mt-3 break-words text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>${escapeHtml(title)}</h1>
      <p class="mt-4 max-w-prose leading-relaxed text-muted">${escapeHtml(description)}</p>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <span class="badge ${accessBadgeClass(repository)}">${accessLabel(repository)}</span>
      ${githubUrl ? `<a class="btn btn-ghost min-h-11 border border-control-border" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">Open Repository on GitHub</a>` : ""}
      ${csrfToken ? repositoryAction(repository, csrfToken) : ""}
    </div>
  </div>
  ${eligibility ? `<div class="alert alert-warning mt-6 leading-normal" role="status">${escapeHtml(eligibility)}</div>` : ""}`;
};

const sessionStateLabel = (state: SessionState) => {
  if (state === "failed_setup") return "Failed — setup";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

const sessionBadgeClass = (state: SessionState) => {
  if (state === "running") return "badge-info";
  if (state === "waiting") return "badge-warning";
  if (state === "succeeded") return "badge-success";
  if (state === "failed" || state === "failed_setup" || state === "interrupted") return "badge-error";
  return "badge-neutral";
};

const handoffCheckpointLabel = (checkpoint: Session["handoffCheckpoint"]) => {
  if (checkpoint === "intent_saved") return "Intent saved";
  if (checkpoint === "events_consuming") return "Events consuming";
  if (checkpoint === "create_sent") return "Create sent once";
  if (checkpoint === "create_confirmed") return "Create confirmed";
  if (checkpoint === "associated") return "Association confirmed";
  if (checkpoint === "prompt_sent") return "Prompt sent once";
  if (checkpoint === "prompt_accepted") return "Prompt accepted";
  return "Not started";
};

const sessionFreshnessMarkup = (session: Session) => {
  const stale = session.opencodeFreshness === "stale";
  const preparationUncertain = session.preparationCheckpoint === "start_unconfirmed";
  const handoffUncertain = Boolean(session.handoffUncertainReason);
  return `${stale ? `<span class="badge badge-warning">Stale</span>` : ""}${preparationUncertain ? `<span class="badge badge-warning">Preparation unconfirmed</span>` : handoffUncertain ? `<span class="badge badge-warning">Start unconfirmed</span>` : ""}`;
};

const sessionHistoryRow = (session: Session) => `<li class="rounded-box bg-base-100 p-4 sm:p-5">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="font-mono text-sm text-muted">Session ${escapeHtml(session.atlasId)}</p>
      <h3 class="mt-2 text-lg font-semibold"><a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${`/sessions/${encodeURIComponent(session.atlasId)}`}">${escapeHtml(sessionStateLabel(session.state))} Session</a></h3>
    </div>
    <span class="flex flex-wrap items-center gap-2"><span class="badge ${sessionBadgeClass(session.state)}">${escapeHtml(sessionStateLabel(session.state))}</span>${sessionFreshnessMarkup(session)}</span>
  </div>
  <p class="mt-4 text-sm leading-normal text-muted">Submitted ${escapeHtml(formatTime(session.submittedAt))} · Queue order ${session.submissionOrder}</p>
</li>`;

const specRow = (spec: Spec, sessions: Session[] = []) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const latestSession = sessions[0];
  return `<li class="rounded-box bg-base-100 p-3 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="font-mono text-sm text-muted">Spec #${escapeHtml(spec.issueNumber)}</p>
        <h2 class="mt-2 break-words text-lg font-semibold"><a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="/repositories/${encodeURIComponent(spec.repositoryId)}/specs/${encodeURIComponent(spec.issueNumber)}">${escapeHtml(spec.title)}</a></h2>
      </div>
      <span class="badge badge-info">Open Spec</span>
    </div>
    <div class="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
      <span>Updated ${formatTime(spec.updatedAt)}</span>
      <span>Label: <code class="font-mono text-base-content">spec</code></span>
      ${githubUrl ? `<a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub issue</a>` : ""}
    </div>
    <div class="mt-5 flex flex-wrap items-center gap-3 text-sm">
      ${latestSession
        ? `<a class="text-brand-readable underline underline-offset-4" href="${`/sessions/${encodeURIComponent(latestSession.atlasId)}`}">${sessions.length} Atlas Session${sessions.length === 1 ? "" : "s"} · latest ${escapeHtml(sessionStateLabel(latestSession.state))}</a>`
        : `<span class="text-muted">No Atlas Sessions yet</span>`}
    </div>
  </li>`;
};

export const renderSpecsPage = ({
  csrfToken,
  repository,
  specs,
  sessionsBySpec,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  specs: Spec[];
  sessionsBySpec?: ReadonlyMap<string, Session[]>;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const canShowEmptyState = specsRefresh?.availability === "available"
    && specsRefresh.requestedGeneration <= specsRefresh.completedGeneration;
  const list = specs.length > 0
    ? `<ul class="mt-8 grid gap-4" aria-label="Open Specs">${specs.map((spec) => specRow(spec, sessionsBySpec?.get(spec.issueNumber) ?? [])).join("")}</ul>`
    : canShowEmptyState ? `<div class="mt-8 rounded-box bg-base-100 p-6">
        <p class="text-lg font-semibold">No open Specs</p>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">Open, non-PR GitHub issues carrying the exact <code class="font-mono text-base-content">spec</code> label appear here.</p>
      </div>` : "";

  return renderShell({
    title: `${repository.fullName} Specs`,
    active: "specs",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
       ${renderRepositoryHeading(repository, "Specs", "Open, non-PR GitHub issues labelled exactly spec.", csrfToken)}
      ${accessNotice(repository)}
      ${refreshWarning("Access", accessRefresh)}
      ${specsNotice(specsRefresh, specs)}
      <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
      ${list}
    </section>`,
  });
};

type TargetStatus = {
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

const targetVerificationStatus = (
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

const targetBadgeClass = (kind: TargetStatus["kind"]) =>
  kind === "eligible" ? "badge-success" : kind === "warning" ? "badge-warning" : "badge-error";

const pullRequestLifecycle = (pullRequest: PullRequest) => {
  if (pullRequest.mergedAt) return "Merged";
  if (pullRequest.state === "open") return pullRequest.draft ? "Draft" : "Open";
  return "Closed";
};

const pullRequestStateBadge = (pullRequest: PullRequest) => {
  const className = pullRequest.mergedAt
    ? "badge-success"
    : pullRequest.state === "open"
      ? pullRequest.draft ? "badge-warning" : "badge-info"
      : "badge-neutral";
  return `<span class="badge ${className}">${pullRequestLifecycle(pullRequest)}</span>`;
};

const mergeRestriction = (pullRequest: PullRequest): string | undefined => {
  if (pullRequest.autoMergeEnabled === true) return "Auto-merge is enabled on the top layer.";
  if (pullRequest.autoMergeEnabled === null) return "Auto-merge state could not be verified.";
  if (pullRequest.mergeQueueState === null) return "Merge-queue state could not be verified.";
  if (pullRequest.mergeQueueState !== "none") return "The top layer is in a GitHub merge queue.";
  return undefined;
};

const standaloneStatus = (repository: Repository, pullRequest: PullRequest, targetGate?: TargetStatus): TargetStatus => {
  if (targetGate) return targetGate;
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

const stackStatus = (
  repository: Repository,
  stack: PrStack,
  pullRequests: Map<string, PullRequest>,
  targetGate?: TargetStatus,
): TargetStatus => {
  if (targetGate) return targetGate;
  if (stack.members.length === 0) {
    return { kind: "warning", label: "Waiting for verification", reason: "The native stack has no verified ordered members." };
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

const pullRequestLink = (pullRequest: PullRequest) => {
  const url = safeExternalUrl(pullRequest.htmlUrl);
  return url ? `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">#${escapeHtml(pullRequest.number)} ${escapeHtml(pullRequest.title)}</a>` : `#${escapeHtml(pullRequest.number)} ${escapeHtml(pullRequest.title)}`;
};

const renderStack = (
  repository: Repository,
  stack: PrStack,
  pullRequests: Map<string, PullRequest>,
  targetGate?: TargetStatus,
) => {
  const members = [...stack.members].sort((left, right) => left.position - right.position);
  const status = stackStatus(repository, stack, pullRequests, targetGate);
  return `<li class="rounded-box bg-base-100 p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="break-words text-lg font-semibold">Native stack #${escapeHtml(stack.number)}</h2>
        <p class="mt-2 text-sm text-muted">Trunk: <code class="font-mono text-base-content">${escapeHtml(stack.trunkRef ?? "unknown")}</code> · Global ID: <code class="font-mono text-base-content">${escapeHtml(stack.githubId)}</code>${stack.nodeId ? ` · Node ID: <code class="font-mono text-base-content">${escapeHtml(stack.nodeId)}</code>` : ""}</p>
      </div>
      <span class="badge ${targetBadgeClass(status.kind)}">${escapeHtml(status.label)}</span>
    </div>
    <ol class="mt-5 grid gap-2" aria-label="Native stack #${escapeHtml(stack.number)} ordered members">
      ${members.map((member) => {
        const pullRequest = pullRequests.get(member.pullRequestId);
        return `<li class="flex flex-wrap items-center justify-between gap-3 rounded-field border border-base-300 px-3 py-3">
          <span class="min-w-0 break-words"><span class="mr-2 font-mono text-sm text-muted">${member.position}.</span>${pullRequest ? pullRequestLink(pullRequest) : `<span class="text-warning">Pull request unavailable</span>`}</span>
          <span class="flex flex-wrap items-center gap-2">${pullRequest ? pullRequestStateBadge(pullRequest) : ""}${member.position === members[members.length - 1]?.position ? `<span class="badge badge-info">Top</span>` : ""}</span>
        </li>`;
      }).join("")}
    </ol>
    <p class="mt-4 text-sm leading-normal text-muted">${escapeHtml(status.reason)}</p>
  </li>`;
};

const renderActivePullRequest = (pullRequest: PullRequest) => `<li class="rounded-box bg-base-100 p-4 sm:p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="break-words text-lg font-semibold">${pullRequestLink(pullRequest)}</h2>
      <p class="mt-2 text-sm text-muted">${pullRequest.stack ? `Native stack #${escapeHtml(pullRequest.stack.stackNumber)}, position ${pullRequest.stack.position} of ${pullRequest.stack.size}` : "Standalone Pull request"}</p>
    </div>
    ${pullRequestStateBadge(pullRequest)}
  </div>
  <dl class="mt-5 grid gap-3 text-sm sm:grid-cols-2">
    <div><dt class="font-medium text-muted">Head</dt><dd class="mt-1 break-words font-mono">${escapeHtml(pullRequest.headRef)}</dd></div>
    <div><dt class="font-medium text-muted">Base</dt><dd class="mt-1 break-words font-mono">${escapeHtml(pullRequest.baseRef)}</dd></div>
    <div><dt class="font-medium text-muted">Head ref</dt><dd class="mt-1 break-words">${pullRequest.headRefExists === true ? `Verified at <code class="font-mono">${escapeHtml(pullRequest.observedHeadSha ?? "unknown SHA")}</code>` : pullRequest.headRefExists === false ? "Missing" : "Unknown"}</dd></div>
    <div><dt class="font-medium text-muted">Updated</dt><dd class="mt-1">${formatTime(pullRequest.updatedAt)}</dd></div>
  </dl>
</li>`;

const renderStandaloneTarget = (repository: Repository, pullRequest: PullRequest, targetGate?: TargetStatus) => {
  const status = standaloneStatus(repository, pullRequest, targetGate);
  return `<li class="rounded-box bg-base-100 p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0"><h2 class="break-words text-lg font-semibold">${pullRequestLink(pullRequest)}</h2><p class="mt-2 text-sm text-muted">Standalone candidate · base <code class="font-mono text-base-content">${escapeHtml(pullRequest.baseRef)}</code></p></div>
      <span class="badge ${targetBadgeClass(status.kind)}">${escapeHtml(status.label)}</span>
    </div>
    <p class="mt-4 leading-normal text-muted">${escapeHtml(status.reason)}</p>
  </li>`;
};

export const renderPullRequestsPage = ({
  csrfToken,
  repository,
  pullRequests,
  stacks,
  accessRefresh,
  refresh,
}: {
  csrfToken: string;
  repository: Repository;
  pullRequests: PullRequest[];
  stacks: PrStack[];
  accessRefresh?: RefreshState;
  refresh?: RefreshState;
}) => {
  const activePullRequests = pullRequests.filter((pullRequest) => pullRequest.isCurrent && pullRequest.state === "open");
  const pullRequestMap = new Map(pullRequests.map((pullRequest) => [pullRequest.githubId, pullRequest]));
  const standalone = activePullRequests.filter((pullRequest) => !pullRequest.stack);
  const targetGate = targetVerificationStatus(repository, accessRefresh, refresh);
  const canShowEmptyState = refresh?.availability === "available"
    && refresh.requestedGeneration <= refresh.completedGeneration;
  const notice = refreshWarning("Pull requests", refresh);
  const empty = canShowEmptyState && activePullRequests.length === 0 && stacks.length === 0
    ? `<div class="mt-8 rounded-box bg-base-100 p-6"><p class="text-lg font-semibold">No active Pull requests or native stacks</p><p class="mt-2 max-w-prose leading-relaxed text-muted">Open GitHub Pull requests and explicitly registered native stacks appear here.</p></div>`
    : "";
  const stackList = stacks.length > 0
    ? `<section class="mt-8" aria-labelledby="native-stacks-heading"><h2 id="native-stacks-heading" class="text-lg font-semibold">Native PR stacks</h2><p class="mt-2 max-w-prose leading-relaxed text-muted">GitHub's explicit bottom-to-top order is shown here. Atlas does not infer stacks from branch names or change GitHub state.</p><ul class="mt-4 grid gap-4">${stacks.map((stack) => renderStack(repository, stack, pullRequestMap, targetGate)).join("")}</ul></section>`
    : "";
  const activeList = activePullRequests.length > 0
    ? `<section class="mt-8" aria-labelledby="active-pull-requests-heading"><h2 id="active-pull-requests-heading" class="text-lg font-semibold">Active Pull requests</h2><ul class="mt-4 grid gap-4">${activePullRequests.map(renderActivePullRequest).join("")}</ul></section>`
    : "";
  const standaloneList = standalone.length > 0
    ? `<section class="mt-8" aria-labelledby="standalone-targets-heading"><h2 id="standalone-targets-heading" class="text-lg font-semibold">Standalone target classification</h2><p class="mt-2 max-w-prose leading-relaxed text-muted">Only open Pull requests outside an explicit native stack are considered here. Classification is read-only; no start or GitHub mutation is available in this slice.</p><ul class="mt-4 grid gap-4">${standalone.map((pullRequest) => renderStandaloneTarget(repository, pullRequest, targetGate)).join("")}</ul></section>`
    : "";

  return renderShell({
    title: `${repository.fullName} Pull requests`,
    active: "pull-requests",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
       ${renderRepositoryHeading(repository, "Pull requests", "Active GitHub Pull requests, explicit native stack order, and read-only starting-target classification.", csrfToken)}
      ${accessNotice(repository)}
      ${refreshWarning("Access", accessRefresh)}
      ${notice}
      <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Pull requests", refresh)}</p>
      ${empty}
      ${stackList}
      ${activeList}
      ${standaloneList}
    </section>`,
  });
};

export const renderSpecDetailPage = ({
  csrfToken,
  repository,
  spec,
  sessions,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  spec: Spec;
  sessions?: Session[];
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const retained = !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);
   const canStart = !retained && repository.accessStatus === "available" && !repository.removedAt && !repository.archived && !repository.disabled && repository.hasIssues && Boolean(repository.defaultBranch);
  const labels = spec.labels.length > 0
    ? spec.labels.map((label) => `<span class="badge ${label === "spec" ? "badge-info" : ""}">${escapeHtml(label)}</span>`).join(" ")
    : `<span class="text-sm text-muted">No labels recorded</span>`;

  return renderShell({
    title: `Spec #${spec.issueNumber}`,
    active: "spec",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
      <a class="text-sm text-brand-readable underline underline-offset-4" href="${repositoryLink(repository)}">← Back to Specs</a>
      <div class="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div class="min-w-0">
          <p class="font-mono text-sm text-muted">Spec #${escapeHtml(spec.issueNumber)}</p>
          <h1 id="page-title" class="mt-3 break-words text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>${escapeHtml(spec.title)}</h1>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="badge ${retained ? "badge-warning" : "badge-info"}">${retained ? "Retained snapshot" : "Open Spec"}</span>
          ${githubUrl ? `<a class="btn btn-ghost min-h-11 border border-control-border" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
          ${canStart ? `<a class="btn btn-primary min-h-11 border border-control-border" href="${`/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(spec.issueNumber)}/sessions/new`}">Start Session</a>` : ""}
        </div>
      </div>
      ${accessNotice(repository)}
      ${refreshWarning("Access", accessRefresh)}
      ${refreshWarning("Specs", specsRefresh)}
      ${retained ? `<div class="alert alert-warning mt-6 leading-normal" role="status">This issue is no longer in the active Specs projection. Atlas retains the last complete snapshot for this direct link.</div>` : ""}
      <div class="mt-8 flex flex-wrap items-center gap-2" aria-label="Spec labels">${labels}</div>
      <dl class="mt-6 grid gap-4 border-y border-base-300 py-5 text-sm sm:grid-cols-2">
        <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
        <div><dt class="font-medium text-muted">Last updated</dt><dd class="mt-1">${formatTime(spec.updatedAt)}</dd></div>
        <div><dt class="font-medium text-muted">Last observed</dt><dd class="mt-1">${formatTime(spec.observedAt)}</dd></div>
        <div><dt class="font-medium text-muted">Specs freshness</dt><dd class="mt-1">${refreshLine("Specs", specsRefresh)}</dd></div>
      </dl>
      <article class="mt-8 max-w-prose rounded-box bg-base-100 p-5 sm:p-6">
        <h2 class="text-lg font-semibold">Spec description</h2>
        <div class="mt-5 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(spec.body) || "No description provided."}</div>
      </article>
      <section class="mt-10" aria-labelledby="session-history-title">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="session-history-title" class="text-lg font-semibold">Session history</h2>
            <p class="mt-2 text-sm leading-normal text-muted">Atlas attempts for this Spec, including queued work.</p>
          </div>
          <a class="text-sm text-brand-readable underline underline-offset-4" href="${sessionsLink(repository)}">View Repository Sessions</a>
        </div>
        ${(sessions?.length ?? 0) > 0
          ? `<ul class="mt-5 grid gap-4" aria-label="Session history">${sessions!.map(sessionHistoryRow).join("")}</ul>`
          : `<div class="mt-5 rounded-box bg-base-100 p-5"><p class="font-medium">No Atlas Sessions yet</p><p class="mt-2 text-sm leading-normal text-muted">Starting a Session will preserve its prompt and Spec snapshot here.</p></div>`}
      </section>
    </section>`,
  });
};

export const renderStartSessionForm = ({
  action,
  csrfToken,
  submissionId,
  prompt,
  error,
  existingSession,
}: {
  action: string;
  csrfToken: string;
  submissionId: string;
  prompt: string;
  error?: string;
  existingSession?: Session;
}) => {
  const errorMarkup = error
    ? `<div id="prompt-error" class="alert alert-error mt-6 leading-normal" role="alert" tabindex="-1" data-focus-on-swap>
        <div><strong>Session was not queued.</strong><p class="mt-1">${escapeHtml(error)}</p>${existingSession ? `<a class="mt-3 inline-block text-brand-readable underline underline-offset-4" href="${`/sessions/${encodeURIComponent(existingSession.atlasId)}`}">Open the existing Session</a>` : ""}</div>
      </div>`
    : "";
  const errorAttributes = error ? ' aria-describedby="prompt-error" aria-invalid="true"' : "";

  return `<form id="start-session-form" class="mt-8 max-w-2xl" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="#start-session-form" hx-swap="outerHTML" hx-indicator="#start-session-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="submission_id" value="${escapeHtml(submissionId)}">
    <div>
      <label class="label mb-2 block p-0" for="initial-prompt">Initial prompt</label>
      <textarea id="initial-prompt" class="textarea textarea-bordered min-h-48 w-full border-control-border bg-base-100 text-base-content" name="prompt" rows="9" maxlength="20000" required${errorAttributes}>${escapeHtml(prompt)}</textarea>
      <p class="mt-2 text-sm leading-normal text-muted">Tell the Agent what to implement. Atlas preserves this text unchanged. Maximum 20,000 characters.</p>
    </div>
    ${errorMarkup}
    <div class="mt-8 flex flex-wrap items-center gap-4">
      <button class="btn btn-primary min-h-11 border border-control-border" type="submit">Start Session</button>
      <a class="btn btn-ghost min-h-11 border border-control-border" href="${escapeHtml(action.replace(/\/sessions$/, ""))}">Cancel</a>
      <span id="start-session-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Starting Session…</span>
    </div>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

export const renderStartSessionPage = ({
  action,
  csrfToken,
  repository,
  spec,
  submissionId,
  prompt,
  error,
  notice,
  existingSession,
  accessRefresh,
  specsRefresh,
}: {
  action?: string;
  csrfToken: string;
  repository: Repository;
  spec: Spec;
  submissionId: string;
  prompt: string;
  error?: string;
  notice?: string;
  existingSession?: Session;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const formAction = action ?? `/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(spec.issueNumber)}/sessions`;
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const retained = !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);

  return renderShell({
    title: `Start Session · Spec #${spec.issueNumber}`,
    active: "spec",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
      <a class="text-sm text-brand-readable underline underline-offset-4" href="${repositoryLink(repository)}">← Back to Specs</a>
      <div class="mt-6">
        <p class="font-mono text-sm text-muted">Spec #${escapeHtml(spec.issueNumber)}</p>
        <h1 id="page-title" class="mt-3 break-words text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Start Session</h1>
       <p class="mt-4 max-w-prose leading-relaxed text-muted">Queue one Atlas implementation attempt for <strong class="text-base-content">${escapeHtml(spec.title)}</strong>. Opening or cancelling this form creates nothing.</p>
       </div>
       ${accessNotice(repository)}
       ${retained ? `<div class="alert alert-warning mt-6 leading-normal" role="alert">This is a retained Spec snapshot and is not currently eligible for a new Session.</div>` : ""}
      <dl class="mt-8 grid gap-4 border-y border-base-300 py-5 text-sm sm:grid-cols-2">
        <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
        <div><dt class="font-medium text-muted">Starting base</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.defaultBranch ?? "not available")}</dd></div>
        <div><dt class="font-medium text-muted">Spec</dt><dd class="mt-1">${githubUrl ? `<a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">Open issue on GitHub</a>` : "Snapshot retained"}</dd></div>
        <div><dt class="font-medium text-muted">Queueing</dt><dd class="mt-1">Default branch only; preparation is deferred.</dd></div>
      </dl>
      ${notice ? `<div class="alert alert-info mt-8 leading-normal" role="status" tabindex="-1" data-focus-on-swap>${escapeHtml(notice)}</div>` : ""}
      ${renderStartSessionForm({ action: formAction, csrfToken, submissionId, prompt, error, existingSession })}
      <details class="mt-8 max-w-prose rounded-box bg-base-100 p-5 sm:p-6">
        <summary class="min-h-11 cursor-pointer text-lg font-semibold">View Spec context</summary>
        <div class="mt-5 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(spec.body) || "No description provided."}</div>
      </details>
      <p class="mt-6 text-sm leading-normal text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
    </section>`,
  });
};

export const renderPendingStartSessionFragment = ({
  action,
  csrfToken,
  submissionId,
  prompt,
}: PendingStartSession & { csrfToken: string }) => `<div id="login-form">
  <div class="alert alert-info mt-8 leading-normal" role="status" tabindex="-1" data-focus-on-swap>Signed in. Review the preserved form, then choose Start Session to retry it.</div>
  ${renderStartSessionForm({ action, csrfToken, submissionId, prompt })}
</div>`;

export const renderPendingStartSessionPage = ({
  action,
  csrfToken,
  submissionId,
  prompt,
}: PendingStartSession & { csrfToken: string }) => document(
  "Retry Start Session",
  `${skipLink}
  <header class="atlas-glass border-b border-base-content/16">
    <div class="mx-auto flex min-h-20 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
      <div><p class="text-lg font-semibold tracking-tight">Atlas</p><p class="text-sm text-muted">Private sign-in</p></div>
    </div>
  </header>
  <main id="main-content" class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <section class="atlas-glass w-full rounded-box p-6 sm:p-10 lg:max-w-2xl">
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Sign-in complete</p>
      <h1 class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Review and retry Start Session</h1>
      <p class="mt-4 max-w-prose leading-relaxed text-muted">Your original prompt and submission identity are preserved below. Choose Start Session when you are ready; Atlas will not resubmit automatically.</p>
      ${renderStartSessionForm({ action, csrfToken, submissionId, prompt })}
    </section>
  </main>`,
);

const sessionFilterLabel = (filter: SessionFilter) => {
  if (filter === "active") return "Active";
  if (filter === "all") return "All";
  return sessionStateLabel(filter);
};

const sessionListRow = (session: Session) => `<li class="rounded-box bg-base-100 p-4 sm:p-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="font-mono text-sm text-muted">Session ${escapeHtml(session.atlasId)}</p>
      <h2 class="mt-2 break-words text-lg font-semibold"><a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${`/sessions/${encodeURIComponent(session.atlasId)}`}">Spec #${escapeHtml(session.specIssueNumber)}: ${escapeHtml(session.specTitle)}</a></h2>
    </div>
    <span class="flex flex-wrap items-center gap-2"><span class="badge ${sessionBadgeClass(session.state)}">${escapeHtml(sessionStateLabel(session.state))}</span>${sessionFreshnessMarkup(session)}</span>
  </div>
  <dl class="mt-5 grid gap-3 text-sm text-muted sm:grid-cols-2">
    <div><dt class="font-medium text-base-content">Submitted</dt><dd class="mt-1">${escapeHtml(formatTime(session.submittedAt))}</dd></div>
    <div><dt class="font-medium text-base-content">Queue order</dt><dd class="mt-1 tabular-nums">${session.submissionOrder}</dd></div>
    <div><dt class="font-medium text-base-content">Target</dt><dd class="mt-1">Default branch · <code class="font-mono text-base-content">${escapeHtml(session.targetBranch)}</code></dd></div>
    <div><dt class="font-medium text-base-content">Execution slot</dt><dd class="mt-1">${session.executionSlotHeld ? "Held" : "Not held"}</dd></div>
  </dl>
  <p class="mt-5 max-w-prose truncate text-sm text-muted">Prompt: ${escapeHtml(session.prompt)}</p>
  ${session.stateReason ? `<p class="mt-3 max-w-prose text-sm leading-normal text-muted">${escapeHtml(session.stateReason)}</p>` : ""}
  <a class="btn btn-ghost mt-5 min-h-11 border border-control-border" href="${`/sessions/${encodeURIComponent(session.atlasId)}`}">View Session</a>
</li>`;

export const renderSessionsPage = ({
  csrfToken,
  repository,
  sessions,
  filter,
}: {
  csrfToken: string;
  repository: Repository;
  sessions: Session[];
  filter: SessionFilter;
}) => {
  const filters: SessionFilter[] = ["active", "all", "queued", "preparing", "running", "waiting", "idle", "succeeded", "failed", "interrupted", "failed_setup"];
  const heading = filter === "active" ? "Active Sessions" : filter === "all" ? "Sessions" : `${sessionFilterLabel(filter)} Sessions`;
  const emptyText = filter === "active"
    ? "No unfinished Sessions are present in this Repository."
    : filter === "all"
      ? "No Atlas Sessions have been submitted for this Repository."
      : `No Sessions currently have the ${sessionFilterLabel(filter)} state.`;

  return renderShell({
    title: `${repository.fullName} Sessions`,
    active: "sessions",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
       ${renderRepositoryHeading(repository, heading, "Atlas implementation attempts for this Repository. Active includes every unfinished Session, including Queued.", csrfToken)}
      <nav class="mt-8 flex flex-wrap gap-2" aria-label="Session status filters">
        ${filters.map((value) => `<a class="btn ${value === filter ? "btn-primary border border-control-border" : "btn-ghost border border-control-border"} min-h-11" href="${value === "active" ? sessionsLink(repository) : `${sessionsLink(repository)}?status=${encodeURIComponent(value)}`}"${value === filter ? ' aria-current="page"' : ""}>${escapeHtml(sessionFilterLabel(value))}</a>`).join("")}
      </nav>
      ${sessions.length > 0
        ? `<ul class="mt-8 grid gap-4" aria-label="${escapeHtml(heading)}">${sessions.map(sessionListRow).join("")}</ul>`
        : `<div class="mt-8 rounded-box bg-base-100 p-6"><p class="text-lg font-semibold">${escapeHtml(filter === "active" ? "No active Sessions" : "No matching Sessions")}</p><p class="mt-2 max-w-prose leading-relaxed text-muted">${escapeHtml(emptyText)}</p></div>`}
    </section>`,
  });
};

const viewerJson = (value: unknown) => {
  try {
    return escapeHtml(JSON.stringify(value, null, 2) ?? "[unavailable]");
  } catch {
    return "[unavailable]";
  }
};

const viewerTimestamp = (value: number | undefined) => value === undefined
  ? "Unknown time"
  : formatTime(new Date(value).toISOString());

const viewerStatusLabel = (state: ViewerSessionNode["semanticState"]) => {
  if (state === "running") return "Running";
  if (state === "waiting") return "Waiting";
  if (state === "succeeded") return "Succeeded";
  if (state === "failed") return "Failed";
  if (state === "interrupted") return "Interrupted";
  return "Idle";
};

const viewerStatusClass = (state: ViewerSessionNode["semanticState"]) => {
  if (state === "running") return "badge-info";
  if (state === "waiting") return "badge-warning";
  if (state === "succeeded") return "badge-success";
  if (state === "failed" || state === "interrupted") return "badge-error";
  return "badge-neutral";
};

const renderToolContent = (content: readonly { type: string; text?: string; uri?: string; mime?: string; name?: string | null }[] | undefined) =>
  content && content.length > 0
    ? `<ul class="mt-3 grid gap-2" aria-label="Tool output">${content.map((item) => {
      if (item.type === "file") {
        const link = item.uri ? safeExternalUrl(item.uri) : "";
        return `<li class="rounded-field border border-base-300 px-3 py-3 text-sm"><span class="font-medium">File</span> · ${escapeHtml(item.name ?? item.uri ?? "unnamed")} <span class="text-muted">${escapeHtml(item.mime ?? "unknown type")}</span>${link ? ` · <a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open safe link</a>` : ""}</li>`;
      }
      return `<li><pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-field bg-base-300 p-3 font-mono text-sm leading-relaxed">${escapeHtml(item.text ?? "")}</pre></li>`;
    }).join("")}</ul>`
    : "";

const renderTool = (tool: Extract<NonNullable<Extract<ViewerSessionNode["messages"][number], { type: "assistant" }>["content"]>[number], { type: "tool" }>) => {
  const state = tool.state;
  const stateLabel = state.status === "streaming" ? "Streaming input" : state.status === "running" ? "Running" : state.status === "completed" ? "Completed" : "Error";
  const input = state.status === "streaming" ? state.input : state.input;
  const details = state.status === "streaming"
    ? `<pre class="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-field bg-base-300 p-3 font-mono text-sm leading-relaxed">${escapeHtml(String(input))}</pre>`
    : `<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt class="font-medium text-muted">Input</dt><dd class="mt-1"><pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-field bg-base-300 p-3 font-mono leading-relaxed">${viewerJson(input)}</pre></dd></div>${state.status === "running" ? `<div><dt class="font-medium text-muted">Progress</dt><dd class="mt-1"><pre class="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-field bg-base-300 p-3 font-mono leading-relaxed">${viewerJson(state.metadata)}</pre></dd></div>` : ""}</dl>`;
  const output = state.status === "completed" || state.status === "error" ? renderToolContent(state.content) : "";
  const error = state.status === "error" ? `<div class="alert alert-error mt-3 leading-normal" role="alert"><strong>${escapeHtml(state.error.type)}</strong>: ${escapeHtml(state.error.message)}</div>` : "";
  return `<article class="mt-4 rounded-field border border-base-300 bg-base-100 p-4" data-tool-id="${escapeHtml(tool.id)}">
    <div class="flex flex-wrap items-center justify-between gap-3"><h4 class="font-medium break-words">Tool · ${escapeHtml(tool.name)}</h4><span class="badge ${state.status === "error" ? "badge-error" : state.status === "completed" ? "badge-success" : state.status === "running" ? "badge-info" : "badge-warning"}">${stateLabel}</span></div>
    ${details}${error}${output}
  </article>`;
};

const renderAssistantContent = (message: Extract<ViewerSessionNode["messages"][number], { type: "assistant" }>) => message.content.map((part) => {
  if (part.type === "text") return `<div class="mt-4 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(part.text)}</div>`;
  if (part.type === "reasoning") return `<details class="mt-4 rounded-field border border-base-300 bg-base-100 p-4" open><summary class="flex min-h-11 cursor-pointer items-center font-medium">Public reasoning</summary><div class="mt-3 whitespace-pre-wrap break-words leading-relaxed text-muted">${escapeHtml(part.text) || "No public reasoning text was exposed."}</div></details>`;
  return renderTool(part);
}).join("");

type UserMessage = Extract<ViewerSessionNode["messages"][number], { type: "user" }>;

const renderUserAttachments = (message: UserMessage) => {
  if (!message.files || message.files.length === 0) return "";
  return `<section class="mt-5" aria-label="User attachments"><h4 class="font-medium">Attachments</h4><ul class="mt-3 grid gap-2">${message.files.map((file) => {
    const source = file.source.type === "inline"
      ? "Inline attachment"
      : safeExternalUrl(file.source.uri)
        ? `<a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(safeExternalUrl(file.source.uri))}" target="_blank" rel="noopener noreferrer">Open safe source</a>`
        : "Referenced source (not linked)";
    return `<li class="rounded-field border border-base-300 px-3 py-3 text-sm"><p class="font-medium break-words">${escapeHtml(file.name ?? "Unnamed attachment")}</p><p class="mt-1 text-muted">${escapeHtml(file.mime)} · ${source}</p>${file.description ? `<p class="mt-2 whitespace-pre-wrap break-words">${escapeHtml(file.description)}</p>` : ""}</li>`;
  }).join("")}</ul></section>`;
};

const shellOutputHref = (node: ViewerSessionNode, rootId: string, endpoint: string, limit: number, requestUrl: string | undefined, shellId: string, cursor: number) => {
  const url = new URL(requestUrl ?? endpoint, "http://atlas.invalid");
  if (node.info.id === rootId) url.searchParams.delete("child");
  else url.searchParams.set("child", node.info.id);
  url.searchParams.set("shell", shellId);
  url.searchParams.set("shellCursor", String(cursor));
  url.searchParams.set("limit", String(limit));
  return `${url.pathname}${url.search}`;
};

const requestedShellOutputCursor = (requestUrl: string | undefined, shellId: string) => {
  try {
    const value = new URL(requestUrl ?? "", "http://atlas.invalid").searchParams;
    if (value.get("shell") !== shellId) return 0;
    const cursor = Number(value.get("shellCursor") ?? "0");
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  } catch {
    return 0;
  }
};

const shellOutputHasMore = (output: { cursor: number; size: number }) =>
  Number.isSafeInteger(output.cursor) && Number.isSafeInteger(output.size) && output.cursor >= 0 && output.cursor < output.size;

const nextShellOutputCursor = (output: { cursor: number; size: number }, requestedCursor = 0) =>
  shellOutputHasMore(output) && output.cursor > requestedCursor ? output.cursor : undefined;

const renderShellOutput = (
  output: { output: string; cursor: number; size: number; truncated: boolean },
  nextHref?: string,
  requestedCursor = 0,
) => {
  const more = shellOutputHasMore(output);
  const stalled = more && output.cursor <= requestedCursor;
  const warning = more
    ? `<div class="alert alert-warning mt-3 leading-normal" role="status"><strong>${output.truncated ? "Output is capped in this projection; more output is available." : "Output continues in a later page."}</strong> This page ends at byte ${escapeHtml(String(output.cursor))} of ${escapeHtml(String(output.size))}.${nextHref ? ` <a class="link link-hover font-medium" href="${escapeHtml(nextHref)}">Load next output page</a>.` : stalled ? " The upstream cursor did not advance, so no continuation link is offered." : ""}</div>`
    : "";
  return `<pre class="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-field bg-base-300 p-4 font-mono text-sm leading-relaxed">${escapeHtml(output.output)}</pre>${warning}`;
};

const renderViewerMessage = (message: ViewerSessionNode["messages"][number], nextShellOutputHref?: string, requestedShellCursor = 0) => {
  const time = viewerTimestamp(message.time.created);
  if (message.type === "assistant") {
    return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">Assistant</h3><time class="text-sm text-muted" datetime="${escapeHtml(new Date(message.time.created).toISOString())}">${escapeHtml(time)}</time></div>${renderAssistantContent(message)}${message.error ? `<div class="alert alert-error mt-4 leading-normal" role="alert"><strong>${escapeHtml(message.error.type)}</strong>: ${escapeHtml(message.error.message)}</div>` : ""}${message.retry ? `<p class="mt-4 text-sm text-warning">Retry ${message.retry.attempt} scheduled: ${escapeHtml(message.retry.error.message)}</p>` : ""}</li>`;
  }
  if (message.type === "user") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">User message</h3><time class="text-sm text-muted">${escapeHtml(time)}</time></div><div class="mt-4 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(message.text)}</div>${renderUserAttachments(message)}</li>`;
  if (message.type === "shell") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">Session shell · ${escapeHtml(message.command)}</h3><span class="badge ${message.status === "exited" ? "badge-success" : message.status === "running" ? "badge-info" : "badge-warning"}">${escapeHtml(message.status)}</span></div><p class="mt-2 text-sm text-muted">${escapeHtml(time)}${message.exit !== undefined ? ` · exit ${escapeHtml(String(message.exit))}` : ""}</p>${message.output ? renderShellOutput(message.output, nextShellOutputHref, requestedShellCursor) : `<p class="mt-4 text-sm text-muted">Shell output is not present in this projection.</p>`}</li>`;
  if (message.type === "compaction") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">Context compaction</h3><span class="badge badge-warning">${escapeHtml(message.status)}</span></div><p class="mt-3 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(message.status === "failed" ? message.error.message : message.summary)}</p></li>`;
  if (message.type === "system" || message.type === "synthetic") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><h3 class="font-medium">${message.type === "system" ? "System" : "Synthetic"}</h3><p class="mt-3 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(message.text)}</p></li>`;
  if (message.type === "skill") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><h3 class="font-medium">Skill · ${escapeHtml(message.name)}</h3><p class="mt-3 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(message.text)}</p></li>`;
  if (message.type === "agent-switched") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><p class="font-medium">Agent selected: <code class="font-mono">${escapeHtml(message.agent)}</code></p></li>`;
  if (message.type === "model-switched") return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><p class="font-medium">Model selected: <code class="font-mono">${escapeHtml(message.model.providerID)}/${escapeHtml(message.model.id)}</code></p></li>`;
  return `<li class="rounded-box bg-base-100 p-4 sm:p-6" data-message-id="${escapeHtml(message.id)}"><p class="font-medium">Location changed</p><p class="mt-2 text-sm text-muted">${escapeHtml(message.location.directory)}</p></li>`;
};

const renderViewerPending = (node: ViewerSessionNode) => {
  const { permissions, forms, inbox } = node.pending;
  if (permissions.length === 0 && forms.length === 0 && inbox.length === 0) return "";
  return `<section class="mt-8" aria-labelledby="pending-${escapeHtml(node.info.id)}"><h3 id="pending-${escapeHtml(node.info.id)}" class="text-lg font-semibold">Pending OpenCode work</h3><p class="mt-2 text-sm leading-normal text-muted">These records are displayed view-only. Atlas does not reply, cancel, or resume them.</p>${permissions.length > 0 ? `<div class="mt-4 rounded-box bg-base-100 p-4"><h4 class="font-medium">Permission requests</h4><ul class="mt-3 grid gap-3">${permissions.map((permission) => `<li class="rounded-field border border-base-300 p-3"><p class="font-medium">${escapeHtml(permission.action)}</p><p class="mt-1 break-words text-sm text-muted">${escapeHtml(permission.resources.join(", "))}</p>${permission.message ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm">${escapeHtml(permission.message)}</p>` : ""}</li>`).join("")}</ul></div>` : ""}${forms.length > 0 ? `<div class="mt-4 rounded-box bg-base-100 p-4"><h4 class="font-medium">Forms</h4><ul class="mt-3 grid gap-3">${forms.map((form) => `<li class="rounded-field border border-base-300 p-3"><p class="font-medium">${escapeHtml(form.title)}</p><p class="mt-1 text-sm text-muted">${form.fields.length} field${form.fields.length === 1 ? "" : "s"} · response controls are disabled</p></li>`).join("")}</ul></div>` : ""}${inbox.length > 0 ? `<div class="mt-4 rounded-box bg-base-100 p-4"><h4 class="font-medium">Queued inbox work</h4><p class="mt-2 text-sm leading-normal text-muted">Inbox work is not treated as proof that a person is being asked to respond.</p><p class="mt-2 text-sm">${inbox.length} queued item${inbox.length === 1 ? "" : "s"}</p></div>` : ""}</section>`;
};

const renderViewerShells = (node: ViewerSessionNode, rootId: string, endpoint: string, limit: number, requestUrl?: string) => node.shells.length === 0 ? "" : `<section class="mt-8" aria-labelledby="shells-${escapeHtml(node.info.id)}"><h3 id="shells-${escapeHtml(node.info.id)}" class="text-lg font-semibold">Running generic shells</h3><p class="mt-2 text-sm leading-normal text-muted">Only shells explicitly correlated to this Session are shown. Exited generic shells may not be recoverable after a disconnect.</p><ul class="mt-4 grid gap-4">${node.shells.map((shell) => { const requestedCursor = requestedShellOutputCursor(requestUrl, shell.info.id); const nextCursor = shell.output ? nextShellOutputCursor(shell.output, requestedCursor) : undefined; return `<li class="rounded-box bg-base-100 p-4"><div class="flex flex-wrap items-center justify-between gap-3"><code class="break-words font-mono">${escapeHtml(shell.info.command)}</code><span class="badge badge-info">${escapeHtml(shell.info.status)}</span></div><p class="mt-2 text-sm text-muted">${escapeHtml(shell.info.cwd)}</p>${shell.output ? renderShellOutput(shell.output, nextCursor === undefined ? undefined : shellOutputHref(node, rootId, endpoint, limit, requestUrl, shell.info.id, nextCursor), requestedCursor) : shell.outputUnavailable ? `<p class="mt-4 text-sm text-warning">Shell output is currently unavailable.</p>` : ""}</li>`; }).join("")}</ul></section>`;

const renderViewerNode = (node: ViewerSessionNode, selectedId: string, rootId: string, endpoint: string, limit: number, requestUrl?: string) => {
  const childLinks = node.children.length > 0
    ? `<section class="mt-8" aria-labelledby="descendants-${escapeHtml(node.info.id)}"><h3 id="descendants-${escapeHtml(node.info.id)}" class="text-lg font-semibold">Descendant Sessions</h3><p class="mt-2 text-sm leading-normal text-muted">Relationships are verified through OpenCode Session records. A child is called an active subagent only when active execution and its agent mode both support that label.</p><ul class="mt-4 grid gap-3">${node.children.map((child) => `<li class="rounded-box bg-base-100 p-4"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><p class="font-mono break-all text-sm text-muted">${escapeHtml(child.info.id)}</p><p class="mt-2 break-words font-medium">${escapeHtml(child.info.title ?? "Untitled child Session")}</p></div><span class="flex flex-wrap gap-2"><span class="badge ${child.activeSubagent ? "badge-info" : child.active ? "badge-warning" : "badge-neutral"}">${child.activeSubagent ? "Active subagent" : child.active ? "Active child Session" : "Child Session"}</span>${child.agentMode ? `<span class="badge badge-neutral">agent: ${escapeHtml(child.agentMode)}</span>` : ""}</span></div><a class="btn btn-ghost mt-4 min-h-11 border border-control-border" href="${escapeHtml(`${endpoint}?child=${encodeURIComponent(child.info.id)}&limit=${limit}`)}"${child.info.id === selectedId ? ' aria-current="page"' : ""}>Open child conversation</a></li>`).join("")}</ul></section>`
    : "";
  const messagePage = node.messagesLoaded
    ? node.messages.length > 0
      ? `<ol class="mt-5 grid gap-4" aria-label="Session messages">${node.messages.map((message) => { const requestedCursor = message.type === "shell" ? requestedShellOutputCursor(requestUrl, message.shellID) : 0; const nextCursor = message.type === "shell" && message.output ? nextShellOutputCursor(message.output, requestedCursor) : undefined; return renderViewerMessage(message, nextCursor === undefined || message.type !== "shell" ? undefined : shellOutputHref(node, rootId, endpoint, limit, requestUrl, message.shellID, nextCursor), requestedCursor); }).join("")}</ol>`
      : `<div class="mt-5 rounded-box bg-base-100 p-5"><p class="font-medium">No messages in this projected page</p><p class="mt-2 text-sm leading-normal text-muted">An empty final page is valid; it does not imply missing or completed execution.</p></div>`
    : `<div class="mt-5 alert alert-warning leading-normal" role="status">${escapeHtml(node.unavailableReason ?? "Messages are not currently available.")}</div>`;
  const next = node.nextMessageCursor
    ? `<a class="btn btn-ghost mt-5 min-h-11 border border-control-border" href="${escapeHtml(`${endpoint}?${new URLSearchParams({ ...(node.info.id !== rootId ? { child: node.info.id } : {}), cursor: node.nextMessageCursor, limit: String(limit) }).toString()}`)}">Load older messages</a>`
    : "";
  return `${childLinks}${renderViewerPending(node)}${renderViewerShells(node, rootId, endpoint, limit, requestUrl)}<section class="mt-10" aria-labelledby="timeline-${escapeHtml(node.info.id)}"><div class="flex flex-wrap items-start justify-between gap-4"><div><h3 id="timeline-${escapeHtml(node.info.id)}" class="text-lg font-semibold">${node.info.id === selectedId ? "Conversation timeline" : "Conversation"}</h3><p class="mt-2 text-sm text-muted">${node.messagesLoaded ? `${node.messages.length} projected message${node.messages.length === 1 ? "" : "s"}` : "Message projection unavailable"} · last OpenCode update ${escapeHtml(viewerTimestamp(node.info.time.updated))}</p></div><span class="badge ${viewerStatusClass(node.semanticState)}">${viewerStatusLabel(node.semanticState)}</span></div>${messagePage}${next}</section>`;
};

export const renderSessionViewerFragment = ({
  session,
  viewer,
  endpoint,
  eventsEndpoint,
  requestUrl,
  limit: requestedLimit,
}: {
  session: Session;
  viewer?: SessionViewerProjection;
  endpoint: string;
  eventsEndpoint: string;
  requestUrl?: string;
  limit?: number;
}) => {
  const limit = requestedLimit ?? DEFAULT_VIEWER_MESSAGE_LIMIT;
  const freshness = viewer?.freshness ?? "partial";
  const status = freshness === "stale"
    ? `<div class="alert alert-warning mt-6 leading-normal" role="status" data-viewer-status data-viewer-stale><strong>Stale.</strong> ${escapeHtml(viewer?.staleReason ?? "OpenCode transport or reconciliation is unavailable. Visible content is retained.")}</div>`
    : freshness === "partial"
      ? `<div class="alert alert-warning mt-6 leading-normal" role="status" data-viewer-status><strong>Partial Session view.</strong> Missing or unavailable projections are shown as partial data, not as an empty conversation.</div>`
      : `<div class="alert alert-success mt-6 leading-normal" role="status" data-viewer-status>Canonical OpenCode Session projections are fresh. Live updates remain view-only.</div>`;
  const partial = viewer?.partialReasons && viewer.partialReasons.length > 0
    ? `<details class="mt-4 rounded-box bg-base-100 p-4" data-viewer-notes><summary class="cursor-pointer font-medium">Projection notes</summary><ul class="mt-3 grid gap-2 text-sm leading-normal text-muted">${viewer.partialReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></details>`
    : "";
  const content = viewer?.available && viewer.selected && viewer.root
    ? renderViewerNode(viewer.selected, viewer.selected.info.id, viewer.root.info.id, endpoint, limit, requestUrl)
    : `<div class="mt-8 rounded-box bg-base-100 p-5"><p class="font-medium">OpenCode execution history unavailable</p><p class="mt-2 leading-normal text-muted">Atlas retains the Session and does not infer an empty or completed conversation from a missing upstream resource.</p></div>`;
  return `<section id="session-viewer" class="mt-10 border-t border-base-300 pt-8" data-session-viewer data-viewer-freshness="${freshness}" data-session-viewer-url="${escapeHtml(requestUrl ?? endpoint)}" data-session-events-url="${escapeHtml(eventsEndpoint)}" data-session-id="${escapeHtml(session.atlasId)}" aria-labelledby="session-viewer-title">
    <div class="flex flex-wrap items-start justify-between gap-4"><div><p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Terminal desk</p><h2 id="session-viewer-title" class="mt-3 text-xl font-semibold">Live Session view</h2><p class="mt-2 max-w-prose leading-relaxed text-muted">Canonical messages, typed tool activity, pending records, and verified descendants. Atlas provides no execution controls here.</p></div><span class="badge ${freshness === "fresh" ? "badge-success" : "badge-warning"}" data-viewer-connection>${freshness === "fresh" ? "Fresh" : freshness === "stale" ? "Stale" : "Partial"}</span></div>
    ${status}${partial}
    <div data-viewer-content>${content}</div>
  </section>`;
};

export const renderSessionDetailPage = ({
  csrfToken,
  repository,
  session,
  viewer,
  viewerRequestUrl,
  viewerLimit,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  viewer?: SessionViewerProjection;
  viewerRequestUrl?: string;
  viewerLimit?: number;
}) => {
  const specPath = `/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(session.specIssueNumber)}`;
  const githubUrl = safeExternalUrl(session.specHtmlUrl);
  const preparationLabel = session.preparationCheckpoint === "intent_saved"
    ? "Intent saved"
    : session.preparationCheckpoint === "clone_started"
      ? "Clone starting"
      : session.preparationCheckpoint === "clone_complete"
        ? "Clone complete"
        : session.preparationCheckpoint === "branch_started"
          ? "Branch starting"
          : session.preparationCheckpoint === "prepared"
            ? "Locally prepared"
            : session.preparationCheckpoint === "start_unconfirmed"
              ? "Start unconfirmed"
              : session.preparationCheckpoint === "failed_setup"
                ? "Setup failed"
                : "Queued";
  const handoffLabel = handoffCheckpointLabel(session.handoffCheckpoint);
  const preparationUnconfirmed = session.preparationCheckpoint === "start_unconfirmed";
  const handoffUnconfirmed = Boolean(session.handoffUncertainReason);
  const preparationNotice = session.state === "failed_setup"
    ? `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>Preparation failed before OpenCode execution.</strong> ${escapeHtml(session.stateReason ?? "The local setup did not complete.")} Partial resources are retained; Atlas will not delete or replay them.</div></div>`
    : preparationUnconfirmed
      ? `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>Preparation unconfirmed.</strong> Atlas will not replay an uncertain local operation. ${escapeHtml(session.preparationReason ?? "The recorded directory and preparation checkpoint require manual recovery.")}</div></div>`
      : handoffUnconfirmed
        ? `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>Start unconfirmed.</strong> Atlas will not replay an uncertain OpenCode create or prompt. ${escapeHtml(session.handoffUncertainReason ?? "The preserved handoff checkpoint requires reconciliation.")}</div></div>`
        : session.handoffCheckpoint === "prompt_accepted"
          ? `<div class="alert alert-success mt-6 leading-normal" role="status"><div><strong>OpenCode handoff accepted.</strong> The initial prompt was accepted once; execution state and outcome remain canonical OpenCode evidence.</div></div>`
          : session.preparationCheckpoint === "prepared"
            ? `<div class="alert alert-success mt-6 leading-normal" role="status"><div><strong>Local preparation complete.</strong> The full clone and working branch are ready. ${session.opencodeFreshness === "stale" ? "Atlas is waiting for a compatible OpenCode service or reconciliation." : "OpenCode handoff is proceeding through durable checkpoints."}</div></div>`
            : `<div class="alert alert-info mt-6 leading-normal" role="status"><div><strong>${session.state === "queued" ? "Queued request accepted." : "Preparation in progress."}</strong> ${escapeHtml(session.stateReason ?? "Atlas is waiting for the next safe preparation step.")}</div></div>`;

  return renderShell({
    title: `Session ${session.atlasId}`,
    active: "sessions",
    repository,
    csrfToken,
    historyDisabled: true,
    content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="min-w-0">
          <p class="font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
          <h1 id="page-title" class="mt-3 break-words text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Session ${escapeHtml(session.atlasId)}</h1>
          <p class="mt-4 max-w-prose break-words leading-relaxed text-muted">Spec #${escapeHtml(session.specIssueNumber)}: ${escapeHtml(session.specTitle)}</p>
        </div>
        <span class="flex flex-wrap items-center gap-2"><span class="badge ${sessionBadgeClass(session.state)}">${escapeHtml(sessionStateLabel(session.state))}</span>${sessionFreshnessMarkup(session)}</span>
       </div>
       ${accessNotice(repository)}
       ${preparationNotice}
       <div class="mt-8 flex flex-wrap gap-4">
         <a class="btn btn-ghost min-h-11 border border-control-border" href="${specPath}">Back to Spec</a>
         <a class="btn btn-ghost min-h-11 border border-control-border" href="${sessionsLink(repository)}">Repository Sessions</a>
         ${repositoryAction(repository, csrfToken)}
       </div>
      <dl class="mt-8 grid gap-4 border-y border-base-300 py-5 text-sm sm:grid-cols-2">
        <div><dt class="font-medium text-muted">State</dt><dd class="mt-1">${escapeHtml(sessionStateLabel(session.state))}</dd></div>
        <div><dt class="font-medium text-muted">Submitted</dt><dd class="mt-1">${escapeHtml(formatTime(session.submittedAt))}</dd></div>
        <div><dt class="font-medium text-muted">Queue order</dt><dd class="mt-1 tabular-nums">${session.submissionOrder}</dd></div>
        <div><dt class="font-medium text-muted">Submission identity</dt><dd class="mt-1 break-all font-mono">${escapeHtml(session.submissionId)}</dd></div>
        <div><dt class="font-medium text-muted">Preparation checkpoint</dt><dd class="mt-1">${escapeHtml(preparationLabel)}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode handoff</dt><dd class="mt-1">${escapeHtml(handoffLabel)}</dd></div>
        <div><dt class="font-medium text-muted">Starting base</dt><dd class="mt-1 break-words font-mono">Default branch · ${escapeHtml(session.baseBranch ?? session.targetBranch)}${session.baseSha ? ` · ${escapeHtml(session.baseSha)}` : " · waiting for verified SHA"}</dd></div>
         <div><dt class="font-medium text-muted">Working branch</dt><dd class="mt-1 break-words font-mono">${session.workingBranch ? escapeHtml(session.workingBranch) : "Not assigned before admission"}</dd></div>
         <div><dt class="font-medium text-muted">Execution slot</dt><dd class="mt-1">${session.executionSlotHeld ? "Held" : session.state === "queued" ? "Not held while Queued" : "Not held"}</dd></div>
         <div><dt class="font-medium text-muted">Session directory</dt><dd class="mt-1 break-words font-mono">${session.directory ? escapeHtml(session.directory) : "Not assigned before admission"}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode intended Session</dt><dd class="mt-1 break-all font-mono">${session.opencodeIntendedSessionId ? escapeHtml(session.opencodeIntendedSessionId) : "Not assigned before local preparation"}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode Session</dt><dd class="mt-1 break-all font-mono">${session.openCodeSessionId ? escapeHtml(session.openCodeSessionId) : "Not associated"}</dd></div>
        <div><dt class="font-medium text-muted">Initial message</dt><dd class="mt-1 break-all font-mono">${session.initialMessageId ? escapeHtml(session.initialMessageId) : "Not assigned"}</dd></div>
        <div><dt class="font-medium text-muted">Prompt inbox</dt><dd class="mt-1 break-all font-mono">${session.initialInboxId ? escapeHtml(session.initialInboxId) : "Not accepted"}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode freshness</dt><dd class="mt-1">${session.opencodeFreshness === "fresh" ? "Fresh" : session.opencodeFreshness === "stale" ? "Stale" : "Not reconciled"}</dd></div>
        <div><dt class="font-medium text-muted">Last OpenCode reconciliation</dt><dd class="mt-1">${formatTime(session.opencodeLastSuccessAt)}</dd></div>
      </dl>
      ${session.preparationReason ? `<p class="mt-6 text-sm leading-normal text-muted">Checkpoint note: ${escapeHtml(session.preparationReason)}</p>` : ""}
      ${session.exactMessage ? `<section class="mt-10" aria-labelledby="sent-message-title">
        <h2 id="sent-message-title" class="text-lg font-semibold">Exact OpenCode handoff message</h2>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">This is the context and unchanged prompt Atlas prepared for the one allowed initial message.</p>
        <pre class="mt-5 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-box bg-base-100 p-5 font-mono text-sm leading-relaxed">${escapeHtml(session.exactMessage)}</pre>
      </section>` : ""}
      <section class="mt-10" aria-labelledby="immutable-context-title">
        <h2 id="immutable-context-title" class="text-lg font-semibold">Immutable handoff context</h2>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">Atlas retains the Spec snapshot and prompt that were accepted. Later GitHub edits do not rewrite this attempt.</p>
        <dl class="mt-5 grid gap-4 border-y border-base-300 py-5 text-sm sm:grid-cols-2">
          <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
          <div><dt class="font-medium text-muted">Spec snapshot</dt><dd class="mt-1 break-words">${githubUrl ? `<a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(session.specTitle)}</a>` : escapeHtml(session.specTitle)}</dd></div>
        </dl>
        <article class="mt-6 rounded-box bg-base-100 p-5 sm:p-6">
          <h3 class="font-medium">Spec description at submission</h3>
          <div class="mt-4 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(session.specBody) || "No description provided."}</div>
        </article>
        <article class="mt-6 rounded-box bg-base-100 p-5 sm:p-6">
          <h3 class="font-medium">Initial prompt</h3>
          <pre class="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">${escapeHtml(session.prompt)}</pre>
         </article>
       </section>
       ${renderSessionViewerFragment({
         session,
         viewer,
         endpoint: `/sessions/${encodeURIComponent(session.atlasId)}/view`,
         eventsEndpoint: `/events?session=${encodeURIComponent(session.atlasId)}`,
         requestUrl: viewerRequestUrl,
         limit: viewerLimit,
       })}
     </section>`,
  });
};

export const renderSpecUnavailablePage = ({
  csrfToken,
  repository,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => renderShell({
  title: `${repository.fullName} Specs unavailable`,
  active: "specs",
  repository,
  csrfToken,
  content: `<section class="atlas-glass rounded-box p-4 sm:p-8">
     ${renderRepositoryHeading(repository, "Specs unavailable", "Atlas could not complete the first Specs read.", csrfToken)}
     ${accessNotice(repository)}
     ${refreshWarning("Access", accessRefresh)}
     ${refreshWarning("Specs", specsRefresh)}
     <div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>GitHub synchronization is unavailable.</strong> Retry when the configured App access is available. Atlas has not invented an empty list.</div></div>
    <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
    <a class="btn btn-ghost mt-8 min-h-11 border border-control-border" href="${repositoryLink(repository)}">Back to Specs</a>
  </section>`,
});
