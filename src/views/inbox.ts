import type { Inbox, InboxRow, RefreshState, Repository } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import { icon, type IconName } from "./icons.ts";
import {
  emptyState,
  pageHeader,
  pullRequestsLink,
  recordIdentity,
  recordTable,
  sessionBadgeClass,
  sessionsLink,
  sessionStateLabel,
  statusBadge,
} from "./shared.ts";

export type InboxContext = {
  repositories: Repository[];
  filtered?: Repository;
  list: Inbox;
  currentPath: string;
  specsRefresh: Array<RefreshState | undefined>;
};

const GROUP_ORDER: InboxRow["group"][] = ["needs_you", "in_progress", "not_started", "settled"];

const GROUP_LABEL: Record<InboxRow["group"], string> = {
  needs_you: "Needs you",
  in_progress: "In progress",
  not_started: "Not started",
  settled: "Settled",
};

const inboxHref = (row: InboxRow) =>
  row.session
    ? `/sessions/${encodeURIComponent(row.session.atlasId)}`
    : `/repositories/${encodeURIComponent(row.repositoryId)}/specs/${encodeURIComponent(row.issueNumber)}`;

const rowBadges = (row: InboxRow, inbox: InboxContext) => {
  const repository = inbox.repositories.find((item) => item.githubId === row.repositoryId);
  const access = repository && repository.accessStatus !== "available"
    ? statusBadge("badge-error", "Access unavailable")
    : "";
  const state = row.session
    ? `${statusBadge(sessionBadgeClass(row.session.state), sessionStateLabel(row.session.state))}${
      row.session.stale ? statusBadge("badge-warning", "Stale") : ""
    }`
    : statusBadge("badge-neutral", "No Session");
  return `${state}${access}`;
};

const specIdentity = (row: InboxRow) =>
  `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${inboxHref(row)}">${escapeHtml(row.title)}</a>
    <p class="mt-1 font-mono text-xs text-faint">Spec #${escapeHtml(row.issueNumber)}</p>`;

const unreadDot = (row: InboxRow) =>
  row.unread
    ? `<span class="mt-1 size-2 shrink-0 rounded-full bg-brand-readable"><span class="sr-only">New</span></span>`
    : "";

const renderInboxRow = (row: InboxRow, inbox: InboxContext, unfiltered: boolean) => {
  const href = inboxHref(row);
  const selected = inbox.currentPath === href;
  const waiting = row.group === "needs_you";
  const card = selected
    ? "rounded-box border border-edge bg-brand-tint p-3 border-l-2 border-l-brand-readable"
    : waiting
      ? "rounded-box border border-edge bg-base-100 p-3 border-l-2 border-l-warning"
      : "rounded-box border border-edge bg-base-100 p-3";
  return `<div class="${card}">
    <div class="flex items-start gap-2">
      ${unreadDot(row)}
      <div class="min-w-0 flex-1">
        <a id="inbox-${escapeHtml(row.repositoryId)}-${escapeHtml(row.issueNumber)}" class="text-sm font-medium text-brand-readable" href="${href}"${selected ? ' aria-current="page"' : ""}>${escapeHtml(row.title)}</a>
        <p class="mt-1 font-mono text-xs text-faint">Spec #${escapeHtml(row.issueNumber)}</p>
        ${unfiltered ? `<p class="mt-1 text-xs text-muted">${escapeHtml(row.repositoryName)}</p>` : ""}
        <div class="mt-2 flex flex-wrap items-center gap-1">${rowBadges(row, inbox)}</div>
      </div>
    </div>
  </div>`;
};

const renderInboxPageRecords = (rows: InboxRow[], inbox: InboxContext, unfiltered: boolean, label: string) =>
  recordTable({
    label,
    headers: unfiltered ? ["Spec", "Repository", "State"] : ["Spec", "State"],
    rows: rows.map((row) =>
      `<tr${row.group === "needs_you" ? ' class="border-l-2 border-l-warning"' : ""}>
        <td>${recordIdentity(icon("document-text", 20), `${unreadDot(row)}${specIdentity(row)}`)}</td>
        ${unfiltered ? `<td class="text-muted">${escapeHtml(row.repositoryName)}</td>` : ""}
        <td class="whitespace-nowrap"><span class="flex flex-wrap items-center gap-1">${rowBadges(row, inbox)}</span></td>
      </tr>`
    ),
    stacked: rows.map((row) =>
      `<li class="p-3${row.group === "needs_you" ? " border-l-2 border-l-warning" : ""}">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">${unreadDot(row)}${specIdentity(row)}</div>
          <span class="flex flex-wrap items-center gap-1">${rowBadges(row, inbox)}</span>
        </div>
        ${unfiltered ? `<p class="mt-2 text-sm text-muted">${escapeHtml(row.repositoryName)}</p>` : ""}
      </li>`
    ),
  });

const utilityLink = (href: string, current: boolean, glyph: IconName, label: string, extra = "") =>
  `<a class="flex h-8 items-center gap-2 rounded-field border-l-2 ${current ? "border-l-brand-readable bg-brand-tint" : "border-transparent"} px-3 text-sm font-medium text-muted" href="${href}"${current ? ' aria-current="page"' : ""}${extra}>${icon(glyph, 20)}<span>${label}</span></a>`;

const renderInboxUtility = (repository: Repository, currentPath: string) => {
  const github = safeExternalUrl(repository.htmlUrl);
  const prs = pullRequestsLink(repository);
  const sessions = sessionsLink(repository);
  return `<nav class="border-t border-edge p-2" aria-label="Filtered Repository">
    ${utilityLink(prs, currentPath === prs, "code-bracket", "Pull requests")}
    <div class="mt-1">${utilityLink(sessions, currentPath === sessions, "command-line", "All Sessions")}</div>
    ${github ? `<div class="mt-1">${utilityLink(escapeHtml(github), false, "arrow-top-right-on-square", "Open on GitHub", ' target="_blank" rel="noopener noreferrer"')}</div>` : ""}
  </nav>`;
};

const renderInboxEmpty = (inbox: InboxContext, layout: "sidebar" | "page") => {
  const page = layout === "page";
  if (inbox.repositories.length === 0) {
    return page
      ? emptyState(
        "No Repositories",
        "Add a Repository to see Specs here.",
        `<a class="btn btn-primary mt-4" href="/repositories/new">${icon("plus", 16)} Add a Repository</a>`,
      )
      : `<p class="px-3 py-2 text-sm text-muted"><a class="text-brand-readable underline underline-offset-4" href="/repositories/new">Add a Repository</a></p>`;
  }
  if (inbox.list.rows.length > 0) return "";
  const blocked = inbox.specsRefresh.some((state) =>
    !state || state.availability === "never" || (state.availability === "unavailable" && state.failureReason),
  );
  if (blocked) {
    const reason = inbox.specsRefresh.find((state) => state?.failureReason)?.failureReason ?? "";
    return page
      ? emptyState("Specs unavailable", reason ? escapeHtml(reason) : "Specs have not synchronized yet.")
      : `<p class="px-3 py-2 text-sm text-muted">Specs unavailable${reason ? `: ${escapeHtml(reason)}` : ""}</p>`;
  }
  if (inbox.filtered) {
    return page
      ? emptyState(
        "No matches",
        "No Specs match this Repository filter.",
        `<a class="btn mt-4" href="/inbox?repository=">Show all Repositories</a>`,
      )
      : `<p class="px-3 py-2 text-sm text-muted">No matches</p><p class="px-3 py-2 text-sm"><a class="text-brand-readable underline underline-offset-4" href="/inbox?repository=">Show all Repositories</a></p>`;
  }
  return page
    ? emptyState("No work yet", "Enrolled Repositories have no Specs or Sessions yet.")
    : `<p class="px-3 py-2 text-sm text-muted">No work yet</p>`;
};

export const renderInboxFilter = (inbox: InboxContext, layout: "sidebar" | "page" = "sidebar") => {
  const page = layout === "page";
  const disabled = inbox.repositories.length === 0;
  const selected = inbox.filtered?.githubId ?? "";
  const selectId = page ? "inbox-page-repository" : "inbox-repository";
  const options = [
    `<option value=""${selected === "" ? " selected" : ""}>All Repositories</option>`,
    ...inbox.repositories.map((repository) =>
      `<option value="${escapeHtml(repository.githubId)}"${repository.githubId === selected ? " selected" : ""}>${escapeHtml(repository.fullName)}</option>`,
    ),
    `<option value="manage">Manage Repositories…</option>`,
  ].join("");
  const attrs = page || inbox.currentPath === "/inbox"
    ? `action="/inbox" method="get"`
    : `action="/inbox" method="get" hx-get="/inbox/list" hx-target="#inbox-list-body" hx-select="#inbox-list-body" hx-swap="innerHTML" hx-push-url="false" hx-trigger="change"`;
  return `<form class="${page ? "mt-6 max-w-2xl" : "p-2"}" ${attrs}>
    <div class="flex items-center gap-1">
      <label class="sr-only" for="${selectId}">Repository</label>
      <select id="${selectId}" class="select min-w-0 flex-1" name="repository"${disabled ? " disabled" : ""}>${options}</select>
      <a class="btn btn-ghost" href="/repositories/new" aria-label="Add a Repository">${icon("plus", 16)}</a>
    </div>
    <button class="btn mt-2${page ? "" : " w-full"}" type="submit">Filter</button>
  </form>`;
};

export const renderInboxGroups = (inbox: InboxContext, layout: "sidebar" | "page" = "sidebar") => {
  const empty = renderInboxEmpty(inbox, layout);
  if (empty) return empty;

  const unfiltered = inbox.filtered === undefined;
  return GROUP_ORDER.map((group) => {
    const rows = inbox.list.rows.filter((row) => row.group === group);
    if (rows.length === 0) return "";
    const label = group === "settled" && inbox.list.settledNew > 0
      ? `Settled · ${inbox.list.settledNew} new`
      : GROUP_LABEL[group];
    const allSessions = group === "settled" && inbox.filtered
      ? `<a class="mt-2 inline-block px-3 text-sm text-brand-readable underline underline-offset-4" href="${sessionsLink(inbox.filtered)}">View all Sessions</a>`
      : "";
    const body = layout === "page"
      ? renderInboxPageRecords(rows, inbox, unfiltered, GROUP_LABEL[group])
      : `<div class="${group === "settled" ? "mt-2 " : ""}grid gap-2">${rows.map((row) => renderInboxRow(row, inbox, unfiltered)).join("")}</div>`;
    const heading = layout === "page" ? "text-base font-semibold" : "px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint";
    if (group === "settled") {
      return `<details class="${layout === "page" ? "mt-6" : "mt-4"}">
        <summary class="cursor-pointer ${heading}">${escapeHtml(label)}</summary>
        ${body}
        ${allSessions}
      </details>`;
    }
    return `<section class="${layout === "page" ? "mt-6" : "mt-4"}">
      <h2 class="${heading}">${GROUP_LABEL[group]}</h2>
      ${body}
    </section>`;
  }).join("");
};

export const renderInboxList = (inbox: InboxContext) =>
  `<div id="inbox-list" class="flex min-h-0 flex-1 flex-col" hx-get="/inbox/list" hx-trigger="every 30s" hx-target="#inbox-list-body" hx-select="#inbox-list-body" hx-swap="innerHTML" hx-push-url="false">
    <div id="inbox-list-body" class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto p-2">${renderInboxGroups(inbox)}</div>
      ${inbox.filtered ? renderInboxUtility(inbox.filtered, inbox.currentPath) : ""}
    </div>
  </div>`;

export const renderInboxPage = (inbox: InboxContext) =>
  `${pageHeader({ title: "Inbox" })}
  ${renderInboxFilter(inbox, "page")}
  ${renderInboxGroups(inbox, "page")}
  ${inbox.filtered ? renderInboxUtility(inbox.filtered, inbox.currentPath) : ""}`;
