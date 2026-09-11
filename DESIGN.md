# Atlas UI design guidelines

## Purpose and authority

Atlas is an internal tool for triaging Specs and starting Sessions. Its UI is a compact, dark-only developer tool: dense enough to work in, calm enough to read, and consistent on phones and desktops.

This file governs visual and interaction decisions. `CONTEXT.md` governs terminology and domain meaning; the originating GitHub issue governs feature scope. Design guidelines do not introduce features or change business rules. If these sources conflict, report the conflict before implementing it.

Implement the theme once in the shared stylesheet and keep it synchronized with this document. Never copy hex values into page templates.

## Design decision record

Decided 2026-09-10 by progressive abstraction: three structurally different prototypes of the Repositories page were built on `/prototype/design?variant=A|B|C`, the owner reacted to concrete renders, and the winning choices were abstracted into the rules below. Research behind the choices lives in `docs/research/design-*.md`.

| Question | Decision | Rejected |
| --- | --- | --- |
| Mode | Dark only, like Claude desktop dark | Light, switchable |
| Layout | Inbox variant A (2026-09-11): left sidebar 288px (`lg:w-72`) with card rows; dense tables in the main pane | Top bar + cards (Claude-like), summary tiles; inbox B dense rows; inbox C main-pane table / `w-56` |
| Background | Graphite with a faint navy tint (GitHub-dark level chroma) | Warm charcoal, deep navy |
| Brand `#012B68` | Sidebar brand band, logo mark, selected-row tint | Button fill (1.2–1.4:1 against every dark surface) |
| Interactive primary | Lighter navy `#4373BA` fill with white text | Exact navy + light ring, exact navy with no edge |
| Accent | Amber `#E19D63`, budgeted (see below) | Terracotta, navy only |
| Corners | 6px controls, 8px containers, 4px badges | 12px/20px (read as "made for children") |
| Density | 32px controls, 14px UI text, compact table rows | Current 44px controls and 16px everywhere |
| Glass | Sticky header only | Glass sidebar and panels |
| Titles | Sans everywhere | Serif page titles |

The previous "blue-black glassmorphism" theme is superseded. Its failure mode was one hue at three chroma-heavy shades: brand, surfaces, and borders all collapsed into the same blue, and the exact brand fill vanished into it.

## Selected design system

Use **Tailwind CSS 4 + daisyUI 5 with a custom `atlas` theme** (built-in themes disabled), flat rendering (`--depth: 0`, `--noise: 0`), Heroicons, and HTMX for server-rendered interactions. Lock resolved versions in the asset pipeline; recheck theme and component behavior on upgrades.

The visual direction is **navy-tinted graphite, flat, compact**: near-black neutral surfaces that step lighter with elevation, one cream-white text ladder, one readable navy for links and selection, the exact brand navy in a few deliberate places, and amber as the single warm accent. No shadows except popovers, no gradients, no textures.

```css
@import "tailwindcss";

@plugin "daisyui" {
  themes: false;
}

@plugin "daisyui/theme" {
  name: "atlas";
  default: true;
  color-scheme: dark;

  --color-base-100: #1A1D23;        /* panel, card, table, input */
  --color-base-200: #111419;        /* app background */
  --color-base-300: #080B10;        /* sunken: sidebar, code wells, table head */
  --color-base-content: #ECEFF3;    /* primary text */
  --color-primary: #4373BA;         /* interactive navy: buttons, progress */
  --color-primary-content: #FFFFFF;
  --color-secondary: #4373BA;       /* alias; not a separate hierarchy */
  --color-secondary-content: #FFFFFF;
  --color-accent: #E19D63;          /* amber, budgeted */
  --color-accent-content: #211208;
  --color-neutral: #23272C;         /* raised/hover surface, neutral badge */
  --color-neutral-content: #ECEFF3;
  --color-info: #5ABBE6;
  --color-info-content: #0B1A22;
  --color-success: #69C27E;
  --color-success-content: #07180C;
  --color-warning: #EBA941;
  --color-warning-content: #1A0F03;
  --color-error: #F47B74;
  --color-error-content: #240A08;

  --radius-selector: 0.25rem;       /* 4px badges, checkboxes */
  --radius-field: 0.375rem;         /* 6px buttons, inputs, menu items */
  --radius-box: 0.5rem;             /* 8px cards, alerts, tables, dialogs */
  --size-selector: 0.25rem;         /* 24px checkbox, 24px badge-md */
  --size-field: 0.2rem;             /* 32px button/input md */
  --border: 1px;
  --depth: 0;
  --noise: 0;
}

@theme {
  --color-brand: #012B68;           /* exact brand navy; see usage rules */
  --color-brand-content: #EEF2F9;
  --color-brand-readable: #83AFF3;  /* links, focus ring, selected indicator */
  --color-brand-tint: #192941;      /* selected row / active nav background */
  --color-muted: #A0A5AC;           /* secondary text */
  --color-faint: #6D7279;           /* tertiary text, placeholders, icons at rest */
  --color-edge: #2B3139;            /* decorative borders and dividers */
  --color-control-border: #666C76;  /* input and secondary-button edges, 3:1 */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
```

Set `<html lang="en" data-theme="atlas">` in the shared document layout with a viewport meta tag. `themes: false` stops daisyUI from also emitting `light`/`dark`; a new theme name inherits nothing, so every token above is required. No light theme, theme switcher, or `dark:` variants.

Use complete, literal class names in server templates and HTMX fragments; Tailwind scans `src/`. Runtime-built names such as `badge-${state}` are not detected.

### Approved palette

| Role | Hex | Contrast | Notes |
| --- | --- | --- | --- |
| App background (`base-200`) | `#111419` | | OKLCH L 0.19, chroma 0.011 at the brand hue |
| Panel / table / input (`base-100`) | `#1A1D23` | 1.09:1 vs base-200 | Elevation is a lighter surface, not a shadow |
| Sunken (`base-300`) | `#080B10` | | Sidebar body, code wells, table head |
| Raised / hover (`neutral`) | `#23272C` | | Row hover, menu hover, neutral badge |
| Primary text (`base-content`) | `#ECEFF3` | 14.6:1 on base-100 | |
| Secondary text (`muted`) | `#A0A5AC` | 6.8:1 on base-100 | Descriptions, table metadata |
| Tertiary text (`faint`) | `#6D7279` | 3.5:1 on base-100 | Large or non-essential text only |
| Decorative edge (`edge`) | `#2B3139` | | Dividers, card and table borders |
| Control edge (`control-border`) | `#666C76` | 3.2:1 on base-100 | Inputs, secondary buttons |
| Brand (`brand`) | `#012B68` | 12.1:1 with brand-content | Exact brand; see rules below |
| Brand tint (`brand-tint`) | `#192941` | 12.7:1 with primary text | Selected row, active nav |
| Brand readable (`brand-readable`) | `#83AFF3` | 8.3:1 on base-200 | Links, focus outline, active indicator |
| Interactive primary (`primary`) | `#4373BA` | 4.8:1 with white; 3.5:1 vs base-100 | Buttons, progress, checked controls |
| Accent (`accent`) | `#E19D63` | 8.1:1 on base-200; 8.0:1 with accent-content | Amber |
| Info | `#5ABBE6` | 7.8:1 on base-100 | Running |
| Success | `#69C27E` | 7.7:1 on base-100 | Succeeded, Available |
| Warning | `#EBA941` | 8.3:1 on base-100 | Waiting, Stale, Archived |
| Error | `#F47B74` | 6.4:1 on base-100 | Failed, Access unavailable |

Ratios are opaque sRGB WCAG 2.x calculations (`docs/research/design-dark-palettes.md`). They do not certify rendered hover states or composited glass; measure those in the browser.

### Brand navy rules

`#012B68` is the brand, not the interaction color. On dark surfaces it measures 1.2–1.4:1, so it cannot be a button fill, link, focus ring, or the only selected-state indicator.

Use exact `#012B68` (`bg-brand text-brand-content`) only for:

- The sidebar brand band: the 48px strip at the top of the sidebar holding the Atlas mark and name.
- The logo mark itself, wherever it appears.
- Full-bleed brand moments that are not controls, such as the sign-in page header band.

Use `brand-tint` for the selected row and active navigation background, always with a 2px `brand-readable` left border and `aria-current`. Use `brand-readable` for link text, keyboard focus outlines, and selection indicators. Use `primary` for filled buttons and checked controls. Do not lighten or darken `#012B68` for new roles; the navy ladder in the palette research is the only source of additional navy shades, and adding one requires a design change.

### Accent budget

Amber is a highlight, not a theme. Allowed uses, in total:

- The section eyebrow or one key figure that needs attention on a page.
- The mark next to a Repository or Session that needs a human decision (Waiting is `warning`, which shares the amber family on purpose).
- An `accent` filled button only when a page has a second, non-primary but important action that must not look like the primary. Expect this to be rare.

Everything else stays neutral or navy. If a screen has more than two amber elements, remove some.

### Semantic colors

Use daisyUI pairs on filled surfaces: `badge-success` gives `#69C27E` with dark content. Semantic fills are bright-on-dark, so their content color is dark, not white; this is the "vibrant, not luminous" look chosen in the prototype. Semantic colors are for actual state and feedback: badges, alerts, inline messages, icons. Never decoration. `info` is cyan-shifted so it does not read as another navy.

For alerts use `alert alert-<state> alert-soft`: tinted background, semantic text, no solid fill. For text-only status, use `text-<state>` with an icon or a word; never color alone.

### Surfaces, borders, elevation

- Background `base-200`; panels, tables, forms `base-100`; sidebar body and code wells `base-300`; hover and raised `neutral`. Each step is a lighter surface. No drop shadows on cards, buttons, inputs, or alerts.
- Borders are 1px `edge` for containers and dividers. Inputs and secondary buttons use `control-border` so their boundary meets 3:1. Primary buttons have no visible border.
- Shadows are allowed only on floating layers (menus, popovers, dialogs): `0 8px 24px rgb(0 0 0 / 0.32)`.
- No background gradients, radial washes, noise, or textures. Delete the old `atlas-backdrop` wash when migrating.

### Glass header

The sticky page header is the only translucent surface. Everything else, including the sidebar, tables, forms, menus, and dialogs, is opaque.

| Property | Value |
| --- | --- |
| Fallback | Opaque `bg-base-200` with `border-b border-edge` |
| Enhanced | `bg-base-200/78` + `backdrop-blur-sm` (8px) inside `@supports (backdrop-filter: blur(8px))` |
| Preferences | Remove translucency and blur for `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and forced colors |

Keep it as one shared `atlas-glass` class in the stylesheet. Do not reuse daisyUI's `glass` utility; it is a light-mode white gradient. Text in the header must meet contrast over any scrolled content; if it does not, make the header opaque.

## Agent workflow

1. Before planning, implementing, or reviewing UI, read this file and `CONTEXT.md`.
2. Find existing page layouts, template partials, and matching components. Reuse them. Introduce a shared partial when it is actually reused, not speculatively.
3. Build only the requested workflow, including applicable loading, empty, error, and success states.
4. Verify the acceptance checklist below. Report checks actually performed and any gaps; do not claim visual verification from source inspection alone.

Changes to the theme or these rules require explicit design scope or human approval. Update affected shared styles/templates and this document together; do not rewrite a rule just to justify a one-off implementation. When proposing a new look, build a `?variant=` prototype and let the owner react to renders; they decide by like/dislike, not by token discussion.

## Layout and spacing

- One shared app shell: a 48px sticky glass header, a 288px (`lg:w-72`) sidebar on `lg` and up, a main region, and a stable location for global notices. Provide a skip link to `main`.
- Sidebar: brand band, Repository filter (native `<select>` GET form: All Repositories, enrolled Repositories, Manage Repositories…, plus Add a Repository), grouped inbox, then a utility group (Pull requests, All Sessions, Open on GitHub) only when one Repository is filtered. Group labels are uppercase 12px `faint`. Selected inbox row: `brand-tint`, 2px `brand-readable` left border, `aria-current="page"`. Below `lg`, no drawer; the header has an **Inbox** link to `/inbox`.
- Header: filtered Repository full name, or **All Repositories**, in `muted`; session controls on the right. Never "No Repository selected".
- Main region: `max-w-6xl`, `px-4 sm:px-6`, `py-5`. Forms `max-w-2xl`. Session output may use the full width.
- Each page has one H1, an optional one-line description in `muted`, and one visually dominant primary action aligned to the right of the title row. Wrap on small screens without changing reading order.
- Spacing scale: 4px within a control, 8px between related controls, 12–16px inside containers, 24px between groups, 32px between major sections. Express these through Tailwind utilities; do not redefine `--spacing`.
- Prefer whitespace and headings over nested cards. A bordered `base-100` container is for tables, forms, and grouped records, not for every paragraph. No hero blocks or decorative metric tiles.

## Typography and iconography

- System `font-sans` stack; no web fonts. `font-mono` for identifiers, branch names, Session IDs, and Session output.
- UI text is 14px (`text-sm`): tables, controls, navigation, metadata, alerts. Prose paragraphs such as page descriptions and empty states may use 16px (`text-base`). Captions and eyebrow labels are 12px (`text-xs`); nothing smaller.
- Page title `text-xl font-semibold`; section title `text-base font-semibold`; column headers and labels `font-medium` in `muted`. Bold is 600, never 700. Sentence case throughout.
- Line height `leading-normal`; long prose `max-w-prose`.
- Text ladder: primary text for content, `muted` for supporting text, `faint` for placeholders and tertiary metadata. Do not use opacity to make text quieter.
- Heroicons outline, 16px inside buttons and inputs, 20px in navigation and tables. Inline SVG with `aria-hidden="true"`; icon-only buttons need an accessible name. Pair unfamiliar icons with text.
- Tabular numerals (`tabular-nums`) for counts and aligned numeric columns, right-aligned in tables. Wrap long names; expose full identifiers as selectable text.

## Component and page patterns

daisyUI components for controls, Tailwind utilities for layout. Preserve component defaults unless this document specifies a shared adjustment. The same action has the same label, hierarchy, and interaction on every page.

| Need | Pattern |
| --- | --- |
| Main action | One `btn btn-primary` per action group; verb + object, e.g. "Start Session". 32px, 14px text, optional leading 16px icon. |
| Secondary action | `btn` (neutral fill, `control-border` edge). `btn-ghost` for low-emphasis and in-table actions (`btn-ghost btn-xs`). |
| Destructive action | `btn-error` with explicit wording and confirmation when irreversible; kept apart from routine actions. |
| Navigation | Real links with meaningful URLs; active item uses `brand-tint`, left border, and `aria-current="page"`. |
| Forms | Label above the field, `input`/`select`/`textarea` at 32px with `control-border`, helper text in `faint`, errors in `error`. |
| Filter | An `input` with a leading search icon, at the top of the list it filters, in a GET form. |
| Status | `badge badge-sm badge-<state>` with text; color reinforces the word. Never color alone. |
| Feedback | `alert alert-<state> alert-soft` inline near the cause; toasts only for supplementary confirmation. |
| Lists of records | A `table` inside a `rounded-box border border-edge bg-base-100` container with compact rows; stacked records below `md`. |
| Inbox row | Variant A cards in the sidebar (`rounded-box border border-edge bg-base-100 p-3`): Spec title, `Spec #<n>`, latest Session state (or No Session), separate Stale/access badges, and an unread dot when applicable; Repository short name only when the filter is All Repositories. Waiting: 2px `warning` left border. Selected: `brand-tint`, 2px `brand-readable` left border, and `aria-current="page"`. On `/inbox`, use `recordTable` / stacked records. |
| Grouped content | Plain section with a heading first; a bordered container only for tables, forms, and record groups. |
| Short confirmation | Native `dialog` styled with `modal`; full page for complex editing. |

### Tables

Tables are the default list presentation on desktop. Use `table` with the shared `table-compact` utility: 8px vertical and 12px horizontal cell padding, 14px text, 36px rows. Header cells are `muted font-medium` on `base-300`. Row hover uses `neutral`. Column order: identity (link) with a `faint` monospace sub-line, state badge, numeric columns right-aligned, freshness, then actions as `btn-ghost btn-xs`. Contain any horizontal scrolling inside the table container with an accessible name; the page itself never scrolls sideways.

### Atlas content

- Keep Repository context visible on Spec, Session, and PR views. Use exactly the domain vocabulary in `CONTEXT.md`.
- For record lists, prioritize identity/title, semantic state, freshness or update time, and the main action. Show supporting metadata second; align comparable values.
- Display actual Session states as text. Queued/Preparing use the neutral badge; Running `info`; Waiting `warning`; Idle neutral; Succeeded `success`; Failed, Interrupted, and Failed setup `error`. Terminal styling must reflect an actual confirmed outcome from the domain model.
- An Active Session is not necessarily Running. Idle is not completion or failure. Show Stale as a separate `warning` badge beside the last known state, with last-updated information when available.
- Show Blockers as context; do not invent a disabled "Start Session" gate from their presence. Eligibility comes from the backend's business rules.
- Render Session output as readable, selectable monospace text on `base-300`. Keep any horizontal scrolling inside the output region. Live updates must not steal focus or force a reader back to the bottom after they scroll away.

### Mobile records and controls

- Core actions must remain available on phones with touch and keyboard. No hover-only menus or row actions.
- Controls are 32px on desktop. Under `@media (pointer: coarse)` raise buttons and inputs to a 44px minimum through the shared stylesheet rather than per-template `min-h-*` classes.
- Below `md`, render table rows as labelled stacked items with the same state and actions, sharing the same server data and action definitions.
- Avoid entire clickable rows containing nested controls. The record title is the link; actions are separate buttons.
- Sticky headers must not obscure content, focused controls, validation messages, or the mobile keyboard.

### Forms and feedback

- Label above the field; placeholders are examples, not labels. Mark optional fields when most are required. Use native input types and autocomplete values.
- Keep the main form action after the fields in a predictable place. Preserve entered values after validation or network errors.
- Associate field errors with `aria-describedby` and set `aria-invalid="true"`. Use a concise error summary for multi-field failures, with links to affected fields.
- During submission show a labelled pending state and prevent accidental repeats. Re-enable controls after failure. Backend safeguards remain necessary for duplicate requests.
- Empty states explain what is missing and offer the relevant next action. Distinguish "no records yet" from "no matches"; offer clearing filters for the latter.
- Error states explain what failed and a safe next step. Do not imply a Session failed merely because its live connection was lost.
- Persistent results belong inline. Screen-reader announcements are brief; never announce an entire frequently updating Session output stream.

## HTMX interaction contract

Server-rendered HTML and native browser behavior first, HTMX for targeted updates, minimal JavaScript for focus and dialog behavior. Do not add a client-side component framework. The researched HTMX behavior is 2.x; verify against the pinned version when implementing.

- **Navigation:** working `href` links and forms with `action`/`method`. Search, filters, sorting, and pagination belong in GET URLs. Start with ordinary page navigation; boost only when focus and history behavior are implemented. Background refreshes do not create history entries.
- **Swap boundaries:** target the smallest meaningful region. Keep stable input IDs; avoid replacing a form being edited, the whole app shell for a local update, or an open dialog element.
- **Validation:** enable HTMX's `reportValidityOfForms` and retain server validation. Return validation errors as HTTP 422 with a value-preserving form fragment; configure 422 swapping explicitly before the general error rule. Preserve handling of other errors rather than swapping arbitrary 4xx/5xx bodies into a form.
- **Failure:** show unexpected HTTP/network failures locally and preserve input. A 204 does not swap a success fragment; HTMX response headers on a 3xx are not processed as an HTMX redirect. Use the appropriate enhanced response while retaining ordinary form fallback.
- **Pending:** local indicator (`hx-indicator`) and disable the submit control during the request (`hx-disabled-elt`). Show "Starting Session…" rather than an unlabelled spinner. The server must enforce one unfinished Session per Spec; after a lost response, reconcile before inviting a retry.
- **Focus:** enhanced page navigation moves focus to the main heading; invalid submission to its error summary or first invalid field; inline updates retain focus or move it to a logical successor when the trigger disappears. Background updates never move focus.
- **Announcements:** keep a stable, initially present `role="status" aria-atomic="true"` region and update its contents with brief meaningful changes. Do not announce every poll or duplicate a focused error summary as an alert.
- **History:** every navigable URL also returns a full page for direct visits and restoration. When `HX-Request` selects fragments, follow the documented `historyRestoreAsHxRequest: false` guidance and separate HTTP cache variants. Reconcile restored Session views before treating their state as fresh. Disable HTMX snapshot storage on sensitive Session detail pages with `hx-history="false"`.
- **Dialogs:** open native dialogs with `showModal()`. Mutations use a real POST form, not `method="dialog"`. Keep the dialog open with errors until success; Cancel must remain usable despite invalid fields. Prefer initial focus on Cancel for irreversible actions.

For implementation details and primary-source links, read [the interaction research](docs/research/design-interactions.md) before changing response handling, focus management, or history behavior.

## Accessibility and motion

- Target WCAG 2.2 AA. Measure rendered contrast: at least 4.5:1 for normal text, 3:1 for large text, and 3:1 for control boundaries and state indicators. The palette table is a starting point, not a certificate.
- Semantic landmarks, ordered headings, visible keyboard focus (`outline: 2px solid brand-readable; outline-offset: 2px`), and native links and buttons. Never hide focus outlines for aesthetics.
- Dialogs and navigation overlays need an accessible name, predictable initial focus, Escape dismissal where appropriate, keyboard containment while modal, and focus return to the trigger.
- Text and/or icons alongside status colors. Never convey success, danger, selection, or freshness by color alone.
- Hover and focus feedback are color and border changes around 150ms, no size shifts. Respect `prefers-reduced-motion`; no pulsing or decorative animation.
- Support text zoom, long labels, and 320 CSS px reflow. Tooltips may supplement labels but cannot carry essential instructions.

## Migration notes

When implementing this theme over the current codebase, expect these changes together in one change set:

- `src/styles.css`: replace the `dim` override with the `atlas` block above; delete `:root { --fx-noise: none; --spacing: 4px }`, the `atlas-backdrop` wash, and the `.btn { height: auto }` and `min-h` overrides; add `table-compact` and the `pointer: coarse` 44px rule; use `var(--radius-field)` in `atlas-skip-link`.
- `src/views.ts`: `data-theme="atlas"`; remove `min-h-11` and `border border-control-border` from buttons (the theme supplies both); remove v4 leftovers `input-bordered` and `textarea-bordered`; restyle the shell to the sidebar brand band and glass header; move record lists to compact tables with stacked mobile fallbacks.
- Brand color references: anything that used `bg-primary` to mean the brand now uses `bg-brand`; `bg-primary/20` selection tints become `bg-brand-tint`.

## Acceptance checklist

For every changed screen or workflow, verify applicable items:

- [ ] Uses the shared `atlas` theme, shell, components, spacing, and typography; no page-specific colors, radii, or shadows.
- [ ] Exact `#012B68` appears only in the brand band, mark, or a non-control brand moment; buttons use `primary`; links and focus use `brand-readable`; amber stays within budget.
- [ ] Only the header is translucent, with an opaque fallback and reduced-transparency handling; all other surfaces are opaque.
- [ ] Corners are 6px on controls, 8px on containers, 4px on badges; controls are 32px on desktop and at least 44px on coarse pointers.
- [ ] Domain terms, Session state, freshness, and action eligibility match `CONTEXT.md` and backend rules.
- [ ] Works at 320, 375, 768, 1024, and 1440 CSS px; no page overflow; tables become stacked records on phones.
- [ ] Keyboard-only navigation works, focus is visible, and overlays return focus correctly.
- [ ] Labels, errors, status announcements, and contrast are checked in the rendered UI.
- [ ] Initial, loading, empty, validation-error, network-error, and success states behave correctly where applicable.
- [ ] Slow, failed, or repeated requests preserve input and do not start duplicate work; stale information is identified honestly.
- [ ] HTMX swaps preserve expected focus and navigation; Back/Forward and full-page reload work for navigable views.
- [ ] Reduced motion and 200% text zoom remain usable.
- [ ] Capture or inspect representative phone and desktop renders; report any unverified checks.

## Research and sources

Researched 2026-09-10. These rules are Atlas conventions built on upstream components, not an upstream accessibility certification.

- [Dark palette derivation](docs/research/design-dark-palettes.md): reference systems (Primer, Geist, Radix, Linear, Ant, Claude), OKLCH analysis of `#012B68`, the three candidate palettes, contrast tables, and the navy ladder.
- [Claude design system](docs/research/design-claude-system.md): verified Claude desktop dark tokens, typography, shape, and accent budget principles.
- [Ant Design dark mode](docs/research/design-antd-dark.md): dark algorithm, neutral ladder, radius and density tokens, semantic triads.
- [daisyUI 5 tokens](docs/research/design-daisyui-tokens.md): theme variables, size formulas, custom theme mechanics, hover math, and the migration inventory of custom classes.
- [Theme research](docs/research/design-theme.md) and the prior blue-black glass palette are historical; this document is the current authority.
- [Interaction research](docs/research/design-interactions.md): HTMX forms, loading, focus, history, mobile tables, and native dialogs.
- [daisyUI themes](https://daisyui.com/docs/themes/), [colors](https://daisyui.com/docs/colors/), [config](https://daisyui.com/docs/config/); [Tailwind theme variables](https://tailwindcss.com/docs/theme); [Heroicons](https://heroicons.com/).
