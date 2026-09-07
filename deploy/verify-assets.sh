#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$root/pins.env"

required=(
  "$root/atlas.env.example"
  "$root/github.env.example"
  "$root/systemd/atlas.service"
  "$root/systemd/opencode.service"
  "$root/bin/gh"
  "$root/bin/git"
  "$root/bin/git-credential-atlas"
  "$root/capture-recovery-config.sh"
  "$root/check-health.sh"
  "$root/check-space.sh"
  "$root/stage-release.sh"
)
for path in "${required[@]}"; do
  test -f "$path" || { echo "missing deployment asset: $path" >&2; exit 1; }
done

for script in "$root/bin/gh" "$root/bin/git" "$root/bin/git-credential-atlas" "$root/capture-recovery-config.sh" "$root/check-health.sh" "$root/check-space.sh" "$root/stage-release.sh"; do
  bash -n "$script"
done

for unit in "$root/systemd/atlas.service" "$root/systemd/opencode.service"; do
  grep -Fq 'User=omega' "$unit"
  grep -Fq 'Restart=on-failure' "$unit"
  grep -Fq 'RestartSec=5s' "$unit"
  if grep -Eiq 'mise|Requires=(atlas|opencode)|PartOf=(atlas|opencode)|BindsTo=(atlas|opencode)' "$unit"; then
    echo "unit has an interactive-shim or lifecycle coupling" >&2
    exit 1
  fi
done

grep -Fq 'serve --service --hostname 127.0.0.1' "$root/systemd/opencode.service"
grep -Fq 'PATH=/opt/atlas/current/deploy/bin:' "$root/systemd/atlas.service"
grep -Fq 'PATH=/opt/atlas/current/deploy/bin:' "$root/systemd/opencode.service"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git' "$root/systemd/atlas.service"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git' "$root/systemd/opencode.service"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/current/deploy/bin/git' "$root/atlas.env.example"
grep -Fq 'ExecStartPre=/opt/atlas/current/deploy/bin/git --version' "$root/systemd/atlas.service"
grep -Fq 'ExecStartPre=/opt/atlas/current/deploy/bin/git --version' "$root/systemd/opencode.service"
grep -Fq 'LogRateLimitIntervalSec=30s' "$root/systemd/atlas.service"
grep -Fq 'LogRateLimitIntervalSec=30s' "$root/systemd/opencode.service"
grep -Fq 'LogRateLimitBurst=1000' "$root/systemd/atlas.service"
grep -Fq 'LogRateLimitBurst=1000' "$root/systemd/opencode.service"
grep -Fq 'EnvironmentFile=/etc/atlas/atlas.env' "$root/systemd/atlas.service"
grep -Fq 'ATLAS_STORAGE_WARNING_BYTES=21474836480' "$root/atlas.env.example"
grep -Fq 'ATLAS_RECOVERY_CONFIG_ROOT=/var/lib/atlas/recovery-config' "$root/atlas.env.example"
grep -Fq 'ATLAS_GIT_BINARY=/opt/atlas/tools/git/2.55.0/bin/git' "$root/pins.env"
grep -Fq "ATLAS_BUN_VERSION=$ATLAS_BUN_VERSION" "$root/pins.env"
grep -Fq "ATLAS_OPENCODE_VERSION=$ATLAS_OPENCODE_VERSION" "$root/pins.env"
if grep -Fq 'EnvironmentFile=' "$root/systemd/opencode.service"; then
  echo "OpenCode must not inherit Atlas secret environment" >&2
  exit 1
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  unit_output=$(mktemp)
  trap 'rm -f -- "$unit_output"' EXIT
  if ! systemd-analyze verify "$root/systemd/atlas.service" "$root/systemd/opencode.service" >"$unit_output" 2>&1; then
    # The pinned host paths are intentionally absent during safe setup. Keep
    # systemd's syntax/dependency check, but do not pretend staged binaries
    # exist before the human cutover window.
    unexpected=$(grep -Ev '^((atlas|opencode)\.service: Command /opt/atlas/(current/deploy/bin/git|tools/(bun/1\.3\.14/bin/bun|git/2\.55\.0/bin/git|opencode/0\.0\.0-beta-19135/bin/opencode2)) is not executable: No such file or directory)$' "$unit_output" || true)
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
