import type { GitHubRepository } from "../github.ts";
import type { RefreshState, Repository } from "../persistence.ts";
import { escapeHtml } from "./html.ts";
import {
  banner,
  button,
  emptyCard,
  group,
  groupFoot,
  icon,
  pageTitle,
  repositoryLink,
  repositoryNote,
  repositoryTile,
  sectionHeader,
} from "./shared.ts";
import { renderShell, type InboxContext } from "./shell.ts";

type RepositoryListEntry = {
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
  /** Current Specs from the last complete read. Leave undefined when Specs were never read. */
  specCount?: number;
  /** Unfinished Sessions (Queued, Preparing, Running, Waiting, Idle). */
  workingCount?: number;
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

const plural = (count: number, word: string) => `<span><b>${count}</b> ${word}${count === 1 ? "" : "s"}</span>`;

/** Footer line. Only says what Atlas knows: no Spec count before the first complete Specs read. */
const cardStats = ({ specsRefresh, specCount, workingCount }: RepositoryListEntry) => {
  const read = Boolean(specsRefresh?.lastSuccessAt) && specCount !== undefined;
  const specs = read ? plural(specCount!, "Spec") : `<span>Specs not read yet</span>`;
  const working = workingCount === undefined ? "" : `<span><b>${workingCount}</b> working</span>`;
  const failed = specsRefresh && read && (specsRefresh.availability === "unavailable" || specsRefresh.availability === "partial");
  return `<span class="rp-stat">${specs}${working}</span>${failed ? `<span class="rp-note">Couldn’t refresh Specs · counts from the last read</span>` : ""}`;
};

const repositoryCard = (entry: RepositoryListEntry) => {
  const { repository } = entry;
  const note = repositoryNote(repository);
  return `<a class="rp-card${repository.removedAt ? " rp-card-off" : ""}" href="${escapeHtml(repositoryLink(repository))}">
    <span class="rp-card-top">${repositoryTile(repository, 40)}<span class="rp-card-id"><span class="rp-name">${escapeHtml(repository.name)}</span><span class="rp-full">${escapeHtml(repository.fullName)}</span></span>${icon("chevron", 16, "ax-chev")}</span>
    ${repository.description ? `<span class="rp-desc">${escapeHtml(repository.description)}</span>` : ""}
    ${note ? `<span class="rp-note${note.tone === "error" ? " rp-note-red" : ""}">${escapeHtml(note.text)}</span>` : ""}
    ${cardStats(entry)}
  </a>`;
};

export const renderRepositoriesPage = (
  csrfToken: string,
  repositories: RepositoryListEntry[] = [],
  includeRemoved = false,
  inbox?: InboxContext,
) => {
  const enrolled = repositories.filter(({ repository }) => !repository.removedAt);
  const removed = repositories.filter(({ repository }) => repository.removedAt);
  const addButton = button({ label: "Add Repository", variant: "icon", icon: "plus", href: "/repositories/new" });
  const list = enrolled.length === 0
    ? emptyCard({
      title: "No Repositories yet",
      body: "Atlas only shows the GitHub Repositories you add. Adding one doesn’t change anything on GitHub.",
      glyph: "folder",
      actionHtml: button({ label: "Add Repository", icon: "plus", href: "/repositories/new" }),
    })
    : `<div class="rp-cards" role="list" aria-label="Repositories">${enrolled.map((entry) => `<div role="listitem">${repositoryCard(entry)}</div>`).join("")}</div>`;
  const removedList = includeRemoved
    ? `${sectionHeader({ title: "Removed from Atlas", count: removed.length })}
      ${removed.length === 0
        ? `<p class="rp-foot">No removed Repositories.</p>`
        : `<div class="rp-cards" role="list" aria-label="Removed Repositories">${removed.map((entry) => `<div role="listitem">${repositoryCard(entry)}</div>`).join("")}</div>
          <p class="rp-foot">Removed Repositories keep their history. Open one to re-add it.</p>`}`
    : "";

  return renderShell({
    title: "Repositories",
    csrfToken,
    inbox,
    tab: "repos",
    header: {
      title: "Repositories",
      actionsHtml: addButton,
      menu: {
        items: [
          includeRemoved
            ? { label: "Hide removed Repositories", href: "/repositories", icon: "eye" }
            : { label: "Show removed Repositories", href: "/repositories?removed=1", icon: "eye" },
          { label: "Add Repository", href: "/repositories/new", icon: "plus" },
        ],
      },
    },
    content: `<div class="rp-page">${list}${removedList}</div>`,
  });
};

type AvailableRepository = {
  repository: GitHubRepository;
  enrolled: boolean;
  removedAt?: string | null;
  csrfToken: string;
};

/** Amber note for an inventory row, or the description. */
const availableSub = (repository: GitHubRepository, enrolled: boolean, removedAt: string | null | undefined) => {
  const warn = (text: string) => `<span class="rp-note">${escapeHtml(text)}</span>`;
  if (removedAt) return warn("Removed earlier · history kept");
  if (repository.archived) return warn("Archived · browsing only");
  if (repository.disabled) return warn("Disabled on GitHub · browsing only");
  if (!repository.defaultBranch) return warn("No default-branch commit · browsing only");
  if (enrolled) return "Already added";
  return repository.description ? escapeHtml(repository.description) : `<span class="ax-mono">${escapeHtml(repository.fullName)}</span>`;
};

export const renderAddRepositoryPage = ({
  csrfToken,
  available,
  error,
  query = "",
  inbox,
}: {
  csrfToken: string;
  available: AvailableRepository[];
  error?: string;
  query?: string;
  inbox?: InboxContext;
}) => {
  const filterQuery = query.trim();
  const visible = filterQuery
    ? available.filter(({ repository }) => repositoryMatchesQuery(repository, filterQuery))
    : available;
  const errorMarkup = error
    ? banner({
      tone: "warning",
      role: "alert",
      title: "Couldn’t reach GitHub",
      bodyHtml: `${escapeHtml(error)} <a class="rp-link" href="/repositories/new${filterQuery ? `?q=${encodeURIComponent(filterQuery)}` : ""}">Try again</a>`,
    })
    : "";
  const filterForm = available.length > 0 || filterQuery
    ? `<form class="rp-filter" method="get" action="/repositories/new" role="search">
        <label class="sr-only" for="repository-filter">Filter Repositories</label>
        <input id="repository-filter" class="ax-input" name="q" type="search" value="${escapeHtml(filterQuery)}" maxlength="200" autocomplete="off" placeholder="Filter Repositories">
        ${button({ label: "Filter", variant: "outline", type: "submit" })}
      </form>
      ${filterQuery ? `<p class="rp-count">Showing <span class="tabular-nums">${visible.length}</span> of <span class="tabular-nums">${available.length}</span> Repositories. <a class="rp-link" href="/repositories/new">Clear filter</a></p>` : ""}`
    : "";
  const addForm = (repository: GitHubRepository, enrolled: boolean, removedAt: string | null | undefined, repositoryCsrf: string) => {
    if (enrolled && !removedAt) {
      return `<a class="rp-addb rp-done" href="${escapeHtml(repositoryLink({ githubId: repository.id }))}" aria-label="Added. Open ${escapeHtml(repository.name)}">Added</a>`;
    }
    const id = escapeHtml(repository.id);
    const verb = removedAt ? "Re-add" : "Add";
    return `<form id="add-repository-${id}" class="rp-addform" action="/repositories" method="post" hx-post="/repositories" hx-target="this" hx-swap="none" hx-indicator="#add-progress-${id}" hx-disabled-elt="button[type='submit']"><input type="hidden" name="csrf" value="${escapeHtml(repositoryCsrf || csrfToken)}"><input type="hidden" name="repository_id" value="${id}"><span data-form-status class="sr-only" role="status" aria-live="polite"></span><button class="rp-addb" type="submit" aria-label="${verb} ${escapeHtml(repository.name)}">${verb}</button><span id="add-progress-${id}" class="htmx-indicator rp-progress" role="status" aria-live="polite">${removedAt ? "Re-adding…" : "Adding…"}</span></form>`;
  };

  const list = visible.length === 0 && !error && !filterQuery
    ? emptyCard({
      title: "No Repositories available",
      body: "The Atlas GitHub App can’t see any Repositories in the allowed organization yet.",
      glyph: "folder",
    })
    : visible.length === 0 && filterQuery
      ? emptyCard({
        title: "No matching Repositories",
        body: "Nothing matches this filter.",
        glyph: "folder",
        actionHtml: button({ label: "Clear filter", variant: "outline", href: "/repositories/new" }),
      })
      : visible.length > 0
        ? group(
          visible.map(({ repository, enrolled, removedAt, csrfToken: repositoryCsrf }) =>
            `<div class="ax-row rp-avail">${repositoryTile(repository, 36)}<span class="ax-row-main"><span class="ax-row-title">${escapeHtml(repository.name)}</span><span class="ax-row-sub">${availableSub(repository, enrolled, removedAt)}</span></span>${addForm(repository, enrolled, removedAt, repositoryCsrf)}</div>`),
          { label: "Repositories the Atlas GitHub App can see" },
        )
        : "";

  return renderShell({
    title: "Add Repository",
    csrfToken,
    inbox,
    tab: "repos",
    // Back link in the page title only (the shell would also put it in the phone bar).
    content: `${pageTitle({ title: "Add Repository", back: { href: "/repositories", label: "Repositories" } })}
    <div class="rp-page rp-add">
      ${errorMarkup}
      ${filterForm}
      ${list}
      ${groupFoot("Only Repositories the Atlas GitHub App can see are listed. Adding one doesn’t change anything on GitHub.")}
    </div>`,
  });
};
