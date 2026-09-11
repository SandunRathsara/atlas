#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <exact-server-version> <new-absolute-isolated-stage-directory>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
version=$1
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || {
  echo "an explicit exact OpenCode server version is required" >&2
  exit 1
}
destination=$(realpath -m "$2")
[[ "$destination" = /* && "$destination" != "/" ]] || { echo "stage directory must be a safe absolute path" >&2; exit 1; }
[[ ! -e "$destination" && ! -L "$destination" ]] || { echo "stage directory already exists; refusing to overwrite it" >&2; exit 1; }

parent=$(dirname "$destination")
mkdir -p "$parent"
staging=$(mktemp -d "$parent/.opencode-stage.XXXXXX")
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT
chmod 700 "$staging"

curl_binary=${ATLAS_STAGE_CURL_BINARY:-curl}
registry=${ATLAS_OPENCODE_REGISTRY_URL:-https://registry.npmjs.org}
metadata="$staging/registry.json"
encoded_version=$(jq -rn --arg value "$version" '$value | @uri')
"$curl_binary" --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "${registry%/}/@opencode-ai%2fcli-linux-x64/$encoded_version" --output "$metadata"

metadata_version=$(jq -er '.version | select(type == "string" and length > 0)' "$metadata") || {
  echo "registry metadata has no package version" >&2
  exit 1
}
[[ "$metadata_version" == "$version" ]] || { echo "registry metadata version does not match $version" >&2; exit 1; }
integrity=$(jq -er '.dist.integrity | select(type == "string" and length > 0)' "$metadata") || {
  echo "registry metadata has no package integrity" >&2
  exit 1
}
[[ "$integrity" =~ ^sha512-[A-Za-z0-9+/]+={0,2}$ ]] || { echo "registry package integrity is not a supported sha512 value" >&2; exit 1; }
tarball=$(jq -er '.dist.tarball | select(type == "string" and startswith("https://"))' "$metadata") || {
  echo "registry metadata has no secure package tarball" >&2
  exit 1
}

archive="$staging/opencode-cli.tgz"
"$curl_binary" --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$tarball" --output "$archive"
digest=$(openssl dgst -sha512 -binary "$archive" | base64 --wrap=0)
[[ "sha512-$digest" == "$integrity" ]] || { echo "package integrity mismatch: $tarball" >&2; exit 1; }

listing=$(tar --list --file="$archive")
[[ -n "$listing" ]] || { echo "empty package archive" >&2; exit 1; }
if printf '%s\n' "$listing" | grep -qv '^package/'; then
  echo "unexpected package archive layout" >&2
  exit 1
fi
tar --extract --gzip --file="$archive" --directory="$staging"
[[ -d "$staging/package" && ! -L "$staging/package" ]] || { echo "package root is missing or unsafe" >&2; exit 1; }
if find "$staging/package" -type l -print -quit | grep -q .; then
  echo "package contains a symlink" >&2
  exit 1
fi
source_binary="$staging/package/bin/opencode2"
[[ -f "$source_binary" && ! -L "$source_binary" ]] || { echo "package has no usable OpenCode server executable" >&2; exit 1; }

binary_stage="$staging/tools/opencode/$version/bin"
mkdir -p "$binary_stage"
install -m 0555 "$source_binary" "$binary_stage/opencode2"
rm -rf -- "$staging/package" "$archive" "$metadata"

binary="$binary_stage/opencode2"
probe="$staging/probe"
mkdir -p "$probe/home" "$probe/config" "$probe/data" "$probe/state"
actual=$(env -i HOME="$probe/home" PATH=/usr/bin:/bin XDG_CONFIG_HOME="$probe/config" XDG_DATA_HOME="$probe/data" XDG_STATE_HOME="$probe/state" "$binary" --version)
[[ "$actual" == "opencode2 v$version" ]] || { echo "OpenCode server version mismatch: $actual" >&2; exit 1; }
[[ ! -e "$probe/state/opencode/service.json" ]] || { echo "version probe registered an OpenCode service" >&2; exit 1; }
rm -rf -- "$probe"

binary_sha256=$(sha256sum "$binary" | cut -d ' ' -f 1)
{
  printf 'server_version=%s\n' "$version"
  printf 'registry_integrity=%s\n' "$integrity"
  printf 'binary_sha256=%s\n' "$binary_sha256"
} > "$staging/OPENCODE_ARTIFACTS"

find "$staging" -type d -exec chmod 0555 {} +
find "$staging" -type f -exec chmod 0444 {} +
chmod 0555 "$binary"
mv -- "$staging" "$destination"
trap - EXIT
echo "staged immutable OpenCode server $version at $destination; active selection unchanged"
