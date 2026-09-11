import { readRecoveryStatus, type RecoveryStatus } from "../recovery-status.ts";
import { escapeHtml, formatTime, renderDocument, skipLink } from "./html.ts";
import { icon } from "./icons.ts";
import { renderInboxFilter, renderInboxList, type InboxContext } from "./inbox.ts";
import { alertSoft } from "./shared.ts";

export type { InboxContext };

export type PendingStartSession = {
  action: string;
  submissionId: string;
  prompt: string;
  target?: string;
};

const brandBand = (href?: string) =>
  `<div class="flex h-12 items-center bg-brand px-4 text-sm font-semibold text-brand-content">${
    href
      ? `<a class="text-brand-content" href="${href}">Atlas</a>`
      : "Atlas"
  }</div>`;

export const renderLoginForm = ({
  csrfToken,
  error,
  returnTo,
  pending,
}: {
  csrfToken: string;
  error?: string;
  returnTo: string;
  pending?: PendingStartSession;
}) => {
  const errorMarkup = error
    ? `<p id="login-error" class="alert alert-error alert-soft mt-6 leading-normal" tabindex="-1" data-focus-on-swap>${escapeHtml(error)}</p>`
    : "";
  const errorAttribute = error ? ' aria-describedby="login-error" aria-invalid="true"' : "";
  const pendingMarkup = pending
    ? `<input type="hidden" name="pending_action" value="${escapeHtml(pending.action)}">
    <input type="hidden" name="pending_submission_id" value="${escapeHtml(pending.submissionId)}">
    <input type="hidden" name="pending_target" value="${escapeHtml(pending.target ?? "default")}">
    <textarea hidden name="pending_prompt">${escapeHtml(pending.prompt)}</textarea>
    <div class="alert alert-info alert-soft mt-6 leading-normal" role="status">Sign in to review and retry the preserved Start Session form. Atlas will not resubmit it automatically.</div>`
    : "";

  return `<form id="login-form" class="mt-6 max-w-2xl" action="/login" method="post" autocomplete="on" hx-post="/login" hx-target="#login-form" hx-swap="outerHTML" hx-indicator="#login-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    ${pendingMarkup}
    <div>
      <label class="label mb-2 block p-0" for="shared-token">Shared access credential</label>
      <input id="shared-token" class="input w-full" name="token" type="password" autocomplete="current-password" required${errorAttribute}>
      <p class="mt-2 text-sm leading-normal text-faint">Use the credential provided by your Atlas operator.</p>
    </div>
    ${errorMarkup}
    <div class="mt-6 flex flex-wrap items-center gap-3">
      <button class="btn btn-primary" type="submit">Sign in</button>
      <span id="login-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing in...</span>
    </div>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

export const renderLoginPage = (options: {
  csrfToken: string;
  error?: string;
  returnTo: string;
  pending?: PendingStartSession;
}) =>
  renderDocument(
    "Sign in",
    `${skipLink}
    <header class="bg-brand text-brand-content">
      <div class="mx-auto flex h-12 max-w-6xl items-center px-4 sm:px-6">
        <p class="text-sm font-semibold">Atlas</p>
      </div>
    </header>
    <main id="main-content" class="mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <section class="max-w-2xl">
        <p class="text-xs font-medium uppercase tracking-wide text-accent">Private access</p>
        <h1 class="mt-2 text-xl font-semibold leading-normal" tabindex="-1" data-page-heading>Sign in to Atlas</h1>
        <p class="mt-2 max-w-prose text-base leading-normal text-muted">Use the shared team credential to open the private Atlas Repository view.</p>
        ${renderLoginForm(options)}
      </section>
    </main>`,
  );

const renderLogoutForm = (csrfToken: string) => `<form id="logout-form" class="flex flex-wrap items-center gap-2" action="/logout" method="post" hx-post="/logout" hx-target="#logout-form" hx-swap="none" hx-indicator="#logout-progress" hx-disabled-elt="button[type='submit']">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
  <button class="btn btn-ghost" type="submit">${icon("arrow-right-start-on-rectangle", 16)} Sign out</button>
  <span id="logout-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing out...</span>
</form>`;

const renderRecoveryNotices = (status: RecoveryStatus) => {
  const backup = status.backup.state === "success"
    ? alertSoft("success", "status", `<div><strong>Local recovery snapshot succeeded.</strong> Last success: ${escapeHtml(formatTime(status.backup.lastSuccessAt ?? null))}. This is a same-disk recovery point, not an off-site backup.</div>`)
    : status.backup.state === "failure"
      ? alertSoft("warning", "alert", `<div><strong>The latest local backup failed.</strong> Last success: ${escapeHtml(formatTime(status.backup.lastSuccessAt ?? null))}. Backup failure warns but does not by itself pause Session preparation.</div>`)
      : alertSoft("warning", "status", `<div><strong>Backup status is unknown.</strong> No current, valid local recovery status is available.</div>`);
  const free = status.space.availableBytes === undefined
    ? ""
    : ` ${escapeHtml((status.space.availableBytes / (1024 ** 3)).toFixed(1))} GiB is available.`;
  const metadata = status.space.metadataPercent === undefined
    ? ""
    : ` Btrfs metadata is ${escapeHtml(String(status.space.metadataPercent))}% used.`;
  const space = status.space.state === "warning"
    ? alertSoft("warning", "alert", `<div><strong>Storage is under pressure.</strong>${free}${metadata} New preparation remains available, but running Agents and changed snapshot blocks can still exhaust storage.</div>`)
    : status.space.state === "paused"
      ? alertSoft("error", "alert", `<div><strong>New Session preparation is paused by storage pressure.</strong>${free}${metadata} Running Agents are not interrupted or deleted.</div>`)
      : status.space.state === "unknown"
        ? alertSoft("warning", "status", `<div><strong>Storage safety status is unknown.</strong> New preparation remains paused on deployments using the required status gate until a current check succeeds.</div>`)
        : "";
  return `<section class="mb-6 grid gap-3" aria-label="Recovery and storage status">${backup}${space}</section>`;
};

const emptyInbox = (): InboxContext => ({
  repositories: [],
  list: { rows: [], settledTotal: 0, settledNew: 0 },
  currentPath: "",
  specsRefresh: [],
});

export const renderShell = ({
  title,
  csrfToken,
  historyDisabled,
  content,
  inbox = emptyInbox(),
}: {
  title: string;
  csrfToken: string;
  historyDisabled?: boolean;
  content: string;
  inbox?: InboxContext;
}) => {
  const headerName = inbox.filtered?.fullName ?? "All Repositories";
  const recoveryNotices = renderRecoveryNotices(readRecoveryStatus());

  return renderDocument(
    title,
    `${skipLink}
    <div class="min-h-screen lg:flex">
      <aside class="hidden bg-base-300 lg:flex lg:w-72 lg:shrink-0 lg:flex-col" aria-label="Primary navigation">
        ${brandBand("/repositories")}
        ${renderInboxFilter(inbox)}
        ${renderInboxList(inbox)}
      </aside>
      <div class="min-w-0 flex-1">
        <header class="atlas-glass sticky top-0 z-20">
          <div class="relative flex h-12 items-center justify-between gap-3 px-4 sm:px-6">
            <p class="min-w-0 truncate text-sm text-muted" title="${escapeHtml(headerName)}">${escapeHtml(headerName)}</p>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <a class="btn btn-ghost lg:hidden" href="/inbox">${icon("rectangle-stack", 16)} Inbox</a>
              ${renderLogoutForm(csrfToken)}
            </div>
          </div>
        </header>
        <main id="main-content" class="mx-auto max-w-6xl px-4 py-5 sm:px-6" aria-labelledby="page-title"${historyDisabled ? ' hx-history="false"' : ""}>
          <div id="global-status" class="sr-only" role="status" aria-atomic="true">Signed in to Atlas.</div>
          ${recoveryNotices}
          ${content}
        </main>
      </div>
    </div>`,
  );
};
