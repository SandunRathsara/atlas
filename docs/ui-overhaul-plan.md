# UI/UX overhaul plan

Status: **Done. Phases 6/7 rolled out on 2026-11-18; the owner signed off on the phone review the same day.** Phases 1–5 picks are recorded in `DESIGN.md` (decision tables and "Phase 5 screens"). The shipped system is the kit in `src/views/kit.ts`, the frame in `src/views/frame.ts` / `src/views/shell.ts`, and the tokens in `src/styles.css`. The throwaway prototypes were deleted after sign-off; they remain in git history at commit `08f5a77` (`prototypes/taste/`).

## How decisions get made

The owner is the stakeholder and decides by **like / dislike on rendered screens**, never by reading tokens or specs.

- Every phase ends with 2–3 concrete, clickable options rendered on the real app with seeded demo data, shown in both light and dark mode, on desktop and phone.
- The owner picks, mixes ("A's colours, B's sidebar"), or rejects. A rejection means another round, not a debate.
- A locked phase is written into `DESIGN.md` before the next phase starts. Later phases must not silently reopen earlier decisions; if they need to, ask.
- Keep chat summaries short: what changed, what to look at, one question.

## Taste brief (owner, 2026-11-18)

| Signal | Owner said |
| --- | --- |
| Problems | Dull/lifeless, cluttered, "don't know where to look", colours, bad on phone |
| Liked products | Apple **apps** (Health, Fitness, Phone — not Apple websites), X app, Claude app, Raycast/Arc, Rex Beta (macOS) |
| Mode | Dark **and** light, with a switch |
| Brand | Keep navy `#012B68` |
| Density | Roomy and calm |

What that points to:

- **Apple apps:** large bold titles, grouped inset lists, soft rounded shapes, vivid status colours, translucent sidebars, a bottom tab bar on phones, and generous spacing.
- **Rex:** a sidebar that puts "needs my attention" first, status as small activity dots (working / blocked / error / done), few borders, dimmed secondary content, ⌘K, and settings that look like macOS Settings.
- **X:** high-contrast and simple, with a clear feed. **Claude:** warmth and calm reading. **Raycast/Arc:** some gloss and colour.

## Diagnosis of today's UI

Captured from seeded screenshots on 2026-11-18:

1. No hierarchy. Titles, cards and buttons all have the same weight.
2. Two global warning banners (backup, storage) sit on every page and fill a phone's first screen.
3. `/inbox` repeats the sidebar inbox in the main pane.
4. The Session page is an internal-field dump (~20 checkpoint fields). The live view is at the bottom, and a red "Remove from Atlas" button sits among routine links (investigate what it targets).
5. Jargon copy: "Immutable handoff context", "Terminal desk", "Projection notes", "Queueing: preparation is deferred".
6. Inconsistent actions. Ghost buttons read as bold text, and table actions are tiny stacked buttons.
7. Raw data. Spec markdown is unrendered, and timestamps are absolute UTC strings.
8. No identity. The brand is a flat navy box with the word "Atlas".
9. Phone: unlabelled header icons, a long scroll before any work, and no real navigation.

## Constraints that do not change

- Domain vocabulary and rules in `CONTEXT.md` / `docs/DOMAIN.md`. Copy can get plainer, but domain terms (Spec, Session, Repository, Idle, Stale…) stay, and states are never misrepresented. For example, Idle never looks like done, and Stale never looks like failed.
- No new business behaviour. A visual redesign may *reorganise* information, for example by collapsing technical fields, but must not hide anything required for a decision.
- Stack stays: server-rendered Hono + HTMX, Tailwind 4 + daisyUI 5, no client framework, no web fonts unless the owner asks (the system font is already SF on Apple devices).
- WCAG 2.2 AA in **both** modes, plus the existing HTMX focus, history and announcement contract in `DESIGN.md`.

## Current `DESIGN.md` decisions this overhaul reopens

These were owner decisions on 2026-09-10. Re-test them visually; don't assume.

| Current rule | Tension |
| --- | --- |
| Dark only | Owner now wants dark + light switch |
| 32px controls, compact 36px table rows | Owner now wants roomy and calm |
| 6px / 8px corners; 12–20px rejected as "made for children" | Apple apps use ~10–14px. **Show both and let the owner re-judge.** |
| Glass only on header | Apple-style translucent sidebar is a candidate |
| Dense tables as default list | Apple-style grouped lists are a candidate; tables may stay for wide data |
| Amber accent budget | Revisit once the palette is chosen |

## Phases

Each phase lists what gets built, what the owner decides, and the exit condition.

### Phase 0 — Tooling (no owner input)

- Make the seeded demo server and screenshot harness reusable. The first versions are throwaway in `/tmp/atlas-ux/`; move them to `scripts/ui-demo.ts` and `scripts/ui-shots.cjs`. Cover every Session state, empty and error states, long titles, and both access and refresh warnings.
- Add a dev-only `/prototype/*` route family (not mounted in releases) for options. Delete it after the overhaul.
- Shots at 375, 768, 1024 and 1440 px, light + dark.

### Phase 1 — Taste: pick a direction

Build the **Inbox + one Session** in three directions, each in light + dark:

| Option | Feel |
| --- | --- |
| A. "Health" | Apple-native: big bold titles, grouped inset rounded lists, translucent sidebar, vivid status circles, navy as the tint colour |
| B. "Rex" | Native tool: quiet borderless sidebar with activity dots, "needs you" first, dimmed secondary info, ⌘K hint, settings-style panels |
| C. "Warm" | Claude-like: warm neutrals, soft surfaces, reading-first, navy + one warm accent |

Owner decides: one direction, or a named mix. Exit: the direction is written into `DESIGN.md` as a short decision record.

**Result (2026-11-18):** A "Health", no mix. Written into `DESIGN.md`.

### Phase 2 — Foundations: style tile

One page showing the chosen direction's building blocks:

- Colour: light and dark ladders built around navy, a text ladder, and status colours (Running, Waiting, Idle, Succeeded, Failed, Stale, access).
- Type scale, including a large-title style.
- Spacing rhythm and corner radius (show 2 radius options side by side).
- Surfaces and materials (translucency where used), shadows/elevation, icon set and sizes, motion.
- Theme switch behaviour: follows the system by default, with a manual override remembered per browser.

Owner decides: like/dislike per row. Exit: the `atlas` light + dark themes in `src/styles.css`, with `DESIGN.md` palette and contrast tables updated.

### Phase 3 — Components: gallery

`/prototype/components` with every building block in both modes:

- Buttons and action hierarchy (primary, secondary, quiet, destructive-in-menu).
- Status pill and status dot, Stale overlay, access badge.
- List row (grouped inset), table (for wide data), card.
- Form fields, choice cards (for starting targets), segmented control, dialog/sheet, menu.
- Alerts and banners, compact system-status indicator, toast.
- Empty, loading (skeleton) and error states.
- Relative time with exact time available, rendered markdown prose, live output well.

Owner decides: like/dislike per component. Exit: components exist as shared partials; `DESIGN.md` component table rewritten.

### Phase 4 — Shell and navigation

Options for:

- Sidebar: activity-first inbox (Rex), brand moment (logo mark, not a flat box), Repository filter.
- Desktop header and page-title pattern.
- Global system warnings (backup, storage): one compact status indicator that opens details, instead of full-width banners on every page. They stay visible, per `DOMAIN.md` truthfulness.
- Phone: bottom tab bar (Inbox · Sessions · Repositories · More) versus a top-bar alternative.
- Theme switch placement.
- Optional ⌘K quick switcher. This is a new capability, so ask before building it.

Exit: shell shipped behind the prototype route and approved.

### Phase 5 — Screens (priority order)

For each screen: show 2 layouts, the owner picks, then refine once.

1. **Inbox.** Remove the duplicate list. Decide what the main pane shows on `/inbox`: an overview of what needs you, or the selected item.
2. **Session.** Lead with state, "what is happening now", and live output. Move checkpoint fields into a collapsed "Technical details" section. Put destructive actions in a menu. Keep Stale/Idle honest.
3. **Spec detail + Start Session.** Rendered Spec markdown; Start Session as a focused form or sheet. Starting-target choice cards explain eligibility in plain words.
4. **Repositories + Add a Repository.** Settings-style list; destructive actions moved away from routine ones.
5. **Pull requests and PR stacks.** Show stacks visually as connected, ordered rows.
6. **All Sessions.**
7. **Updates.** macOS Settings style.
8. **Login.** Brand moment.

Exit per screen: approved render at all widths and both modes.

### Phase 6 — Behaviour and copy

- Copy pass: replace jargon with plain sentences while keeping domain terms. Owner reviews in context, not as a word list.
- Relative times, skeleton loading, subtle live-update highlighting, reduced-motion support.
- Empty, error and partial-data states on every screen.
- Focus, keyboard and screen-reader pass in both modes.

### Phase 7 — Rollout

- Ship in slices: foundations + shell first, then screens in Phase 5 order. Each slice gets its own PR with before/after screenshots.
- Update `DESIGN.md` in the same change as the code it governs. Mark old decisions superseded.
- Update verify scripts that assert markup/classes (for example, `verify-inbox-page.ts` asserts `table-compact`, `md:hidden`, `btn btn-ghost lg:hidden`). Keep their behavioural intent.
- Run `bun run check`, `bun run build:css`, and the inbox/landing/issue58 verify scripts on every slice.
- Delete `/prototype/*` and the demo seed's prototype hooks at the end.

## Open questions to settle along the way

- ~~What does the red "Remove from Atlas" button on the Session page target?~~ **Settled 2026-11-18:** it removes the Repository. It moves to the Repository ⋯ sheet and now asks first.
- ~~Should ⌘K be built?~~ **Settled 2026-11-18:** yes. The owner approved a quick search (⌘K / search icon) that jumps to any Spec or Session. It's a new capability, so it needs its own Spec/issue before rollout.
- ~~Web fonts~~ **Settled 2026-11-18:** owner approved bundling Inter (and Geist Mono for code) as self-hosted `.woff2` assets.
