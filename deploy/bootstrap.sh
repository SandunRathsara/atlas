#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo "run this bootstrap command as root" >&2
  exit 1
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_root=$(realpath "$root/..")
service_root=/opt/atlas/services/atlas-credentials
updater_root=/opt/atlas/services/atlas-updater
config_root=/etc/atlas
data_root=/var/lib/atlas
unit_root=/etc/systemd/system
service_user=omega
service_group=omega

[[ -f "$source_root/src/credential-server.ts" && -f "$source_root/src/credentials.ts" ]] || {
  echo "credential supplier assets are incomplete" >&2
  exit 1
}
[[ -f "$source_root/src/updater-server.ts" && -f "$source_root/src/updater.ts" && -f "$source_root/src/release.ts" && -f "$source_root/deploy/check-health.sh" ]] || {
  echo "updater assets are incomplete" >&2
  exit 1
}
[[ -f "$config_root/github.env" && ! -L "$config_root/github.env" ]] || {
  echo "install the private GitHub App configuration before bootstrap" >&2
  exit 1
}

install -d -m 0755 -o root -g root "$service_root"
install -m 0444 -o root -g root "$source_root/src/credential-server.ts" "$service_root/credential-server.ts"
install -m 0444 -o root -g root "$source_root/src/credentials.ts" "$service_root/credentials.ts"
install -d -m 0755 -o root -g root "$updater_root"
install -m 0444 -o root -g root "$source_root/src/updater-server.ts" "$updater_root/updater-server.ts"
install -m 0444 -o root -g root "$source_root/src/updater.ts" "$updater_root/updater.ts"
install -m 0444 -o root -g root "$source_root/src/release.ts" "$updater_root/release.ts"
install -m 0555 -o root -g root "$source_root/deploy/check-health.sh" "$updater_root/check-health.sh"
install -d -m 0750 -o root -g "$service_group" "$config_root"
install -d -m 0700 -o "$service_user" -g "$service_group" "$data_root"
install -d -m 0755 -o root -g root /opt/atlas/releases
chown "$service_user:$service_group" "$config_root/github.env"
chmod 0600 "$config_root/github.env"

supplier_key="$config_root/supplier.key"
if [[ -e "$supplier_key" || -L "$supplier_key" ]]; then
  [[ -f "$supplier_key" && ! -L "$supplier_key" ]] || { echo "supplier key path is unsafe" >&2; exit 1; }
else
  temporary_key=$(mktemp "$config_root/.supplier-key.XXXXXX")
  trap 'rm -f -- "$temporary_key"' EXIT
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$temporary_key"
  printf '\n' >> "$temporary_key"
  mv -- "$temporary_key" "$supplier_key"
  trap - EXIT
fi
chown "$service_user:$service_group" "$supplier_key"
chmod 0600 "$supplier_key"

updater_key="$config_root/updater.key"
if [[ -e "$updater_key" || -L "$updater_key" ]]; then
  [[ -f "$updater_key" && ! -L "$updater_key" ]] || { echo "updater key path is unsafe" >&2; exit 1; }
else
  temporary_key=$(mktemp "$config_root/.updater-key.XXXXXX")
  trap 'rm -f -- "$temporary_key"' EXIT
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$temporary_key"
  printf '\n' >> "$temporary_key"
  mv -- "$temporary_key" "$updater_key"
  trap - EXIT
fi
chown root:"$service_group" "$updater_key"
chmod 0640 "$updater_key"

install -m 0644 -o root -g root "$root/systemd/atlas-credentials.service" "$unit_root/atlas-credentials.service"
install -m 0644 -o root -g root "$root/systemd/atlas-updater.service" "$unit_root/atlas-updater.service"
install -m 0644 -o root -g root "$root/systemd/atlas.service" "$unit_root/atlas.service"
install -m 0644 -o root -g root "$root/systemd/opencode.service" "$unit_root/opencode.service"

systemctl daemon-reload
systemctl enable atlas-credentials.service
systemctl enable atlas-updater.service
if ! systemctl is-active --quiet atlas-credentials.service; then
  atlas_was_active=false
  if systemctl is-active --quiet atlas.service; then
    atlas_was_active=true
    systemctl stop atlas.service
  fi
  if ! systemctl start atlas-credentials.service; then
    if [[ "$atlas_was_active" == true ]]; then systemctl start atlas.service || true; fi
    exit 1
  fi
  if [[ "$atlas_was_active" == true ]]; then systemctl start atlas.service; fi
fi

systemctl restart atlas-updater.service

echo "Atlas credential supplier and updater bootstrap complete; OpenCode was not restarted"
