# 06 - Web UI prototype: projects, spec list with blockers, Implement button states, run detail with PR status
Type: prototype
Status: open
Blocked by:

## Question

Build a rough, clickable HTMX mockup (static data is fine) of the Atlas UI so the user can react to it:

- Project picker.
- Spec list per project: title, issue number, labels, blockers with the blocking issue shown, Implement button enabled or disabled with the reason.
- Run detail: status, elapsed, last activity, linked PR with draft or open or merged state, cancel action.
- Live status region updated over SSE.
- Run activity: show two variants to react to, an event feed (tool calls, steps, retries, from issues/02) versus last assistant message only.

Resolve by linking the prototype and recording what the user changed.
