#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <new-absolute-isolated-stage-directory>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$script_dir/pins.env"

[[ "$ATLAS_OPENCODE_VERSION" == "0.0.0-beta-19135" && "$ATLAS_OPENCODE_CLIENT_VERSION" == "0.0.0-beta-19135" ]] || { echo "stage-opencode requires the approved beta-19135 pairing" >&2; exit 1; }
destination=$(realpath -m "$1")
[[ "$destination" = /* && "$destination" != "/" ]] || { echo "stage directory must be a safe absolute path" >&2; exit 1; }
[[ ! -e "$destination" && ! -L "$destination" ]] || { echo "stage directory already exists; refusing to overwrite it" >&2; exit 1; }

bun_binary=${ATLAS_STAGE_BUN_BINARY:-$ATLAS_BUN_BINARY}
test -x "$bun_binary" || { echo "pinned Bun binary is unavailable" >&2; exit 1; }
[[ "$($bun_binary --version)" == "$ATLAS_BUN_VERSION" ]] || { echo "Bun binary does not match the pinned version" >&2; exit 1; }

parent=$(dirname "$destination")
mkdir -p "$parent"
staging=$(mktemp -d "$parent/.opencode-stage.XXXXXX")
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT
chmod 700 "$staging"

download() {
  local url=$1 expected=$2 archive=$3 digest
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$url" --output "$archive"
  digest=$(openssl dgst -sha512 -binary "$archive" | base64 --wrap=0)
  [[ "sha512-$digest" == "$expected" ]] || { echo "package integrity mismatch: $url" >&2; exit 1; }
}

extract_package() {
  local archive=$1 output=$2 listing
  listing=$(tar --list --file="$archive")
  [[ -n "$listing" ]] || { echo "empty package archive" >&2; exit 1; }
  if printf '%s\n' "$listing" | grep -qv '^package/'; then
    echo "unexpected package archive layout" >&2
    exit 1
  fi
  tar --extract --gzip --file="$archive" --directory="$output"
  [[ ! -L "$output/package" ]] || { echo "package root must not be a symlink" >&2; exit 1; }
  if find "$output/package" -type l -print -quit | grep -q .; then
    echo "package contains a symlink" >&2
    exit 1
  fi
}

downloads="$staging/downloads"
mkdir -p "$downloads"
download \
  "https://registry.npmjs.org/@opencode-ai/cli-linux-x64/-/cli-linux-x64-${ATLAS_OPENCODE_VERSION}.tgz" \
  "$ATLAS_OPENCODE_CLI_LINUX_X64_INTEGRITY" \
  "$downloads/opencode-cli.tgz"
download \
  "https://registry.npmjs.org/@opencode-ai/client/-/client-${ATLAS_OPENCODE_CLIENT_VERSION}.tgz" \
  "$ATLAS_OPENCODE_CLIENT_INTEGRITY" \
  "$downloads/opencode-client.tgz"
download \
  "https://registry.npmjs.org/@opencode-ai/schema/-/schema-${ATLAS_OPENCODE_CLIENT_VERSION}.tgz" \
  "$ATLAS_OPENCODE_SCHEMA_INTEGRITY" \
  "$downloads/opencode-schema.tgz"
download \
  "https://registry.npmjs.org/@opencode-ai/protocol/-/protocol-${ATLAS_OPENCODE_CLIENT_VERSION}.tgz" \
  "$ATLAS_OPENCODE_PROTOCOL_INTEGRITY" \
  "$downloads/opencode-protocol.tgz"

binary_stage="$staging/tools/opencode/$ATLAS_OPENCODE_VERSION/bin"
client_stage="$staging/release/node_modules/@opencode-ai"
mkdir -p "$binary_stage" "$client_stage"
extract_package "$downloads/opencode-cli.tgz" "$staging"
install -m 0555 "$staging/package/bin/opencode2" "$binary_stage/opencode2"
rm -rf -- "$staging/package"

for package in client schema protocol; do
  extract_package "$downloads/opencode-$package.tgz" "$staging"
  mv -- "$staging/package" "$client_stage/$package"
done

client_package="$client_stage/client/package.json"
schema_package="$client_stage/schema/package.json"
protocol_package="$client_stage/protocol/package.json"
package_version() {
  sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | sed -n '1p'
}
[[ "$(package_version "$client_package")" == "$ATLAS_OPENCODE_CLIENT_VERSION" ]] || { echo "OpenCode client version mismatch" >&2; exit 1; }
[[ "$(package_version "$schema_package")" == "$ATLAS_OPENCODE_CLIENT_VERSION" ]] || { echo "OpenCode schema version mismatch" >&2; exit 1; }
[[ "$(package_version "$protocol_package")" == "$ATLAS_OPENCODE_CLIENT_VERSION" ]] || { echo "OpenCode protocol version mismatch" >&2; exit 1; }
(
  cd "$staging/release"
  "$bun_binary" -e 'await import("@opencode-ai/client")'
)

binary="$binary_stage/opencode2"
probe="$staging/probe"
mkdir -p "$probe/home" "$probe/config" "$probe/data" "$probe/state"
version=$(env -i HOME="$probe/home" PATH=/usr/bin:/bin XDG_CONFIG_HOME="$probe/config" XDG_DATA_HOME="$probe/data" XDG_STATE_HOME="$probe/state" "$binary" --version)
[[ "$version" == "opencode2 v$ATLAS_OPENCODE_VERSION" ]] || { echo "OpenCode binary version mismatch: $version" >&2; exit 1; }
[[ ! -e "$probe/state/opencode/service.json" ]] || { echo "version probe registered an OpenCode service" >&2; exit 1; }
rm -rf -- "$probe" "$downloads"

manifest="$staging/OPENCODE_ARTIFACTS"
{
  printf 'binary_version=%s\n' "$ATLAS_OPENCODE_VERSION"
  printf 'client_version=%s\n' "$ATLAS_OPENCODE_CLIENT_VERSION"
  printf 'binary_package_integrity=%s\n' "$ATLAS_OPENCODE_CLI_LINUX_X64_INTEGRITY"
  printf 'client_package_integrity=%s\n' "$ATLAS_OPENCODE_CLIENT_INTEGRITY"
  printf 'schema_package_integrity=%s\n' "$ATLAS_OPENCODE_SCHEMA_INTEGRITY"
  printf 'protocol_package_integrity=%s\n' "$ATLAS_OPENCODE_PROTOCOL_INTEGRITY"
  (
    cd "$staging"
    sha256sum \
      "tools/opencode/$ATLAS_OPENCODE_VERSION/bin/opencode2" \
      "release/node_modules/@opencode-ai/client/package.json" \
      "release/node_modules/@opencode-ai/schema/package.json" \
      "release/node_modules/@opencode-ai/protocol/package.json"
  )
} > "$manifest"

find "$staging" -type d -exec chmod 0555 {} +
find "$staging" -type f -exec chmod 0444 {} +
chmod 0555 "$binary"
mv -- "$staging" "$destination"
trap - EXIT
echo "staged immutable OpenCode $ATLAS_OPENCODE_VERSION binary/client at $destination"
