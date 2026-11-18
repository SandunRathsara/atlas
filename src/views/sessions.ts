import type { PrStack, PullRequest, RefreshState, Repository, Session, SessionFilter, Spec } from "../persistence.ts";
import { escapeHtml, formatTime, renderDocument, safeExternalUrl, skipLink } from "./html.ts";
import { icon } from "./icons.ts";
import {
  accessNotice,
  alertSoft,
  emptyState,
  pageHeader,
  publicationMarkup,
  publicationRefreshMarkup,
  publicationResultMarkup,
  publicationStatusLabel,
  recordActions,
  recordIdentity,
  recordTable,
  refreshLine,
  refreshWarning,
  renderRepositoryHeading,
  repositoryLink,
  sessionBadgeClass,
  sessionFreshnessMarkup,
  sessionsLink,
  sessionStateLabel,
  sessionTargetLabel,
  statusBadge,
} from "./shared.ts";
import { renderShell, type InboxContext, type PendingStartSession } from "./shell.ts";
import { renderStartTargetOptions } from "./targets.ts";
import { logo } from "./icons.ts";
import { banner, button, group, prose, sectionHeader, sessionPill, settingsRow } from "./kit.ts";
import { renderSpecMarkdown, specHref } from "./specs.ts";

const sessionFilterLabel = (filter: SessionFilter) => {
  if (filter === "active") return "Active";
  if (filter === "all") return "All";
  return sessionStateLabel(filter);
};

const errorBox = ({ id, title, bodyHtml, attrs = "" }: { id: string; title: string; bodyHtml: string; attrs?: string }) =>
  `<div id="${id}" class="sp-errbox" role="alert" tabindex="-1" data-focus-on-swap${attrs}>${icon("warn", 18)}<div><b>${escapeHtml(title)}</b>${bodyHtml}</div></div>`;

export const renderStartSessionForm = ({
  action,
  csrfToken,
  submissionId,
  prompt,
  error,
  existingSession,
  targetOptions,
  target = "default",
}: {
  action: string;
  csrfToken: string;
  submissionId: string;
  prompt: string;
  error?: string;
  existingSession?: Session;
  targetOptions?: string;
  target?: string;
}) => {
  const errorMarkup = error
    ? errorBox({
      id: "prompt-error",
      title: "Session not queued",
      bodyHtml: `<p>${escapeHtml(error)}</p>${existingSession ? `<a class="sp-errlink" href="${`/sessions/${encodeURIComponent(existingSession.atlasId)}`}">Open the existing Session ›</a>` : ""}`,
    })
    : "";
  const errorAttributes = error ? ' aria-describedby="prompt-hint prompt-error" aria-invalid="true"' : ' aria-describedby="prompt-hint"';
  const cancelHref = action.replace(/\/sessions$/, "");

  return `<form id="start-session-form" class="sp-form" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="#start-session-form" hx-swap="outerHTML" hx-indicator="#start-session-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="submission_id" value="${escapeHtml(submissionId)}">
    ${errorMarkup}
    ${targetOptions ?? `<input type="hidden" name="target" value="${escapeHtml(target)}">`}
    <div class="ax-field sp-prompt">
      <label class="ax-group-label sp-prompt-label" for="initial-prompt">Prompt</label>
      <textarea id="initial-prompt" class="ax-input sp-textarea" name="prompt" rows="7" maxlength="20000" required${errorAttributes}>${escapeHtml(prompt)}</textarea>
      <p id="prompt-hint" class="ax-hint">Required. Tell the Agent what to do. Atlas sends it exactly as written. Up to 20,000 characters.</p>
    </div>
    <div class="sp-form-foot">
      <span id="start-session-progress" class="htmx-indicator sp-progress" role="status" aria-live="polite">Starting Session…</span>
      ${button({ label: "Cancel", variant: "outline", href: cancelHref })}
      ${button({ label: "Start Session", type: "submit", icon: "play" })}
    </div>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

/** Phone top bar for full-screen forms: Cancel · title · primary action (submits `formId`). */
const sheetBar = ({ cancelHref, title, action, formId }: { cancelHref: string; title: string; action: string; formId: string }) =>
  `<div class="sp-sheetbar"><a class="sp-sheetbar-link" href="${escapeHtml(cancelHref)}">Cancel</a><span class="sp-sheetbar-title" aria-hidden="true">${escapeHtml(title)}</span><button class="sp-sheetbar-link sp-sheetbar-go" type="submit" form="${escapeHtml(formId)}">${escapeHtml(action)}</button></div>`;

const modalHead = (title: string, closeHref: string) =>
  `<div class="sp-modal-head"><h1 id="page-title" class="sp-modal-title" tabindex="-1" data-page-heading>${escapeHtml(title)}</h1><a class="ax-btn ax-btn-icon sp-modal-close" href="${escapeHtml(closeHref)}" aria-label="Cancel">${icon("x", 20)}</a></div>`;

export const renderStartSessionPage = ({
  action,
  csrfToken,
  repository,
  spec,
  submissionId,
  prompt,
  error,
  notice,
  existingSession,
  accessRefresh,
  pullRequests,
  stacks,
  pullRequestsRefresh,
  target,
  targetInvalid = false,
  inbox,
}: {
  action?: string;
  csrfToken: string;
  repository: Repository;
  spec: Spec;
  submissionId: string;
  prompt: string;
  error?: string;
  notice?: string;
  existingSession?: Session;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
  pullRequests?: PullRequest[];
  stacks?: PrStack[];
  pullRequestsRefresh?: RefreshState;
  target?: string;
  targetInvalid?: boolean;
  inbox?: InboxContext;
}) => {
  const formAction = action ?? `/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(spec.issueNumber)}/sessions`;
  const specUrl = specHref(spec);
  const retained = !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);
  const ghost = `<div class="sp-ghost" aria-hidden="true" inert>
      <p class="ax-eyebrow">${escapeHtml(repository.name)} · Spec #${escapeHtml(spec.issueNumber)}</p>
      <p class="ax-title">${escapeHtml(spec.title)}</p>
      ${spec.body.trim() ? prose(renderSpecMarkdown(spec.body)) : ""}
    </div>`;

  return renderShell({
    title: `Start Session · Spec #${spec.issueNumber}`,
    csrfToken,
    inbox,
    tab: "repos",
    bodyClass: "sp-start-page",
    content: `${sheetBar({ cancelHref: specUrl, title: "Start Session", action: "Start", formId: "start-session-form" })}
      <div class="sp-stage">
        ${ghost}
        <section class="sp-modal" aria-labelledby="page-title">
          ${modalHead("Start Session", specUrl)}
          <p class="sp-for">For <b>${escapeHtml(spec.title)}</b> · Spec #${escapeHtml(spec.issueNumber)}</p>
          ${notice ? banner({ tone: "info", title: "Your form is kept", body: `${notice} Atlas will not resubmit automatically.`, attrs: 'tabindex="-1" data-focus-on-swap' }) : ""}
          ${retained ? banner({ role: "alert", title: "This Spec can’t start a Session", body: "This issue is no longer an open Spec on GitHub. Atlas shows the last copy it saw." }) : ""}
          ${accessRefresh && (accessRefresh.availability === "unavailable" || accessRefresh.availability === "partial") ? banner({ title: "Couldn’t check GitHub access just now", body: "Atlas checks again when you start. Nothing is queued until it can." }) : ""}
          ${renderStartSessionForm({ action: formAction, csrfToken, submissionId, prompt, error, existingSession, targetOptions: renderStartTargetOptions(repository, pullRequests, stacks, accessRefresh, pullRequestsRefresh, target ?? "default", targetInvalid, "prompt-error"), target: target ?? "default" })}
        </section>
      </div>`,
  });
};

export const renderTargetReconfirmationPage = ({
  csrfToken,
  repository,
  session,
  targetOptions,
  error,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  targetOptions: string;
  error?: string;
  inbox?: InboxContext;
}) => {
  const sessionHref = `/sessions/${encodeURIComponent(session.atlasId)}`;
  const action = `${sessionHref}/target`;
  const form = renderTargetReconfirmationForm({ action, csrfToken, targetOptions, error });
  return renderShell({
    title: `Reconfirm target · ${session.atlasId}`,
    csrfToken,
    inbox,
    tab: "sessions",
    bodyClass: "sp-flow",
    header: {
      title: "Choose where to start",
      back: { href: sessionHref, label: "Session" },
    },
    content: `<p class="sp-meta">Spec #${escapeHtml(session.specIssueNumber)} · ${escapeHtml(session.specTitle)} · ${escapeHtml(repository.fullName)}</p>
      ${banner({
        title: "The place this Session starts from changed",
        body: `It was set to start from ${sessionTargetLabel(session)}, which Atlas can’t confirm any more. Pick a current one. The Session keeps its prompt and its place in the queue, and nothing changes on GitHub.`,
      })}
      ${form}`,
  });
};

export const renderTargetReconfirmationForm = ({
  action,
  csrfToken,
  targetOptions,
  error,
}: {
  action: string;
  csrfToken: string;
  targetOptions: string;
  error?: string;
}) => `<form id="target-reconfirmation-form" class="sp-form sp-flow-form" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="this" hx-swap="outerHTML" hx-indicator="#target-reconfirmation-progress" hx-disabled-elt="button[type='submit']"${error ? ' aria-describedby="target-reconfirmation-error"' : ""}>
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  ${error ? errorBox({ id: "target-reconfirmation-error", title: "Target not changed", bodyHtml: `<p>${escapeHtml(error)}</p>` }) : ""}
  ${targetOptions}
  <div class="sp-actions">
    ${button({ label: "Use this target", type: "submit" })}
    ${button({ label: "Cancel", variant: "outline", href: action.replace(/\/target$/, "") })}
    <span id="target-reconfirmation-progress" class="htmx-indicator sp-progress" role="status" aria-live="polite">Checking target…</span>
  </div>
  <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
</form>`;

const pendingNotice = () => banner({
  tone: "info",
  title: "Signed in",
  body: "Your prompt is kept below. Check it, then choose Start Session to send it. Atlas will not resubmit automatically.",
  attrs: 'tabindex="-1" data-focus-on-swap',
});

export const renderPendingStartSessionFragment = ({
  action,
  csrfToken,
  submissionId,
  prompt,
  target,
}: PendingStartSession & { csrfToken: string }) => `<div id="login-form" class="sp-pending-form">
  ${pendingNotice()}
  ${renderStartSessionForm({ action, csrfToken, submissionId, prompt, target })}
</div>`;

export const renderPendingStartSessionPage = ({
  action,
  csrfToken,
  submissionId,
  prompt,
  target,
}: PendingStartSession & { csrfToken: string }) => renderDocument(
  "Retry Start Session",
  `${skipLink}
  <main id="main-content" class="sp-pending" aria-labelledby="page-title">
    <section class="sp-modal sp-pending-card">
      <div class="sp-pending-brand">${logo(28, 7)}<span>Atlas</span></div>
      <h1 id="page-title" class="sp-modal-title" tabindex="-1" data-page-heading>Start Session</h1>
      <p class="sp-for">Your original prompt and submission are kept.</p>
      ${pendingNotice()}
      ${renderStartSessionForm({ action, csrfToken, submissionId, prompt, target })}
    </section>
  </main>`,
);

const sessionListRecord = (session: Session, pullRequestsRefresh?: RefreshState, repository?: Repository) => {
  const href = `/sessions/${encodeURIComponent(session.atlasId)}`;
  const identity = `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${href}">Spec #${escapeHtml(session.specIssueNumber)}: ${escapeHtml(session.specTitle)}</a>
    ${repository ? `<p class="mt-1 text-sm text-muted">${escapeHtml(repository.fullName)}</p>` : ""}
    <p class="mt-1 font-mono text-xs text-faint">Session ${escapeHtml(session.atlasId)}</p>`;
  const badges = `<span class="flex flex-wrap items-center gap-1">${statusBadge(sessionBadgeClass(session.state), sessionStateLabel(session.state))}${sessionFreshnessMarkup(session)}</span>`;
  const extra = `${session.stateReason ? `<p class="mt-2 max-w-prose text-sm leading-normal text-muted">${escapeHtml(session.stateReason)}</p>` : ""}
    ${session.resultPullRequestId ? `<p class="mt-2 max-w-prose text-sm leading-normal">Publication: ${publicationResultMarkup(session)}</p>` : ""}
    ${session.publicationReason ? `<p class="mt-2 max-w-prose text-sm leading-normal text-muted">Publication: ${escapeHtml(session.publicationReason)}</p>` : ""}
    ${publicationRefreshMarkup(pullRequestsRefresh)}`;
  return {
    row: `<tr>
      <td>${recordIdentity(icon("command-line", 20), `${identity}
            <p class="mt-1 max-w-prose truncate text-sm text-muted">Prompt: ${escapeHtml(session.prompt)}</p>
            ${extra}`)}</td>
      <td class="whitespace-nowrap">${badges}</td>
      <td class="whitespace-nowrap text-right tabular-nums">${session.submissionOrder}</td>
      <td class="whitespace-nowrap tabular-nums text-muted">${escapeHtml(formatTime(session.submittedAt))}</td>
      <td>${escapeHtml(sessionTargetLabel(session))}</td>
      <td>
        <p class="whitespace-nowrap text-sm">${session.executionSlotHeld ? "Held" : "Not held"}</p>
        <p class="mt-1 text-sm text-muted">${escapeHtml(publicationStatusLabel(session.publicationStatus))}</p>
        <p class="mt-1 text-sm text-muted">${session.reservationState === "held" ? "Held" : session.reservationState === "released" ? "Released" : "None"}</p>
      </td>
      <td>${recordActions(`<a class="btn btn-ghost btn-xs" href="${href}">View Session</a>`)}</td>
    </tr>`,
    stacked: `<li class="p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">${identity}</div>
        ${badges}
      </div>
      <dl class="mt-3 grid gap-2 text-sm">
        <div><dt class="font-medium text-muted">Submitted</dt><dd class="mt-1">${escapeHtml(formatTime(session.submittedAt))}</dd></div>
        <div><dt class="font-medium text-muted">Queue order</dt><dd class="mt-1 tabular-nums">${session.submissionOrder}</dd></div>
        <div><dt class="font-medium text-muted">Target</dt><dd class="mt-1">${escapeHtml(sessionTargetLabel(session))}</dd></div>
        <div><dt class="font-medium text-muted">Execution slot</dt><dd class="mt-1">${session.executionSlotHeld ? "Held" : "Not held"}</dd></div>
        <div><dt class="font-medium text-muted">Publication</dt><dd class="mt-1">${escapeHtml(publicationStatusLabel(session.publicationStatus))}</dd></div>
        <div><dt class="font-medium text-muted">Stack reservation</dt><dd class="mt-1">${session.reservationState === "held" ? "Held" : session.reservationState === "released" ? "Released" : "None"}</dd></div>
      </dl>
      <p class="mt-3 max-w-prose truncate text-sm text-muted">Prompt: ${escapeHtml(session.prompt)}</p>
      ${extra}
      <a class="btn btn-ghost btn-xs mt-3" href="${href}">View Session</a>
    </li>`,
  };
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
  const filters: SessionFilter[] = ["active", "all", "queued", "preparing", "running", "waiting", "idle", "succeeded", "failed", "interrupted", "failed_setup"];
  const global = !repository;
  const repositoryById = new Map(repositories.map((item) => [item.githubId, item]));
  const heading = filter === "active" ? "Active Sessions" : filter === "all" ? (global ? "All Sessions" : "Sessions") : `${sessionFilterLabel(filter)} Sessions`;
  const emptyText = filter === "active"
    ? `No unfinished Sessions are present in ${global ? "enrolled Repositories" : "this Repository"}.`
    : filter === "all"
      ? `No Atlas Sessions have been submitted for ${global ? "enrolled Repositories" : "this Repository"}.`
      : `No Sessions currently have the ${sessionFilterLabel(filter)} state.`;
  const description = global
    ? "Atlas implementation attempts across all enrolled Repositories. Active includes every unfinished Session, including Queued."
    : "Atlas implementation attempts for this Repository. Active includes every unfinished Session, including Queued.";
  const headingMarkup = repository
    ? renderRepositoryHeading(repository, heading, description, csrfToken)
    : pageHeader({ eyebrow: "Sessions", title: escapeHtml(heading), description: escapeHtml(description) });
  const records = sessions.map((session) => sessionListRecord(
    session,
    repository ? pullRequestsRefresh : pullRequestsRefreshByRepository?.get(session.repositoryId),
    global ? repositoryById.get(session.repositoryId) : undefined,
  ));
  const sessionsBase = repository ? sessionsLink(repository) : "/sessions";

  return renderShell({
    title: repository ? `${repository.fullName} Sessions` : "All Sessions",
    csrfToken,
    inbox,
    content: `${headingMarkup}
      <nav class="mt-6 flex flex-wrap gap-2" aria-label="Session status filters">
        ${filters.map((value) => `<a class="btn ${value === filter ? "btn-primary" : "btn-ghost"}" href="${value === "active" ? sessionsBase : `${sessionsBase}?status=${encodeURIComponent(value)}`}"${value === filter ? ' aria-current="page"' : ""}>${escapeHtml(sessionFilterLabel(value))}</a>`).join("")}
      </nav>
      ${sessions.length > 0
        ? recordTable({
          label: heading,
          headers: ["Session", "State", "Queue", "Submitted", "Target", "Ownership", "Actions"],
          aligns: ["left", "left", "right", "left", "left", "left", "left"],
          rows: records.map((record) => record.row),
          stacked: records.map((record) => record.stacked),
        })
        : emptyState(
          filter === "active" ? "No active Sessions" : "No matching Sessions",
          emptyText,
        )}`,
  });
};

const reservationLabel = (session: Session) =>
  session.reservationState === "held" ? "Held" : session.reservationState === "released" ? "Released" : "None";

/** Kit-styled publication facts for the reservation page (same data as the legacy `publicationMarkup`). */
const publicationSection = (session: Session, pullRequestsRefresh?: RefreshState) => {
  const conflictCount = session.reservationConflictCount ?? 0;
  const pullRequestUrl = session.resultPullRequestId ? safeExternalUrl(session.resultPullRequestUrl ?? "") : "";
  const pullRequestLabel = session.resultPullRequestId ? `PR #${session.resultPullRequestNumber ?? "unknown"}` : "None yet";
  const pending = pullRequestsRefresh && pullRequestsRefresh.requestedGeneration > pullRequestsRefresh.completedGeneration;
  const unavailable = pullRequestsRefresh && ["never", "unavailable", "partial"].includes(pullRequestsRefresh.availability);
  return `<section aria-labelledby="reservation-publication-title">
    ${sectionHeader({ title: "Publication", id: "reservation-publication-title" })}
    ${group([
      settingsRow({ title: "Status", value: publicationStatusLabel(session.publicationStatus) }),
      pullRequestUrl
        ? settingsRow({ title: "Pull request", valueHtml: `<a class="ax-setrow-val sp-link" href="${escapeHtml(pullRequestUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pullRequestLabel)}</a>` })
        : settingsRow({ title: "Pull request", value: pullRequestLabel }),
      settingsRow({ title: "Last checked", value: formatTime(session.publicationObservedAt) }),
    ])}
    ${session.publicationReason ? `<p class="ax-group-foot">${escapeHtml(session.publicationReason)}</p>` : ""}
    ${pending || unavailable ? banner({
      title: "Waiting for GitHub",
      body: `${pending ? "Atlas is still reading Pull requests." : pullRequestsRefresh?.failureReason ?? "Atlas couldn’t read Pull requests just now."} The reservation stays held until Atlas can see current publication evidence.`,
    }) : ""}
    ${conflictCount > 0 ? banner({ title: "Reservation conflict hold", body: `${conflictCount} hold${conflictCount === 1 ? "" : "s"} stay until every Session involved releases. Running work isn’t cancelled.` }) : ""}
  </section>`;
};

export const renderReservationReleasePage = ({
  csrfToken,
  repository,
  session,
  pullRequestsRefresh,
  error,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  pullRequestsRefresh?: RefreshState;
  error?: string;
  inbox?: InboxContext;
}) => {
  const sessionHref = `/sessions/${encodeURIComponent(session.atlasId)}`;
  return renderShell({
    title: `Release reservation · ${session.atlasId}`,
    csrfToken,
    inbox,
    tab: "sessions",
    bodyClass: "sp-flow",
    header: {
      title: "Release stack reservation",
      back: { href: sessionHref, label: "Session" },
    },
    content: `<p class="sp-meta">Spec #${escapeHtml(session.specIssueNumber)} · ${escapeHtml(session.specTitle)} · ${escapeHtml(repository.fullName)}</p>
      <p class="sp-lede">A stack reservation keeps the next layer of a PR stack for this Session. It can outlast the Session itself, so the stack stays blocked until it is released.</p>
      ${group([
        settingsRow({ title: "Session", valueHtml: `<span class="ax-setrow-val">${sessionPill(session.state, session.opencodeFreshness === "stale")}</span>` }),
        settingsRow({ title: "Started from", value: sessionTargetLabel(session) }),
        settingsRow({ title: "Reservation", value: reservationLabel(session) }),
      ], { label: "This Session" })}
      ${renderReservationReleaseForm({
        action: `${sessionHref}/reservation/release`,
        csrfToken,
        session,
        error,
      })}
      ${publicationSection(session, pullRequestsRefresh)}`,
  });
};

export const renderReservationReleaseForm = ({
  action,
  csrfToken,
  session,
  error,
}: {
  action: string;
  csrfToken: string;
  session: Session;
  error?: string;
}) => {
  const terminal = ["succeeded", "failed", "interrupted"].includes(session.state);
  const held = session.reservationState === "held";
  const errorMarkup = error
    ? errorBox({ id: "reservation-release-error", title: "Reservation not released", bodyHtml: `<p>${escapeHtml(error)}</p>` })
    : "";
  const statusMarkup = !held
    ? banner({ tone: "info", title: "Already released", body: "This reservation is released or no longer exists. Releasing it again changes nothing." })
    : !terminal
      ? banner({ id: "reservation-release-warning", role: "alert", title: "Can’t release yet", body: "Only a finished Session can release its reservation. While the Agent is working, or Atlas can’t tell, it stays held." })
      : banner({ id: "reservation-release-warning", role: "alert", title: "This may release unpublished work", body: "The next layer of the stack becomes free for another Session. Atlas won’t delete anything, stop work, change branches or Pull requests, or skip the next target’s checks." });

  return `<div id="reservation-release-action" class="sp-release">
    ${errorMarkup}${statusMarkup}
    ${held && terminal ? `<form class="sp-actions" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="#reservation-release-action" hx-swap="outerHTML" hx-indicator="#reservation-release-progress" hx-disabled-elt="button[type='submit']"${error ? ' aria-describedby="reservation-release-error reservation-release-warning"' : ' aria-describedby="reservation-release-warning"'}>
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <p id="release-form-status" data-form-status class="sr-only" role="status" aria-live="polite"></p>
      ${button({ label: "Release reservation", variant: "danger", type: "submit", attrs: 'aria-describedby="release-form-status"' })}
      <span id="reservation-release-progress" class="htmx-indicator sp-progress" role="status" aria-live="polite">Releasing reservation…</span>
    </form>` : ""}
  </div>`;
};
