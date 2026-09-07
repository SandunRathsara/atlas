#!/usr/bin/env bash
set -euo pipefail

path=${ATLAS_STORAGE_PATH:-/var/lib/atlas}
warning_bytes=${ATLAS_STORAGE_WARNING_BYTES:-21474836480}
minimum_bytes=${ATLAS_MIN_FREE_BYTES:-10737418240}

[[ -d "$path" && ! -L "$path" ]] || { echo "storage path is missing or unsafe: $path" >&2; exit 2; }
[[ "$warning_bytes" =~ ^[0-9]+$ && "$minimum_bytes" =~ ^[0-9]+$ ]] || { echo "storage thresholds must be integers" >&2; exit 2; }
(( warning_bytes >= minimum_bytes && minimum_bytes > 0 )) || { echo "storage thresholds are invalid" >&2; exit 2; }

available=$(df --output=avail -B1 -- "$path" | tail -n 1 | tr -d '[:space:]')
[[ "$available" =~ ^[0-9]+$ ]] || { echo "could not read available storage" >&2; exit 2; }

if (( available < minimum_bytes )); then
  echo "storage below preparation pause threshold: ${available} bytes available" >&2
  exit 2
fi
if (( available < warning_bytes )); then
  echo "WARNING: storage below warning threshold: ${available} bytes available" >&2
  exit 1
fi
echo "storage headroom is healthy: ${available} bytes available"
