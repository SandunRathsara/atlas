# Atlas deployment assets

This directory is the deployment seam for the private host. Nothing changes the
host until an operator runs it. Atlas is one compiled binary per Release; the
host needs no Bun. Installing and enabling the services is the job of
`atlas setup` (Phase 4, not yet implemented); it renders the four units from
`src/units.ts#renderUnits` and builds Release folders with
`src/release-layout.ts#buildReleaseFolder`.

## Pins

Atlas's host-tool requirements are numeric minimums in `src/host-tools.ts`
(Git `2.55.0`, gh `2.100.0`) and are published in each Release's metadata.
`pins.env` remains only for the operator recovery tools here (snapshot capture,
restore rehearsal, SQLite WAL probe), which still use a pinned host Bun. OpenCode is
different: `ATLAS_OPENCODE_BINARY` follows the operator-controlled
`/opt/atlas/tools/opencode/current` selection. Its server version is not an
Atlas release pin. The Atlas release still installs the exact
`@opencode/client` dependency (`2.3.2`) in `package.json`; staging a server
does not replace or pair that client.

Published releases are produced from authoritative
`vMAJOR.MINOR.PATCH+build.BUILD` tags by `.github/workflows/release.yml`. See
[`docs/RELEASES.md`](../docs/RELEASES.md) for the immutable archive/metadata
single-binary contract and maintainer procedure. `bun run build:release`
produces the three Release assets from a clean checkout.

`stage-opencode.sh <exact-server-version> <directory>` queries npm registry
metadata for that exact `@opencode/cli-linux-x64` version, requires its
SHA-512 integrity and secure tarball URL, verifies the download, installs the
package's `bin/opencode` as `tools/opencode/<version>/bin/opencode`, runs only
`opencode --version` (which must print `opencode v<version>`), and leaves an
immutable server-only tree. Its
`OPENCODE_ARTIFACTS` manifest records the chosen version, registry integrity,
and binary SHA-256. There is no default or latest lookup, and no Atlas
client/schema/protocol package is downloaded.

Staging never installs the version, changes `current`, or restarts OpenCode.
After inspecting the isolated tree, the operator separately installs its
`tools/opencode/<version>` directory under `/opt/atlas/tools/opencode`,
atomically points `current` at that installed version, and explicitly restarts
`opencode.service` in an approved window. Run
`/opt/atlas/tools/opencode/current/bin/opencode --version` before restart to
confirm that `current` is executable and see the version it reports. A successful Atlas release staging also leaves `current` and the
OpenCode service untouched.

## Units and listeners

The four long-running units are rendered by `renderUnits` (`src/units.ts`);
there are no checked-in copies. `verify-assets.sh` renders and checks them.

- `atlas-credentials.service` owns `/run/atlas`, serves the existing
  Repository-scoped credential protocol from the atomically selected immutable
  support bundle, and keeps
  running while Atlas is stopped or restarted. It loads only the GitHub App
  credential file, registry, and supplier key—not Atlas UI/webhook secrets.
- `atlas-updater.service` runs as the surviving host authority from
  `/opt/atlas/services/current/atlas updater`, owns its authenticated Unix socket,
  downloads and verifies the public Atlas binary, builds Release folders, records durable policy,
  staging, activation, and cleanup state under `/var/lib/atlas`, atomically selects
  `/opt/atlas/current`, and stops/restarts only `atlas.service`. Its unit does
  not import or execute Atlas's environment. For candidate validation, it reads
  only the shared token and UI port as data from the restricted `atlas.env`,
  and requests the Atlas-only health response itself
  (`src/updater-server.ts#checkActivationHealth`). It never controls or inspects OpenCode.
- `atlas.service` runs `/opt/atlas/current/atlas serve` as `omega` with the Release's Git wrapper,
  `HOME`, `PATH`, working directory, crash restart, bounded journal rate, and
  `/etc/atlas/atlas.env`. It connects to, but does not own, either surviving
  service socket.
- `opencode.service` independently runs the operator-selected server as
  `omega`, bound to `127.0.0.1:49475` with `--service` discovery. The fixed port
  keeps it off OpenCode's default background-service port, which an
  interactive OpenCode for the same `omega` user may use. Atlas still finds the
  URL and password through the registration file
  (`OPENCODE_SERVICE_FILE`, `opencode-state/opencode/service.json`), not the
  port. Its preflight follows `current`, validates the executable, and reports
  its observed version without inspecting Atlas client packages. It refuses to
  start without the headless configuration below. The unit uses
  `--log-level warn` (lowercase; the server rejects `WARN`), bounds journal
  rate, and deliberately does **not** load Atlas's secret environment file.
- Atlas's private app listener and loopback webhook listener remain separate;
  their ports come from `atlas.env`. Funnel must target only the webhook port.
- `check-health.sh` is the normal operator diagnostic for the private,
  authenticated `/health` route and requires healthy Atlas persistence plus
  OpenCode readiness. The updater's activation check is separate: it
  requires exact candidate tag/SHA and healthy Atlas persistence from
  `/health?activation=1`, where OpenCode is not evaluated or reported.

`check-health.sh` also prints the OpenCode client version and, when `/health`
reports one, the `openCode.versionWarning` text. A version warning is
diagnostic only and never fails the check.

The private health route is authenticated and exists only on the private app.
The webhook app has no health, login, Session, event, or OpenCode routes.

## Headless OpenCode configuration

Atlas Sessions run unattended, so OpenCode must not stop to ask a person.
`opencode/opencode.json` is the global configuration for the service's
`XDG_CONFIG_HOME`. `install-opencode-config.sh <config-home>` installs it as
`<config-home>/opencode/opencode.json` (owner of `<config-home>`, mode `0400`).
Run it for `/var/lib/atlas/opencode-config` (Phase 4 `atlas setup` will).
The installer:

- writes only as the config home's owner: run as root, it reads the shipped
  file and then drops to that owner with `setpriv` (util-linux), so no root
  write follows a path the owner could swap; any other caller is refused;

- never restarts OpenCode; the server reads the file at the latest on its next
  start;
- keeps a differing earlier file as `opencode.json.replaced-<UTC time>`;
- refuses to run beside an `opencode.jsonc`.

| Setting | Effect |
| --- | --- |
| `"update": "disable"` | No update checks or installs by any OpenCode process using this config. `serve` does not run the periodic check itself; this setting also covers interactive clients. It is global-only; project files cannot change it. |
| `permissions` allow `read` on `*.env` and `*.env.*` | Replaces OpenCode's default `ask` for `.env` files. |
| `permissions` deny `question` | Removes the `question` tool from the agents' tool list. |
| `policies` deny `tool.use` on `question:*` | Hard backstop. If a repository's own config re-allows `question`, the call still fails with "Blocked by configuration policy" and no form opens. |
| `policies` deny `tool.use` on `external_directory:/etc/atlas/*`, `read:/etc/atlas`, and `read:/etc/atlas/*` | Keeps Atlas's own secrets (`github.env`, keys) out of the file tools even though `*.env` reads are allowed. `external_directory` also covers `grep` and `glob`, whose resource is the search pattern, not the path. A repository's config cannot re-allow it. |

The split is deliberate. Policies can only deny and never grant, so the `.env`
allow rules must stay `permissions`. Global policies outrank project config;
global permissions do not.

Limits (Waiting is still possible):

- A Session's repository may ship its own `opencode.json(c)` or `.opencode/`.
  Project permissions override these global ones, so a repository that asks
  for `.env` reads, shell commands, or other actions still makes the Session
  wait for approval.
- Only the `question` form is blocked unconditionally.
- The `/etc/atlas` deny closes only OpenCode's file tools. The shell tool is
  allowed by default and runs as `omega`, so an agent can still read any file
  `omega` can read, including `/etc/atlas` files readable by `omega`. That is a
  pre-existing property of running the agent as that user.
- Idle servers still fetch the public model catalog from `models.opencode.ai`.

## Target layout

| Path | Owner / purpose |
| --- | --- |
| `/opt/atlas/releases/atlas-<tag>` | Read-only Release folder: `atlas`, `RELEASE_METADATA.json`, `bin/{git,gh,git-credential-atlas}` |
| `/opt/atlas/current` | Operator-selected release symlink |
| `/opt/atlas/services/releases/atlas-<tag>` | Immutable credential/updater support bundle (same folder shape), independent of Atlas release selection |
| `/opt/atlas/services/current` | Atomically selected support-bundle symlink used when either surviving service next starts |
| `<release>/RELEASE_METADATA.json` | Schema-2 metadata: identity, binary SHA-256/size, host-tool minimums, OpenCode client, rollback contract |
| `/opt/atlas/tools/<tool>/<version>` | Operator-installed Git and GitHub CLI (and Bun for recovery tools); installed OpenCode server versions |
| `/opt/atlas/tools/opencode/current` | Operator-selected OpenCode server symlink used by the independent service |
| `/var/lib/atlas` | One ordinary-directory Btrfs subvolume |
| `/var/lib/atlas/atlas.sqlite` | Atlas SQLite database and matching WAL/journal |
| `/var/lib/atlas/update-state.json` | Durable installation policy, staging/activation/cleanup target, progress, result, previous release, and failed-tag suppression |
| `/var/lib/atlas/sessions/<atlas-id>` | Full private clone per Session |
| `/var/lib/atlas/opencode-data/opencode` | OpenCode data, database, logs, shells, snapshots, tool output |
| `/var/lib/atlas/opencode-data/opencode/log` | OpenCode file logs; human-installed size/retention bound |
| `/var/lib/atlas/opencode-state/opencode` | OpenCode state and service registration |
| `/var/lib/atlas/opencode-config/opencode` | Copied OpenCode configuration/plugins: `opencode.json` is the Atlas headless configuration (no secrets); OpenCode's own `service.json` holds the generated server password |
| `/var/lib/atlas/opencode-cache` | OpenCode cache kept inside the coherent snapshot scope |
| `/var/lib/atlas/opencode-runtime` | Stable service working directory, never a Session clone |
| `/var/lib/atlas/recovery-config/current` | Protected required configuration and rollback records |
| `/var/lib/atlas/recovery-status` | Bounded atomic backup/space status read by Atlas |
| `/etc/atlas` | `atlas.env`, `github.env`, App key, supplier key, updater key; restricted |
| `/var/backups/atlas` | Restricted same-disk read-only Atlas recovery snapshots |
| `/var/lib/atlas-restore-rehearsals` | Isolated writable rehearsal targets; never a service path |
| `/run/atlas` | systemd-created runtime socket directory |
| `/run/atlas-updater` | systemd-created updater socket directory |

Do not create nested subvolumes or rely on symlinks to include external data.
Before activation, inventory every real OpenCode data/config path and verify the
target is on the encrypted Btrfs pool. The shared `omega` identity is not
hostile-agent isolation. Refresh `recovery-config/current` after any accepted
configuration, unit, route, firewall, binary, or release change; the previous
copy is retained for rollback.

## Credential and updater services

After installing `/etc/atlas/github.env` and its App key, Phase 4 `atlas setup`
will (for both fresh and adopted installs) build the support bundle under
`/opt/atlas/services`, select it through `/opt/atlas/services/current`, write
the rendered units, create or preserve the private keys, reload systemd, and
enable both surviving services. It never stops, restarts, selects, or inspects
OpenCode. The root updater has only the shipped workflow for Atlas release
staging, `/opt/atlas/current` selection, and `atlas.service` control; its code
has no OpenCode operation.

The independent service persists the Session-to-Repository registry under
`/var/lib/atlas`, serves only `/run/atlas/supplier.sock`, and keeps its key in
`/etc/atlas/supplier.key`. New scope records include canonical helper paths so a
release cleanup can protect every referenced Release regardless of Session
state. The root updater accepts this owner-controlled registry only as the
expected service-account-owned `0600` regular file. Atlas client shutdown does
not unlink the socket or remove its runtime directory.
The `gh` launcher and Git helper are the Release's `bin/` shims, before real gh on the
OpenCode service `PATH`. The launcher resolves the current Session directory,
requests one-Repository App credentials, clears inherited auth/config/debug
overrides, and passes the token only to the real gh child. Git uses a
credential-free HTTPS remote, an explicit clone-local helper, `useHttpPath`,
and `quit=true` on failure. Before the target Session directory exists, the
initial clone passes its exact registered `ATLAS_SESSION_DIRECTORY`; after the
clone, Git resolves the canonical nested path from its cwd. No human login,
SSH key, broad installation token, URL token, prompt, or uncertain mutation
retry is a fallback.

Run `bun run verify:issue55` for the isolated supplier/client restart, scope,
denial, and fixture-release helper checks. Before admitting production work,
stop Atlas only and use an existing disposable Session directory to run a
credential-requiring `git` read and a scoped `gh --repo OWNER/REPOSITORY` read;
then restart Atlas and repeat. Do not print tokens or use `gh auth token`.

Also run the nested-shell, symlink, subagent, login-shell, supplier-restart,
OpenCode-restart, expiry/renewal, authorized-operation, and wrong-Repository
denial checks manually against a disposable authorized Repository before
opening admission. The other focused real-Git
regression: `bun scripts/verify-clone-scope.ts` with explicit Bun 1.3.14.
These checks are not performed by `verify-assets.sh`.

After setup, visit the private global `/updates` page. It reports installed
and available identities, the installation's update policy, runtime/manual
maintenance limits, and durable staging/activation results. **Approval
required** is the default. **Automatic for current SemVer builds** uses the same
updater and safety path for only a higher numeric build of the installed SemVer;
patch, minor, and major changes always wait for **Install**. **Check now** keeps
`/opt/atlas/current` unchanged until an applicable automatic or explicit
activation reaches its safe checkpoint. **Install** appears only for the fully
   staged, identified, host-runtime-eligible, code-only-compatible candidate;
   host runtimes are checked again immediately before the safe pause. A
failed candidate is automatically rolled back and exposes **Retry**; it is not
retried automatically after restart, while a later eligible build may proceed.
Diagnose before retrying; neither policy bypasses Manual maintenance required.
Run `bun run verify:issue58`, `bun run verify:issue59`, `bun run
verify:issue60`, and `bun run verify:issue61` for the controlled discovery,
HTTP, updater, timeout, activation, rollback, policy, suppression, concurrency,
retention, and helper-continuity checks.

### Human policy, Install/Retry, and continuing-Session check

Do this only on the target host after the services above are installed:

1. Open a disposable continuing Session and record its Atlas/OpenCode Session
   identities. Confirm a scoped Git and `gh` read works without printing a token.
2. On **Updates**, confirm **Approval required**, select **Automatic for current
   SemVer builds**, save, reload, and restart Atlas once to confirm the selection
   persists. Switch back to **Approval required** unless this is the intended
   installation policy.
3. Use **Check now** and wait for **Staged**. For automatic-policy observation,
   use only a disposable higher build of the exact installed SemVer; confirm a
   SemVer-changing Release still waits for **Install**. Confirm the shown host
   requirements are met and no Manual maintenance required warning exists.
4. If approval is required, choose **Install** once. During the brief Atlas outage, confirm OpenCode and
   `atlas-credentials.service` remain running; repeat the scoped credential read
   from the existing Session directory if it is safe to do so.
5. Reopen **Updates** and require **Activated** or **Recovered** with the exact
   target. **Recovery failed** is not a successful rollback. Use **Retry** only
   after diagnosing the failed candidate; first confirm normal checks do not
   reactivate the suppressed build and that a later eligible build remains usable.
6. Reopen the same Session. Confirm its identity, latest Running/Waiting/Idle or
   terminal observation, branch, files, and one original prompt are preserved.
   If OpenCode observation is unavailable, expect the existing stale/not-ready
   presentation rather than treating the Atlas update as failed.
7. On **Updates**, inspect **Release retention** separately from activation.
   Confirm cleanup completed, or preserve a reported cleanup failure for
   diagnosis; do not treat a healthy active Release as failed solely because an
   old tree could not be removed. Repeat the scoped helper read from step 1.

Check keyboard focus and 320 px plus desktop layout manually for the policy
control, Check now, Install, Retry, active progress, recovered, and
recovery-failed states. These browser and live-service checks are intentionally
not automated here. Repeat policy observation independently on each installation;
there is no fleet coordinator or shared schedule.

### Read-only Release retention inspection

The updater automatically retains current, previous-working, staged,
in-flight, and Session-helper-referenced Releases. To inspect its decisions
without deleting live files:

```bash
sudo readlink -f /opt/atlas/current
sudo find /opt/atlas/releases -mindepth 1 -maxdepth 1 -type d -print | sort
sudo jq '{activation, cleanup}' /var/lib/atlas/update-state.json
sudo jq -r '.scopes[].helperPaths[]?' /var/lib/atlas/session-scopes.json | sort -u
```

Compare helper paths with the Release directories and the **Release retention**
result on `/updates`. On failure, inspect
`sudo journalctl --namespace=atlas -u atlas-updater.service` and fix the
filesystem or registry problem before restarting the updater to retry the same
rules. Do not manually `rm` a Release tree or edit either state file.

## Recovery and operational guardrails

`capture-recovery-config.sh` is the least protected recovery-copy procedure.
Run it as the operator after the required files and records exist. It copies
only `atlas.env`, `github.env`, `github-app.pem`, `supplier.key`, `updater.key`,
all installed Atlas/OpenCode/updater/recovery units, the selected release
marker/pin manifest, the Atlas journal-namespace bound, an operator-recorded
Tailscale route file, and an operator-recorded firewall file into
`/var/lib/atlas/recovery-config/current`. It also records SHA-256 checksums for
those files, the pinned tools, and the selected OpenCode executable. It rejects
missing, symlinked, or partial inputs, writes a private temporary tree, and
atomically retains the prior copy as `previous`; `capture-recovery-config.sh
rollback` swaps back without deleting the failed copy. Do not put secret values
in command arguments.

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
`verify-sqlite-wal.sh` follows `current` and records its observed OpenCode
version plus both actual fixed embedded SQLite builds. OpenCode has no database
command, so the script asks the selected executable's own embedded Bun runtime
(`BUN_BE_BUN=1`, in a throwaway scrubbed environment that never touches live
OpenCode state) for `sqlite_version()` and `sqlite_source_id()`. It then
requires the executable to contain exactly that one SQLite build. Limits: this
assumes OpenCode opens its database through Bun's built-in `bun:sqlite`, as
2.3.2 does. A build without the embedded Bun CLI, or with a second SQLite
build, fails closed and cannot be verified this way.
`restore-rehearsal.sh` validates a writable restore before scrubbing known
runtime endpoints and saved credentials without starting a service, then
re-installs only the credential-free headless OpenCode configuration.
OpenCode 2.x keeps saved provider keys and OAuth tokens (including MCP OAuth)
in `opencode.db`, so `scrub-opencode-credentials.ts` deletes those database
rows (`credential`, `account`, `control_account`, well-known `kv` entries),
then `VACUUM`s and checkpoints the database so no copy survives in free pages
or the WAL. That needs time and up to twice the database size in free space.
The legacy `auth.json`, which OpenCode imports but never deletes, is removed
too. The exact conditional recovery,
release, rollback, and rehearsal procedure is in [RECOVERY.md](RECOVERY.md).

## Human-only cutover order

The following is a handoff, not an instruction for an agent to execute:

1. Re-inventory the host and confirm `/opt/atlas`, `/var/lib/atlas`,
   `/etc/atlas`, `/var/backups/atlas`, and `/run/atlas` do not conflict. Leave
   the exFAT disk untouched. Record current OpenCode/agent PIDs and do not
   start the new unit while the existing live server remains active.
2. Install Git and gh meeting the published minimums (and the pinned Bun for
   the recovery tools). Run
   `stage-opencode.sh` with an explicitly chosen exact server version in a
   disposable isolated directory. Verify its registry integrity manifest,
   server-only immutable tree, reported version, and absence of service
   registration; do not install, select, or start it yet. Create the privileged
   directories and the ordinary-directory Btrfs subvolume. Install restricted config from
   `atlas.env.example` and `github.env.example`, plus the App key, without
   putting values in shell history, releases, clones, logs, or issue comments.
   Set the actual private origin and listener ports.
3. In an approved stopped-writer window, stop the existing OpenCode server and
   all agents only after the operator confirms it is safe. Copy, do not first
   delete, all OpenCode data/state/config directories into the three target
   XDG locations, including database WAL/journal sidecars. Keep originals
   until validation succeeds. Do not trust/copy the old live service endpoint;
   let the new service register a fresh endpoint.
4. Install a published Release with Phase 4 `atlas setup` (verifies the
   binary against `atlas-release.json`, builds the Release folder, selects it,
   installs the services and the headless OpenCode configuration without
   restarting OpenCode). Separately install the staged OpenCode version,
   atomically switch `/opt/atlas/tools/opencode/current`, and run its
   `--version`. Install the remaining units, run `systemctl daemon-reload`,
   then explicitly enable/start the independent units in that order. Atlas must
   not own OpenCode's lifecycle; staging or restarting Atlas must not switch,
   start, stop, or restart OpenCode or agents.
5. Capture the protected recovery configuration with
   `capture-recovery-config.sh`, record the route/firewall inputs, and run
   `check-space.sh`. Refresh the copy whenever any deployment input changes.
6. Configure private Tailscale Serve to the UI loopback port and public
   Tailscale Funnel to the webhook loopback port on different externally
   served ports. Apply the reviewed tailnet/firewall policy. Never Funnel the
   UI listener. Configure GitHub's signed webhook for `/webhooks/github`.
7. Run `check-health.sh`, then the independent OpenCode `--version` diagnostic,
   private cookie/bearer checks, public webhook-only
   exclusion checks, valid/invalid signed webhook checks, and the credential
   matrix before admitting work. Reopen a preserved Session without replaying
   a prompt. Re-check after a planned reboot only after the operator accepts
   the interruption window.
8. Follow `RECOVERY.md` to verify and enable daily snapshots, exercise isolated
   restore, and record the complete release check. A snapshot cannot undo
   GitHub effects; schema rollback requires matching data and binaries.
