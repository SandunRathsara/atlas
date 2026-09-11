import type { Inbox, InboxRow, Repository } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";
import { pullRequestsLink, sessionBadgeClass, sessionsLink, sessionStateLabel, statusBadge } from "./shared.ts";

export type InboxContext = {
  repositories: Repository[];
  filtered?: Repository;
  list: Inbox;
  currentPath: string;
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

const renderInboxRow = (row: InboxRow, unfiltered: boolean, currentPath: string) => {
  const href = inboxHref(row);
  const selected = currentPath === href;
  const waiting = row.group === "needs_you";
  const card = selected
    ? "rounded-box border border-edge bg-brand-tint p-3 border-l-2 border-brand-readable"
    : waiting
      ? "rounded-box border border-edge bg-base-100 p-3 border-l-2 border-warning"
      : "rounded-box border border-edge bg-base-100 p-3";
  const badge = row.session
    ? `${statusBadge(sessionBadgeClass(row.session.state), sessionStateLabel(row.session.state))}${
      row.session.stale ? statusBadge("badge-warning", "Stale") : ""
    }`
    : statusBadge("badge-neutral", "No Session");
  return `<div class="${card}">
    <div class="flex items-start gap-2">
      ${row.unread ? `<span class="mt-1 size-2 shrink-0 rounded-full bg-brand-readable"><span class="sr-only">New</span></span>` : ""}
      <div class="min-w-0 flex-1">
        <a id="inbox-${escapeHtml(row.repositoryId)}-${escapeHtml(row.issueNumber)}" class="text-sm font-medium text-brand-readable" href="${href}"${selected ? ' aria-current="page"' : ""}>${escapeHtml(row.title)}</a>
        <p class="mt-1 font-mono text-xs text-faint">Spec #${escapeHtml(row.issueNumber)}</p>
        ${unfiltered ? `<p class="mt-1 text-xs text-muted">${escapeHtml(row.repositoryName)}</p>` : ""}
        <div class="mt-2 flex flex-wrap items-center gap-1">${badge}</div>
      </div>
    </div>
  </div>`;
};

const renderInboxUtility = (repository: Repository) => {
  const github = safeExternalUrl(repository.htmlUrl);
  return `<nav class="border-t border-edge p-2" aria-label="Filtered Repository">
    <a class="flex h-8 items-center gap-2 rounded-field border-l-2 border-transparent px-3 text-sm font-medium text-muted" href="${pullRequestsLink(repository)}">${icon("code-bracket", 20)}<span>Pull requests</span></a>
    <div class="mt-1"><a class="flex h-8 items-center gap-2 rounded-field border-l-2 border-transparent px-3 text-sm font-medium text-muted" href="${sessionsLink(repository)}">${icon("command-line", 20)}<span>All Sessions</span></a></div>
    ${github ? `<div class="mt-1"><a class="flex h-8 items-center gap-2 rounded-field border-l-2 border-transparent px-3 text-sm font-medium text-muted" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 20)}<span>Open on GitHub</span></a></div>` : ""}
  </nav>`;
};

export const renderInboxGroups = (inbox: InboxContext) => {
  if (inbox.repositories.length === 0) {
    return `<p class="px-3 py-2 text-sm text-muted"><a class="text-brand-readable underline underline-offset-4" href="/repositories/new">Add a Repository</a></p>`;
  }
  if (inbox.list.rows.length === 0) {
    return `<p class="px-3 py-2 text-sm text-muted">No work yet</p>`;
  }

  const unfiltered = inbox.filtered === undefined;
  return GROUP_ORDER.map((group) => {
    const rows = inbox.list.rows.filter((row) => row.group === group);
    if (rows.length === 0) return "";
    const cards = rows.map((row) => renderInboxRow(row, unfiltered, inbox.currentPath)).join("");
    if (group === "settled") {
      const label = inbox.list.settledNew > 0 ? `Settled · ${inbox.list.settledNew} new` : "Settled";
      const allSessions = inbox.filtered
        ? `<a class="mt-2 inline-block px-3 text-sm text-brand-readable underline underline-offset-4" href="${sessionsLink(inbox.filtered)}">View all Sessions</a>`
        : "";
      return `<details class="mt-4">
        <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-faint">${escapeHtml(label)}</summary>
        <div class="mt-2 grid gap-2">${cards}</div>
        ${allSessions}
      </details>`;
    }
    return `<section class="mt-4">
      <h2 class="px-3 py-2 text-xs font-medium text-faint">${GROUP_LABEL[group]}</h2>
      <div class="grid gap-2">${cards}</div>
    </section>`;
  }).join("");
};

export const renderInboxList = (inbox: InboxContext) =>
  `<div id="inbox-list" class="flex min-h-0 flex-1 flex-col" hx-get="/inbox/list" hx-trigger="every 30s" hx-swap="outerHTML" hx-push-url="false">
    <div class="min-h-0 flex-1 overflow-y-auto p-2">${renderInboxGroups(inbox)}</div>
    ${inbox.filtered ? renderInboxUtility(inbox.filtered) : ""}
  </div>`;
