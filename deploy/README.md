# Atlas deployment assets

This directory is the deliberately inert deployment seam for the private host.
It does not provision the host, enable units, move OpenCode data, or change
Tailscale/firewall state.

## Pins

`pins.env` pins Bun `1.3.14`, the validated Atlas client/OpenCode pairing
`0.0.0-beta-19135`, Git `2.55.0`, and gh `2.100.0`. Bun, Git, and gh paths are
absolute and versioned; the Git wrapper loads this manifest and rejects a
version drift on every managed Git invocation and service start. It also pins
the official Linux x64 OpenCode binary and client/schema/protocol package
integrities. The operator must verify release checksums privately before
cutover. The live host's currently running OpenCode beta is not evidence for
this pin.

`stage-release.sh` archives a clean committed checkout into a new release,
installs the frozen lockfile, builds CSS, records `RELEASE_COMMIT`, makes the
tree read-only, and atomically renames the staging directory. It never
overwrites `/opt/atlas/current` or an existing release.

`stage-opencode.sh <directory>` downloads only the pinned official Linux x64
OpenCode beta and its matching client/schema/protocol packages, verifies npm
integrity and versions, imports the client with pinned Bun, runs only
`opencode2 --version`, records SHA-256 values, and leaves one immutable isolated
tree. It does not start a server or write an OpenCode service registration. Use
a disposable directory during safe setup; production `/opt/atlas/tools` remains
a human-only install target.

## Units and listeners

- `systemd/atlas.service` runs Atlas as `omega` with explicit Bun, pinned Git,
  `HOME`, `PATH`, working directory, crash restart, bounded journal rate, and
  `/etc/atlas/atlas.env`.
- `systemd/opencode.service` independently runs the pinned V2 server as
  `omega`, bound to `127.0.0.1` with a dynamic port and `--service` discovery.
  It validates the binary/client pins, uses `--log-level WARN`, bounds journal
  rate, and deliberately does **not** load Atlas's secret environment file.
- Atlas's private app listener and loopback webhook listener remain separate;
  their ports come from `atlas.env`. Funnel must target only the webhook port.
- `check-health.sh` checks the private, authenticated `/health` route. A
  healthy Atlas process/database is reported separately from OpenCode readiness.

The private health route is authenticated and exists only on the private app.
The webhook app has no health, login, Session, event, or OpenCode routes.

## Target layout

| Path | Owner / purpose |
| --- | --- |
| `/opt/atlas/releases/<release>` | Read-only versioned Atlas release |
| `/opt/atlas/current` | Operator-selected release symlink |
| `/opt/atlas/tools/<tool>/<version>` | Pinned Bun, Git, GitHub CLI, and OpenCode binaries |
| `/var/lib/atlas` | One ordinary-directory Btrfs subvolume |
| `/var/lib/atlas/atlas.sqlite` | Atlas SQLite database and matching WAL/journal |
| `/var/lib/atlas/sessions/<atlas-id>` | Full private clone per Session |
| `/var/lib/atlas/opencode-data/opencode` | OpenCode data, database, logs, shells, snapshots, tool output |
| `/var/lib/atlas/opencode-data/opencode/log` | OpenCode file logs; human-installed size/retention bound |
| `/var/lib/atlas/opencode-state/opencode` | OpenCode state and service registration |
| `/var/lib/atlas/opencode-config/opencode` | Copied OpenCode configuration/plugins |
| `/var/lib/atlas/opencode-cache` | OpenCode cache kept inside the coherent snapshot scope |
| `/var/lib/atlas/opencode-runtime` | Stable service working directory, never a Session clone |
| `/var/lib/atlas/recovery-config/current` | Protected required configuration and rollback records |
| `/var/lib/atlas/recovery-status` | Bounded atomic backup/space status read by Atlas |
| `/etc/atlas` | `atlas.env`, `github.env`, App key, supplier key; restricted |
| `/var/backups/atlas` | Restricted same-disk read-only Atlas recovery snapshots |
| `/var/lib/atlas-restore-rehearsals` | Isolated writable rehearsal targets; never a service path |
| `/run/atlas` | systemd-created runtime socket directory |

Do not create nested subvolumes or rely on symlinks to include external data.
Before activation, inventory every real OpenCode data/config path and verify the
target is on the encrypted Btrfs pool. The shared `omega` identity is not
hostile-agent isolation. Refresh `recovery-config/current` after any accepted
configuration, unit, route, firewall, binary, or release change; the previous
copy is retained for rollback.

## Credential path

The Atlas process owns the authenticated local supplier. It persists the
Session-to-Repository registry under `/var/lib/atlas`, serves the supplier only
on `/run/atlas/supplier.sock`, and keeps its key in `/etc/atlas/supplier.key`.
The `gh` launcher and Git helper are in the release, before real gh on the
OpenCode service `PATH`. The launcher resolves the current Session directory,
requests one-Repository App credentials, clears inherited auth/config/debug
overrides, and passes the token only to the real gh child. Git uses a
credential-free HTTPS remote, an explicit clone-local helper, `useHttpPath`,
and `quit=true` on failure. Before the target Session directory exists, the
initial clone passes its exact registered `ATLAS_SESSION_DIRECTORY`; after the
clone, Git resolves the canonical nested path from its cwd. No human login,
SSH key, broad installation token, URL token, prompt, or uncertain mutation
retry is a fallback.

Run the nested-shell, symlink, subagent, login-shell, supplier-restart,
OpenCode-restart, expiry/renewal, authorized-operation, and wrong-Repository
denial checks manually against a disposable authorized Repository before
opening admission. The one automated exception is the focused real-Git
regression: `bun scripts/verify-clone-scope.ts` with explicit Bun 1.3.14.
These checks are not performed by `verify-assets.sh`.

## Recovery and operational guardrails

`capture-recovery-config.sh` is the least protected recovery-copy procedure.
Run it as the operator after the required files and records exist. It copies
only `atlas.env`, `github.env`, `github-app.pem`, `supplier.key`, all installed
Atlas/OpenCode/recovery units, the selected release marker/pin manifest, the
Atlas journal-namespace bound, an operator-recorded Tailscale
route file, and an operator-recorded firewall file into
`/var/lib/atlas/recovery-config/current`. It also records SHA-256 checksums for
those files and the pinned binaries. It rejects missing, symlinked, or partial
inputs, writes a private temporary tree, and atomically retains the prior copy
as `previous`; `capture-recovery-config.sh rollback` swaps back without
deleting the failed copy. Do not put secret values in command arguments.

`check-space.sh` reports the shared filesystem's 20 GiB warning threshold and
10 GiB new-preparation pause threshold, plus allocated Btrfs metadata pressure.
The default metadata warning/pause levels are 80%/90%. Exit `0` means all
checks are healthy, `1` means warning, and `2` means unsafe/missing or below a
pause threshold. Atlas pauses new preparation below `ATLAS_MIN_FREE_BYTES` and
when the configured machine-readable space status is missing, stale, malformed,
or reports metadata pause pressure. The check atomically updates that bounded
status file; the shared UI reports backup and disk state without an admin
control.
All four units use the separate `atlas` journal namespace.
`journald/atlas.conf` caps that persistent namespace at 256 MiB and 14 days
without deleting unrelated host logs. `logrotate/atlas-opencode` separately
bounds the OpenCode XDG file-log set to 100 MiB checks, 10 rotations, and 14
days; it uses `copytruncate` and never restarts OpenCode or deletes unrelated
host logs. Logs contain health/category summaries only: never prompts, file
contents, auth headers, tokens, or keys. Verify both installed bounds manually.

`atlas-snapshot.timer` runs a daily catch-up read-only Btrfs snapshot of the
complete shared subvolume. `atlas-snapshot.sh` keeps seven daily and four weekly
points as a union and prunes only exact-name, exact-marker, read-only Atlas
subvolumes. `atlas-space-check.timer` refreshes status every five minutes.
`verify-sqlite-wal.sh` records the actual fixed embedded SQLite builds, and
`restore-rehearsal.sh` validates a writable restore before scrubbing known
runtime endpoints without starting a service. The exact conditional recovery,
release, rollback, and rehearsal procedure is in [RECOVERY.md](RECOVERY.md).

## Human-only cutover order

The following is a handoff, not an instruction for an agent to execute:

1. Re-inventory the host and confirm `/opt/atlas`, `/var/lib/atlas`,
   `/etc/atlas`, `/var/backups/atlas`, and `/run/atlas` do not conflict. Leave
   the exFAT disk untouched. Record current OpenCode/agent PIDs and do not
   start the new unit while the live beta server remains active.
2. Obtain and checksum the pinned binaries. Use `stage-opencode.sh` first in a
   disposable isolated directory and verify its immutable tree, exact
   beta-19135 version, client import, and absence of service registration; do
   not start it. Create the privileged directories
   and the ordinary-directory Btrfs subvolume. Install restricted config from
   `atlas.env.example` and `github.env.example`, plus the App key, without
   putting values in shell history, releases, clones, logs, or issue comments.
   Set the actual private origin and listener ports.
3. In an approved stopped-writer window, stop the existing OpenCode server and
   all agents only after the operator confirms it is safe. Copy, do not first
   delete, all OpenCode data/state/config directories into the three target
   XDG locations, including database WAL/journal sidecars. Keep originals
   until validation succeeds. Do not trust/copy the old live service endpoint;
   let the new service register a fresh endpoint.
4. Stage a clean release with `stage-release.sh`, install the two units, run
   `systemctl daemon-reload`, and enable/start the independent units in that
   order. Atlas must not own OpenCode's lifecycle; an Atlas restart must not
   stop OpenCode or agents.
5. Capture the protected recovery configuration with
   `capture-recovery-config.sh`, record the route/firewall inputs, and run
   `check-space.sh`. Refresh the copy whenever any deployment input changes.
6. Configure private Tailscale Serve to the UI loopback port and public
   Tailscale Funnel to the webhook loopback port on different externally
   served ports. Apply the reviewed tailnet/firewall policy. Never Funnel the
   UI listener. Configure GitHub's signed webhook for `/webhooks/github`.
7. Run `check-health.sh`, private cookie/bearer checks, public webhook-only
   exclusion checks, valid/invalid signed webhook checks, and the credential
   matrix before admitting work. Reopen a preserved Session without replaying
   a prompt. Re-check after a planned reboot only after the operator accepts
   the interruption window.
8. Follow `RECOVERY.md` to verify and enable daily snapshots, exercise isolated
   restore, and record the complete release check. A snapshot cannot undo
   GitHub effects; schema rollback requires matching data and binaries.
