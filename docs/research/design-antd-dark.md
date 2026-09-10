# Ant Design dark mode and design tokens (research)

Date: 2026-09-10. Verified against antd source on `master` (installed antd 6.6.3, `@ant-design/colors` 8.0.1;
the theme algorithm files are unchanged from v5) and the ant.design docs. All hex values below were
produced by running `theme.getDesignToken({ algorithm: darkAlgorithm, token: { colorPrimary: '#012B68' } })`.

Sources
- S1 https://ant.design/docs/react/customize-theme
- S2 https://ant.design/docs/spec/dark
- S3 https://github.com/ant-design/ant-design/blob/master/components/theme/themes/dark/colors.ts
- S4 https://github.com/ant-design/ant-design/blob/master/components/theme/themes/shared/genColorMapToken.ts
- S5 https://github.com/ant-design/ant-design-colors/blob/master/src/generate.ts
- S6 https://github.com/ant-design/ant-design/blob/master/components/theme/themes/seed.ts
- S7 https://github.com/ant-design/ant-design/blob/master/components/theme/util/alias.ts
- S8 https://github.com/ant-design/ant-design/blob/master/components/theme/themes/compact/index.ts (+ genCompactSizeMapToken.ts)
- S9 https://github.com/ant-design/ant-design/blob/master/components/theme/themes/shared/genRadius.ts, genFontSizes.ts, genControlHeight.ts

## 1. Dark algorithm: neutrals

`theme.darkAlgorithm` runs the default algorithm first, then replaces every colour token (S3). Neutrals are
derived from two seeds: `colorBgBase` (default `#000`) and `colorTextBase` (default `#fff`).

- Surfaces = `colorBgBase` lightened by N% (`FastColor.lighten`): layout 0, container 8, elevated 12, spotlight 26.
- Borders = `colorBgBase` lightened: border 26, borderSecondary 19.
- Text and fills = `colorTextBase` at an alpha. Note dark `colorText` is 0.85 (light mode uses 0.88).
- Dark fills are stronger than light: 0.18 / 0.12 / 0.08 / 0.04 (light: 0.15 / 0.06 / 0.04 / 0.02).
- `colorShadow` in dark is `rgba(255,255,255,0.2)` — shadows are white and nearly invisible (see section 7).
- `colorSplit` = `colorBorderSecondary` expressed as alpha over `colorBgContainer` (S7).

Docs (S1) only state that darkAlgorithm exists and how to stack it: `algorithm: [darkAlgorithm, compactAlgorithm]`.
The exact numbers come from source (S3).

## 2. Primary colour in dark mode

### How `generate()` works (S5)
1. Build the light 10-step palette in HSV from the seed (step 6 = seed). Light steps 1-5: hue shifts 2° per step,
   saturation -0.16 per step, value +0.05 per step. Dark steps 7-10: saturation +0.05 per step, value -0.15 per step.
2. Dark theme: take specific light steps and **mix them into the background** (`#141414` default) at a percentage:

   | dark step | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
   |---|---|---|---|---|---|---|---|---|---|---|
   | light step used | 7 | 6 | 5 | 5 | 5 | 5 | 4 | 3 | 2 | 1 |
   | % colour vs bg | 15 | 25 | 30 | 45 | 65 | 85 | 90 | 95 | 97 | 98 |

   So dark step 6 (`colorPrimary`) is **light step 5 at 85%** over `#141414` — i.e. one step lighter than the seed,
   desaturated, then dimmed. The dark palette gets *lighter* as the index rises (opposite of light).
3. antd's dark `generateColorPalettes` (S3) then remaps: `1:[0] 2:[1] 3:[2] 4:[3] 5:[6] 6:[5] 7:[4] 8:[6] 9:[5] 10:[4]`
   and `genColorMapToken` (S4) assigns `Bg=1, BgHover=2, Border=3, BorderHover=4, Hover=5, base=6, Active=7,
   TextHover=8, Text=9, TextActive=10`. The dark derivative then overrides **`colorPrimaryBg = colorPrimaryBorder`**
   and `colorPrimaryBgHover = colorPrimaryBorderHover` (S3, dark/index.ts). Net, in dark mode:

   | token | dark palette index | default blue | #012B68 |
   |---|---|---|---|
   | colorPrimaryBg / colorPrimaryBorder | 3 | #15325b | #0e1b2d |
   | colorPrimaryBgHover / colorPrimaryBorderHover | 4 | #15417e | #0b1e3a |
   | colorPrimaryHover / colorPrimaryTextHover | 7 | #3c89e8 | #143a6b |
   | colorPrimary / colorPrimaryText | 6 | #1668dc | #04285b |
   | colorPrimaryActive / colorPrimaryTextActive | 5 | #1554ad | #08234b |
   | controlOutline (focus ring) | Bg @ alpha on container | rgba(23,117,249,0.31) | rgba(0,43,103,0.3) |

### Computed palettes for #012B68 (`@ant-design/colors` 8.0.1)
- Light (`generate('#012B68')`):
  `#97a1a8 #65829c #466a8f #2b5482 #143e75 #012b68 #001842 #00091c #000000 #000000`
- Dark, bg `#141414` (antd default):
  `#111215 #0f1520 #0e1b2d #0b1e3a #08234b #04285b #143a6b #2a517d #45678b #638099`
- Dark, bg `#000000`:
  `#000104 #000611 #000d1f #00132f #011c44 #012558 #123869 #29507c #44678b #637f99`

**Finding: #012B68 is too dark to be a dark-mode seed.** HSV value is only 0.41, so the light ramp bottoms out
at pure black (steps 9-10) and the light tint steps go grey (`#97a1a8`, saturation clamped to 0.10). In dark mode
`colorPrimary` becomes `#04285b`, contrast **1.28:1** against `#141414` (buttons vanish; white text on it is 14:1).
Candidate seeds computed the same way (dark colorPrimary / contrast vs #141414 / white-on-it):
- `#1E4FA0` -> `#1d468b`, 2.02, 9.13   (still navy, still fails 3:1 for UI components)
- `#3B6DB3` -> `#35609b`, 2.89, 6.37
- `#1668dc` (antd default) -> `#165bbe`, 2.87, 6.41 — antd itself only reaches ~3:1 for the button fill
- `#4096ff` -> `#3983dc`, 4.78, 3.85
Reference: antd's own dark blue uses `#1668dc` (step 6) with `#3c89e8` hover; it lets the *fill* sit near 3:1 and relies on
white label text for legibility.

## 3. Shape (S6, S9)
Seed `borderRadius: 6`, `lineWidth: 1`. `genRadius(6)` gives `borderRadiusLG 8`, `SM 4`, `XS 2`, `Outer 4`;
`lineWidthBold 2`, `lineWidthFocus 3`, `controlOutlineWidth 2` (S7).
- `borderRadius` (6): buttons, inputs, selects, tooltips (`contentRadius`), menu items in v4 style.
- `borderRadiusLG` (8): Card, Modal, Drawer, Table outer/header corners, Menu item and popup, Alert.
- `borderRadiusSM` (4): Tag, Modal close button, sub-menu items, small controls.
- `borderRadiusXS` (2): checkbox box, tiny badges/progress.
- `borderRadiusOuter` (4): popover arrow outer curve.

## 4. Density (S6, S8, S9)
Default: `sizeUnit 4`, `sizeStep 4`, `controlHeight 32` -> `SM 24` (x0.75), `XS 16` (x0.5), `LG 40` (x1.25).
Size scale = `sizeUnit * (sizeStep + k)`: XXS 4, XS 8, SM 12, MS/size 16, MD 20, LG 24, XL 32, XXL 48;
`padding*`/`margin*` mirror these. `controlPaddingHorizontal 12`, `SM 8`.

`compactAlgorithm`: `controlHeight = default - 4` (28; SM 21, XS 14, LG 35), `fontSize = fontSizeSM` (12),
`sizeStep - 2` for the size map: XXS 4, XS 4, SM 8, size 8, MS 12, MD 16, LG 16, XL 32, XXL 48; padding 8, paddingSM 8,
paddingLG 16; `paddingContentHorizontal 12`, `Vertical 8`.

Table rows (table/style/index.ts: `cellPaddingBlock = padding`, MD = `paddingSM`, SM = `paddingXS`; font `fontSize`):
- default 14px/22px line: large 16+22+16 = **54px**, middle 12+22+12 = 46px, small 8+22+8 = 38px.
- compact 12px/20px line: large 8+20+8 = **36px**, middle 36px, small 4+20+4 = 28px.
Menu item height = `controlHeightLG` (40 default / 35 compact). Tooltip min height = `controlHeight`.

## 5. Typography (S6, S9)
Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif,
'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'`.
Code: `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace`.
Sizes from `base * e^(i/5)` rounded to even: SM 12, base 14, LG 16, XL 20, H5 16, H4 20, H3 24, H2 30, H1 38.
Line height = `(fontSize + 8) / fontSize`: 14 -> 1.571 (22px), 12 -> 1.667 (20px), 16 -> 1.5 (24px), H1 1.21, H2 1.27,
H3 1.33, H4 1.4. `fontWeightStrong 600` (S7). Compact: SM 10, base 12, LG 14, XL 16, H5 14, H4 16, H3 20, H2 26, H1 32.

## 6. Semantic colours in dark mode (seeds S6, mapping S4, values computed)
Seeds: success `#52c41a`, warning `#faad14`, error `#ff4d4f`, info `#1677ff`. Each goes through the same
dark palette (Bg=1, BgHover=2, Border=3, BorderHover=4, Hover=4 for success/warning/info or 5 for error, base=6, Active=7, Text=9).

| status | base | Bg | Border | Hover | Active |
|---|---|---|---|---|---|
| success | #49aa19 | #162312 | #274916 | #306317 | #3c8618 |
| warning | #d89614 | #2b2111 | #594214 | #7c5914 | #aa7714 |
| error | #dc4446 | #2c1618 | #5b2526 | #e86e6b | #ad393a |
| info | #1668dc | #111a2c | #15325b | #15417e | #1554ad |

Contrast of base on #141414: success 6.2, warning 7.3, error 4.35, info 3.55.
Alert and Tag (bordered/colour variants) use the triad `*Bg` (fill) + `*Border` (1px line) + `*Text`/base (text and icon);
error/success/warning link `colorErrorOutline` = `colorErrorBg` as alpha over container. Selected list/menu items use
`controlItemBgActive = colorPrimaryBg` and hover `controlItemBgHover = colorFillTertiary` (S7).

## 7. Elevation (S7, S3)
`boxShadow` = `boxShadowSecondary` = `0 6px 16px 0 rgba(255,255,255,0.016), 0 3px 6px -4px rgba(255,255,255,0.024),
0 9px 28px 8px rgba(255,255,255,0.01)`; `boxShadowTertiary` (cards) = `0 1px 2px 0 …0.01, 0 1px 6px -1px …0.006,
0 2px 4px 0 …0.006`. Alphas are the light-mode alphas (0.08/0.12/0.05) multiplied by `colorShadow` alpha 0.2, so dark
shadows are effectively invisible. Elevation is carried by surface lightness instead: layout `#000` < container
`#141414` (+8%) < elevated `#1f1f1f` (+12%, Modal/Popover/Dropdown/Menu popup) < spotlight `#424242` (+26%, Tooltip).
The current spec page (S2) no longer states this rule in prose; the implementation in S3 is the citable source.

## 8. Stated dark-mode principles (S2, verbatim)
1. "Comfort of content — Avoid using highly contrasting colors or content in dark mode. Continuous use will bring fatigue."
2. "Consistency of Information — The information content in the dark mode needs to be consistent with the light mode,
   and the initialization hierarchical relationship should not be broken."
Colour: "based on 12 sets of basic swatches and combine longer rule processing to make colors better blend under
different environmental colors"; the generator asks for "your primary color and the background color of the page".
There is no numeric saturation rule on the page; the implemented rule is S5: use the *lighter, less saturated* step 5
and blend it 85% into the background, so brand colours on dark are always dimmer and greyer than the seed.

## Verified tokens (dark, defaults; colorPrimary rows use #012B68)

| token | dark value | source |
|---|---|---|
| colorBgBase / colorBgLayout | #000 / #000000 | S3 |
| colorBgContainer | #141414 | S3 |
| colorBgElevated | #1f1f1f | S3 |
| colorBgSpotlight | #424242 | S3 |
| colorFill / Secondary / Tertiary / Quaternary | rgba(255,255,255,.18/.12/.08/.04) | S3 |
| colorBorder / colorBorderSecondary | #424242 / #303030 | S3 |
| colorSplit | rgba(253,253,253,0.12) | S7 |
| colorText / Secondary / Tertiary / Quaternary | rgba(255,255,255,.85/.65/.45/.25) | S3 |
| colorPrimary / Hover / Active | #04285b / #143a6b / #08234b | S3, S4 |
| colorPrimaryBg = colorPrimaryBorder | #0e1b2d | S3 |
| colorSuccess / Warning / Error / Info | #49aa19 / #d89614 / #dc4446 / #1668dc | S4 |
| borderRadius / LG / SM / XS | 6 / 8 / 4 / 2 | S9 |
| lineWidth / Bold / Focus | 1 / 2 / 3 | S6, S7 |
| controlHeight (default / compact) | 32 / 28 | S6, S8 |
| fontSize (default / compact) | 14 / 12 | S6, S8 |
| fontWeightStrong | 600 | S7 |
| boxShadow (dark) | white, alpha 0.016/0.024/0.01 | S7 |

## Implications for Atlas (Tailwind 4 + daisyUI 5, dark only)

1. **Surfaces: copy antd's three greys, not daisyUI's defaults.** `base-100 = #141414` (container), `base-200 = #000000`
   (layout/page), `base-300 = #1f1f1f` (elevated: dropdowns, modals, toasts). daisyUI assumes base-100 is the page and
   base-200/300 are darker; invert that mentally — in antd the page is the darkest thing and panels sit on top.
2. **Borders: `--color-base-content` alpha is wrong for antd's look.** Use fixed greys: `#303030` for dividers/table
   lines (`colorBorderSecondary`) and `#424242` for control borders (`colorBorder`). Set daisyUI `--border: 1px`.
3. **Text: three opacities of white, never pure white.** `base-content = rgba(255,255,255,0.85)`; secondary text
   `/65`, placeholders/disabled `/25`, icons and descriptions `/45`. All meet 4.5:1 on #141414 except the 0.25 tier (2.25:1),
   which antd reserves for placeholders and disabled text.
4. **Do not seed `primary` with #012B68 directly.** antd's own algorithm turns it into `#04285b` (1.28:1 on the panel);
   navy filled buttons would disappear. Keep #012B68 as the *brand mark / header / sidebar* colour (its 14:1 with white text
   is excellent), and define an interactive `primary` from a lighter navy: `#1d468b` (antd-derived from #1E4FA0, hover
   `#39639e`, active `#1b3a6f`, tint `#17263e`) or, if 3:1 on fills is required, `#35609b` (from #3B6DB3). Set
   `primary-content = #ffffff`.
5. **Selected/active rows and menu items use the primary *tint*, not the primary.** antd's dark `controlItemBgActive =
   colorPrimaryBg = dark step 3` (`#17263e` for the #1E4FA0 seed). Hover = `rgba(255,255,255,0.08)` (`colorFillTertiary`).
   Map hover to daisyUI `--color-base-content/8` and active to the tint.
6. **Status colours: take antd's dark triads verbatim.** `success #49aa19`, `warning #d89614`, `error #dc4446`,
   `info #1668dc`; alert/tag surfaces `#162312 / #2b2111 / #2c1618 / #111a2c` with 1px borders `#274916 / #594214 /
   #5b2526 / #15325b`. This is the "vibrant but not luminous" effect: steps mixed 85% into #141414, never neon.
7. **Radius: `--radius-field: 0.375rem` (6px), `--radius-box: 0.5rem` (8px), `--radius-selector: 0.25rem` (4px).**
   Tags/badges at 4px, checkboxes at 2px. Cards, modals and table outer corners at 8px; everything interactive at 6px.
8. **Density: adopt compact.** `--size-field: 0.25rem` with `h-7` (28px) controls, 12px base font with 20px line height,
   `px-3` (12px) horizontal control padding, table cells `py-2 px-2` (8px) giving 36px rows; 28px rows for dense lists.
   Keep headings at 14/16/20/26 and `font-semibold` (600), never 700.
9. **Elevation by lightness, not shadow.** Drop `shadow-*` on popovers and modals; use `base-300` (#1f1f1f) plus a
   `#303030` border. Tooltips use `#424242` bg with 0.85 white text. If a shadow is wanted, it should be black at low
   alpha for depth on the page (antd's white shadow is a no-op).
10. **`neutral` = antd's `colorBgSolid`.** Use `neutral: rgba(255,255,255,0.95)` / `neutral-content: #141414` for the
    rare inverted element (solid tooltips, `btn-neutral`), and never for surfaces.
