# Installing Atlas

One command installs Atlas on a private Linux server. As root, it downloads the
`atlas` binary into a new root-only folder, checks its SHA-256, and runs
`atlas setup` from there.

## What the server needs

- Linux x86_64 with glibc (Debian, Ubuntu, Fedora, ...). Not Alpine/musl, not arm64.
- systemd, `curl` (or `wget`), `sha256sum`, and root (`sudo`).
- git 2.36.0 or newer and gh 2.3.0 or newer, installed system-wide: owned by
  root, not writable by anyone else, not under `/home` or `/root`. Stock
  Debian 12 and Ubuntu 24.04 packages are fine: `sudo apt install git gh`.
- OpenCode is optional at install time. Without it, setup warns and Atlas
  starts, but Sessions cannot run until OpenCode is installed.
- A GitHub App for your organization: App ID, installation ID, and its private
  key (`.pem`).

Setup checks these first and stops before changing anything if git, gh or
systemd are missing or too old.

## Install

Interactive (asks questions on your terminal, even through `| sudo sh`):

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sudo sh
```

With an answers file (no questions):

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sudo sh -s -- --answers /root/atlas-answers.json --create-user
```

A pinned Release (`ATLAS_VERSION=v1.2.0+build.7` works too):

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sudo sh -s -- --version v1.2.0+build.7
```

Every option other than `--version` goes to `atlas setup`. Without root the
installer stops before downloading and prints the `sudo sh` command. With no
terminal and no options, it keeps the verified files in its root-only folder
under `/var/tmp` and prints the `… setup --source-dir …` command to run as
root.

`atlas setup` refuses a `--source-dir` that is not root's: the folder, its
files, and every folder above must be owned by root and not writable by group
or others. It copies the Release to its own root-only folder and checks it
again before installing.

At the end setup prints the URL, the account Atlas runs as, and the sign-in
token. **The token is shown once.** Save it.

## Service account

Atlas runs as a dedicated system account, `atlas` by default: own group, no
login shell, home `<data>/home`. If it is missing, setup asks before creating
it; without a terminal pass `--create-user` (`--yes` is not enough).

Setup will not quietly use an account that can become root (member of sudo,
wheel, admin, adm, docker, lxd, incus, libvirt, disk, or with sudo rights).
Atlas runs AI coding Sessions as this account, so anything that takes over a
Session could take over the whole machine. On a terminal it says so and asks
y/n; without one it stops unless `--allow-privileged-user` is given. root is
always refused. A re-run or adopt keeps the account already in the units and
warns once if it is privileged.

Sign OpenCode in as that account (setup prints this after a fresh install):

```sh
sudo -u atlas env HOME=/var/lib/atlas/home XDG_CONFIG_HOME=/var/lib/atlas/opencode-config \
  XDG_DATA_HOME=/var/lib/atlas/opencode-data XDG_STATE_HOME=/var/lib/atlas/opencode-state \
  XDG_CACHE_HOME=/var/lib/atlas/opencode-cache opencode auth login
```

## Answers file

JSON. Every key is optional; anything missing is asked for (or defaulted).

| Key | Meaning | Default |
|---|---|---|
| `user` | Service account, not root (see Service account) | `atlas` |
| `createUser` | Create `user` if missing (`--create-user`) | asked; `false` without a terminal |
| `allowPrivilegedUser` | Allow an account that can become root (`--allow-privileged-user`) | `false` |
| `group` | Service group | group named like `user` |
| `organization` | GitHub organization login | asked |
| `appId` | GitHub App ID | asked |
| `installationId` | GitHub App installation ID | asked |
| `privateKeyPath` | App private key; copied to `/etc/atlas/github-app.pem` | asked |
| `origin` | Browser URL of Atlas (`https://…`) | the Tailscale URL |
| `port` | UI port on 127.0.0.1 | `3000` |
| `webhookPort` | Webhook port on 127.0.0.1 | `3001` |
| `git`, `gh`, `openCode` | Tool paths | found on `PATH` |
| `dataDir` | Atlas data | `/var/lib/atlas` |
| `tailscale` | `yes`, `no`, or `ask` | `ask` |

```json
{ "createUser": true, "organization": "acme", "appId": "12345", "installationId": "67890",
  "privateKeyPath": "/root/acme-atlas.pem", "tailscale": "yes" }
```

Each key also has a flag (`--user`, `--group`, `--create-user`, `--allow-privileged-user`, `--org`, `--app-id`,
`--installation-id`, `--private-key`, `--origin`, `--port`, `--webhook-port`,
`--git`, `--gh`, `--opencode`, `--data-dir`, `--tailscale`). Flags win over
the file. Other flags: `--rotate-token`, `--rotate-webhook-secret`, `--adopt`,
`--confirm-running-sessions`, `--yes`, `--dry-run`, `--health-timeout <sec>`.
Full list: `atlas setup --help`.

## Tailscale

Setup can share the UI on your tailnet with `tailscale serve` (never Funnel).

- Not installed, not running, or `--tailscale no`: skipped. If no `origin` was
  given either, setup warns that `ATLAS_ORIGIN` is unset.
- `ask` (default): asks y/n. With no terminal it skips and prints the command.
- `yes`: serves without asking.
- Something else already serves port 443, or the current serve config cannot
  be read: setup asks before replacing it, and leaves it alone without a
  terminal.
- Serve or HTTPS not enabled on the tailnet: setup prints the admin link and
  offers retry/skip.
- When served, `ATLAS_ORIGIN` becomes `https://<machine>.<tailnet>.ts.net`
  (unless `origin` was given), Atlas restarts, and health is checked again.

Webhooks are never exposed by setup. It prints the Funnel command to run
yourself: `tailscale funnel --bg --https=8443 http://127.0.0.1:3001`, then point
the GitHub App webhook at `https://<machine>.<tailnet>.ts.net:8443/webhooks/github`.

## Running setup again

Safe to re-run (for example with a newer `--version`). Existing settings and
secrets are kept; secrets change only with `--rotate-token` or
`--rotate-webhook-secret`. A config file that is not root-only is rebuilt:
its values are kept, its file paths are reset to the fixed ones. It never moves `current` to an older Release.
Changed files are backed up to `/var/backups/atlas/setup-<time>/` first, and
services restart only when something changed. OpenCode is never restarted.

## Adopting the older install (the owner's server)

The older layout runs Atlas from a source tree with Bun. Setup detects it and
moves it to the binary, keeping `/var/lib/atlas`, `/etc/atlas` secrets, the
service user, ports and origin. Secrets the service user owned become
`root:<group> 0640`; a key outside `/etc/atlas` is read as the service user
and copied to `/etc/atlas/github-app.pem`.

1. Check no Session is preparing: open Atlas, or `systemctl status atlas`.
2. Preview: run the installer with `--adopt --dry-run`. Nothing changes.
3. Run it for real with `--adopt` (or answer y when asked).
   - Active Sessions: setup lists them and asks again. Without a terminal it
     stops unless `--confirm-running-sessions` is given.
   - Running Sessions keep their OpenCode work, because OpenCode is not
     restarted. A Session that is *preparing* fails and must be started again.
4. Setup backs up the old units, `atlas.env` and `github.env` to
   `/var/backups/atlas/<time>/`, plus any other file whose contents it
   changes. It records the old symlink targets in `ROLLBACK.txt` there.
   Keys whose contents stay the same (`supplier.key`, `updater.key`, the App
   key) are not copied; they only change owner and mode, and rollback does not
   change those back.
5. It stops atlas → atlas-updater → atlas-credentials, writes the new units,
   starts them, and checks `/health`.
6. If that fails and the database schema is unchanged, setup restores the old
   install by itself. If the new Atlas already migrated the database, it does
   not restore; see Rollback.
7. Afterwards: setup does not restart OpenCode. If its unit changed, setup says
   so; restart it when no Session runs: `sudo systemctl restart opencode`.
8. Old Release trees under `/opt/atlas/releases` and Bun under
   `/opt/atlas/tools/bun` are kept. Remove them by hand once you are happy.

Off Btrfs, the old snapshot/space-check timers are disabled and removed (they
are in the backup). On Btrfs, setup installs the new ones.

## Rollback

Each adopt backup has a `ROLLBACK.txt` with the exact commands. Its shape:

```sh
sudo systemctl stop atlas.service atlas-updater.service atlas-credentials.service
sudo cp -a /var/backups/atlas/<time>/etc/systemd/system/. /etc/systemd/system/
sudo cp -a /var/backups/atlas/<time>/etc/atlas/. /etc/atlas/
sudo ln -sfnT <old target> /opt/atlas/current      # one line per symlink
sudo systemctl daemon-reload
sudo systemctl start atlas-credentials.service atlas-updater.service atlas.service
```

If the new Atlas already migrated the database, restore `/var/lib/atlas` from
a snapshot first (`deploy/RECOVERY.md`); the old code cannot read a newer
schema.

To go back to an older binary Release after a re-run, point `current` at its
folder and restart:
`sudo ln -sfnT /opt/atlas/releases/atlas-<tag> /opt/atlas/current && sudo systemctl restart atlas`.
Check `rollback.codeOnlyCompatible` in that Release's metadata first
(`docs/RELEASES.md`).

## Files setup writes

| Path | Owner, mode |
|---|---|
| `/opt/atlas`, `/opt/atlas/releases/atlas-<tag>` | root, 0755 / 0555 |
| `/etc/atlas` | root:group, 0750 |
| `/etc/atlas/atlas.env` | root, 0600 |
| `/etc/atlas/github.env`, `github-app.pem`, `supplier.key`, `updater.key` | root:group, 0640 |
| `/var/lib/atlas` and its folders | service user, 0700 (created by that account) |
| `/var/lib/atlas-updater` (updater state) | root:group, 0700 |
| `/var/backups/atlas` | root, 0700 |
| `/etc/systemd/system/atlas*.service`, `opencode.service` | root, 0644 |
| `/usr/local/bin/atlas` | symlink to `/opt/atlas/current/atlas` |

Root never follows a path the service account can change: setup refuses
symlinks and unsafe parent folders, replaces files instead of changing them in
place, and does everything inside the data folder as the service account.

## Security model and known limits

- **Trust.** A Release is trusted through HTTPS plus a SHA-256 from the same
  GitHub Release. There is no signature, so whoever controls this repository's
  Releases controls every install's updates.
- **Root treats the service account as untrusted.** The installer, setup and
  the updater never run, own or re-permission anything that account can write.
  No binary runs before its SHA-256 matches. Candidates run as the service
  account, never as root. The updater only moves forward to a higher build.
- **Limit: Sessions can use the GitHub App.** Sessions run as the same account
  as the credentials service, so code in a Session can read the App key and
  `supplier.key`. It can act as the App on every repository the App is
  installed on, not just its own. This was already true before the single
  binary. Install the App only on repositories you are willing to expose to
  Sessions, and keep the dedicated unprivileged account (the default). A
  separate credentials account is future work.
- **Limit: Sessions can start updates.** A Session can read `updater.key`. With
  it, it can switch the policy to automatic and stage, prepare and activate a
  newer published Release without approval in the web UI, skipping Atlas's safe
  pause. It cannot downgrade, supply its own metadata, or run unpublished code,
  and all staging and checksum checks still apply.
- **Not tested automatically yet:** real Tailscale Serve (tests use fakes),
  Btrfs snapshots on a real Btrfs host. musl and arm64 are not supported.
