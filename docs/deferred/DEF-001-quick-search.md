# DEF-001: ⌘K quick search

## What was postponed

A quick search that jumps to any Spec or Session:

- Desktop: a search field at the top of the sidebar with a ⌘K hint.
- Phone: a magnifier in the top bar.

## Why

The owner approved it on 2026-11-18 (`docs/ui-overhaul-plan.md`, open questions; `DESIGN.md` Phase 4 "Quick search entry"). It is a new capability: it needs a query route, ranking over Specs and Sessions, and keyboard handling. The UI overhaul only restyled existing behaviour, so it shipped with no search field, no ⌘K, and no magnifier.

## Revisit when

A Spec for quick search is written, or the owner asks for it.

## Notes for the Spec

- Scope: Specs and Sessions only (CONTEXT.md terms). Include the Repository name in each result.
- Placement is already picked (above); the sidebar has room above the live list.
- Must work without JS as a plain GET form; ⌘K is an enhancement.
