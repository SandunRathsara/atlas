**Sidebar row style:** Variant A — cards in a 288px (`w-72`) sidebar. Chosen by the owner on 2026-09-11. Record the choice in a comment on this issue before starting a Session. Everything below is decided (grilling on 2026-09-11).

Source proposal: `docs/research/design-inbox-sidebar.md`. Vocabulary: `CONTEXT.md`. Visual tokens: `DESIGN.md` (unchanged).

## Goal

Replace the Repository-browser shell with an **inbox of Specs**. The sidebar always shows work; Repository becomes a filter. Landing on `/` opens the Repository that most needs attention.

## Domain mapping (do not rename)

| Inbox row | One Spec |
| --- | --- |
| Badge | Latest Session state, or **No Session** |
| Active | Spec with an unfinished Session, or no Session yet |
| Settled | Spec whose latest Session is terminal |
| Stale | Separate `warning` badge beside the state, never instead of it |

Pull requests never appear in the inbox.

## Shell

**Sidebar (`lg` and up)**, top to bottom:

1. Brand band (unchanged).
2. Repository filter: native `<select>` in a GET form, default **All Repositories**, one option per enrolled (not removed) Repository, last option **Manage Repositories…** → `/repositories`. A `+` icon button beside it → `/repositories/new`, accessible name "Add a Repository".
3. Inbox list, grouped and ordered:
   - **Needs you** — Waiting.
   - **In progress** — Running, Queued, Preparing, Idle (that order).
   - **Not started** — No Session.
   - **Settled** — collapsed by default (`<details>`), terminal Sessions only, latest per Spec, newest 10, then a **View all Sessions** link. Rows finished since the browser's last visit carry an unread dot and the group label reads `Settled · N new`.
   - Within a group: newest `updatedAt` first.
   - Row content: Spec title, `Spec #<n>`, state badge; Repository short name only when the filter is All Repositories. Waiting rows get a 2px `warning` left border (within the amber budget). No metrics.
   - Selected row: `brand-tint` + `brand-readable` left border + `aria-current="page"`.
4. Utility group, only when one Repository is filtered: **Pull requests**, **All Sessions**, **Open on GitHub**.

Rows use the Variant A card presentation in a 288px (`w-72`) sidebar. Variants B (dense rows) and C (main-pane table) are rejected.

**Header**: left text is the filtered Repository's full name, or **All Repositories**. Never "No Repository selected".

**Main pane**: the selected Spec, Session, Pull requests page, or Sessions page. Existing pages are reused as destinations.

**Below `lg`**: no drawer. The header navigation button becomes an **Inbox** link to `/inbox`, a full page with the same filter, groups, rows, and actions as stacked records.

## Filter state

Filter lives in the URL on `/inbox` (`?repository=<id>`) and is remembered in the `atlas_inbox` cookie so every other page renders the sidebar with the same filter. `Secure; HttpOnly; SameSite=Strict`. Removed Repositories are excluded from the filter and the list; direct Session links still work.

## Landing on `/`

Cookie `atlas_visit` (per browser, same flags) holds `lastVisitAt` and `lastRepositoryId`. On every `GET /`:

1. Any Session that reached a terminal state (Succeeded, Failed, Interrupted, Failed setup) after `lastVisitAt` → 303 to **that Session**, earliest terminal time first.
2. Else any unfinished Session → 303 to **that Session**; Waiting first, then earliest `submittedAt`.
3. Else `lastRepositoryId` still enrolled → 303 to its Spec list `/repositories/:id/specs`.
4. Else no enrolled Repository → 303 to `/repositories/new`. (Repositories enrolled but no Sessions ever → `/inbox`.)

In cases 1–3 set the filter cookie to that Repository. Update `lastVisitAt` and `lastRepositoryId` on every redirect. Terminal time comes from `session_history`; fall back to `updatedAt`.

## Refresh

The sidebar list is a fragment (`GET /inbox/list`, honours `HX-Request`). Re-rendered on every navigation and polled every 30s with `hx-trigger="every 30s"`; the swap must not move focus or create history. No SSE wiring in this Spec.

## Removed

| Today | After |
| --- | --- |
| `GET /` → `/repositories` | Landing rules above |
| Sidebar item **Repositories** | Gone (reachable via **Manage Repositories…**) |
| Sidebar group **Repository** (Specs / Pull requests / Sessions) | Gone (utility group + inbox rows) |
| Header "No Repository selected" | Gone |

Keep `/repositories`, `/repositories/new`, Spec detail, Start Session, Session detail, Pull requests, Sessions list. `/repositories` keeps `?removed=1`.

## Out of scope

Search box, pin/snooze/reorder, SSE-driven sidebar, per-person identity, any GitHub write, any change to Session states or theme tokens.

## Empty, loading, error

| Situation | Sidebar |
| --- | --- |
| No Repositories | Filter disabled; list shows **Add a Repository** link |
| Repositories, no Specs, no Sessions | "No work yet" in the list |
| Filter matches nothing | "No matches" + **Show all Repositories** link |
| Spec refresh never completed | "Specs unavailable" with the refresh error, not an empty list |
| Access unavailable on a Repository | `error` badge on its rows, list still renders |

## Docs to update in the same change

- `DESIGN.md`: layout section (sidebar contents, width per chosen variant, inbox row pattern), decision record row for **Layout**, purpose line ("browsing Repositories" → "triaging Specs").
- `docs/DOMAIN.md`: landing behaviour and the `atlas_visit` / `atlas_inbox` cookies.
- `docs/CODEBASE_MAP.md` via `/refresh-repo-map`.
- Delete `src/prototype-inbox.ts` once the variant is implemented.

## Acceptance

- [ ] `/` follows landing rules 1–4 with a fresh browser, after a Session finishes, and with a running Session; verified with two browsers to prove per-browser cookies.
- [ ] Filter persists across Spec, Session, PR, and Sessions pages; switching to All Repositories shows Repository short names on rows.
- [ ] Groups, ordering, unread dot, and `Settled · N new` match the rules above; Idle is never shown as finished.
- [ ] Phone (`< lg`): `/inbox` page works at 320px; no drawer; header **Inbox** link present.
- [ ] 30s poll swaps the list without stealing focus or adding history entries.
- [ ] Every URL returns a full page on direct visit; Back/Forward work.
- [ ] `DESIGN.md` acceptance checklist run on the shell, `/inbox`, and one Session page; renders captured at 375 and 1440.
- [ ] `bun run check`, `bun run build:css`, existing `verify:*` scripts pass.
