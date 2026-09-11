---
name: orchestrate
description: Run a large task as an orchestrator that plans and decides in the main context and delegates context-heavy work to sub-agents. Use only when the developer invokes /orchestrate by name.
disable-model-invocation: true
---

# Orchestrate

Act as the orchestrator. The main context holds the plan, the decisions, and
the synthesis; sub-agents absorb the raw material — file dumps, logs, command
output — and return conclusions, not transcripts. If this harness cannot start
sub-agents, tell the developer, then run the same plan inline.

## Workflow

1. Plan in the main context. Break the task into work items and mark each
   `delegate` or `keep` using the Delegation table. The plan is done when every
   item has a mark and the delegated items name their dependencies.
2. Dispatch a sub-agent for every `delegate` item, following Sub-agent briefs.
   Run independent items concurrently; run items that touch the same files in
   sequence or merge them into one brief.
3. Integrate. Read only the sub-agents' conclusions, make the decisions in the
   main context, and dispatch follow-up sub-agents for gaps the conclusions
   expose.
4. Report: the decisions made, what each sub-agent concluded, and the final
   result with its verification.

## Delegation table

| Work | Sub-agent returns |
|---|---|
| Search and exploration across many files | `path#symbol` locations plus a one-paragraph answer |
| Bulk reading: large files, logs, external docs | Only the facts that bear on the task, with citations |
| Verbose commands: tests, builds, lints | Pass or fail, plus only the failing output |
| Implementation of an independent plan slice | Changed file list plus its self-check result |

Keep in the main context: the plan, choices between approaches, targeted reads
of already-located sections, and every question for the developer.

## Sub-agent briefs

A sub-agent starts with an empty context. Every brief carries:

- The goal and its completion criterion — how the sub-agent knows it is done.
- Every input it cannot discover cheaply: paths, commands, constraints, and
  the repository conventions that apply.
- The return contract: the shortest artifact the orchestrator can act on,
  in the shape the Delegation table names.
- For implementation work: the exact plan slice it owns and the boundary of
  that slice.
