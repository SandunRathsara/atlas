#!/usr/bin/env bash
set -euo pipefail

[[ "${ATLAS_WRITERS_STOPPED:-}" == YES ]] || {
  echo "refusing SQLite build verification until Atlas, OpenCode, and agent writers are stopped" >&2
  exit 1
}

release_root=$(realpath "${ATLAS_RELEASE_ROOT:-/opt/atlas/current}")
# shellcheck disable=SC1090
source "$release_root/deploy/pins.env"

fixed_version() {
  local version=$1 major minor patch
  IFS=. read -r major minor patch <<< "$version"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]] || return 1
  (( major == 3 )) || return 1
  (( minor >= 52 )) || (( minor == 51 && patch >= 3 )) || (( minor == 50 && patch >= 7 )) || (( minor == 44 && patch >= 6 ))
}

[[ -x "$ATLAS_BUN_BINARY" && ! -L "$ATLAS_BUN_BINARY" ]] || { echo "pinned Bun binary is unavailable" >&2; exit 1; }
[[ -x "$ATLAS_OPENCODE_BINARY" && ! -L "$ATLAS_OPENCODE_BINARY" ]] || { echo "pinned OpenCode binary is unavailable" >&2; exit 1; }
[[ "$("$ATLAS_BUN_BINARY" --version)" == "$ATLAS_BUN_VERSION" ]] || { echo "Bun runtime does not match the release pin" >&2; exit 1; }
[[ "$("$ATLAS_OPENCODE_BINARY" --version)" == "opencode2 v$ATLAS_OPENCODE_VERSION" ]] || { echo "OpenCode runtime does not match the release pin" >&2; exit 1; }

bun_sqlite=$(
  "$ATLAS_BUN_BINARY" --eval 'import { Database } from "bun:sqlite"; const db = new Database(":memory:"); console.log(db.query("SELECT sqlite_version() AS version").get().version); db.close();'
)
[[ "$bun_sqlite" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && fixed_version "$bun_sqlite" || {
  echo "Bun's embedded SQLite does not include the accepted WAL-reset fix" >&2
  exit 1
}

opencode_output=$(
  XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-/var/lib/atlas/opencode-config} \
  XDG_DATA_HOME=${XDG_DATA_HOME:-/var/lib/atlas/opencode-data} \
  XDG_STATE_HOME=${XDG_STATE_HOME:-/var/lib/atlas/opencode-state} \
  XDG_CACHE_HOME=${XDG_CACHE_HOME:-/var/lib/atlas/opencode-cache} \
  "$ATLAS_OPENCODE_BINARY" db 'SELECT sqlite_version() AS sqlite_version' --format tsv
)
opencode_sqlite=$(printf '%s\n' "$opencode_output" | grep -Eo '^[0-9]+\.[0-9]+\.[0-9]+$' | tail -n 1)
[[ -n "$opencode_sqlite" ]] && fixed_version "$opencode_sqlite" || {
  echo "OpenCode's embedded SQLite could not be proven to include the accepted WAL-reset fix" >&2
  exit 1
}

record_root=$(realpath -m "${ATLAS_RECOVERY_CONFIG_ROOT:-/var/lib/atlas/recovery-config}")
record="$record_root/current/checksums/sqlite-wal-versions"
[[ -d "$(dirname "$record")" && ! -L "$(dirname "$record")" && ! -L "$record" ]] || {
  echo "recovery configuration must be captured before recording SQLite verification" >&2
  exit 1
}
temporary=$(mktemp "$(dirname "$record")/.sqlite-wal-versions.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
{
  printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'release_commit=%s\n' "$(cat "$release_root/RELEASE_COMMIT")"
  printf 'bun_version=%s\n' "$ATLAS_BUN_VERSION"
  printf 'bun_sqlite_version=%s\n' "$bun_sqlite"
  printf 'opencode_version=%s\n' "$ATLAS_OPENCODE_VERSION"
  printf 'opencode_sqlite_version=%s\n' "$opencode_sqlite"
  printf 'wal_reset_fix=verified\n'
} > "$temporary"
chmod 0400 "$temporary"
mv -f -- "$temporary" "$record"
trap - EXIT
echo "embedded SQLite WAL-reset fix verified for pinned Bun and OpenCode builds"
