#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <git-source> <new-absolute-release-directory>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/pins.env"
source_dir=$(realpath "$1")
release_dir=$(realpath -m "$2")

[[ "$release_dir" = /* && "$release_dir" != "/" ]] || { echo "release directory must be a safe absolute path" >&2; exit 1; }
[[ "$release_dir" != "/opt/atlas/current" ]] || { echo "stage a release, never overwrite current" >&2; exit 1; }
[[ ! -e "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory already exists; refusing to overwrite it" >&2; exit 1; }

git_binary=${ATLAS_STAGE_GIT_BINARY:-$ATLAS_GIT_BINARY}
test -x "$git_binary" || { echo "pinned Git binary is unavailable" >&2; exit 1; }
git_version=$("$git_binary" --version)
[[ "$git_version" == "git version $ATLAS_GIT_VERSION" ]] || { echo "Git binary does not match the pinned version" >&2; exit 1; }
"$git_binary" -C "$source_dir" rev-parse --show-toplevel >/dev/null 2>&1 || { echo "source is not a Git checkout" >&2; exit 1; }

if [[ -n "$("$git_binary" -C "$source_dir" status --porcelain --untracked-files=all)" ]]; then
  echo "source checkout is not clean; commit the exact release first" >&2
  exit 1
fi

commit=$("$git_binary" -C "$source_dir" rev-parse --verify HEAD)
bun_binary=${ATLAS_STAGE_BUN_BINARY:-$ATLAS_BUN_BINARY}
test -x "$bun_binary" || { echo "pinned Bun binary is unavailable" >&2; exit 1; }
bun_version=$("$bun_binary" --version)
[[ "$bun_version" == "$ATLAS_BUN_VERSION" ]] || { echo "Bun binary does not match the pinned version" >&2; exit 1; }

parent=$(dirname "$release_dir")
mkdir -p "$parent"
staging=$(mktemp -d "$parent/.atlas-release.XXXXXX")
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT

"$git_binary" -C "$source_dir" archive --format=tar "$commit" | tar --extract --file=- --directory="$staging"
printf '%s\n' "$commit" > "$staging/RELEASE_COMMIT"
(
  cd "$staging"
  "$bun_binary" install --frozen-lockfile
  "$bun_binary" run build:css
)
chmod -R a-w "$staging"
mv -- "$staging" "$release_dir"
trap - EXIT
echo "staged immutable Atlas release $commit at $release_dir"
