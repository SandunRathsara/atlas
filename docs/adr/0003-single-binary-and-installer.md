# ADR-0003: Single compiled binary, one-command installer, and manual release workflow

## Status

Accepted on 2026-11-18 when the owner directed the full single-binary implementation and the first Release from it (`docs/single-binary-plan.md`), and the same day asked for native Tailscale Serve support in setup.

Amended on 2026-11-18, at the developer's direction after a security review, so the text matches the hardened implementation: `install.sh` runs only as root, the default service user is a dedicated `atlas` account, and the root updater fetches Release metadata itself, is forward-only, and keeps its state under root-owned `/var/lib/atlas-updater`. No decision changed direction.

Partially supersedes [ADR-0002](0002-versioned-releases-and-graceful-self-updates.md) (packaging, publishing trigger, and bootstrap). See Supersession.

## Context

ADR-0002 shipped each Release as an archive of the source tree plus production dependencies, run by host-installed Bun at an exact pin, published when a maintainer pushed a tag, and set up on existing hosts by an operator-run bootstrap script. In practice this meant:

- Every host had to install and keep the exact Bun version, plus exact git and gh pins in `deploy/pins.env`.
- New installs needed many manual steps (folders, units, keys, env files, symlinks) spread across scripts in `deploy/`.
- Several entry files, wrapper scripts, and unit files had to stay in sync by hand.
- A pushed tag could publish a Release with no separate check of who pushed it or whether the full checks passed on that exact commit.
- Unit files hard-coded one host user.

Bun can compile the whole program, its UI assets, and its operator tools into one executable. That removes the host Bun requirement and most of the moving parts.

## Scope

- How a Release is built, what files it contains, and how it is published.
- How Atlas is installed, re-run, and moved from an older install.
- Host tool requirements (git, gh) and the service user.
- What setup may change on the host, including Tailscale Serve.
- How the root updater stages and runs candidate binaries.

Not in scope: Release identity and ordering, discovery, update policy, safe pause, activation, rollback, and retention. ADR-0002 still governs those.

## Decision

### 1. One compiled binary

- Each Release is one `bun build --compile --target=bun-linux-x64-baseline` executable, `atlas-linux-x64`. It contains Bun, all code, UI assets, the `atlas ops` tools, and the headless OpenCode config. The host needs no Bun.
- One binary runs every process through subcommands: `serve`, `credentials`, `updater`, `gh`, `git-credential`, `setup`, `ops`, `version`.
- The Release identity (tag, SemVer, build, Git SHA) is embedded at build time.
- A Release has exactly four files: `atlas-release.json` (schema-2 metadata), `atlas-linux-x64`, `atlas-linux-x64.sha256`, and `install.sh`.
- On the host, each Release lives in a read-only Release folder `/opt/atlas/releases/atlas-<tag>` with the binary, its metadata, a `bin/git` wrapper, and `bin/gh` / `bin/git-credential-atlas` shims. The same builder is used by setup and the updater.

### 2. Manual, allowlisted, gated release workflow

- A listed releaser (the `RELEASERS` allowlist) runs `.github/workflows/release.yml` by hand on `main` and picks a bump: patch, minor, major, or build. A dry run is available.
- The workflow computes the next tag, runs the full check suite on that exact commit, builds and smoke-tests the four files, and only then creates the tag and an immutable Release. Only the final publish job has write access, and it re-checks the allowlist.
- Pushing a tag no longer publishes anything.

### 3. `install.sh` and `atlas setup`

- `install.sh` runs only as root (`curl … | sudo sh`). It downloads the latest Release binary into a new root-only folder, checks its SHA-256 against the sidecar from the same Release, and runs `atlas setup` from there.
- `atlas setup` has three modes: fresh install, re-run (keeps config and keys), and adopt (an older Bun/source-tree install, detected from its `atlas.service`; it backs up the old units and env files and writes `ROLLBACK.txt`).
- Setup checks systemd, git, and gh, lists anything missing with a fix-it hint, and stops before changing anything. A missing OpenCode is a warning. Setup does not install any of them.
- Setup writes only Atlas's own config, keys, folders, Release folder, support bundle, systemd units, journald config, and headless OpenCode config. All unit text comes from one source file. Btrfs snapshot and space-check timers are added only on a Btrfs data folder.
- After an explicit yes, setup may run `tailscale serve` for the UI. It never enables Funnel; it only prints the Funnel command for the webhook. It does not touch the firewall.
- Setup starts OpenCode only on a fresh install and never restarts it otherwise.

### 4. Host tools and service user

- git and gh are minimum versions, not exact pins: git ≥ 2.36.0, gh ≥ 2.3.0. The metadata carries them; the updater and the `bin/git` wrapper enforce them.
- The service user is chosen at setup and is never root. The default is a dedicated `atlas` system account, created only with consent. An account that can become root is refused unless explicitly allowed; adopt keeps the existing user and warns. Nothing hard-codes a user name.
- Everything that runs as root (installer, setup, updater) treats the service user as untrusted: secrets in `/etc/atlas` are root-owned and only group-readable, and root never follows or re-permissions a path that account can change.

### 5. Root updater rule

- The root updater never runs a binary it has not verified (SHA-256 from the same Release, then embedded metadata).
- Callers send only a tag. The updater fetches that Release's `atlas-release.json` itself over HTTPS and refuses any build not higher than the active one (forward-only). Downloads are streamed with size caps.
- Its state lives in root-owned `/var/lib/atlas-updater`, not in the service user's data folder.
- It runs candidate binaries only through `setpriv` as the service user.

## Alternatives

- **Keep the source archive and host Bun:** rejected. It keeps the Bun pin on every host and the many hand-synced scripts and units.
- **Ship a bridge Release to move the owner's existing server:** rejected. No Release was ever published, so there is nothing to stay compatible with. The owner runs setup's adopt mode by hand, keeping `/var/lib/atlas`.
- **Have setup fully provision the host (install git, gh, OpenCode, packages, firewall):** rejected in favor of check-and-report. Package management differs per distro and is the operator's job.
- **Keep exact git/gh pins:** rejected in favor of minimum versions. With the minimums lowered to git 2.36.0 and gh 2.3.0 (evidence in `src/host-tools.ts`), stock Debian 12 and Ubuntu 24.04 packages work.
- **Keep tag-push publishing:** rejected. A manual run with an allowlist and a check gate on the exact commit is safer, and the workflow computing the tag removes hand-typed tags. (ADR-0002 had rejected "manual publishing" meaning a maintainer building by hand; here GitHub Actions still builds everything.)

## Consequences

- The binary is about 90 MiB, larger than the source archive.
- Only Linux x64 glibc is built. No musl, no arm64.
- Trust is HTTPS plus a SHA-256 from the same GitHub Release. There is no signature, so a compromised Release would pass the check.
- Sessions run as the same account as the credentials service, so a Session can read the App key, the supplier key, and the updater key (documented in `docs/INSTALL.md`).
- Staging now downloads and verifies a binary instead of extracting an archive. The updater state and Release metadata moved to schema 2, and the state moved to `/var/lib/atlas-updater`; a schema-1 state file resets to idle and keeps its policy.
- Many `deploy/` scripts, unit files, and wrapper scripts were deleted; their behavior now lives in the binary (`atlas ops`, `src/units.ts`, `src/release-layout.ts`).
- Verification: `bun run verify:binary`, `verify:setup`, `verify:install-script`, `verify:issue57`, the CI `check.yml` gate, and the Docker systemd check `scripts/e2e-install-docker.sh` (not in CI).

## Supersession

Amended on 2026-11-18, at the developer's direction after a security review, so the text matches the hardened implementation: `install.sh` runs only as root, the default service user is a dedicated `atlas` account, and the root updater fetches Release metadata itself, is forward-only, and keeps its state under root-owned `/var/lib/atlas-updater`. No decision changed direction.

Partially supersedes [ADR-0002](0002-versioned-releases-and-graceful-self-updates.md):

- **§2 Publishing and packaging:** the tag-push trigger, the `deploy/pins.env` step for client bumps, the release-directory archive, and running with host-installed Bun are replaced by Decisions 1, 2, and 4 here. The rest of §2 stands: installations consume published Releases, the lockfile is frozen, and the workflow never queries an OpenCode server.
- **§6 Bootstrap:** replaced by `install.sh` and `atlas setup` (Decision 3).

ADR-0002's identity, ordering, discovery, policy, safe pause, activation, rollback, and retention decisions remain in force.
