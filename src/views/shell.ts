import { readRecoveryStatus } from "../recovery-status.ts";
import { escapeHtml, renderDocument, skipLink } from "./html.ts";
import { icon, logo } from "./icons.ts";
import { renderInboxList, type InboxContext } from "./inbox.ts";
import {
  renderAccountMenu,
  renderLogoutForm,
  renderSideNav,
  renderTabBar,
  renderWarningStrip,
  repositoryFilter,
  tabForPath,
  themeControl,
  type FrameTab,
} from "./frame.ts";
import { banner, group, pageTitle, plainTile, row, type PageTitleOptions } from "./kit.ts";

export type { InboxContext, FrameTab };

export type PendingStartSession = {
  action: string;
  submissionId: string;
  prompt: string;
  target?: string;
};

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
    ? banner({ tone: "error", id: "login-error", attrs: 'tabindex="-1" data-focus-on-swap', body: error })
    : "";
  const errorAttribute = error ? ' aria-describedby="login-error" aria-invalid="true"' : "";
  const pendingMarkup = pending
    ? `<input type="hidden" name="pending_action" value="${escapeHtml(pending.action)}">
    <input type="hidden" name="pending_submission_id" value="${escapeHtml(pending.submissionId)}">
    <input type="hidden" name="pending_target" value="${escapeHtml(pending.target ?? "default")}">
    <textarea hidden name="pending_prompt">${escapeHtml(pending.prompt)}</textarea>
    ${banner({ tone: "info", title: "Your Start Session form is kept", body: "Sign in to review and retry it. Atlas won't send it on its own." })}`
    : "";

  return `<form id="login-form" class="ax-login-form" action="/login" method="post" autocomplete="on" hx-post="/login" hx-target="#login-form" hx-swap="outerHTML" hx-indicator="#login-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    ${pendingMarkup}
    ${errorMarkup}
    <div class="ax-field">
      <label class="ax-label" for="shared-token">Shared access credential</label>
      <input id="shared-token" class="ax-input" name="token" type="password" autocomplete="current-password" required${errorAttribute}>
      <p class="ax-hint">Use the credential provided by your Atlas operator.</p>
    </div>
    <button class="ax-btn ax-btn-block" type="submit">Sign in</button>
    <p id="login-progress" class="htmx-indicator ax-login-progress" role="status" aria-live="polite">Signing in...</p>
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
    <main id="main-content" class="ax-login" aria-labelledby="login-title">
      <div class="ax-login-card">
        ${logo(64, 18)}
        <h1 id="login-title" class="ax-login-title" tabindex="-1" data-page-heading>Sign in to Atlas</h1>
        <p class="ax-login-sub">Use the shared team credential.</p>
        ${renderLoginForm(options)}
      </div>
    </main>`,
  );

const emptyInbox = (): InboxContext => ({
  repositories: [],
  list: { rows: [], settledTotal: 0, settledNew: 0 },
  currentPath: "",
  specsRefresh: [],
});

/** Top bar below 1024px: the back link on detail pages, the brand on top-level tabs. The page ⋯ menu is pinned at its right. */
const phoneBar = (header?: ShellHeader) => {
  const lead = header?.back
    ? `<a class="ax-bar-back" href="${escapeHtml(header.back.href)}">${icon("back", 22)}${escapeHtml(header.back.label)}</a>`
    : `<a class="ax-bar-brand" href="/inbox">${logo(26, 7)}<span>Atlas</span></a>`;
  return `<div class="ax-bar-phone">${lead}</div>`;
};

/** Pages whose own content follows the Repository filter; picking a Repository there stays on the page. */
const FILTERED_PAGES = new Set(["/inbox", "/sessions", "/pull-requests"]);

/**
 * Page header for `renderShell`: `pageTitle` options plus `filter`, which puts the Repository filter
 * beside the large title below 1024px. Use it only on pages whose content the filter narrows
 * (Inbox, Sessions, cross-Repository Pull requests). On desktop the filter always sits in the top bar.
 */
export type ShellHeader = Omit<PageTitleOptions, "filterHtml"> & { filter?: boolean };

/**
 * The app frame: desktop sidebar (≥1024px), sticky top bar, main content, phone tab bar and
 * optional sticky Start bar. Every existing caller passes `{ title, csrfToken, content, inbox?,
 * historyDisabled? }`; `tab`, `header`, `startBar` and `bodyClass` are optional extras.
 * `header` renders the large `pageTitle` (h1#page-title) and drives the top bar (back link, ⋯ menu,
 * filter). Only full-screen flows with their own bar (Start Session) put an h1 in `content`.
 */
export const renderShell = ({
  title,
  csrfToken,
  historyDisabled,
  content,
  inbox = emptyInbox(),
  tab,
  header,
  startBar,
  bodyClass = "",
}: {
  title: string;
  csrfToken: string;
  historyDisabled?: boolean;
  content: string;
  inbox?: InboxContext;
  tab?: FrameTab;
  header?: ShellHeader;
  /** Trusted markup for the phone Start bar (usually one or two `ax-btn` buttons). */
  startBar?: string;
  bodyClass?: string;
}) => {
  const current = tab ?? tabForPath(inbox.currentPath);
  const classes = [bodyClass, startBar ? "ax-has-startbar" : ""].filter(Boolean).join(" ");
  const filterAction = FILTERED_PAGES.has(inbox.currentPath) ? inbox.currentPath : "/inbox";
  const heading = header
    ? pageTitle({ ...header, filterHtml: header.filter ? repositoryFilter(inbox, "head", filterAction) : undefined })
    : "";

  return renderDocument(
    title,
    `${skipLink}
    <div class="ax-app">
      <aside class="ax-side" aria-label="Primary navigation">
        <a class="ax-side-brand" href="/inbox">${logo(28, 7)}<span>Atlas</span></a>
        ${renderSideNav(current)}
        ${renderInboxList(inbox)}
        ${renderAccountMenu(csrfToken, current)}
      </aside>
      <div class="ax-main">
        <header class="ax-bar">
          ${phoneBar(header)}
          <div class="ax-bar-desk">${repositoryFilter(inbox, "bar", filterAction)}</div>
        </header>
        <main id="main-content" class="ax-content" aria-labelledby="page-title"${historyDisabled ? ' hx-history="false"' : ""}>
          <div id="global-status" class="sr-only" role="status" aria-atomic="true">Signed in to Atlas.</div>
          ${renderWarningStrip(readRecoveryStatus())}
          ${heading}
          ${content}
        </main>
      </div>
    </div>
    ${renderTabBar(current)}
    ${startBar ? `<div class="ax-startbar">${startBar}</div>` : ""}`,
    classes,
  );
};

/** Phone "More" tab body: Updates, Appearance and Sign out (the sidebar account menu on desktop). */
export const renderMorePage = (csrfToken: string) =>
  `${group([row({ title: "Updates", href: "/updates", tileHtml: plainTile("refresh"), sub: "Atlas releases and update status", chevron: true })])}
  <div class="ax-needs-js ax-more-theme">
    <h2 class="ax-group-label">Appearance</h2>
    ${themeControl("more")}
  </div>
  ${group([renderLogoutForm(csrfToken, "more-logout-form")])}`;
