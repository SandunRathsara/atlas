#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [capture|rollback]" >&2
  exit 2
}

mode=${1:-capture}
[[ $# -le 1 && ("$mode" == capture || "$mode" == rollback) ]] || usage

recovery_root=$(realpath -m "${ATLAS_RECOVERY_CONFIG_ROOT:-/var/lib/atlas/recovery-config}")
case "$recovery_root" in
  /*) ;;
  *) echo "recovery configuration root must be an absolute path" >&2; exit 1 ;;
esac
[[ "$recovery_root" != "/" ]] || { echo "recovery configuration root is unsafe" >&2; exit 1; }
[[ ! -L "$recovery_root" ]] || { echo "recovery configuration root must not be a symlink" >&2; exit 1; }
mkdir -p "$recovery_root"
chmod 700 "$recovery_root"

current="$recovery_root/current"
previous="$recovery_root/previous"
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$

private_directory() {
  [[ -d "$1" && ! -L "$1" ]] || { echo "required recovery directory is missing or unsafe: $1" >&2; exit 1; }
}

regular_file() {
  [[ -f "$1" && ! -L "$1" ]] || { echo "required recovery file is missing or unsafe: $1" >&2; exit 1; }
}

if [[ "$mode" == rollback ]]; then
  private_directory "$current"
  private_directory "$previous"
  failed="$recovery_root/failed-$stamp"
  [[ ! -e "$failed" && ! -L "$failed" ]] || { echo "rollback destination already exists" >&2; exit 1; }
  mv -- "$current" "$failed"
  if ! mv -- "$previous" "$current"; then
    mv -- "$failed" "$current" || true
    echo "recovery configuration rollback failed; inspect $recovery_root" >&2
    exit 1
  fi
  chmod 700 "$current"
  echo "recovery configuration rolled back to $current; failed copy retained at $failed"
  exit 0
fi

config_root=${ATLAS_RECOVERY_CONFIG_SOURCE:-/etc/atlas}
unit_root=${ATLAS_RECOVERY_UNIT_SOURCE:-/etc/systemd/system}
release_root=${ATLAS_RECOVERY_RELEASE_ROOT:-/opt/atlas/current}
route_record=${ATLAS_RECOVERY_ROUTE_RECORD:-}
firewall_record=${ATLAS_RECOVERY_FIREWALL_RECORD:-}
release_dir=$(realpath "$release_root")

private_directory "$config_root"
private_directory "$unit_root"
private_directory "$release_dir"
[[ -n "$route_record" && -n "$firewall_record" ]] || {
  echo "route and firewall recovery records are required" >&2
  exit 1
}

config_files=(atlas.env github.env github-app.pem supplier.key)
unit_files=(atlas.service opencode.service)
for name in "${config_files[@]}"; do regular_file "$config_root/$name"; done
for name in "${unit_files[@]}"; do regular_file "$unit_root/$name"; done
regular_file "$route_record"
regular_file "$firewall_record"
regular_file "$release_dir/RELEASE_COMMIT"
regular_file "$release_dir/deploy/pins.env"

# The release pin manifest is non-secret and is the source of the binary list.
# shellcheck disable=SC1090
. "$release_dir/deploy/pins.env"
: "${ATLAS_BUN_BINARY:?Bun pin is missing}"
: "${ATLAS_OPENCODE_BINARY:?OpenCode pin is missing}"
: "${ATLAS_GIT_BINARY:?Git pin is missing}"
: "${ATLAS_GIT_WRAPPER:?Git wrapper pin is missing}"
: "${ATLAS_REAL_GH:?gh pin is missing}"
tool_paths=("$ATLAS_BUN_BINARY" "$ATLAS_OPENCODE_BINARY" "$ATLAS_GIT_BINARY" "$ATLAS_GIT_WRAPPER" "$ATLAS_REAL_GH")
for path in "${tool_paths[@]}"; do regular_file "$path"; done

staging=$(mktemp -d "$recovery_root/.capture.XXXXXX")
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT
chmod 700 "$staging"
mkdir -p "$staging/etc-atlas" "$staging/units" "$staging/release" "$staging/routing" "$staging/firewall" "$staging/checksums"

copy_private() {
  install -m 0400 -- "$1" "$2"
}

for name in "${config_files[@]}"; do copy_private "$config_root/$name" "$staging/etc-atlas/$name"; done
for name in "${unit_files[@]}"; do copy_private "$unit_root/$name" "$staging/units/$name"; done
copy_private "$release_dir/RELEASE_COMMIT" "$staging/release/RELEASE_COMMIT"
copy_private "$release_dir/deploy/pins.env" "$staging/release/pins.env"
copy_private "$route_record" "$staging/routing/record"
copy_private "$firewall_record" "$staging/firewall/record"

sha256sum -- "${tool_paths[@]}" > "$staging/checksums/tools.sha256"
printf 'captured_at=%s\nrelease=%s\ncommit=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$release_dir" \
  "$(cat "$release_dir/RELEASE_COMMIT")" > "$staging/checksums/metadata"
(
  cd "$staging"
  find etc-atlas units release routing firewall -type f -print0 | sort -z | xargs -0 sha256sum > checksums/files.sha256
)
find "$staging" -type d -exec chmod 700 {} +
find "$staging" -type f -exec chmod 400 {} +

old_moved=false
if [[ -e "$current" || -L "$current" ]]; then
  private_directory "$current"
  if [[ -e "$previous" || -L "$previous" ]]; then
    private_directory "$previous"
    archive="$recovery_root/archive-$stamp"
    [[ ! -e "$archive" && ! -L "$archive" ]] || { echo "recovery archive destination already exists" >&2; exit 1; }
    mv -- "$previous" "$archive"
  fi
  mv -- "$current" "$previous"
  old_moved=true
fi
if ! mv -- "$staging" "$current"; then
  if [[ "$old_moved" == true ]]; then mv -- "$previous" "$current" || true; fi
  echo "recovery configuration refresh failed; inspect $recovery_root" >&2
  exit 1
fi
trap - EXIT
echo "recovery configuration captured at $current; prior copy retained at $previous when present"
