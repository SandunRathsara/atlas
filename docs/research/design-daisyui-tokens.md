# daisyUI 5.7.28 tokens for a compact, tight-cornered, dark-only Atlas theme

Researched 2026-09-10 against the installed packages (`daisyui@5.7.28`, `tailwindcss@4.3.3`) and official docs. Formulas below were read from the compiled CSS in `node_modules/daisyui/components/*.css`, not inferred. Sources: [themes], [colors], [config], [tw-theme], and local files cited per section.

## 1. Theme variables: consumers and built-in defaults

### Color tokens (20)

`base-100/200/300`, `base-content`, `primary`, `secondary`, `accent`, `neutral`, `info`, `success`, `warning`, `error`, each non-base color with a `-content` pair. All are `--color-<name>` and generate every Tailwind color utility (`bg-`, `text-`, `border-`, `outline-`, `ring-`, `fill-`, `decoration-`, `from-/to-`) plus `/opacity` modifiers. [colors]

Consumers worth knowing (grep of `components/*.css`): `base-200` is the default `btn` background, `alert` background, `card-border` colour, and table zebra/hover row; `base-300` is used by `table` (border), `tab`, `skeleton`, `avatar`; `neutral` is used by `card-body` text colour (via `--color-neutral-content`), `link`, `progress`, `tooltip`, `steps`, `divider`; `base-100` is the `input`/`select`/`textarea`/`modal-box` background and the daisyUI `:root` background (`base/rootcolor.css`).

### Non-color tokens (8)

| Token | Consumers (component files referencing it) | dim | dark | business | night |
| --- | --- | --- | --- | --- | --- |
| `--radius-selector` | badge, checkbox, toggle, status, range, timeline, aura | 1rem | 0.5rem | 0rem | 1rem |
| `--radius-field` | button, input, select, textarea, fileinput, tab, menu items, kbd, tooltip, otp, calendar, chat, join | 0.5rem | 0.25rem | 0.25rem | 0.5rem |
| `--radius-box` | card, alert, modal-box, table, menu container, list, collapse, dock, stat, skeleton, progress, timeline, tab content | 1rem | 0.5rem | 0.25rem | 1rem |
| `--size-selector` | badge, checkbox, radio, toggle, kbd, loading, range, rating | 0.25rem | 0.25rem | 0.25rem | 0.25rem |
| `--size-field` | button, input, select, fileinput, tab, label, otp, megamenu | 0.25rem | 0.25rem | 0.25rem | 0.25rem |
| `--border` | button, input, select, textarea, badge, card-border, alert, checkbox, radio, toggle, table, tab, list, menu, join, kbd, stat, timeline | 1px | 1px | 1px | 1px |
| `--depth` | button, input, select, textarea, alert, checkbox, radio, toggle, range, tab, menu, status, otp, fileinput | 0 | 1 | 0 | 0 |
| `--noise` | button, badge, alert, checkbox, radio, toggle, menu, fileinput | 0 | 0 | 0 | 0 |

Sources: `node_modules/daisyui/theme/{dim,dark,business,night}.css`; docs describe the tokens as "border radius of selectors (checkbox, toggle, badge)", "fields (button, input, select, tab)", "boxes (card, modal, alert)". [themes]

Docs say the "preferred values" for radii are `0rem, 0.25rem, 0.5rem, 1rem, 2rem` and that `--size-*` "must be 0.25rem unless we intentionally want" other sizes (suggesting `0.21875` / `0.1875` for smaller). These are guidance only; the compiled CSS uses the variables in plain `calc()` so any length works.

### Recommended values (Ant Design parity)

Ant Design: 6px control radius, 8px container radius, 4px tag radius; 32px default control height, 28px compact. [themes] tokens map directly:

| Token | Recommended | Why |
| --- | --- | --- |
| `--radius-field` | `0.375rem` (6px) | buttons, inputs, selects, menu items |
| `--radius-box` | `0.5rem` (8px) | cards, alerts, modal, table, glass panels |
| `--radius-selector` | `0.25rem` (4px) | badges (tags) and checkboxes; radios stay circular regardless |
| `--size-field` | `0.2rem` (md = 32px) | see formula in section 4; `0.175rem` gives 28px (antd compact) |
| `--size-selector` | `0.25rem` (badge md = 24px) | keep; `0.21875rem` gives 21px badges |
| `--border` | `1px` | keep |
| `--depth` | `0` | flat; see section 5 |
| `--noise` | `0` | flat; see section 5 |

## 2. Defining a custom theme from scratch

`node_modules/daisyui/theme/index.js` shows the mechanics: `@plugin "daisyui/theme"` emits `[data-theme="<name>"]` (plus `:where(:root)` when `default: true`), spreads any `--*` tokens you pass, and only merges built-in values when `name` matches a built-in theme. A new name such as `atlas` inherits nothing, so every token must be listed.

`themes:` in `@plugin "daisyui"` is not required for a custom theme. `pluginOptionsHandler.js` silently ignores names it does not find in the built-in object, so `themes: atlas --default` is a harmless no-op. What matters: the `themes` default is `"light --default, dark --prefersdark"`, so if you omit the option, `light` is also emitted on `:where(:root)` and `dark` under `prefers-color-scheme`. Set `themes: false` to "disable all default themes when adding custom themes". [config]

```css
@import "tailwindcss";

@plugin "daisyui" {
  themes: false;          /* no built-ins; atlas is the only theme */
}

@plugin "daisyui/theme" {
  name: "atlas";
  default: true;          /* emits :where(:root) so no data-theme is needed */
  color-scheme: dark;     /* native form controls and scrollbars go dark */
  --color-base-100: #TBD;
  /* ...all 20 colors... */
  --radius-selector: 0.25rem;
  --radius-field: 0.375rem;
  --radius-box: 0.5rem;
  --size-selector: 0.25rem;
  --size-field: 0.2rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}
```

Keep `<html data-theme="atlas">` in `src/views.ts` line 41 (currently `dim`) so the explicit selector matches too. `prefersdark` is unnecessary for a dark-only app.

## 3. How `btn-primary` computes hover and active

From `components/button.css` (5.7.28):

- `.btn-primary { --btn-color: var(--color-primary); --btn-fg: var(--color-primary-content) }` – it only sets the source colour.
- Rest: `--btn-bg: var(--btn-color)`; `--btn-border: color-mix(in oklab, var(--btn-color), #000 calc(var(--depth) * 5%))` – with `--depth: 0` the border equals the fill.
- Hover (inside `@media (hover:hover)`): `--btn-bg: color-mix(in oklab, var(--btn-color), #000 7%)` – 7% toward black.
- Active: `--btn-bg: color-mix(in oklab, var(--btn-color), #000 5%)` plus `translate: 0 .5px`.
- Shadows: `--btn-shadow` and `--btn-inset` are multiplied by `--depth`, so they vanish at 0. `text-shadow` likewise.
- Disabled: text at 20% `base-content`, transparent bg/border.

Consequence for `#012B68`: hover darkens an already very dark navy by 7% (oklab L ~ 0.30 to ~0.28). On `base-100`/`base-200` surfaces that change is nearly invisible, so hover feedback effectively disappears. Override by lightening instead. daisyUI's rules live in `@layer utilities { @layer daisyui.l1.l2.l3 {...} }`; an unlayered rule inside `@layer utilities` wins regardless of specificity (this is how the existing `.btn { height: auto }` override already works):

```css
@layer utilities {
  @media (hover: hover) {
    .btn-primary:hover { --btn-bg: color-mix(in oklab, var(--color-primary), #fff 10%); }
  }
  .btn-primary:active:not(.btn-active) { --btn-bg: color-mix(in oklab, var(--color-primary), #fff 6%); }
}
```

`--btn-border` follows `--btn-bg` on hover automatically. `btn-ghost`, `btn-soft`, `btn-outline` use `--btn-color` as text colour, so a `#012B68` primary would be unreadable in those variants; keep them neutral (DESIGN.md already says this).

## 4. Sizes in px at default and compact `--size-field`

Formula (button.css, input.css, select.css): `--size: calc(var(--size-field) * N)` where N = 6/8/10/12/14 for xs/sm/md/lg/xl. `input` and `select` use the same N via `--in-size-mul` / `--sl-size-mul`. Height is `height: var(--size)`; font-size is fixed per size (xs 11px, sm 12px, md 14px, lg 18px, xl 22px) and inputs use `max(var(--font-size), 0.875rem)` so md inputs stay 14px.

| Size | N | `--size-field: 0.25rem` | `0.2rem` (recommended) | `0.175rem` (antd compact) |
| --- | --- | --- | --- | --- |
| xs | 6 | 24px | 19.2px | 16.8px |
| sm | 8 | 32px | 25.6px | 22.4px |
| md | 10 | 40px | 32px | 28px |
| lg | 12 | 48px | 38.4px | 33.6px |
| xl | 14 | 56px | 44.8px | 39.2px |

Two ways to reach 32px controls: (a) keep `0.25rem` and use `btn-sm`/`input-sm` everywhere (font drops to 12px, below DESIGN.md's 14/16px rule); (b) set `--size-field: 0.2rem` so plain `btn`/`input` are 32px with 14px text. Option (b) is recommended. Note `--btn-p` (horizontal padding) is 1rem for md and does not scale with `--size-field`; override with `--btn-p: 0.75rem` if needed.

Badges/selectors (`badge.css`, `checkbox.css`): `--size: calc(var(--size-selector) * N)` with N = 4/5/6/7/8 for xs..xl; at `0.25rem` that is 16/20/24/28/32px. Badge padding-inline is `calc(var(--size)/2 - var(--border))`; font 10/12/14/16/18px. Checkbox, radio, toggle are `--size-selector * 6` = 24px.

Table (`table.css`): th/td padding-block/inline and body font: `table-xs` 4px/8px 11px; `table-sm` 8px/12px 12px; `table-md` (default) 12px/16px 14px; `table-lg` 16px/20px 18px. Table corners use `--radius-box`. Compact rows: `table table-sm` for 12px text or, to keep 14px text with 8px rows, add `@layer utilities { .table-compact :where(th,td){ padding-block:.5rem; padding-inline:.75rem } }`. Row hover needs `tr.row-hover` in v5 (no automatic hover).

Cards: `card-body` padding is 24px default; `card-sm` 16px, `card-xs` 8px. Alerts: 12px/16px padding, 14px text. `modal-box` padding 24px.

Conflict to resolve: DESIGN.md requires 44px touch targets and `src/views.ts` puts `min-h-11` on 34 of 35 buttons, and `src/styles.css` sets `.btn { height: auto }`. Any density change must decide whether 44px stays global or moves to `@media (pointer: coarse)`.

## 5. `--depth` and `--noise`

Every effect is multiplied by the token, so `0` removes it entirely (grep in `components/*.css`):

- `--depth`: `btn` outer shadow (`* 30%`), inset highlight (`* 6%`), text-shadow (`* .15`), border darkening (`* 5%`); `input`/`select`/`textarea` inset line (`* 10%`); `alert` inset+drop shadows; `checkbox`/`radio`/`toggle` inset; `menu` active shadow `calc(var(--depth) * 3px)`; `status` radial highlight (`* .5`). Docs: "only 0 or 1 - Adds a shadow and subtle 3D depth effect". [themes]
- `--noise`: `background-size: auto, calc(var(--noise) * 100%)` on btn, badge, checkbox, radio, toggle, menu; `* 33%` on alert. The texture itself is `--fx-noise` (an SVG data URL set on `:root` in `base/svg.css`). At `0` the image is sized to 0% and invisible; the current `:root { --fx-noise: none }` in `styles.css` is redundant once `--noise: 0` but harmless.

For a flat Claude/antd look set both to `0` (dim, business and night already do; dark uses depth 1). Keep the one shared elevation shadow on the glass panel only.

## 6. Extra colours and fonts via Tailwind `@theme`

`@theme { --color-muted: #TBD; }` creates `bg-muted`, `text-muted`, `border-muted`, `outline-muted`, `decoration-muted`, `ring-muted`, etc. and supports `/50` opacity. This is already how `brand-readable`, `muted`, `control-border` work in `src/styles.css`. Use `@theme` rather than `:root` because only `@theme` generates utilities; use `@theme inline` when the value references another variable, e.g. `--color-muted: var(--atlas-muted)`, otherwise resolution happens at `:root` and can miss theme-scoped values. [tw-theme] For a single dark-only theme, literal hex values in `@theme` are simplest. The daisyUI theme plugin will also pass unknown `--color-*` tokens through into the `[data-theme]` block, but Tailwind will not create utilities for them unless they are also in `@theme`.

Fonts: `@theme { --font-sans: ...; --font-mono: ...; }` redefines `font-sans`/`font-mono`. Tailwind 4 sets `--default-font-family: --theme(--font-sans)` (`node_modules/tailwindcss/theme.css` line 494), and daisyUI's reset uses `var(--default-font-family)`, so overriding `--font-sans` restyles `html` automatically. Recommended system stacks (no web font, per DESIGN.md):

```css
@theme {
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
```

Observation: `styles.css` sets `:root { --spacing: 4px }`. Tailwind's default is `0.25rem`; the px value stops spacing from scaling with user font-size. Recommend deleting it.

## 7. Glass in daisyUI 5 and a restrained glass header

daisyUI 5.7.28 still ships a `glass` utility (`node_modules/daisyui/utilities/glass.css`): 40px blur, a white 30% gradient, white inset ring, text-shadow, `border: none`. It is tuned for light backdrops and far frostier than DESIGN.md's 60%/4px recipe, so do not use it. Keep the custom `atlas-glass` class. Utility-only equivalent, if a class is not wanted:

```html
<header class="border-b border-base-content/16 bg-base-100 supports-[backdrop-filter]:bg-base-100/70 supports-[backdrop-filter]:backdrop-blur-sm">
```

`backdrop-blur-sm` is 8px in Tailwind 4 (`backdrop-blur-xs` is 4px). The appropriate guard is `@supports (backdrop-filter: blur(4px))` (or the `supports-[backdrop-filter]:` variant), with `@media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)` restoring opaque `base-100`, exactly as `styles.css` already does. Blur must not be nested and should stay off table rows.

## 8. Custom classes used by `src/views.ts`

Counts from `class="..."` attributes only (`status`/`filter` hits are JS variables, not classes):

| Class | Uses | Source | Keep/replace |
| --- | --- | --- | --- |
| `text-muted` | 144 | `@theme --color-muted` | keep, retune value |
| `border-control-border` | 40 | `@theme --color-control-border` | keep |
| `text-brand-readable` / `border-brand-readable` / `decoration-brand-readable/50` / `outline-brand-readable` | 24 / 8 / 6 / 1 | `@theme --color-brand-readable` | keep; `:focus-visible` outline also uses it |
| `atlas-glass` | 17 | `@layer components` + `@supports` | keep as the single glass recipe |
| `htmx-indicator` | 8 | `@layer components` | keep |
| `atlas-skip-link` | 1 | `@layer components`, hard-codes `border-radius: .75rem` | change to `var(--radius-field)` |
| `atlas-backdrop` | 1 | `@layer utilities` radial wash | keep or drop for flat look |
| `rounded-box` / `rounded-field` | 53 / 25 | daisyUI radius utilities | keep; they follow the new tokens |
| `min-h-11` | 50 | Tailwind | conflicts with 32px density (section 4) |
| `input-bordered`, `textarea-bordered` | 2 / 1 | v4 leftovers, no-ops in v5 | remove |
| `shadow-xl` | 1 | Tailwind | review for flat look |

daisyUI components actually used: `btn` (+`btn-primary`, `btn-ghost`, `btn-error`), `badge` (+`warning/info/success/neutral`), `alert` (+`warning/error/info/success`), `input`, `textarea`, `radio` (+`radio-primary`, which `styles.css` re-colours via `--input-color`), `label`, `fieldset`, `join`/`join-item`, `link`/`link-hover`. No `card`, `table`, `modal`, `drawer`, `menu`, `navbar`, `select` yet, so their token changes carry no migration cost.

## Recommended `styles.css` theme block

```css
@import "tailwindcss";

@plugin "daisyui" {
  themes: false;
}

@plugin "daisyui/theme" {
  name: "atlas";
  default: true;
  color-scheme: dark;

  --color-base-100: #TBD;          /* panel */
  --color-base-200: #TBD;          /* app background */
  --color-base-300: #TBD;          /* deep surface / table borders */
  --color-base-content: #TBD;      /* main text */
  --color-primary: #012B68;        /* fixed brand fill */
  --color-primary-content: #TBD;
  --color-secondary: #012B68;      /* alias, not a separate hierarchy */
  --color-secondary-content: #TBD;
  --color-accent: #012B68;         /* alias */
  --color-accent-content: #TBD;
  --color-neutral: #TBD;
  --color-neutral-content: #TBD;
  --color-info: #TBD;
  --color-info-content: #TBD;
  --color-success: #TBD;
  --color-success-content: #TBD;
  --color-warning: #TBD;
  --color-warning-content: #TBD;
  --color-error: #TBD;
  --color-error-content: #TBD;

  --radius-selector: 0.25rem;      /* 4px badges/checkboxes (antd tag) */
  --radius-field: 0.375rem;        /* 6px buttons/inputs (antd control) */
  --radius-box: 0.5rem;            /* 8px cards/alerts/modals (antd container) */
  --size-selector: 0.25rem;        /* badge md 24px, checkbox 24px */
  --size-field: 0.2rem;            /* btn/input md 32px; 0.175rem for 28px compact */
  --border: 1px;
  --depth: 0;                      /* flat: no shadows, insets, text-shadow */
  --noise: 0;                      /* no grain */
}

@theme {
  --color-brand-readable: #TBD;
  --color-muted: #TBD;
  --color-control-border: #TBD;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

@layer utilities {
  @media (hover: hover) {
    .btn-primary:hover { --btn-bg: color-mix(in oklab, var(--color-primary), #fff 10%); }
  }
  .btn-primary:active:not(.btn-active) { --btn-bg: color-mix(in oklab, var(--color-primary), #fff 6%); }
  .table-compact :where(th, td) { padding-block: 0.5rem; padding-inline: 0.75rem; }
}
```

Then set `data-theme="atlas"` in `src/views.ts`, drop `:root { --fx-noise: none; --spacing: 4px }`, change `.atlas-skip-link` radius to `var(--radius-field)`, remove `input-bordered`/`textarea-bordered`, and decide the 44px-target policy before shipping 32px controls.

[themes]: https://daisyui.com/docs/themes/
[colors]: https://daisyui.com/docs/colors/
[config]: https://daisyui.com/docs/config/
[tw-theme]: https://tailwindcss.com/docs/theme
