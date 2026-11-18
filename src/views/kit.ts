// Atlas UI kit (Look A "Health"). Plain-text arguments are escaped; arguments ending in `Html`
// are trusted markup the caller already built (usually from other kit helpers).
// Reference: /tmp/atlas-ux/KIT.md (helper list, CSS classes, theme tokens, shell API).
import type { SessionState } from "../persistence.ts";
import { escapeHtml } from "./html.ts";
import { icon, type IconName } from "./icons.ts";

/** Status keys shared by tiles and pills. "Stale" is not a state: add `notLiveTag()` next to the state. */
export type StatusKey = "queued" | "running" | "waiting" | "idle" | "succeeded" | "failed" | "none";
export type PrState = "open" | "draft" | "merged" | "closed";
export type Tone = "warning" | "info" | "error" | "success";

export const STATUS_LABEL: Record<StatusKey, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  idle: "Idle",
  succeeded: "Succeeded",
  failed: "Failed",
  none: "No Session",
};

const STATUS_ICON: Record<StatusKey, IconName> = {
  queued: "queue",
  running: "sparkle",
  waiting: "question",
  idle: "pause",
  succeeded: "check",
  failed: "x",
  none: "doc",
};

/** Maps a Session state onto the shared status palette. Idle stays Idle: it never means done. */
export const statusForSession = (state: SessionState | null | undefined): StatusKey => {
  if (!state) return "none";
  if (state === "queued" || state === "preparing") return "queued";
  if (state === "failed" || state === "failed_setup" || state === "interrupted") return "failed";
  return state;
};

/** Human label for a Session state ("Failed — setup", "Preparing", …). */
export const sessionLabel = (state: SessionState | null | undefined) => {
  if (!state) return "No Session";
  if (state === "failed_setup") return "Failed — setup";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

const tileClass = { sm: " ax-tile-sm", md: "", lg: " ax-tile-lg" } as const;
const tileGlyph = { sm: 13, md: 18, lg: 26 } as const;

/** Coloured rounded icon tile (white glyph on the status colour). Decorative: pair it with a text label. */
export const statusTile = (status: StatusKey, size: "sm" | "md" | "lg" = "md", glyph?: IconName) =>
  `<span class="ax-tile${tileClass[size]} f-${status}" aria-hidden="true">${icon(glyph ?? STATUS_ICON[status], tileGlyph[size])}</span>`;

/** Neutral grey tile for non-status rows (Repositories, settings, empty states). */
export const plainTile = (glyph: IconName, size: "sm" | "md" | "lg" = "md") =>
  `<span class="ax-tile${tileClass[size]} ax-tile-plain" aria-hidden="true">${icon(glyph, tileGlyph[size])}</span>`;

/** Tinted status pill. `label` overrides the default text (e.g. "Failed — setup"). */
export const statusPill = (status: StatusKey, label?: string) =>
  `<span class="ax-pill${status === "queued" || status === "idle" || status === "none" ? "" : ` p-${status}`}">${escapeHtml(label ?? STATUS_LABEL[status])}</span>`;

/** Session state pill with an optional "Not live" tag when Atlas lost the live connection. */
export const sessionPill = (state: SessionState | null | undefined, stale = false) =>
  `${statusPill(statusForSession(state), sessionLabel(state))}${stale ? notLiveTag() : ""}`;

/** Amber "Not live" tag for Stale Sessions: the real state may have changed. */
export const notLiveTag = () =>
  `<span class="ax-notlive" title="Atlas lost the live connection. The real state may have changed.">${icon("warn", 13)}Not live</span>`;

const PR_LABEL: Record<PrState, string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };
const PR_PILL: Record<PrState, string> = { open: " p-succeeded", draft: "", merged: " p-merged", closed: " p-failed" };
const PR_TILE: Record<PrState, string> = { open: "f-succeeded", draft: "f-idle", merged: "f-merged", closed: "f-failed" };

export const prPill = (state: PrState) => `<span class="ax-pill${PR_PILL[state]}">${PR_LABEL[state]}</span>`;
export const prTile = (state: PrState, size: "sm" | "md" | "lg" = "md") =>
  `<span class="ax-tile${tileClass[size]} ${PR_TILE[state]}" aria-hidden="true">${icon("pr", tileGlyph[size])}</span>`;

/** Short age: "now", "4m", "3h", "2d", "5w". */
export const ageShort = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
};

const exactUtc = (date: Date) =>
  `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${date.toISOString().slice(11, 16)} UTC`;

/**
 * Relative time with an exact-time tooltip on hover or keyboard focus. The tooltip is UTC on the
 * server; `public/app.js` rewrites it into the viewer's local time.
 */
export const relativeTime = (iso: string | null | undefined, { now = Date.now(), suffix = " ago" } = {}) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  const age = ageShort(iso, now);
  const text = age === "now" ? "just now" : `${age}${suffix}`;
  return `<time class="ax-time" datetime="${escapeHtml(date.toISOString())}" tabindex="0" data-exact-time>${escapeHtml(text)}<span class="ax-time-tip" role="tooltip">${escapeHtml(exactUtc(date))}</span></time>`;
};

// ── Lists ────────────────────────────────────────────────────────────────

export type RowOptions = {
  title: string;
  href?: string;
  /** Leading tile markup (statusTile / plainTile / prTile). Omit for a plain row. */
  tileHtml?: string;
  sub?: string;
  subHtml?: string;
  /** Trailing markup, usually `rowEnd(...)`. */
  endHtml?: string;
  unread?: boolean;
  current?: boolean;
  chevron?: boolean;
  id?: string;
  attrs?: string;
};

/** One 64px list row. Use inside `group()`. */
export const row = (o: RowOptions) => {
  const tag = o.href ? "a" : "div";
  const sub = o.subHtml ?? (o.sub ? escapeHtml(o.sub) : "");
  return `<${tag} class="ax-row${o.tileHtml ? "" : " ax-row-plain"}"${o.id ? ` id="${escapeHtml(o.id)}"` : ""}${o.href ? ` href="${escapeHtml(o.href)}"` : ""}${o.current ? ' aria-current="page"' : ""}${o.attrs ? ` ${o.attrs}` : ""}>
    ${o.unread ? '<span class="ax-unread"></span><span class="sr-only">New. </span>' : ""}${o.tileHtml ?? ""}
    <span class="ax-row-main"><span class="ax-row-title">${escapeHtml(o.title)}</span>${sub ? `<span class="ax-row-sub">${sub}</span>` : ""}</span>
    ${o.endHtml ?? ""}${o.chevron ? icon("chevron", 16, "ax-chev") : ""}
  </${tag}>`;
};

/** Trailing column: a pill (or other markup) over a muted time. */
export const rowEnd = ({ pillHtml = "", timeHtml = "" }: { pillHtml?: string; timeHtml?: string }) =>
  `<span class="ax-row-end">${pillHtml ? `<span>${pillHtml}</span>` : ""}${timeHtml ? `<span class="ax-row-time">${timeHtml}</span>` : ""}</span>`;

/** Grouped inset card list. `label` names the list for screen readers. */
export const group = (rowsHtml: string[] | string, { label, id }: { label?: string; id?: string } = {}) =>
  `<div class="ax-group"${id ? ` id="${escapeHtml(id)}"` : ""}${label ? ` role="group" aria-label="${escapeHtml(label)}"` : ""}>${Array.isArray(rowsHtml) ? rowsHtml.join("") : rowsHtml}</div>`;

/** Section header ("In progress 3 · Show all"). */
export const sectionHeader = ({ title, count, more, id }: { title: string; count?: string | number; more?: { href: string; label: string }; id?: string }) =>
  `<h2 class="ax-section"${id ? ` id="${escapeHtml(id)}"` : ""}>${escapeHtml(title)}${count !== undefined && count !== "" ? ` <span class="ax-section-n">${escapeHtml(String(count))}</span>` : ""}${more ? `<a class="ax-section-more" href="${escapeHtml(more.href)}">${escapeHtml(more.label)}</a>` : ""}</h2>`;

/** Small upper-case label above a settings group, plus optional footnote below via `groupFoot`. */
export const groupLabel = (text: string) => `<p class="ax-group-label">${escapeHtml(text)}</p>`;
export const groupFoot = (text: string) => `<p class="ax-group-foot">${escapeHtml(text)}</p>`;

// ── Page header ─────────────────────────────────────────────────────────

export type MenuItem = {
  label: string;
  href?: string;
  icon?: IconName;
  /** Red, always sorted last and separated. */
  danger?: boolean;
  external?: boolean;
  /** Trusted markup that replaces the item (e.g. a POST form whose submit button has class `ax-menu-item`). */
  html?: string;
};

export type PageTitleOptions = {
  title: string;
  eyebrow?: string;
  description?: string;
  back?: { href: string; label: string };
  actionsHtml?: string;
  menu?: { title?: string; items: MenuItem[] };
  /** Trusted markup, usually `repositoryFilter(inbox, "head")`. Phone only: on wider screens it is in the top bar. */
  filterHtml?: string;
};

/** Large page title (h1#page-title, focus target on load) with back link, actions, ⋯ menu and phone filter. */
export const pageTitle = (o: PageTitleOptions) => `${o.back ? `<a class="ax-back" href="${escapeHtml(o.back.href)}">${icon("back", 20)}${escapeHtml(o.back.label)}</a>` : ""}
${o.eyebrow ? `<p class="ax-eyebrow">${escapeHtml(o.eyebrow)}</p>` : ""}
<div class="ax-head">
  <div class="ax-head-main">
    <h1 id="page-title" class="ax-title" tabindex="-1" data-page-heading>${escapeHtml(o.title)}</h1>
    ${o.filterHtml ? `<div class="ax-head-filter">${o.filterHtml}</div>` : ""}
  </div>
  ${o.actionsHtml || o.menu ? `<div class="ax-head-actions">${o.actionsHtml ?? ""}${o.menu ? moreMenu({ title: o.menu.title ?? o.title, items: o.menu.items }) : ""}</div>` : ""}
  ${o.description ? `<p class="ax-head-desc">${escapeHtml(o.description)}</p>` : ""}
</div>`;

/** Segmented tabs as plain links (work without JS). */
export const segmented = ({ label, items, large = false }: { label: string; items: Array<{ href: string; label: string; current?: boolean }>; large?: boolean }) =>
  `<nav class="ax-seg${large ? " ax-seg-lg" : ""}" aria-label="${escapeHtml(label)}">${items.map((item) => `<a href="${escapeHtml(item.href)}"${item.current ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("")}</nav>`;

/** Horizontal filter chips (links). */
export const chipRow = ({ label, items }: { label: string; items: Array<{ href: string; label: string; current?: boolean }> }) =>
  `<nav class="ax-chips" aria-label="${escapeHtml(label)}">${items.map((item) => `<a href="${escapeHtml(item.href)}"${item.current ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("")}</nav>`;

// ── Controls ────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "outline" | "plain" | "danger" | "icon";

/** Button ladder: primary › outline › plain › danger (danger lives in ⋯ menus or confirms). */
export const button = ({
  label,
  variant = "primary",
  href,
  type = "button",
  icon: glyph,
  block = false,
  small = false,
  attrs = "",
  ariaLabel,
}: {
  label: string;
  variant?: ButtonVariant;
  href?: string;
  type?: "button" | "submit";
  icon?: IconName;
  block?: boolean;
  small?: boolean;
  attrs?: string;
  ariaLabel?: string;
}) => {
  const cls = `ax-btn${variant === "primary" ? "" : ` ax-btn-${variant}`}${block ? " ax-btn-block" : ""}${small ? " ax-btn-sm" : ""}`;
  const inner = `${glyph ? icon(glyph, 18) : ""}${variant === "icon" ? `<span class="sr-only">${escapeHtml(label)}</span>` : escapeHtml(label)}`;
  const aria = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : "";
  return href
    ? `<a class="${cls}" href="${escapeHtml(href)}"${aria}${attrs ? ` ${attrs}` : ""}>${inner}</a>`
    : `<button class="${cls}" type="${type}"${aria}${attrs ? ` ${attrs}` : ""}>${inner}</button>`;
};

type FieldOptions = {
  id: string;
  name: string;
  label: string;
  value?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  attrs?: string;
};

const describedBy = (o: FieldOptions) =>
  [o.hint ? `${o.id}-hint` : "", o.error ? `${o.id}-error` : ""].filter(Boolean).join(" ");

const fieldShell = (o: FieldOptions, control: string) => `<div class="ax-field">
  <label class="ax-label" for="${escapeHtml(o.id)}">${escapeHtml(o.label)}</label>
  ${control}
  ${o.error ? `<p id="${escapeHtml(o.id)}-error" class="ax-error-text">${escapeHtml(o.error)}</p>` : ""}
  ${o.hint ? `<p id="${escapeHtml(o.id)}-hint" class="ax-hint">${escapeHtml(o.hint)}</p>` : ""}
</div>`;

const controlAttrs = (o: FieldOptions) => {
  const described = describedBy(o);
  return `id="${escapeHtml(o.id)}" name="${escapeHtml(o.name)}"${o.required ? " required" : ""}${o.placeholder ? ` placeholder="${escapeHtml(o.placeholder)}"` : ""}${described ? ` aria-describedby="${described}"` : ""}${o.error ? ' aria-invalid="true"' : ""}${o.attrs ? ` ${o.attrs}` : ""}`;
};

/** Outlined text field with label, hint and error. */
export const textField = (o: FieldOptions & { type?: string; autocomplete?: string }) =>
  fieldShell(o, `<input class="ax-input" type="${escapeHtml(o.type ?? "text")}" ${controlAttrs(o)}${o.value !== undefined ? ` value="${escapeHtml(o.value)}"` : ""}${o.autocomplete ? ` autocomplete="${escapeHtml(o.autocomplete)}"` : ""}>`);

/** Outlined textarea with label, hint and error. */
export const textareaField = (o: FieldOptions & { rows?: number }) =>
  fieldShell(o, `<textarea class="ax-input" rows="${o.rows ?? 4}" ${controlAttrs(o)}>${escapeHtml(o.value ?? "")}</textarea>`);

/** Settings row with an on/off switch (a real checkbox, role="switch"). */
export const toggleRow = ({ id, name, label, hint, checked = false, value = "on", attrs = "" }: { id: string; name: string; label: string; hint?: string; checked?: boolean; value?: string; attrs?: string }) =>
  `<label class="ax-setrow" for="${escapeHtml(id)}"><span class="ax-setrow-main">${escapeHtml(label)}${hint ? `<span>${escapeHtml(hint)}</span>` : ""}</span><input class="ax-toggle" type="checkbox" role="switch" id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${checked ? " checked" : ""}${attrs ? ` ${attrs}` : ""}></label>`;

/** Settings row: title, optional sub line, trailing value; a link when `href` is set. */
export const settingsRow = ({ title, sub, value, valueHtml, href, mono = false }: { title: string; sub?: string; value?: string; valueHtml?: string; href?: string; mono?: boolean }) => {
  const tag = href ? "a" : "div";
  const end = valueHtml ?? (value ? `<span class="ax-setrow-val${mono ? " ax-mono" : ""}">${escapeHtml(value)}</span>` : "");
  return `<${tag} class="ax-setrow"${href ? ` href="${escapeHtml(href)}"` : ""}><span class="ax-setrow-main">${escapeHtml(title)}${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</span>${end}${href ? icon("chevron", 15, "ax-chev") : ""}</${tag}>`;
};

export type PickOption = { value: string; title: string; sub?: string; checked?: boolean; disabled?: boolean; reason?: string };

/** Tick-list picker (radio group as Settings rows). Ineligible rows are dimmed and say why. */
export const pickList = ({ name, legend, options, idPrefix = name }: { name: string; legend: string; options: PickOption[]; idPrefix?: string }) =>
  `<fieldset class="m-0 min-w-0 border-0 p-0"><legend class="ax-group-label">${escapeHtml(legend)}</legend><div class="ax-group">${options.map((option, index) => {
    const id = `${idPrefix}-${index}`;
    const sub = option.disabled && option.reason ? `Can’t use: ${option.reason}` : option.sub;
    return `<label class="ax-setrow ax-pick${option.disabled ? " ax-off" : ""}" for="${escapeHtml(id)}"><input type="radio" id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${option.checked && !option.disabled ? " checked" : ""}${option.disabled ? " disabled" : ""}><span class="ax-setrow-main"><b>${escapeHtml(option.title)}</b>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</span>${icon("check", 20, "ax-tick")}</label>`;
  }).join("")}</div></fieldset>`;

// ── Feedback ────────────────────────────────────────────────────────────

const TONE_ICON: Record<Tone, IconName> = { warning: "warn", info: "info", error: "warn", success: "check" };

/**
 * Banner: amber note (warning), blue info, red error, green success.
 * role defaults to "alert" for errors and "status" otherwise.
 */
export const banner = ({ tone = "warning", title, body, bodyHtml, role, attrs = "", id }: { tone?: Tone; title?: string; body?: string; bodyHtml?: string; role?: "alert" | "status" | "none"; attrs?: string; id?: string }) => {
  const r = role ?? (tone === "error" ? "alert" : "status");
  const text = bodyHtml ?? (body ? escapeHtml(body) : "");
  return `<div class="ax-banner${tone === "warning" ? "" : ` ax-${tone}`}"${id ? ` id="${escapeHtml(id)}"` : ""}${r === "none" ? "" : ` role="${r}"`}${attrs ? ` ${attrs}` : ""}>${icon(TONE_ICON[tone], 18)}<div>${title ? `<b class="ax-banner-title">${escapeHtml(title)}</b>` : ""}${text}</div></div>`;
};

/** Hero / status card: large tile, kicker, title, sub line and one action. */
export const heroCard = ({ status, kicker, title, sub, subHtml, actionHtml, warm = false, glyph }: { status: StatusKey; kicker: string; title: string; sub?: string; subHtml?: string; actionHtml?: string; warm?: boolean; glyph?: IconName }) =>
  `<div class="ax-hero${warm ? " ax-hero-warm" : ""}">${statusTile(status, "lg", glyph)}<div class="ax-hero-main"><div class="ax-hero-k t-${status}">${escapeHtml(kicker)}</div><div class="ax-hero-t">${escapeHtml(title)}</div>${subHtml ?? (sub ? `<div class="ax-hero-s">${escapeHtml(sub)}</div>` : "")}</div>${actionHtml ?? ""}</div>`;

/** Empty state: grey tile, title, one line, optional action. */
export const emptyCard = ({ title, body, bodyHtml, actionHtml, glyph = "inbox" }: { title: string; body?: string; bodyHtml?: string; actionHtml?: string; glyph?: IconName }) =>
  `<div class="ax-group"><div class="ax-empty">${plainTile(glyph, "lg")}<b class="ax-empty-t">${escapeHtml(title)}</b>${bodyHtml ?? body ? `<p class="ax-empty-b">${bodyHtml ?? escapeHtml(body!)}</p>` : ""}${actionHtml ?? ""}</div></div>`;

/** Shimmering placeholder rows while something loads (static under reduced motion). */
export const skeletonRows = (count = 3, label = "Loading") =>
  `<div class="ax-group" role="status" aria-label="${escapeHtml(label)}">${Array.from({ length: count }, () => `<div class="ax-row" aria-hidden="true"><span class="ax-tile ax-sk"></span><span class="ax-row-main"><span class="ax-sk ax-sk-line"></span><span class="ax-sk ax-sk-line-short"></span></span></div>`).join("")}</div>`;

/** Quick confirmation. Fixed above the tab bar unless `inline`. */
export const toast = (text: string, { inline = false, glyph = "check" }: { inline?: boolean; glyph?: IconName } = {}) =>
  `<div class="ax-toast${inline ? " ax-toast-inline" : ""}" role="status">${icon(glyph, 18)}${escapeHtml(text)}</div>`;

// ── Overlays ────────────────────────────────────────────────────────────

const menuItemHtml = (item: MenuItem) => {
  if (item.html) return item.html;
  const glyph = item.icon ?? (item.external ? "external" : undefined);
  return `<a class="ax-menu-item${item.danger ? " ax-danger" : ""}" href="${escapeHtml(item.href ?? "#")}"${item.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${glyph ? icon(glyph, 18) : ""}${escapeHtml(item.label)}</a>`;
};

/**
 * ⋯ menu. Desktop: pop-up under the button. Phone: bottom action sheet with the title on top,
 * a separate Cancel group, and destructive items red and last. Works without JS (details/summary;
 * the dimmed backdrop closes it); app.js adds Escape, outside click and Cancel.
 */
export const moreMenu = ({ title, items, label = "More actions" }: { title?: string; items: MenuItem[]; label?: string }) => {
  const safe = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  return `<details class="ax-menu" data-menu>
  <summary class="ax-btn ax-btn-icon" aria-label="${escapeHtml(label)}">${icon("more", 20)}</summary>
  <div class="ax-menu-panel">
    ${title ? `<div class="ax-menu-title">${escapeHtml(title)}</div>` : ""}
    <div class="ax-menu-items">${safe.map(menuItemHtml).join("")}${danger.length && safe.length ? '<hr class="ax-menu-hr">' : ""}${danger.map(menuItemHtml).join("")}</div>
    <div class="ax-menu-cancel ax-needs-js"><button class="ax-menu-item" type="button" data-menu-close>Cancel</button></div>
  </div>
</details>`;
};

/**
 * Confirm-first pattern for destructive actions (works without JS). `confirmHtml` is the real
 * form whose submit button reads e.g. "Remove"; Cancel collapses the panel.
 */
export const confirmAction = ({ label, title, body, confirmHtml, id }: { label: string; title: string; body?: string; confirmHtml: string; id?: string }) =>
  `<details class="ax-confirm" data-confirm${id ? ` id="${escapeHtml(id)}"` : ""}>
  <summary class="ax-btn ax-btn-danger">${escapeHtml(label)}</summary>
  <div class="ax-confirm-panel" role="group" aria-label="${escapeHtml(title)}"><b>${escapeHtml(title)}</b>${body ? `<p>${escapeHtml(body)}</p>` : ""}<div class="ax-confirm-actions">${confirmHtml}<button class="ax-btn ax-btn-outline ax-needs-js" type="button" data-confirm-cancel>Cancel</button></div></div>
</details>`;

// ── Content ─────────────────────────────────────────────────────────────

/** Spec prose. `bodyHtml` must already be sanitized (rendered Markdown). */
export const prose = (bodyHtml: string) => `<div class="ax-prose">${bodyHtml}</div>`;

/** Always-dark terminal well for live output. Text is escaped. */
export const terminalWell = (text: string, label = "Live output") =>
  `<pre class="ax-term" tabindex="0" aria-label="${escapeHtml(label)}">${escapeHtml(text)}</pre>`;
