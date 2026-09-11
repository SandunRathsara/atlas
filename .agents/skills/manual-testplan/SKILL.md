---
name: manual-testplan
description: Design a small human-run browser or curl test plan from product scope. Use when the developer asks for a manual test plan, acceptance test plan, smoke test, or feature test checklist.
---

# Manual Test Plan

Select the smallest useful set of human-executed cases, then delegate its
checklist artifact to the `checklist` skill.

## Workflow

1. Establish the test basis. Read the requested issue, specification,
   acceptance criteria, changed behavior, and relevant known defects. Identify
   the primary actor, intended outcome, supported configuration, and explicit
   product risks. Ask a small number of blocking questions when these facts do
   not establish what success means.
2. Map the basis to reachable public interfaces. Inspect repository maps,
   runtime wiring, routes, UI flows, API contracts, authentication, feature
   flags, test data, and supported setup, reset, and cleanup commands. Record
   only browser and HTTP interfaces that a human can reach in the stated
   environment.
3. Select cases in execution order:
   - Start with the shortest principal happy path that proves the actor reaches
     the final intended outcome with ordinary valid data.
   - Add uncovered acceptance criteria.
   - Add only the highest-value alternatives and failures, selected from
     likelihood and impact, materially different input partitions, boundaries,
     business rules, state transitions, and relevant defect history.
   - Remove duplicate coverage and cosmetic data variations. Keep each case an
     independent, repeatable workflow with one main reason to fail.
4. Define each case before delegation. Give it an outcome-focused title, the
   criterion or risk it covers, its selection reason and priority,
   configuration, known initial state, concrete non-secret data, ordered
   actions and observable expectations, cleanup, and useful failure evidence.
5. Invoke the `checklist` skill with the selected cases and require the output
   at `checklists/tests/<slug>.json`. The `checklist` skill owns the JSON
   contract, identifiers, checklist structure, validation, library build,
   preview opening, and execution state.
6. Review the resulting test content against the test basis. Every acceptance
   criterion must be covered or named as an explicit gap, and every selected
   risk must have a case whose oracle can detect that failure.

## Browser Cases

- State the tested build, browser, relevant viewport or device class, user
  role, starting URL, and starting session state.
- Write actions in user and domain language while naming controls clearly
  enough to find. Put an observable expectation after each important
  validation point and verify the final visible or persisted outcome.
- Use supported fixtures, APIs, or seed commands for prerequisite data when
  that keeps the browser workflow focused. Capture the current screen and exact
  observed text first on failure.

## Curl Cases

- State the shell, base URL, authentication prerequisite, environment
  variables, and data setup. Use secret placeholders such as `$TOKEN` through
  the repository's established secret mechanism.
- Give a directly runnable `curl` command with the evidenced method, quoted
  URL, headers, and body. State the exact expected HTTP status, relevant
  headers, body fields, and externally observable side effects.
- Distinguish the HTTP result from curl's transfer exit status. State required
  redirect and cookie behavior, preserve TLS verification unless the test
  environment explicitly requires otherwise, and treat unexpected transport
  failures as blocked environment failures.

## Evidence Guardrail

Requirements state intent; running code, configuration, contracts, tests, and
developer confirmation establish reachable behavior. Ask for missing critical
facts. Never invent commands, routes, URLs, credentials, selectors, status
codes, response fields, messages, seed data, or cleanup behavior.

## Completion

Finish only when the test basis and reachable interfaces are explicit, the
principal happy path proves the intended outcome, each additional case has a
traceable risk or coverage reason, every oracle is concrete and observable,
and the `checklist` skill completes one checklist under `checklists/tests/`.
