# Atlas interaction guidance

Research date: 2026-09-05. Input: [CONTEXT.md](../../CONTEXT.md); planned HTMX + Tailwind + daisyUI, dark only, balanced density, mobile equally important.

**Scope:** recommendations for DESIGN.md, not implemented behavior or an accessibility guarantee. HTMX evidence below is its current **2.x** documentation (installation example: 2.0.10); recheck defaults against the version Atlas pins. Context7 library resolution + documentation lookup used two commands; evidence cross-checked against official pages. WAI tutorials, APG, and WCAG Understanding documents are guidance, not themselves normative standards.

## 1. Navigation and forms

**Documented:** `hx-boost` enhances real links/forms; links push history, forms do not by default. Both replace body contents by default. HTML fallback depends on working native destinations. [H1]

**Recommend:**
- Use real `href` links for Repository, Spec, Session, and PR destinations; native forms with `action`, `method`, labels, named controls, and submit buttons for actions. Never make a clickable row the only navigation mechanism.
- Start with normal page navigation; selectively boost it only with a focus/history contract. Use small, explicit targets for inline changes; do not replace a form while somebody is editing it.
- Put search, filters, sorting, and pagination in GET URLs. Push deliberate navigations; avoid creating a history entry per keystroke. Leave background Session refreshes out of history. [H1, H2]

## 2. Validation and HTTP traps

**Documented:** HTMX blocks invalid form requests, but `reportValidityOfForms` must be enabled to restore browser validation reporting/focus. Non-form request elements do not validate by default. Default response handling does **not swap 4xx/5xx bodies**, including 422; 204 performs no content swap. HTMX response headers on 3xx redirects are not processed because the browser handles the redirect. [H2]

**Recommend:**
- Enable `reportValidityOfForms: true`; still validate all submitted data on the server.
- Adopt a single contract: server validation returns 422 plus the form fragment, retaining entered values; add a `responseHandling` rule `{ "code": "422", "swap": true, "error": false }` **before** the general `[45]..` rule. Keep other defaults; do not enable swapping every error response.
- Show a short error summary linked to fields, specific correction instructions, `aria-invalid="true"`, and error text referenced by `aria-describedby`. Focus the summary (or first invalid field for a short form) after a failed submit, not after each keystroke. Avoid also announcing the same focused summary assertively. [W1, W2]
- Handle server/connection failures visibly without discarding input. Use non-3xx responses for `HX-Redirect`/`HX-Location`; retain ordinary redirect behavior for native form fallback. Do not expect a 204 to display a success fragment. [H2]

## 3. Loading and duplicate submissions

**Documented:** HTMX adds request-indicator classes and can disable selected controls for the request duration via `hx-disabled-elt`. `hx-sync` coordinates browser requests, including aborting field validation in favor of form submission. These are client request mechanisms, not a server uniqueness guarantee. [H2]

**Recommend:**
- Show local text such as “Starting Session…” alongside a decorative spinner; disable the initiating submit control while pending. Keep the rest of the page usable. Always recover the pending UI on success, HTTP failure, and connection failure.
- Prefer submit-time validation initially. If asynchronous field validation becomes necessary, coordinate it with the enclosing form using the documented input `hx-sync="closest form:abort"` pattern. [H2]
- Enforce **one unfinished Session per Spec on the server**, atomically. Browser disabling cannot cover concurrent tabs or retries. After an ambiguous connection failure, reconcile the existing Session before offering a new start; do not claim the action failed merely because its response was lost. This is an Atlas recommendation derived from its domain invariant, not an HTMX promise. [CONTEXT.md](../../CONTEXT.md)
- Separate request loading from Session state: successful acceptance is not implementation completion. “Idle” is not completed; “Active” does not necessarily mean executing. Stale is a freshness warning alongside, not replacing, semantic state. [CONTEXT.md](../../CONTEXT.md)

## 4. Focus and announcements after swaps

**Documented:** HTMX preserves focus for inputs with stable IDs; focused-input auto-scroll is off by default. Boosted links/forms scroll to the target top by default. Scrolling is not a guarantee of appropriate focus or announcement. [H3]

**Recommend:**
- Specify focus per interaction: page navigation → new main heading (`tabindex="-1"`); invalid submit → summary/invalid field; inline success → retain control or choose its logical successor; background refresh → never steal focus.
- Keep stable input IDs. Use a small, scoped post-swap/settle handler when explicit focus is needed, not a global “focus first input after every swap” rule. Test long forms with the mobile keyboard open. [H2, H3, W1]
- Keep an initially present `role="status" aria-atomic="true"` container and update its contents with short messages (“Session queued”, “12 Specs found”). Do not replace the live-region wrapper with a newly populated wrapper and assume it will announce. Keep a status region inside a modal for messages while that modal is active. [W2, W3, W6]
- Announce meaningful state changes, not every poll or unchanged status. Reserve alerts for important errors; do not put the entire table or Session output in an assertive live region. Test actual screen-reader/browser combinations: ARIA markup is not an announcement-delivery guarantee. [W2, W3]

## 5. History, restoration, and freshness

**Documented:** history caches DOM snapshots in localStorage; cache misses require full-page HTML. Pushed URLs must work as direct full-page visits. HTMX recommends `historyRestoreAsHxRequest: false` when `HX-Request` selects fragments. `hx-history="false"` prevents HTMX snapshot storage but preserves history navigation through server requests. [H2]

**Recommend:**
- Test direct visit, reload, new tab, Back/Forward with both cache hit and cache miss. Return a full document on restoration, not a fragment inside a fragment.
- If the same URL serves full and partial HTML, distinguish cache variants with `Vary: HX-Request` (and any other representation-selecting headers), or do not cache those responses. [H2, caching section]
- Default sensitive Session-detail pages to `hx-history="false"`. This only controls HTMX snapshots, not all browser/HTTP storage.
- Never treat a restored DOM snapshot as proof a Session is still Running or a start is still permitted. Reconcile after restoration; display the Stale warning while freshness is unknown. Server checks remain authoritative. [H2; CONTEXT.md](../../CONTEXT.md)

## 6. Mobile tables and balanced density

**Documented:** WCAG reflow targets 320 CSS-pixel width for vertical content. Necessary two-dimensional tables have an exception; their cells, surrounding filters, headings, and pagination do not inherit a blanket exception. WAI recommends semantic headers and explicit `scope` for ambiguous/larger tables. [W4, W5]

**Recommend:**
- Keep real `<table>`, `<caption>`, and `<th scope="col">` markup for comparisons. Put wide tables in their own horizontally scrollable region, with a visible scrolling cue and keyboard-accessible scrolling; verify it in target browsers.
- Prioritize identity, semantic status, Stale warning, and primary action on small screens. Move secondary metadata into reachable details, not permanent hiding. Use stacked labelled lists where comparison is not important; do not add a data-grid dependency.
- Wrap long Spec titles and Repository names; do not rely on hover-only tooltips. Reflow filters and pagination outside the scroll region. Balanced density means fewer simultaneous columns, not shrinking controls and text until they fit.
- Test at 320 CSS pixels and zoom, including long content and sticky controls. Mobile must support the same actions, not merely viewing. [W4]

## 7. Accessible dialogs

**Documented:** native `<dialog>.showModal()` supplies modal behavior, inert outside content, and default Escape dismissal. Merely setting `open` creates a non-modal dialog. `method="dialog"` closes without submitting data. APG calls for a name, contained tab order, appropriate initial focus, visible close control, and focus return to the invoker or logical successor. [M1, W6]

**Recommend:**
- Use a native dialog, styled with the planned stack; no modal framework. Name it with `aria-labelledby` pointing to its heading. Use minimal browser JavaScript to open/close it.
- For irreversible actions, initially focus Cancel. For long explanatory content, focus a heading inside the dialog with `tabindex="-1"`; do not add `tabindex` to `<dialog>` itself. Preserve Escape and a visible Cancel/Close button. [M1, W6]
- Submit mutations through a normal enhanced POST form, not `method="dialog"`. Keep the dialog open on validation/server failure; close only after confirmed success. Make Cancel a non-submit button calling `close()` so invalid required fields cannot trap the user. [M1]
- Swap the form/error content inside an open dialog rather than replacing the dialog element. If the invoker disappears after a swap, explicitly focus a sensible successor. Test tab containment, focus return, mobile keyboard, and scrolling; avoid nested dialogs. [M1, W6]

## Acceptance checks before adopting in DESIGN.md

- Invalid native and enhanced submissions show useful errors; 422 swaps, unexpected 500 does not replace the form, connection failure leaves input intact.
- Double tap, Enter repeatedly, concurrent tabs, and retry after a lost response cannot create two unfinished Sessions for one Spec.
- Keyboard and screen-reader tests cover navigation, errors, success, background updates, modal failure/success, and Back/Forward.
- At narrow width, every action and full label remains reachable; status/error distinctions remain textual in the dark theme, not color-only. No claim here certifies Tailwind/daisyUI theme contrast or accessibility.

## Official sources

- **H1:** [HTMX: hx-boost](https://htmx.org/attributes/hx-boost/).
- **H2:** [HTMX documentation](https://htmx.org/docs/): validation, response handling, response headers, indicators, synchronization, history, caching, and events.
- **H3:** [HTMX: hx-swap](https://htmx.org/attributes/hx-swap/).
- **W1:** [WAI: Form user notifications](https://www.w3.org/WAI/tutorials/forms/notifications/).
- **W2:** [WCAG 2.2: Understanding status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- **W3:** [WAI technique ARIA22: role=status](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22).
- **W4:** [WCAG 2.2: Understanding reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- **W5:** [WAI: Tables with one header](https://www.w3.org/WAI/tutorials/tables/one-header/).
- **W6:** [WAI APG: Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- **M1:** [MDN: dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog).
