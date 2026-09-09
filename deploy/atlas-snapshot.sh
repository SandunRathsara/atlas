#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deploy/lib/recovery-status.sh
source "$root/lib/recovery-status.sh"

source_path=$(realpath -m "${ATLAS_SNAPSHOT_SOURCE:-/var/lib/atlas}")
backup_root=$(realpath -m "${ATLAS_SNAPSHOT_ROOT:-/var/backups/atlas}")
btrfs_binary=${ATLAS_BTRFS_BINARY:-btrfs}
marker_name=.atlas-snapshot-v1
marker_source="$root/atlas-snapshot.marker"
name_pattern='^atlas-v1-[0-9]{8}T[0-9]{6}Z$'
mode=${1:-snapshot}

usage() {
  echo "usage: $0 [--dry-run | --verify SNAPSHOT]" >&2
  exit 2
}

[[ "$source_path" == /* && "$source_path" != / && "$backup_root" == /* && "$backup_root" != / ]] || {
  echo "snapshot paths must be safe absolute paths" >&2
  exit 1
}
[[ $# -le 2 ]] || usage
[[ "$mode" == snapshot || "$mode" == --dry-run || "$mode" == --verify ]] || usage
[[ "$mode" != --verify || $# -eq 2 ]] || usage
[[ "$mode" == --verify || $# -le 1 ]] || usage

is_owned_snapshot() {
  local path=$1 name
  name=$(basename "$path")
  [[ "$name" =~ $name_pattern && "$(dirname "$path")" == "$backup_root" ]] || return 1
  [[ -d "$path" && ! -L "$path" && -f "$path/$marker_name" && ! -L "$path/$marker_name" ]] || return 1
  cmp -s -- "$marker_source" "$path/$marker_name" || return 1
  if [[ "$mode" != --dry-run ]]; then
    [[ "$(stat -c %u:%a -- "$path/$marker_name")" == "0:444" ]] || return 1
    "$btrfs_binary" subvolume show "$path" >/dev/null 2>&1 || return 1
    [[ "$("$btrfs_binary" property get -ts "$path" ro 2>/dev/null)" == "ro=true" ]] || return 1
  fi
}

if [[ "$mode" == --verify ]]; then
  snapshot=$(realpath -m "$2")
  is_owned_snapshot "$snapshot" || { echo "snapshot is not a positively identified Atlas recovery point" >&2; exit 1; }
  echo "Atlas recovery snapshot ownership and read-only state verified"
  exit 0
fi

dry_run=false
[[ "$mode" == --dry-run ]] && dry_run=true

if [[ "$dry_run" == false ]]; then
  failure_reason=source_invalid
  fail() {
    local reason=$1 message=$2
    trap - ERR
    atlas_status_write backup "$(date -u +%Y-%m-%dT%H:%M:%SZ)" failure "$reason" unknown || true
    echo "$message" >&2
    exit 1
  }
  unexpected_failure() {
    local code=$?
    trap - ERR
    atlas_status_write backup "$(date -u +%Y-%m-%dT%H:%M:%SZ)" failure "$failure_reason" unknown || true
    echo "Atlas snapshot operation failed; inspect the bounded Atlas journal" >&2
    exit "$code"
  }
  trap unexpected_failure ERR
else
  fail() { echo "$2" >&2; exit 1; }
fi

[[ -f "$marker_source" && ! -L "$marker_source" ]] || fail source_invalid "snapshot marker asset is unavailable"
[[ -d "$source_path" && ! -L "$source_path" ]] || fail source_invalid "snapshot source is missing or unsafe"
[[ -f "$source_path/$marker_name" && ! -L "$source_path/$marker_name" ]] || fail source_invalid "snapshot source marker is missing or unsafe"
cmp -s -- "$marker_source" "$source_path/$marker_name" || fail source_invalid "snapshot source marker is invalid"
if [[ "$dry_run" == false ]]; then
  (( EUID == 0 )) || fail source_invalid "production snapshots must run as root"
  [[ "$(stat -c %u:%a -- "$source_path/$marker_name")" == "0:444" ]] || fail source_invalid "snapshot source marker ownership or mode is invalid"
fi

required_directories=(sessions opencode-data/opencode opencode-state/opencode opencode-config/opencode opencode-cache opencode-runtime recovery-config/current)
for path in "${required_directories[@]}"; do
  [[ -d "$source_path/$path" && ! -L "$source_path/$path" ]] || fail scope_incomplete "required snapshot scope is incomplete"
done
[[ -f "$source_path/atlas.sqlite" && ! -L "$source_path/atlas.sqlite" ]] || fail scope_incomplete "Atlas database is missing from the snapshot source"
[[ -f "$source_path/opencode-data/opencode/opencode.db" && ! -L "$source_path/opencode-data/opencode/opencode.db" ]] || fail scope_incomplete "OpenCode database is missing from the snapshot source"
wal_record="$source_path/recovery-config/current/checksums/sqlite-wal-versions"
[[ -f "$wal_record" && ! -L "$wal_record" ]] || fail scope_incomplete "SQLite WAL safety verification record is missing"
grep -Fxq 'wal_reset_fix=verified' "$wal_record" || fail scope_incomplete "SQLite WAL safety verification record is invalid"
recorded_commit=$(sed -n 's/^release_commit=//p' "$wal_record")
[[ -n "$recorded_commit" && "$recorded_commit" == "$(cat "$source_path/recovery-config/current/release/RELEASE_COMMIT")" ]] || fail scope_incomplete "SQLite verification does not match the protected release"

[[ -d "$backup_root" && ! -L "$backup_root" ]] || fail source_invalid "snapshot destination root is missing or unsafe"
[[ "$source_path" != "$backup_root" && "$source_path" != "$backup_root"/* && "$backup_root" != "$source_path"/* ]] || fail source_invalid "snapshot source and destination must be separate"

if [[ "$dry_run" == false ]]; then
  [[ "$(stat -c %u -- "$backup_root")" == 0 ]] || fail source_invalid "snapshot destination root must be owned by root"
  command -v "$btrfs_binary" >/dev/null 2>&1 || fail source_invalid "Btrfs tooling is unavailable"
  "$btrfs_binary" subvolume show "$source_path" >/dev/null 2>&1 || fail source_invalid "snapshot source is not a Btrfs subvolume"
  [[ "$(stat -c %d -- "$source_path")" == "$(stat -c %d -- "$backup_root")" ]] || fail source_invalid "snapshot source and destination are not on the same filesystem"
  [[ -z "$("$btrfs_binary" subvolume list -o "$source_path" 2>/dev/null)" ]] || fail scope_incomplete "nested Btrfs subvolumes would make the recovery point incomplete"
  while IFS= read -r mount; do
    mount=$(realpath -m "$mount")
    [[ "$mount" != "$source_path"/* ]] || fail scope_incomplete "a nested mount would make the recovery point incomplete"
  done < <(findmnt -rn --raw -o TARGET)
  chmod 0700 "$backup_root"
fi

snapshot_lock=$(realpath -m "${ATLAS_SNAPSHOT_LOCK_PATH:-/run/lock/atlas-snapshot.lock}")
[[ "$snapshot_lock" == /* && "$snapshot_lock" != / && -d "$(dirname "$snapshot_lock")" && ! -L "$snapshot_lock" ]] || fail source_invalid "snapshot lock path is unsafe"
exec 8>"$snapshot_lock"
flock -n 8 || fail snapshot_failed "another Atlas snapshot operation is already running"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [[ "$dry_run" == true && -n "${ATLAS_SNAPSHOT_NOW:-}" ]]; then
  stamp=$ATLAS_SNAPSHOT_NOW
fi
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail source_invalid "snapshot timestamp is invalid"
name="atlas-v1-$stamp"
destination="$backup_root/$name"
[[ ! -e "$destination" && ! -L "$destination" ]] || fail snapshot_failed "snapshot destination already exists"

if [[ "$dry_run" == true ]]; then
  echo "would create read-only snapshot $name"
else
  failure_reason=snapshot_failed
  space_status=0
  "$root/check-space.sh" || space_status=$?
  (( space_status <= 2 )) || fail snapshot_failed "storage status check failed unexpectedly"
  "$btrfs_binary" subvolume snapshot -r "$source_path" "$destination" >/dev/null || fail snapshot_failed "read-only Btrfs snapshot failed"
  is_owned_snapshot "$destination" || fail snapshot_invalid "new snapshot could not be positively identified"
fi

declare -A seen_days=() seen_weeks=()
[[ "$dry_run" == true ]] || failure_reason=retention_failed
daily_count=0
weekly_count=0
mapfile -t names < <(
  printf '%s\n' "$name"
  find "$backup_root" -mindepth 1 -maxdepth 1 -printf '%f\n' | grep -E "$name_pattern" || true
)
mapfile -t names < <(printf '%s\n' "${names[@]}" | sort -ru)

for candidate_name in "${names[@]}"; do
  candidate="$backup_root/$candidate_name"
  if [[ "$candidate_name" != "$name" ]] && ! is_owned_snapshot "$candidate"; then
    echo "WARNING: ignored an unverified snapshot-like entry" >&2
    continue
  fi
  candidate_stamp=${candidate_name#atlas-v1-}
  day=${candidate_stamp:0:8}
  week=$(date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%G-W%V) || fail retention_failed "snapshot retention date could not be classified"
  keep=false
  if [[ -z "${seen_days[$day]:-}" && $daily_count -lt 7 ]]; then
    seen_days[$day]=1
    ((daily_count += 1))
    keep=true
  fi
  if [[ -z "${seen_weeks[$week]:-}" && $weekly_count -lt 4 ]]; then
    seen_weeks[$week]=1
    ((weekly_count += 1))
    keep=true
  fi
  if [[ "$keep" == false && "$candidate_name" != "$name" ]]; then
    if [[ "$dry_run" == true ]]; then
      echo "would prune positively identified snapshot $candidate_name"
    else
      is_owned_snapshot "$candidate" || fail retention_failed "expired snapshot lost its Atlas ownership proof"
      "$btrfs_binary" subvolume delete "$candidate" >/dev/null || fail retention_failed "expired Atlas snapshot could not be pruned"
      echo "pruned expired Atlas snapshot $candidate_name"
    fi
  fi
done

if [[ "$dry_run" == true ]]; then
  echo "retention dry run complete: up to 7 daily and 4 weekly points; overlaps count for both"
  exit 0
fi

failure_reason=status_failed
atlas_status_write backup "$(date -u +%Y-%m-%dT%H:%M:%SZ)" success none "$name" || fail status_failed "snapshot succeeded but recovery status could not be updated"
trap - ERR
echo "Atlas recovery snapshot completed: $name"
