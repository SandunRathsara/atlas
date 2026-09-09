#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/recovery-status.sh
source "$root/lib/recovery-status.sh"

path=${ATLAS_STORAGE_PATH:-/var/lib/atlas}
warning_bytes=${ATLAS_STORAGE_WARNING_BYTES:-21474836480}
minimum_bytes=${ATLAS_MIN_FREE_BYTES:-10737418240}
metadata_warning_percent=${ATLAS_BTRFS_METADATA_WARNING_PERCENT:-80}
metadata_pause_percent=${ATLAS_BTRFS_METADATA_PAUSE_PERCENT:-90}
metadata_required=${ATLAS_BTRFS_METADATA_REQUIRED:-1}
btrfs_binary=${ATLAS_BTRFS_BINARY:-btrfs}

checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

unknown() {
  atlas_status_write space "$checked_at" unknown "${available:-unknown}" "${metadata_percent:-unknown}" unavailable || true
  echo "$1" >&2
  exit 2
}

[[ -d "$path" && ! -L "$path" ]] || unknown "storage path is missing or unsafe"
[[ "$warning_bytes" =~ ^[0-9]+$ && "$minimum_bytes" =~ ^[0-9]+$ ]] || unknown "storage thresholds must be integers"
(( warning_bytes >= minimum_bytes && minimum_bytes > 0 )) || unknown "storage thresholds are invalid"
[[ "$metadata_warning_percent" =~ ^[0-9]+$ && "$metadata_pause_percent" =~ ^[0-9]+$ && "$metadata_required" =~ ^[01]$ ]] || unknown "Btrfs metadata thresholds are invalid"
(( metadata_pause_percent >= metadata_warning_percent && metadata_pause_percent <= 100 )) || unknown "Btrfs metadata thresholds are invalid"

available=$(df --output=avail -B1 -- "$path" | tail -n 1 | tr -d '[:space:]')
[[ "$available" =~ ^[0-9]+$ ]] || unknown "could not read available storage"

status=0
space_reason=none
if (( available < minimum_bytes )); then
  echo "storage below preparation pause threshold: ${available} bytes available" >&2
  status=2
  space_reason=free_bytes
elif (( available < warning_bytes )); then
  echo "WARNING: storage below warning threshold: ${available} bytes available" >&2
  status=1
  space_reason=free_bytes
fi

if ! command -v "$btrfs_binary" >/dev/null 2>&1; then
  if (( metadata_required )); then
    if (( status == 2 )); then
      atlas_status_write space "$checked_at" paused "$available" unknown free_bytes || unknown "recovery status could not be updated"
      echo "Btrfs metadata monitor is unavailable" >&2
      exit 2
    fi
    unknown "Btrfs metadata monitor is unavailable"
  fi
  echo "Btrfs metadata check skipped: btrfs command is unavailable" >&2
else
  metadata_usage=$("$btrfs_binary" filesystem usage --raw -- "$path" 2>/dev/null) || metadata_usage=""
  metadata_line=$(printf '%s\n' "$metadata_usage" | sed -n '/^Metadata[^:]*:[[:space:]]*Size:[[:space:]]*[0-9][0-9]*,[[:space:]]*Used:[[:space:]]*[0-9][0-9]*/p' | sed -n '1p')
  metadata_total=$(printf '%s\n' "$metadata_line" | sed -n 's/^Metadata[^:]*:[[:space:]]*Size:[[:space:]]*\([0-9][0-9]*\),[[:space:]]*Used:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
  metadata_used=$(printf '%s\n' "$metadata_line" | sed -n 's/^Metadata[^:]*:[[:space:]]*Size:[[:space:]]*\([0-9][0-9]*\),[[:space:]]*Used:[[:space:]]*\([0-9][0-9]*\).*/\2/p')
  if [[ "$metadata_total" =~ ^[1-9][0-9]*$ && "$metadata_used" =~ ^[0-9]+$ && "$metadata_used" -le "$metadata_total" ]]; then
    metadata_percent=$((metadata_used * 100 / metadata_total))
    if (( metadata_percent >= metadata_pause_percent )); then
      echo "Btrfs metadata above preparation pause threshold: ${metadata_percent}% used" >&2
      [[ "$space_reason" == free_bytes ]] && space_reason=free_bytes_and_metadata || space_reason=metadata
      status=2
    elif (( metadata_percent >= metadata_warning_percent )); then
      echo "WARNING: Btrfs metadata pressure: ${metadata_percent}% used" >&2
      [[ "$space_reason" == free_bytes ]] && space_reason=free_bytes_and_metadata || space_reason=metadata
      if (( status < 2 )); then status=1; fi
    else
      echo "Btrfs metadata headroom is healthy: ${metadata_percent}% used"
    fi
  elif (( metadata_required )); then
    if (( status == 2 )); then
      atlas_status_write space "$checked_at" paused "$available" unknown "$space_reason" || unknown "recovery status could not be updated"
      echo "Btrfs metadata usage could not be read" >&2
      exit 2
    fi
    unknown "Btrfs metadata usage could not be read"
  else
    echo "Btrfs metadata check skipped: path is not a readable Btrfs filesystem" >&2
  fi
fi

state=healthy
if (( status == 2 )); then state=paused; fi
if (( status == 1 )); then state=warning; fi
atlas_status_write space "$checked_at" "$state" "$available" "${metadata_percent:-unknown}" "$space_reason" || unknown "recovery status could not be updated"

if (( status == 2 )); then exit 2; fi
if (( status == 1 )); then exit 1; fi
echo "storage headroom is healthy: ${available} bytes available"
