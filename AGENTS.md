# Atlas - Agent Seed

## Project

Atlas lets a team browse GitHub repositories and start autonomous OpenCode Sessions from team-authored Specs.

Primary stack: Bun 1.3.14, TypeScript, Hono, HTMX, Tailwind CSS 4 + daisyUI 5, SQLite. Details: `docs/ARCHITECTURE.md`.

## Knowledge Routing

| Work | Read | How |
|---|---|---|
| User behavior, requirements, workflows, terminology, scope, or domain rules | `docs/DOMAIN.md` | Read before behavior or requirements work. |
| Domain vocabulary and avoided synonyms | `CONTEXT.md` | Read before naming domain concepts. Flag ADR conflicts rather than silently overriding. |
| Components, dependency direction, integrations, state ownership, significant dependencies, runtime/build shape, or local setup | `docs/ARCHITECTURE.md` | Read before structural or environment work. |
| Locating, explaining, changing, or debugging source | `docs/CODEBASE_MAP.md` | Read the entire file before source work, then follow its `path#symbol` anchors. |
| A consequential domain or technical decision | `docs/adr/INDEX.md` | Read the index first, then only matching ADRs. |
| Planning a new capability | `docs/deferred/INDEX.md` | Read the index first, then only matching deferred details. |
| Creating, listing, labeling, commenting on, or closing GitHub issues or specs | `docs/agents/issue-tracker.md` | Use the `gh` CLI. Read before tracker operations. |
| Applying or interpreting issue triage labels | `docs/agents/triage-labels.md` | Read before labeling. |
| UI planning, implementation, debugging, or review — including templates, styles, components, and HTMX | `DESIGN.md` | Load on demand. Flag conflicts with `CONTEXT.md` or the originating issue. |

## User-Facing Output

Assume the user has ADHD and cannot comprehend long descriptions. Tailor all your responses to the user's reading ability.
