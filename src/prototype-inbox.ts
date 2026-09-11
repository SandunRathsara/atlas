// PROTOTYPE: Three variants of the planned Spec inbox, switchable via ?variant=, on /prototype/inbox.
import { escapeHtml, renderDocument, skipLink } from "./views/html.ts";
import { icon } from "./views/icons.ts";

export type InboxPrototypeVariant = "A" | "B" | "C";
export type InboxPrototypeRepository = "all" | "atlas" | "opencode" | "bearings";

type Group = "needs" | "progress" | "not-started" | "settled";
type State = "Waiting" | "Running" | "Queued" | "Preparing" | "Idle" | "No Session" | "Succeeded" | "Failed" | "Interrupted";

type InboxItem = {
  group: Group;
  number: number;
  repository: Exclude<InboxPrototypeRepository, "all">;
  title: string;
  state: State;
  updated: string;
  stale?: boolean;
  unread?: boolean;
  accessUnavailable?: boolean;
};

const repositories = {
  atlas: { short: "atlas", full: "digis/atlas" },
  opencode: { short: "opencode", full: "sst/opencode" },
  bearings: { short: "bearings", full: "digis/bearings" },
} as const;

const items: InboxItem[] = [
  { group: "needs", number: 104, repository: "atlas", title: "Choose the sidebar row style", state: "Waiting", updated: "4 min" },
  { group: "progress", number: 103, repository: "atlas", title: "Build the Spec inbox", state: "Running", updated: "8 min", stale: true },
  { group: "progress", number: 418, repository: "opencode", title: "Reconnect the Session viewer", state: "Running", updated: "21 min" },
  { group: "progress", number: 61, repository: "bearings", title: "Harden clone recovery", state: "Queued", updated: "35 min", accessUnavailable: true },
  { group: "progress", number: 98, repository: "atlas", title: "Refresh terminal history", state: "Preparing", updated: "1 hr" },
  { group: "progress", number: 404, repository: "opencode", title: "Clarify inactive Session state", state: "Idle", updated: "2 hr" },
  { group: "not-started", number: 108, repository: "atlas", title: "Add deployment health summary", state: "No Session", updated: "3 hr" },
  { group: "settled", number: 58, repository: "bearings", title: "Verify the release snapshot", state: "Succeeded", updated: "12 min", unread: true },
  { group: "settled", number: 95, repository: "atlas", title: "Repair stack reservation", state: "Failed", updated: "44 min", unread: true },
  { group: "settled", number: 399, repository: "opencode", title: "Document service discovery", state: "Interrupted", updated: "1 day" },
];

const groupLabels: Record<Group, string> = {
  needs: "Needs you",
  progress: "In progress",
  "not-started": "Not started",
  settled: "Settled",
};

const badge = (state: State) => {
  const className = state === "Waiting"
    ? "badge-warning"
    : state === "Running"
      ? "badge-info"
      : state === "Succeeded"
        ? "badge-success"
        : state === "Failed" || state === "Interrupted"
          ? "badge-error"
          : state === "No Session"
            ? "badge-outline text-muted"
            : "badge-neutral";
  return `<span class="badge badge-sm ${className}">${state}</span>`;
};

const queryHref = ({
  variant,
  repository,
  spec,
}: {
  variant: InboxPrototypeVariant;
  repository: InboxPrototypeRepository;
  spec?: number;
}) => {
  const query = new URLSearchParams({ variant });
  if (repository !== "all") query.set("repository", repository);
  if (spec) query.set("spec", String(spec));
  return `/prototype/inbox?${query.toString().replaceAll("&", "&amp;")}`;
};

const unreadDot = (item: InboxItem) => item.unread
  ? `<span class="size-2 shrink-0 rounded-full bg-brand-readable" title="Finished since your last visit"><span class="sr-only">New since your last visit</span></span>`
  : "";

const itemBadges = (item: InboxItem) => `<span class="flex flex-wrap items-center gap-1.5">
  ${badge(item.state)}
  ${item.stale ? '<span class="badge badge-sm badge-warning">Stale</span>' : ""}
  ${item.accessUnavailable ? '<span class="badge badge-sm badge-error">Access unavailable</span>' : ""}
</span>`;

const itemMeta = (item: InboxItem, showRepository: boolean) => `<span class="flex min-w-0 items-center gap-1.5 text-xs text-faint">
  <span class="font-mono">Spec #${item.number}</span>
  ${showRepository ? `<span aria-hidden="true">·</span><span class="truncate">${repositories[item.repository].short}</span>` : ""}
</span>`;

const selectedClasses = (item: InboxItem, selected: boolean) => selected
  ? "border-l-2 border-l-brand-readable bg-brand-tint"
  : item.state === "Waiting"
    ? "border-l-2 border-l-warning"
    : "border-l-2 border-l-transparent";

const renderCardRow = (item: InboxItem, options: RowOptions) => `<a class="block rounded-box border border-edge p-3 transition-colors hover:bg-neutral ${selectedClasses(item, options.selected)}" href="${queryHref({ ...options, spec: item.number })}"${options.selected ? ' aria-current="page"' : ""}>
  <span class="flex items-start gap-2">
    ${unreadDot(item)}
    <span class="min-w-0 flex-1">
      <span class="block leading-normal text-base-content">${escapeHtml(item.title)}</span>
      <span class="mt-1.5 block">${itemMeta(item, options.showRepository)}</span>
      <span class="mt-2 block">${itemBadges(item)}</span>
    </span>
  </span>
</a>`;

const renderDenseRow = (item: InboxItem, options: RowOptions) => `<a class="block border-b border-edge px-3 py-2 transition-colors last:border-b-0 hover:bg-neutral ${selectedClasses(item, options.selected)}" href="${queryHref({ ...options, spec: item.number })}"${options.selected ? ' aria-current="page"' : ""}>
  <span class="flex items-start gap-2">
    ${unreadDot(item)}
    <span class="min-w-0 flex-1">
      <span class="block truncate leading-normal text-base-content" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
      <span class="mt-1 flex flex-wrap items-center justify-between gap-1.5">
        ${itemMeta(item, options.showRepository)}
        ${itemBadges(item)}
      </span>
    </span>
  </span>
</a>`;

const renderCompactRow = (item: InboxItem, options: RowOptions) => `<a class="block px-2 py-2 transition-colors hover:bg-neutral ${selectedClasses(item, options.selected)}" href="${queryHref({ ...options, spec: item.number })}"${options.selected ? ' aria-current="page"' : ""}>
  <span class="flex items-start gap-2">
    ${unreadDot(item)}
    <span class="min-w-0 flex-1">
      <span class="block truncate leading-normal text-base-content" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
      <span class="mt-1 block font-mono text-xs text-faint">Spec #${item.number}${options.showRepository ? ` · ${repositories[item.repository].short}` : ""}</span>
      <span class="mt-1.5 block">${itemBadges(item)}</span>
    </span>
  </span>
</a>`;

type RowOptions = {
  variant: InboxPrototypeVariant;
  repository: InboxPrototypeRepository;
  selected: boolean;
  showRepository: boolean;
};

const renderRow = (item: InboxItem, options: RowOptions) => options.variant === "A"
  ? renderCardRow(item, options)
  : options.variant === "B"
    ? renderDenseRow(item, options)
    : renderCompactRow(item, options);

const renderSidebarGroups = ({
  variant,
  repository,
  selectedNumber,
}: {
  variant: InboxPrototypeVariant;
  repository: InboxPrototypeRepository;
  selectedNumber: number;
}) => {
  const visibleItems = items.filter((item) => repository === "all" || item.repository === repository);
  const renderItems = (group: Group) => visibleItems
    .filter((item) => item.group === group)
    .map((item) => renderRow(item, {
      variant,
      repository,
      selected: item.number === selectedNumber,
      showRepository: repository === "all",
    }))
    .join(variant === "A" ? '<span class="block h-2"></span>' : "");
  const newCount = visibleItems.filter((item) => item.group === "settled" && item.unread).length;
  const sectionClass = variant === "A" ? "mt-5" : "mt-4";
  const rowContainerClass = variant === "A" ? "mt-2" : "mt-1 overflow-hidden rounded-field";

  if (visibleItems.length === 0) {
    return `<div class="px-3 py-6 text-sm text-muted">
      <p>No matches</p>
      <a class="mt-2 inline-block text-brand-readable" href="${queryHref({ variant, repository: "all" })}">Show all Repositories</a>
    </div>`;
  }

  const activeGroups = (["needs", "progress", "not-started"] as const).map((group) => {
    const rows = renderItems(group);
    if (!rows) return "";
    return `<section class="${sectionClass}" aria-label="${groupLabels[group]}">
      <h2 class="px-3 text-xs font-medium uppercase tracking-wide text-faint">${groupLabels[group]}</h2>
      <div class="${rowContainerClass}">${rows}</div>
    </section>`;
  }).join("");

  const settledRows = renderItems("settled");
  return `${activeGroups}
    ${settledRows ? `<details class="${sectionClass}">
      <summary class="cursor-pointer rounded-field px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint hover:bg-neutral">Settled${newCount ? ` · ${newCount} new` : ""}</summary>
      <div class="${rowContainerClass}">${settledRows}</div>
      <a class="mt-2 block px-3 text-sm text-brand-readable" href="#sessions">View all Sessions</a>
    </details>` : ""}`;
};

const renderFilter = (variant: InboxPrototypeVariant, repository: InboxPrototypeRepository, mobile = false) => `<form class="flex items-center gap-2" action="/prototype/inbox" method="get">
  <input type="hidden" name="variant" value="${variant}">
  <label class="sr-only" for="repository-filter-${mobile ? "mobile" : "sidebar"}">Repository</label>
  <select id="repository-filter-${mobile ? "mobile" : "sidebar"}" class="select min-w-0 flex-1" name="repository" data-prototype-repository-filter>
    <option value="all"${repository === "all" ? " selected" : ""}>All Repositories</option>
    <option value="atlas"${repository === "atlas" ? " selected" : ""}>atlas</option>
    <option value="opencode"${repository === "opencode" ? " selected" : ""}>opencode</option>
    <option value="bearings"${repository === "bearings" ? " selected" : ""}>bearings</option>
    <option value="manage">Manage Repositories…</option>
  </select>
  <a class="btn btn-ghost btn-square" href="/repositories/new" aria-label="Add a Repository">${icon("plus", 16)}</a>
  <noscript><button class="btn" type="submit">Apply</button></noscript>
</form>`;

const utilityLinks = `<nav class="mt-5 border-t border-edge pt-4" aria-label="Repository utilities">
  <p class="px-3 text-xs font-medium uppercase tracking-wide text-faint">Repository</p>
  <a class="mt-1 flex h-8 items-center gap-2 rounded-field px-3 text-sm text-muted hover:bg-neutral" href="#pull-requests">${icon("code-bracket", 20)}Pull requests</a>
  <a class="mt-1 flex h-8 items-center gap-2 rounded-field px-3 text-sm text-muted hover:bg-neutral" href="#sessions">${icon("command-line", 20)}All Sessions</a>
  <a class="mt-1 flex h-8 items-center gap-2 rounded-field px-3 text-sm text-muted hover:bg-neutral" href="https://github.com/" target="_blank" rel="noreferrer">${icon("arrow-top-right-on-square", 20)}Open on GitHub</a>
</nav>`;

const renderSidebar = (variant: InboxPrototypeVariant, repository: InboxPrototypeRepository, selectedNumber: number) => `<aside class="hidden h-screen shrink-0 flex-col bg-base-300 lg:flex ${variant === "C" ? "w-56" : "w-72"}" aria-label="Spec inbox">
  <div class="flex h-12 shrink-0 items-center bg-brand px-4 text-sm font-semibold text-brand-content">Atlas</div>
  <div class="border-b border-edge p-2">${renderFilter(variant, repository)}</div>
  <div class="min-h-0 flex-1 overflow-y-auto p-2">
    <div class="px-3 pt-3">
      <p class="font-medium text-base-content">Spec inbox</p>
      <p class="mt-1 text-xs leading-normal text-faint">Each row is a Spec. Its badge shows the latest Session.</p>
    </div>
    ${renderSidebarGroups({ variant, repository, selectedNumber })}
    ${repository === "all" ? "" : utilityLinks}
  </div>
</aside>`;

const planNotes = `<section class="mt-8 border-t border-edge pt-6" aria-labelledby="plan-behavior">
  <p class="text-xs font-medium uppercase tracking-wide text-brand-readable">Plan behavior</p>
  <h2 id="plan-behavior" class="mt-2 text-base font-semibold">What happens when someone opens Atlas</h2>
  <ol class="mt-4 grid gap-3 sm:grid-cols-2">
    <li class="rounded-box border border-edge bg-base-100 p-4"><span class="font-mono text-brand-readable">1</span><p class="mt-1">Open the earliest Session finished since this browser’s last visit.</p></li>
    <li class="rounded-box border border-edge bg-base-100 p-4"><span class="font-mono text-brand-readable">2</span><p class="mt-1">Otherwise open unfinished work: Waiting first, then oldest submitted.</p></li>
    <li class="rounded-box border border-edge bg-base-100 p-4"><span class="font-mono text-brand-readable">3</span><p class="mt-1">Otherwise return to this browser’s last enrolled Repository.</p></li>
    <li class="rounded-box border border-edge bg-base-100 p-4"><span class="font-mono text-brand-readable">4</span><p class="mt-1">With no enrolled Repository, open Add a Repository.</p></li>
  </ol>
  <p class="mt-4 text-sm text-muted">The Repository filter follows Spec, Session, PR, and Sessions pages. The inbox refreshes every 30 seconds without moving focus or adding browser history.</p>
</section>`;

const activeStates = new Set<State>(["Waiting", "Running", "Queued", "Preparing", "Idle"]);

const selectedActions = (item: InboxItem) => activeStates.has(item.state)
  ? `<a class="btn btn-primary" href="#session">Open Session</a>`
  : `<a class="btn btn-primary" href="#start-session">Start Session</a>${item.state === "No Session" ? "" : '<a class="btn" href="#latest-session">Open latest Session</a>'}`;

const selectedGuidance = (item: InboxItem) => activeStates.has(item.state)
  ? "Development has already started. Open the unfinished Session to continue following it."
  : item.state === "No Session"
    ? "No development has started for this Spec. Start Session opens the existing start form."
    : "The latest Session is settled, so this Spec can start another Session.";

const renderSelectedStrip = (item: InboxItem) => `<section class="mt-5 rounded-box border border-edge bg-base-100 p-4" aria-label="Selected Spec">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-faint">Selected Spec · #${item.number}</p>
      <p class="mt-1 font-medium text-base-content">${escapeHtml(item.title)}</p>
      <p class="mt-2 text-sm text-muted">${selectedGuidance(item)}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">${itemBadges(item)}${selectedActions(item)}</div>
  </div>
</section>`;

const renderSelectedSpec = (item: InboxItem) => `<div class="hidden lg:block">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-brand-readable">Spec #${item.number}</p>
      <h1 id="page-title" class="mt-2 text-xl font-semibold">${escapeHtml(item.title)}</h1>
      <p class="mt-2 text-sm text-muted">${repositories[item.repository].full} · Updated ${item.updated} ago</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      ${itemBadges(item)}
      ${selectedActions(item)}
    </div>
  </div>
  <section class="mt-6 rounded-box border border-edge bg-base-100 p-4" aria-labelledby="prototype-summary">
    <h2 id="prototype-summary" class="text-base font-semibold">Replace Repository browsing with work triage</h2>
    <p class="mt-2 max-w-prose text-base leading-normal text-muted">The selected Spec or Session still opens in the main pane. The change is the surrounding shell: work stays visible, Repository becomes a filter, and state determines where each Spec appears.</p>
    <p class="mt-4 max-w-prose text-sm leading-normal text-base-content"><span class="font-semibold">To start development:</span> select a Spec marked No Session, then choose Start Session. Specs with unfinished work open their existing Session instead.</p>
    <dl class="mt-5 grid gap-4 border-t border-edge pt-4 sm:grid-cols-3">
      <div><dt class="text-xs text-faint">Inbox row</dt><dd class="mt-1">One Spec</dd></div>
      <div><dt class="text-xs text-faint">State</dt><dd class="mt-1">Latest Session</dd></div>
      <div><dt class="text-xs text-faint">Freshness</dt><dd class="mt-1">Stale stays separate</dd></div>
    </dl>
  </section>
  ${planNotes}
</div>`;

const renderMainTable = (visibleItems: InboxItem[], repository: InboxPrototypeRepository, variant: InboxPrototypeVariant, selectedNumber: number) => {
  const columns = repository === "all" ? 4 : 3;
  const tableRows = (groups: readonly Group[]) => groups.map((group) => {
    const rows = visibleItems.filter((item) => item.group === group);
    if (!rows.length) return "";
    return `<tr><th class="bg-base-300 text-xs font-medium uppercase tracking-wide text-faint" colspan="${columns}">${groupLabels[group]}</th></tr>
      ${rows.map((item) => `<tr class="${item.number === selectedNumber ? "bg-brand-tint" : ""}">
        <td class="${item.number === selectedNumber ? "border-l-2 border-l-brand-readable" : item.state === "Waiting" ? "border-l-2 border-l-warning" : "border-l-2 border-l-transparent"}">
          <a class="flex items-start gap-2 text-brand-readable" href="${queryHref({ variant, repository, spec: item.number })}"${item.number === selectedNumber ? ' aria-current="page"' : ""}>${unreadDot(item)}<span><span class="block text-base-content">${escapeHtml(item.title)}</span><span class="mt-1 block font-mono text-xs text-faint">Spec #${item.number}</span></span></a>
        </td>
        ${repository === "all" ? `<td>${repositories[item.repository].short}</td>` : ""}
        <td>${itemBadges(item)}</td>
        <td class="text-muted">${item.updated} ago</td>
      </tr>`).join("")}`;
  }).join("");
  const settled = visibleItems.filter((item) => item.group === "settled");
  const newCount = settled.filter((item) => item.unread).length;
  const table = (rows: string, label: string) => `<div class="atlas-table rounded-box border border-edge bg-base-100" role="region" aria-label="${label}" tabindex="0">
    <table class="table table-compact">
      <thead><tr><th>Spec</th>${repository === "all" ? "<th>Repository</th>" : ""}<th>State</th><th>Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  return `<div class="hidden lg:block">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-brand-readable">Work queue</p>
        <h1 id="page-title" class="mt-2 text-xl font-semibold">Spec inbox</h1>
        <p class="mt-2 text-base text-muted">A narrow sidebar keeps context; the main pane carries the full inbox table. Choose a row to open its Spec.</p>
      </div>
    </div>
    ${renderSelectedStrip(visibleItems.find((item) => item.number === selectedNumber) ?? visibleItems[0] ?? items[0]!)}
    <div class="mt-6">${table(tableRows(["needs", "progress", "not-started"]), "Active Spec inbox")}</div>
    ${settled.length ? `<details class="mt-5">
      <summary class="cursor-pointer rounded-field px-3 py-2 text-sm font-medium text-muted hover:bg-neutral">Settled${newCount ? ` · ${newCount} new` : ""}</summary>
      <div class="mt-2">${table(tableRows(["settled"]), "Settled Specs")}</div>
      <a class="mt-3 inline-block text-sm text-brand-readable" href="#sessions">View all Sessions</a>
    </details>` : ""}
    ${planNotes}
  </div>`;
};

const renderMobileInbox = (variant: InboxPrototypeVariant, repository: InboxPrototypeRepository, selectedNumber: number) => `<div class="lg:hidden">
  <p class="text-xs font-medium uppercase tracking-wide text-brand-readable">Work queue</p>
  <h1 id="page-title-mobile" class="mt-2 text-xl font-semibold">Spec inbox</h1>
  <p class="mt-2 text-base text-muted">On phones, the sidebar becomes this full-page inbox. Every record is a Spec; its badge shows the latest Session.</p>
  <div class="mt-5">${renderFilter(variant, repository, true)}</div>
  ${renderSelectedStrip(items.find((item) => item.number === selectedNumber) ?? items[0]!)}
  <div class="mt-6 rounded-box border border-edge bg-base-300 p-2">
    ${renderSidebarGroups({ variant: variant === "A" ? "A" : "B", repository, selectedNumber })}
    ${repository === "all" ? "" : utilityLinks}
  </div>
</div>`;

const variantNames: Record<InboxPrototypeVariant, string> = {
  A: "Cards",
  B: "Dense rows",
  C: "Main-pane table",
};

const renderSwitcher = (variant: InboxPrototypeVariant, repository: InboxPrototypeRepository, selectedNumber: number) => {
  const variants: InboxPrototypeVariant[] = ["A", "B", "C"];
  const index = variants.indexOf(variant);
  const previous = variants[(index + variants.length - 1) % variants.length]!;
  const next = variants[(index + 1) % variants.length]!;
  return `<nav class="atlas-float fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-control-border bg-base-100 p-1" aria-label="Prototype variants" data-prototype-switcher>
    <a class="btn btn-ghost btn-circle" href="${queryHref({ variant: previous, repository, spec: selectedNumber })}" aria-label="Previous variant" data-prototype-previous>←</a>
    <span class="min-w-36 px-3 text-center text-sm"><span class="font-mono text-brand-readable">${variant}</span> · ${variantNames[variant]}</span>
    <a class="btn btn-ghost btn-circle" href="${queryHref({ variant: next, repository, spec: selectedNumber })}" aria-label="Next variant" data-prototype-next>→</a>
  </nav>`;
};

export const renderInboxPrototype = ({
  variant,
  repository,
  selectedSpec,
}: {
  variant: InboxPrototypeVariant;
  repository: InboxPrototypeRepository;
  selectedSpec?: string;
}) => {
  const visibleItems = items.filter((item) => repository === "all" || item.repository === repository);
  const requestedNumber = selectedSpec && /^\d+$/.test(selectedSpec) ? Number(selectedSpec) : undefined;
  const selectedItem = visibleItems.find((item) => item.number === requestedNumber)
    ?? visibleItems.find((item) => item.number === 103)
    ?? visibleItems[0]
    ?? items[0]!;
  const repositoryName = repository === "all" ? "All Repositories" : repositories[repository].full;

  return renderDocument(
    `Inbox prototype ${variant}`,
    `${skipLink}
    <div class="min-h-screen lg:flex">
      ${renderSidebar(variant, repository, selectedItem.number)}
      <div class="min-w-0 flex-1">
        <header class="atlas-glass sticky top-0 z-20">
          <div class="flex h-12 items-center justify-between gap-3 px-4 sm:px-6">
            <p class="min-w-0 truncate text-sm text-muted" title="${escapeHtml(repositoryName)}">${escapeHtml(repositoryName)}</p>
            <div class="flex shrink-0 items-center gap-2">
              <a class="btn btn-ghost lg:hidden" href="${queryHref({ variant, repository })}" aria-current="page">${icon("rectangle-stack", 16)} Inbox</a>
              <span class="badge badge-sm badge-neutral">Plan preview</span>
            </div>
          </div>
        </header>
        <main id="main-content" class="mx-auto max-w-6xl px-4 py-5 pb-24 sm:px-6">
          ${renderMobileInbox(variant, repository, selectedItem.number)}
          ${variant === "C"
            ? renderMainTable(visibleItems, repository, variant, selectedItem.number)
            : renderSelectedSpec(selectedItem)}
        </main>
      </div>
    </div>
    ${renderSwitcher(variant, repository, selectedItem.number)}`,
  );
};
