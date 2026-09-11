#!/usr/bin/env bash
set -euo pipefail

url=${ATLAS_HEALTH_URL:-http://127.0.0.1:3000/health}
token=${ATLAS_SHARED_TOKEN:-}
if [[ -z "$token" ]]; then
  echo "ATLAS_SHARED_TOKEN must be supplied through the environment, not an argument" >&2
  exit 2
fi

# Read the bearer header from stdin so it never appears in curl's argv/ps
# output. The response itself contains no credentials.
response=$(printf 'Authorization: Bearer %s\nAccept: application/json\n' "$token" |
  curl --silent --show-error --max-time 10 --header @- "$url")

if ! jq -e '.atlas.process == true and .persistence.healthy == true' >/dev/null <<<"$response"; then
  echo "Atlas process or persistence health check failed" >&2
  exit 1
fi

expected_tag=${ATLAS_EXPECTED_RELEASE_TAG:-}
expected_sha=${ATLAS_EXPECTED_RELEASE_SHA:-}
if [[ -n "$expected_tag" || -n "$expected_sha" ]]; then
  [[ -n "$expected_tag" && -n "$expected_sha" ]] || { echo "expected release tag and SHA must be supplied together" >&2; exit 2; }
  if ! jq -e --arg tag "$expected_tag" --arg sha "$expected_sha" \
    '.atlas.release.published == true and .atlas.release.tag == $tag and .atlas.release.gitSha == $sha' >/dev/null <<<"$response"; then
    echo "Atlas release identity does not match the expected candidate" >&2
    exit 1
  fi
fi

identity=$(jq -r 'if .atlas.release.published == true then .atlas.release.tag + " (" + .atlas.release.gitSha + ")" else "development checkout" end' <<<"$response")
echo "Atlas process and persistence are healthy: $identity"
