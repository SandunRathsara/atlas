#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 SNAPSHOT RESTORE_TARGET FILE_MANIFEST HISTORY_MANIFEST" >&2
  exit 2
}

[[ $# -eq 4 ]] || usage
(( EUID == 0 )) || { echo "restore rehearsal must run as root" >&2; exit 1; }
[[ "${ATLAS_WRITERS_STOPPED:-}" == YES && "${ATLAS_ADMISSION_DISABLED:-}" == YES ]] || {
  echo "refusing restore rehearsal until writers are stopped and admission is disabled" >&2
  exit 1
}

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
snapshot=$(realpath -m "$1")
target=$(realpath -m "$2")
file_manifest=$(realpath "$3")
history_manifest=$(realpath "$4")
restore_root=$(realpath -m "${ATLAS_RESTORE_REHEARSAL_ROOT:-/var/lib/atlas-restore-rehearsals}")
release_root=$(realpath "${ATLAS_RELEASE_ROOT:-/opt/atlas/current}")
btrfs_binary=${ATLAS_BTRFS_BINARY:-btrfs}

[[ "$target" == "$restore_root"/* && "$target" != "$restore_root" ]] || { echo "restore target must be a direct child of the isolated rehearsal root" >&2; exit 1; }
[[ "$(dirname "$target")" == "$restore_root" ]] || { echo "nested restore targets are not allowed" >&2; exit 1; }
[[ -d "$restore_root" && ! -L "$restore_root" && ! -e "$target" && ! -L "$target" ]] || { echo "restore rehearsal root or target is unsafe" >&2; exit 1; }
[[ "$(stat -c %u:%a -- "$restore_root")" == "0:700" ]] || { echo "restore rehearsal root must be root-owned with mode 0700" >&2; exit 1; }
for manifest in "$file_manifest" "$history_manifest"; do
  [[ -f "$manifest" && ! -L "$manifest" && "$(stat -c %s "$manifest")" -le 1048576 ]] || { echo "restore manifest is missing, unsafe, or too large" >&2; exit 1; }
done

"$root/atlas-snapshot.sh" --verify "$snapshot" >/dev/null
recovery="$snapshot/recovery-config/current"
[[ -d "$recovery" && ! -L "$recovery" ]] || { echo "snapshot recovery configuration is unavailable" >&2; exit 1; }
cmp -s "$recovery/release/RELEASE_COMMIT" "$release_root/RELEASE_COMMIT" || { echo "restore snapshot and selected Atlas release do not match" >&2; exit 1; }
cmp -s "$recovery/release/pins.env" "$release_root/deploy/pins.env" || { echo "restore snapshot and selected tool pins do not match" >&2; exit 1; }
grep -Fxq 'wal_reset_fix=verified' "$recovery/checksums/sqlite-wal-versions" || { echo "snapshot lacks SQLite WAL safety verification" >&2; exit 1; }
(
  cd "$recovery"
  sha256sum --quiet -c checksums/files.sha256
)
sha256sum --quiet -c "$recovery/checksums/tools.sha256"

"$btrfs_binary" subvolume snapshot "$snapshot" "$target" >/dev/null
[[ "$("$btrfs_binary" property get -ts "$target" ro 2>/dev/null)" == "ro=false" ]] || {
  echo "restore target is not writable; it was retained for inspection" >&2
  exit 1
}

atlas_db="$target/atlas.sqlite"
opencode_db="$target/opencode-data/opencode/opencode.db"
registry="$target/session-scopes.json"
# shellcheck disable=SC1090
source "$release_root/deploy/pins.env"
"$ATLAS_BUN_BINARY" "$release_root/scripts/check-restored-state.ts" \
  "$atlas_db" "$opencode_db" "$target" "$registry" "$history_manifest"

checked_files=0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^([0-9a-f]{64})[[:space:]][[:space:]](.+)$ ]] || { echo "saved-file manifest is malformed; restore target retained" >&2; exit 1; }
  expected=${BASH_REMATCH[1]}
  relative_path=${BASH_REMATCH[2]}
  [[ "$relative_path" != /* && "$relative_path" != *$'\n'* && "$relative_path" != *$'\r'* ]] || { echo "saved-file manifest path is unsafe; restore target retained" >&2; exit 1; }
  mapped=$(realpath -m "$target/$relative_path")
  [[ "$mapped" == "$target"/* && -f "$mapped" && ! -L "$mapped" ]] || { echo "expected saved file is missing or unsafe; restore target retained" >&2; exit 1; }
  [[ "$(sha256sum "$mapped" | cut -d ' ' -f 1)" == "$expected" ]] || { echo "a restored saved file failed its checksum; restore target retained" >&2; exit 1; }
  ((checked_files += 1))
done < "$file_manifest"
(( checked_files > 0 )) || { echo "saved-file manifest is empty; restore target retained" >&2; exit 1; }

for directory in "$target/opencode-config" "$target/recovery-config"; do
  [[ -d "$directory" && ! -L "$directory" ]] || { echo "endpoint configuration directory is missing or unsafe; restore target retained" >&2; exit 1; }
  find "$directory" -mindepth 1 -delete
done
rm -f -- \
  "$target/opencode-state/opencode/service.json" \
  "$target/opencode-data/opencode/auth.json" \
  "$target/opencode-data/opencode/oauth.json" \
  "$target/session-scopes.json"
find "$target" -type s -print -quit | grep -q . && { echo "restored socket remained after endpoint scrubbing; restore target retained" >&2; exit 1; }
printf '%s\n' \
  'Atlas isolated restore rehearsal only.' \
  'Credentials, provider configuration, discovery, webhook routing, and supplier registration were scrubbed.' \
  'Never point Atlas/OpenCode services at this target or expose a listener from it.' > "$target/REHEARSAL_ISOLATED"
chmod 0400 "$target/REHEARSAL_ISOLATED"

echo "isolated writable restore verified and scrubbed; no service, Agent, listener, or network endpoint was started"
