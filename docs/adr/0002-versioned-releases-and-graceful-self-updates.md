# ADR-0002: Versioned releases and graceful Atlas self-updates

## Status

Accepted on 2026-09-11 in [GitHub issue #49](https://github.com/SandunRathsara/atlas/issues/49).

## Context

Atlas releases were identified only by Git SHA and activated manually. A safe
self-update must identify published behavior and builds, preserve queued and
active Sessions, keep Agent credentials available, and recover even when a
candidate Atlas process cannot boot. Atlas update success must not depend on
OpenCode availability or version metadata.

## Scope

This decision applies to Atlas release identity and publishing, installation
update policy and controls, preparation/handoff pausing, credential continuity,
host-side activation and rollback, release retention, and bootstrap. It does
not authorize Atlas to manage OpenCode or host runtimes.

## Decision

- Release Atlas as SemVer plus a globally increasing build number, beginning
  with `v0.1.0+build.1`. The release tag is authoritative and generates
  metadata containing SemVer, build number, and tagged Git SHA.
- A release tag publishes an immutable, ready-to-run Linux x64 archive from the
  frozen tagged tree. Bun, Git, gh, OS packages, and OpenCode remain
  operator-managed.
- Installations check published releases at startup, every four hours, and on
  request. Approval is the default; automatic activation is limited to newer
  builds of the installed SemVer.
- Stage before pausing. Pause new Atlas preparation/handoff, let in-flight
  Atlas-owned work reach durable safe checkpoints, and retain queued work.
  Abandon the pause after five minutes rather than interrupt uncertain work.
  Running, Waiting, and Idle OpenCode Sessions do not block activation.
- Keep credential serving and Session helper references available independently
  of Atlas UI process activation. Reconnect through saved OpenCode Session
  identities without replaying create or the initial prompt.
- A surviving host updater atomically selects a staged release and requires the
  expected Atlas identity plus healthy storage within 60 seconds. OpenCode
  version and readiness are excluded from that gate.
- On candidate failure, restore the previous working code without restoring old
  data. Suppress automatic retry of that build. Releases that cannot honor this
  rollback contract require documented manual maintenance.
- Retain current, previous working, and Session-referenced releases; remove only
  older unreferenced releases.

## Alternatives

- Keep SHA-only identity and manual activation: rejected because installations
  cannot express behavior/build ordering or perform managed recovery.
- Require matching OpenCode client/server versions or readiness for activation:
  rejected because OpenCode is independent and unavailable OpenCode must not
  block an Atlas update.
- Restart immediately or terminate in-flight work: rejected because clone and
  handoff transports can be uncertain and must not be replayed.
- Restore a database snapshot on ordinary rollback: rejected because it would
  rewind shared state while Agent work continues.

## Consequences

Atlas updates need durable release/update state, a host-side authority that
survives candidate failure, an independent credential service, and compatible
rollback contracts. Updates may wait up to five minutes for Atlas-owned work,
but never wait for Agent execution. OpenCode observation may remain stale after
a successful Atlas activation without invalidating the activation.

## Supersession

This ADR partially supersedes
[ADR-0001](0001-discover-opencode-without-version-gating.md) only where its
deployment health or OpenCode inspection would gate Atlas startup or self-update
activation. ADR-0001 continues to govern normal OpenCode discovery,
observation, staging, and operator diagnostics.
