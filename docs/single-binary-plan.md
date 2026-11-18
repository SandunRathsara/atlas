# Single-binary Atlas plan

Status: **Approved for implementation, 2026-11-18.** The owner directed the full build and the first Release `v0.1.0+build.1`. The "Build contract" section below is binding for every phase.

## Goal

Another team can install their own private Atlas with one command:

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sh
```

The command downloads one `atlas` binary, checks it, and runs `sudo atlas setup`. The setup wizard asks a few questions, writes config and systemd units, and starts Atlas.

## Owner decisions (2026-11-18)

| Question | Answer |
|---|---|
| Who installs? | Other teams, each on its own private server with its own GitHub App. Atlas stays a private app. |
| Install script scope | Binary plus setup wizard. The wizard checks git, gh and OpenCode and says what is missing. It does not install them. |
| Owner's existing server | Reinstall by hand with the new script, keeping `/var/lib/atlas`. No bridge release. |

## What stays the same

- Release identity: `vX.Y.Z+build.N`, global build numbers, immutable Releases.
- Self-update rules: the 4-hour check, approval vs automatic policy, safe pause, 60-second health check, rollback, and retention.
- Three long-running processes: UI, credential supplier, updater. Only how they start changes.
- Atlas never manages OpenCode.

## What changes

| Today | After |
|---|---|
| `.tar.gz` of source + `node_modules`, run by host Bun | One compiled `atlas` binary with Bun built in |
| Host needs pinned Bun 1.3.14 | No Bun on the host |
| Three entry files (`src/server.ts`, `credential-server.ts`, `updater-server.ts`) | One entry `src/cli.ts`: `atlas serve`, `atlas credentials`, `atlas updater`, `atlas gh`, `atlas git-credential`, `atlas setup`, `atlas version` |
| Support bundle = copied `.ts` files | Support bundle = a copy of the binary |
| `deploy/bootstrap.sh` + manual host setup | `install.sh` + `atlas setup` |
| Service user hard-coded to `omega` | Chosen during setup (default: the user who ran `sudo`) |

## Code that assumes a source folder (all fixable)

| # | Where | Fix |
|---|---|---|
| 1 | `src/app.ts` reads `public/*.css/js/fonts` through `import.meta.url` | Embed with `import … with { type: "file" }` |
| 2 | `src/app.ts` reads `node_modules/htmx.org/dist/htmx.min.js` | Embed the same way |
| 3 | `src/release.ts#loadReleaseIdentity` reads `RELEASE_METADATA.json` from the release folder | Keep the file next to the binary in each release folder (no change in staging), plus `atlas version --json` for local checks |
| 4 | `src/opencode.ts#openCodeClientVersion` reads `@opencode/client/package.json` at runtime | Read it at build time (JSON import or `--define`) |
| 5 | `src/preparation.ts` runs `bun scripts/atlas-git-credential.ts` | Run `<binary> git-credential` (`process.execPath` is the binary) |
| 6 | `deploy/bin/gh`, `deploy/bin/git-credential-atlas` call Bun scripts | 2-line shims: `exec <release>/atlas gh "$@"` |
| 7 | `src/updater.ts#installShippedSupportServices` copies `.ts` files | Copy the binary |
| 8 | `src/updater-server.ts` runs `check-activation-health.sh` | Do the same `/health?activation=1` check in TypeScript |
| 9 | Runtime checks require Bun | Drop the Bun check. Keep the Git and gh checks. |

## New release layout

Each release folder stays one immutable directory, so retention and Session helper references keep working:

```
/opt/atlas/releases/atlas-v1.4.0+build.12/
  atlas                    # the binary, read-only
  RELEASE_METADATA.json
  bin/gh                   # shim → ../atlas gh
  bin/git-credential-atlas # shim → ../atlas git-credential
  bin/git                  # pinned-git wrapper (unchanged)
/opt/atlas/current → releases/atlas-v1.4.0+build.12
/usr/local/bin/atlas → /opt/atlas/current/atlas
```

The GitHub Release ships:

- `atlas-linux-x64`: the binary
- `atlas-linux-x64.sha256`
- `atlas-release.json` with `schemaVersion: 2`. Old updaters reject schema 2, so the owner's server never tries to install it the old way.
- `install.sh`, the same file for every Release

## Install flow

1. `install.sh` (POSIX sh):
   - refuses anything other than Linux x64 with glibc
   - downloads the latest stable `atlas-linux-x64`, or a version passed as an argument
   - verifies the SHA-256 and stops on mismatch
   - creates the release folder and the symlinks
   - runs `sudo atlas setup` when there is a terminal; otherwise prints that command
2. `atlas setup` (root):
   - **Checks:** systemd, git, gh and OpenCode are present at the expected versions. Anything missing is listed with a fix-it hint, and setup stops before changing anything.
   - **Asks:** service user, GitHub org, GitHub App ID, installation ID and private-key path, public origin URL, ports.
   - **Generates:** shared token and webhook secret.
   - **Writes:** `/etc/atlas/atlas.env` and `/etc/atlas/github.env` (`0600`), data folders, systemd units (embedded in the binary), and the headless OpenCode config.
   - **Starts and checks:** starts the services, then checks `/health`.
   - **Prints:** the URL, the token, and the Tailscale Serve/Funnel commands. It never changes Tailscale itself.
3. **Adopt mode:** if `/etc/atlas` and `/var/lib/atlas` already exist, setup keeps them. It only replaces the units and the release layout, keeps a backup of the old units, and stops the old services first. This is how the owner's server moves over.

## Phases

Each phase ends green on its checks and is shippable on its own.

1. **Compile.** Add `src/cli.ts` and fix items 1–6. `bun build --compile` produces a binary that runs `atlas serve` locally from any folder. Existing tree releases keep working.
2. **Publish.** Change `release.yml` and `scripts/build-release.sh` to build and smoke-test the binary and publish the 4 files above. Move release metadata to schema 2.
3. **Self-update on the binary.** Fix items 7–9. Staging downloads the binary, verifies it, and creates the release folder with shims. Update the units. Port the verify scripts (`verify:issue55`, `57`, `58`, `59`, `61`).
4. **Installer.** Add `install.sh` and `atlas setup` with fresh and adopt modes. Test on a clean VM and on a copy of the owner's server.
5. **Move the owner's server, then clean up.** Run adopt mode on the owner's server. After it is healthy, delete the tree-release code, `deploy/bootstrap.sh`, `deploy/stage-release.sh` and the Bun pins. Update the docs.

## Decisions to record (ADR-0003, needs approval)

- **Supersedes ADR-0002 §2 (packaging):** a compiled binary replaces the source tree, and the host no longer needs Bun.
- **Supersedes ADR-0002 §6 (bootstrap):** `install.sh` and `atlas setup` replace `deploy/bootstrap.sh`.
- **DOMAIN.md non-goal "Does not automatically provision the host":** narrowed. Setup writes Atlas's own config, units and folders. It still does not install git, gh, OpenCode or OS packages, and does not change Tailscale or the firewall.
- **Service user is configurable** instead of `omega`.

## Build contract (binding)

Decided on 2026-11-18. Every phase follows this so the parts fit together.

- **No dual paths.** No Release was ever published, so there is nothing to stay compatible with. The binary replaces the tree release outright. Delete tree-release code when it is superseded instead of keeping both.
- **Tag and identity:** unchanged `vX.Y.Z+build.N`. The first Release is `v0.1.0+build.1`.
- **Compile target:** `bun-linux-x64-baseline`, built by Bun 1.3.14. glibc only.
- **Release assets (exact names):** `atlas-linux-x64`, `atlas-linux-x64.sha256` (one line: `<hex>  atlas-linux-x64`), `atlas-release.json` (`schemaVersion: 2`, includes the binary's SHA-256), `install.sh`.
- **Identity is embedded** in the binary at build time (`atlas version --json` works anywhere). `RELEASE_METADATA.json` is still written next to the binary in each release folder. Staging refuses a binary whose embedded identity disagrees with `atlas-release.json`.
- **One implementation of the release folder.** A single TypeScript function builds `/opt/atlas/releases/atlas-<tag>/` (binary, metadata, `bin/` shims). Updater staging and `atlas setup` both call it. `install.sh` never lays out folders.
- **`install.sh` is thin:** platform check, download, SHA-256 check, then hand off to `atlas setup`. POSIX `sh`, no bashisms.
- **`atlas setup` is testable:** every answer can come from flags or an answers file (no TTY needed), and a root-prefix option lets checks run it in a temp folder without root and with `systemctl` faked.
- **Tool versions:** minimum versions for git and gh (today's pins become the minimums). No Bun on the host. OpenCode stays diagnostic-only.
- **Service user:** chosen in setup, never hard-coded. systemd units are generated from templates embedded in the binary.
- **Root updater rule:** never execute a binary before its SHA-256 matches the published checksum. Run candidates as the service user, never as root.
- **Release pipeline:** manual `workflow_dispatch` with a `patch`/`minor`/`major` bump, an allowlist of releasers (`SandunRathsara`), the full check gate first, a build job with a read-only token, and a separate publish job that re-checks the SHA-256 and runs no repo code. Every Action is pinned to a commit SHA. `check.yml` runs fast checks on PRs and full checks plus a throwaway packaging check on `main`.
- **Out of scope:** musl/Alpine, arm64, installing git/gh/OpenCode, touching Tailscale or the firewall, moving the owner's server (the owner runs adopt mode by hand).

## Risks

- **The updater runs as root.** It must only ever run binaries whose SHA-256 matches the published checksum, and it should start the candidate as the service user, never as root.
- **Verify scripts assume the tree layout.** Phase 3 is the largest phase for this reason.
- **Size.** The binary is about 100 MB because Bun is inside. That is fine for one download per release.
