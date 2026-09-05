# Atlas UI design guidelines

## Purpose and authority

Atlas is an internal tool for browsing Repositories and starting autonomous Sessions from team-authored Specs. Its UI should be calm, modern, readable, and consistent on phones and desktops. Dark mode is the only mode. Density is balanced: enough information to work, without a wall of controls.

This file governs visual and interaction decisions. `CONTEXT.md` governs terminology and domain meaning; the originating GitHub issue governs feature scope. Design guidelines do not introduce features or change business rules. If these sources conflict, report the conflict before implementing it.

This is an application guide, not a copy of the Google DESIGN.md token schema. The installed design system owns raw tokens; this document owns their usage. Keep shared styles and templates authoritative rather than duplicating theme values here.

## Selected design system

Use **Tailwind CSS 4 + daisyUI 5, with the built-in `dim` theme unchanged**, and HTMX for server-rendered interactions. This is the planned frontend baseline, not a claim that dependencies are installed. Lock resolved versions when implementing the asset pipeline; recheck theme and component behavior on upgrades.

`dim` provides soft slate backgrounds, a restrained foreground, rounded controls, and no decorative depth/noise. Its green primary action supplies a small amount of color. Use its other accents only for meaningful states, not to give each page its own identity.

Compile the stylesheet using the project's eventual asset pipeline:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: dim --default;
}
```

Set `<html lang="en" data-theme="dim">` in the shared document layout and include a viewport meta tag. Enable only `dim`; it supplies a dark native `color-scheme`. No light theme, theme switcher, or system-preference theme branching. Avoid duplicating styles with `dark:` variants.

Use complete, literal class names in server templates and state mappings, including HTMX fragments. Ensure Tailwind scans those directories; configure `@source` if they are outside its detected sources. Runtime-built class names such as `text-${state}` are not reliably detected.

### Semantic colors and surfaces

| Role | Default |
| --- | --- |
| App background | `bg-base-200 text-base-content` |
| Content surface | `bg-base-100 text-base-content` |
| Decorative divider/card border | `border-base-300`; not sufficient by itself for essential control boundaries |
| Main action | `btn-primary`; reserve green emphasis for the main action rather than decoration |
| Informational state | `info` and its paired `info-content` foreground |
| Confirmed success | `success` and `success-content` |
| Attention or freshness warning | `warning` and `warning-content` |
| Error or destructive action | `error` and `error-content` |

Use daisyUI's paired foregrounds on colored surfaces, e.g. `bg-primary text-primary-content`; component modifiers already pair them. Keep raw hex/OKLCH colors out of page templates. Preserve upstream radii and flat elevation rather than introducing custom shadows or per-page corner styles.

Use full-strength `text-base-content` for important text; distinguish metadata first through size and placement. Any reduced-opacity text needs measured contrast. Avoid neutral outline/dash button and badge variants: upstream documents their dark foreground as intended for light backgrounds. Use the default button or a verified semantic alternative.

## Agent workflow

1. Before planning, implementing, or reviewing UI, read this file and `CONTEXT.md`.
2. Find existing page layouts, template partials, and matching components. Reuse them. Introduce a shared partial when it is actually reused, not speculatively.
3. Build only the requested workflow, including applicable loading, empty, error, and success states.
4. Verify the acceptance checklist below. Report checks actually performed and any gaps; do not claim visual verification from source inspection alone.

Changes to the theme or these rules require explicit design scope or human approval. Update affected shared styles/templates and this document together; do not rewrite a rule just to justify a one-off implementation.

## Layout and spacing

- Use one shared app shell: navigation, page header, main content, and a stable location for global notices. Provide a skip link to `main`.
- On wide screens, use a restrained sidebar. Below the `lg` breakpoint, use a labelled navigation button and an accessible drawer. Preserve the same destinations and names on both.
- Use a fluid main region capped at `max-w-7xl`, with `px-4 sm:px-6 lg:px-8` and `py-6`. Forms should normally be narrower (`max-w-2xl`); detailed output can use the available width.
- Each page has one H1, an optional short description, and one visually dominant primary action. Wrap actions on small screens without changing reading order.
- Use the standard spacing scale: 4px for tightly related details, 8px for compact groups, 12–16px within components, 24px between groups, and 32px between major sections. Express these through Tailwind utilities.
- Stack columns on phones. Introduce columns only when content fits; never shrink labels and controls to preserve a desktop arrangement.
- Use bordered sections only to group meaningful content. Prefer whitespace and headings to nested cards. Avoid decorative heroes, gradients, glass effects, and ornamental dashboard metrics.

## Typography and iconography

- Use Tailwind's system `font-sans` stack throughout. No web-font dependency. Use `font-mono` only for code, identifiers, and Session output.
- Body text and form controls: `text-base` (16px on the default scale). Supporting metadata: `text-sm` (14px). Avoid smaller text for information users need to read.
- Page title: `text-2xl font-semibold`; section title: `text-lg font-semibold`; controls and column labels: `font-medium`. Use sentence case.
- Use comfortable body line height (`leading-normal` or `leading-relaxed`). Constrain long prose to about 65 characters (`max-w-prose`).
- Use one icon family: Heroicons outline SVGs, normally 20px or 24px. Inline SVGs work with server templates; a JavaScript icon package is unnecessary. Pair unfamiliar icons with text. Decorative SVGs use `aria-hidden="true"`; icon-only buttons need an accessible name.
- Use tabular numerals for changing counts and aligned numeric columns. Wrap long Repository/Spec names; expose full identifiers through selectable text, not hover-only tooltips.

## Component and page patterns

Use daisyUI components for controls and Tailwind utilities for layout. Preserve component defaults unless this document specifies a shared adjustment. The same action must have the same label, hierarchy, and interaction across pages.

| Need | Pattern |
| --- | --- |
| Main action | One `btn btn-primary` in each action group; use verb + object, e.g. “Start Session”. |
| Secondary action | Default `btn`; `btn-ghost` for low-emphasis actions. |
| Destructive action | `btn-error` with explicit wording and confirmation when irreversible. Keep it separate from routine actions. |
| Navigation | Real links with meaningful URLs; show the active destination with `aria-current="page"` and a visible indicator. |
| Forms | Visible labels, helper/error text, and daisyUI `input`, `select`, `textarea`, `checkbox`, or `radio` components. |
| Status | Compact text-labelled `badge`; color reinforces the wording rather than replacing it. |
| Feedback | Local inline message or `alert`; use a toast only for nonessential, supplementary confirmation. |
| Grouped content | Plain section first; `card` with a subtle border when grouping needs emphasis. |
| Lists of records | Table when comparison matters; stacked records on narrow screens when the same information works better that way. |
| Short confirmation | Native `dialog` styled with daisyUI `modal`; use a full page for complex editing. |

### Atlas content

- Keep Repository context visible on Spec, Session, and PR views. Use exactly the domain vocabulary in `CONTEXT.md`.
- For record lists, prioritize identity/title, semantic state, freshness or update time, and the main action. Show supporting metadata second; align comparable values.
- Display actual Session states as text. Queued/Preparing may use neutral styling; Running informational styling; Waiting warning styling; Idle neutral styling. Terminal styling must reflect an actual confirmed outcome from the domain model.
- An Active Session is not necessarily Running. Idle is not completion or failure. Show Stale as a separate freshness warning alongside the last known state, with last-updated information when available.
- Show Blockers as context; do not invent a disabled “Start Session” gate from their presence. Eligibility comes from the backend's business rules.
- Render Session output as readable, selectable text. Keep any necessary horizontal scrolling inside the output region. Live updates must not steal focus or force a reader back to the bottom after they scroll away.

### Mobile records and controls

- Core actions must remain available on phones, including touch and keyboard access. Avoid hover-only menus and row actions.
- Aim for at least 44×44 CSS px interactive targets; apply a shared minimum size to buttons/inputs as needed, rather than compressing controls on mobile. Space checkbox/radio labels so the entire label is a comfortable target.
- On narrow screens, turn ordinary record rows into labelled stacked items; retain state and actions. Share the same server data and action definitions between presentations.
- If a genuinely two-dimensional comparison requires a table, contain horizontal scrolling in a labelled region. Keep the page itself free of horizontal overflow. Use proper headers and a caption or accessible name.
- Avoid entire clickable rows containing nested controls. Make the record title a link and actions separate buttons/links.
- Sticky headers/footers must not obscure content, focused controls, validation messages, or the mobile keyboard.

### Forms and feedback

- Put the label above its field; placeholders are examples, not labels. Mark optional fields explicitly when most fields are required. Use appropriate native input types and autocomplete values.
- Keep the main form action in a predictable location after the fields. Preserve entered values after validation or network errors.
- Associate field errors with `aria-describedby` and set `aria-invalid="true"`. Use a concise error summary for multi-field failures, with links to affected fields.
- During submission, show a labelled pending state and prevent accidental repeats. Re-enable controls after failure. Backend safeguards remain necessary for duplicate requests.
- Empty states explain what is missing and offer the relevant next action. Distinguish “no records yet” from “no matches”; offer clearing filters for the latter.
- Error states explain what failed and a safe next step. Do not imply a Session failed merely because its live connection was lost.
- Persistent results belong inline. Screen-reader announcements should be brief; do not announce an entire frequently updating Session output stream.

## HTMX interaction contract

Use server-rendered HTML and native browser behavior first, with HTMX for targeted updates and minimal JavaScript for focus/dialog behavior. Do not add a client-side component framework to use daisyUI. The researched HTMX behavior is 2.x; verify it against the pinned version when implementing.

- **Navigation:** use working `href` links and forms with `action`/`method`. Search, filters, sorting, and pagination belong in GET URLs. Start with ordinary page navigation; boost only when focus and history behavior are implemented. Background refreshes do not create history entries.
- **Swap boundaries:** target the smallest meaningful region. Keep stable input IDs; avoid replacing a form being edited, the whole app shell for a local update, or an open dialog element.
- **Validation:** enable HTMX's `reportValidityOfForms` and retain server validation. Return validation errors as HTTP 422 with a value-preserving form fragment; explicitly configure 422 swapping before the general error rule. HTMX 2.x does not swap 422 by default. Preserve handling of other errors rather than swapping arbitrary 4xx/5xx bodies into a form.
- **Failure:** show unexpected HTTP/network failures locally and preserve input. A 204 does not swap a success fragment; HTMX response headers on a 3xx are not processed as an HTMX redirect. Use the appropriate enhanced response while retaining ordinary form fallback.
- **Pending:** use a local indicator (`hx-indicator`) and disable the submit control during the request (`hx-disabled-elt`). Show “Starting Session…” rather than an unlabelled spinner. The server must enforce one unfinished Session per Spec; after a lost response, reconcile before inviting a retry.
- **Focus:** enhanced page navigation moves focus to the main heading; invalid submission to its error summary/first invalid field; inline updates retain focus or move it to a logical successor when the trigger disappears. Background updates never move focus. Use scoped handlers rather than globally focusing the first input after every swap.
- **Announcements:** keep a stable, initially present `role="status" aria-atomic="true"` region and update its contents with brief meaningful changes. Avoid announcing every poll or duplicating a focused error summary as an alert.
- **History:** every navigable URL must also return a full page for direct visits and restoration. When `HX-Request` selects fragments, follow the documented `historyRestoreAsHxRequest: false` guidance and separate HTTP cache variants. Reconcile restored Session views before treating their state as fresh. Disable HTMX snapshot storage on sensitive Session detail pages with `hx-history="false"`; this is not a general browser-storage security control.
- **Dialogs:** open native dialogs with `showModal()`, not just the `open` attribute. Mutations use a real POST form, not `method="dialog"`. Keep the dialog open with errors until success; Cancel must remain usable despite invalid fields. Prefer initial focus on Cancel for irreversible actions.

For implementation details and primary-source links, read [the interaction research](docs/research/design-interactions.md), especially before changing response handling, focus management, or history behavior.

## Accessibility and motion

- Target WCAG 2.2 AA. Measure rendered contrast: at least 4.5:1 for normal text, 3:1 for large text, and 3:1 for relevant control boundaries/state indicators. An upstream theme is not a compliance guarantee.
- Use semantic landmarks, ordered headings, visible keyboard focus, and native links/buttons. Preserve usable focus outlines rather than hiding them for aesthetics.
- Dialogs and navigation overlays need an accessible name, predictable initial focus, Escape dismissal where appropriate, keyboard containment while modal, and focus return to the trigger.
- Use text and/or icons alongside status colors. Never convey success, danger, selection, or freshness by color alone.
- Keep hover/focus feedback subtle: color/border transitions around 150ms, without size shifts. Respect `prefers-reduced-motion`; avoid pulsing decorations and unnecessary animation.
- Support text zoom, long labels, and 320 CSS px reflow. Tooltips may supplement labels but cannot carry essential instructions.

## Acceptance checklist

For every changed screen or workflow, verify applicable items:

- [ ] Uses the shared theme, shell, components, spacing, and typography; no page-specific palette.
- [ ] Domain terms, Session state, freshness, and action eligibility match `CONTEXT.md` and backend rules.
- [ ] Works at 320, 375, 768, 1024, and 1440 CSS px; no page overflow or inaccessible mobile actions.
- [ ] Keyboard-only navigation works, focus is visible, and overlays return focus correctly.
- [ ] Labels, errors, status announcements, and contrast are checked in the rendered UI.
- [ ] Initial, loading, empty, validation-error, network-error, and success states behave correctly where applicable.
- [ ] Slow/failed/repeated requests preserve input and do not start duplicate work; stale information is identified honestly.
- [ ] HTMX swaps preserve expected focus and navigation; Back/Forward and full-page reload work for navigable views.
- [ ] Reduced motion and 200% text zoom remain usable.
- [ ] Capture or inspect representative phone and desktop renders; report any unverified checks.

## Research and sources

Researched 2026-09-05. These rules are Atlas conventions built on upstream components, not an upstream accessibility certification.

- [Theme research](docs/research/design-theme.md): comparison of `dim`, `dark`, `business`, and `night`, verified tokens, configuration, and contrast caveats.
- [Interaction research](docs/research/design-interactions.md): HTMX forms, loading, focus, history, mobile tables, and native dialogs, with official HTMX/W3C/MDN citations.
- [daisyUI configuration](https://daisyui.com/docs/config/) and [semantic colors](https://daisyui.com/docs/colors/).
- [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files) and [responsive design](https://tailwindcss.com/docs/responsive-design).
- [Heroicons](https://heroicons.com/): the selected SVG icon family.
