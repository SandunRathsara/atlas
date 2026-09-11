#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  tag=v0.1.0+build.1
  commit=$(git -C "$(dirname -- "${BASH_SOURCE[0]}")/.." rev-parse HEAD)
  output=$(mktemp -d "${TMPDIR:-/tmp}/atlas-release-output.XXXXXX")
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

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$root/deploy/pins.env"
artifact="atlas-linux-x64-${tag}.tar.gz"
temporary=$(mktemp -d "${TMPDIR:-/tmp}/atlas-release-smoke.XXXXXX")
server_pid=
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  chmod -R u+w "$temporary" 2>/dev/null || true
  rm -rf -- "$temporary"
  if [[ $remove_output -eq 1 ]]; then rm -rf -- "$output"; fi
}
trap cleanup EXIT

bash "$root/scripts/build-release.sh" "$tag" "$commit" "$output"
(
  cd "$output"
  sha256sum --check "${artifact}.sha256"
)
mkdir "$temporary/extracted"
tar --extract --gzip --file="$output/$artifact" --directory="$temporary/extracted"
mapfile -t roots < <(find "$temporary/extracted" -mindepth 1 -maxdepth 1 -type d)
[[ ${#roots[@]} -eq 1 ]] || { echo "release archive must contain exactly one release directory" >&2; exit 1; }
release_root=${roots[0]}

cmp "$output/atlas-release.json" "$release_root/RELEASE_METADATA.json"
test -s "$release_root/public/app.css"
test -d "$release_root/node_modules/hono"
test -d "$release_root/node_modules/@opencode-ai/client"
test -d "$release_root/node_modules/htmx.org"
test ! -d "$release_root/node_modules/typescript"
test -f "$release_root/scripts/atlas-gh.ts"
test -f "$release_root/scripts/atlas-git-credential.ts"
bash "$release_root/deploy/verify-assets.sh"

pick_port() {
  bun -e 'const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){return new Response()}}); console.log(server.port); server.stop()'
}
port=$(pick_port)
webhook_port=$(pick_port)
while [[ $webhook_port == "$port" ]]; do webhook_port=$(pick_port); done
run_root="$temporary/run"
mkdir -m 0700 "$run_root" "$run_root/home" "$run_root/sessions"
ATLAS_RELEASE_ROOT="$release_root" \
ATLAS_SHARED_TOKEN=fixture-secret \
ATLAS_GITHUB_WEBHOOK_SECRET=fixture-webhook-secret \
ATLAS_PORT="$port" \
ATLAS_WEBHOOK_PORT="$webhook_port" \
ATLAS_DATABASE_PATH="$run_root/atlas.sqlite" \
ATLAS_SESSION_ROOT="$run_root/sessions" \
ATLAS_GITHUB_ENV_PATH="$run_root/github.env" \
ATLAS_CREDENTIAL_REGISTRY_PATH="$run_root/session-scopes.json" \
ATLAS_SUPPLIER_SOCKET="$run_root/supplier.sock" \
ATLAS_SUPPLIER_KEY_PATH="$run_root/supplier.key" \
OPENCODE_SERVICE_FILE="$run_root/missing-opencode-service.json" \
HOME="$run_root/home" \
bun "$release_root/src/server.ts" >"$run_root/server.log" 2>&1 &
server_pid=$!

healthy=0
for _ in $(seq 1 100); do
  if ATLAS_SHARED_TOKEN=fixture-secret \
      ATLAS_HEALTH_URL="http://127.0.0.1:$port/health" \
      ATLAS_EXPECTED_RELEASE_TAG="$tag" \
      ATLAS_EXPECTED_RELEASE_SHA="$commit" \
      bash "$release_root/deploy/check-health.sh" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ $healthy -ne 1 ]]; then
  cat "$run_root/server.log" >&2
  echo "extracted Atlas release did not become healthy" >&2
  exit 1
fi

response=$(printf 'Authorization: Bearer fixture-secret\nAccept: application/json\n' |
  curl --silent --show-error --max-time 10 --header @- "http://127.0.0.1:$port/health")
jq -e --arg tag "$tag" --arg sha "$commit" \
  '.atlas.process == true and .atlas.release.published == true and .atlas.release.tag == $tag and
   .atlas.release.gitSha == $sha and .persistence.healthy == true and .openCode.ready == false' \
  >/dev/null <<<"$response"
if ATLAS_SHARED_TOKEN=fixture-secret \
    ATLAS_HEALTH_URL="http://127.0.0.1:$port/health" \
    ATLAS_EXPECTED_RELEASE_TAG="$tag" \
    ATLAS_EXPECTED_RELEASE_SHA="$(printf '0%.0s' {1..40})" \
    bash "$release_root/deploy/check-health.sh" >/dev/null 2>&1; then
  echo "candidate health accepted the wrong release SHA" >&2
  exit 1
fi

kill -TERM "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=
echo "release artifact extracted and started without install, CSS build, or OpenCode"
