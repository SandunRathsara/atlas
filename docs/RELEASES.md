# Atlas releases

Atlas publishes immutable, ready-to-run Linux x64 release directories from
tags. The initial release identity is `v0.1.0+build.1`.

## Identity and ordering

Release tags have the exact form `vMAJOR.MINOR.PATCH+build.BUILD`, using decimal
integers without leading zeroes and a positive build number. The tag is the
only maintained release identity; CI generates SemVer, build, and exact Git SHA
metadata from it. An ordinary untagged checkout reports itself as unpublished
development code rather than borrowing a release identity.

SemVer communicates intended Atlas behavior: fixes increment patch, features
increment minor, and breaking changes increment major. A behavior-preserving
dependency/client update may keep SemVer and increment only the build. Build
numbers increase globally and never reset. Releases sort by SemVer first, then
by numeric build when SemVer is equal; standard SemVer build-metadata ordering
is not used.

## Maintainer publishing procedure

1. Commit the complete release tree. Never let release CI choose a newer
   dependency. For an OpenCode client bump, update `package.json`, `bun.lock`,
   `ATLAS_OPENCODE_CLIENT_VERSION` in `deploy/pins.env`, and documentation that
   names the pin. This pin records the packaged client only and never selects
   or gates the independently managed OpenCode server.
2. Run `bun install --frozen-lockfile`, `bun run check`,
   `bun run verify:issue57`, and the affected checks. Confirm the proposed
   build exceeds every published build and the SemVer content rule above.
3. Create and push the tag for that reviewed commit. For example, the first
   approved release is tagged `v0.1.0+build.1`. Pushing the tag starts
   `.github/workflows/release.yml`; no second version file is edited.
4. Keep the tag and release immutable. Never rerun by replacing release assets
   or moving a published tag. Correct any problem in a new commit with a new,
   globally higher build.

The workflow serializes all release publication, validates against existing
GitHub Releases, installs the frozen lockfile, typechecks, builds and smokes the
exact tagged tree, then creates the release without overwrite flags. A rerun of
an already published identity fails. Verification uses local synthetic
artifacts and never creates a disposable GitHub Release.

## Producer/consumer contract (schema 1)

Every GitHub Release contains these public assets:

- `atlas-release.json` — release metadata described below.
- `atlas-linux-x64-<tag>.tar.gz` — one read-only release directory containing
  the tagged source, production `node_modules`, built `public/app.css`, helpers,
  and every tracked deployment asset.
- `atlas-linux-x64-<tag>.tar.gz.sha256` — GNU SHA-256 checksum sidecar.

The archive also contains `RELEASE_METADATA.json`, byte-for-byte equal to the
published `atlas-release.json`. A consumer reads metadata before choosing an
artifact, requires `schemaVersion: 1`, verifies the sidecar, extracts to a new
directory, then confirms the candidate's authenticated `/health` identity and
storage health. It never installs dependencies or builds CSS after extraction.

```json
{
  "schemaVersion": 1,
  "identity": {
    "published": true,
    "tag": "v0.1.0+build.1",
    "semver": "0.1.0",
    "build": 1,
    "gitSha": "<full tagged Git SHA>"
  },
  "artifact": {
    "name": "atlas-linux-x64-v0.1.0+build.1.tar.gz",
    "checksum": "atlas-linux-x64-v0.1.0+build.1.tar.gz.sha256",
    "os": "linux",
    "architecture": "x64",
    "format": "tar.gz"
  },
  "runtime": {
    "bun": "1.3.14",
    "git": "2.55.0",
    "gh": "2.100.0"
  },
  "rollback": {
    "codeOnlyCompatible": true,
    "manualMaintenanceInstructions": null
  }
}
```

`runtime` lists operator-installed host requirements; publishing never upgrades
them or OpenCode. `rollback.codeOnlyCompatible` is authoritative—version order
does not imply rollback safety. When false, `manualMaintenanceInstructions`
must be non-empty and a normal updater must refuse activation. Schema-1 fields
will not be removed or reinterpreted; a future incompatible contract requires
an explicit compatibility path readable by the installed and previous release.

## Discovery, staging, and update policy

An installed Atlas process lists all public GitHub Releases at startup and every
four hours; **Check now** uses the same path. It reads every candidate's
`atlas-release.json`, orders candidates with the release ordering above, and
retains the complete known set. **Approval required** is the durable default.
When an installation selects **Automatic for current SemVer builds**, every
check prefers the highest newer numeric build with the exact installed SemVer,
even when a newer patch, minor, or major Release also exists. With no such
build, the newest Release is staged but still waits for **Install**. A failed
check retains the last successful set and is not reported as up to date.

The independently installed `atlas-updater.service` owns archive download,
checksum verification, extraction, and durable staging status. Atlas submits
validated metadata over its authenticated Unix socket. The updater stages one
request at a time beneath `/opt/atlas/releases`, resumes an interrupted durable
request after its own restart, verifies embedded metadata before an atomic
rename, and never changes `/opt/atlas/current`. Repeated requests for the same
release reuse the complete staged tree, and a lost request response is
reconciled from updater status. Host runtime differences and rollback-incompatible
release instructions remain visible on `/updates`.

Staging does not pause Session preparation, install dependencies, build CSS,
select a release, restart Atlas, or inspect/manage OpenCode. A staged,
host-runtime-eligible, code-only-compatible candidate exposes **Install**. In
automatic mode, only a newer numeric build of the exact installed SemVer enters
the same activation path without that click; all SemVer changes remain explicit.
The policy is stored per installation in updater state and survives Atlas and
updater restarts, activation, and rollback. An approval or applicable automatic
decision is durable before Atlas waits up to five minutes for
preparation/handoff to reach a safe checkpoint. Repeated checks, submissions,
and policy changes reconcile against the one updater status boundary rather
than starting a second activation.

The surviving updater stops only Atlas, atomically changes `/opt/atlas/current`,
restarts Atlas, and allows 60 seconds for the candidate's exact identity and
healthy persistence. It uses the Atlas-only form of the authenticated health
route and never queries or gates on OpenCode. Failure selects and verifies the
previous working release without restoring older data. The failed tag remains
suppressed from automatic activation across restarts until **Retry**; a later
eligible build of the current SemVer can proceed normally. A checkpoint timeout
is a durable abandonment and leaves the current release selected.

Updater schema 1 keeps its original staging fields and additively stores the
installation policy, activation state, previous-release identity,
progress/result, failed-tag suppression, and cleanup outcomes. Missing policy in
older state reads as approval required, while subsequent writes preserve an
existing selection so the previous Atlas release can still read staging status
after rollback.

## Release retention

The updater cleans only managed Release directories older than the selected
Release. It protects the selected Release, the previous working Release, the
staged candidate, every in-flight activation/recovery path, and every Release
containing an absolute helper path in the durable Session scope registry. A
failed candidate is not promoted to previous-working status merely because it
was briefly selected; it remains protected while staged for Retry.

Cleanup shares the updater's serialized lifecycle. It runs on updater startup
and after staging, abandonment, successful activation, or recovered rollback.
During activation/recovery it completes before the updater publishes a terminal
result, so a restarting Atlas remains paused until selection and retention are
settled. Each cleanup target is recorded in schema-1 updater state before
removal. A restart re-evaluates current selections and helper references before
resuming partial cleanup.

Cleanup failure is reported separately from activation. It never changes the
healthy selected Release or starts another activation. Session directories,
SQLite data, credentials, stable service trees, and operator-managed tools are
outside `/opt/atlas/releases` and are never cleanup targets.

Authenticated health reports the same identity under `atlas.release`, existing
`persistence` health, and independent OpenCode diagnostics. Candidate success
uses `atlas.process`, exact `atlas.release`, and `persistence.healthy`; it does
not require OpenCode availability, readiness, or version inspection.
