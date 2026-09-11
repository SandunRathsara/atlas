---
name: <skill-name>
description: <description>
metadata:
  kind: guardrail
  anchors:
    - <anchor>
---

# <Guardrail title>

## Why

<System scale and use case that make this rule suitable.>

## Applies when

<Directories, libraries, layers, or verbs governed by this rule.>

## Decision procedure

1. <Positive step.>

## Exemplars

- `<path>#<symbol>` - <Established shape to follow. Include one to three exemplar lines.>

## Known exceptions

- <Known exception, or None confirmed.>
- An agent may deviate only after asking the developer, then must add the approved exception here.

## Does not govern

<Nearest concern to which this rule must not be applied.>

## Verification

`<violation-check-command>`

Completion criterion: <Observable successful result.>

## References

- <ADR or documentation path, or None confirmed.>
