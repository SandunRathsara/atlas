#!/usr/bin/env bash
set -euo pipefail

release_root=$(realpath "${ATLAS_RELEASE_ROOT:-/opt/atlas/current}")
pins="$release_root/deploy/pins.env"
test -f "$pins" || { echo "deployment manifest is unavailable" >&2; exit 1; }
# shellcheck disable=SC1090
source "$pins"

binary=${ATLAS_OPENCODE_BINARY:?OpenCode executable selection is missing}
test -f "$binary" && test ! -L "$binary" && test -x "$binary" || { echo "selected OpenCode executable is unavailable" >&2; exit 1; }
if ! actual=$("$binary" --version) || [[ -z "$actual" ]]; then
  echo "selected OpenCode executable did not report its version" >&2
  exit 1
fi
printf 'selected OpenCode executable verified: %s\n' "$actual"
