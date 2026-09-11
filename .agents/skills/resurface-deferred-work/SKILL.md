---
name: resurface-deferred-work
description: Use when building, planning, or designing work that matches an entry in docs/deferred/INDEX.md.
---

# Resurface Deferred Work

## Purpose

Prevent agents from silently building over parked decisions without confirming the need and checking drift.

## Triggers

- A request matches a row in `docs/deferred/INDEX.md`.
- You are about to plan or build something that was intentionally deferred.

## Required Workflow

1. Read the matching registry row and detail doc -> understand need, reason, and trigger.
2. Confirm the developer still wants it -> do not expose stale implementation detail before confirming.
3. Drift-check the parked plan against current code -> classify none, small, or too much drift.
4. Present the viable path -> proceed, restructure, re-park, or reject forever.
5. If shipped, remove the registry row and detail doc -> keep deferred work current.

## Rules

- Do: scan deferred work before planning new features.
- Do not: silently build a parked item or trust an old plan without drift-checking it.

## Verification

- Run `bun run check` when resurfaced work changes TypeScript. Docs verification is not configured.

## References

- `docs/deferred/INDEX.md` - parked-work registry.
