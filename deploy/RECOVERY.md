# Atlas local recovery and manual release runbook

These are operator procedures. Repository scripts never stop services, expose a
listener, launch an Agent, change Tailscale/GitHub, or select a production
release automatically.

## Protection boundary and targets

- `/var/lib/atlas` must be one Btrfs subvolume containing ordinary directories
  only: Atlas SQLite and its WAL/journal, OpenCode data/state/config/cache and
  matching database sidecars, complete Session directories, and
  `recovery-config/current`. Nested subvolumes, nested mounts, and external
  symlink targets are not captured. Inventory these before readiness.
- `/var/backups/atlas` contains local read-only snapshots named only
  `atlas-v1-YYYYMMDDTHHMMSSZ`. Pruning requires that exact name, a matching
  `.atlas-snapshot-v1` marker, a Btrfs subvolume, and `ro=true`. Seven newest
  UTC daily points and four newest ISO-week points are retained as a union, so
  one point can satisfy both policies. Unverified entries are warned about and
  never removed.
- Recovery point objective is **at most 24 hours of local data loss** and
  recovery time objective is **manual recovery within one working day**, only
  when scheduled snapshots succeeded and a usable snapshot survives.
  Same-disk snapshots do not protect against host/disk loss, privileged
  deletion, or lost encryption access. There is no off-site backup in Phase 1.
  Running Agents and changed snapshot blocks can still exhaust storage.

## One-time operator activation

1. Confirm `/var/lib/atlas` is the complete encrypted-pool subvolume and every
   path in `deploy/README.md` is inside it as an ordinary directory. Confirm
   `/var/backups/atlas` is a restricted ordinary directory on the same Btrfs
   filesystem. Leave unrelated disks and data untouched.
2. Install `deploy/atlas-snapshot.marker` as
   `/var/lib/atlas/.atlas-snapshot-v1`, owned by root and mode `0444`. Install
   the four recovery service/timer units and `deploy/journald/atlas.conf` as
   `/etc/systemd/journald@atlas.conf`. Do not put secrets in unit arguments or
   logs. Verify the dedicated Atlas journal namespace is capped at 256 MiB/14
   days and the separate OpenCode file-log rotation is installed.
3. With Atlas, OpenCode, and Agent writers stopped in an approved window,
   capture `recovery-config/current`, then run:

   ```bash
   sudo ATLAS_WRITERS_STOPPED=YES /opt/atlas/current/deploy/verify-sqlite-wal.sh
   ```

   This records the actual SQLite versions embedded in pinned Bun and the
   currently selected OpenCode executable, plus that executable's observed
   version, only if they include SQLite's accepted WAL-reset fix. Host
   `sqlite3`, WAL mode, and FULL/NORMAL synchronous settings are not substitutes.
4. Enable and start only the timers after reviewing them:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now atlas-space-check.timer atlas-snapshot.timer
   ```

   The snapshot timer is daily and persistent (catch-up). The space timer
   atomically refreshes `/var/lib/atlas/recovery-status` every five minutes.
   Missing, stale, or malformed space status pauses production preparation;
   backup failure is warning-only. Free space below 20 GiB warns, below 10 GiB
   pauses, and Btrfs metadata warns/pauses at the configured 80%/90% defaults.

## Isolated restore rehearsal

Do not use the live data path as a target. Before the source snapshot, create
two private manifests without prompts, file contents, tokens, or keys:

- `files.sha256`: one or more representative saved files, each as
  `<sha256><two spaces><path relative to /var/lib/atlas>`.
- `history.tsv`: every Atlas Session with an OpenCode association, each as
  `<Atlas Session ID><tab><OpenCode Session ID><tab><initial message ID>`; use
  `-` only when no initial message was durably recorded. Capture it independently
  before the snapshot so the restore is compared with known state.

For example, while writers are stopped, choose at least one known saved file
and capture all associations with the pinned Bun runtime (redirect both outputs
to private mode-`0600` files):

```bash
cd /var/lib/atlas
sha256sum -- sessions/SESSION_ID/PATH_TO_KNOWN_FILE > /root/atlas-recovery/files.sha256
/opt/atlas/tools/bun/1.3.14/bin/bun --eval \
  'import { Database } from "bun:sqlite"; const d=new Database("/var/lib/atlas/atlas.sqlite",{readonly:true}); for(const r of d.query("SELECT atlas_id,opencode_session_id,COALESCE(initial_message_id,char(45)) AS message_id FROM sessions WHERE opencode_session_id IS NOT NULL ORDER BY atlas_id").all()) console.log(`${r.atlas_id}\t${r.opencode_session_id}\t${r.message_id}`); d.close()' \
  > /root/atlas-recovery/history.tsv
chmod 0600 /root/atlas-recovery/files.sha256 /root/atlas-recovery/history.tsv
```

Then stop Atlas/OpenCode and all Agent writers, set `ATLAS_ADMISSION_PAUSED=1`
in the live Atlas environment, and restart Atlas only if a private read-only UI
is needed to confirm the pause. Do not restart OpenCode. Confirm encryption and
recovery-key access, the selected release, pinned tools, and the selected
OpenCode server. Run against an
empty direct child of a dedicated same-filesystem rehearsal root:

```bash
sudo install -d -m 0700 /var/lib/atlas-restore-rehearsals
sudo ATLAS_WRITERS_STOPPED=YES ATLAS_ADMISSION_DISABLED=YES \
  /opt/atlas/current/deploy/restore-rehearsal.sh \
  /var/backups/atlas/atlas-v1-YYYYMMDDTHHMMSSZ \
  /var/lib/atlas-restore-rehearsals/rehearsal-YYYYMMDD \
  /root/atlas-recovery/files.sha256 \
  /root/atlas-recovery/history.tsv
```

The script creates a writable Btrfs restore, checks recovery-file/tool/release
matching, both database integrities, Atlas foreign keys and
Repository/Session/PR/reservation associations, Session directories, complete
OpenCode history identities, credential-scope associations, and saved-file
checksums. It then removes restored provider configuration/auth files, service
discovery, webhook/routing secrets, and supplier credentials/registration.
It never starts Atlas, OpenCode, Agents, sockets, or listeners. Never point a
service at the rehearsal tree. Preserve a failed tree for investigation; delete
only a positively identified rehearsal tree after the owner accepts the result.

## Versioned release and rollback

1. Set `ATLAS_ADMISSION_PAUSED=1` in `/etc/atlas/atlas.env` and restart **Atlas
   only**. Confirm queued work does not enter Preparing. Do not stop OpenCode.
2. Drain Active Sessions. Waiting/unfinished work may defer maintenance
   indefinitely for an explicit operator decision; never force interruption.
   Preserve publication reservations.
3. Stop writers only in the approved maintenance window. Refresh
   `recovery-config/current`, verify both embedded SQLite builds, take and
   verify a pre-upgrade snapshot, and record Atlas commit/release, Bun,
   OpenCode client/server, Git, gh, and schema versions.
4. Verify and extract the published archive selected by `atlas-release.json`
   (or use `stage-release.sh` only for an unpublished manual rehearsal). Require
   `rollback.codeOnlyCompatible` for ordinary code-only rollback; otherwise
   follow its non-empty manual-maintenance instructions. Run migrations by
   selecting the immutable versioned release and starting Atlas while admission
   remains paused. The independently installed credential supplier and its
   stable support tree remain running; do not restart it as part of release
   selection. Never overwrite a release or restart OpenCode.
5. Validate authenticated Atlas identity and storage health first; this startup
   gate does not query or wait for OpenCode. Separately diagnose OpenCode and
   validate reconciliation, preserved Session reopening/history/files, private
   UI, public webhook-only exclusion, signatures, and Repository-scoped
   credential routing/renewal/denial. Rehearse restore. Only then set
   `ATLAS_ADMISSION_PAUSED=0`, restart Atlas, and confirm ordinary eligibility
   and storage checks resume preparation.
6. For code-only rollback with unchanged schema, pause admission and atomically
   select the previous immutable release. For schema/data changes, stop writers
   and restore the matching pre-upgrade data snapshot **with its matching
   release and tools** to a staged writable target before selection. Preserve
   damaged/current data when feasible. Recreate OpenCode discovery; do not
   trust restored service registration. Reconcile GitHub and OpenCode with
   admission closed because snapshots cannot undo external GitHub effects.
   Never replay old prompts. Resume only after the same checks as step 5.
