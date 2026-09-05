# Atlas design theme research

Verified 2026-09-05 against official documentation and upstream theme source. Documentation currently displays Tailwind **4.3** and daisyUI **5.7.28**; this is a proposed setup, not a claim about installed repository dependencies. Context7 lookup was followed by direct primary-source verification.

## Recommendation: unchanged `dim`

**Design amendment:** the user subsequently selected exact navy `#012B68` as the sole primary brand color and requested Glassmorphism. `DESIGN.md` now governs an Atlas palette override of `dim`, blue-toned translucent surfaces, readable lighter blue shades, and supporting semantic colors. The stock palette, green branding, and flat-surface recommendation below are historical, not current implementation instructions. daisyUI supports [same-name theme overrides](https://daisyui.com/docs/themes/#how-to-customize-an-existing-theme), preserving unspecified component tokens.

Use **daisyUI `dim`, dark only**, with restrained accent usage. Its slate surfaces, softer foreground, rounded controls and zero depth/noise suit a calm, modern internal tool. Keep the theme's colors, radii and effects unchanged; establish density through layout and component sizes instead. This is a design judgment, not an upstream accessibility endorsement.

Atlas centers on **Repositories, Specs, Sessions and PRs**. Prioritize scanning their titles, states and next actions—not decorative dashboards. Preserve the distinctions in [CONTEXT.md](../../CONTEXT.md): **Idle is not completed**, **Active Session is not necessarily executing**, and **Stale is a separate freshness warning**.

### Built-in alternatives

All four remain present in current upstream source and declare `color-scheme: dark`. Appearance assessments below derive from those tokens; their continued inclusion does not promise a particular maintenance SLA.

| Theme/source | Verified characteristics | Tradeoff for Atlas |
| --- | --- | --- |
| [dim][dim] | Base-100 OKLCH lightness 30.857%; green primary; field radius 0.5rem, box 1rem; depth 0 | Best calm/modern balance. Bright green primary can resemble success; reserve it for the main action, and label states explicitly. |
| [dark][dark] | Base-100 25.33%; near-white foreground 97.807%; saturated violet primary/pink secondary; field 0.25rem, box 0.5rem; depth 1 | More pronounced foreground and vivid accents; less subdued without changing tokens. |
| [business][business] | Achromatic base-100 24.353%; dark blue primary 41.703%; field/box 0.25rem; selector radius 0; depth 0 | Most sober, but squarer and less soft. Dark primary is a poor candidate for small text on dark surfaces; verify actual pairings. |
| [night][night] | Navy base-100 20.768%; cyan-blue primary; field 0.5rem, box 1rem; depth 0 | Good runner-up; darker and more blue-toned, with stronger luminous-accent character. |

## Exact current configuration

Official [Tailwind CLI][cli], [daisyUI installation][install] and [theme configuration][config] establish this CSS-first setup. Example file paths are illustrative; integrate with the eventual asset pipeline.

```sh
npm install -D tailwindcss@4 @tailwindcss/cli@4 daisyui@5
npx @tailwindcss/cli -i ./src/input.css -o ./src/output.css --watch
```

```css
/* src/input.css */
@import "tailwindcss";
@plugin "daisyui" {
  themes: dim --default;
}
```

```html
<!doctype html>
<html lang="en" data-theme="dim">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="./output.css">
  </head>
  <body class="bg-base-200 text-base-content">
    <!-- Server-rendered Atlas content -->
  </body>
</html>
```

- A single theme entry enables only that theme. No light theme, switcher, system-preference branching, `dark:` duplication, custom `daisyui/theme` block or legacy JavaScript theme configuration is needed. `dim` already supplies native dark `color-scheme`. [config][config] [source][dim]
- Lock resolved dependency versions. The source links below track `master`; recheck tokens when upgrading rather than assuming permanent values.
- Tailwind scans source text, not runtime responses. Keep complete class names in server templates/state mappings, including HTMX fragments; never construct `text-${state}`. Add `@source "../actual-template-directory";` only if needed, relative to the stylesheet. [Source detection][scan]

## Verified `dim` tokens (reference, not overrides)

Exact contents of [upstream `dim.css`][dim] at lookup time:

```css
color-scheme: dark;
--color-base-100: oklch(30.857% 0.023 264.149);
--color-base-200: oklch(28.036% 0.019 264.182);
--color-base-300: oklch(26.346% 0.018 262.177);
--color-base-content: oklch(82.901% 0.031 222.959);
--color-primary: oklch(86.133% 0.141 139.549);
--color-primary-content: oklch(17.226% 0.028 139.549);
--color-secondary: oklch(73.375% 0.165 35.353);
--color-secondary-content: oklch(14.675% 0.033 35.353);
--color-accent: oklch(74.229% 0.133 311.379);
--color-accent-content: oklch(14.845% 0.026 311.379);
--color-neutral: oklch(24.731% 0.02 264.094);
--color-neutral-content: oklch(82.901% 0.031 222.959);
--color-info: oklch(86.078% 0.142 206.182);
--color-info-content: oklch(17.215% 0.028 206.182);
--color-success: oklch(86.171% 0.142 166.534);
--color-success-content: oklch(17.234% 0.028 166.534);
--color-warning: oklch(86.163% 0.142 94.818);
--color-warning-content: oklch(17.232% 0.028 94.818);
--color-error: oklch(82.418% 0.099 33.756);
--color-error-content: oklch(16.483% 0.019 33.756);
--radius-selector: 1rem;
--radius-field: 0.5rem;
--radius-box: 1rem;
--size-selector: 0.25rem;
--size-field: 0.25rem;
--border: 1px;
--depth: 0;
--noise: 0;
```

## Semantic usage and mobile density

Recommended conventions using documented [semantic colors][colors], [buttons][buttons] and [badges][badges]:

| Purpose | Classes / convention |
| --- | --- |
| Shell / content surface | `bg-base-200` / `bg-base-100`, both `text-base-content` |
| Decorative separator | `border border-base-300`; not the sole essential control boundary |
| Main action | `btn btn-primary`, e.g. **Start Session** |
| Ordinary / tertiary action | `btn` / `btn btn-ghost`; secondary action does not imply `btn-secondary` |
| Destructive action | `btn btn-error`, explicit verb and appropriate confirmation |
| Session state | Text-bearing `badge`; use `badge-info`, `badge-success`, `badge-warning`, `badge-error` only when meaning matches |
| Freshness warning | Separate `badge badge-warning` labelled **Stale**, alongside the unchanged Session state |
| Pending request | `loading loading-spinner` alongside readable loading text; not a substitute for Session state |

Use paired foregrounds: `bg-primary text-primary-content`, not white text on every colored surface. Component color modifiers supply their foreground pairing automatically. [Colors][colors]

**Mobile is the baseline:** unprefixed layout classes apply everywhere; `md:` starts at 48rem, `lg:` at 64rem. Use stacked rows and wrapping actions before expanding into desktop columns; do not hide core actions on phones. Recommended balanced-density starting point: `p-4 md:p-6`, `gap-4`, default-size buttons, readable text—not `btn-xs` everywhere. These layout choices are recommendations, supported by Tailwind's [mobile-first model][responsive], not features a theme provides automatically.

## Contrast caveats / release checks

- **No theme-wide WCAG pass is claimed.** Token inspection is not a rendered component audit. Measure actual text/background combinations and interactive states: normal text at least **4.5:1**, large text **3:1**, essential non-text control/state indicators **3:1** against adjacent colors. [WCAG text][contrast] [WCAG non-text][nontext]
- Do not assume `text-base-content/50` is readable because it appears in examples. Avoid reducing opacity on essential titles, labels or status text; verify muted metadata against every surface. Subtle base shades are not adequate evidence of visible focus or input boundaries. [Colors][colors] [WCAG][nontext]
- daisyUI explicitly warns that **neutral outline/dash buttons and badges use dark text and are for light backgrounds**. Avoid `btn-neutral btn-outline`, `btn-neutral btn-dash` and the corresponding badge combinations in Atlas. [Buttons][buttons] [Badges][badges]
- Test filled, soft, outline, hover, focus and disabled treatments individually. Use text/icons as well as color; green primary must not imply completed execution. If a treatment fails, choose another semantic treatment or an existing-token boundary rather than silently changing the theme.
- Preserve keyboard focus, readable labels and adequate touch areas; a dark theme and CSS component classes do not by themselves establish accessibility or mobile usability.

[dim]: https://raw.githubusercontent.com/saadeghi/daisyui/master/packages/daisyui/src/themes/dim.css
[dark]: https://raw.githubusercontent.com/saadeghi/daisyui/master/packages/daisyui/src/themes/dark.css
[business]: https://raw.githubusercontent.com/saadeghi/daisyui/master/packages/daisyui/src/themes/business.css
[night]: https://raw.githubusercontent.com/saadeghi/daisyui/master/packages/daisyui/src/themes/night.css
[cli]: https://tailwindcss.com/docs/installation/tailwind-cli
[install]: https://daisyui.com/docs/install/
[config]: https://daisyui.com/docs/config/
[scan]: https://tailwindcss.com/docs/detecting-classes-in-source-files
[colors]: https://daisyui.com/docs/colors/
[buttons]: https://daisyui.com/components/button/
[badges]: https://daisyui.com/components/badge/
[responsive]: https://tailwindcss.com/docs/responsive-design
[contrast]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[nontext]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
