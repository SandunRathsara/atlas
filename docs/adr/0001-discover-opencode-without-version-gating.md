# ADR-0001: Discover OpenCode without server-version gating

## Status

Accepted on 2026-09-11 following explicit developer approval of the grilling for [#48](https://github.com/SandunRathsara/atlas/issues/48).

Partially superseded on 2026-09-11 by [ADR-0002](0002-versioned-releases-and-graceful-self-updates.md): Atlas startup and self-update activation use Atlas-only health and do not inspect OpenCode or require its readiness. The remaining discovery, observation, and operator-managed OpenCode decisions stay accepted.

## Context

OpenCode V2 ships frequent betas. Atlas currently rejects servers that do not report `0.0.0-beta-19135`, leaving Sessions queued even when a newer server could work with the client already installed in the Atlas release. The runtime gate compares the server against an approved string, not against the installed client package.

The developer accepts API-break risk in exchange for independently selecting the host's OpenCode server. Atlas must continue to discover an independently running service and never own its lifecycle.

## Scope

This decision covers runtime discovery and health version checks, Atlas health reporting, the independent systemd service's executable path, the optional operator-run staging helper, and deployment checks that enforce the baked-in server/client pairing.

It excludes Atlas release identity and client-bump policy ([#49](https://github.com/SandunRathsara/atlas/issues/49)), client auto-updates, compatibility shims, protocol adapters, supported-version ranges or matrices, new recovery paths or UI, changes to handoff sequencing, Session viewer behavior, credentials, Git, gh, Tailscale, snapshots, and host provisioning. Atlas must not start, upgrade, download, or replace OpenCode; the optional staging helper is an explicit operator action outside Atlas runtime and automatic deployment activation.

## Decision

1. **Discover without a version gate.** Omit the discovery `version` filter and remove approved-version validation from fallback `service.json` discovery and `health.version`. A missing or empty reported version is not itself a rejection reason. Preserve endpoint validation and existing health checks; a valid discovery record alone does not establish readiness.
2. **Keep existing API-failure behavior.** If connection succeeds but a later API call or decoding fails, retain today's pause, not-ready, and stale handling. Do not attempt to make handoff work around an incompatible client/server API. Preserve create → associate → one prompt → reconcile.
3. **Keep an independent service.** `opencode.service` uses `/opt/atlas/tools/opencode/current/bin/opencode2`. The operator controls the `current` symlink and explicitly restarts the service when selecting another installed version. Staging and Atlas deployment do not automatically switch the active server or restart OpenCode.
4. **Report observations, not an expected version.** `/health` reports the discovered server version when available and retains `ready`, without exact `expectedVersion` equality. Preserve SQLite-based HTTP status semantics: HTTP 200 can coexist with OpenCode not being ready. `deploy/check-health.sh` requires OpenCode readiness but no particular server version.
5. **Keep optional, explicit-version staging.** `deploy/stage-opencode.sh` requires an operator-supplied exact version, with no default or latest-version lookup. It stages only the server binary, not Atlas client/schema/protocol packages. Obtain integrity metadata for that exact version from the package registry, verify the download, fail if integrity is missing or mismatched, and record the selected version and integrity in the staging manifest. Staging prepares files only; the operator performs installation, active-version selection, and restarts separately. Atlas uses the client already installed in its release.
6. **Verify the selected artifact without pairing gates.** Startup and deployment checks follow the selected executable through `current` and report its actual version. Remove baked-in beta and server/client pairing gates, including Atlas client-package checks that currently block the independent service's startup. Preserve executable validation, SQLite/WAL verification, and applicable asset checks.

## Alternatives

- **Retain exact server pinning:** rejected because frequent beta releases unnecessarily prevent connection before the API is exercised.
- **Require a non-empty version or a supported range:** rejected; version is diagnostic information, not permission to connect. A compatibility policy is outside this decision.
- **Retire the service unit or staging helper:** rejected in favor of retaining an independent unit and an optional operator-run helper.
- **Automatically select latest, switch `current`, or restart during staging/deployment:** rejected; server selection and activation stay explicit operator actions.
- **Require operator-supplied integrity:** rejected in favor of exact-version registry integrity metadata. Download integrity is verified against the registry rather than a separately supplied checksum.
- **Add compatibility recovery or update the client automatically:** rejected; existing failure behavior and the Atlas release's installed client remain the contract.

## Consequences

- Newer or older servers can be attempted without rebuilding Atlas solely to change a server-version string. Readiness does not guarantee that every later API call will succeed.
- API-break risk is accepted. Existing readiness and stale indicators remain the failure surface; an incompatible server can still prevent useful work.
- Server selection is decoupled from Atlas deployment. The operator is responsible for choosing and activating an installed server version.
- Implementation follow-through covers `src/opencode.ts`, `src/app.ts`, `deploy/check-health.sh`, `deploy/check-opencode.sh`, `deploy/stage-opencode.sh`, `deploy/pins.env` (OpenCode staging inputs), `deploy/verify-sqlite-wal.sh`, `deploy/verify-assets.sh`, and `deploy/systemd/opencode.service`. Adjust artifact assertions to the server-only staging contract without removing unrelated verification.
- Replace pinned-server/pairing wording in operator documentation and refresh the corresponding DOMAIN/ARCHITECTURE baseline statements through their required repository-map workflow.
- Verification must cover a different and empty reported server version, invalid endpoints/unhealthy services, existing post-connect API failure behavior, readiness-based deployment health, selected-executable checks, explicit staging-version input, and missing/mismatched download integrity. Browser journeys are not required for this decision record.

## Supersession

No existing ADR is superseded by this record. This decision replaces only the exact OpenCode server-version/pairing requirement in the shipped contracts of [#28: Safe OpenCode handoff](https://github.com/SandunRathsara/atlas/issues/28) and [#37: Private host deployment](https://github.com/SandunRathsara/atlas/issues/37). Their other contracts, especially independent OpenCode lifecycle ownership, remain in force.

[ADR-0002](0002-versioned-releases-and-graceful-self-updates.md) partially supersedes Decision 4's deployment-readiness requirement and Decision 6's startup/deployment OpenCode inspection where they would gate Atlas startup or self-update activation. That path must validate Atlas independently, without querying OpenCode to approve activation. Normal Session discovery/readiness and observation, plus explicit operator-run OpenCode staging and diagnostics, remain governed by this ADR.
