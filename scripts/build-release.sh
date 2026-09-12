#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <release-tag> <git-sha> <output-directory>" >&2
  exit 2
}

[[ $# -eq 3 ]] || usage
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tag=$1
requested_commit=$2
output_dir=$(realpath -m "$3")
source "$source_dir/deploy/pins.env"

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo "Atlas releases are built only on Linux x64" >&2; exit 1; }
git -C "$source_dir" diff --quiet HEAD --
git -C "$source_dir" diff --cached --quiet HEAD --
[[ -z $(git -C "$source_dir" ls-files --others --exclude-standard) ]] || { echo "release source contains untracked files" >&2; exit 1; }
commit=$(git -C "$source_dir" rev-parse --verify HEAD)
[[ "$requested_commit" == "$commit" ]] || { echo "requested release SHA is not the checked-out commit" >&2; exit 1; }

bun_binary=${ATLAS_BUILD_BUN_BINARY:-$(command -v bun)}
[[ -x "$bun_binary" && $($bun_binary --version) == "$ATLAS_BUN_VERSION" ]] || { echo "release build requires Bun $ATLAS_BUN_VERSION" >&2; exit 1; }
"$bun_binary" "$source_dir/scripts/release.ts" metadata "$tag" "$commit" /dev/null

artifact="atlas-linux-x64-${tag}.tar.gz"
checksum="${artifact}.sha256"
metadata=atlas-release.json
mkdir -p "$output_dir"
for path in "$output_dir/$artifact" "$output_dir/$checksum" "$output_dir/$metadata"; do
  [[ ! -e "$path" && ! -L "$path" ]] || { echo "release output already exists: $path" >&2; exit 1; }
done

temporary=$(mktemp -d "${TMPDIR:-/tmp}/atlas-release.XXXXXX")
cleanup() {
  chmod -R u+w "$temporary" 2>/dev/null || true
  rm -rf -- "$temporary"
}
trap cleanup EXIT
release_name="atlas-${tag}"
release_root="$temporary/$release_name"
mkdir "$release_root"

"$bun_binary" install --cwd "$source_dir" --frozen-lockfile
"$bun_binary" run --cwd "$source_dir" build:css
git -C "$source_dir" archive --format=tar "$commit" | tar --extract --file=- --directory="$release_root"
cp "$source_dir/public/app.css" "$release_root/public/app.css"
(
  cd "$release_root"
  "$bun_binary" install --frozen-lockfile --production
)
"$bun_binary" "$source_dir/scripts/release.ts" metadata "$tag" "$commit" "$release_root/RELEASE_METADATA.json"
bash "$release_root/deploy/verify-assets.sh"
cp "$release_root/RELEASE_METADATA.json" "$output_dir/$metadata"
chmod -R a-w "$release_root"
tar --create --gzip --file="$output_dir/$artifact" --directory="$temporary" "$release_name"
(
  cd "$output_dir"
  sha256sum "$artifact" > "$checksum"
)

echo "built immutable Atlas release artifacts in $output_dir"
