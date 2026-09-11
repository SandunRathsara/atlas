# ADR-0002: Versioned releases and graceful Atlas self-updates

## Status

Accepted on 2026-09-11 in [GitHub issue #49](https://github.com/SandunRathsara/atlas/issues/49).

## Context

Atlas releases were identified only by Git SHA and staged manually. That did
not distinguish an Atlas behavior change from a behavior-preserving dependency
update, provide a ready-to-run published artifact, or let an installation
update itself. Updating is also more than restarting the UI process: in-flight
preparation and handoff need safe checkpoints, Agents need uninterrupted
credentials and helpers, and a candidate that cannot boot cannot recover
itself. OpenCode is independently owned and may be unavailable during an Atlas
update.

## Scope

This decision applies to Atlas release identity and publishing, installation
update policy and controls, preparation/handoff pausing, credential continuity,
host-side activation and rollback, release retention, and bootstrap. It does
not authorize Atlas to manage OpenCode or host runtimes.

## Decision

- Identify releases as SemVer plus a globally increasing numeric build,
  beginning with `v0.1.0+build.1`. SemVer describes intended Atlas behavior;
  behavior-preserving dependency changes may keep SemVer and increment only the
  build. Order by SemVer first and build second when SemVer is equal.
- Make the release tag authoritative. A serialized tag-triggered workflow
  rejects malformed, reused, non-increasing, or older identities, builds the
  exact tagged commit from its frozen lockfile, and publishes an immutable
  ready-to-run Linux x64 archive. Generated metadata carries SemVer, build, Git
  SHA, artifact/checksum selection, host requirements, and explicit code-only
  rollback compatibility. Published artifacts are never replaced.
- Let each installation discover published releases at startup and every four
  hours, with a manual check. Approval is the default. Automatic policy may
  install only a newer build of the installed SemVer; every SemVer change still
  requires approval from a user with existing Atlas access.
- Stage before pausing new starts. Wait at most five minutes for Atlas-owned
  preparation/handoff to reach a safe checkpoint, but never wait for or stop a
  Running, Waiting, or Idle OpenCode Session. Preserve queued work, Session
  identity, reservations, reconciliation, and the one-prompt contract.
- Keep credential serving and referenced Session helpers alive independently
  of the restarting Atlas UI process. A surviving host updater serializes
  activation, records durable progress/results, atomically selects complete
  release trees, and retains current, previous-working, and referenced trees.
- Require the candidate, within 60 seconds, to report the requested release
  identity and healthy Atlas storage. **Atlas startup and self-update
  activation do not inspect OpenCode versions, require client/server pairing,
  or depend on OpenCode readiness.** Normal Session discovery and observation
  continue independently and retain conservative not-ready/stale behavior.
- Restore the previous working code automatically after failed activation
  without restoring old shared data. Suppress automatic retry of that build
  until explicit retry; later eligible builds remain usable. A release that
  cannot guarantee code-only rollback is marked for manual maintenance and is
  ineligible for normal web activation.
- Keep Bun, Git, gh, OS packages, and OpenCode operator-managed. One documented
  bootstrap installs the surviving updater and independent credential service;
  Atlas updates only Atlas and its shipped components.

## Alternatives

- Keep SHA-only identities or infer behavior from dependency versions:
  rejected because operators need both behavior and exact-build identity.
- Use ordinary SemVer build-metadata precedence: rejected because SemVer ignores
  build metadata, while Atlas requires a global numeric publication sequence.
- Let the candidate process activate or recover itself: rejected because a
  failed candidate cannot be the recovery authority.
- Stop OpenCode or require OpenCode health/version compatibility during Atlas
  activation: rejected because Agent execution is independently owned and must
  continue.
- Restore database snapshots for ordinary rollback: rejected because that can
  rewind state while OpenCode and GitHub work continue.

## Consequences

Release preparation is tag-driven and immutable; a correction always needs a
new global build. Database and updater contracts must remain readable across
the previous-working rollback boundary or declare manual maintenance. Atlas
health has an Atlas-only identity/storage success path, while OpenCode
readiness remains diagnostic for normal Session operation.

## Supersession

This ADR partially supersedes [ADR-0001](0001-discover-opencode-without-version-gating.md)
only where its OpenCode readiness/inspection requirement would gate Atlas
startup or self-update activation. ADR-0001 continues to govern normal Session
discovery, observation, service selection, and explicit OpenCode diagnostics.
