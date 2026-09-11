---
name: checklist
description: Create a generic executable checklist for human-run procedures. Use when work needs an operational checklist for setup, deployment, release, verification, maintenance, or another process a person must perform.
---

# Checklist

Create one evidence-backed checklist for a human operator. The JSON contains
authored instructions; the static previewer owns execution state.

## Workflow

1. Read `.agents/skills/checklist/schema.reference.json` and inspect the
   repository sources that define the requested procedure. Resolve every
   mechanic, command, URL, prerequisite, expected result, and hazard from
   running code, configuration, authoritative documentation, or developer
   confirmation. Ask the developer about any required detail the evidence does
   not establish.
2. Choose a lowercase slug path under `checklists/`. The final segment is the
   checklist slug and every preceding segment is its category. Use nested
   categories when useful, for example `checklists/operations/servers/rotate-keys.json`
   has category `operations/servers` and identity `operations/servers/rotate-keys`.
3. Write exactly one JSON file at `checklists/<category...>/<slug>.json`.
   Category identity and slug come only from the path; omit them from the JSON.
4. Run
   `node .agents/skills/checklist/scripts/validate.mjs checklists/<category...>/<slug>.json`.
   Fix every reported violation until it exits zero and prints `OK`.
5. From the repository root, run
   `node .agents/skills/checklist/scripts/build.mjs`. Fix every reported
   checklist-library error until the build exits zero.
6. Open `.agents/skills/checklist/previewer/index.html` with the environment's
   browser-opening tool. If opening fails, report the absolute file path so the
   developer can open it. The command must finish; the static previewer needs
   no server process.

## Content Policy

- Organize sections in execution order and keep each checklist item to one
  primary action or verification. Use `info` sections for concise context that
  the operator does not mark as executed.
- Give every executable item exact, evidence-backed mechanics and an observable
  `expectedResult`. Put commands in `codeBlocks`; distinguish literal values
  from placeholders and state where each command runs.
- Use `links` for authoritative background material instead of expanding the
  checklist into a manual. Include only verified, safe destination URLs and
  clear labels.
- Put a `warning` before destructive, irreversible, privileged,
  security-sensitive, externally visible, data-changing, or access-loss
  actions. State the concrete hazard and any prerequisite that preserves
  operator control.
- Add `failureGuidance` when an item can fail or block progress. Give an
  evidence-backed next action such as stop, retry, diagnose, roll back, or
  escalate, plus the observable recovered state when recovery applies.
- Refer to credentials through the repository's established secret mechanism
  or documented location. Keep passwords, tokens, private keys, and other
  secret values out of checklist content.
- Keep authored content only in the JSON. Statuses such as `not-started`,
  `complete`, `failed`, `blocked`, and `not-applicable`, and all operator
  progress, belong to browser-local previewer state.
- Treat absent evidence as an unresolved input. Ask for it or state a verified
  limitation; do not invent mechanics, URLs, commands, credentials, expected
  behavior, warnings, or recovery steps.

## Completion

Finish only when exactly one authored checklist file exists for this request,
its mechanics and outcomes trace to evidence, its validator prints `OK`, the
full library build succeeds, and the static previewer opens or its absolute path
is reported after an opening failure.
