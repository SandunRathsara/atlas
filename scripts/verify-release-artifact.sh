#!/usr/bin/env bash
# Builds one Atlas Release and proves its three files work on their own.
#
# Usage:
#   bash scripts/verify-release-artifact.sh                     # v0.1.0+build.1 at HEAD, scratch output
#   bash scripts/verify-release-artifact.sh <tag> <sha> <output-directory>
#
# Steps:
#   1. bun scripts/build-release.ts <tag> <sha> <output>  (clean checkout required)
#   2. the output holds exactly atlas-linux-x64, atlas-linux-x64.sha256 and
#      atlas-release.json (plus install.sh once Phase 4 adds it);
#   3. sha256sum --check passes and the metadata agrees with the binary
#      (schema 2, tag, commit, SHA-256, size, OpenCode client);
#   4. the binary runs with a PATH that has no Bun and reports its identity;
#   5. `atlas serve` from a copy of only the binary answers /health and
#      /health?activation=1 with the expected identity, OpenCode not ready.
# Outputs: the three files stay in <output-directory> when given; the default
# scratch output (under ~/.cache, not the small /tmp) is removed.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cache=${XDG_CACHE_HOME:-$HOME/.cache}
if [[ $# -eq 0 ]]; then
  tag=v0.1.0+build.1
  commit=$(git -C "$root" rev-parse HEAD)
  mkdir -p "$cache"
  output=$(mktemp -d "$cache/atlas-release-output.XXXXXX")
  remove_output=1
elif [[ $# -eq 3 ]]; then
  tag=$1
  commit=$2
  output=$3
  remove_output=0
else
  echo "usage: $0 [<release-tag> <git-sha> <output-directory>]" >&2
  exit 2
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/atlas-release-smoke.XXXXXX")
server_pid=
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temporary"
  if [[ $remove_output -eq 1 ]]; then rm -rf -- "$output"; fi
}
trap cleanup EXIT

bun "$root/scripts/build-release.ts" "$tag" "$commit" "$output" >/dev/null
# Phase 4: add install.sh to this list once build-release.ts copies it.
expected_files=$'atlas-linux-x64\natlas-linux-x64.sha256\natlas-release.json'
actual_files=$(find "$output" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
[[ "$actual_files" == "$expected_files" ]] || { printf 'unexpected release files:\n%s\n' "$actual_files" >&2; exit 1; }
(cd "$output" && sha256sum --quiet --check atlas-linux-x64.sha256)
[[ $(wc -l <"$output/atlas-linux-x64.sha256") -eq 1 ]]

binary="$output/atlas-linux-x64"
digest=$(sha256sum "$binary" | cut -d' ' -f1)
size=$(stat -c %s "$binary")
client=$(jq -r .version "$root/node_modules/@opencode/client/package.json")
jq -e --arg tag "$tag" --arg sha "$commit" --arg digest "$digest" --argjson size "$size" --arg client "$client" '
  .schemaVersion == 2 and .identity.published == true and .identity.tag == $tag and .identity.gitSha == $sha and
  .asset.name == "atlas-linux-x64" and .asset.checksum == "atlas-linux-x64.sha256" and
  .asset.sha256 == $digest and .asset.size == $size and .asset.os == "linux" and .asset.architecture == "x64" and
  (.minimumHostTools.git | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and (.minimumHostTools.gh | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) and
  .openCodeClient == $client and (has("runtime") | not) and (has("artifact") | not)' "$output/atlas-release.json" >/dev/null

# A PATH with no Bun: the binary must not need it.
no_bun_path=/usr/local/bin:/usr/bin:/bin
if PATH=$no_bun_path command -v bun >/dev/null; then
  echo "cannot prove Bun independence: bun is on $no_bun_path" >&2
  exit 1
fi
identity=$(env -i PATH="$no_bun_path" "$binary" version --json)
jq -e --arg tag "$tag" --arg sha "$commit" '.published == true and .tag == $tag and .gitSha == $sha' >/dev/null <<<"$identity"

pick_port() {
  bun -e 'const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return new Response()}}); console.log(server.port); server.stop()'
}
port=$(pick_port)
webhook_port=$(pick_port)
while [[ $webhook_port == "$port" ]]; do webhook_port=$(pick_port); done
run_root="$temporary/run"
mkdir -m 0700 "$run_root" "$run_root/home" "$run_root/sessions"
env -i \
  PATH="$no_bun_path" \
  HOME="$run_root/home" \
  ATLAS_SHARED_TOKEN=fixture-secret \
  ATLAS_GITHUB_WEBHOOK_SECRET=fixture-webhook-secret \
  ATLAS_GITHUB_ORGANIZATION=fixture-org \
  ATLAS_GITHUB_INSTALLATION_ID=1 \
  ATLAS_PORT="$port" \
  ATLAS_WEBHOOK_PORT="$webhook_port" \
  ATLAS_DATABASE_PATH="$run_root/atlas.sqlite" \
  ATLAS_SESSION_ROOT="$run_root/sessions" \
  ATLAS_GITHUB_ENV_PATH="$run_root/github.env" \
  ATLAS_CREDENTIAL_REGISTRY_PATH="$run_root/session-scopes.json" \
  ATLAS_SUPPLIER_SOCKET="$run_root/supplier.sock" \
  ATLAS_SUPPLIER_KEY_PATH="$run_root/supplier.key" \
  OPENCODE_SERVICE_FILE="$run_root/missing-opencode-service.json" \
  "$binary" serve >"$run_root/server.log" 2>&1 &
server_pid=$!

health() {
  printf 'Authorization: Bearer fixture-secret\nAccept: application/json\n' |
    curl --silent --show-error --max-time 10 --header @- "http://127.0.0.1:$port$1"
}
healthy=0
for _ in $(seq 1 100); do
  if activation=$(health '/health?activation=1' 2>/dev/null) &&
      jq -e --arg tag "$tag" --arg sha "$commit" \
        '.atlas.process == true and .persistence.healthy == true and .atlas.release.published == true and
         .atlas.release.tag == $tag and .atlas.release.gitSha == $sha and (has("openCode") | not)' >/dev/null <<<"$activation"; then
    healthy=1
    break
  fi
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.1
done
if [[ $healthy -ne 1 ]]; then
  cat "$run_root/server.log" >&2
  echo "the released binary did not become healthy" >&2
  exit 1
fi
jq -e --arg tag "$tag" --arg sha "$commit" --arg client "$client" \
  '.atlas.process == true and .atlas.release.published == true and .atlas.release.tag == $tag and
   .atlas.release.gitSha == $sha and .persistence.healthy == true and .openCode.ready == false and
   .openCode.clientVersion == $client and .openCode.versionWarning == null' >/dev/null <<<"$(health /health)"

kill -TERM "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=
echo "release files verified: checksum, metadata, Bun-free start, and /health identity for $tag"
