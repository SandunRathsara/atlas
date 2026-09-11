---
description: Reconcile the domain, architecture, current codebase map, and C4 component source when meaningful repository drift or staleness is detected
---

# /refresh-repo-map

Reconcile the repository's knowledge maps with current evidence. This command is
the exclusive writer for `docs/DOMAIN.md`, `docs/ARCHITECTURE.md`,
`docs/CODEBASE_MAP.md`, and `docs/diagrams/c4-component.puml`. No other task may
edit these four artifacts directly.

Run it when committed changes alter business capabilities, workflows,
terminology, domain rules, stable technical shape, dependencies, integrations,
environment, capability ownership, module routes, utilities, interfaces,
state, hazards, verification paths, or C4 component topology — or when an
agent or developer detects staleness. Do not run it after every code edit
when the maps remain accurate.

## Ownership

| Artifact | Owner |
|---|---|
| `docs/DOMAIN.md` | this command |
| `docs/ARCHITECTURE.md` | this command |
| `docs/CODEBASE_MAP.md` | this command |
| `docs/diagrams/c4-component.puml` | this command |

Always create `docs/diagrams/` and `c4-component.puml` when absent. Maintain
source-only PlantUML: never render it and never modify another diagram.

## Artifact Contracts

| Artifact | Authority | Required output |
|---|---|---|
| `docs/DOMAIN.md` | User-confirmed business intent plus observable shipped behavior | problem and outcomes, actors, use cases, workflows, ubiquitous language, domain rules, boundaries/non-goals |
| `docs/ARCHITECTURE.md` | Accepted ADRs plus running configuration and code | system boundary, primary stack, significant dependencies, components/dependency direction, integrations/state ownership, runtime/deployment, development environment, architectural constraints |
| `docs/CODEBASE_MAP.md` | Running code, configuration, and tests | executable entry points, capabilities/concerns by `path#symbol`, critical flows, shared utilities/infrastructure, interfaces/state, change hazards, verification map |
| `docs/diagrams/c4-component.puml` | Reconciled architecture plus implemented component relationships | source-only PlantUML component topology; never render it |

`docs/CODEBASE_MAP.md` has no fixed size cap. Every retained line must route
source work, establish current behavior needed to select code, prevent an
unsafe change, or identify verification evidence.

Each Markdown artifact ends with this exact marker:

```markdown
<!-- repo-map-synced: <commit-sha> -->
```

The PlantUML artifact ends with this exact marker:

```text
' repo-map-synced: <commit-sha>
```

Each marker records the pre-command `HEAD` whose relevant evidence was
reconciled for that specific artifact. It is an incremental search baseline,
not freshness proof by itself.

## Evidence and Conflicts

Treat evidence in this order per artifact, using each artifact's own
authority row above: running code/configuration/tests, then accepted ADRs
and durable domain rules, then confirmed user/developer intent, then
existing map wording.

- Business intent versus implementation: expose the conflict and ask one
  focused question with a recommended resolution. Never silently redefine
  the domain from code.
- Implementation versus an accepted ADR or architectural constraint: ask
  whether the implementation should change or the decision should be
  superseded, and recommend a path from the available evidence.
- An unresolved conflict blocks that artifact's refresh: leave the affected artifact unchanged and report the conflict rather than publishing a falsely coherent map. Unaffected artifacts may still refresh independently.

## Baselines and Mode Selection

Each artifact records its own reconciliation baseline, so mode selection is
independent per artifact:

- Full reconciliation when the artifact (or the C4 source) is missing, its
  marker is missing, malformed, unavailable locally, or not an ancestor of
  pre-command `HEAD`, the user requests a full refresh, or incremental
  evidence reveals structural drift outside the expected impact closure.
- Incremental reconciliation when the artifact exists and its marker names
  an available ancestor of pre-command `HEAD`.

## Full Reconciliation

1. Capture pre-command `HEAD` as the reconciliation baseline.
2. Read manifests, build configuration, and executable entry points.
3. Identify module boundaries through exports, imports, registration sites,
   and ownership directories.
4. Trace public interfaces, external integrations, state stores, and
   schemas when present.
5. Trace implementations and tests for critical flows and hazards.
6. Read accepted ADRs and confirmed domain/business intent that constrain
   current code.
7. Reconcile the artifact's complete required output and the C4 component
   model when its topology is in scope.
8. Set that artifact's sync marker to the captured pre-command `HEAD` only
   after its reconciliation succeeds.

File size is not an architecture signal. Never select a module by choosing
its largest file.

## Incremental Reconciliation

1. Capture pre-command `HEAD`; parse the artifact's own marker and verify
   its commit exists locally.
2. Verify the marker is an ancestor of pre-command `HEAD`; otherwise switch
   that artifact to full reconciliation.
3. Inspect every changed source, config, test, and durable-doc path from
   the marker's commit through pre-command `HEAD` that is relevant to that
   artifact's authority.
4. Expand each changed path to its direct callers/callees and co-change
   relationships to establish impact closure.
5. Edit only the affected sections of that artifact and preserve unrelated
   verified content.
6. Update the C4 model only when component boundaries or relationships
   changed.
7. Set that artifact's sync marker to the captured pre-command `HEAD` only
   after its reconciliation succeeds.
8. Escalate that artifact to full reconciliation when impact closure cannot
   be established with confidence.

## Validation and Routing Probes

Before reporting completion:

1. Validate every retained path, symbol, command, and relationship against
   the repository.
2. Run these probes in fresh context that receives only the draft
   artifacts and the scenario, never the source-reading context:
   - Explain: select a critical behavior; identify entry point, flow,
     state/side effects, failure semantics, and targeted source.
   - Feature: select a plausible extension; identify owner, extension seam,
     affected contracts/state, co-change edges, and tests.
   - Bug: select a plausible public symptom; narrow diagnosis to an owning
     flow, likely files, and regression-test location.
3. Rerun any failed probe after adding the missing knowledge. A failed
   probe blocks completion for the affected artifact.

## Completion

1. Show the diff for every changed owned artifact.
2. Show the evidence used per changed artifact and any unresolved
   conflicts, naming the artifact each conflict blocked.
3. Update only the sync marker of each artifact whose reconciliation
   succeeded; leave unresolved artifacts and their markers unchanged.
4. Leave all changes uncommitted for the normal review and commit workflow.

## Boundaries

- Keep this command generic: no project-specific scanning heuristics or
  named project files beyond the four owned artifact paths.
- Do not create or register skills, render the PlantUML diagram, add a
  fixed map size cap, or modify unrelated documentation.
- Do not create commits; leave staging and commit decisions to the
  developer.
- Do not treat a marker, task intent, or existing wording as stronger
  evidence than running code, configuration, and tests.
