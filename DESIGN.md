# Atlas UI design guidelines

## Purpose and authority

Atlas is an internal tool for triaging Specs and starting Sessions. Its UI follows Look A "Health": an Apple-app feel with large titles, grouped inset lists, and coloured status tiles, in light and dark mode, consistent on phones and desktops.

This file governs visual and interaction decisions. `CONTEXT.md` governs terminology and domain meaning; the originating GitHub issue governs feature scope. Design guidelines do not introduce features or change business rules. If these sources conflict, report the conflict before implementing it.

Implement the tokens once in `src/styles.css` and keep it synchronized with this document. Never copy hex values into page templates.

## Design decision record

> **Overhaul shipped (2026-11-18).** The owner picked direction **A "Health"** (Apple-app feel) over B "Rex" and C "Warm" in the Phase 1 taste round of `docs/ui-overhaul-plan.md`. Prototype: `prototypes/taste/a.ts`. Direction A means large bold titles, grouped inset rounded lists, coloured status icon tiles, a translucent bar, a bottom tab bar on phones, Inter as the UI font, navy `#012B68` kept as the brand and tint, light and dark modes, and roomy spacing. The phase tables below record each pick; "Selected design system" describes what shipped. The first table is the superseded pre-overhaul look, kept for history.
>
> **Phase 2 fine-tune (2026-11-18)**, picked on `prototypes/taste/tile.ts`. Values are prototype values; Phase 7 moves them into `src/styles.css`.
>
> | Question | Decision | Rejected |
> | --- | --- | --- |
> | Mode | Light and dark; follow the system, with a per-browser override | Dark only |
> | Dark background | Pure black `#000000` page, `#1C1C1E` grouped cards | Soft graphite `#161618` |
> | Corners | Round: 14px groups, 18px hero cards, 12px buttons, 9px icon tiles, pill chips | Tighter 8/6px |
> | Primary button | Bright blue with white text: light `#0A63D8` (5.5:1), dark `#0A6CF0` (4.8:1). Apple's `#0A84FF` was rejected at 3.6:1. Navy `#012B68` stays for the logo, selection tint and light-mode tint | Deep navy fill |
> | Status markers | Coloured rounded icon tiles (white glyph on status colour) | Small dots |
> | Density | Roomy: 64px list rows, 16px row titles, 15px body, 34px large titles, 40px buttons | Snug 50px rows |
> | Font | Inter (UI) + Geist Mono (code), self-hosted `.woff2`; owner approved bundling 2026-11-18 | System font (resolves to Liberation Sans on Linux) |
>
> **Phase 3 components (2026-11-18)**, picked on `prototypes/taste/parts.ts`. The owner approved all of Part 2 (status set incl. Stale "Not live" tag, button ladder, empty, error, toast, exact-time tooltip, Spec prose, wide table) without changes.
>
> | Component | Decision | Rejected |
> | --- | --- | --- |
> | Row status | Tinted pill (status colour at ~16% behind status-coloured text) | Bare coloured text |
> | Secondary button | Outline (1.5px separator ring, no fill) | Grey fill |
> | Text fields | Outlined: card background with 1.5px ring, 12px corners, 44px tall | Grey filled |
> | Starting-target picker | Grouped Settings-style list with a trailing tick; ineligible rows dimmed with a plain reason | Bordered choice cards with radios |
> | Phone ⋯ menu | Bottom action sheet with a separate Cancel group; destructive item red, last | Dropdown pop-up (desktop keeps the pop-up) |
> | System warnings | Thin amber strip under the top bar, one line plus "Details" | Pill in the top bar |
> | Loading | Shimmering skeleton shapes | Spinner |
> | Live output | Terminal well, always dark in both modes | Page-matched well |
>
> **Phase 4 frame (2026-11-18)**, picked on `prototypes/taste/frame.ts`. The owner approved the quick-search overlay (desktop centred panel; phone full-screen with Cancel) without changes.
>
> | Question | Decision | Rejected |
> | --- | --- | --- |
> | Desktop sidebar | Live list: segmented Inbox · Sessions · PRs · Repos, then every Spec grouped Needs you → Working → Settled, each with a small status tile, title and age; selected item tinted | Section links (Inbox, Sessions, PRs…) |
> | Phone navigation | Bottom tab bar: Inbox · Sessions · PRs · Repos · More | Menu button opening a sheet |
> | Quick search entry (desktop) | Search field at the top of the sidebar with a ⌘K hint; phone uses a magnifier in the top bar | Top-right button |
> | Repository filter | One dropdown button ("All Repositories ▾"); on phones it sits beside the large title | Chips under the title |
> | Light/dark switch | Auto · Light · Dark segmented control in the account menu (sidebar footer; More tab on phones). Default Auto follows the device | Moon button in the top bar |
> | Updates, Sign out | In the account menu | Sidebar links |
>
> **Phase 5 screens (2026-11-18)**, picked on `prototypes/taste/inbox.ts` and later Phase 5 pages. The owner approved the phone Inbox list (needs-you card with Open Session, then Working → Not started → Settled groups, unread dot on new results) without changes.
>
> | Screen | Decision | Rejected |
> | --- | --- | --- |
> | Inbox, desktop main area | Mail-style: the top Needs-you item (else the newest Working item) opens in the main pane; the sidebar live list selects what the pane shows | "Today overview" dashboard of cards |
> | Session page structure | Title + status card on top, then a segmented control: Activity · Spec · Details (Spec = snapshot + prompt; Details = technical facts) | One long scrolling page |
> | Agent activity | Agent messages shown in full; tool steps between them folded into one "N steps · summary" row that expands on tap; the live step stays visible | Every step listed as its own row |
> | Pull request result | Prominent green-ringed PR card above the status card with an "Open on GitHub" primary button | One line inside the status card |
> | Session states (approved, `prototypes/taste/session.ts` Part 2) | Waiting shows the Agent's question read-only with "Answer it in OpenCode. Atlas can't reply."; Stale shows a "Not live" amber banner, dims the page and drops the Live tag; ⋯ sheet = Spec on GitHub, Spec in Atlas, Repository Sessions, then (only when they apply) Review current target and red Release stack reservation… | — |
> | Start Session entry | Its own page (phone: Cancel · "Start Session" · Start bar; desktop: centred modal over the Spec, approved in Part 2) | Bottom sheet over the Spec |
> | Spec page Start button | Pinned in a bar above the phone tab bar, always in reach; desktop keeps it in the title row | Under the title, scrolls away |
> | Start form order | "Start from" target list first (Settings-style, tick, ineligible rows dimmed with the reason), then the required prompt (outlined, "Required… Atlas sends it exactly as written") | Prompt first with a collapsed "Start from" row |
> | Spec page states (approved, `prototypes/taste/spec.ts` Part 2) | Duplicate start shows a red "Session not queued" box linking to the existing Session; a Repository that can't start shows a plain grey note instead of the button | — |
> | Repositories list | Cards: colour initial tile, name + owner/name, description, then a "N Specs · N working" footer | Settings-style list rows |
> | Inside a Repository | Segmented control: Specs · Pull requests · Sessions | Pull requests / Sessions link rows above the Specs list |
> | Spec rows in a Repository | Plain: title + "Spec #N · updated X ago"; status lives on the Spec page | Session status pill on every row |
> | Repository management (approved, `prototypes/taste/repos.ts` Part 2) | Add Repository is its own page from "+" (filter field; Add / Added / Re-add per row; amber notes for removed or archived; footnote that adding changes nothing on GitHub). Remove from Atlas lives in the Repository ⋯ sheet and **asks first** (new behaviour: today's remove has no confirm) | — |
> | PR stack look | Card per stack ("Stack #N · N layers") with layers joined by a vertical line; dot colour = state (purple merged, green open, red closed, grey draft); "TOP" tag on the top layer | Numbered 1/2/3 rows |
> | PR stack order | Oldest (base) layer on top, matching GitHub's bottom-to-top order | Newest layer on top |
> | Start eligibility on the Pull requests tab | Shown inline: a tick/cross line at the foot of each stack card and under each standalone PR row, with the real reason | Only inside the Start Session form |
> | Pull requests states (approved, `prototypes/taste/prs.ts` Part 2) | Unverified = amber "Couldn't check GitHub just now" banner over last-seen data; blocked stack = red Closed layer + cross line with the reason; empty = centred "No open pull requests" | — |
> | Sessions tab: status filter | Horizontal chip row (Active · All · Running · Waiting · Queued · Failed …), Active selected by default | "Active ▾" menu button |
> | Sessions tab: list | One list, newest first, state pill on the right | Grouped under state headings |
> | Sessions tab: prompt | Hidden in rows (shown on the Session page) | One-line prompt preview per row |
> | Sessions tab states (approved, `prototypes/taste/allsessions.ts` Part 2) | Finished rows add one line: green "PR #N opened" or the red failure reason; empty Active = "Nothing running" with "See all Sessions ›" | — |
> | Updates page | Simple: one centred status card (up to date / ready / installing) with the one action (Check now / Install), the policy below, everything else behind a "Technical details" row | Every stage (Installed, Available, Staging, Activation, Retention) as its own card |
> | Update policy control | One switch: "Install small fixes automatically · Same version, newer build only" | Two-choice tick list |
> | Sign in | Centred: big logo, title, one credential field, full-width Sign in button; no app frame | Plain left-aligned page with a brand bar |
> | Updates & Sign in states (approved, `prototypes/taste/updates.ts` Part 2) | Ready card explains the brief restart (queued Sessions kept, OpenCode keeps running, auto-restore on failure); installing shows 3 steps incl. "Waiting for a safe moment to restart"; wrong credential = red box; preserved Start Session = blue note "Atlas won't send it on its own" | — |
> | Remove Repository | Moves off the Session page to the Repository page (it acts on the Repository, not the Session) | Session ⋯ menu |

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

Shipped 2026-11-18 as Look A "Health". The decision tables above are the source of each choice; this section describes what is built.

- **Stack:** Tailwind CSS 4 builds `public/app.css` from `src/styles.css`, which imports the per-area slices in `src/styles/*.css` (`inbox`, `session`, `spec`, `repos`, `prs`, `lists`). The daisyUI plugin is still loaded with `themes: false`, but no template uses daisyUI component classes; removing it is a follow-up. HTMX handles server-rendered updates.
- **Markup:** pages are built from the kit in `src/views/kit.ts` (tiles, pills, rows, groups, page title, segmented control, buttons, settings rows, banners, hero/empty cards, skeleton rows, ⋯ menu, confirm, prose, terminal well) and the frame in `src/views/frame.ts` + `src/views/shell.ts`. Kit classes are `ax-*`; slice classes use a short page prefix (`ix-`, `sv-`, `sp-`, `rp-`, `pr-`, `ls-`).
- **Tokens:** all colours are CSS variables in `src/styles.css`. Never copy hex values into templates or slices.

### Modes

Light, Dark and Auto. Auto follows `prefers-color-scheme`. `/assets/theme.js` runs before first paint and sets `data-theme="atlas-light"` or `data-theme="atlas-dark"` on `<html>` when the browser has a saved Light/Dark override. Every token has a light and a dark value; check both modes for every change.

### Tokens

| Group | Variables | Use |
| --- | --- | --- |
| Surfaces | `--a-bg`, `--a-card`, `--a-side`, `--a-bar`, `--a-fill`, `--a-fill2`, `--a-sel` | Page, grouped-list cards, desktop sidebar, translucent bars, control fills, selected row |
| Text | `--a-text`, `--a-sec`, `--a-ter`, `--a-mono` | Primary, secondary, tertiary, monospace text |
| Lines | `--a-sep`, `--a-ring` | Separators; control boundaries (3:1) |
| Interaction | `--a-tint`, `--a-link`, `--a-btn`, `--a-btn-text`, `--a-focus`, `--a-danger` | Brand tint, links, filled buttons, focus ring, destructive actions |
| Status text | `--t-running`, `--t-waiting`, `--t-succeeded`, `--t-failed`, `--t-idle`, `--t-queued`, `--t-none`, `--t-merged` | Status words and glyphs on cards (AA 4.5:1) |
| Status fills | `--f-*` (same keys) | Status tile backgrounds with white glyphs |
| Other | `--a-shadow`, `--a-hero`, `--a-font-mono` | Floating layers, the hero card, the mono stack |

Status keys come from `STATUS_LABEL` in `kit.ts`. Stale is not a state: show the state's tile and pill plus the amber `notLiveTag()` ("Not live").

### Brand navy

`#012B68` is the light-mode `--a-tint` and the Atlas mark. It is not a button fill or focus colour in dark mode, where it measures under 1.5:1; dark mode uses `--a-tint: #7AA7F2`. Filled buttons use `--a-btn`; links use `--a-link`; focus uses `--a-focus`.

### Surfaces and the bars

- Grouped inset lists on `--a-card` with 10–14px corners; no borders around cards, no shadows except floating layers (`--a-shadow`).
- The top bar, phone tab bar, and sticky Start bar are the only translucent surfaces (`--a-bar` + backdrop blur). `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors: active` make them opaque `--a-bg` (`src/styles.css`, `@media (prefers-reduced-transparency …)`).
- The hero card (`--a-hero`) is the only gradient.

## Agent workflow

1. Before planning, implementing, or reviewing UI, read this file and `CONTEXT.md`.
2. Build from the kit (`src/views/kit.ts`) and the frame (`renderShell` in `src/views/shell.ts`). Add a kit helper only when two pages need it; page-only styles go in that page's slice in `src/styles/`.
3. Build only the requested workflow, including applicable loading, empty, error, and success states.
4. Verify the acceptance checklist below. `bun run demo` serves every screen and state with seeded data on port 4141. Report checks actually performed; do not claim visual verification from source inspection alone.

Changes to the tokens or these rules require explicit design scope or human approval. Update `src/styles.css` and this document together. When proposing a new look, build a prototype and let the owner react to renders; they decide by like/dislike, not by token discussion.

## Layout and spacing

- **Breakpoints:** phone below 760px, tablet 760–1023px, desktop 1024px and up.
- **Frame (`renderShell`):** a sticky top bar; a 272px sidebar on desktop (brand, Repository filter, Inbox groups, live Sessions); a bottom tab bar on phone and tablet (Inbox, Sessions, PRs, Repos, More); an optional sticky Start bar. Provide the skip link to `main`.
- **Header API:** `renderShell({ header })` takes a `ShellHeader`: the page title and subtitle, `back` (with `phoneOnly`), `menu` (⋯ actions, `label`), and `filter?: boolean`. `header` renders the one `h1#page-title`; only full-screen flows with their own bar (Start Session) put an `h1` in `content`.
- **Content:** `.ax-content` is at most 1040px wide, with 16px side padding on phone and 40px from 760px. Large title 32px on phone, 34px from 760px.
- One H1 per page, one visually dominant primary action. Wrap on small screens without changing reading order.
- Prefer grouped lists and section headers over nested cards. No decorative metric tiles.

## Typography and iconography

- Inter (UI) and Geist Mono (identifiers, branch names, Session IDs, output), self-hosted as `/assets/fonts/inter.woff2` and `/assets/fonts/geist-mono.woff2`. The mono stack falls back to system monospace faces. The Geist Mono subset lacks some box-drawing and arrow glyphs; those fall back too.
- Body 15px in rows, 14px in metadata and banners, 12–13px for captions; nothing smaller than 12px. Sentence case.
- Icons are inline SVG from `src/views/icons.ts` via `icon()`, with `aria-hidden="true"`. Icon-only buttons need an accessible name.
- Tabular numerals for counts. Wrap long names (`overflow-wrap: anywhere`); expose full identifiers as selectable text.

## Component and page patterns

The same action has the same label, hierarchy, and interaction on every page.

| Need | Pattern |
| --- | --- |
| Main action | `button({ variant: "primary" })`; verb + object, e.g. "Start Session". |
| Secondary / quiet action | `button` with a non-primary `ButtonVariant`. |
| Destructive action | `confirmAction` with explicit wording; the danger fill uses `--a-danger`; kept apart from routine actions. |
| Navigation | Real links with meaningful URLs; the active tab or sidebar item has `aria-current="page"`. |
| Status | `statusTile` + `statusPill`/`sessionPill` with the state word; colour reinforces the word. Never colour alone. |
| Feedback | `banner({ tone })` inline near the cause. No toasts: successful actions redirect to a page that shows the result. |
| Lists of records | `group` of `row`s (title, sub line, trailing `rowEnd`, chevron when the row is a link). |
| Settings and facts | `settingsRow`; long values wrap inside their column. |
| Page actions | `moreMenu` (⋯); on phones it opens as a bottom action sheet. |
| Short confirmation | Native `dialog` via `confirmAction`; full page for complex editing. |
| Wide tables (Markdown) | `prose` wraps tables in a scroll container; the page itself never scrolls sideways. |

### Atlas content

- Keep Repository context visible on Spec, Session, and PR views. Use exactly the domain vocabulary in `CONTEXT.md`.
- Display actual Session states as text. Terminal styling must reflect an actual confirmed outcome from the domain model.
- An Active Session is not necessarily Running. Idle is not done: say "Not finished" and point to OpenCode. Show Stale as "Not live" beside the last known state.
- Atlas can't reply in OpenCode or cancel a Session; never offer those actions.
- Show Blockers as context; eligibility comes from the backend's business rules.
- Render Session output as selectable monospace text in `terminalWell`. Live updates must not steal focus or force a reader back to the bottom.

### Phone

- Tap targets are at least 44px below 760px or on coarse pointers (segments, rows, buttons, sheet actions, skip link). Small visual controls get a 44px `::after` hit area.
- Core actions remain available on phones with touch and keyboard. No hover-only menus or row actions.
- Sticky bars must not obscure content, focused controls, validation messages, or the keyboard.

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

- Target WCAG 2.2 AA in both modes. Measure rendered contrast: 4.5:1 for normal text, 3:1 for large text, control boundaries, and state indicators. The inert ghost backdrop behind the Start Session sheet is exempt.
- Semantic landmarks, ordered headings, visible keyboard focus (`outline: 2px solid var(--a-focus)`; `Highlight` in forced colours), native links and buttons. Never hide focus outlines.
- Dialogs and the action sheet need an accessible name, predictable initial focus, Escape dismissal, keyboard containment while modal, and focus return to the trigger.
- Text and/or icons alongside status colours. Never convey success, danger, selection, or freshness by colour alone.
- Hover and focus feedback are colour changes, no size shifts. Respect `prefers-reduced-motion`; no pulsing or decorative animation.
- Support text zoom, long labels, and 320 CSS px reflow. Tooltips (relative times) supplement labels and stay inside the viewport.

## Not built

- ⌘K quick search approved but not built, needs own Spec (`docs/deferred/DEF-001-quick-search.md`). No search field, ⌘K hint, or magnifier ships until then.

## Acceptance checklist

For every changed screen or workflow, verify applicable items:

- [ ] Uses the kit, the frame, and the tokens; no page-specific hex values, radii, or shadows.
- [ ] Checked in light and dark mode.
- [ ] Only the bars are translucent, with the opaque reduced-transparency fallback.
- [ ] Phone tap targets are at least 44px.
- [ ] Domain terms, Session state, freshness, and action eligibility match `CONTEXT.md` and backend rules.
- [ ] Works at 320, 390, 760, 1024, and 1440 CSS px; no page overflow.
- [ ] Keyboard-only navigation works, focus is visible, and overlays return focus correctly.
- [ ] Labels, errors, status announcements, and contrast are checked in the rendered UI.
- [ ] Initial, loading, empty, validation-error, network-error, and success states behave correctly where applicable.
- [ ] Slow, failed, or repeated requests preserve input and do not start duplicate work; stale information is shown as "Not live".
- [ ] HTMX swaps preserve focus and navigation; Back/Forward and full-page reload work.
- [ ] Reduced motion and 200% text zoom remain usable.
- [ ] Capture phone and desktop renders in both modes (`bun run demo`); report any unverified checks.

## Research and sources

Researched 2026-09-10. These rules are Atlas conventions built on upstream components, not an upstream accessibility certification.

- [Dark palette derivation](docs/research/design-dark-palettes.md) (pre-overhaul, historical): reference systems (Primer, Geist, Radix, Linear, Ant, Claude), OKLCH analysis of `#012B68`, the three candidate palettes, contrast tables, and the navy ladder.
- [Claude design system](docs/research/design-claude-system.md): verified Claude desktop dark tokens, typography, shape, and accent budget principles.
- [Ant Design dark mode](docs/research/design-antd-dark.md): dark algorithm, neutral ladder, radius and density tokens, semantic triads.
- [daisyUI 5 tokens](docs/research/design-daisyui-tokens.md): historical; the shipped UI no longer uses daisyUI components.
- [Theme research](docs/research/design-theme.md) and the prior blue-black glass palette are historical; this document is the current authority.
- [Interaction research](docs/research/design-interactions.md): HTMX forms, loading, focus, history, mobile tables, and native dialogs.
- [daisyUI themes](https://daisyui.com/docs/themes/), [colors](https://daisyui.com/docs/colors/), [config](https://daisyui.com/docs/config/); [Tailwind theme variables](https://tailwindcss.com/docs/theme); [Heroicons](https://heroicons.com/).
