#!/usr/bin/env bash
set -euo pipefail

url=${ATLAS_HEALTH_URL:-http://127.0.0.1:3000/health?activation=1}
token=${ATLAS_SHARED_TOKEN:-}
expected_tag=${ATLAS_EXPECTED_RELEASE_TAG:-}
expected_sha=${ATLAS_EXPECTED_RELEASE_SHA:-}
if [[ -z "$token" || -z "$expected_tag" || -z "$expected_sha" ]]; then
  echo "activation health requires the shared token, release tag, and SHA through the environment" >&2
  exit 2
fi

response=$(printf 'Authorization: Bearer %s\nAccept: application/json\n' "$token" |
  curl --silent --show-error --max-time 10 --header @- "$url")

if ! jq -e --arg tag "$expected_tag" --arg sha "$expected_sha" \
  '.atlas.process == true and .persistence.healthy == true and
   .atlas.release.published == true and .atlas.release.tag == $tag and .atlas.release.gitSha == $sha and
   (has("openCode") | not)' >/dev/null <<<"$response"; then
  echo "Atlas activation identity or persistence health check failed" >&2
  exit 1
fi

echo "Atlas activation health is verified: $expected_tag ($expected_sha)"
