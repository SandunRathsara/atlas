# Atlas deployment assets

This directory is the deliberately inert deployment seam for the private host.
It does not provision the host, enable units, move OpenCode data, or change
Tailscale/firewall state.

## Pins

`pins.env` pins Bun `1.3.14`, the validated Atlas client/OpenCode pairing
`0.0.0-beta-19135`, Git `2.55.0`, and gh `2.100.0`. The binary paths are
absolute and versioned; the operator must obtain the binaries, verify release
checksums, and record those checksums privately before cutover. The live host's
currently running OpenCode beta is not evidence for this pin.

`stage-release.sh` archives a clean committed checkout into a new release,
installs the frozen lockfile, builds CSS, records `RELEASE_COMMIT`, makes the
tree read-only, and atomically renames the staging directory. It never
overwrites `/opt/atlas/current` or an existing release.

## Units and listeners

- `systemd/atlas.service` runs Atlas as `omega` with explicit Bun, `HOME`,
  `PATH`, working directory, crash restart, and `/etc/atlas/atlas.env`.
- `systemd/opencode.service` independently runs the pinned V2 server as
  `omega`, bound to `127.0.0.1` with a dynamic port and `--service` discovery.
  It deliberately does **not** load Atlas's secret environment file.
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
| `/opt/atlas/tools/<tool>/<version>` | Pinned Bun, GitHub CLI, and OpenCode binaries |
| `/var/lib/atlas` | One ordinary-directory Btrfs subvolume |
| `/var/lib/atlas/atlas.sqlite` | Atlas SQLite database and matching WAL/journal |
| `/var/lib/atlas/sessions/<atlas-id>` | Full private clone per Session |
| `/var/lib/atlas/opencode-data/opencode` | OpenCode data, database, logs, shells, snapshots, tool output |
| `/var/lib/atlas/opencode-state/opencode` | OpenCode state and service registration |
| `/var/lib/atlas/opencode-config/opencode` | Copied OpenCode configuration/plugins |
| `/var/lib/atlas/opencode-runtime` | Stable service working directory, never a Session clone |
| `/etc/atlas` | `atlas.env`, `github.env`, App key, supplier key; restricted |
| `/var/backups/atlas` | Same-disk recovery snapshots; not created by this slice |
| `/run/atlas` | systemd-created runtime socket directory |

Do not create nested subvolumes or rely on symlinks to include external data.
Before activation, inventory every real OpenCode data/config path and verify the
target is on the encrypted Btrfs pool. The shared `omega` identity is not
hostile-agent isolation.

## Credential path

The Atlas process owns the authenticated local supplier. It persists the
Session-to-Repository registry under `/var/lib/atlas`, serves the supplier only
on `/run/atlas/supplier.sock`, and keeps its key in `/etc/atlas/supplier.key`.
The `gh` launcher and Git helper are in the release, before real gh on the
OpenCode service `PATH`. The launcher resolves the current Session directory,
requests one-Repository App credentials, clears inherited auth/config/debug
overrides, and passes the token only to the real gh child. Git uses a
credential-free HTTPS remote, an explicit clone-local helper, `useHttpPath`,
and `quit=true` on failure. No human login, SSH key, broad installation token,
URL token, prompt, or uncertain mutation retry is a fallback.

Run the nested-shell, symlink, subagent, login-shell, supplier-restart,
OpenCode-restart, expiry/renewal, authorized-operation, and wrong-Repository
denial checks against a disposable authorized Repository before opening
admission. These checks are not performed by `verify-assets.sh`.

## Human-only cutover order

The following is a handoff, not an instruction for an agent to execute:

1. Re-inventory the host and confirm `/opt/atlas`, `/var/lib/atlas`,
   `/etc/atlas`, `/var/backups/atlas`, and `/run/atlas` do not conflict. Leave
   the exFAT disk untouched. Record current OpenCode/agent PIDs and do not
   start the new unit while the live beta server remains active.
2. Obtain and checksum the pinned binaries; create the privileged directories
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
5. Configure private Tailscale Serve to the UI loopback port and public
   Tailscale Funnel to the webhook loopback port on different externally
   served ports. Apply the reviewed tailnet/firewall policy. Never Funnel the
   UI listener. Configure GitHub's signed webhook for `/webhooks/github`.
6. Run `check-health.sh`, private cookie/bearer checks, public webhook-only
   exclusion checks, valid/invalid signed webhook checks, and the credential
   matrix before admitting work. Reopen a preserved Session without replaying
   a prompt. Re-check after a planned reboot only after the operator accepts
   the interruption window.
7. Keep daily snapshots/restore rehearsal, disk warning thresholds, exact
   journal/file-log bounds, and rollback rehearsal closed until the final
   acceptance slice supplies and verifies them. A snapshot cannot undo GitHub
   effects; schema rollback requires matching data and binaries.
