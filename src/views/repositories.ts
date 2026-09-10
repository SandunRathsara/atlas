import type { GitHubRepository } from "../github.ts";
import type { RefreshState, Repository } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";
import {
  accessBadgeClass,
  accessLabel,
  emptyState,
  pageHeader,
  pullRequestsLink,
  recordTable,
  refreshLine,
  refreshWarning,
  repositoryAction,
  repositoryLink,
  statusBadge,
} from "./shared.ts";
import { renderShell } from "./shell.ts";

type RepositoryListEntry = {
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
};

export const repositoryMatchesQuery = (
  repository: Pick<GitHubRepository, "name" | "fullName" | "description">,
  query: string,
) => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [repository.name, repository.fullName, repository.description ?? ""].some((value) =>
    value.toLocaleLowerCase().includes(needle),
  );
};

const repositoryIdentity = (name: string, fullName: string, href?: string) => {
  const title = href
    ? `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${href}">${escapeHtml(name)}</a>`
    : `<span class="font-medium">${escapeHtml(name)}</span>`;
  return `${title}<p class="mt-1 font-mono text-xs text-faint">${escapeHtml(fullName)}</p>`;
};

export const renderRepositoriesPage = (
  csrfToken: string,
  repositories: RepositoryListEntry[] = [],
  includeRemoved = false,
) => {
  const list = repositories.length === 0
    ? emptyState(
      "No Repositories enrolled",
      "Atlas does not enroll every Repository available to the GitHub App. Add one explicitly to begin browsing.",
      `<a class="btn btn-primary mt-4" href="/repositories/new">${icon("plus", 16)} Add a Repository</a>`,
    )
    : recordTable({
      label: includeRemoved ? "Enrolled and removed Repositories" : "Enrolled Repositories",
      headers: ["Repository", "State", "Access", "Specs", "Actions"],
      rows: repositories.map(({ repository, accessRefresh, specsRefresh }) => {
        const href = repositoryLink(repository);
        const github = safeExternalUrl(repository.htmlUrl);
        return `<tr>
          <td>
            <div class="flex gap-2">
              ${icon("rectangle-stack", 20)}
              <div class="min-w-0">${repositoryIdentity(repository.name, repository.fullName, href)}
                ${repository.description ? `<p class="mt-2 max-w-prose text-sm text-muted">${escapeHtml(repository.description)}</p>` : ""}
                <p class="mt-2 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
                ${repository.defaultBranch ? "" : `<p class="mt-1 text-sm text-warning">No default-branch commit; cannot start Sessions.</p>`}
                ${repository.removedAt ? `<p class="mt-1 text-sm text-warning">Removed from Atlas; Sessions and local resources are preserved.</p>` : ""}
                ${refreshWarning("Access", accessRefresh)}
                ${refreshWarning("Specs", specsRefresh)}
              </div>
            </div>
          </td>
          <td>${statusBadge(accessBadgeClass(repository), accessLabel(repository))}</td>
          <td class="text-muted">${refreshLine("Access", accessRefresh)}</td>
          <td class="text-muted">${refreshLine("Specs", specsRefresh)}</td>
          <td>
            <div class="flex flex-wrap gap-1">
              <a class="btn btn-ghost btn-xs" href="${href}">Browse Specs</a>
              <a class="btn btn-ghost btn-xs" href="${pullRequestsLink(repository)}">Browse Pull requests</a>
              ${github ? `<a class="btn btn-ghost btn-xs" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} Open on GitHub</a>` : ""}
              ${repositoryAction(repository, csrfToken)}
            </div>
          </td>
        </tr>`;
      }),
      stacked: repositories.map(({ repository, accessRefresh, specsRefresh }) => {
        const href = repositoryLink(repository);
        const github = safeExternalUrl(repository.htmlUrl);
        return `<li class="p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">${repositoryIdentity(repository.name, repository.fullName, href)}</div>
            ${statusBadge(accessBadgeClass(repository), accessLabel(repository))}
          </div>
          ${repository.description ? `<p class="mt-2 max-w-prose text-sm text-muted">${escapeHtml(repository.description)}</p>` : ""}
          <p class="mt-2 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
          ${repository.defaultBranch ? "" : `<p class="mt-1 text-sm text-warning">No default-branch commit; cannot start Sessions.</p>`}
          ${repository.removedAt ? `<p class="mt-1 text-sm text-warning">Removed from Atlas; Sessions and local resources are preserved.</p>` : ""}
          <p class="mt-2 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
          ${refreshWarning("Access", accessRefresh)}
          ${refreshWarning("Specs", specsRefresh)}
          <div class="mt-3 flex flex-wrap gap-2">
            <a class="btn btn-ghost btn-xs" href="${href}">Browse Specs</a>
            <a class="btn btn-ghost btn-xs" href="${pullRequestsLink(repository)}">Browse Pull requests</a>
            ${github ? `<a class="btn btn-ghost btn-xs" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} Open on GitHub</a>` : ""}
            ${repositoryAction(repository, csrfToken)}
          </div>
        </li>`;
      }),
    });

  return renderShell({
    title: "Repositories",
    active: "repositories",
    csrfToken,
    content: `${pageHeader({
      eyebrow: "Operations",
      title: "Repositories",
      description: "Choose which GitHub Repositories Atlas should browse. App access is eligibility, not enrollment.",
      actions: `<a class="btn btn-primary" href="/repositories/new">${icon("plus", 16)} Add a Repository</a>
        ${includeRemoved
          ? `<a class="btn btn-ghost" href="/repositories">Hide removed Repositories</a>`
          : `<a class="btn btn-ghost" href="/repositories?removed=1">Show removed Repositories</a>`}`,
    })}
    ${list}`,
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
  query = "",
}: {
  csrfToken: string;
  available: AvailableRepository[];
  error?: string;
  query?: string;
}) => {
  const filterQuery = query.trim();
  const visible = filterQuery
    ? available.filter(({ repository }) => repositoryMatchesQuery(repository, filterQuery))
    : available;
  const errorMarkup = error
    ? `<div class="alert alert-warning alert-soft mt-6 leading-normal" role="alert">${escapeHtml(error)}</div>`
    : "";
  const filterForm = available.length > 0 || filterQuery
    ? `<form class="mt-6 max-w-2xl" method="get" action="/repositories/new" role="search">
        <label class="label mb-2 block p-0" for="repository-filter">Filter Repositories</label>
        <div class="flex w-full flex-wrap items-center gap-2">
          <label class="input min-w-0 grow">
            ${icon("magnifying-glass", 16)}
            <input id="repository-filter" name="q" type="search" value="${escapeHtml(filterQuery)}" maxlength="200" autocomplete="off">
          </label>
          <button class="btn" type="submit">Filter</button>
        </div>
      </form>
      ${filterQuery ? `<p class="mt-3 text-sm text-muted">Showing <span class="tabular-nums">${visible.length}</span> of <span class="tabular-nums">${available.length}</span> Repositories. <a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="/repositories/new">Clear filter</a></p>` : ""}`
    : "";
  const addForm = (repository: GitHubRepository, enrolled: boolean, removedAt: string | null | undefined, repositoryCsrf: string) =>
    removedAt
      ? `<form id="add-repository-${escapeHtml(repository.id)}" action="/repositories" method="post" hx-post="/repositories" hx-target="this" hx-swap="none" hx-indicator="#add-progress-${escapeHtml(repository.id)}" hx-disabled-elt="button[type='submit']"><input type="hidden" name="csrf" value="${escapeHtml(repositoryCsrf || csrfToken)}"><input type="hidden" name="repository_id" value="${escapeHtml(repository.id)}"><span data-form-status class="sr-only" role="status" aria-live="polite"></span><button class="btn btn-primary btn-xs" type="submit">Re-add Repository</button><span id="add-progress-${escapeHtml(repository.id)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Re-adding Repository...</span></form><span class="text-sm text-warning">Removed from Atlas; history is preserved.</span>`
      : enrolled
        ? `<a class="btn btn-primary btn-xs" href="${repositoryLink({ githubId: repository.id })}">Open Specs</a><span class="text-sm text-muted">Already enrolled; adding again keeps the same Repository.</span>`
        : `<form id="add-repository-${escapeHtml(repository.id)}" action="/repositories" method="post" hx-post="/repositories" hx-target="this" hx-swap="none" hx-indicator="#add-progress-${escapeHtml(repository.id)}" hx-disabled-elt="button[type='submit']"><input type="hidden" name="csrf" value="${escapeHtml(repositoryCsrf || csrfToken)}"><input type="hidden" name="repository_id" value="${escapeHtml(repository.id)}"><span data-form-status class="sr-only" role="status" aria-live="polite"></span><button class="btn btn-primary btn-xs" type="submit">Add Repository</button><span id="add-progress-${escapeHtml(repository.id)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Adding Repository...</span></form>`;

  const list = visible.length === 0 && !error && !filterQuery
    ? emptyState("No Repositories available", "The configured GitHub App installation has no Repositories in the allowed organization, or none could be verified.")
    : visible.length === 0 && filterQuery
      ? emptyState(
        "No matching Repositories",
        "No Repositories match this filter. Clear it to see all available Repositories.",
        `<a class="btn btn-ghost mt-4" href="/repositories/new">Clear filter</a>`,
      )
      : visible.length > 0
        ? recordTable({
          label: "Repositories available to Atlas",
          headers: ["Repository", "State", "Actions"],
          rows: visible.map(({ repository, enrolled, removedAt, csrfToken: repositoryCsrf }) => {
            const github = safeExternalUrl(repository.htmlUrl);
            const badge = repository.archived || repository.disabled ? "badge-warning" : "badge-info";
            const label = repository.archived ? "Archived" : repository.disabled ? "Disabled" : "Available";
            return `<tr>
              <td>${repositoryIdentity(repository.name, repository.fullName)}
                ${repository.description ? `<p class="mt-2 max-w-prose text-sm text-muted">${escapeHtml(repository.description)}</p>` : ""}
                <p class="mt-2 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
                ${repository.defaultBranch ? "" : `<p class="mt-1 text-sm text-warning">No default-branch commit; browsing only.</p>`}
              </td>
              <td>${statusBadge(badge, `${label} for browsing`)}</td>
              <td><div class="flex flex-wrap items-center gap-1">${addForm(repository, enrolled, removedAt, repositoryCsrf)}${github ? `<a class="btn btn-ghost btn-xs" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} Open on GitHub</a>` : ""}</div></td>
            </tr>`;
          }),
          stacked: visible.map(({ repository, enrolled, removedAt, csrfToken: repositoryCsrf }) => {
            const github = safeExternalUrl(repository.htmlUrl);
            const badge = repository.archived || repository.disabled ? "badge-warning" : "badge-info";
            const label = repository.archived ? "Archived" : repository.disabled ? "Disabled" : "Available";
            return `<li class="p-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">${repositoryIdentity(repository.name, repository.fullName)}</div>
                ${statusBadge(badge, `${label} for browsing`)}
              </div>
              ${repository.description ? `<p class="mt-2 max-w-prose text-sm text-muted">${escapeHtml(repository.description)}</p>` : ""}
              <p class="mt-2 text-sm text-muted">Default branch: <code class="font-mono text-base-content">${escapeHtml(repository.defaultBranch ?? "none")}</code></p>
              ${repository.defaultBranch ? "" : `<p class="mt-1 text-sm text-warning">No default-branch commit; browsing only.</p>`}
              <div class="mt-3 flex flex-wrap items-center gap-2">${addForm(repository, enrolled, removedAt, repositoryCsrf)}${github ? `<a class="btn btn-ghost btn-xs" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} Open on GitHub</a>` : ""}</div>
            </li>`;
          }),
        })
        : "";

  return renderShell({
    title: "Add Repository",
    active: "new-repository",
    csrfToken,
    content: `${pageHeader({
      eyebrow: "GitHub App access",
      title: "Add a Repository",
      description: "Select a Repository that is available to the configured App installation. Atlas will save it before attempting its first Specs synchronization.",
    })}
      ${errorMarkup}
      ${filterForm}
      ${list}
      <a class="btn btn-ghost mt-8" href="/repositories">Back to Repositories</a>`,
  });
};
