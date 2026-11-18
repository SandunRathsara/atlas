# Atlas releases

Atlas publishes immutable Linux x64 Releases from a manual release workflow. Each Release is one
compiled `atlas` binary; the host needs no Bun.
The initial release identity is `v0.1.0+build.1`.

## Identity and ordering

Release tags have the exact form `vMAJOR.MINOR.PATCH+build.BUILD`, using decimal
integers without leading zeroes and a positive build number. The tag is the
only maintained release identity. Nobody pushes it by hand: the release
workflow computes the next tag from the published Releases, embeds it with
SemVer, build, and the exact Git SHA into the binary and metadata
(`scripts/build-release.ts`), then creates the tag and Release together. An ordinary untagged checkout reports itself as unpublished
development code rather than borrowing a release identity.

SemVer communicates intended Atlas behavior: fixes increment patch, features
increment minor, and breaking changes increment major. A behavior-preserving
dependency/client update may keep SemVer and increment only the build. Build
numbers increase globally and never reset. Releases sort by SemVer first, then
by numeric build when SemVer is equal; standard SemVer build-metadata ordering
is not used.

## Maintainer publishing procedure

Full steps: `.github/release/README.md`.

1. Land the complete release content on `main`. Never let release CI choose a
   newer dependency. For an OpenCode client bump, update `package.json` and
   `bun.lock`; `scripts/build-release.ts` refuses to build when they and the
   installed package disagree. The client version is compiled into the binary
   and reported as `openCodeClient`; it never selects or gates the
   independently managed OpenCode server.
2. Run the release: **Actions → Release → Run workflow** on `main`, or
   `gh workflow run release.yml --ref main -f bump=minor` (add
   `-f dry_run=true` to try it without publishing). Pick `patch`, `minor`,
   `major`, or `build` by the SemVer content rule above. Only logins in
   `RELEASERS` (top of `.github/workflows/release.yml`) may run it. Do not
   push tags by hand; the workflow computes the next tag and no version file is
   edited.
3. Keep the tag and release immutable. Never re-upload assets or move a
   published tag. Correct any problem in a new commit with a new, globally
   higher build.

The workflow has four jobs. `plan` checks the allowlist and `main`, validates
against existing GitHub Releases, computes the tag, and pins the `main` SHA.
`gate` runs the full `check.yml` tier on that SHA. `build` builds and
smoke-tests the four files. `publish`, the only job with write access, runs no
repo code, re-checks the digest and checksum, then creates the tag and Release
together without overwrite flags. If anything fails before publish, nothing is
tagged. Runs never overlap. Verification uses local synthetic artifacts and
never creates a disposable GitHub Release.

`bun run build:release -- <tag> <sha> <out>` (`scripts/build-release.ts`) is
the only producer. It refuses a dirty checkout or a SHA other than `HEAD`,
needs no secrets, and writes exactly the four assets below.
`scripts/verify-release-artifact.sh <tag> <sha> <out>` builds them, checks the
sidecar, runs the binary with no Bun on `PATH`, and checks its `/health`
identity.

## Producer/consumer contract (schema 2)

Every GitHub Release contains these public assets:

- `atlas-release.json` — release metadata described below.
- `atlas-linux-x64` — the compiled Atlas binary (all subcommands, CSS, and
  helpers embedded).
- `atlas-linux-x64.sha256` — one line: `<sha256-hex>  atlas-linux-x64`.
- `install.sh` — the installer, a byte copy of the repo's `install.sh`. It
  downloads the three files above, checks the SHA-256, and runs `atlas setup`.
  Install and adopt steps: [`INSTALL.md`](INSTALL.md).

A consumer reads metadata first and requires `schemaVersion: 2`. Schema 1
(tarball Releases) and unknown schemas are refused with a clear message. The
download must match `asset.size` and `asset.sha256` (and the sidecar) before
the file is ever executed. Example (real build output, fixture SHA):

```json
{
  "schemaVersion": 2,
  "identity": {
    "published": true,
    "tag": "v0.1.0+build.1",
    "semver": "0.1.0",
    "build": 1,
    "gitSha": "cccccccccccccccccccccccccccccccccccccccc"
  },
  "asset": {
    "name": "atlas-linux-x64",
    "checksum": "atlas-linux-x64.sha256",
    "sha256": "89f4ea5223d559c2b7821bbd173d891e24a60bd25f8565cb1aae4ad5512d9340",
    "size": 94832768,
    "os": "linux",
    "architecture": "x64"
  },
  "minimumHostTools": { "git": "2.36.0", "gh": "2.3.0" },
  "openCodeClient": "2.3.2",
  "rollback": {
    "codeOnlyCompatible": true,
    "manualMaintenanceInstructions": null
  }
}
```

`minimumHostTools` are numeric minimums (`src/host-tools.ts`) for
operator-installed tools; publishing never upgrades them or OpenCode.
`rollback.codeOnlyCompatible` is authoritative—version order does not imply
rollback safety. When false, `manualMaintenanceInstructions` must be non-empty
and a normal updater must refuse activation.

### Release folder

Every installed Release is `/opt/atlas/releases/atlas-<tag>/`, made only by
`buildReleaseFolder` (`src/release-layout.ts`):

```
atlas                      the binary (read-only)
RELEASE_METADATA.json      byte-equal to atlas-release.json
bin/git                    wrapper: real git + Atlas credential helper
bin/gh                     shim → atlas gh
bin/git-credential-atlas   shim → atlas git-credential
```

The builder hashes the binary and refuses a SHA-256 mismatch before running
it, then runs `atlas version --json` (never as root) and refuses an identity
mismatch. It writes a temporary sibling, fsyncs, and renames, so a folder is
either complete or absent. Re-running it for an intact folder is a no-op.

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

The independently installed `atlas-updater.service` owns binary download,
checksum verification, Release-folder building, and durable staging status. Atlas submits
validated metadata over its authenticated Unix socket. The updater stages one
request at a time beneath `/opt/atlas/releases`, resumes an interrupted durable
request after its own restart, builds the folder with `buildReleaseFolder`, and
never changes `/opt/atlas/current`. Repeated requests for the same release
reuse the complete staged folder, and a lost request response is
reconciled from updater status. Host runtime differences and rollback-incompatible
release instructions remain visible on `/updates`.

Staging does not pause Session preparation, unpack archives, install
dependencies, select a release, restart Atlas, or inspect/manage OpenCode. A staged,
host-runtime-eligible, code-only-compatible candidate exposes **Install**. In
automatic mode, only a newer numeric build of the exact installed SemVer enters
the same activation path without that click; all SemVer changes remain explicit.
The policy is stored per installation in updater state and survives Atlas and
updater restarts, activation, and rollback. An approval or applicable automatic
decision is durable before Atlas waits up to five minutes for
preparation/handoff to reach a safe checkpoint. Repeated checks, submissions,
and policy changes reconcile against the one updater status boundary rather
than starting a second activation. Host runtime requirements are re-read
immediately before this pause so staging-time observations cannot authorize a
machine that has since drifted.

The surviving updater stops only Atlas, atomically changes `/opt/atlas/current`,
restarts Atlas, and allows 60 seconds for the candidate's exact identity and
healthy persistence. It uses the Atlas-only form of the authenticated health
route and never queries or gates on OpenCode. Failure selects and verifies the
previous working release without restoring older data. The failed tag remains
suppressed from automatic activation across restarts until **Retry**; a later
eligible build of the current SemVer can proceed normally. A checkpoint timeout
is a durable abandonment and leaves the current release selected. After candidate
health succeeds, the updater builds a support bundle from the candidate's
binary (same builder, under `/opt/atlas/services`) and atomically selects it
through `/opt/atlas/services/current`. The credential and updater services run
`services/current/atlas credentials|updater`; already-running support services
are not restarted.

Updater state is schema 2: staging fields, installation policy, activation
state, previous-release identity, progress/result, failed-tag suppression, and
cleanup outcomes. A schema-1 (tarball-era) state file is reset to idle but keeps
its policy; missing policy reads as approval required.

## Release retention

The updater cleans only managed Release directories older than the selected
Release. It protects the selected Release, the previous working Release, the
staged candidate, every in-flight activation/recovery path, and every Release
containing an absolute helper path (a compiled Release's `atlas` binary) in the
durable Session scope registry. A
failed candidate is not promoted to previous-working status merely because it
was briefly selected; it remains protected while staged for Retry.

Cleanup shares the updater's serialized lifecycle. It runs on updater startup
and after staging, abandonment, successful activation, or recovered rollback.
During activation/recovery it completes before the updater publishes a terminal
result, so a restarting Atlas remains paused until selection and retention are
settled. Each cleanup target is recorded in updater state before
removal. A restart re-evaluates current selections and helper references before
resuming partial cleanup.

Cleanup failure is reported separately from activation. It never changes the
healthy selected Release or starts another activation. Session directories,
SQLite data, credentials, immutable support bundles, and operator-managed tools are
outside `/opt/atlas/releases` and are never cleanup targets.

Authenticated health reports the same identity under `atlas.release`, existing
`persistence` health, and independent OpenCode diagnostics. Candidate success
uses `atlas.process`, exact `atlas.release`, and `persistence.healthy`; it does
not require OpenCode availability, readiness, or version inspection.
