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
import { renderShell, type PendingStartSession } from "./shell.ts";
import { renderStartTargetOptions } from "./targets.ts";

const sessionFilterLabel = (filter: SessionFilter) => {
  if (filter === "active") return "Active";
  if (filter === "all") return "All";
  return sessionStateLabel(filter);
};

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
    ? `<div id="prompt-error" class="alert alert-error alert-soft mt-6 leading-normal" role="alert" tabindex="-1" data-focus-on-swap>
        <div><strong>Session was not queued.</strong><p class="mt-1">${escapeHtml(error)}</p>${existingSession ? `<a class="mt-3 inline-block text-brand-readable underline underline-offset-4" href="${`/sessions/${encodeURIComponent(existingSession.atlasId)}`}">Open the existing Session</a>` : ""}</div>
      </div>`
    : "";
  const errorAttributes = error ? ' aria-describedby="prompt-error" aria-invalid="true"' : "";

  return `<form id="start-session-form" class="mt-8 max-w-2xl" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="#start-session-form" hx-swap="outerHTML" hx-indicator="#start-session-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="submission_id" value="${escapeHtml(submissionId)}">
    ${targetOptions ?? `<input type="hidden" name="target" value="${escapeHtml(target)}">`}
    <div>
      <label class="label mb-2 block p-0" for="initial-prompt">Initial prompt</label>
      <textarea id="initial-prompt" class="textarea min-h-48 w-full" name="prompt" rows="9" maxlength="20000" required${errorAttributes}>${escapeHtml(prompt)}</textarea>
      <p class="mt-2 text-sm leading-normal text-faint">Tell the Agent what to implement. Atlas preserves this text unchanged. Maximum 20,000 characters.</p>
    </div>
    ${errorMarkup}
    <div class="mt-8 flex flex-wrap items-center gap-3">
      <button class="btn btn-primary" type="submit">${icon("play", 16)} Start Session</button>
      <a class="btn btn-ghost" href="${escapeHtml(action.replace(/\/sessions$/, ""))}">Cancel</a>
      <span id="start-session-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Starting Session…</span>
    </div>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

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
  specsRefresh,
  pullRequests,
  stacks,
  pullRequestsRefresh,
  target,
  targetInvalid = false,
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
}) => {
  const formAction = action ?? `/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(spec.issueNumber)}/sessions`;
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const retained = !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);

  return renderShell({
    title: `Start Session · Spec #${spec.issueNumber}`,
    active: "spec",
    repository,
    csrfToken,
    content: `<a class="text-sm text-brand-readable underline underline-offset-4" href="${repositoryLink(repository)}">← Back to Specs</a>
      <div class="mt-6">
        ${pageHeader({
          title: "Start Session",
          description: `Queue one Atlas implementation attempt for <strong class="text-base-content">${escapeHtml(spec.title)}</strong>. Opening or cancelling this form creates nothing.`,
        })}
        <p class="mt-2 font-mono text-sm text-muted">Spec #${escapeHtml(spec.issueNumber)}</p>
      </div>
      ${accessNotice(repository)}
      ${retained ? alertSoft("warning", "alert", "This is a retained Spec snapshot and is not currently eligible for a new Session.") : ""}
       <dl class="mt-8 grid gap-4 border-y border-edge py-5 text-sm sm:grid-cols-2">
         <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
         <div><dt class="font-medium text-muted">Starting base</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.defaultBranch ?? "not available")}</dd></div>
         <div><dt class="font-medium text-muted">Spec</dt><dd class="mt-1">${githubUrl ? `<a class="text-brand-readable underline underline-offset-4" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">Open issue on GitHub</a>` : "Snapshot retained"}</dd></div>
         <div><dt class="font-medium text-muted">Queueing</dt><dd class="mt-1">The selected target is queued; preparation is deferred.</dd></div>
       </dl>
        ${notice ? `<div class="alert alert-info alert-soft mt-8 leading-normal" role="status" tabindex="-1" data-focus-on-swap>${escapeHtml(notice)}</div>` : ""}
        ${renderStartSessionForm({ action: formAction, csrfToken, submissionId, prompt, error, existingSession, targetOptions: renderStartTargetOptions(repository, pullRequests, stacks, accessRefresh, pullRequestsRefresh, target ?? "default", targetInvalid, "prompt-error"), target: target ?? "default" })}
      <details class="mt-8 max-w-prose rounded-box border border-edge bg-base-100 p-5">
        <summary class="cursor-pointer text-base font-semibold">View Spec context</summary>
        <div class="mt-5 whitespace-pre-wrap break-words leading-normal">${escapeHtml(spec.body) || "No description provided."}</div>
      </details>
      <p class="mt-6 text-sm leading-normal text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>`,
  });
};

export const renderTargetReconfirmationPage = ({
  csrfToken,
  repository,
  session,
  targetOptions,
  error,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  targetOptions: string;
  error?: string;
}) => {
  const action = `/sessions/${encodeURIComponent(session.atlasId)}/target`;
  const form = renderTargetReconfirmationForm({ action, csrfToken, targetOptions, error });
  return renderShell({
    title: `Reconfirm target · ${session.atlasId}`,
    active: "sessions",
    repository,
    csrfToken,
    content: `<a class="text-sm text-brand-readable underline underline-offset-4" href="/sessions/${encodeURIComponent(session.atlasId)}">← Back to Session</a>
      ${pageHeader({
        title: "Reconfirm queued target",
        description: "The previous target is no longer verified. Choose a current eligible target. Atlas keeps this Session, prompt, and original queue order; it does not release ownership or change GitHub.",
      })}
      <p class="mt-2 font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
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
}) => `<form id="target-reconfirmation-form" class="mt-8 max-w-3xl" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="this" hx-swap="outerHTML" hx-indicator="#target-reconfirmation-progress" hx-disabled-elt="button[type='submit']"${error ? ' aria-describedby="target-reconfirmation-error"' : ""}>
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  ${error ? `<div id="target-reconfirmation-error" class="alert alert-error alert-soft mb-6 leading-normal" role="alert" tabindex="-1" data-focus-on-swap>${escapeHtml(error)}</div>` : ""}
  ${targetOptions}
  <div class="mt-8 flex flex-wrap items-center gap-3">
    <button class="btn btn-primary" type="submit">Confirm target</button>
    <a class="btn btn-ghost" href="${escapeHtml(action.replace(/\/target$/, ""))}">Cancel</a>
    <span id="target-reconfirmation-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Checking target…</span>
  </div>
  <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
</form>`;

export const renderPendingStartSessionFragment = ({
  action,
  csrfToken,
  submissionId,
  prompt,
  target,
}: PendingStartSession & { csrfToken: string }) => `<div id="login-form">
  <div class="alert alert-info alert-soft mt-8 leading-normal" role="status" tabindex="-1" data-focus-on-swap>Signed in. Review the preserved form, then choose Start Session to retry it.</div>
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
  <header class="bg-brand text-brand-content">
    <div class="mx-auto flex h-12 max-w-6xl items-center px-4 sm:px-6">
      <p class="text-sm font-semibold">Atlas</p>
    </div>
  </header>
  <main id="main-content" class="mx-auto max-w-6xl px-4 py-5 sm:px-6">
    <section class="max-w-2xl">
      <p class="text-xs font-medium uppercase tracking-wide text-accent">Sign-in complete</p>
      <h1 class="mt-2 text-xl font-semibold leading-normal" tabindex="-1" data-page-heading>Review and retry Start Session</h1>
      <p class="mt-2 max-w-prose text-base leading-normal text-muted">Your original prompt and submission identity are preserved below. Choose Start Session when you are ready; Atlas will not resubmit automatically.</p>
       ${renderStartSessionForm({ action, csrfToken, submissionId, prompt, target })}
    </section>
  </main>`,
);

const sessionListRecord = (session: Session, pullRequestsRefresh?: RefreshState) => {
  const href = `/sessions/${encodeURIComponent(session.atlasId)}`;
  const identity = `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${href}">Spec #${escapeHtml(session.specIssueNumber)}: ${escapeHtml(session.specTitle)}</a>
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
  sessions,
  filter,
  pullRequestsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  sessions: Session[];
  filter: SessionFilter;
  pullRequestsRefresh?: RefreshState;
}) => {
  const filters: SessionFilter[] = ["active", "all", "queued", "preparing", "running", "waiting", "idle", "succeeded", "failed", "interrupted", "failed_setup"];
  const heading = filter === "active" ? "Active Sessions" : filter === "all" ? "Sessions" : `${sessionFilterLabel(filter)} Sessions`;
  const emptyText = filter === "active"
    ? "No unfinished Sessions are present in this Repository."
    : filter === "all"
      ? "No Atlas Sessions have been submitted for this Repository."
      : `No Sessions currently have the ${sessionFilterLabel(filter)} state.`;
  const records = sessions.map((session) => sessionListRecord(session, pullRequestsRefresh));

  return renderShell({
    title: `${repository.fullName} Sessions`,
    active: "sessions",
    repository,
    csrfToken,
    content: `${renderRepositoryHeading(repository, heading, "Atlas implementation attempts for this Repository. Active includes every unfinished Session, including Queued.", csrfToken)}
      <nav class="mt-6 flex flex-wrap gap-2" aria-label="Session status filters">
        ${filters.map((value) => `<a class="btn ${value === filter ? "btn-primary" : "btn-ghost"}" href="${value === "active" ? sessionsLink(repository) : `${sessionsLink(repository)}?status=${encodeURIComponent(value)}`}"${value === filter ? ' aria-current="page"' : ""}>${escapeHtml(sessionFilterLabel(value))}</a>`).join("")}
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

export const renderReservationReleasePage = ({
  csrfToken,
  repository,
  session,
  pullRequestsRefresh,
  error,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  pullRequestsRefresh?: RefreshState;
  error?: string;
}) => {
  return renderShell({
    title: `Release reservation · ${session.atlasId}`,
    active: "sessions",
    repository,
    csrfToken,
    content: `<a class="text-sm text-brand-readable underline underline-offset-4" href="/sessions/${encodeURIComponent(session.atlasId)}">← Back to Session</a>
      ${pageHeader({
        title: "Release stack reservation",
        description: `Session ${escapeHtml(session.atlasId)} · ${escapeHtml(sessionStateLabel(session.state))} · ${escapeHtml(sessionTargetLabel(session))}`,
      })}
      <p class="mt-2 font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
      ${renderReservationReleaseForm({
        action: `/sessions/${encodeURIComponent(session.atlasId)}/reservation/release`,
        csrfToken,
        session,
        error,
      })}
       ${publicationMarkup(session, pullRequestsRefresh)}`,
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
    ? `<div id="reservation-release-error" class="alert alert-error alert-soft mt-6 leading-normal" role="alert" tabindex="-1" data-focus-on-swap>${escapeHtml(error)}</div>`
    : "";
  const statusMarkup = !held
    ? alertSoft("info", "status", "This reservation is already released or no longer exists. Releasing it again is harmless.")
    : !terminal
      ? `<div id="reservation-release-warning" class="alert alert-warning alert-soft mt-6 leading-normal" role="alert">Only a confirmed terminal OpenCode outcome can release this reservation. Active or uncertain execution remains held.</div>`
      : `<div id="reservation-release-warning" class="alert alert-warning alert-soft mt-6 leading-normal" role="alert"><div><strong>This may release unpublished or unverified work.</strong> Atlas will not delete resources, cancel execution, change branches, change Pull requests, or bypass the next target's current eligibility checks.</div></div>`;

  return `<div id="reservation-release-action">
    ${errorMarkup}${statusMarkup}
    ${held && terminal ? `<form class="mt-8 flex flex-wrap items-center gap-3" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="#reservation-release-action" hx-swap="outerHTML" hx-indicator="#reservation-release-progress" hx-disabled-elt="button[type='submit']"${error ? ' aria-describedby="reservation-release-error reservation-release-warning"' : ' aria-describedby="reservation-release-warning"'}>
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <p id="release-form-status" data-form-status class="sr-only" role="status" aria-live="polite"></p>
      <button class="btn btn-error" type="submit" aria-describedby="release-form-status">Release reservation</button>
      <span id="reservation-release-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Releasing reservation…</span>
    </form>` : ""}
  </div>`;
};
