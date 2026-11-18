#!/usr/bin/env bash
set -euo pipefail

[[ "${ATLAS_WRITERS_STOPPED:-}" == YES ]] || {
  echo "refusing SQLite build verification until Atlas, OpenCode, and agent writers are stopped" >&2
  exit 1
}

release_root=$(realpath "${ATLAS_RELEASE_ROOT:-/opt/atlas/current}")
# Atlas's own SQLite is the one compiled into its binary (`atlas ops` sets
# ATLAS_BIN to that binary). OpenCode is the operator-selected executable.
atlas_bin=${ATLAS_BIN:-$release_root/atlas}
ATLAS_OPENCODE_BINARY=${ATLAS_OPENCODE_BINARY:-/opt/atlas/tools/opencode/current/bin/opencode}
ATLAS_OPENCODE_BINARY=$(realpath -m -- "$ATLAS_OPENCODE_BINARY")

fixed_version() {
  local version=$1 major minor patch
  IFS=. read -r major minor patch <<< "$version"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]] || return 1
  (( major == 3 )) || return 1
  (( minor >= 52 )) || (( minor == 51 && patch >= 3 )) || (( minor == 50 && patch >= 7 )) || (( minor == 44 && patch >= 6 ))
}

[[ -x "$atlas_bin" ]] || { echo "Atlas binary is unavailable" >&2; exit 1; }
[[ -f "$release_root/RELEASE_METADATA.json" && ! -L "$release_root/RELEASE_METADATA.json" ]] || { echo "selected Atlas Release has no metadata" >&2; exit 1; }
[[ -x "$ATLAS_OPENCODE_BINARY" && ! -L "$ATLAS_OPENCODE_BINARY" ]] || { echo "selected OpenCode executable is unavailable" >&2; exit 1; }
if ! opencode_version=$("$ATLAS_OPENCODE_BINARY" --version) || [[ -z "$opencode_version" ]]; then
  echo "selected OpenCode executable did not report its version" >&2
  exit 1
fi

runtime=$("$atlas_bin" ops sqlite-version) || { echo "Atlas could not report its embedded SQLite version" >&2; exit 1; }
atlas_bun=$(sed -n 's/^bun=//p' <<<"$runtime")
bun_sqlite=$(sed -n 's/^sqlite=//p' <<<"$runtime")
[[ "$bun_sqlite" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && fixed_version "$bun_sqlite" || {
  echo "Atlas's embedded SQLite does not include the accepted WAL-reset fix" >&2
  exit 1
}

# OpenCode has no database CLI. The selected executable is a Bun single-file
# executable whose server opens its database through bun:sqlite, so ask that
# same executable's embedded Bun runtime (BUN_BE_BUN=1, documented by Bun) for
# its SQLite build. The probe runs with a scrubbed environment in a throwaway
# HOME/XDG/working directory and never reads or writes live OpenCode state.
probe=$(mktemp -d)
trap 'rm -rf -- "$probe"' EXIT
mkdir -p "$probe/home" "$probe/config" "$probe/data" "$probe/state" "$probe/cache" "$probe/work"
embedded_bun() {
  (
    cd "$probe/work"
    env -i HOME="$probe/home" PATH=/usr/bin:/bin \
      XDG_CONFIG_HOME="$probe/config" XDG_DATA_HOME="$probe/data" \
      XDG_STATE_HOME="$probe/state" XDG_CACHE_HOME="$probe/cache" \
      BUN_BE_BUN=1 "$ATLAS_OPENCODE_BINARY" "$@"
  )
}
cannot_prove() {
  echo "OpenCode's embedded SQLite could not be proven to include the accepted WAL-reset fix: $*" >&2
  exit 1
}
# A build without the Bun CLI (for example bun build --trim) ignores
# BUN_BE_BUN and answers as OpenCode; that cannot prove anything.
opencode_bun=$(embedded_bun --version) || cannot_prove "the executable does not expose its embedded Bun runtime"
[[ "$opencode_bun" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || cannot_prove "the executable did not answer as its embedded Bun runtime"
opencode_output=$(
  embedded_bun --eval 'import { Database } from "bun:sqlite"; const db = new Database(":memory:"); const row = db.query("SELECT sqlite_version() AS version, sqlite_source_id() AS source").get(); console.log(row.version); console.log(row.source); db.close();'
) || cannot_prove "the embedded Bun runtime could not query bun:sqlite"
opencode_sqlite=$(sed -n 1p <<<"$opencode_output")
opencode_sqlite_source=$(sed -n 2p <<<"$opencode_output")
[[ "$opencode_sqlite" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || cannot_prove "unexpected SQLite version output"
[[ "$opencode_sqlite_source" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\ [0-9a-f]{64}$ ]] || cannot_prove "unexpected SQLite source ID output"
fixed_version "$opencode_sqlite" || cannot_prove "embedded SQLite $opencode_sqlite predates the fix"
# The runtime answer covers OpenCode's database only if the executable carries
# no second SQLite build. Every SQLite build embeds its source ID, so require
# exactly one distinct ID and require it to be the one the runtime reported.
source_ids=$(LC_ALL=C grep -aoE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9a-f]{64}' "$ATLAS_OPENCODE_BINARY" | sort -u || true)
[[ "$source_ids" == "$opencode_sqlite_source" ]] || cannot_prove "the executable does not embed exactly the one SQLite build its runtime reported"
rm -rf -- "$probe"
trap - EXIT

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
  printf 'release_metadata_sha256=%s\n' "$(sha256sum < "$release_root/RELEASE_METADATA.json" | cut -d ' ' -f 1)"
  printf 'bun_version=%s\n' "$atlas_bun"
  printf 'bun_sqlite_version=%s\n' "$bun_sqlite"
  printf 'opencode_version=%s\n' "$opencode_version"
  printf 'opencode_bun_version=%s\n' "$opencode_bun"
  printf 'opencode_sqlite_version=%s\n' "$opencode_sqlite"
  printf 'opencode_sqlite_source_id=%s\n' "$opencode_sqlite_source"
  printf 'opencode_sqlite_method=embedded-bun-runtime\n'
  printf 'wal_reset_fix=verified\n'
} > "$temporary"
chmod 0400 "$temporary"
mv -f -- "$temporary" "$record"
trap - EXIT
echo "embedded SQLite WAL-reset fix verified for Atlas (Bun $atlas_bun) and $opencode_version"
