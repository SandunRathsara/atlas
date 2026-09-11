#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$root/pins.env"

required=(
  "$root/atlas.env.example"
  "$root/RECOVERY.md"
  "$root/github.env.example"
  "$root/bootstrap.sh"
  "$root/systemd/atlas.service"
  "$root/systemd/atlas-credentials.service"
  "$root/systemd/atlas-updater.service"
  "$root/systemd/opencode.service"
  "$root/systemd/atlas-snapshot.service"
  "$root/systemd/atlas-snapshot.timer"
  "$root/systemd/atlas-space-check.service"
  "$root/systemd/atlas-space-check.timer"
  "$root/bin/gh"
  "$root/bin/git"
  "$root/bin/git-credential-atlas"
  "$root/capture-recovery-config.sh"
  "$root/check-health.sh"
  "$root/check-opencode.sh"
  "$root/check-space.sh"
  "$root/atlas-snapshot.sh"
  "$root/atlas-snapshot.marker"
  "$root/lib/recovery-status.sh"
  "$root/restore-rehearsal.sh"
  "$root/verify-opencode-commands.sh"
  "$root/verify-sqlite-wal.sh"
  "$root/stage-opencode.sh"
  "$root/stage-release.sh"
  "$root/../scripts/build-release.sh"
  "$root/../scripts/release.ts"
  "$root/../scripts/verify-release-artifact.sh"
  "$root/../src/release.ts"
  "$root/../src/updater.ts"
  "$root/../src/updater-server.ts"
  "$root/../docs/RELEASES.md"
  "$root/../.github/workflows/release.yml"
  "$root/logrotate/atlas-opencode"
  "$root/journald/atlas.conf"
  "$root/../scripts/check-restored-state.ts"
)
for path in "${required[@]}"; do
  test -f "$path" || { echo "missing deployment asset: $path" >&2; exit 1; }
done

updater_unit="$root/systemd/atlas-updater.service"
grep -Fq 'User=root' "$updater_unit"
grep -Fq 'Group=omega' "$updater_unit"
grep -Fq 'ExecStart=/opt/atlas/tools/bun/1.3.14/bin/bun /opt/atlas/services/atlas-updater/updater-server.ts' "$updater_unit"
grep -Fq 'ReadWritePaths=/opt/atlas/releases /var/lib/atlas /run/atlas-updater' "$updater_unit"
grep -Fq 'NoNewPrivileges=true' "$updater_unit"
grep -Fq 'Restart=on-failure' "$updater_unit"
if grep -Eiq 'opencode|EnvironmentFile=' "$updater_unit"; then
  echo "Atlas updater must not manage OpenCode or load Atlas UI secrets" >&2
  exit 1
fi
test -x "$root/bootstrap.sh" || { echo "bootstrap command is not executable" >&2; exit 1; }

for script in "$root/bin/gh" "$root/bin/git" "$root/bin/git-credential-atlas" "$root/bootstrap.sh" "$root/capture-recovery-config.sh" "$root/check-health.sh" "$root/check-opencode.sh" "$root/check-space.sh" "$root/atlas-snapshot.sh" "$root/lib/recovery-status.sh" "$root/restore-rehearsal.sh" "$root/verify-opencode-commands.sh" "$root/verify-sqlite-wal.sh" "$root/stage-opencode.sh" "$root/stage-release.sh" "$root/../scripts/build-release.sh" "$root/../scripts/verify-release-artifact.sh"; do
  bash -n "$script"
done

for unit in "$root/systemd/atlas.service" "$root/systemd/atlas-credentials.service" "$root/systemd/opencode.service"; do
  grep -Fq 'User=omega' "$unit"
  grep -Fq 'Restart=on-failure' "$unit"
  grep -Fq 'RestartSec=5s' "$unit"
  if grep -Eiq 'mise|Requires=(atlas|opencode)|PartOf=(atlas|opencode)|BindsTo=(atlas|opencode)' "$unit"; then
    echo "unit has an interactive-shim or lifecycle coupling" >&2
    exit 1
  fi
done

for unit in "$root/systemd/atlas-snapshot.service" "$root/systemd/atlas-space-check.service"; do
  grep -Fq 'User=root' "$unit"
  grep -Fq 'Group=omega' "$unit"
  grep -Fq 'LogRateLimitIntervalSec=30s' "$unit"
  grep -Fq 'LogNamespace=atlas' "$unit"
done

grep -Fq 'Persistent=true' "$root/systemd/atlas-snapshot.timer"
grep -Fq 'OnCalendar=*-*-* 03:00:00' "$root/systemd/atlas-snapshot.timer"
grep -Fq 'SuccessExitStatus=1 2' "$root/systemd/atlas-space-check.service"
grep -Fq 'atlas-v1-' "$root/atlas-snapshot.sh"
grep -Fq 'daily_count -lt 7' "$root/atlas-snapshot.sh"
grep -Fq 'weekly_count -lt 4' "$root/atlas-snapshot.sh"

grep -Fq -- '--log-level WARN serve --service --hostname 127.0.0.1' "$root/systemd/opencode.service"
grep -Fq 'atlas-credentials.service' "$root/systemd/atlas.service"
grep -Fq 'atlas-updater.service' "$root/systemd/atlas.service"
grep -Fq 'atlas-credentials.service' "$root/systemd/opencode.service"
grep -Fq 'RuntimeDirectory=atlas' "$root/systemd/atlas-credentials.service"
if grep -Fq 'RuntimeDirectory=atlas' "$root/systemd/atlas.service"; then
  echo "Atlas UI service must not own the credential socket directory" >&2
  exit 1
fi
if grep -Eq '/opt/atlas/current|EnvironmentFile=' "$root/systemd/atlas-credentials.service"; then
  echo "credential supplier must not depend on a selected Atlas release or load UI secrets" >&2
  exit 1
fi
grep -Fq 'ExecStart=/opt/atlas/tools/bun/1.3.14/bin/bun /opt/atlas/services/atlas-credentials/credential-server.ts' "$root/systemd/atlas-credentials.service"
grep -Fq 'ExecStartPre=/opt/atlas/current/deploy/check-opencode.sh' "$root/systemd/opencode.service"
grep -Fq 'ExecStart=/opt/atlas/tools/opencode/current/bin/opencode2 ' "$root/systemd/opencode.service"
grep -Fq 'PATH=/opt/atlas/current/deploy/bin:' "$root/systemd/atlas.service"
grep -Fq 'PATH=/opt/atlas/current/deploy/bin:' "$root/systemd/opencode.service"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git' "$root/systemd/atlas.service"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git' "$root/systemd/opencode.service"
grep -Fq 'XDG_CACHE_HOME=/var/lib/atlas/opencode-cache' "$root/systemd/opencode.service"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git' "$root/atlas.env.example"
grep -Fq 'ATLAS_UPDATER_SOCKET=/run/atlas-updater/updater.sock' "$root/atlas.env.example"
grep -Fq 'ATLAS_UPDATER_KEY_PATH=/etc/atlas/updater.key' "$root/atlas.env.example"
grep -Fq 'ExecStartPre=/opt/atlas/current/deploy/bin/git --version' "$root/systemd/atlas.service"
grep -Fq 'ExecStartPre=/opt/atlas/current/deploy/bin/git --version' "$root/systemd/opencode.service"
grep -Fq 'LogRateLimitIntervalSec=30s' "$root/systemd/atlas.service"
grep -Fq 'LogRateLimitIntervalSec=30s' "$root/systemd/opencode.service"
grep -Fq 'LogRateLimitBurst=1000' "$root/systemd/atlas.service"
grep -Fq 'LogRateLimitBurst=1000' "$root/systemd/opencode.service"
grep -Fq 'EnvironmentFile=/etc/atlas/atlas.env' "$root/systemd/atlas.service"
grep -Fq 'ATLAS_STORAGE_WARNING_BYTES=21474836480' "$root/atlas.env.example"
grep -Fq 'ATLAS_BTRFS_METADATA_WARNING_PERCENT=80' "$root/atlas.env.example"
grep -Fq 'ATLAS_BTRFS_METADATA_PAUSE_PERCENT=90' "$root/atlas.env.example"
grep -Fq 'ATLAS_BTRFS_METADATA_REQUIRED=1' "$root/atlas.env.example"
grep -Fq 'ATLAS_RECOVERY_STATUS_PATH=/var/lib/atlas/recovery-status' "$root/atlas.env.example"
grep -Fq 'ATLAS_RECOVERY_CONFIG_ROOT=/var/lib/atlas/recovery-config' "$root/atlas.env.example"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/tools/git/2.55.0/bin/git' "$root/pins.env"
grep -Fq 'ATLAS_OPENCODE_BINARY=/opt/atlas/tools/opencode/current/bin/opencode2' "$root/pins.env"
grep -Fq '"@opencode-ai/client": "'"$ATLAS_OPENCODE_CLIENT_VERSION"'"' "$root/../package.json"
grep -Fq 'server_version=%s' "$root/stage-opencode.sh"
grep -Fq 'registry_integrity=%s' "$root/stage-opencode.sh"
if grep -Eq 'ATLAS_OPENCODE_(VERSION|CLI_LINUX_X64_INTEGRITY|CLIENT_INTEGRITY|SCHEMA_INTEGRITY|PROTOCOL_INTEGRITY)=' "$root/pins.env"; then
  echo "deployment manifest still pairs the OpenCode server with Atlas client packages" >&2
  exit 1
fi
if grep -Eq '@opencode-ai/(client|schema|protocol)|systemctl' "$root/stage-opencode.sh" "$root/stage-release.sh"; then
  echo "staging must not bundle Atlas client packages or manage OpenCode lifecycle" >&2
  exit 1
fi
grep -Fq 'maxsize 100M' "$root/logrotate/atlas-opencode"
grep -Fq 'rotate 10' "$root/logrotate/atlas-opencode"
grep -Fq 'copytruncate' "$root/logrotate/atlas-opencode"
grep -Fq 'SystemMaxUse=256M' "$root/journald/atlas.conf"
grep -Fq 'MaxRetentionSec=14day' "$root/journald/atlas.conf"
grep -Fq "ATLAS_BUN_VERSION=$ATLAS_BUN_VERSION" "$root/pins.env"
if grep -Fq 'EnvironmentFile=' "$root/systemd/opencode.service"; then
  echo "OpenCode must not inherit Atlas secret environment" >&2
  exit 1
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  unit_output=$(mktemp)
  trap 'rm -f -- "$unit_output"' EXIT
  if ! systemd-analyze verify "$root/systemd/atlas.service" "$root/systemd/atlas-credentials.service" "$root/systemd/atlas-updater.service" "$root/systemd/opencode.service" "$root/systemd/atlas-snapshot.service" "$root/systemd/atlas-snapshot.timer" "$root/systemd/atlas-space-check.service" "$root/systemd/atlas-space-check.timer" >"$unit_output" 2>&1; then
    # The pinned host paths are intentionally absent during safe setup. Keep
    # systemd's syntax/dependency check, but do not pretend staged binaries
    # exist before the human cutover window.
    unexpected=$(grep -Ev '^((atlas|atlas-credentials|atlas-updater|opencode|atlas-snapshot|atlas-space-check)\.service: Command /opt/atlas/(current/deploy/(bin/git|check-opencode\.sh|atlas-snapshot\.sh|check-space\.sh)|tools/(bun/1\.3\.14/bin/bun|git/2\.55\.0/bin/git|opencode/current/bin/opencode2)) is not executable: No such file or directory)$' "$unit_output" || true)
    if [[ -n "$unexpected" ]]; then
      cat "$unit_output" >&2
      exit 1
    fi
    echo "systemd unit syntax verified; staged executable paths are not installed yet"
  fi
  rm -f -- "$unit_output"
  trap - EXIT
fi

echo "deployment assets verified (static only; no service, routing, or data changes made)"
