import type { PrStack, PullRequest, RefreshState, Repository, Session, Spec } from "../persistence.ts";
import { escapeHtml, formatTime, renderDocument, safeExternalUrl, skipLink } from "./html.ts";
import { icon } from "./icons.ts";
import {
  publicationStatusLabel,
  sessionTargetLabel,
} from "./shared.ts";
import { renderShell, type InboxContext, type PendingStartSession } from "./shell.ts";
import { renderStartTargetOptions } from "./targets.ts";
import { logo } from "./icons.ts";
import { banner, button, group, prose, sectionHeader, sessionPill, settingsRow } from "./kit.ts";
import { renderMarkdown } from "./markdown.ts";
import { specHref } from "./specs.ts";

const errorBox = ({ id, title, bodyHtml, attrs = "" }: { id: string; title: string; bodyHtml: string; attrs?: string }) =>
  `<div id="${id}" class="sp-errbox" role="alert" tabindex="-1" data-focus-on-swap${attrs}>${icon("warn", 18)}<div><b>${escapeHtml(title)}</b>${bodyHtml}</div></div>`;

export const renderStartSessionForm = ({
  action,
  csrfToken,
  submissionId,
  prompt,
  error,
  existingSession,
  promptInvalid = false,
  targetOptions,
  target = "default",
}: {
  action: string;
  csrfToken: string;
  submissionId: string;
  prompt: string;
  error?: string;
  existingSession?: Session;
  /** Only prompt errors mark the field invalid; other errors just show the red box. */
  promptInvalid?: boolean;
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
  const errorAttributes = error && promptInvalid ? ' aria-describedby="prompt-hint prompt-error" aria-invalid="true"' : ' aria-describedby="prompt-hint"';
  const cancelHref = action.replace(/\/sessions$/, "");

  return `<form id="start-session-form" class="sp-form" action="${escapeHtml(action)}" method="post" hx-post="${escapeHtml(action)}" hx-target="#start-session-form" hx-swap="outerHTML" hx-indicator="#start-session-progress" hx-disabled-elt="button[type='submit']"${error && !promptInvalid ? ' aria-describedby="prompt-error"' : ""}>
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
  promptInvalid,
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
  promptInvalid?: boolean;
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
      ${spec.body.trim() ? prose(renderMarkdown(spec.body)) : ""}
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
          ${renderStartSessionForm({ action: formAction, csrfToken, submissionId, prompt, error, existingSession, promptInvalid, targetOptions: renderStartTargetOptions(repository, pullRequests, stacks, accessRefresh, pullRequestsRefresh, target ?? "default", targetInvalid, "prompt-error"), target: target ?? "default" })}
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
