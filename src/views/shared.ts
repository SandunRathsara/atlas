import type { RefreshState, Repository, Session, SessionState, Spec } from "../persistence.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import { banner, confirmAction, segmented, type MenuItem } from "./kit.ts";

// New UI kit (Look A). Prefer these over the deprecated helpers below.
export * from "./kit.ts";
export { icon, logo, type IconName } from "./icons.ts";

export const repositoryLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/specs`;
export const pullRequestsLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/pull-requests`;
export const sessionsLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/sessions`;

/** @deprecated Use `statusPill` / `sessionPill` / `prPill` from the kit. */
export const statusBadge = (tone: string, label: string) =>
  `<span class="badge badge-sm shrink-0 whitespace-nowrap ${tone}">${escapeHtml(label)}</span>`;

/** @deprecated Use `banner({ tone, title, body })` from the kit. Legacy alerts are restyled to match it. */
export const alertSoft = (state: string, role: "alert" | "status", body: string, extra = "") =>
  `<div class="alert alert-${state} alert-soft mt-6 leading-normal" role="${role}"${extra}>${body}</div>`;

/** @deprecated Use `emptyCard({ title, body, actionHtml })` from the kit. Arguments are trusted markup. */
export const emptyState = (title: string, body: string, action = "") =>
  `<div class="ax-group mt-6"><div class="ax-empty">
    <b class="ax-empty-t">${title}</b>
    <p class="ax-empty-b">${body}</p>
    ${action}
  </div></div>`;

/** @deprecated Use `pageTitle(...)` from the kit (back link, actions, ⋯ menu, phone filter). Title is trusted markup. */
export const pageHeader = ({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: string;
}) => `${eyebrow ? `<p class="ax-eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<div class="ax-head">
  <div class="ax-head-main">
    <h1 id="page-title" class="ax-title" tabindex="-1" data-page-heading>${title}</h1>
  </div>
  ${actions ? `<div class="ax-head-actions">${actions}</div>` : ""}
  ${description ? `<p class="ax-head-desc">${description}</p>` : ""}
</div>`;

/** @deprecated Use `group()` + `row()` from the kit (wide desktop tables stay acceptable for now). */
export const recordTable = ({
  label,
  headers,
  aligns,
  rows,
  stacked,
}: {
  label: string;
  headers: string[];
  aligns?: Array<"left" | "right">;
  rows: string[];
  stacked: string[];
}) => {
  const head = headers
    .map((header, index) =>
      `<th scope="col" class="font-medium text-muted ${aligns?.[index] === "right" ? "text-right" : "text-left"}">${header}</th>`,
    )
    .join("");
  return `<div class="mt-6 overflow-hidden rounded-box bg-base-100">
    <div class="atlas-table hidden md:block" role="region" aria-label="${escapeHtml(label)}">
      <table class="table table-compact">
        <caption class="sr-only">${escapeHtml(label)}</caption>
        <thead><tr>${head}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
    <ul class="divide-y divide-edge md:hidden [&>li]:px-4 [&>li]:py-3" aria-label="${escapeHtml(label)}">${stacked.join("")}</ul>
  </div>`;
};

export const accessLabel = (repository: Repository) => {
  if (repository.removedAt) return "Removed from Atlas";
  if (repository.accessStatus === "unknown") return "Access unknown";
  if (repository.accessStatus === "revoked") return "Access unavailable";
  if (repository.accessStatus === "transferred") return "Transferred out of scope";
  if (repository.accessStatus === "suspended") return "App suspended";
  if (repository.archived) return "Archived";
  if (repository.disabled) return "Disabled";
  return "Available";
};

export const accessBadgeClass = (repository: Repository) => {
  if (repository.removedAt) return "badge-warning";
  if (repository.accessStatus === "unknown" || repository.accessStatus === "transferred" || repository.accessStatus === "suspended") {
    return "badge-warning";
  }
  if (repository.accessStatus === "revoked" || repository.disabled) return "badge-error";
  if (repository.archived) return "badge-warning";
  return "badge-success";
};

/** Plain reasons a Repository can't start Sessions, apart from access status (see `accessNotice`). */
export const eligibilityNotice = (repository: Repository) => {
  const reasons = [
    repository.archived ? "It’s archived on GitHub. You can still browse it." : "",
    repository.disabled ? "It’s disabled on GitHub. You can still browse it." : "",
    !repository.defaultBranch ? "Its default branch has no commit yet." : "",
    !repository.hasIssues ? "Issues are turned off for it on GitHub, so it has no Specs." : "",
  ].filter(Boolean);
  return reasons.join(" ");
};

/** Colour initial tile for a Repository (decorative; the name is always next to it). */
export const repositoryTile = (repository: { name: string; githubId?: string; id?: string; removedAt?: string | null; archived?: boolean }, size: 36 | 40 = 40) => {
  const key = repository.githubId ?? repository.id ?? repository.name;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const grey = Boolean(repository.removedAt) || repository.archived === true;
  const colour = grey ? "grey" : String(hash % 5);
  const initial = Array.from(repository.name.replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?";
  return `<span class="rp-tile rp-c${colour}${size === 36 ? " rp-tile-sm" : ""}" aria-hidden="true">${escapeHtml(initial)}</span>`;
};

/** One short truthful note for a Repository card ("Archived · can't start Sessions"), or undefined. */
export const repositoryNote = (repository: Repository): { text: string; tone: "warning" | "error" } | undefined => {
  if (repository.removedAt) return { text: "Removed from Atlas · history kept", tone: "warning" };
  if (repository.accessStatus === "unknown") return { text: "Access unverified · showing last-known data", tone: "warning" };
  if (repository.accessStatus === "revoked") return { text: "GitHub App access unavailable · can’t start Sessions", tone: "error" };
  if (repository.accessStatus === "transferred") return { text: "Outside the organization · can’t start Sessions", tone: "error" };
  if (repository.accessStatus === "suspended") return { text: "GitHub App suspended · can’t start Sessions", tone: "error" };
  if (repository.archived) return { text: "Archived · can’t start Sessions", tone: "warning" };
  if (repository.disabled) return { text: "Disabled on GitHub · can’t start Sessions", tone: "error" };
  if (!repository.defaultBranch) return { text: "No default-branch commit · can’t start Sessions", tone: "warning" };
  if (!repository.hasIssues) return { text: "Issues off on GitHub · no Specs", tone: "warning" };
  return undefined;
};

/** @deprecated Use `row({ tileHtml, title, sub })` from the kit. */
export const recordIdentity = (mark: string, body: string) =>
  `<div class="flex items-start gap-2"><span class="mt-0.5 text-faint">${mark}</span><div class="min-w-0 max-w-md">${body}</div></div>`;

export const recordActions = (actions: string) =>
  `<div class="record-actions">${actions}</div>`;

export const refreshLine = (label: string, refresh: RefreshState | undefined) => {
  if (!refresh || refresh.availability === "never") return `${label}: never synchronized`;
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return `${label}: last complete sync ${formatTime(refresh.lastSuccessAt)}; refresh pending`;
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return `${label}: last complete sync ${formatTime(refresh.lastSuccessAt)}; latest sync unavailable`;
  }
  return `${label}: synced ${formatTime(refresh.lastSuccessAt)}`;
};

export const refreshCell = (refresh: RefreshState | undefined) => {
  if (!refresh || refresh.availability === "never") {
    return `<span class="whitespace-nowrap">never synchronized</span>`;
  }
  const time = `<span class="tabular-nums">${formatTime(refresh.lastSuccessAt)}</span>`;
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return `<p class="whitespace-nowrap text-warning">refresh pending</p><p class="mt-1 whitespace-nowrap text-muted">last complete sync ${time}</p>`;
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return `<p class="whitespace-nowrap text-warning">latest sync unavailable</p><p class="mt-1 whitespace-nowrap text-muted">last complete sync ${time}</p>`;
  }
  return `<span class="whitespace-nowrap tabular-nums">synced ${time}</span>`;
};

export const refreshWarning = (label: string, refresh: RefreshState | undefined) => {
  if (!refresh || refresh.availability === "never") {
    const verb = label === "Access" ? "has" : "have";
    return alertSoft("info", "status", `<div><strong>${escapeHtml(label)} ${verb} not synchronized yet.</strong> An unavailable first read is not shown as an empty list.</div>`);
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return alertSoft("warning", "alert", `<div><strong>${escapeHtml(label)} synchronization is unavailable.</strong> Last complete sync: ${formatTime(refresh.lastSuccessAt)}. Cached data is retained.</div>`);
  }
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return alertSoft("warning", "status", `<div><strong>${escapeHtml(label)} synchronization is pending.</strong> Showing the last complete sync from ${formatTime(refresh.lastSuccessAt)}.</div>`);
  }
  if (refresh.failureReason) {
    return alertSoft("warning", "status", escapeHtml(refresh.failureReason));
  }
  if (refresh.lastSuccessAt && Date.now() - new Date(refresh.lastSuccessAt).valueOf() >= 10 * 60 * 1000) {
    return alertSoft("warning", "alert", `<div><strong>${escapeHtml(label)} synchronization is overdue.</strong> No successful sync has completed for ten minutes. Last complete sync: ${formatTime(refresh.lastSuccessAt)}.</div>`);
  }
  return "";
};

export const accessNotice = (repository: Repository) => {
  return [
    repository.removedAt
      ? banner({ tone: "warning", title: "Removed from Atlas", body: "Its history and existing Sessions are kept. It can’t start new Sessions until you re-add it. Nothing changed on GitHub." })
      : "",
    repository.accessStatus === "unknown"
      ? banner({ tone: "warning", role: "alert", title: "Couldn’t verify GitHub access", body: "Showing the last data Atlas read. This doesn’t mean access was removed. New Sessions wait until access is verified." })
      : "",
    repository.accessStatus === "revoked"
      ? banner({ tone: "error", title: "GitHub App access unavailable", body: "This Repository wasn’t in the App’s last complete installation list. Atlas keeps its cached data but won’t start new Sessions." })
      : "",
    repository.accessStatus === "transferred"
      ? banner({ tone: "error", title: "Outside the configured organization", body: "Its cached data is kept. New Sessions are paused." })
      : "",
    repository.accessStatus === "suspended"
      ? banner({ tone: "error", title: "GitHub App installation suspended", body: "Cached data is kept. New Sessions are paused." })
      : "",
  ].filter(Boolean).join("");
};

export const specsNotice = (refresh: RefreshState | undefined, specs: Spec[]) => {
  if (!refresh || refresh.availability === "never") {
    return alertSoft("info", "status", `<div><strong>Specs have not synchronized yet.</strong> An unavailable first read is not shown as an empty list.</div>`);
  }
  if (refresh.requestedGeneration > refresh.completedGeneration) {
    return alertSoft("warning", "status", `<div><strong>Specs synchronization is pending.</strong> ${specs.length > 0 ? `Showing the last complete sync from ${formatTime(refresh.lastSuccessAt)}.` : "No complete Specs sync is available yet."}</div>`);
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    const cached = specs.length > 0 ? ` Showing ${specs.length} Specs from the last complete sync at ${formatTime(refresh.lastSuccessAt)}.` : " No complete Specs sync is available yet.";
    return alertSoft("warning", "alert", `<div><strong>Specs synchronization is unavailable.</strong>${cached} Known membership was not removed.</div>`);
  }
  if (refresh.lastSuccessAt && Date.now() - new Date(refresh.lastSuccessAt).valueOf() >= 10 * 60 * 1000) {
    return alertSoft("warning", "alert", `<div><strong>Specs synchronization is overdue.</strong> Last complete sync: ${formatTime(refresh.lastSuccessAt)}.</div>`);
  }
  if (refresh.failureReason) {
    return alertSoft("warning", "status", escapeHtml(refresh.failureReason));
  }
  return "";
};

/**
 * Remove (confirm first) or Re-add. Remove is a kit `confirmAction` around the unchanged POST
 * form, so it asks before submitting even without JS. Re-add is the same enroll path as Add.
 */
export const repositoryAction = (repository: Repository, csrfToken: string, compact = false) => {
  const githubId = escapeHtml(repository.githubId);
  const action = repository.removedAt ? "/repositories" : `/repositories/${encodeURIComponent(repository.githubId)}/remove`;
  const form = (buttonHtml: string, progress: string) => `<form id="repository-action-${githubId}" class="rp-action" action="${action}" method="post" hx-post="${action}" hx-target="this" hx-swap="none" hx-indicator="#repository-progress-${githubId}" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    ${repository.removedAt ? `<input type="hidden" name="repository_id" value="${githubId}">` : ""}
    <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
    ${buttonHtml}
    <span id="repository-progress-${githubId}" class="htmx-indicator rp-progress" role="status" aria-live="polite">${progress}</span>
  </form>`;
  if (repository.removedAt) {
    return form(`<button class="ax-btn${compact ? " ax-btn-sm" : ""}" type="submit">Re-add</button>`, "Re-adding…");
  }
  return confirmAction({
    id: `remove-repository-${repository.githubId}`,
    label: "Remove from Atlas…",
    title: `Remove ${repository.name} from Atlas?`,
    body: "It leaves your lists and can’t start new Sessions. Its history and existing Sessions are kept, and you can re-add it later the same way. Nothing changes on GitHub.",
    confirmHtml: form(`<button class="ax-btn ax-btn-danger-fill" type="submit">Remove from Atlas</button>`, "Removing…"),
  });
};

const repositoryTabs = (repository: Repository, current: RepositorySection) => {
  const id = encodeURIComponent(repository.githubId);
  return segmented({
    label: `${repository.name} sections`,
    items: [
      { href: `/repositories/${id}/specs`, label: "Specs", current: current === "specs" },
      { href: `/repositories/${id}/pull-requests`, label: "Pull requests", current: current === "pull-requests" },
      { href: `/repositories/${id}/sessions`, label: "Sessions", current: current === "sessions" },
    ],
  });
};

export type RepositorySection = "specs" | "pull-requests" | "sessions";

/**
 * Repository pages (Specs, Pull requests, Sessions): `header` for `renderShell` (Repository name as the
 * h1, its description, back to Repositories, ⋯ menu with Open on GitHub and Remove) and `intro`, the
 * content that opens the page: removed note with Re-add, the section control and a "can't start
 * Sessions" note.
 */
export const repositoryPage = (repository: Repository, section: RepositorySection, csrfToken?: string) => {
  const githubUrl = safeExternalUrl(repository.htmlUrl);
  const eligibility = repository.removedAt ? "" : eligibilityNotice(repository);
  const items: MenuItem[] = [];
  if (githubUrl) items.push({ label: "Open on GitHub", href: githubUrl, external: true });
  if (csrfToken && !repository.removedAt) items.push({ label: "Remove from Atlas", danger: true, html: repositoryAction(repository, csrfToken) });
  const readd = csrfToken && repository.removedAt ? repositoryAction(repository, csrfToken, true) : "";
  const header = {
    title: repository.name,
    description: repository.description ?? repository.fullName,
    back: { href: "/repositories", label: "Repositories" },
    menu: items.length ? { title: repository.fullName, items, label: `More actions for ${repository.name}` } : undefined,
  };
  const intro = `<div class="rp-head">
  ${repository.removedAt ? `<div class="rp-removed"><span class="rp-note">Removed from Atlas · history kept</span>${readd}</div>` : ""}
  ${repositoryTabs(repository, section)}
  ${eligibility ? banner({ tone: "warning", title: "Can’t start Sessions", body: eligibility }) : ""}
</div>`;
  return { header, intro };
};

export const sessionStateLabel = (state: SessionState) => {
  if (state === "failed_setup") return "Failed — setup";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

/** @deprecated Use `statusForSession` + `statusPill` / `sessionPill` from the kit. */
export const sessionBadgeClass = (state: SessionState) => {
  if (state === "running") return "badge-info";
  if (state === "waiting") return "badge-warning";
  if (state === "succeeded") return "badge-success";
  if (state === "failed" || state === "failed_setup" || state === "interrupted") return "badge-error";
  return "badge-neutral";
};

export const handoffCheckpointLabel = (checkpoint: Session["handoffCheckpoint"]) => {
  if (checkpoint === "intent_saved") return "Intent saved";
  if (checkpoint === "events_consuming") return "Events consuming";
  if (checkpoint === "create_sent") return "Create sent once";
  if (checkpoint === "create_confirmed") return "Create confirmed";
  if (checkpoint === "associated") return "Association confirmed";
  if (checkpoint === "prompt_sent") return "Prompt sent once";
  if (checkpoint === "prompt_accepted") return "Prompt accepted";
  return "Not started";
};

export const sessionFreshnessMarkup = (session: Session) => {
  const stale = session.opencodeFreshness === "stale";
  const preparationUncertain = session.preparationCheckpoint === "start_unconfirmed";
  const handoffUncertain = Boolean(session.handoffUncertainReason);
  return `${stale ? statusBadge("badge-warning", "Stale") : ""}${preparationUncertain ? statusBadge("badge-warning", "Preparation unconfirmed") : handoffUncertain ? statusBadge("badge-warning", "Start unconfirmed") : ""}`;
};

export const sessionTargetLabel = (session: Session) => {
  if (session.targetKind === "native_stack") return `Native stack #${session.targetStackNumber ?? "unknown"}`;
  if (session.targetKind === "standalone_parent") return `Standalone parent #${session.targetParentPullRequestNumber ?? "unknown"}`;
  return `Default branch · ${session.targetBranch}`;
};

export const publicationStatusLabel = (status: Session["publicationStatus"]) => {
  if (status === "not_observed") return "Not observed";
  if (status === "unverified") return "Publication unverified";
  if (status === "ambiguous") return "Publication ambiguous";
  if (status === "identified") return "Publication identified";
  if (status === "qualifying") return "Qualifying publication";
  return "Reservation released";
};

export const publicationStatusClass = (status: Session["publicationStatus"]) =>
  status === "released" ? "badge-success" : status === "qualifying" ? "badge-info" : status === "identified" ? "badge-warning" : status === "not_observed" ? "badge-neutral" : "badge-warning";

export const publicationResultMarkup = (session: Session) => {
  if (!session.resultPullRequestId) return "No resulting Pull request is identified yet.";
  const url = safeExternalUrl(session.resultPullRequestUrl ?? "");
  const label = `#${session.resultPullRequestNumber ?? "unknown"}`;
  return url
    ? `<a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Pull request ${escapeHtml(label)}</a> <code class="font-mono text-sm">${escapeHtml(session.resultPullRequestId)}</code>`
    : `Pull request ${escapeHtml(label)} · <code class="font-mono text-sm">${escapeHtml(session.resultPullRequestId)}</code>`;
};

export const publicationRefreshMarkup = (refresh: RefreshState | undefined) => {
  if (!refresh) return "";
  const pending = refresh.requestedGeneration > refresh.completedGeneration;
  const unavailable = refresh.availability === "never" || refresh.availability === "unavailable" || refresh.availability === "partial";
  if (!pending && !unavailable) return "";
  const reason = pending
    ? "A current complete Pull request read is pending."
    : refresh.failureReason ?? "The latest GitHub Pull request read was unavailable.";
  return alertSoft("warning", "status", `<strong>Waiting for GitHub verification.</strong> ${escapeHtml(reason)} Ownership remains held until current publication evidence is confirmed.`);
};

export const publicationMarkup = (session: Session, pullRequestsRefresh?: RefreshState) => {
  const conflictCount = session.reservationConflictCount ?? 0;
  return `<div class="mt-6 rounded-box border border-edge bg-base-100 p-4">
  <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-base font-semibold">Publication</h2>${statusBadge(publicationStatusClass(session.publicationStatus), publicationStatusLabel(session.publicationStatus))}</div>
  <p class="mt-3 break-words">${publicationResultMarkup(session)}</p>
  ${publicationRefreshMarkup(pullRequestsRefresh)}
  ${session.publicationReason ? `<p class="mt-2 text-sm leading-normal text-muted">${escapeHtml(session.publicationReason)}</p>` : ""}
  <p class="mt-2 text-sm text-muted">Last publication evidence: ${escapeHtml(formatTime(session.publicationObservedAt))}</p>
  ${conflictCount > 0 ? alertSoft("warning", "status", `<div><strong>Reservation conflict hold recorded.</strong> ${conflictCount} durable hold${conflictCount === 1 ? "" : "s"} remain${conflictCount === 1 ? "s" : ""} until every involved owner releases. Existing execution is not cancelled.</div>`) : ""}
 </div>`;
};

export const sessionRecoveryNotice = (
  session: Session,
  viewer: { available?: boolean } | undefined,
  sessionDirectoryAvailable: boolean | undefined,
) => {
  const terminal = ["succeeded", "failed", "interrupted", "failed_setup"].includes(session.state);
  const directoryExpected = Boolean(session.directory) && !["queued", "intent_saved"].includes(session.preparationCheckpoint);
  const openCodeExpected = session.handoffCheckpoint !== "not_started" || Boolean(session.openCodeSessionId);
  const directoryUnavailable = directoryExpected && sessionDirectoryAvailable === false;
  const historyUnavailable = openCodeExpected && viewer?.available !== true;
  const associationUnavailable = openCodeExpected && !session.openCodeSessionId;
  if (!directoryUnavailable && !historyUnavailable && !associationUnavailable) return "";

  const details = [
    directoryUnavailable ? "The recorded Session directory is unavailable." : "",
    historyUnavailable ? "The preserved OpenCode Session history could not be verified." : "",
    associationUnavailable ? "The OpenCode Session identity is unavailable." : "",
  ].filter(Boolean).join(" ");
  const ownership = terminal
    ? session.executionSlotHeld
      ? "The recorded terminal outcome remains unchanged; the execution slot is still marked held."
      : "The recorded terminal outcome and released execution slot remain unchanged."
    : session.executionSlotHeld
      ? "The unfinished Session's execution slot and ownership remain held."
      : "The recorded Session state and released execution slot remain unchanged.";
  return alertSoft("warning", "alert", `<div><strong>Expected Session resource unavailable.</strong> ${escapeHtml(details)} Atlas retains its last known state and history; it will not recreate resources or infer a terminal outcome. ${ownership}</div>`);
};

export const openCodeReadinessNotice = (readiness: { ready: boolean; reason?: string; versionWarning?: string | null } | undefined) =>
  `${readiness && !readiness.ready
    ? alertSoft("warning", "status", `<div><strong>OpenCode launches are paused.</strong> ${escapeHtml(readiness.reason ?? "The OpenCode service is unavailable or incompatible.")} Atlas remains available with cached Session data and will reconcile before resuming.</div>`)
    : ""}${readiness?.versionWarning
    // Diagnostic only; launches, readiness, and updates never depend on it.
    ? alertSoft("warning", "status", `<div><strong>OpenCode version mismatch.</strong> ${escapeHtml(readiness.versionWarning)} This notice does not pause launches or affect Atlas updates.</div>`, " data-opencode-version-warning")
    : ""}`;

export const persistenceHealthNotice = (health: { healthy: boolean; reason?: string | null } | undefined) =>
  health && !health.healthy
    ? alertSoft("error", "alert", `<div><strong>Atlas persistence is unhealthy.</strong> ${escapeHtml(health.reason ?? "New admission is paused while saved Session ownership is protected.")} Existing OpenCode work is preserved.</div>`)
    : "";

export const targetReconfirmationNeeded = (session: Session) =>
  session.state === "queued" &&
  session.admissionBlocked === true &&
  session.stateReason?.startsWith("Waiting for explicit target reconfirmation") === true;

export const sessionHistoryRow = (session: Session) => {
  const href = `/sessions/${encodeURIComponent(session.atlasId)}`;
  const identity = `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${href}">${escapeHtml(sessionStateLabel(session.state))} Session</a>
    <p class="mt-1 font-mono text-xs text-faint">Session ${escapeHtml(session.atlasId)}</p>`;
  return {
    row: `<tr>
      <td>${identity}</td>
      <td class="whitespace-nowrap"><span class="flex flex-wrap items-center gap-1">${statusBadge(sessionBadgeClass(session.state), sessionStateLabel(session.state))}${sessionFreshnessMarkup(session)}</span></td>
      <td class="whitespace-nowrap text-right tabular-nums">${session.submissionOrder}</td>
      <td class="whitespace-nowrap tabular-nums text-muted">${escapeHtml(formatTime(session.submittedAt))}</td>
      <td>${recordActions(`<a class="btn btn-ghost btn-xs" href="${href}">View Session</a>`)}</td>
    </tr>`,
    stacked: `<li class="p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">${identity}</div>
        <span class="flex flex-wrap items-center gap-1">${statusBadge(sessionBadgeClass(session.state), sessionStateLabel(session.state))}${sessionFreshnessMarkup(session)}</span>
      </div>
      <p class="mt-2 text-sm text-muted">Submitted ${escapeHtml(formatTime(session.submittedAt))} · Queue order <span class="tabular-nums">${session.submissionOrder}</span></p>
      <a class="btn btn-ghost btn-xs mt-3" href="${href}">View Session</a>
    </li>`,
  };
};
