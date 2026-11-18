// App frame pieces: sidebar live list, Repository filter, account menu, phone tabs, warning strip.
import type { InboxRow, RefreshState, Repository } from "../persistence.ts";
import type { RecoveryStatus } from "../recovery-status.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import { icon, type IconName } from "./icons.ts";
import type { InboxContext } from "./inbox.ts";
import { ageShort, notLiveTag, statusForSession, statusTile } from "./kit.ts";

export type FrameTab = "inbox" | "sessions" | "prs" | "repos" | "more";

/** Active tab from the current path. Session and Spec pages belong to the tab that lists them. */
export const tabForPath = (path: string): FrameTab | undefined => {
  if (path === "/inbox" || path === "/inbox/list" || path === "/") return "inbox";
  if (path === "/more" || path.startsWith("/updates")) return "more";
  if (path === "/pull-requests" || /^\/repositories\/[^/]+\/pull-requests/.test(path)) return "prs";
  if (path === "/sessions" || path.startsWith("/sessions/") || /^\/repositories\/[^/]+\/sessions$/.test(path)) return "sessions";
  if (path.startsWith("/repositories")) return "repos";
  return undefined;
};

const NAV: Array<{ tab: Exclude<FrameTab, "more">; href: string; short: string; glyph: IconName }> = [
  { tab: "inbox", href: "/inbox", short: "Inbox", glyph: "inbox" },
  { tab: "sessions", href: "/sessions", short: "Sessions", glyph: "sparkle" },
  { tab: "prs", href: "/pull-requests", short: "PRs", glyph: "pr" },
  { tab: "repos", href: "/repositories", short: "Repos", glyph: "folder" },
];

const NAV_FULL: Record<Exclude<FrameTab, "more">, string> = {
  inbox: "Inbox",
  sessions: "Sessions",
  prs: "Pull requests",
  repos: "Repositories",
};

/** Desktop sidebar segmented control: Inbox · Sessions · PRs · Repos. */
export const renderSideNav = (tab: FrameTab | undefined) =>
  `<nav class="ax-seg" aria-label="Atlas">${NAV.map((item) =>
    `<a href="${item.href}"${tab === item.tab ? ' aria-current="page"' : ""}><span aria-hidden="true">${item.short}</span><span class="sr-only">${NAV_FULL[item.tab]}</span></a>`,
  ).join("")}</nav>`;

/** Phone bottom tabs: Inbox · Sessions · PRs · Repos · More. */
export const renderTabBar = (tab: FrameTab | undefined) =>
  `<nav class="ax-tabbar" aria-label="Atlas">${[...NAV, { tab: "more" as const, href: "/more", short: "More", glyph: "more" as IconName }].map((item) =>
    `<a href="${item.href}"${tab === item.tab ? ' aria-current="page"' : ""}>${icon(item.glyph, 25)}<span>${item.short}</span></a>`,
  ).join("")}</nav>`;

// ── Repository filter ───────────────────────────────────────────────────

/**
 * One "All Repositories ▾" dropdown. A GET form to /inbox with `repository=<id>` (same contract as
 * the old select). `place` keeps ids unique: "bar" is the desktop top bar, "head" sits beside the
 * phone large title. `action` is the page the choice reloads (Inbox, Sessions or Pull requests).
 */
export const repositoryFilter = (inbox: InboxContext, place: "bar" | "head" = "head", action = "/inbox") => {
  const selected = inbox.filtered?.githubId ?? "";
  const name = inbox.filtered?.fullName ?? "All Repositories";
  const id = place === "bar" ? "inbox-repository" : "inbox-head-repository";
  const option = (value: string, label: string, glyph?: IconName) =>
    `<button class="ax-menu-item" type="submit" name="repository" value="${escapeHtml(value)}"${value === selected && value !== "manage" ? ' aria-current="true"' : ""}>${glyph ? icon(glyph, 18) : ""}<span class="min-w-0 flex-1 truncate">${escapeHtml(label)}</span>${value === selected && value !== "manage" ? icon("check", 18, "ax-tick") : ""}</button>`;
  return `<details class="ax-dd${place === "head" ? "" : " ax-dd-left"}" id="${id}" data-menu>
  <summary aria-label="Repository filter: ${escapeHtml(name)}"><span>${escapeHtml(place === "head" && !inbox.filtered ? "All" : name)}</span>${icon("chevron-down", 14)}</summary>
  <form class="ax-dd-panel" action="${escapeHtml(action)}" method="get">
    ${option("", "All Repositories")}
    ${inbox.repositories.filter((repository) => !repository.removedAt || repository.githubId === selected).map((repository) => option(repository.githubId, repository.fullName)).join("")}
    <hr class="ax-menu-hr">
    ${option("manage", "Manage Repositories…", "sliders")}
    <a class="ax-menu-item" href="/repositories/new" aria-label="Add a Repository">${icon("plus", 18)}Add a Repository</a>
  </form>
</details>`;
};

// ── Sidebar live list (#inbox-list; polled every 30s via /inbox/list) ────

type LiveGroup = InboxRow["group"];
const LIVE_ORDER: LiveGroup[] = ["needs_you", "in_progress", "not_started", "settled"];
const LIVE_LABEL: Record<LiveGroup, string> = {
  needs_you: "Needs you",
  in_progress: "In progress",
  not_started: "Not started",
  settled: "Settled",
};

const liveHref = (row: InboxRow) =>
  row.session
    ? `/sessions/${encodeURIComponent(row.session.atlasId)}`
    : `/repositories/${encodeURIComponent(row.repositoryId)}/specs/${encodeURIComponent(row.issueNumber)}`;

const sessionWord = (row: InboxRow) => {
  const state = row.session?.state;
  if (!state) return "No Session";
  if (state === "failed_setup") return "Failed — setup";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

const liveItem = (row: InboxRow, inbox: InboxContext, now: number) => {
  const selected = inbox.selectedSpec?.repositoryId === row.repositoryId && inbox.selectedSpec.issueNumber === row.issueNumber;
  const status = statusForSession(row.session?.state);
  const repository = inbox.repositories.find((item) => item.githubId === row.repositoryId);
  const access = repository && repository.accessStatus !== "available" ? `, ${repository.accessStatus === "unknown" ? "access unknown" : "access unavailable"}` : "";
  const when = row.session ? (row.session.terminalAt ?? row.session.submittedAt) : row.updatedAt;
  const age = ageShort(when, now);
  const label = `${row.title}. ${sessionWord(row)}${row.session?.stale ? ", not live" : ""}${access}. ${inbox.filtered ? "" : `${row.repositoryName}, `}Spec #${row.issueNumber}${row.unread ? ". New" : ""}`;
  return `<a id="inbox-${escapeHtml(row.repositoryId)}-${escapeHtml(row.issueNumber)}" class="ax-live-item" href="${escapeHtml(liveHref(row))}"${selected ? ' aria-current="page"' : ""} aria-label="${escapeHtml(label)}" title="${escapeHtml(`${row.title} · ${inbox.filtered ? "" : `${row.repositoryName} · `}Spec #${row.issueNumber}`)}">
    ${statusTile(status, "sm")}<span class="ax-live-t">${row.unread ? '<span class="ax-unread" aria-hidden="true"></span>' : ""}${escapeHtml(row.title)}</span><span class="ax-live-w" aria-hidden="true">${row.session?.stale ? notLiveTag() : escapeHtml(age)}</span>
  </a>`;
};

const specsRefreshUnavailable = (state: RefreshState | undefined) =>
  !state || state.availability === "never" || state.availability === "unavailable" || state.availability === "partial";

const liveEmpty = (inbox: InboxContext) => {
  if (inbox.repositories.length === 0) {
    return `<p class="ax-live-note">No Repositories yet. <a href="/repositories/new">Add a Repository</a></p>`;
  }
  if (inbox.list.rows.length > 0 || inbox.specsRefresh.some(specsRefreshUnavailable)) return "";
  if (inbox.filtered) {
    return `<p class="ax-live-note">No Specs in this Repository. <a href="/inbox?repository=">Show all Repositories</a></p>`;
  }
  return `<p class="ax-live-note">No work yet. Specs show up here once a Repository has them.</p>`;
};

const liveUnavailable = (inbox: InboxContext) => {
  const reasons = inbox.specsRefresh
    .filter(specsRefreshUnavailable)
    .map((state) => state?.failureReason?.trim() || "Specs have not synchronized yet.")
    .filter((reason, index, values) => values.indexOf(reason) === index);
  return reasons.length
    ? `<div class="ax-live-note ax-live-warn" role="note"><b>Specs unavailable.</b> ${reasons.map(escapeHtml).join(" ")}</div>`
    : "";
};

const liveUtility = (repository: Repository, inbox: InboxContext) => {
  const prs = `/repositories/${encodeURIComponent(repository.githubId)}/pull-requests`;
  const sessions = `/repositories/${encodeURIComponent(repository.githubId)}/sessions`;
  const github = safeExternalUrl(repository.htmlUrl);
  const allCurrent = inbox.currentPath === sessions && inbox.currentSessionFilter === "all";
  return `<nav class="ax-live-utility" aria-label="Filtered Repository">
    <a id="inbox-utility-pull-requests" href="${escapeHtml(prs)}"${inbox.currentPath === prs ? ' aria-current="page"' : ""}>${icon("pr", 18)}Pull requests</a>
    <a id="inbox-utility-all-sessions" href="${escapeHtml(`${sessions}?status=all`)}"${allCurrent ? ' aria-current="page"' : ""}>${icon("sparkle", 18)}All Sessions</a>
    ${github ? `<a id="inbox-utility-open-on-github" href="${escapeHtml(github)}" target="_blank" rel="noopener noreferrer">${icon("external", 18)}Open on GitHub</a>` : ""}
  </nav>`;
};

/** The sidebar live list. Keeps the #inbox-list polling contract (outerHTML swap every 30s). */
export const renderLiveList = (inbox: InboxContext, now = Date.now()) => {
  const empty = liveEmpty(inbox);
  const groups = empty
    ? empty
    : LIVE_ORDER.map((group) => {
      const rows = inbox.list.rows.filter((row) => row.group === group);
      if (rows.length === 0) return "";
      const items = rows.map((row) => liveItem(row, inbox, now)).join("");
      if (group === "settled") {
        const allSessions = inbox.filtered ? `/repositories/${encodeURIComponent(inbox.filtered.githubId)}/sessions?status=all` : "/sessions?status=all";
        return `<details id="inbox-settled" class="ax-live-group" open>
          <summary id="inbox-settled-summary" class="ax-live-h">${icon("chevron", 12)}Settled${inbox.list.settledNew > 0 ? ` <span class="ax-live-new">· ${inbox.list.settledNew} new</span>` : ""}</summary>
          ${items}
          <a id="inbox-view-all-sessions" class="ax-live-link" href="${escapeHtml(allSessions)}">View all Sessions</a>
        </details>`;
      }
      return `<section aria-label="${LIVE_LABEL[group]}"><p class="ax-live-h">${LIVE_LABEL[group]}</p>${items}</section>`;
    }).join("");
  return `<div id="inbox-list" tabindex="-1" class="ax-live" hx-get="/inbox/list" hx-trigger="every 30s" hx-swap="outerHTML" hx-push-url="false">
    <div data-inbox-scroll class="ax-live-scroll"><nav aria-label="Spec inbox">${liveUnavailable(inbox)}${groups}</nav></div>
    ${inbox.filtered ? liveUtility(inbox.filtered, inbox) : ""}
  </div>`;
};

// ── Account menu, theme control, sign out ───────────────────────────────

/** Auto · Light · Dark. JS-handled radio group (public/app.js); hidden without JS, where Atlas follows the device. */
export const themeControl = (idPrefix: string) =>
  `<fieldset class="ax-theme ax-needs-js" data-theme-control><legend class="sr-only">Appearance</legend><div class="ax-seg">${(["auto", "light", "dark"] as const).map((mode) =>
    `<label for="${idPrefix}-theme-${mode}"><input type="radio" id="${idPrefix}-theme-${mode}" name="${idPrefix}-theme" value="${mode}"${mode === "auto" ? " checked" : ""}>${mode.charAt(0).toUpperCase() + mode.slice(1)}</label>`,
  ).join("")}</div></fieldset>`;

/** Sign-out form: same contract as before (#logout-form, POST /logout, hidden csrf, hx-swap="none"). */
export const renderLogoutForm = (csrfToken: string, id = "logout-form") =>
  `<form id="${id}" action="/logout" method="post" hx-post="/logout" hx-target="#${id}" hx-swap="none" hx-indicator="#${id}-progress" hx-disabled-elt="button[type='submit']">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
  <button class="ax-menu-item" type="submit">${icon("sign-out", 18)}Sign out<span id="${id}-progress" class="htmx-indicator ml-auto text-sm text-muted" role="status" aria-live="polite">Signing out...</span></button>
</form>`;

export const renderAccountMenu = (csrfToken: string, tab: FrameTab | undefined) =>
  `<details class="ax-account" data-menu>
  <summary><span class="ax-avatar" aria-hidden="true">A</span>Account${icon("chevron", 14)}</summary>
  <div class="ax-account-menu">
    <p class="ax-menu-label ax-needs-js">Appearance</p>
    ${themeControl("side")}
    <hr class="ax-menu-hr ax-needs-js">
    <a class="ax-menu-item" href="/updates"${tab === "more" ? ' aria-current="page"' : ""}>${icon("refresh", 18)}Updates</a>
    ${renderLogoutForm(csrfToken)}
  </div>
</details>`;

// ── System warnings (backup, storage) ───────────────────────────────────

type Warning = { title: string; body: string; severity: "warning" | "error" };

/** Truthful one-line summaries of the recovery status file; healthy and successful states add nothing. */
export const systemWarnings = (status: RecoveryStatus): Warning[] => {
  const warnings: Warning[] = [];
  const lastBackup = escapeHtml(formatTime(status.backup.lastSuccessAt ?? null));
  if (status.backup.state === "failure") {
    warnings.push({ title: "Latest backup failed", body: `Last success: ${lastBackup}. Backup failure warns but does not by itself pause Session preparation.`, severity: "warning" });
  } else if (status.backup.state === "unknown") {
    warnings.push({ title: "Backup status unknown", body: "No current, valid local recovery status is available.", severity: "warning" });
  }
  const free = status.space.availableBytes === undefined ? "" : ` ${escapeHtml((status.space.availableBytes / (1024 ** 3)).toFixed(1))} GiB is available.`;
  const metadata = status.space.metadataPercent === undefined ? "" : ` Btrfs metadata is ${escapeHtml(String(status.space.metadataPercent))}% used.`;
  if (status.space.state === "warning") {
    warnings.push({ title: "Storage is under pressure", body: `${free}${metadata} New preparation remains available, but running Agents and changed snapshot blocks can still exhaust storage.`.trim(), severity: "warning" });
  } else if (status.space.state === "paused") {
    warnings.push({ title: "New Session preparation is paused by storage pressure", body: `${free}${metadata} Running Agents are not interrupted or deleted.`.trim(), severity: "error" });
  } else if (status.space.state === "unknown") {
    warnings.push({ title: "Storage check unknown", body: "New preparation remains paused on deployments using the required status gate until a current check succeeds.", severity: "warning" });
  }
  return warnings;
};

const stripLine = (warnings: Warning[]) => {
  if (warnings.length === 1) return warnings[0]!.title;
  const backup = warnings.find((warning) => warning.title.startsWith("Backup") || warning.title.startsWith("Latest backup"));
  const storage = warnings.find((warning) => !warning.title.startsWith("Backup") && !warning.title.startsWith("Latest backup"));
  if (backup?.title === "Backup status unknown" && storage?.title === "Storage check unknown") return "Backup and storage status unknown";
  return `${warnings[0]!.title} · ${warnings.length - 1} more`;
};

/** Thin amber strip under the top bar: one line plus Details (details/summary, works without JS). */
export const renderWarningStrip = (status: RecoveryStatus) => {
  const warnings = systemWarnings(status);
  if (warnings.length === 0) return "";
  const error = warnings.some((warning) => warning.severity === "error");
  return `<section class="ax-strips" aria-label="Recovery and storage status">
  <details class="ax-strip${error ? " ax-strip-error" : ""}" id="system-warnings">
    <summary>${icon("warn", 17)}<span class="ax-strip-line">${escapeHtml(stripLine(warnings))}</span><span class="ax-strip-more"><span class="ax-strip-more-closed">Details</span><span class="ax-strip-more-open">Hide</span></span></summary>
    <div class="ax-strip-body" role="${error ? "alert" : "status"}">${warnings.map((warning) => `<div><b>${escapeHtml(warning.title)}</b>${warning.body}</div>`).join("")}</div>
  </details>
</section>`;
};
