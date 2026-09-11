---
name: defer-work
description: Use when the developer explicitly parks, defers, postpones, skips-for-now, or chooses an interim solution instead of a fuller plan.
---

# Defer Work

## Purpose

Record intentional "yes, later" work so future agents do not silently build or forget it.

## Triggers

- The developer says work is deferred, parked, postponed, YAGNI, or skipped for now.
- A simple interim solution ships instead of the fuller planned solution.

## Required Workflow

1. Confirm the deferred item -> get explicit developer approval to record it.
2. Capture business need, parked approach, reason, and revisit trigger -> make the future decision self-contained.
3. Create `docs/deferred/DEF-NNN-topic.md` -> assign the next available ID.
4. Add a row to `docs/deferred/INDEX.md` -> include ID, postponed item, reason, revisit trigger, and detail path.

## Rules

- Do: record only currently parked work with a concrete revisit trigger.
- Do not: record rejected-forever work or create deferred entries without developer confirmation.

## Verification

- Docs verification is not configured.

## References

- `docs/deferred/INDEX.md` - registry of parked work.
