#!/usr/bin/env bash
set -euo pipefail

release_root=$(realpath "${ATLAS_RELEASE_ROOT:-/opt/atlas/current}")
pins="$release_root/deploy/pins.env"
test -f "$pins" || { echo "OpenCode pin manifest is unavailable" >&2; exit 1; }
# shellcheck disable=SC1090
source "$pins"

[[ "$ATLAS_OPENCODE_VERSION" == "0.0.0-beta-19135" && "$ATLAS_OPENCODE_CLIENT_VERSION" == "0.0.0-beta-19135" ]] || { echo "OpenCode pin is not the approved beta-19135 pairing" >&2; exit 1; }
binary=${ATLAS_OPENCODE_BINARY:?OpenCode binary pin is missing}
expected_binary="/opt/atlas/tools/opencode/0.0.0-beta-19135/bin/opencode2"
[[ "$binary" == "$expected_binary" ]] || { echo "OpenCode binary path does not match the deployment pin" >&2; exit 1; }
test -f "$binary" && test ! -L "$binary" && test -x "$binary" || { echo "pinned OpenCode binary is unavailable" >&2; exit 1; }
actual=$("$binary" --version)
[[ "$actual" == "opencode2 v$ATLAS_OPENCODE_VERSION" ]] || { echo "OpenCode binary does not match $ATLAS_OPENCODE_VERSION" >&2; exit 1; }

package_version() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | sed -n '1p'
}
for package in client schema protocol; do
  package_json="$release_root/node_modules/@opencode-ai/$package/package.json"
  test -f "$package_json" && test ! -L "$package_json" || { echo "pinned OpenCode $package package is unavailable" >&2; exit 1; }
  [[ "$(package_version "$package_json")" == "$ATLAS_OPENCODE_CLIENT_VERSION" ]] || { echo "OpenCode $package package does not match $ATLAS_OPENCODE_CLIENT_VERSION" >&2; exit 1; }
done
echo "OpenCode binary/client pins verified: $actual"
