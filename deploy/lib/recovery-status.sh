#!/usr/bin/env bash

atlas_status_defaults() {
  status_space_checked_at=unknown
  status_space_state=unknown
  status_space_available_bytes=unknown
  status_space_metadata_percent=unknown
  status_space_reason=unavailable
  status_backup_checked_at=unknown
  status_backup_state=unknown
  status_backup_last_success_at=unknown
  status_backup_last_snapshot=unknown
  status_backup_reason=unavailable
}

atlas_status_valid_value() {
  local key=$1 value=$2
  case "$key" in
    version) [[ "$value" == 1 ]] ;;
    space_checked_at|backup_checked_at|backup_last_success_at) [[ "$value" == unknown || "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ;;
    space_state) [[ "$value" =~ ^(healthy|warning|paused|unknown)$ ]] ;;
    backup_state) [[ "$value" =~ ^(success|failure|unknown)$ ]] ;;
    space_available_bytes) [[ "$value" == unknown || "$value" =~ ^[0-9]+$ ]] ;;
    space_metadata_percent) [[ "$value" == unknown || "$value" =~ ^([0-9]|[1-9][0-9]|100)$ ]] ;;
    space_reason) [[ "$value" =~ ^(none|free_bytes|metadata|free_bytes_and_metadata|metadata_unavailable|unavailable)$ ]] ;;
    backup_last_snapshot) [[ "$value" == unknown || "$value" =~ ^atlas-v1-[0-9]{8}T[0-9]{6}Z$ ]] ;;
    backup_reason) [[ "$value" =~ ^(none|source_invalid|scope_incomplete|snapshot_failed|snapshot_invalid|retention_failed|status_failed|unavailable)$ ]] ;;
    *) return 1 ;;
  esac
}

atlas_status_load() {
  atlas_status_defaults
  [[ -e "$atlas_status_path" || -L "$atlas_status_path" ]] || return 0
  [[ -f "$atlas_status_path" && ! -L "$atlas_status_path" ]] || return 0
  local size
  size=$(wc -c < "$atlas_status_path") || return 0
  (( size > 0 && size <= 8192 )) || return 0

  local key value count=0
  declare -A seen=()
  while IFS='=' read -r key value; do
    [[ -n "$key" && -n "$value" && -z "${seen[$key]:-}" ]] || { atlas_status_defaults; return 0; }
    atlas_status_valid_value "$key" "$value" || { atlas_status_defaults; return 0; }
    seen[$key]=1
    ((count += 1))
    case "$key" in
      space_checked_at) status_space_checked_at=$value ;;
      space_state) status_space_state=$value ;;
      space_available_bytes) status_space_available_bytes=$value ;;
      space_metadata_percent) status_space_metadata_percent=$value ;;
      space_reason) status_space_reason=$value ;;
      backup_checked_at) status_backup_checked_at=$value ;;
      backup_state) status_backup_state=$value ;;
      backup_last_success_at) status_backup_last_success_at=$value ;;
      backup_last_snapshot) status_backup_last_snapshot=$value ;;
      backup_reason) status_backup_reason=$value ;;
    esac
  done < "$atlas_status_path"
  (( count == 11 )) || atlas_status_defaults
}

atlas_status_write() {
  atlas_status_path=$(realpath -m "${ATLAS_RECOVERY_STATUS_PATH:-/var/lib/atlas/recovery-status}")
  [[ "$atlas_status_path" == /* && "$atlas_status_path" != / ]] || return 1
  local directory lock temporary pair
  directory=$(dirname "$atlas_status_path")
  [[ -d "$directory" && ! -L "$directory" && ! -L "$atlas_status_path" ]] || return 1
  lock=$(realpath -m "${ATLAS_RECOVERY_STATUS_LOCK_PATH:-/run/lock/atlas-recovery-status.lock}")
  [[ "$lock" == /* && "$lock" != / && -d "$(dirname "$lock")" && ! -L "$lock" ]] || return 1
  exec 9>"$lock"
  flock -x 9
  atlas_status_load

  case "$1" in
    space)
      status_space_checked_at=$2
      status_space_state=$3
      status_space_available_bytes=$4
      status_space_metadata_percent=$5
      status_space_reason=$6
      ;;
    backup)
      status_backup_checked_at=$2
      status_backup_state=$3
      status_backup_reason=$4
      if [[ "$3" == success ]]; then
        status_backup_last_success_at=$2
        status_backup_last_snapshot=$5
      fi
      ;;
    *) return 1 ;;
  esac

  for pair in \
    "space_checked_at=$status_space_checked_at" \
    "space_state=$status_space_state" \
    "space_available_bytes=$status_space_available_bytes" \
    "space_metadata_percent=$status_space_metadata_percent" \
    "space_reason=$status_space_reason" \
    "backup_checked_at=$status_backup_checked_at" \
    "backup_state=$status_backup_state" \
    "backup_last_success_at=$status_backup_last_success_at" \
    "backup_last_snapshot=$status_backup_last_snapshot" \
    "backup_reason=$status_backup_reason"; do
    atlas_status_valid_value "${pair%%=*}" "${pair#*=}" || return 1
  done

  temporary=$(mktemp "$directory/.recovery-status.XXXXXX")
  {
    printf 'version=1\n'
    printf 'space_checked_at=%s\n' "$status_space_checked_at"
    printf 'space_state=%s\n' "$status_space_state"
    printf 'space_available_bytes=%s\n' "$status_space_available_bytes"
    printf 'space_metadata_percent=%s\n' "$status_space_metadata_percent"
    printf 'space_reason=%s\n' "$status_space_reason"
    printf 'backup_checked_at=%s\n' "$status_backup_checked_at"
    printf 'backup_state=%s\n' "$status_backup_state"
    printf 'backup_last_success_at=%s\n' "$status_backup_last_success_at"
    printf 'backup_last_snapshot=%s\n' "$status_backup_last_snapshot"
    printf 'backup_reason=%s\n' "$status_backup_reason"
  } > "$temporary"
  chmod 0640 "$temporary"
  if (( EUID == 0 )); then chown "root:${ATLAS_RECOVERY_STATUS_GROUP:-omega}" "$temporary"; fi
  mv -f -- "$temporary" "$atlas_status_path"
}
