---
description: One-time (re-runnable) project tailoring after `bearings init`. Interviews the developer, explores the repo, and completes the agent-friendly setup.
---

# /setup-repo

You are completing the agent-friendly setup that `bearings init` scaffolded.
The scaffold is generic; your job is everything project-specific. Interview
the developer relentlessly — one question at a time, with a recommended
answer per question — and explore the code before asking anything the code
can answer.

This is the only operation the temporary `## Setup Required` gate in
`AGENTS.md` permits. Do not remove the gate until step 12 below.

## Post-update reconciliation

When `.agents/bearings.json` is manifest v2 and has `setupPending`:

1. Read every file record's ordered `reconciliations` and every top-level
   `migrationReconciliations` record.
2. Resolve every `migrationReconciliations` record through **Migrated checklist
   repairs** below.
3. For each non-`skill-update` reconciliation, read its Backup File and current target, summarize
   the differences, and ask which backed-up changes to apply to the target.
4. Apply the developer's choice directly to the target regardless of owner,
   delete the resolved Backup File, and remove its reconciliation record.
5. A `skippedTemplate` records a declined template revision.
   Do not apply the declined template — normal project maintenance may
   still update that file.
6. Run only setup steps supported by current drift; do not reset completed
   project tailoring.
7. Run `bearings verify`. Resolve every failure and warning except the
   expected `setup-pending` warning, then remove `setupPending` from the
   manifest.
8. Run `bearings verify` again and finish only at zero failures and warnings.

### Starter skill updates (`skill-update`)

For each file record with a `skill-update` reconciliation:

1. Read `basePath`, the live skill path (local), and `incomingPath`. Check
   whether `basePath` exists before attempting any diff.
2. If `basePath` is missing, explain that Three-way merge is not available
   without a historical base. Do not fabricate one. Offer exactly these
   options (one skill at a time):
   - **Take new template**, **Keep local**, and **Freeform**. Apply the same
     manifest and baseline updates described below for the selected outcome.
3. If `basePath` exists, diff local vs base and incoming vs base; summarize
   both for the developer. If `basePath` exists, offer exactly these four options
   (one skill at a time), mark a recommendation:
   - **Take new template** — replace live skill with incoming; set manifest
     `hash` and `lastTemplateHash` to incoming hash; `owner: agent`.
   - **Keep local** — leave live skill; set `hash` to current content hash;
     keep `lastTemplateHash`; set `skippedTemplate` to the incoming
     version/hash; `owner: agent`.
   - **Three-way merge** (Recommended when both diffs are non-empty) — merge
     both sides into the live skill; then set `hash` to result hash and
     `lastTemplateHash` to incoming hash; `owner: agent`.
   - **Freeform** — developer/agent writes the resolved file; same baselining
     as merge (hash = result, `lastTemplateHash` = incoming hash) unless they
     explicitly choose to decline the template (then same as Keep local).
4. Refresh `.agents/.bearings-baseline/skills/<name>/SKILL.md` to match the
   new content hash.
5. Delete backup, incoming file, and the reconciliation entry.

### Migrated checklist repairs (`migrationReconciliations`)

Resolve each record through the generic checklist workflow. Invoke the
`checklist` skill directly, or delegate one record to a subagent that loads and
follows `.agents/skills/checklist/SKILL.md`.

1. For `testplan-collision`, read the current `target` and the pre-existing
   checklist in `backup`. Summarize their authored content and ask the developer
   whether to keep either version or combine them. Write the choice to `target`.
2. For `invalid-testplan`, read `backup`, explain each contract problem, and
   repair its useful authored content into `target`. When the record has no
   `target`, ask the developer to choose a safe
   `checklists/<category...>/<slug>.json` path first. Do not discard content
   that cannot be repaired without the developer's decision.
3. Follow the checklist skill's schema, validation, and full-library build
   steps for the resolved target. Continue only after validation and build both
   pass.
4. Delete the resolved `backup` and remove its
   `migrationReconciliations` record. Remove the top-level property when no
   records remain.

## Checklist opener

Add or reuse one project-native command that runs `npx bearings checklist` (or
the repository's established local bearings invocation). This command builds
the checklist payload and opens the static previewer.

1. Search existing automation and documentation for an existing equivalent
   runner command that already builds and opens the checklist previewer. Reuse
   it and report its exact invocation without editing its runner.
2. Otherwise, select the first existing safe automation home in this exact
   priority: `justfile`, `Makefile`, `Taskfile.yml`, `mise.toml`, then
   `package.json`.
3. Before editing an existing automation file, show the proposed command and
   ask the developer for approval. Edit it only after approval. If approval is
   declined, leave it unchanged and continue through the priority order.
4. If no existing home is safe and approved, ask the developer to choose
   between creating one missing automation file from the list above and using
   the direct fallback. Create a missing file only after the developer selects
   that strategy and file.
5. When no automation file is selected, make no automation edit and report the
   stack-agnostic direct build-and-open fallback: `npx bearings checklist`.
6. Run the selected command, or the direct fallback, and confirm that it builds
   successfully and opens the static previewer. Report its exact invocation for
   future use.

## Required workflow

1. Read `AGENTS.md` and `.agents/bearings.json`.
2. Review every recorded Backup File with the developer: read the backup,
   summarise what it contained, and ask per file whether to merge into the
   new scaffold, keep parts, or discard. Apply their choice, then remove
   the resolved backup.
3. Explore the repo: stack, package manager, canonical install/run/build/
   test/lint commands, CI, generated paths, secret/config paths, deployment
   surfaces, project purpose, users/operators, and hard domain/technical
   constraints. Interview the developer one question at a time for anything
   the code cannot answer.
4. Fill only the `AGENTS.md` project-purpose and primary-stack placeholders.
   Keep `AGENTS.md` a thin router — do not add a skill table, invariants
   section, or always-on rules block.
5. Adapt every starter skill:
   - `.agents/skills/commit-convention/SKILL.md`
   - `.agents/skills/defer-work/SKILL.md`
   - `.agents/skills/resurface-deferred-work/SKILL.md`
   - `.agents/skills/recording-decisions/SKILL.md`
   - Explore the repo for format, lint-fix, lint, typecheck, test, build,
     and docs verification commands.
   - Replace every `<agent: fill during handoff — …>` marker with a real
     command or explicit `not configured`.
   - Light project tailoring only — do not remove the skill's safety workflow.
6. Claim starter skills in `.agents/bearings.json` (allowed manifest edit):
   - Set each starter skill `owner` to `agent`.
   - Set `hash` to the sha256 of the file contents (use the same algorithm as
     bearings: UTF-8 body, `sha256:` + hex).
   - Set `lastTemplateHash` to the hash of the skill template as shipped in the
     installed bearings package (read from the package templates if needed;
     if the adapted file still matches the package template byte-for-byte,
     `lastTemplateHash` equals `hash`).
   - Write `.agents/.bearings-baseline/skills/<name>/SKILL.md` equal to the
     live file bytes.
7. Complete the **Checklist opener** workflow above.
8. Run the `/refresh-repo-map` workflow to initialize `docs/DOMAIN.md`,
    `docs/ARCHITECTURE.md`, `docs/CODEBASE_MAP.md`, and
    `docs/diagrams/c4-component.puml`.
9. Expose any newly created skills into each configured harness using the
    manifest's existing symlink/copy mode.
10. Run `bearings verify`. Fix every failure and every warning.
11. Confirm the run reports zero failures and zero warnings before
     proceeding.
12. Remove the `## Setup Required` section from `AGENTS.md` — only after
    step 11 confirms zero failures and zero warnings.
13. Run `bearings verify` again and report the completed setup to the
    developer.

## Rules

- Do not overwrite developer decisions silently — every merge/keep/discard
  of a Backup File is the developer's call.
- Do not edit bearings-owned **commands** except when a recorded Merge
  reconciliation explicitly permits applying backup changes.
- Do edit starter **skills** during setup (adapt + claim). After claim they
  are agent-owned; maintainers may edit them freely.
- Manifest edits are limited to: skill `owner` / `hash` / `lastTemplateHash` /
  `skippedTemplate` / `reconciliations`, resolving
  `migrationReconciliations`, deleting resolved backups/incoming, and clearing
  `setupPending`.
- Do not add a skill registry row to `AGENTS.md` — native skill discovery
  replaces it.
- Do not invent domain or technical constraints — every stated constraint
  must come from the developer or from clear evidence in the code (cite
  the path).
- Do not remove the `## Setup Required` section before `bearings verify`
  reports zero failures and zero warnings.
- Re-running this command later is allowed: skip completed steps and focus
  on drift between the maps and reality.
