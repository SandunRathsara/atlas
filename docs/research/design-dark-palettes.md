# Dark palettes for Atlas: "vibrant but not luminous" around #012B68

Researched 2026-09-10. All OKLCH values and WCAG 2.x ratios computed with `culori` (script in `/tmp/palette`).
Brand `#012B68` measures **OKLCH L 0.31 C 0.116 H 259** (hue 259, not 262; all derived navies use H 259).

Why the current theme reads "dull / same blue": the backgrounds `#0B1628 / #132238 / #08101E` sit at
**C 0.032-0.047** (3x the chroma reference systems use for neutrals) at almost the same hue as the brand,
so brand, surfaces, and borders all collapse into one blue. Nothing warm or neutral exists for the eye to rest on.

## Part 1. Reference systems

### GitHub Primer, `dark` theme
Source: `@primer/primitives` `dist/css/functional/themes/dark.css` (npm, current) and https://primer.style/foundations/color.

| Token | Hex | OKLCH |
|---|---|---|
| bgColor-inset | #010409 | L0.13 |
| bgColor-default (canvas.default) | #0d1117 | L0.18 C0.014 H258 |
| bgColor-muted (canvas.subtle) | #151b23 | L0.22 C0.018 H256 |
| bgColor-emphasis / borderColor-default | #3d444d | L0.38 C0.018 H255 |
| borderColor-muted | #3d444db3 (70% alpha) | |
| borderColor-emphasis | #656c76 | |
| fgColor-default | #f0f6fc | L0.97 C0.010 |
| fgColor-muted | #9198a1 | L0.68 C0.016 |
| fgColor-accent (link) | #4493f8 (older releases: #58a6ff) | L0.66 C0.169 / L0.72 C0.152 |
| bgColor-accent-emphasis | #1f6feb | |
| fgColor-success / bgColor-success-emphasis | #3fb950 / #238636 | fill L0.55 C0.147 |
| fgColor-danger / bgColor-danger-emphasis | #f85149 / #da3633 | |
| fgColor-attention / bgColor-attention-emphasis | #d29922 / #9e6a03 | |
| button-primary-bgColor-rest / hover | #238636 / #29903b | primary button is green, not brand blue |
| *-muted backgrounds | fg colour at 10-15% alpha (e.g. #388bfd1a) | |

### Vercel Geist, dark
Source: https://vercel.com/geist/colors (values via the `geist-colors` npm mirror of the site CSS).

| Token | Value |
|---|---|
| background-100 / 200 | #0a0a0a / #000 |
| gray 100-400 (component bg) | hsl 0 0% 10/12/16/18% = #1a1a1a #1f1f1f #292929 #2e2e2e |
| gray 500-600 (borders) | 27% #454545, 53% #878787 |
| gray 700-800 (high-contrast bg) | 56% #8f8f8f, 49% #7d7d7d |
| gray 900 / 1000 (text) | 63% #a1a1a1, 93% #ededed |
| gray-alpha 100-400 | white at 6 / 9 / 13 / 14% |
| blue 100-300 (bg) | oklch(22% 0.069 260), (25% 0.081 256), (31% 0.102 255) |
| blue 600-800 (solid) | oklch(65% 0.198 252), (58% 0.232 258), (52% 0.231 258) |
| blue 900 (text) | oklch(72% 0.165 251) = hsl(210 100% 66%) |
| amber 600 / 900 | oklch(75% 0.174 74) / oklch(77% 0.199 64) |
| teal 600 / 900 | oklch(61% 0.149 180) / oklch(75% 0.177 183) |
| red 600 / 900 | oklch(63% 0.228 23) / oklch(70% 0.214 22) |
| green 600 / 900 | oklch(58% 0.182 147) / oklch(73% 0.216 148) |

Rules stated on the page: 100-300 component backgrounds, 400-600 borders, 700-800 high-contrast backgrounds, 900-1000 text/icons. Neutral gray is chroma 0 (pure).

### Radix Colors, dark scales
Source: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale and `src/dark.ts`.
Steps: 1-2 app/subtle bg, 3-5 component bg (rest/hover/active), 6-8 borders (subtle/interactive/strong+focus), 9-10 solid, 11-12 text. Steps 11/12 guarantee APCA Lc 60 / Lc 90 on step 2.

| Scale | 1 | 2 | 3 | 6 | 7 | 8 | 9 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|
| slateDark | #111113 | #18191b | #212225 | #363a3f | #43484e | #5a6169 | #696e77 | #b0b4ba | #edeef0 |
| grayDark | #111111 | #191919 | #222222 | #3a3a3a | #484848 | #606060 | #6e6e6e | #b4b4b4 | #eeeeee |
| blueDark | #0d1520 | #111927 | #0d2847 | #104d87 | #205d9e | #2870bd | #0090ff | #70b8ff | #c2e6ff |
| indigoDark | #11131f | #141726 | #182449 | #304384 | #3a4f97 | #435db1 | #3e63dd | #9eb1ff | #d6e1ff |
| amberDark | #16120c | #1d180f | #302008 | #5c3d05 | #714f19 | #8f6424 | #ffc53d | #ffca16 | #ffe7b3 |
| tealDark | #0d1514 | #111c1b | #0d2d2a | #145750 | #1c6961 | #207e73 | #12a594 | #0bd8b6 | #adf0dd |
| greenDark | #0e1512 | #121b17 | #132d21 | #20573e | #28684a | #2f7c57 | #30a46c | #3dd68c | #b1f1cb |
| redDark | #191111 | #201314 | #3b1219 | #72232d | #8c333a | #b54548 | #e5484d | #ff9592 | #ffd1d9 |

slateDark in OKLCH: step1 L0.18 C0.004, step2 L0.21, step3 L0.25, step6 L0.35 C0.010, step11 L0.77, step12 L0.95.
blueDark step 11 (#70b8ff) = L0.76 C0.126 H249; indigoDark 11 (#9eb1ff) = L0.78 C0.114.

### Linear app, dark
Source: community token dumps of the Linear CSS (https://designmd.cc/benchmarks/linear, https://design.hagicode.com/designs/linear.app/DESIGN.md). Linear does not publish an official palette.

| Role | Hex | OKLCH |
|---|---|---|
| marketing bg / panel / elevated / hover | #08090a / #0f1011 / #191a1b / #28282c | L0.14 / 0.17 / 0.22 / 0.28, C ≤0.007 |
| text primary / secondary / tertiary / quaternary | #f7f8f8 / #d0d6e0 / #8a8f98 / #62666d | L0.98 / 0.87 / 0.65 / 0.50 |
| borders | rgba(255,255,255,.05) subtle, .08 standard; solids #23252a #34343a #3e3e44 | |
| brand fill / accent / accent hover | #5e6ad2 / #7170ff / #828fff | L0.57 C0.159 / L0.69 C0.164 |
| radius | 8px cards, 6px controls | |

### Tailwind v4 dark neutrals (theme.css)
slate 800/900/950 = oklch(27.9% 0.041 260) / (20.8% 0.042 266) / (12.9% 0.042 265). zinc 800/900/950 = (27.4% 0.006 286) / (21% 0.006) / (14.1% 0.005). neutral 800/900/950 = 26.9% / 20.5% / 14.5%, C 0. gray 900 = (21% 0.034 265).
Note: Tailwind **slate** is the closest match to the current Atlas backgrounds (C 0.04) and is the most "blue-washed" of the neutral scales; zinc/neutral are what Linear, Geist, Radix slate actually use.

### Ant Design 5, `darkAlgorithm` (values from `antd` package)
colorBgLayout #000, colorBgContainer #141414 (L0.19), colorBgElevated #1f1f1f (L0.24), colorBorder #424242 (L0.38), colorBorderSecondary #303030;
text = white at 85 / 65 / 45 / 25% alpha; colorPrimary #1668dc (L0.54 C0.19), hover #3c89e8; success #49aa19, warning #d89614, error #dc4446;
borderRadius 6 (LG 8, SM 4); controlHeight 32, compact 28 with 12px font.

### Claude desktop dark (reference the user likes)
bg #1F1E1D (L0.24 C0.002 H68), panel #262624 (L0.27 C0.004), raised #30302E (L0.31 C0.004); accent #D97757 (L0.67 C0.131 H39). Pure warm neutrals, one warm accent, no blue.

### Shared rules (all six systems agree)
1. **Neutral backgrounds are near-black, chroma 0.00-0.02.** Primer 0.014-0.018, Radix slate 0.004-0.010, Linear ≤0.007, Geist/Ant 0, Claude 0.002-0.004. The current Atlas 0.03-0.05 is outside every reference.
2. **Elevation = +0.03 to +0.05 L per step**, 3-4 steps (Linear 0.14→0.17→0.22→0.28; Primer 0.13→0.18→0.22; Radix 0.18→0.21→0.25).
3. **Borders are ~0.10-0.15 L above their surface** (Primer #3d444d on #151b23 = +0.16 L; Radix step 6 = +0.14 over step 2), often expressed as white at 5-14% alpha. Only "strong"/focus borders reach 3:1.
4. **Brand as text/icon lives at L 0.66-0.78, C 0.11-0.17** (Primer #4493f8/#58a6ff, Radix blue 11 #70b8ff, indigo 11 #9eb1ff, Linear #828fff, Geist blue-900). Nobody uses the raw dark brand as link text.
5. **Solid brand fills sit at L 0.52-0.65** (Primer #1f6feb, Radix step 9, Ant #1668dc, Linear #5e6ad2) with white content. A brand at L 0.31 is darker than every reference fill.
6. **Semantic colours share one lightness band**: text variants L ~0.70-0.78, fills L ~0.52-0.63, chroma 0.13-0.20 (Primer, Geist 600/900). Dark content on amber/yellow, white on the rest.
7. **Text is three tiers** ≈ L 0.95-0.98 / 0.65-0.77 / 0.50-0.55, or white at 85-93 / 45-65 / 25-45% alpha.
8. **Radius is small**: Linear 6-8px, Ant 6px, Primer 6px. 12px fields / 20px cards is the largest single contributor to "made for children".

## Part 2. Candidates for #012B68

Shared across A/B/C (same for all three, computed once):

| Token | Hex | OKLCH | Notes |
|---|---|---|---|
| primary (solid btn) | #012b68 | L0.31 C0.116 H259 | brand, unchanged |
| primary-hover | #113d7e | L0.37 C0.120 | +0.06 L |
| primary-content | #eef2f9 | L0.96 | **12.09:1** on primary |
| primary-readable (links, icons, focus text) | #83aff3 | L0.75 C0.110 H259 | navy-800 of the ladder |
| primary-readable-hover | #a1c6ff | L0.82 C0.090 | |
| primary-ring (1px border on primary btn, focus ring) | #436cab | L0.53 C0.110 H259 | see "3:1 problem" below |
| success text / fill / content | #69c27e / #0a7e3a / #f1f7f2 | L0.74 / 0.52 / 0.97, H150 | content on fill 4.76 |
| warning text / fill / content | #eba941 / #c98000 / #1a0f03 | L0.78 / 0.66 / 0.18, H70-75 | dark content, 5.90 |
| error text / fill / content | #f47b74 / #c53637 / #fcf3f2 | L0.72 / 0.55 / 0.97, H25 | content on fill 4.86 |
| info text / fill / content | #5abbe6 / #007bab / #eff6fb | L0.75 / 0.55 / 0.97, H230-235 | content on fill 4.35; info is cyan-shifted so it is not "another navy" |

**The 3:1 problem.** `#012B68` against any near-black surface is 1.2-1.4:1 (A 1.36, B 1.22, C 1.41 on base-200). A primary button
will look like a slightly bluish hole. WCAG 1.4.11 wants 3:1 for control boundaries. Fixes, in order of preference:
1. **1px ring** `#436cab` (primary-ring): 3.49:1 on A base-200, 3.14 on B, 3.61 on C. Keeps the exact brand fill. This is what C is designed around.
2. **Use the fill on a lighter surface**: only a surface at L ≥0.60 (#7c8088-ish) reaches 3:1, i.e. never on a dark theme. Not viable.
3. **Use navy-600 `#4f7dc3` (L0.59) as the primary fill** and keep #012B68 for brand marks/headers only; white content 4.16:1, fill 4.4:1 on bg. This is what Primer/Ant/Linear do (fill at L 0.52-0.65). Recommended if the brand owner accepts a "lightened" navy for buttons.

### Candidate A. Navy-tinted graphite
Hue 259, chroma 0.012 (Primer-level tint). Warm amber accent as the complement to navy.

| Token | Hex | OKLCH | vs base-200 | vs base-100 |
|---|---|---|---|---|
| base-300 (sunken/inset) | #080b10 | L0.15 C0.012 | 1.07 | |
| base-200 (app bg) | #111419 | L0.19 C0.011 | 1.00 | |
| base-100 (card/panel) | #1a1d23 | L0.23 C0.012 | 1.09 | 1.00 |
| base-50 (hover/raised) | #23272c | L0.27 C0.011 | 1.23 | 1.12 |
| border-subtle | #2b3139 | L0.31 C0.017 | 1.41 | 1.29 |
| border-strong (inputs, 3:1) | #666c76 | L0.53 C0.017 | 3.49 | 3.19 |
| text-primary | #eceff3 | L0.95 | 16.0 | 14.6 |
| text-secondary | #a0a5ac | L0.72 | 7.45 | 6.81 |
| text-tertiary | #6d7279 | L0.55 | 3.81 | 3.48 |
| primary | #012b68 | | 1.36 | 1.24 |
| primary-ring | #436cab | | 3.49 | 3.19 |
| primary-readable | #83aff3 | | 8.25 | 7.55 |
| primary-muted-bg (selected row) | #192941 | L0.28 C0.05 | 1.26 | 1.15 |
| accent | #e19d63 | L0.75 C0.110 H60 | 8.09 | 7.40 |
| accent-hover | #f9a870 | L0.80 | 9.55 | 8.73 |
| accent-content | #211208 | L0.20 | (7.97 on accent) | |
| accent-muted-bg | #382315 | L0.28 C0.04 | 1.25 | 1.14 |
| success/warning/error/info text | #69c27e / #eba941 / #f47b74 / #5abbe6 | | 8.45 / 9.04 / 6.97 / 8.51 | |
| success/warning/error/info fill | #0a7e3a / #c98000 / #c53637 / #007bab | | 3.57 / 5.77 / 3.48 / 3.89 | |

### Candidate B. Warm charcoal (Claude-like)
Hue 70, chroma 0.006. Backgrounds are Claude's; navy becomes the one cool colour, terracotta the accent.

| Token | Hex | OKLCH | vs base-200 | vs base-100 |
|---|---|---|---|---|
| base-300 (sunken/inset) | #161311 | L0.19 C0.006 | 1.11 | |
| base-200 (app bg) | #201e1b | L0.24 C0.006 H78 | 1.00 | |
| base-100 (card/panel) | #282623 | L0.27 C0.006 | 1.10 | 1.00 |
| base-50 (hover/raised) | #32302d | L0.31 C0.006 | 1.26 | 1.15 |
| border-subtle | #3e3a34 | L0.35 C0.012 | 1.47 | 1.34 |
| border-strong (inputs, 3:1) | #79736e | L0.56 C0.011 | 3.56 | 3.23 |
| text-primary | #f1eeea | L0.95 | 14.4 | 13.1 |
| text-secondary | #aaa39d | L0.72 | 6.68 | 6.06 |
| text-tertiary | #76706a | L0.55 | 3.40 | 3.09 |
| primary | #012b68 | | 1.22 | 1.11 |
| primary-ring | #4c74b4 | L0.56 C0.110 | 3.53 | 3.21 |
| primary-readable | #83aff3 | | 7.40 | 6.75 |
| primary-muted-bg (selected row) | #23334c | L0.32 C0.05 | 1.31 | 1.19 |
| accent | #e2805e | L0.70 C0.130 H40 | 5.93 | 5.38 |
| accent-hover | #ee9373 | L0.75 | 7.17 | 6.51 |
| accent-content | #2a1208 | L0.20 | (6.30 on accent; white is only 2.81) | |
| accent-muted-bg | #3f271e | L0.30 C0.04 | 1.20 | 1.09 |
| success/warning/error/info text | #69c27e / #eba941 / #f47b74 / #5abbe6 | | 7.62 / 8.14 / 6.28 / 7.67 | |
| success/warning/error/info fill | #0a7e3a / #c98000 / #c53637 / #007bab | | 3.21 / 5.20 / 3.13 / 3.50 | fills fall to 2.8-2.9 vs base-100; add a 1px ring or use them only on base-200 |

Note: Claude's own #D97757 with white text is 3.12:1 (UI-component level only). Dark content is safer.

### Candidate C. Deep navy, higher contrast
Hue 259, chroma 0.025 (half the current tint, still clearly navy). Primary button ships with the ring. Accent pick: **amber**, because
teal-on-navy is still cool-on-cool and repeats the "same blue all along" complaint; teal values are listed as the alternative.

| Token | Hex | OKLCH | vs base-200 | vs base-100 |
|---|---|---|---|---|
| base-300 (sunken/inset) | #030711 | L0.13 C0.025 | 1.06 | |
| base-200 (app bg) | #09101a | L0.17 C0.024 | 1.00 | |
| base-100 (card/panel) | #141b26 | L0.22 C0.024 | 1.10 | 1.00 |
| base-50 (hover/raised) | #1f2733 | L0.27 C0.025 | 1.27 | 1.15 |
| sidebar/nav (optional navy wash) | #131f32 | L0.24 C0.041 | 1.15 | |
| border-subtle | #252e3d | L0.30 C0.030 | 1.40 | 1.27 |
| border-strong (inputs, 3:1) | #616d7e | L0.53 C0.031 | 3.63 | 3.29 |
| text-primary | #eceff3 | L0.95 | 16.5 | 15.0 |
| text-secondary | #a0a5ac | L0.72 | 7.70 | 6.98 |
| text-tertiary | #6d7279 | L0.55 | 3.94 | 3.57 |
| primary (+1px primary-ring, always) | #012b68 | | 1.41 | 1.27 |
| primary-ring | #436cab | | 3.61 | 3.27 |
| primary-readable | #83aff3 | | 8.55 | 7.75 |
| primary-muted-bg (selected row) | #17273f | L0.27 C0.05 | 1.27 | 1.15 |
| accent (pick: amber) | #e19d63 | L0.75 C0.110 H60 | 8.4 | 7.6 |
| accent-hover | #f9a870 | L0.80 | 9.9 | 9.0 |
| accent-content | #211208 | | (7.97 on accent) | |
| accent-muted-bg | #382315 | | 1.3 | 1.2 |
| alt accent (teal) / hover / content | #47c7c7 / #69d5d5 / #001616 | L0.76 C0.110 H195 | 9.32 / 10.97 | 8.45 (content on accent 9.11) |
| success/warning/error/info text | #69c27e / #eba941 / #f47b74 / #5abbe6 | | 8.74 / 9.34 / 7.21 / 8.80 | |
| success/warning/error/info fill | #0a7e3a / #c98000 / #c53637 / #007bab | | 3.69 / 5.97 / 3.60 / 4.02 | |

### 10-step navy ladder (H 259, C 0.12, L 0.20 to 0.90)
Contrast columns: vs A base-200 `#111419`, and vs white.

| Step | Hex | OKLCH | on dark bg | vs white | Use |
|---|---|---|---|---|---|
| navy-100 | #001338 | L0.20 C0.078 | 1.01 | 18.3 | tinted sunken bg |
| navy-200 | #00245c | L0.28 C0.108 | 1.24 | 14.9 | selected-row wash (C ≈0.05 version preferred) |
| navy-300 | #0d3979 | L0.36 C0.119 | 1.65 | 11.2 | primary-hover (brand #012b68 sits between 200 and 300) |
| navy-400 | #244f91 | L0.43 C0.119 | 2.29 | 8.07 | pressed/active fill |
| navy-500 | #3965aa | L0.51 C0.120 | 3.18 | 5.81 | primary-ring, focus ring (3:1 on bg) |
| navy-600 | #4f7dc3 | L0.59 C0.119 | 4.44 | 4.16 | alt primary fill with white text (Primer/Ant zone) |
| navy-700 | #6695dd | L0.67 C0.119 | 6.07 | 3.04 | icons, secondary links |
| navy-800 | #7dadf8 | L0.74 C0.121 | 8.09 | 2.28 | primary-readable (links, active nav) |
| navy-900 | #a2c7ff | L0.82 C0.089 | 10.7 | 1.73 | link hover, headings on navy fills |
| navy-1000 | #cbdfff | L0.90 C0.049 | 13.7 | 1.35 | text on #012b68 when white is too harsh |

## Part 3. Recommendation

**Pick A (navy-tinted graphite), with C's mandatory ring on the primary button and B's radius/warmth lessons.**

1. It matches the systems the user likes: Claude and Ant use chroma-0 neutrals; A is Primer's exact tint level (C 0.012), so it reads "dark tool", not "blue app".
2. Navy stays the *only* cool brand colour, so #012B68 and #83aff3 finally stand out instead of dissolving into the background.
3. Amber `#e19d63` is the true complement of hue 259: vibrant (C 0.11) but at L 0.75, well under the neon band (Radix amber 9 is C 0.19, Geist 0.17).
4. B is the most Claude-faithful, but warm charcoal + navy + terracotta is three temperatures; semantic fills also slip below 3:1 on cards.
5. C keeps the current "navy everywhere" identity at lower volume; choose it only if brand insists the app itself must look navy.
6. Non-colour changes matter as much: radius 6px controls / 8px cards (Ant/Linear), controlHeight 28-32, text at three tiers.
7. Ship the primary button as `#012b68` + 1px `#436cab` ring, or switch fills to navy-600 `#4f7dc3` if brand allows.
