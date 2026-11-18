// Inbox screen. Phone and tablet (<1024px): the whole list (needs-you card, then Needs you →
// In progress → Not started → Settled). Desktop (≥1024px) is Mail-style: the sidebar live list is
// the list, and the main pane lazy-loads the real Session (or Spec) page of the top item.
import type { Inbox, InboxRow, RefreshState, Repository } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";
import { inboxItemHref, renderLiveList } from "./frame.ts";
import {
  ageShort,
  banner,
  button,
  emptyCard,
  group,
  groupLabel,
  heroCard,
  notLiveTag,
  plainTile,
  row,
  rowEnd,
  sectionHeader,
  sessionPill,
  statusForSession,
  statusTile,
} from "./kit.ts";
import type { ShellHeader } from "./shell.ts";
import { accessLabel } from "./shared.ts";

export type InboxContext = {
  repositories: Repository[];
  filtered?: Repository;
  list: Inbox;
  currentPath: string;
  currentSessionFilter?: string;
  selectedSpec?: { repositoryId: string; issueNumber: string };
  /** Opened from the Inbox (`?from=inbox`): keep the Inbox tab and lead back to it. */
  fromInbox?: boolean;
  specsRefresh: Array<RefreshState | undefined>;
};

type Group = InboxRow["group"];

// Same names and order as the sidebar live list.
const GROUP_LABEL: Record<Group, string> = {
  needs_you: "Needs you",
  in_progress: "In progress",
  not_started: "Not started",
  settled: "Settled",
};

/** Settled rows shown before the rest fold under "Show N more". */
const SETTLED_VISIBLE = 5;

const itemHref = inboxItemHref;

const rowsIn = (inbox: InboxContext, group: Group) => inbox.list.rows.filter((row) => row.group === group);

/** When the row's Session last moved (matches the sidebar ages). */
const rowTime = (row: InboxRow) => row.session ? (row.session.terminalAt ?? row.session.submittedAt) : row.updatedAt;

const specsRefreshUnavailable = (state: RefreshState | undefined) =>
  !state || state.availability === "never" || state.availability === "unavailable" || state.availability === "partial";

// ── Pane item (desktop) ─────────────────────────────────────────────────

/**
 * What the desktop main pane opens: the top Needs-you item, else the newest In-progress item,
 * else the top Not-started Spec. Settled-only (or empty) Inboxes get the calm state instead.
 */
export const inboxPaneItem = (inbox: InboxContext): InboxRow | undefined => {
  const needs = rowsIn(inbox, "needs_you")[0];
  if (needs) return needs;
  const working = rowsIn(inbox, "in_progress");
  if (working.length) {
    return working.reduce((newest, row) => (Date.parse(row.updatedAt) > Date.parse(newest.updatedAt) ? row : newest));
  }
  return rowsIn(inbox, "not_started")[0];
};

const onInboxPage = (inbox: InboxContext) => inbox.currentPath === "/inbox" || inbox.currentPath === "/inbox/list";

/** On the Inbox page, the sidebar item that the desktop pane shows is the selected one. */
const withPaneSelection = (inbox: InboxContext): InboxContext => {
  if (inbox.selectedSpec || !onInboxPage(inbox)) return inbox;
  const item = inboxPaneItem(inbox);
  return item ? { ...inbox, selectedSpec: { repositoryId: item.repositoryId, issueNumber: item.issueNumber } } : inbox;
};

// ── Rows ────────────────────────────────────────────────────────────────

const accessNote = (row: InboxRow, inbox: InboxContext) => {
  const repository = inbox.repositories.find((item) => item.githubId === row.repositoryId);
  if (!repository || repository.accessStatus === "available") return "";
  const tone = repository.accessStatus === "unknown" ? "t-waiting" : "t-failed";
  return ` · <span class="ix-access ${tone}">${escapeHtml(accessLabel(repository))}</span>`;
};

const subLine = (row: InboxRow, inbox: InboxContext) =>
  `${inbox.filtered ? "" : `${escapeHtml(row.repositoryName)} · `}Spec #${escapeHtml(row.issueNumber)}${accessNote(row, inbox)}`;

const inboxRow = (item: InboxRow, inbox: InboxContext) =>
  row({
    id: `inbox-page-${item.repositoryId}-${item.issueNumber}`,
    title: item.title,
    href: itemHref(item),
    tileHtml: statusTile(statusForSession(item.session?.state)),
    subHtml: subLine(item, inbox),
    endHtml: rowEnd({
      // Not-started rows carry no pill: the group already says so (as prototyped).
      pillHtml: item.session ? sessionPill(item.session.state, item.session.stale) : "",
      timeHtml: escapeHtml(ageShort(rowTime(item))),
    }),
    unread: item.unread,
  });

const needsCard = (row: InboxRow, inbox: InboxContext) => {
  const age = ageShort(row.updatedAt);
  return `<div class="ix-need">${heroCard({
    status: "waiting",
    warm: true,
    kicker: `Needs you${age ? ` · ${age}` : ""}`,
    title: row.title,
    subHtml: `<div class="ax-hero-s">${subLine(row, inbox)} · Answer the Agent in OpenCode${row.session?.stale ? ` ${notLiveTag()}` : ""}</div>`,
    actionHtml: button({ label: "Open Session", href: itemHref(row), attrs: `id="inbox-page-open-${escapeHtml(row.repositoryId)}-${escapeHtml(row.issueNumber)}"` }),
  })}</div>`;
};

const settledSection = (rows: InboxRow[], inbox: InboxContext) => {
  const allSessions = inbox.filtered
    ? `/repositories/${encodeURIComponent(inbox.filtered.githubId)}/sessions?status=all`
    : "/sessions?status=all";
  const count = inbox.list.settledNew > 0 ? `${inbox.list.settledNew} new` : inbox.list.settledTotal;
  const shown = rows.slice(0, SETTLED_VISIBLE).map((item) => inboxRow(item, inbox));
  const rest = rows.slice(SETTLED_VISIBLE).map((item) => inboxRow(item, inbox));
  return `<section class="ix-section" aria-labelledby="inbox-page-settled-h">
    ${sectionHeader({ title: GROUP_LABEL.settled, count, id: "inbox-page-settled-h", more: { href: allSessions, label: "All Sessions" } })}
    ${group(shown, { label: GROUP_LABEL.settled })}
    ${rest.length ? `<details id="inbox-page-settled-more" class="ix-more">
      <summary>${icon("chevron-down", 16)}<span class="ix-more-closed">Show ${rest.length} more</span><span class="ix-more-open">Show fewer</span></summary>
      ${group(rest, { label: `${GROUP_LABEL.settled}, more` })}
    </details>` : ""}
  </section>`;
};

const listSection = (key: Group, rows: InboxRow[], inbox: InboxContext) =>
  `<section class="ix-section" aria-labelledby="inbox-page-${key}-h">
    ${sectionHeader({ title: GROUP_LABEL[key], count: rows.length, id: `inbox-page-${key}-h` })}
    ${group(rows.map((item) => inboxRow(item, inbox)), { label: GROUP_LABEL[key] })}
  </section>`;

// ── States ──────────────────────────────────────────────────────────────

const specsUnavailable = (inbox: InboxContext) => {
  const reasons = inbox.specsRefresh
    .filter(specsRefreshUnavailable)
    .map((state) => state?.failureReason?.trim() || "Specs have not synchronized yet.")
    .filter((reason, index, values) => values.indexOf(reason) === index);
  if (reasons.length === 0) return "";
  return `<div class="ix-banner">${banner({ title: "Specs unavailable", body: `${reasons.join(" ")} Atlas keeps showing what it last saw.` })}</div>`;
};

/** The empty state for this Inbox, or "" when there is something to list (or Specs could not load). */
const emptyState = (inbox: InboxContext) => {
  if (inbox.repositories.length === 0) {
    return emptyCard({
      title: "No Repositories yet",
      body: "Add a Repository to see its Specs and Sessions here.",
      glyph: "folder",
      actionHtml: button({ label: "Add a Repository", href: "/repositories/new", icon: "plus" }),
    });
  }
  if (inbox.list.rows.length > 0 || inbox.specsRefresh.some(specsRefreshUnavailable)) return "";
  if (inbox.filtered) {
    return emptyCard({
      title: "No matches",
      body: `${inbox.filtered.fullName} has no open Specs right now.`,
      actionHtml: button({ label: "Show all Repositories", href: "/inbox?repository=", variant: "outline" }),
    });
  }
  return emptyCard({ title: "No work yet", body: "Specs show up here once a Repository has them." });
};

const caughtUp = () =>
  `<div class="ix-calm">${plainTile("check")}<span><b>All caught up</b><span>Nothing needs you right now.</span></span></div>`;

const utility = (repository: Repository) => {
  const prs = `/repositories/${encodeURIComponent(repository.githubId)}/pull-requests`;
  const sessions = `/repositories/${encodeURIComponent(repository.githubId)}/sessions?status=all`;
  const github = safeExternalUrl(repository.htmlUrl);
  return `<nav class="ix-section" aria-label="Filtered Repository">
    ${groupLabel(repository.fullName)}
    ${group([
      row({ id: "inbox-page-utility-pull-requests", title: "Pull requests", href: prs, tileHtml: plainTile("pr"), chevron: true }),
      row({ id: "inbox-page-utility-all-sessions", title: "All Sessions", href: sessions, tileHtml: plainTile("sparkle"), chevron: true }),
      github
        ? `<a id="inbox-page-utility-open-on-github" class="ax-row" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${plainTile("external")}<span class="ax-row-main"><span class="ax-row-title">Open on GitHub</span></span></a>`
        : "",
    ])}
  </nav>`;
};

// ── Phone / tablet list ─────────────────────────────────────────────────

const phoneList = (inbox: InboxContext) => {
  const empty = emptyState(inbox);
  if (empty) return empty;
  const needs = rowsIn(inbox, "needs_you");
  const [top, ...moreNeeds] = needs;
  const parts: string[] = [];
  if (top) {
    parts.push(needs.length > 1
      ? `<section class="ix-section ix-first" aria-labelledby="inbox-page-needs_you-h">
          ${sectionHeader({ title: GROUP_LABEL.needs_you, count: needs.length, id: "inbox-page-needs_you-h" })}
          ${needsCard(top, inbox)}
          <div class="ix-gap">${group(moreNeeds.map((item) => inboxRow(item, inbox)), { label: GROUP_LABEL.needs_you })}</div>
        </section>`
      : `<section class="ix-first" aria-label="${GROUP_LABEL.needs_you}">${needsCard(top, inbox)}</section>`);
  } else if (inbox.list.rows.length > 0) {
    parts.push(caughtUp());
  }
  for (const key of ["in_progress", "not_started"] as const) {
    const rows = rowsIn(inbox, key);
    if (rows.length) parts.push(listSection(key, rows, inbox));
  }
  const settled = rowsIn(inbox, "settled");
  if (settled.length) parts.push(settledSection(settled, inbox));
  return parts.join("");
};

// ── Desktop pane ────────────────────────────────────────────────────────

// Everything inside the target page's <main> except the polite status node and the warning
// strip (this page already has both), so the pane shows exactly that page's content.
const PANE_SELECT = "#main-content > :not(#global-status):not(.ax-strips)";

const paneSkeleton = () =>
  `<div class="ix-sk-head" aria-hidden="true"><span class="ax-sk ix-sk-eyebrow"></span><span class="ax-sk ix-sk-title"></span></div>
  <div class="ix-sk-hero" aria-hidden="true"><span class="ax-tile ax-tile-lg ax-sk"></span><span class="ix-sk-lines"><span class="ax-sk ax-sk-line"></span><span class="ax-sk ax-sk-line-short"></span></span></div>
  <div class="ix-sk-rows"><span class="ax-sk ix-sk-seg" aria-hidden="true"></span>${skeletonGroup()}</div>`;

const skeletonGroup = () =>
  `<div class="ax-group" aria-hidden="true">${Array.from({ length: 4 }, () => `<div class="ax-row"><span class="ax-tile ax-sk"></span><span class="ax-row-main"><span class="ax-sk ax-sk-line"></span><span class="ax-sk ax-sk-line-short"></span></span></div>`).join("")}</div>`;

const pane = (item: InboxRow, inbox: InboxContext) => {
  const href = itemHref(item);
  const kind = item.session ? "Session" : "Spec";
  return `<section class="ix-pane" aria-label="${escapeHtml(`${kind}: ${item.title}`)}">
    <div class="ix-pane-load ax-needs-js" hx-get="${escapeHtml(href)}" hx-trigger="intersect once" hx-select="${PANE_SELECT}" hx-swap="outerHTML ignoreTitle:true" hx-push-url="false" role="status" aria-label="${escapeHtml(`Loading ${item.title}`)}">
      ${paneSkeleton()}
      <p class="ix-pane-slow">Taking a while? <a href="${escapeHtml(href)}">Open the ${kind} page</a></p>
    </div>
    <div class="ix-pane-error" hidden>${banner({
      tone: "error",
      title: `Couldn’t load this ${kind}`,
      bodyHtml: `Atlas couldn’t show it here. <a class="ax-link" href="${escapeHtml(href)}">Open the ${kind} page</a>`,
    })}</div>
    <div class="ix-nojs">${heroCard({
      status: statusForSession(item.session?.state),
      kicker: GROUP_LABEL[item.group],
      title: item.title,
      sub: `${inbox.filtered ? "" : `${item.repositoryName} · `}Spec #${item.issueNumber}`,
      actionHtml: button({ label: `Open ${kind}`, href }),
    })}</div>
  </section>`;
};

/** Desktop main area when no item opens: empty states, or a calm settled-only overview. */
const calm = (inbox: InboxContext) => {
  const empty = emptyState(inbox);
  if (empty) return empty;
  if (inbox.list.rows.length === 0) return "";
  const allSessions = inbox.filtered
    ? `/repositories/${encodeURIComponent(inbox.filtered.githubId)}/sessions?status=all`
    : "/sessions?status=all";
  const fresh = inbox.list.settledNew;
  return emptyCard({
    title: "All caught up",
    body: `Nothing needs you and nothing is in progress.${fresh ? ` ${fresh} new ${fresh === 1 ? "result is" : "results are"} in Settled.` : ""} Pick any Spec in the sidebar to open it.`,
    glyph: "check",
    actionHtml: button({ label: "All Sessions", href: allSessions, variant: "outline" }),
  });
};

// ── Exports ─────────────────────────────────────────────────────────────

/** The sidebar live list (#inbox-list), polled by /inbox/list. Marks the pane item on the Inbox page. */
export const renderInboxList = (inbox: InboxContext) => renderLiveList(withPaneSelection(inbox));

/** Phone/tablet list body (kept for the `views.ts` re-export). */
export const renderInboxGroups = (inbox: InboxContext) => phoneList(inbox);

/** Inbox page content (below the shell header). */
export const renderInboxPage = (inbox: InboxContext) => {
  const item = inboxPaneItem(inbox);
  return `${specsUnavailable(inbox)}
  <div class="ix-list">
    ${phoneList(inbox)}
    ${inbox.filtered ? utility(inbox.filtered) : ""}
  </div>
  <div class="ix-desk">${item ? pane(item, inbox) : calm(inbox)}</div>`;
};

/** Everything `renderShell` needs for the Inbox: large title with the phone filter, content, body class. */
export const renderInboxScreen = (inbox: InboxContext): { header: ShellHeader; content: string; bodyClass: string } => ({
  header: { title: "Inbox", filter: true },
  content: renderInboxPage(inbox),
  bodyClass: inboxPaneItem(inbox) ? "ix-paned" : "",
});
