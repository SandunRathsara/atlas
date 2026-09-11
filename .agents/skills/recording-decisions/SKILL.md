---
name: recording-decisions
description: Use when the developer approves a consequential domain or technical decision that needs an ADR.
---

# Recording Decisions

## Purpose

Turn an approved consequential decision into a durable, discoverable ADR
without inventing approval or leaving the detail and index out of sync.

## Triggers

- The developer approves a consequential domain or technical decision.
- An accepted decision must supersede an existing ADR.

## Required Workflow

1. Confirm explicit developer approval and the exact decision scope -> never
   invent or infer approval.
2. Read `docs/adr/INDEX.md` and any matching ADRs.
3. Choose the next four-digit ADR ID.
4. Create `docs/adr/NNNN-kebab-title.md` with Status, Context, Scope,
   Decision, Alternatives, Consequences, and Supersession.
5. If this decision supersedes an existing ADR -> mark the old ADR
   superseded and cross-link both records in their Supersession sections.
6. Add or update the row in `docs/adr/INDEX.md` in the same change -> update
   both the new detail file and the index together.
7. Validate every path, status, ID, and supersession link before reporting
   completion.

## Rules

- Do: record only decisions with explicit developer approval.
- Do: update both `docs/adr/INDEX.md` and the ADR detail file in the same
  change; never leave one without the other.
- Do not: invent or infer approval for a decision the developer has not
  confirmed.
- Do not: edit implementation code as part of this workflow.
- Do not: leave the detail file and index inconsistent.

## Verification

- Docs/link validation is not configured.

## References

- `docs/adr/INDEX.md` - decision routing registry.
- `docs/adr/0000-template.md` - ADR detail contract.
