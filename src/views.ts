const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

const htmxConfig =
  '{"reportValidityOfForms":true,"includeIndicatorStyles":false,"historyRestoreAsHxRequest":false,"responseHandling":[{"code":"204","swap":false},{"code":"422","swap":true,"error":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":false,"error":true},{"code":"...","swap":true}]}';

const document = (title: string, content: string) => `<!doctype html>
<html lang="en" data-theme="dim">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="htmx-config" content='${htmxConfig}'>
    <title>${escapeHtml(title)} | Atlas</title>
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/htmx.min.js" defer></script>
    <script src="/assets/app.js" defer></script>
  </head>
  <body class="atlas-backdrop min-h-screen overflow-x-hidden bg-base-200 font-sans text-base-content">
    ${content}
  </body>
</html>`;

const skipLink = `<a class="atlas-skip-link" href="#main-content">Skip to main content</a>`;

export const renderLoginForm = ({
  csrfToken,
  error,
  returnTo,
}: {
  csrfToken: string;
  error?: string;
  returnTo: string;
}) => {
  const errorMarkup = error
    ? `<p id="login-error" class="alert alert-error mt-6 leading-normal" tabindex="-1" data-focus-on-swap>${escapeHtml(error)}</p>`
    : "";
  const errorAttribute = error ? ' aria-describedby="login-error" aria-invalid="true"' : "";

  return `<form id="login-form" class="mt-8 max-w-md" action="/login" method="post" autocomplete="on" hx-post="/login" hx-target="#login-form" hx-swap="outerHTML" hx-indicator="#login-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    <div>
      <label class="label mb-2 block p-0" for="shared-token">Shared access credential</label>
      <input id="shared-token" class="input input-bordered min-h-11 w-full border-control-border bg-base-100 text-base-content" name="token" type="password" autocomplete="current-password" required${errorAttribute}>
      <p class="mt-2 text-sm leading-normal text-muted">Use the credential provided by your Atlas operator.</p>
    </div>
    ${errorMarkup}
    <div class="mt-8 flex flex-wrap items-center gap-4">
      <button class="btn btn-primary min-h-11 border border-control-border" type="submit">Sign in</button>
      <span id="login-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing in...</span>
    </div>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

export const renderLoginPage = (options: {
  csrfToken: string;
  error?: string;
  returnTo: string;
}) =>
  document(
    "Sign in",
    `${skipLink}
    <header class="atlas-glass border-b border-base-content/16">
      <div class="mx-auto flex min-h-20 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <div>
          <p class="text-lg font-semibold tracking-tight">Atlas</p>
          <p class="text-sm text-muted">Private sign-in</p>
        </div>
      </div>
    </header>
    <main id="main-content" class="mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <section class="atlas-glass w-full rounded-box p-6 sm:p-10 lg:max-w-2xl">
        <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Private access</p>
        <h1 class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Sign in to Atlas</h1>
        <p class="mt-4 max-w-prose leading-relaxed text-muted">Use the shared team credential to open the private Atlas Repository view.</p>
        ${renderLoginForm(options)}
      </section>
    </main>`,
  );

const renderLogoutForm = (csrfToken: string) => `<form id="logout-form" class="flex flex-wrap items-center gap-3" action="/logout" method="post" hx-post="/logout" hx-target="#logout-form" hx-swap="none" hx-indicator="#logout-progress" hx-disabled-elt="button[type='submit']">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
  <button class="btn btn-ghost min-h-11 border border-control-border/60" type="submit">Sign out</button>
  <span id="logout-progress" class="htmx-indicator text-sm text-muted" role="status" aria-live="polite">Signing out...</span>
</form>`;

export const renderRepositoriesPage = (csrfToken: string) =>
  document(
    "Repositories",
    `${skipLink}
    <header class="atlas-glass sticky top-0 z-20 border-b border-base-content/16">
      <div class="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <a class="rounded-field px-1 py-2 text-lg font-semibold tracking-tight text-base-content focus-visible:outline-brand-readable" href="/repositories">Atlas</a>
        <div class="flex flex-wrap items-center gap-3">
          <details class="relative lg:hidden">
            <summary class="btn btn-ghost min-h-11 list-none border border-control-border/60" aria-label="Open primary navigation">Navigation</summary>
            <nav class="absolute right-0 top-14 z-30 w-64 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl" aria-label="Primary navigation">
              <a class="block rounded-field border-l-2 border-brand-readable bg-primary/20 px-4 py-3 font-medium text-base-content" href="/repositories" aria-current="page">Repositories</a>
            </nav>
          </details>
          ${renderLogoutForm(csrfToken)}
        </div>
      </div>
    </header>
    <div class="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-8">
      <aside class="atlas-glass hidden self-start rounded-box p-3 lg:block" aria-label="Primary navigation">
        <p class="px-4 py-3 text-sm font-medium uppercase tracking-[0.16em] text-muted">Atlas</p>
        <nav>
          <a class="block rounded-field border-l-2 border-brand-readable bg-primary/20 px-4 py-3 font-medium text-base-content" href="/repositories" aria-current="page">Repositories</a>
        </nav>
      </aside>
      <main id="main-content" class="min-w-0" aria-labelledby="page-title">
        <div id="global-status" class="sr-only" role="status" aria-atomic="true">Signed in to Atlas.</div>
        <section class="atlas-glass rounded-box p-6 sm:p-8">
          <p class="text-sm font-medium uppercase tracking-[0.18em] text-brand-readable">Private Atlas</p>
          <h1 id="page-title" class="mt-4 text-2xl font-semibold leading-tight" tabindex="-1" data-page-heading>Repositories</h1>
          <p class="mt-4 max-w-prose leading-relaxed text-muted">Repositories enrolled in Atlas will appear here.</p>
          <div class="mt-8 rounded-box bg-base-100 p-6">
            <p class="text-lg font-semibold">No Repositories enrolled</p>
            <p class="mt-2 max-w-prose leading-relaxed text-muted">There are no enrolled Repositories to browse yet.</p>
          </div>
        </section>
      </main>
    </div>`,
  );
