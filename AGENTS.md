The user has ADHD and cannot comprehend long descriptions. Tailor all your responses to the user's reading ability.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### UI design

- Before UI planning, implementation, debugging, or review—including templates, styles, components, and HTMX interactions—use the read tool to load [`DESIGN.md`](DESIGN.md) from the repository root. This link is a read instruction, not an automatic file import. Load it on demand rather than for unrelated backend work.
- Treat `DESIGN.md` as the authoritative visual and interaction guide. Use `CONTEXT.md` for domain meaning and the originating issue for feature scope; flag conflicts rather than silently overriding either.
- Reuse shared theme tokens, layouts, and components. Change design rules only when the task explicitly authorizes a design change; keep the guide and implementation synchronized.
- When delegating UI work, include the requirement to read `DESIGN.md` in the handoff; do not assume the other agent has read it.
- Before reporting UI work complete, run the applicable acceptance checks in `DESIGN.md`. Report what was verified and any gaps; source inspection alone is not visual verification.
