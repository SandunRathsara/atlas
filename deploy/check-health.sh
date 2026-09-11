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

if jq -e '.openCode.ready == true' >/dev/null <<<"$response"; then
  echo "Atlas process, persistence, and OpenCode readiness are healthy"
else
  echo "Atlas process and persistence are healthy; OpenCode readiness is not established" >&2
  exit 3
fi
