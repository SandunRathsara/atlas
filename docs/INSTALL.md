# Installing Atlas

One command installs Atlas on a private Linux server. It downloads the `atlas`
binary, checks its SHA-256, and runs `sudo atlas setup`.

## What the server needs

- Linux x86_64 with glibc (Debian, Ubuntu, Fedora, ...). Not Alpine/musl, not arm64.
- systemd, `curl` (or `wget`), `sha256sum`, and root or `sudo`.
- git 2.36.0 or newer and gh 2.3.0 or newer. Stock Debian 12 and Ubuntu 24.04
  packages are fine: `sudo apt install git gh`.
- OpenCode is optional at install time. Without it, setup warns and Atlas
  starts, but Sessions cannot run until OpenCode is installed.
- A GitHub App for your organization: App ID, installation ID, and its private
  key (`.pem`).

Setup checks these first and stops before changing anything if git, gh or
systemd are missing or too old.

## Install

Interactive (asks questions on your terminal, even through `| sh`):

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sh
```

With an answers file (no questions):

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sh -s -- --answers /root/atlas-answers.json
```

A pinned Release (`ATLAS_VERSION=v1.2.0+build.7` works too):

```sh
curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sh -s -- --version v1.2.0+build.7
```

Every option other than `--version` goes to `atlas setup`. With no terminal
and no options, the installer keeps the verified files in
`~/.cache/atlas-install` and prints the `sudo … setup --source-dir …` command
to run.

At the end setup prints the URL and the sign-in token. **The token is shown
once.** Save it.

## Answers file

JSON. Every key is optional; anything missing is asked for (or defaulted).

| Key | Meaning | Default |
|---|---|---|
| `user` | Existing service account, not root (`useradd -m atlas`) | asked |
| `group` | Service group | group named like `user` |
| `organization` | GitHub organization login | asked |
| `appId` | GitHub App ID | asked |
| `installationId` | GitHub App installation ID | asked |
| `privateKeyPath` | App private key; copied to `/etc/atlas` | asked |
| `origin` | Browser URL of Atlas (`https://…`) | the Tailscale URL |
| `port` | UI port on 127.0.0.1 | `3000` |
| `webhookPort` | Webhook port on 127.0.0.1 | `3001` |
| `git`, `gh`, `openCode` | Tool paths | found on `PATH` |
| `dataDir` | Atlas data | `/var/lib/atlas` |
| `tailscale` | `yes`, `no`, or `ask` | `ask` |

```json
{ "user": "atlas", "organization": "acme", "appId": "12345", "installationId": "67890",
  "privateKeyPath": "/root/acme-atlas.pem", "tailscale": "yes" }
```

Each key also has a flag (`--user`, `--group`, `--org`, `--app-id`,
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
- Something else already serves port 443: setup asks before replacing it, and
  leaves it alone without a terminal.
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
`--rotate-webhook-secret`. It never moves `current` to an older Release.
Changed files are backed up to `/var/backups/atlas/setup-<time>/` first, and
services restart only when something changed. OpenCode is never restarted.

## Adopting the older install (the owner's server)

The older layout runs Atlas from a source tree with Bun. Setup detects it and
moves it to the binary, keeping `/var/lib/atlas`, `/etc/atlas` secrets, the
service user, ports and origin.

1. Check no Session is preparing: open Atlas, or `systemctl status atlas`.
2. Preview: run the installer with `--adopt --dry-run`. Nothing changes.
3. Run it for real with `--adopt` (or answer y when asked).
   - Active Sessions: setup lists them and asks again. Without a terminal it
     stops unless `--confirm-running-sessions` is given.
   - Running Sessions keep their OpenCode work, because OpenCode is not
     restarted. A Session that is *preparing* fails and must be started again.
4. Setup backs up the old units, `/etc/atlas` and the symlinks to
   `/var/backups/atlas/<time>/` and writes `ROLLBACK.txt` there.
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
| `/etc/atlas/github.env`, App key, `supplier.key` | service user, 0600 |
| `/etc/atlas/updater.key` | root:group, 0640 |
| `/var/lib/atlas` | service user, 0700 |
| `/etc/systemd/system/atlas*.service`, `opencode.service` | root, 0644 |
| `/usr/local/bin/atlas` | symlink to `/opt/atlas/current/atlas` |
