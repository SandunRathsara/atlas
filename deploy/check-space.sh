#!/usr/bin/env bash
set -euo pipefail

path=${ATLAS_STORAGE_PATH:-/var/lib/atlas}
warning_bytes=${ATLAS_STORAGE_WARNING_BYTES:-21474836480}
minimum_bytes=${ATLAS_MIN_FREE_BYTES:-10737418240}
metadata_warning_percent=${ATLAS_BTRFS_METADATA_WARNING_PERCENT:-80}
metadata_pause_percent=${ATLAS_BTRFS_METADATA_PAUSE_PERCENT:-90}
metadata_required=${ATLAS_BTRFS_METADATA_REQUIRED:-1}
btrfs_binary=${ATLAS_BTRFS_BINARY:-btrfs}

[[ -d "$path" && ! -L "$path" ]] || { echo "storage path is missing or unsafe: $path" >&2; exit 2; }
[[ "$warning_bytes" =~ ^[0-9]+$ && "$minimum_bytes" =~ ^[0-9]+$ ]] || { echo "storage thresholds must be integers" >&2; exit 2; }
(( warning_bytes >= minimum_bytes && minimum_bytes > 0 )) || { echo "storage thresholds are invalid" >&2; exit 2; }
[[ "$metadata_warning_percent" =~ ^[0-9]+$ && "$metadata_pause_percent" =~ ^[0-9]+$ && "$metadata_required" =~ ^[01]$ ]] || { echo "Btrfs metadata thresholds are invalid" >&2; exit 2; }
(( metadata_pause_percent >= metadata_warning_percent && metadata_pause_percent <= 100 )) || { echo "Btrfs metadata thresholds are invalid" >&2; exit 2; }

available=$(df --output=avail -B1 -- "$path" | tail -n 1 | tr -d '[:space:]')
[[ "$available" =~ ^[0-9]+$ ]] || { echo "could not read available storage" >&2; exit 2; }

status=0
if (( available < minimum_bytes )); then
  echo "storage below preparation pause threshold: ${available} bytes available" >&2
  status=2
elif (( available < warning_bytes )); then
  echo "WARNING: storage below warning threshold: ${available} bytes available" >&2
  status=1
fi

if ! command -v "$btrfs_binary" >/dev/null 2>&1; then
  if (( metadata_required )); then
    echo "Btrfs metadata monitor is unavailable" >&2
    exit 2
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
      status=2
    elif (( metadata_percent >= metadata_warning_percent )); then
      echo "WARNING: Btrfs metadata pressure: ${metadata_percent}% used" >&2
      if (( status < 2 )); then status=1; fi
    else
      echo "Btrfs metadata headroom is healthy: ${metadata_percent}% used"
    fi
  elif (( metadata_required )); then
    echo "Btrfs metadata usage could not be read" >&2
    exit 2
  else
    echo "Btrfs metadata check skipped: path is not a readable Btrfs filesystem" >&2
  fi
fi

if (( status == 2 )); then exit 2; fi
if (( status == 1 )); then exit 1; fi
echo "storage headroom is healthy: ${available} bytes available"
