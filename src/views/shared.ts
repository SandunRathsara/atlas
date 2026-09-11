import type { RefreshState, Repository, Session, SessionState, Spec } from "../persistence.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";

export type ActivePage = "repositories" | "new-repository" | "specs" | "spec" | "pull-requests" | "sessions";

export const repositoryLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/specs`;
export const pullRequestsLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/pull-requests`;
export const sessionsLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/sessions`;

export const statusBadge = (tone: string, label: string) =>
  `<span class="badge badge-sm shrink-0 whitespace-nowrap ${tone}">${escapeHtml(label)}</span>`;

export const alertSoft = (state: string, role: "alert" | "status", body: string, extra = "") =>
  `<div class="alert alert-${state} alert-soft mt-6 leading-normal" role="${role}"${extra}>${body}</div>`;

export const emptyState = (title: string, body: string, action = "") =>
  `<div class="mt-6 rounded-box border border-edge bg-base-100 p-5">
    <p class="text-base font-semibold">${title}</p>
    <p class="mt-2 max-w-prose text-base leading-normal text-muted">${body}</p>
    ${action}
  </div>`;

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
}) => `<div class="flex flex-wrap items-start justify-between gap-4">
  <div class="min-w-0">
    ${eyebrow ? `<p class="text-xs font-medium uppercase tracking-wide text-accent">${escapeHtml(eyebrow)}</p>` : ""}
    <h1 id="page-title" class="${eyebrow ? "mt-2" : ""} w-fit max-w-full break-words text-xl font-semibold leading-normal" tabindex="-1" data-page-heading>${title}</h1>
    ${description ? `<p class="mt-2 max-w-prose text-base leading-normal text-muted">${description}</p>` : ""}
  </div>
  ${actions ? `<div class="flex flex-wrap items-center gap-2">${actions}</div>` : ""}
</div>`;

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
  return `<div class="mt-6 overflow-hidden rounded-box border border-edge bg-base-100">
    <div class="atlas-table hidden md:block" role="region" aria-label="${escapeHtml(label)}">
      <table class="table table-compact">
        <caption class="sr-only">${escapeHtml(label)}</caption>
        <thead><tr>${head}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
    <ul class="divide-y divide-edge md:hidden" aria-label="${escapeHtml(label)}">${stacked.join("")}</ul>
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

export const eligibilityNotice = (repository: Repository) => {
  const reasons = [
    repository.archived ? "Archived Repositories remain browsable, but cannot start Sessions." : "",
    repository.disabled ? "Disabled Repositories remain browsable, but cannot start Sessions." : "",
    !repository.defaultBranch ? "This Repository has no default-branch commit, so it cannot start Sessions." : "",
  ].filter(Boolean);
  return reasons.join(" ");
};

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
      ? alertSoft("warning", "status", `<div><strong>This Repository was removed from Atlas.</strong> Existing queued and executing Sessions, history, associations, and local resources are preserved. New starts are disabled until the same GitHub Repository is re-added and verified.</div>`)
      : "",
    repository.accessStatus === "unknown"
      ? alertSoft("warning", "alert", `<div><strong>GitHub access could not be verified.</strong> Showing the last complete Atlas data when available. This does not confirm that access was removed.</div>`)
      : "",
    repository.accessStatus === "revoked"
      ? alertSoft("error", "alert", `<div><strong>GitHub App access is unavailable.</strong> This Repository was not present in the last complete installation inventory. Cached data is retained; Atlas will not treat it as eligible for new work.</div>`)
      : "",
    repository.accessStatus === "transferred"
      ? alertSoft("error", "alert", `<div><strong>Repository is outside the configured organization.</strong> Its cached data is retained and new work is paused.</div>`)
      : "",
    repository.accessStatus === "suspended"
      ? alertSoft("error", "alert", `<div><strong>The GitHub App installation is suspended.</strong> Cached data is retained and new work is paused.</div>`)
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

export const repositoryAction = (repository: Repository, csrfToken: string, compact = false) => {
  const id = encodeURIComponent(repository.githubId);
  const action = repository.removedAt ? "/repositories" : `/repositories/${id}/remove`;
  const label = repository.removedAt ? "Re-add Repository" : "Remove from Atlas";
  const progress = repository.removedAt ? "Re-adding Repository..." : "Removing Repository...";
  const buttonClass = `${repository.removedAt ? "btn-primary" : "btn-error"}${compact ? " btn-xs" : ""}`;
  return `<form id="repository-action-${escapeHtml(repository.githubId)}" class="flex items-center gap-2" action="${action}" method="post" hx-post="${action}" hx-target="this" hx-swap="none" hx-indicator="#repository-progress-${escapeHtml(repository.githubId)}" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    ${repository.removedAt ? `<input type="hidden" name="repository_id" value="${escapeHtml(repository.githubId)}">` : ""}
    <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
    <button class="btn ${buttonClass}" type="submit">${escapeHtml(label)}</button>
    <span id="repository-progress-${escapeHtml(repository.githubId)}" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">${progress}</span>
  </form>`;
};

export const renderRepositoryHeading = (repository: Repository, title: string, description: string, csrfToken?: string) => {
  const githubUrl = safeExternalUrl(repository.htmlUrl);
  const eligibility = eligibilityNotice(repository);
  return `${pageHeader({
    title: escapeHtml(title),
    description: escapeHtml(description),
    actions: `${statusBadge(accessBadgeClass(repository), accessLabel(repository))}
      ${githubUrl ? `<a class="btn btn-ghost" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} Open Repository on GitHub</a>` : ""}
      ${csrfToken ? repositoryAction(repository, csrfToken) : ""}`,
  })}
  ${eligibility ? alertSoft("warning", "status", escapeHtml(eligibility)) : ""}`;
};

export const sessionStateLabel = (state: SessionState) => {
  if (state === "failed_setup") return "Failed — setup";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

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

export const openCodeReadinessNotice = (readiness: { ready: boolean; reason?: string } | undefined) =>
  readiness && !readiness.ready
    ? alertSoft("warning", "status", `<div><strong>OpenCode launches are paused.</strong> ${escapeHtml(readiness.reason ?? "The approved OpenCode service is unavailable or incompatible.")} Atlas remains available with cached Session data and will reconcile before resuming.</div>`)
    : "";

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
