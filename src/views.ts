import type { GitHubRepository } from "./github.ts";
import type { RefreshState, Repository, Spec } from "./persistence.ts";

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
  '{"reportValidityOfForms":true,"includeIndicatorStyles":false,"historyRestoreAsHxRequest":false,"responseHandling":[{"code":"204","swap":false},{"code":"422","swap":true,"error":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":false,"error":true},{"code":"...","swap":true}]}';

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
  <body class="atlas-backdrop min-h-screen overflow-x-hidden bg-base-200 font-sans text-base-content">
    ${content}
  </body>
</html>`;

const skipLink = `<a class="atlas-skip-link" href="#main-content">Skip to main content</a>`;

export const renderLoginForm = ({
  csrfToken,
  error,
  returnTo,
}: {
  csrfToken: string;
  error?: string;
  returnTo: string;
}) => {
  const errorMarkup = error
    ? `<p id="login-error" class="alert alert-error mt-6 leading-normal" tabindex="-1" data-focus-on-swap>${escapeHtml(error)}</p>`
    : "";
  const errorAttribute = error ? ' aria-describedby="login-error" aria-invalid="true"' : "";

  return `<form id="login-form" class="mt-8 max-w-md" action="/login" method="post" autocomplete="on" hx-post="/login" hx-target="#login-form" hx-swap="outerHTML" hx-indicator="#login-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
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
  <button class="btn btn-ghost min-h-11 border border-control-border/60" type="submit">Sign out</button>
  <span id="logout-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing out...</span>
</form>`;

type ActivePage = "repositories" | "new-repository" | "specs" | "spec";

const repositoryLink = (repository: Pick<Repository, "githubId">) => `/repositories/${encodeURIComponent(repository.githubId)}/specs`;

const renderRepositoryNav = (repository: Repository, active: ActivePage) => `<div class="mt-6 border-t border-base-300 pt-4">
  <p class="px-4 py-2 text-sm font-medium uppercase tracking-[0.16em] text-muted">Repository</p>
  <a class="block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${active === "specs" || active === "spec" ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${repositoryLink(repository)}"${active === "specs" || active === "spec" ? ' aria-current="page"' : ""}>Specs</a>
</div>`;

const renderShell = ({
  title,
  active,
  repository,
  csrfToken,
  content,
}: {
  title: string;
  active: ActivePage;
  repository?: Repository;
  csrfToken: string;
  content: string;
}) => {
  const repositoryName = repository?.fullName ?? "No Repository selected";
  const repositoriesActive = active === "repositories" || active === "new-repository";
  const specsActive = active === "specs" || active === "spec";
  const mobileLinks = `<a class="block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${repositoriesActive ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="/repositories"${repositoriesActive ? ' aria-current="page"' : ""}>Repositories</a>
    ${repository ? `<a class="mt-1 block min-h-11 rounded-field border-l-2 px-4 py-3 font-medium ${specsActive ? "border-brand-readable bg-primary/20 text-base-content" : "border-transparent text-muted"}" href="${repositoryLink(repository)}"${specsActive ? ' aria-current="page"' : ""}>Specs</a>` : ""}`;

  return document(
    title,
    `${skipLink}
    <header class="atlas-glass sticky top-0 z-20 border-b border-base-content/16">
      <div class="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div class="flex min-w-0 items-center gap-4">
          <a class="rounded-field px-1 py-2 text-lg font-semibold tracking-tight text-base-content" href="/repositories">Atlas</a>
          <span class="hidden max-w-[18rem] truncate text-sm text-muted sm:inline" title="${escapeHtml(repositoryName)}">${escapeHtml(repositoryName)}</span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <details class="relative lg:hidden">
            <summary class="btn btn-ghost min-h-11 list-none border border-control-border/60" aria-label="Open primary navigation">Navigation</summary>
            <nav class="absolute right-0 top-14 z-30 w-64 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl" aria-label="Primary navigation">
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
      <main id="main-content" class="min-w-0" aria-labelledby="page-title">
        <div id="global-status" class="sr-only" role="status" aria-atomic="true">Signed in to Atlas.</div>
        ${content}
      </main>
    </div>`,
  );
};

const accessLabel = (repository: Repository) => {
  if (repository.accessStatus === "unknown") return "Access unknown";
  if (repository.accessStatus === "revoked") return "Access unavailable";
  if (repository.accessStatus === "transferred") return "Transferred out of scope";
  if (repository.accessStatus === "suspended") return "App suspended";
  if (repository.archived) return "Archived";
  if (repository.disabled) return "Disabled";
  return "Available";
};

const accessBadgeClass = (repository: Repository) => {
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
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return `${label}: last complete sync ${formatTime(refresh.lastSuccessAt)}; latest sync unavailable`;
  }
  return `${label}: synced ${formatTime(refresh.lastSuccessAt)}`;
};

type RepositoryListEntry = {
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
};

export const renderRepositoriesPage = (
  csrfToken: string,
  repositories: RepositoryListEntry[] = [],
) => {
  const list = repositories.length === 0
    ? `<div class="mt-8 rounded-box bg-base-100 p-6">
        <p class="text-lg font-semibold">No Repositories enrolled</p>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">Atlas does not enroll every Repository available to the GitHub App. Add one explicitly to begin browsing.</p>
        <a class="btn btn-primary mt-6 min-h-11 border border-control-border" href="/repositories/new">Add a Repository</a>
      </div>`
    : `<ul class="mt-8 grid gap-4" aria-label="Enrolled Repositories">${repositories.map(({ repository, accessRefresh, specsRefresh }) => `
        <li class="rounded-box bg-base-100 p-5 sm:p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
              <h2 class="mt-2 break-words text-lg font-semibold"><a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${repositoryLink(repository)}">${escapeHtml(repository.name)}</a></h2>
              ${repository.description ? `<p class="mt-2 max-w-prose leading-normal text-muted">${escapeHtml(repository.description)}</p>` : ""}
              <p class="mt-3 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
              ${repository.defaultBranch ? "" : `<p class="mt-2 text-sm text-warning">No default-branch commit; cannot start Sessions.</p>`}
            </div>
            <span class="badge ${accessBadgeClass(repository)}">${accessLabel(repository)}</span>
          </div>
          <div class="mt-5 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <span>${refreshLine("Access", accessRefresh)}</span>
            <span>${refreshLine("Specs", specsRefresh)}</span>
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-3">
            <a class="btn btn-primary min-h-11 border border-control-border" href="${repositoryLink(repository)}">Browse Specs</a>
            ${safeExternalUrl(repository.htmlUrl) ? `<a class="btn btn-ghost min-h-11 border border-control-border/60" href="${escapeHtml(safeExternalUrl(repository.htmlUrl))}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
          </div>
        </li>`).join("")}</ul>`;

  return renderShell({
    title: "Repositories",
    active: "repositories",
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-6 sm:p-8">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Operations</p>
          <h1 id="page-title" class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Repositories</h1>
          <p class="mt-4 max-w-prose leading-relaxed text-muted">Choose which GitHub Repositories Atlas should browse. App access is eligibility, not enrollment.</p>
        </div>
        <a class="btn btn-primary min-h-11 border border-control-border" href="/repositories/new">Add a Repository</a>
      </div>
      ${list}
    </section>`,
  });
};

type AvailableRepository = {
  repository: GitHubRepository;
  enrolled: boolean;
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
      ? `<ul class="mt-8 grid gap-4" aria-label="Repositories available to Atlas">${available.map(({ repository, enrolled, csrfToken: repositoryCsrf }) => `
          <li class="rounded-box bg-base-100 p-5 sm:p-6">
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
              ${enrolled
                ? `<a class="btn btn-primary min-h-11 border border-control-border" href="${repositoryLink({ githubId: repository.id })}">Open Specs</a><span class="text-sm text-muted">Already enrolled; adding again keeps the same Repository.</span>`
                : `<form id="add-repository-${escapeHtml(repository.id)}" action="/repositories" method="post" hx-post="/repositories" hx-target="#add-repository-${escapeHtml(repository.id)}" hx-swap="none" hx-indicator="#add-progress-${escapeHtml(repository.id)}" hx-disabled-elt="button[type='submit']"><input type="hidden" name="csrf" value="${escapeHtml(repositoryCsrf || csrfToken)}"><input type="hidden" name="repository_id" value="${escapeHtml(repository.id)}"><span data-form-status class="sr-only" role="status" aria-live="polite"></span><button class="btn btn-primary min-h-11 border border-control-border" type="submit">Add Repository</button><span id="add-progress-${escapeHtml(repository.id)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Adding Repository...</span></form>`}
              ${safeExternalUrl(repository.htmlUrl) ? `<a class="btn btn-ghost min-h-11 border border-control-border/60" href="${escapeHtml(safeExternalUrl(repository.htmlUrl))}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
            </div>
          </li>`).join("")}</ul>`
      : "";

  return renderShell({
    title: "Add Repository",
    active: "new-repository",
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-6 sm:p-8">
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">GitHub App access</p>
      <h1 id="page-title" class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Add a Repository</h1>
      <p class="mt-4 max-w-prose leading-relaxed text-muted">Select a Repository that is available to the configured App installation. Atlas will save it before attempting its first Specs synchronization.</p>
      ${errorMarkup}
      ${list}
      <a class="btn btn-ghost mt-8 min-h-11 border border-control-border/60" href="/repositories">Back to Repositories</a>
    </section>`,
  });
};

const accessNotice = (repository: Repository) => {
  if (repository.accessStatus === "unknown") {
    return `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>GitHub access could not be verified.</strong> Showing the last complete Atlas data when available. This does not confirm that access was removed.</div></div>`;
  }
  if (repository.accessStatus === "revoked") {
    return `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>GitHub App access is unavailable.</strong> This Repository was not present in the last complete installation inventory. Cached data is retained; Atlas will not treat it as eligible for new work.</div></div>`;
  }
  if (repository.accessStatus === "transferred") {
    return `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>Repository is outside the configured organization.</strong> Its cached data is retained and new work is paused.</div></div>`;
  }
  if (repository.accessStatus === "suspended") {
    return `<div class="alert alert-error mt-6 leading-normal" role="alert"><div><strong>The GitHub App installation is suspended.</strong> Cached data is retained and new work is paused.</div></div>`;
  }
  return "";
};

const specsNotice = (refresh: RefreshState | undefined, specs: Spec[]) => {
  if (!refresh || refresh.availability === "never") {
    return `<div class="alert alert-info mt-6 leading-normal" role="status"><div><strong>Specs have not synchronized yet.</strong> An unavailable first read is not shown as an empty list.</div></div>`;
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    const cached = specs.length > 0 ? ` Showing ${specs.length} Specs from the last complete sync at ${formatTime(refresh.lastSuccessAt)}.` : " No complete Specs sync is available yet.";
    return `<div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>Specs synchronization is unavailable.</strong>${cached} Known membership was not removed.</div></div>`;
  }
  if (refresh.failureReason) {
    return `<div class="alert alert-warning mt-6 leading-normal" role="status">${escapeHtml(refresh.failureReason)}</div>`;
  }
  return "";
};

const renderRepositoryHeading = (repository: Repository, title: string, description: string) => {
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
      ${githubUrl ? `<a class="btn btn-ghost min-h-11 border border-control-border/60" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">Open Repository on GitHub</a>` : ""}
    </div>
  </div>
  ${eligibility ? `<div class="alert alert-warning mt-6 leading-normal" role="status">${escapeHtml(eligibility)}</div>` : ""}`;
};

const specRow = (spec: Spec) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  return `<li class="rounded-box bg-base-100 p-5 sm:p-6">
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
  </li>`;
};

export const renderSpecsPage = ({
  csrfToken,
  repository,
  specs,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  specs: Spec[];
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const canShowEmptyState = specsRefresh?.availability === "available";
  const list = specs.length > 0
    ? `<ul class="mt-8 grid gap-4" aria-label="Open Specs">${specs.map(specRow).join("")}</ul>`
    : canShowEmptyState ? `<div class="mt-8 rounded-box bg-base-100 p-6">
        <p class="text-lg font-semibold">No open Specs</p>
        <p class="mt-2 max-w-prose leading-relaxed text-muted">Open, non-PR GitHub issues carrying the exact <code class="font-mono text-base-content">spec</code> label appear here.</p>
      </div>` : "";

  return renderShell({
    title: `${repository.fullName} Specs`,
    active: "specs",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-6 sm:p-8">
      ${renderRepositoryHeading(repository, "Specs", "Open, non-PR GitHub issues labelled exactly spec.")}
      ${accessNotice(repository)}
      ${specsNotice(specsRefresh, specs)}
      <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
      ${list}
    </section>`,
  });
};

export const renderSpecDetailPage = ({
  csrfToken,
  repository,
  spec,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  spec: Spec;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const retained = !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);
  const labels = spec.labels.length > 0
    ? spec.labels.map((label) => `<span class="badge ${label === "spec" ? "badge-info" : ""}">${escapeHtml(label)}</span>`).join(" ")
    : `<span class="text-sm text-muted">No labels recorded</span>`;

  return renderShell({
    title: `Spec #${spec.issueNumber}`,
    active: "spec",
    repository,
    csrfToken,
    content: `<section class="atlas-glass rounded-box p-6 sm:p-8">
      <a class="text-sm text-brand-readable underline underline-offset-4" href="${repositoryLink(repository)}">← Back to Specs</a>
      <div class="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div class="min-w-0">
          <p class="font-mono text-sm text-muted">Spec #${escapeHtml(spec.issueNumber)}</p>
          <h1 id="page-title" class="mt-3 break-words text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>${escapeHtml(spec.title)}</h1>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="badge ${retained ? "badge-warning" : "badge-info"}">${retained ? "Retained snapshot" : "Open Spec"}</span>
          ${githubUrl ? `<a class="btn btn-ghost min-h-11 border border-control-border/60" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ""}
        </div>
      </div>
      ${accessNotice(repository)}
      ${retained ? `<div class="alert alert-warning mt-6 leading-normal" role="status">This issue is no longer in the active Specs projection. Atlas retains the last complete snapshot for this direct link.</div>` : ""}
      <div class="mt-8 flex flex-wrap items-center gap-2" aria-label="Spec labels">${labels}</div>
      <dl class="mt-6 grid gap-4 border-y border-base-300 py-5 text-sm sm:grid-cols-2">
        <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
        <div><dt class="font-medium text-muted">Last updated</dt><dd class="mt-1">${formatTime(spec.updatedAt)}</dd></div>
        <div><dt class="font-medium text-muted">Last observed</dt><dd class="mt-1">${formatTime(spec.observedAt)}</dd></div>
        <div><dt class="font-medium text-muted">Specs freshness</dt><dd class="mt-1">${refreshLine("Specs", specsRefresh)}</dd></div>
      </dl>
      <article class="mt-8 max-w-prose rounded-box bg-base-100 p-6">
        <h2 class="text-lg font-semibold">Spec description</h2>
        <div class="mt-5 whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(spec.body) || "No description provided."}</div>
      </article>
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
  content: `<section class="atlas-glass rounded-box p-6 sm:p-8">
    ${renderRepositoryHeading(repository, "Specs unavailable", "Atlas could not complete the first Specs read.")}
    <div class="alert alert-warning mt-6 leading-normal" role="alert"><div><strong>GitHub synchronization is unavailable.</strong> Retry when the configured App access is available. Atlas has not invented an empty list.</div></div>
    <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
    <a class="btn btn-ghost mt-8 min-h-11 border border-control-border/60" href="${repositoryLink(repository)}">Back to Specs</a>
  </section>`,
});
