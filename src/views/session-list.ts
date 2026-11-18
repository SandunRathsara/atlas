// Sessions tab: one newest-first list with a status chip row, globally (/sessions) or inside a
// Repository (/repositories/:id/sessions). Rows never show the prompt (it lives on the Session page).
import type { RefreshState, Repository, Session, SessionFilter, SessionState } from "../persistence.ts";
import { escapeHtml } from "./html.ts";
import {
  ageShort,
  banner,
  chipRow,
  emptyCard,
  group,
  icon,
  repositoryPage,
  repositoryLink,
  row,
  rowEnd,
  sessionLabel,
  sessionPill,
  sessionsLink,
  statusForSession,
  statusTile,
} from "./shared.ts";
import { renderShell, type InboxContext } from "./shell.ts";

/** Chip order: the common states first, then the rarer ones (the row scrolls sideways on phones). */
const FILTERS: SessionFilter[] = ["active", "all", "running", "waiting", "queued", "preparing", "idle", "succeeded", "failed", "failed_setup", "interrupted"];

const filterLabel = (filter: SessionFilter) => {
  if (filter === "active") return "Active";
  if (filter === "all") return "All";
  if (filter === "failed_setup") return "Failed setup";
  return sessionLabel(filter);
};

const failedStates = new Set<SessionState>(["failed", "failed_setup", "interrupted"]);

const failureReason = (session: Session) => {
  if (session.stateReason) return session.stateReason;
  if (session.state === "failed_setup") return session.preparationReason ?? "Setup failed before the Agent started.";
  if (session.state === "interrupted") return "The Session was interrupted before it finished.";
  return "No failure reason was recorded.";
};

/** Extra line under finished rows: the Pull request it opened, or why it failed. */
const outcomeLine = (session: Session) => {
  if (session.state === "succeeded" && session.resultPullRequestId) {
    return `<span class="ls-pr">${icon("pr", 13)}PR #${escapeHtml(session.resultPullRequestNumber ?? "?")} opened</span>`;
  }
  if (failedStates.has(session.state)) return `<span class="ls-reason">${escapeHtml(failureReason(session))}</span>`;
  return "";
};

/** Amber note when Atlas is not sure the Session actually started. */
const uncertaintyLine = (session: Session) => {
  if (session.preparationCheckpoint === "start_unconfirmed") return `<span class="ls-note">${icon("warn", 13)}Preparation not confirmed</span>`;
  if (session.handoffUncertainReason) return `<span class="ls-note">${icon("warn", 13)}Start not confirmed</span>`;
  return "";
};

const sessionRow = (session: Session, now: number, repository?: Repository) => {
  // The list is newest-started first, so the row shows when the Session started (same key as the sort).
  const age = ageShort(session.submittedAt, now);
  const ageText = age === "now" ? "started just now" : age ? `started ${age} ago` : "";
  // Short Repository name like the Inbox; the Spec number when the Repository is already known.
  const place = repository ? `${repository.name} · Spec #${session.specIssueNumber}` : `Spec #${session.specIssueNumber}`;
  const sub = `${escapeHtml(place)}${ageText ? ` · <time datetime="${escapeHtml(session.submittedAt)}">${escapeHtml(ageText)}</time>` : ""}`;
  return row({
    title: session.specTitle,
    href: `/sessions/${encodeURIComponent(session.atlasId)}`,
    tileHtml: statusTile(statusForSession(session.state)),
    subHtml: `${sub}${outcomeLine(session)}${uncertaintyLine(session)}`,
    endHtml: rowEnd({ pillHtml: sessionPill(session.state, session.opencodeFreshness === "stale") }),
  });
};

const refreshPending = (refresh: RefreshState | undefined) =>
  Boolean(refresh) && (refresh!.requestedGeneration > refresh!.completedGeneration ||
    refresh!.availability === "never" || refresh!.availability === "unavailable" || refresh!.availability === "partial");

/** One note when GitHub hasn't confirmed the Pull requests behind the listed Sessions yet. */
const publicationNote = (names: string[], reason: string | null) => {
  if (names.length === 0) return "";
  const where = names.length === 1 ? names[0]! : `${names.length} Repositories`;
  return banner({
    tone: "warning",
    title: "Waiting for GitHub verification",
    body: `Atlas hasn't confirmed the latest Pull requests for ${where}. A finished Session's PR may not show yet.${reason ? ` ${reason}` : ""}`,
  });
};

const emptyState = (filter: SessionFilter, base: string, repository?: Repository, filtered?: Repository) => {
  const scope = repository || filtered ? "this Repository" : "your Repositories";
  const seeAll = `<a class="ls-more" href="${escapeHtml(`${base}?status=all`)}">See all Sessions ›</a>`;
  if (filter === "active") {
    return emptyCard({ glyph: "sparkle", title: "Nothing running", body: `No unfinished Sessions in ${scope}.`, actionHtml: seeAll });
  }
  if (filter === "all") {
    const target = repository ?? filtered;
    return emptyCard({
      glyph: "sparkle",
      title: "No Sessions yet",
      body: `Nobody has started a Session in ${scope}. Start one from a Spec.`,
      actionHtml: `<a class="ls-more" href="${escapeHtml(target ? repositoryLink(target) : "/repositories")}">${target ? "Open Specs" : "Open Repositories"} ›</a>`,
    });
  }
  return emptyCard({
    glyph: "sparkle",
    title: `No ${filterLabel(filter)} Sessions`,
    body: `No Session in ${scope} is ${filterLabel(filter).toLowerCase()} right now.`,
    actionHtml: seeAll,
  });
};

export const renderSessionsPage = ({
  csrfToken,
  repository,
  repositories = [],
  sessions,
  filter,
  pullRequestsRefresh,
  pullRequestsRefreshByRepository,
  inbox,
}: {
  csrfToken: string;
  repository?: Repository;
  repositories?: readonly Repository[];
  sessions: Session[];
  filter: SessionFilter;
  pullRequestsRefresh?: RefreshState;
  pullRequestsRefreshByRepository?: ReadonlyMap<string, RefreshState | undefined>;
  inbox?: InboxContext;
}) => {
  const now = Date.now();
  const repositoryById = new Map(repositories.map((item) => [item.githubId, item]));
  // The global list follows the frame's Repository filter so the list never contradicts it.
  const filtered = repository ? undefined : inbox?.filtered;
  // Newest-started first, by the same time each row shows (submission order breaks ties).
  const shown = (filtered ? sessions.filter((session) => session.repositoryId === filtered.githubId) : [...sessions])
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt) || right.submissionOrder - left.submissionOrder);
  const base = repository ? sessionsLink(repository) : "/sessions";

  const chips = chipRow({
    label: "Session status",
    items: FILTERS.map((value) => ({
      href: value === "active" ? base : `${base}?status=${encodeURIComponent(value)}`,
      label: filterLabel(value),
      current: value === filter,
    })),
  });

  const pendingRepositories = new Map<string, RefreshState>();
  for (const session of shown) {
    const refresh = repository ? pullRequestsRefresh : pullRequestsRefreshByRepository?.get(session.repositoryId);
    if (refreshPending(refresh)) pendingRepositories.set(session.repositoryId, refresh!);
  }
  const pendingNames = [...pendingRepositories.keys()].map((id) => (repository ?? repositoryById.get(id))?.fullName ?? "a Repository");
  const pendingReason = pendingRepositories.size === 1 ? [...pendingRepositories.values()][0]!.failureReason : null;

  const list = shown.length > 0
    ? group(shown.map((session) => sessionRow(session, now, repository || filtered ? undefined : repositoryById.get(session.repositoryId))), {
      label: `${filterLabel(filter)} Sessions`,
      id: "session-list",
    })
    : emptyState(filter, base, repository, filtered);

  const content = `<div class="ls-page">${chips}${publicationNote(pendingNames, pendingReason)}${list}</div>`;

  if (repository) {
    const page = repositoryPage(repository, "sessions", csrfToken);
    return renderShell({
      title: `${repository.fullName} Sessions`,
      csrfToken,
      inbox,
      tab: "repos",
      header: page.header,
      content: `${page.intro}${content}`,
    });
  }
  return renderShell({
    title: filter === "active" ? "Sessions" : `${filterLabel(filter)} Sessions`,
    csrfToken,
    inbox,
    tab: "sessions",
    header: { title: "Sessions", filter: true },
    content,
  });
};
