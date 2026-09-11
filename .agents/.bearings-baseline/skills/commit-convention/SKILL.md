---
name: commit-convention
description: Commit changes through a deterministic commit gate. Use when an agent is about to create a git commit.
---

# Commit Convention

## Project Commands

- Format intended files: not configured
- Fix lint errors in intended files: not configured
- Check lint: not configured
- Typecheck: `bun run check`
- Other quality gates: `bun run build:css`. No unified test suite. Run a scoped `bun run verify:*` or `bash deploy/verify-assets.sh` only when the change touches that script's subject.

## Workflow

1. Inspect the worktree and staged diff. The current task defines the commit
   allowlist; leave unrelated changes untouched. Stop if safe isolation is
   impossible.
2. On the intended files, run the format and lint-fix commands, then run the
   lint and typecheck commands to verify. If any check reports errors, fix them
   and re-run that check; repeat until it passes clean. Then run the remaining
   quality gates and resolve any failures the same way before continuing.
3. Stage only intended paths or hunks, then review the staged diff.
4. Write a Conventional Commit describing the staged change. Use an
   imperative lowercase subject of at most 72 characters with no trailing
   period. Add a body only for rationale or migration impact. Never add a
   `Co-Authored-By` trailer. Add other attribution only when explicitly
   requested.
5. Commit without bypassing hooks. Amend only when explicitly requested.
   Verify the resulting commit and report unrelated changes left untouched.
