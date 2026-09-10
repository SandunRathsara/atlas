# Claude / Anthropic design system — research notes

Purpose: extract citable facts about how Claude's product UI (claude.ai, Claude Desktop dark mode, Claude Code TUI) and the Anthropic brand achieve their look, so Atlas can reproduce the *feel* with a `#012B68` navy accent.

Confidence labels: **[P]** primary (Anthropic-shipped CSS/binary/docs), **[C]** captured from live claude.ai by a third party, **[T]** third-party write-up (unverified reconstruction).

Primary sources used:
- `/Applications/Claude.app/Contents/Resources/app.asar` — Anthropic-shipped CSS, `:root` and `.darkTheme` token blocks (desktop build 5 Sep 2026). **[P]**
- `~/.local/share/claude/versions/2.1.267` — Claude Code binary, six theme preset objects. **[P]**
- https://cdn.prod.website-files.com/67ce28cfec624e2b733f8a52/css/ant-brand.shared.6af327f04.min.css — anthropic.com brand stylesheet (`--swatch--*`, `--radius--*`, `--_typography---*`). **[P]**
- https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md — Anthropic's published brand palette. **[P]**
- https://code.claude.com/docs/en/terminal-config#color-token-reference — Claude Code theme token docs. **[P]**
- https://github.com/Yidiiiz/Prompty/blob/main/src/shared/tokens.ts — token fallbacks captured from live claude.ai. **[C]**
- https://www.assistant-ui.com/examples/claude — Claude clone dark values. **[T]**
- https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/claude/DESIGN.md, https://www.shadcn.io/design/claude, https://oh-my-design.kr/design-systems/claude, https://mobbin.com/colors/brand/claude. **[T]**
- https://geist.co/work/anthropic, https://type.today/en/journal/anthropic, https://deardesigner.substack.com/p/my-styrene-soul-a-short-affair-with, https://github.com/Yacey/claude-design/blob/main/references/typography.md. Brand/typography commentary.

## 1. Brand palette

Anthropic's published palette (brand-guidelines skill) **[P]**: Dark `#141413`, Light `#faf9f5`, Mid Gray `#b0aea5`, Light Gray `#e8e6dc`; accents Orange `#d97757`, Blue `#6a9bcc`, Green `#788c5d`.

anthropic.com swatches **[P]** (named tokens in the brand CSS):
- Warm neutrals: `slate-dark #141413`, `slate-medium #3d3d3a`, `slate-light #5e5d59`, `cloud-dark #87867f`, `cloud-medium #b0aea5`, `cloud-light #d1cfc5`, `ivory-dark #e8e6dc`, `ivory-medium #f0eee6`, `ivory-light #faf9f5`.
- Accent: `clay #d97757` (brand), `accent #c6613f` (darker interactive orange).
- Secondary swatches: `sky #6a9bcc`, `olive #788c5d`, `kraft #d4a27f`, `manilla #ebdbbc`, `oat #e3dacc`, `cactus #bcd1ca`, `fig #c46686`, `heather #cbcadb`, `coral #ebcece`.
- Faded borders are the neutral at 10%/20% alpha: `slate-faded-10 #1414131a`, `ivory-faded-10 #faf9f51a`.

Product accent tiers **[P]/[C]**: `--accent-brand` = `hsl(15 63.1% 59.6%)` = `#d97757` (logo/brand); `--brand-000` = `#c6613f`; claude.ai's `--accent-main-100` in light mode = `hsl(15 56% 52%)` ≈ `#c96442` (buttons) **[C]**. So "Claude orange" is two values: `#d97757` for brand/identity, `#c6613f`–`#c96442` for interactive fills. `#DA7756` / `#cc785c` / `#C15F3C` seen in third-party write-ups are approximations **[T]**.

Note: `#3d3d3a` (which the brief listed as a dark surface) is actually a *light-mode text* color (`slate-medium`, `--text-200`). The dark surfaces are `#1f1e1d / #262624 / #30302e` (see below).

## 2. Dark mode specifics (Claude Desktop `.darkTheme`) **[P]**

| Token | HSL (as shipped) | Hex | Role (inferred from class usage) |
|---|---|---|---|
| `--bg-000` | `60 2.1% 18.4%` | `#30302e` | Elevated: composer/input, cards, menus |
| `--bg-100` | `60 2.7% 14.5%` | `#262624` | Main chat canvas |
| `--bg-200` | `30 3.3% 11.8%` | `#1f1e1d` | Sidebar / lower layer |
| `--bg-300` | `60 2.6% 7.6%` | `#141413` | Deepest well (code blocks, wells) |
| `--bg-400/500` | `0 0% 0%` | `#000000` | Absolute floor |
| `--text-000/100` | `48 33.3% 97.1%` | `#faf9f5` | Primary text (cream, not white) |
| `--text-200/300` | `50 9% 73.7%` | `#c2c0b6` | Secondary text |
| `--text-400/500` | `48 4.8% 59.2%` | `#9c9a92` | Tertiary / placeholder |
| `--border-100..400` | `51 16.5% 84.5%` | `#dedcd1` | Border colour, always used with alpha |
| `--accent-brand` | `15 63.1% 59.6%` | `#d97757` | Brand orange |
| `--accent-pro-100` | `251 40.2% 54.1%` | `#6c5bb9` | Purple (Pro/Max tier) |
| `--accent-100` | `210 70.9% 51.6%` | `#2c84db` | Blue (links, secondary actions) |
| `--danger-100` | `0 67% 59.6%` | `#dd5353` | Error |
| `--success-100` | `97 75% 32.9%` | `#459315` | Success |
| `--oncolor-100` | `0 0% 100%` | `#ffffff` | Text on accent fills |

Observations:
- Every neutral sits at hue 30–60 with saturation 2–3%. Dark mode is warm brown-grey, not blue-grey.
- Layers are a 4-step ladder (18% → 14.5% → 12% → 7.6% lightness). Elevation = *lighter* surface, never a shadow.
- Borders: one cream value (`#dedcd1`) applied at low alpha. Observed Tailwind usage in the bundle: `border-border-300/25` (25%) most common, `/0` for hidden. Prompty's live capture **[C]** shows claude.ai web uses distinct border tiers: `--border-100: 48 10% 25%`, `--border-200: 48 11% 82%`, `--border-300: 48 12% 88%`, again applied with opacity.
- Third-party clone of dark mode **[T]** (assistant-ui): bg `#2b2a27`, composer `#1f1e1b`, composer border `#3d3a35`, user bubble `#393937`, muted text `#a3a098`, primary `#c96442`. Same family, slightly off — treat the `.darkTheme` values above as canonical.
- Orange in dark mode: only the send button, the brand spinner/logo, and primary CTA. Links use blue `#2c84db`; Pro/Max marketing uses purple. anthropic.com's dark theme goes further: primary buttons are `ivory-light` fill with `slate-dark` text, no orange at all **[P]**. Saturation of the orange is unchanged between modes (63%), it just reads warmer against the brown-grey.
- Class-usage counts in the bundle: `text-text-100` 40×, `text-text-300` 16×, `text-text-400` 14×; `bg-bg-400` 27×, `bg-bg-300` 18×; no `bg-accent-*` classes at all. Accent fills are rare by construction.

## 3. Typography

- Families **[P]**: `--font-anthropic-sans: "anthropic-sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; `--font-anthropic-serif: "anthropic-serif", ui-serif, Georgia, "Times New Roman", serif`; `--font-mono: var(--font-anthropic-mono, "SF Mono"), ui-monospace, Menlo, Consolas, monospace`; `--font-voice` = the serif (used for Claude's "voice"/prose headings). anthropic.com: `--_typography---font--detail` and `display-sans` = Anthropic Sans; `paragraph-text` and `display-serif` = Anthropic Serif; `mono` = Anthropic Mono; JetBrains Mono is also loaded.
- Lineage **[T]**: Anthropic Sans = Styrene B (Commercial Type); Anthropic Serif = Tiempos Text / Galaxie Copernicus (Klim); Anthropic Mono ≈ Söhne Mono. type.today: "Styrene is applied to website headlines and subheadings, while Tiempos is used for body text" on the marketing site. In the product it inverts: sans for UI chrome, serif for Claude's prose and page titles.
- Sizes **[P]** (desktop app): `--font-size-caption 12px`, `--font-size-code 13px`, `--font-size-footnote 13px`, `--font-size-body 14px`, `--font-size-heading 15px`, `--font-size-title 22px`, `--font-size-prose 1rem`, `--font-weight-bold 600`.
- anthropic.com scale **[P]**: detail xs/s/m/l/xl = 12/14/16/18/20px; display xs..xxxl = 20/24/32/48/64/72/96px; weights 400/500/600/700; letter-spacing `0 / -.005em / -.02em`; line-heights `1, 1.05, 1.1, 1.3, 1.4, 1.5`. Serif display weight is 400–600, not bold.
- Free substitutes: sans → `system-ui` / Inter; serif → Source Serif 4 or Georgia (Tiempos-like transitional); mono → `ui-monospace` / JetBrains Mono. Claude's own fallback stacks already are `ui-sans-serif`/`Georgia`/`ui-monospace`, so system fonts are on-brand by design.

## 4. Shape

- Radii **[P]** (desktop app): `--radius: 8px` (default), `--radius-md: .375rem` (6px), `--radius-lg: .5rem` (8px), `--radius-composer: 14px`, `--radius-card: calc(var(--cds-radius) + 4px)`; literal `6px`, `8px`, `12px`, `9999px` are the common hardcoded values. anthropic.com: `--radius--small .25rem`, `--radius--main .5rem`, `--radius--large 1rem`, `--radius--round 100vw`. Third parties **[T]** report message bubbles/composer `rounded-2xl` (16px), pricing cards 24px, media 32px.
- Border width: 1px everywhere; 0.5px ring via box-shadow on the composer **[C]**.
- Shadows **[P]**: only popovers/menus: `--shadow-popover: 0 8px 24px rgb(0 0 0 / 0.32), 0 2px 6px rgb(0 0 0 / 0.2)` (dark). Cards, inputs, sidebar: none. Composer uses a faint ring `0 0 0 0.5px border-300/15` plus `0 .25rem 1.25rem black/3.5%` **[C]**.

## 5. Spacing and density

- Base unit 4px: anthropic.com `--_spacing---space--1..12` = .25/.5/.75/1/1.5/2/2.5/3/4/5/6/10rem; gaps `xs .5rem, s 1rem, m 1.5rem, l 3rem` **[P]**.
- Control heights **[P]**: Tailwind `h-8` (32px) and `h-9` (36px) are the two most-used heights in the desktop bundle; `h-11` (44px) for the composer row; avatars `--cds-avatar-sm/md/lg = 20|24 / 28|32 / 36|40px`.
- Sidebar width: not exposed as a token in the bundle (`--sidebar-width` referenced, value not found). Unverified; clones use ~256–288px.
- Text hierarchy is 3 tiers only (100/300/400) and body is 14px, so the UI is denser than typical marketing-style AI apps.

## 6. Claude Code terminal UI **[P]** (dark preset `B` in 2.1.267)

| Token | Value | Use (per official docs) |
|---|---|---|
| `claude` | `rgb(215,119,87)` `#d77757` | spinner, assistant label — the only brand colour |
| `claudeShimmer` | `rgb(235,159,127)` | lighter pair for the spinner gradient |
| `text` / `inverseText` | `#ffffff` / `#000000` | default fg / text on badges |
| `inactive` | `rgb(153,153,153)` | hints, timestamps, disabled |
| `subtle` | `rgb(80,80,80)` | faint borders, de-emphasized text |
| `promptBorder` | `rgb(136,136,136)` | input box border (neutral grey, not orange) |
| `permission` / `suggestion` | `rgb(177,185,249)` | dialog borders, autocomplete |
| `planMode` | `rgb(72,150,140)` | plan mode border |
| `autoAccept` | `rgb(175,135,255)` | accept-edits border |
| `success` / `error` / `warning` | `rgb(78,186,101)` / `rgb(255,107,128)` / `rgb(255,193,7)` | status |
| `diffAdded` / `diffRemoved` | `rgb(34,92,43)` / `rgb(122,41,54)` | diff line backgrounds |
| `userMessageBackground` | `rgb(55,55,55)` | user turn (fullscreen mode) |
| `composerSidebarBackground` | `rgb(38,38,38)` | fullscreen sidebar |
| `selectionBg` | `rgb(38,79,120)` | mouse selection |
| `professionalBlue` | `rgb(106,155,204)` = `#6a9bcc` | Anthropic "sky" blue |

Conventions observed in the binary: `borderStyle:"round"` 27×, `"single"` 14× (rounded box-drawing for dialogs/input, single rules for dividers); `dimColor` used ~2,000× (secondary info is dimmed, not recoloured); semantic-colour usage counts `warning 222, error 205, success 104, permission 95, suggestion 92, claude 65, inactive 42, subtle 38` — the brand orange is used less than any status colour. Code blocks are highlighted with fixed ANSI indices (keyword blue, string red, number/comment green), so they inherit the terminal palette. Six presets: `dark, light, dark-daltonized, light-daltonized, dark-ansi, light-ansi`; users override tokens in `~/.claude/themes/*.json`.

## 7. Principles (Anthropic's / partners' own words)

- Geist (brand agency): the system was "developed to bring warmth to the brand while being able to handle the dual needs of marketing communications and product UI"; typography "both technically refined and charmingly quirky". https://geist.co/work/anthropic
- type.today: Anthropic aimed to "distance themselves from a technological, somewhat intimidating visual style" and make products "friendlier". https://type.today/en/journal/anthropic
- Claude Code docs on theming: "Unknown tokens and invalid color values are ignored, so a typo cannot break rendering." Robustness over expressiveness. https://code.claude.com/docs/en/terminal-config
- What the shipped CSS says without words: one brand hue; neutrals at ≤3% saturation on a warm hue; text is cream (`#faf9f5`) not white; elevation via lighter surface, shadows only on popovers; a single border colour at alpha; 8px radius default; 14px UI body.
- Third-party synthesis **[T]** (VoltAgent DESIGN.md): "color-block first, shadow rare"; reserve the accent "for primary CTAs and full-bleed callout moments"; "bigger serif before bolder weight".

## Verified tokens

| Role | Hex | Source |
|---|---|---|
| Brand orange | `#d97757` | app.asar `--accent-brand`; anthropic.com `--swatch--clay`; brand-guidelines skill **[P]** |
| Interactive orange (dark) | `#c6613f` | app.asar `--brand-000`; anthropic.com `--swatch--accent` **[P]** |
| Interactive orange (claude.ai light) | ≈`#c96442` (`hsl(15 56% 52%)`) | Prompty live capture **[C]** |
| Dark: elevated / input | `#30302e` | app.asar `.darkTheme --bg-000` **[P]** |
| Dark: canvas | `#262624` | app.asar `--bg-100` **[P]** |
| Dark: sidebar | `#1f1e1d` | app.asar `--bg-200` **[P]** |
| Dark: deepest | `#141413` | app.asar `--bg-300`; brand "Dark" **[P]** |
| Dark: text primary | `#faf9f5` | app.asar `--text-100`; brand "Light" **[P]** |
| Dark: text secondary | `#c2c0b6` | app.asar `--text-200` **[P]** |
| Dark: text tertiary | `#9c9a92` | app.asar `--text-400` **[P]** |
| Dark: border (use at 15–25% alpha) | `#dedcd1` | app.asar `--border-300` **[P]** |
| Dark: danger / success | `#dd5353` / `#459315` | app.asar **[P]** |
| Blue accent (links) | `#2c84db` | app.asar `--accent-100` **[P]** |
| Brand blue / green | `#6a9bcc` / `#788c5d` | brand-guidelines skill; anthropic.com swatches **[P]** |
| Light: canvas / card / well | `#faf9f5` / `#f5f4ed` / `#f0eee6` / `#e8e6dc` | app.asar `:root --bg-100..400` **[P]** |
| Light: text 1/2/3 | `#141413` / `#3d3d3a` / `#73726c` | app.asar `:root` **[P]** |
| Claude Code brand / inactive / subtle | `#d77757` / `#999999` / `#505050` | binary dark preset **[P]** |
| Radius default / small / composer | 8px / 6px / 14px | app.asar `--radius*` **[P]** |
| Popover shadow (dark) | `0 8px 24px rgb(0 0 0/.32), 0 2px 6px rgb(0 0 0/.2)` | app.asar **[P]** |
| UI body / caption / code / title | 14 / 12 / 13 / 22px | app.asar `--font-size-*` **[P]** |

Unverified: exact sidebar width; hover-state tokens (bundle uses alpha overlays of `bg-000`/`border`, no dedicated hover token); `#DA7756`, `#cc785c`, `#C15F3C` are third-party approximations of the two verified oranges.

## Implications for a `#012B68` navy dark theme

`#012B68` is `hsl(215 98% 21%)`: very dark, very saturated. It cannot play the role `#d97757` plays (a 60%-lightness accent that reads on both `#262624` and `#faf9f5`).

1. Keep Claude's surface ladder verbatim: sidebar `#1f1e1d`, canvas `#262624`, inputs/cards `#30302e`, wells `#141413`. The warm brown-grey *is* the feel; do not cool the neutrals toward navy. Claude already pairs warm greys with cool blue (`#2c84db`) and purple (`#6c5bb9`) accents, so a cool accent on warm neutrals is on-brand.
2. Use `#012B68` as `brand-900`, not `accent-100`: selection backgrounds, active-row tint, badge fills, focus-ring halo at alpha, the logo mark. Derive the working accent by lifting lightness while keeping the hue: `accent-100 ≈ hsl(215 55% 60%) ≈ #6190d1` for links/icons/spinner, `accent-200 ≈ hsl(215 70% 40%) ≈ #1f5aad` for primary button fills with `#ffffff` text. Check both against `#262624` for ≥4.5:1.
3. Accent budget: primary button, spinner/progress, active nav indicator, focus ring, links. Nothing else. The Claude Code numbers (brand colour used less than every status colour) are the target.
4. Borders: one cream `#dedcd1` at 15–25% alpha, 1px. No solid grey lines, no navy borders. Elevation = next lighter surface; shadows only on popovers (`0 8px 24px rgb(0 0 0/.32)`).
5. Text: exactly three tiers, cream not white: `#faf9f5`, `#c2c0b6`, `#9c9a92`. Placeholder = tier 3.
6. Status colours stay muted and warm-adjacent: error `#dd5353`, success `#459315` (or Claude Code's `#4eba65`), warning `#ffc107`-class amber. Do not use navy for "info".
7. Type: sans UI at 14px body / 12px caption / 13px code / 15px section heading (500) / 22px page title; serif (Source Serif 4 or Georgia, weight 400–500) reserved for page titles or empty-state copy if used at all. Stack: `system-ui, -apple-system, "Segoe UI", sans-serif` and `ui-monospace, "SF Mono", Menlo, monospace`. Bold = 600.
8. Shape: 8px default radius, 6px for small chips/menus, 12–14px for the main input/composer and cards, pill for tags. Never mix 4px and 16px on sibling controls.
9. Density: 32px controls default, 36px for primary inputs, 4px spacing scale, 12–16px card padding. Keep the sidebar ~256–272px with 32px rows.
10. Navy must not be a surface. A navy sidebar or navy header would read as a generic enterprise dashboard, the opposite of the warm, low-elevation Claude look. If a navy surface is required for identity, restrict it to a single small brand block (e.g. the app mark) on the warm ladder.
