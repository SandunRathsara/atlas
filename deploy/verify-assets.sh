#!/usr/bin/env bash
# Static checks of the deployment assets. Changes nothing on the host.
# The four long-running units are rendered by src/units.ts (no checked-in
# copies); they are rendered into a scratch folder here and checked.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$root/pins.env"

required=(
  "$root/atlas.env.example"
  "$root/RECOVERY.md"
  "$root/github.env.example"
  "$root/systemd/atlas-snapshot.service"
  "$root/systemd/atlas-snapshot.timer"
  "$root/systemd/atlas-space-check.service"
  "$root/systemd/atlas-space-check.timer"
  "$root/capture-recovery-config.sh"
  "$root/check-health.sh"
  "$root/check-space.sh"
  "$root/atlas-snapshot.sh"
  "$root/atlas-snapshot.marker"
  "$root/lib/recovery-status.sh"
  "$root/restore-rehearsal.sh"
  "$root/verify-opencode-commands.sh"
  "$root/verify-sqlite-wal.sh"
  "$root/stage-opencode.sh"
  "$root/install-opencode-config.sh"
  "$root/scrub-opencode-credentials.ts"
  "$root/opencode/opencode.json"
  "$root/../scripts/build-release.ts"
  "$root/../scripts/release.ts"
  "$root/../scripts/verify-release-artifact.sh"
  "$root/../src/release.ts"
  "$root/../src/release-layout.ts"
  "$root/../src/units.ts"
  "$root/../src/updater.ts"
  "$root/../src/updater-server.ts"
  "$root/../src/credentials.ts"
  "$root/../docs/RELEASES.md"
  "$root/../.github/workflows/release.yml"
  "$root/logrotate/atlas-opencode"
  "$root/journald/atlas.conf"
  "$root/../scripts/check-restored-state.ts"
)
for path in "${required[@]}"; do
  test -f "$path" || { echo "missing deployment asset: $path" >&2; exit 1; }
done
# Retired tarball-era assets must stay gone.
for path in bootstrap.sh stage-release.sh check-activation-health.sh check-opencode.sh bin systemd/atlas.service \
    systemd/atlas-credentials.service systemd/atlas-updater.service systemd/opencode.service ../scripts/build-release.sh; do
  if [[ -e "$root/$path" ]]; then
    echo "retired deployment asset is back: deploy/$path" >&2
    exit 1
  fi
done

for script in "$root/capture-recovery-config.sh" "$root/check-health.sh" "$root/check-space.sh" "$root/atlas-snapshot.sh" "$root/lib/recovery-status.sh" "$root/restore-rehearsal.sh" "$root/verify-opencode-commands.sh" "$root/verify-sqlite-wal.sh" "$root/stage-opencode.sh" "$root/install-opencode-config.sh" "$root/../scripts/verify-release-artifact.sh"; do
  bash -n "$script"
done

# Render the units exactly as `atlas setup` will (default prefix and paths).
units=$(mktemp -d)
trap 'rm -rf -- "$units"' EXIT
bun -e '
  const { renderUnits } = await import(process.argv[1]);
  for (const [name, text] of Object.entries(renderUnits({ user: "omega", group: "omega", home: "/home/omega" }))) {
    await Bun.write(`${process.argv[2]}/${name}`, text);
  }' "$root/../src/units.ts" "$units"
atlas_unit="$units/atlas.service"
credentials_unit="$units/atlas-credentials.service"
updater_unit="$units/atlas-updater.service"
opencode_unit="$units/opencode.service"

grep -Fxq 'User=root' "$updater_unit"
grep -Fxq 'Group=omega' "$updater_unit"
grep -Fxq 'ExecStart=/opt/atlas/services/current/atlas updater' "$updater_unit"
grep -Fxq 'ReadWritePaths=/opt/atlas /var/lib/atlas /run/atlas-updater' "$updater_unit"
grep -Fxq 'ReadOnlyPaths=-/opt/atlas/tools' "$updater_unit"
grep -Fxq 'Environment=ATLAS_CREDENTIAL_REGISTRY_PATH=/var/lib/atlas/session-scopes.json' "$updater_unit"
grep -Fxq 'Environment=ATLAS_SERVICE_USER=omega' "$updater_unit"
grep -Fxq 'NoNewPrivileges=true' "$updater_unit"
grep -Fxq 'ProtectSystem=strict' "$updater_unit"
grep -Fxq 'ProtectHome=true' "$updater_unit"
grep -Fxq 'PrivateTmp=true' "$updater_unit"
grep -Fxq 'Restart=on-failure' "$updater_unit"
grep -Fq 'checkActivationHealth' "$root/../src/updater-server.ts"
grep -Fq '["systemctl", operation === "start" ? "restart" : "stop", "atlas.service"]' "$root/../src/updater-server.ts"
if grep -Eiq 'opencode|EnvironmentFile=' "$updater_unit"; then
  echo "Atlas updater must not manage OpenCode or load Atlas UI secrets" >&2
  exit 1
fi

for unit in "$atlas_unit" "$credentials_unit" "$opencode_unit"; do
  grep -Fxq 'User=omega' "$unit"
  grep -Fxq 'Restart=on-failure' "$unit"
  grep -Fxq 'RestartSec=5s' "$unit"
  grep -Fxq 'LogRateLimitIntervalSec=30s' "$unit"
  grep -Fxq 'LogRateLimitBurst=1000' "$unit"
  if grep -Eiq 'mise|bun|/deploy/|Requires=(atlas|opencode)|PartOf=(atlas|opencode)|BindsTo=(atlas|opencode)' "$unit"; then
    echo "unit has Bun, a source-tree path, an interactive shim, or lifecycle coupling: $unit" >&2
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

grep -Fq -- '--log-level warn serve --service --hostname 127.0.0.1 --port 49475' "$opencode_unit"
if grep -Eq 'bin/opencode2|--log-level [A-Z]' "$opencode_unit"; then
  echo "OpenCode unit still uses the beta executable or an invalid log level" >&2
  exit 1
fi
grep -Fxq 'ExecStartPre=/usr/bin/test -f /var/lib/atlas/opencode-config/opencode/opencode.json' "$opencode_unit"
grep -Fxq 'ExecStartPre=/opt/atlas/tools/opencode/current/bin/opencode --version' "$opencode_unit"
grep -Fq 'ExecStart=/opt/atlas/tools/opencode/current/bin/opencode ' "$opencode_unit"
grep -Fq 'atlas-credentials.service' "$atlas_unit"
grep -Fq 'atlas-updater.service' "$atlas_unit"
grep -Fq 'atlas-credentials.service' "$opencode_unit"
grep -Fxq 'RuntimeDirectory=atlas' "$credentials_unit"
if grep -Fq 'RuntimeDirectory=atlas' "$atlas_unit"; then
  echo "Atlas UI service must not own the credential socket directory" >&2
  exit 1
fi
if grep -Eq '/opt/atlas/current|EnvironmentFile=' "$credentials_unit"; then
  echo "credential supplier must not depend on a selected Atlas release or load UI secrets" >&2
  exit 1
fi
grep -Fxq 'ExecStart=/opt/atlas/services/current/atlas credentials' "$credentials_unit"
grep -Fxq 'ExecStart=/opt/atlas/current/atlas serve' "$atlas_unit"
grep -Fq 'Environment=PATH=/opt/atlas/current/bin:' "$atlas_unit"
grep -Fq 'Environment=PATH=/opt/atlas/current/bin:' "$opencode_unit"
grep -Fxq 'Environment=ATLAS_GIT_BINARY=/opt/atlas/current/bin/git' "$atlas_unit"
grep -Fxq 'Environment=ATLAS_GIT_BINARY=/opt/atlas/current/bin/git' "$opencode_unit"
grep -Fxq 'ExecStartPre=/opt/atlas/current/bin/git --version' "$atlas_unit"
grep -Fxq 'ExecStartPre=/opt/atlas/current/bin/git --version' "$opencode_unit"
grep -Fxq 'Environment=XDG_CACHE_HOME=/var/lib/atlas/opencode-cache' "$opencode_unit"
grep -Fxq 'EnvironmentFile=/etc/atlas/atlas.env' "$atlas_unit"
if grep -Fq 'EnvironmentFile=' "$opencode_unit"; then
  echo "OpenCode must not inherit Atlas secret environment" >&2
  exit 1
fi

grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/bin/git' "$root/atlas.env.example"
grep -Fq 'ATLAS_UPDATER_SOCKET=/run/atlas-updater/updater.sock' "$root/atlas.env.example"
grep -Fq 'ATLAS_UPDATER_KEY_PATH=/etc/atlas/updater.key' "$root/atlas.env.example"
grep -Fq 'ATLAS_STORAGE_WARNING_BYTES=21474836480' "$root/atlas.env.example"
grep -Fq 'ATLAS_BTRFS_METADATA_WARNING_PERCENT=80' "$root/atlas.env.example"
grep -Fq 'ATLAS_BTRFS_METADATA_PAUSE_PERCENT=90' "$root/atlas.env.example"
grep -Fq 'ATLAS_BTRFS_METADATA_REQUIRED=1' "$root/atlas.env.example"
grep -Fq 'ATLAS_RECOVERY_STATUS_PATH=/var/lib/atlas/recovery-status' "$root/atlas.env.example"
grep -Fq 'ATLAS_RECOVERY_CONFIG_ROOT=/var/lib/atlas/recovery-config' "$root/atlas.env.example"
grep -Fxq 'ATLAS_OPENCODE_BINARY=/opt/atlas/tools/opencode/current/bin/opencode' "$root/pins.env"
grep -Fxq 'ATLAS_GIT_WRAPPER=/opt/atlas/current/bin/git' "$root/pins.env"
grep -Fq '"@opencode/client": "'"$ATLAS_OPENCODE_CLIENT_VERSION"'"' "$root/../package.json"
grep -Fq 'server_version=%s' "$root/stage-opencode.sh"
grep -Fq 'registry_integrity=%s' "$root/stage-opencode.sh"
if grep -Eq 'ATLAS_OPENCODE_(VERSION|CLI_LINUX_X64_INTEGRITY|CLIENT_INTEGRITY|SCHEMA_INTEGRITY|PROTOCOL_INTEGRITY)=' "$root/pins.env"; then
  echo "deployment manifest still pairs the OpenCode server with Atlas client packages" >&2
  exit 1
fi
if grep -Eq '@opencode(-ai)?/(client|schema|protocol)|systemctl' "$root/stage-opencode.sh"; then
  echo "OpenCode staging must not bundle Atlas client packages or manage OpenCode lifecycle" >&2
  exit 1
fi
# Headless OpenCode configuration: no update checks or installs, no .env
# approval prompts, and no blocking question form (hidden by permissions,
# hard-denied by a global policy that project configuration cannot loosen).
# Atlas's own secret directory stays out of the read/grep/glob tools through
# global policies, because the .env allow would otherwise cover github.env.
headless_config="$root/opencode/opencode.json"
jq -e '
  ."$schema" == "https://opencode.ai/config.json" and
  .update == "disable" and
  (has("permission") or has("autoupdate") or has("provider") or has("providers") | not) and
  (.permissions | index({action: "read", resource: "*.env", effect: "allow"}) != null) and
  (.permissions | index({action: "read", resource: "*.env.*", effect: "allow"}) != null) and
  (.permissions | last == {action: "question", resource: "*", effect: "deny"}) and
  (.policies | index({action: "tool.use", resource: "question:*", effect: "deny"}) != null) and
  (.policies | index({action: "tool.use", resource: "external_directory:/etc/atlas/*", effect: "deny"}) != null) and
  (.policies | index({action: "tool.use", resource: "read:/etc/atlas", effect: "deny"}) != null) and
  (.policies | index({action: "tool.use", resource: "read:/etc/atlas/*", effect: "deny"}) != null) and
  (.policies | all(.effect == "deny"))
' "$headless_config" >/dev/null || { echo "headless OpenCode configuration lost a required safety setting" >&2; exit 1; }
grep -Fq '"$root/install-opencode-config.sh" "$target/opencode-config"' "$root/restore-rehearsal.sh"
grep -Fq '"$ATLAS_BUN_BINARY" "$root/scrub-opencode-credentials.ts" "$opencode_db"' "$root/restore-rehearsal.sh"
grep -Fq '"$target/opencode-data/opencode/auth.json"' "$root/restore-rehearsal.sh"
if grep -Eq 'systemctl' "$root/install-opencode-config.sh"; then
  echo "headless OpenCode configuration install must not manage OpenCode lifecycle" >&2
  exit 1
fi
grep -Fq 'maxsize 100M' "$root/logrotate/atlas-opencode"
grep -Fq 'rotate 10' "$root/logrotate/atlas-opencode"
grep -Fq 'copytruncate' "$root/logrotate/atlas-opencode"
grep -Fq 'SystemMaxUse=256M' "$root/journald/atlas.conf"
grep -Fq 'MaxRetentionSec=14day' "$root/journald/atlas.conf"

if command -v systemd-analyze >/dev/null 2>&1; then
  unit_output="$units/analyze.log"
  if ! systemd-analyze verify "$atlas_unit" "$credentials_unit" "$updater_unit" "$opencode_unit" "$root/systemd/atlas-snapshot.service" "$root/systemd/atlas-snapshot.timer" "$root/systemd/atlas-space-check.service" "$root/systemd/atlas-space-check.timer" >"$unit_output" 2>&1; then
    # The installed paths are intentionally absent on a build host. Keep
    # systemd's syntax/dependency check, but do not pretend the binaries exist.
    unexpected=$(grep -Ev '^((atlas|atlas-credentials|atlas-updater|opencode|atlas-snapshot|atlas-space-check)\.service: Command /opt/atlas/(current/(atlas|bin/git|deploy/(atlas-snapshot\.sh|check-space\.sh))|services/current/atlas|tools/opencode/current/bin/opencode) is not executable: No such file or directory)$' "$unit_output" || true)
    if [[ -n "$unexpected" ]]; then
      cat "$unit_output" >&2
      exit 1
    fi
    echo "systemd unit syntax verified; installed executable paths are not present yet"
  fi
fi

echo "deployment assets verified (static only; no service, routing, or data changes made)"
