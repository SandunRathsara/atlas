# ADR-0001: Discover OpenCode without version gating

## Status

Accepted on 2026-09-11 in [GitHub issue #48](https://github.com/SandunRathsara/atlas/issues/48).

## Context

Atlas required the independently running OpenCode server to report the exact
beta version pinned for Atlas's installed `@opencode-ai/client`. OpenCode V2
ships frequent betas, so an operator-selected usable server could leave Atlas
up while Sessions remained queued before Atlas attempted the API. The operator
accepts the risk that a later API call may fail when the installed client and
selected server differ.

## Scope

This decision applies to OpenCode discovery and health, the independent
`opencode.service` executable selection and preflight, optional server staging,
and deployment verification. It does not change Atlas's installed client,
handoff sequencing, failure recovery, viewer, or ownership of the OpenCode
process.

## Decision

- Omit version filtering during primary discovery. Fallback service-record
  discovery and server health validation do not reject a missing, empty, or
  different version by themselves. Endpoint, authentication, health-response,
  and event-stream validation remain required.
- Use the `@opencode-ai/client` installed in the Atlas release. If connection or
  a later API call fails, retain the existing pause, not-ready, stale, retry,
  reconciliation, and uncertainty behavior. Preserve create → associate → one
  exact initial prompt → reconcile.
- Health reports OpenCode readiness and the observed server version when
  available, without an expected-version equality. Persistence continues to
  determine the HTTP status, so OpenCode may be not ready in an HTTP 200
  response. Deployment health requires readiness, not a version value.
- Keep the independent `opencode.service` and run the operator-selected
  `/opt/atlas/tools/opencode/current/bin/opencode2`. Only the operator changes
  `current` and explicitly restarts OpenCode. Atlas deployment and staging do
  neither.
- Keep an optional operator-run staging helper that requires an explicit exact
  version and stages only the server binary. Verify the download against that
  version's package-registry integrity metadata, fail when integrity is missing
  or mismatched, and record the version and integrity in the manifest.
- Startup and SQLite/WAL verification follow the selected executable and report
  its actual version. They do not gate startup on a baked-in server version or
  Atlas client-package version. Applicable executable, asset, lifecycle, and
  SQLite safeguards remain in force.

## Alternatives

- Keep exact server/client equality: rejected because it prevents attempting a
  usable independently selected server.
- Require a non-empty version, version range, predicate, or compatibility
  matrix: rejected because version metadata is diagnostic, not permission to
  connect.
- Add compatibility shims or new recovery paths: rejected; accepted API-break
  risk uses existing failure behavior.
- Let Atlas select, install, start, upgrade, or restart OpenCode: rejected;
  OpenCode lifecycle remains operator-owned and independent.
- Stage matching client/schema/protocol packages with the server: rejected;
  Atlas's release owns its installed client.

## Consequences

Atlas can connect to a healthy independently selected server without knowing or
approving its version. Operators can observe a reported version without it
becoming a gate. Readiness does not guarantee that every later API call is
compatible; such failures remain visible through the existing conservative
Session and transport states, without duplicate handoff effects or invented
terminal outcomes. Server activation remains an explicit operator action.

## Supersession

This ADR supersedes only the exact OpenCode server-version and server/client
pairing requirements established by [#28](https://github.com/SandunRathsara/atlas/issues/28)
and [#37](https://github.com/SandunRathsara/atlas/issues/37). Their remaining
requirements stay in force. [ADR-0002](0002-versioned-releases-and-graceful-self-updates.md)
partially supersedes this ADR only where OpenCode readiness or inspection would
gate Atlas startup or self-update activation. Normal Session discovery,
observation, service selection, and explicit OpenCode diagnostics remain here.
