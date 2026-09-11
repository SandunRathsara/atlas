set dotenv-load
set dotenv-filename := ".env"

export ATLAS_SHARED_TOKEN := env_var_or_default("ATLAS_SHARED_TOKEN", "use-a-local-secret")
export ATLAS_GITHUB_WEBHOOK_SECRET := env_var_or_default("ATLAS_GITHUB_WEBHOOK_SECRET", "a-webhook-secret")
export ATLAS_PORT := env_var_or_default("ATLAS_PORT", "3000")
export ATLAS_WEBHOOK_PORT := env_var_or_default("ATLAS_WEBHOOK_PORT", "3001")
export ATLAS_DATABASE_PATH := env_var_or_default("ATLAS_DATABASE_PATH", justfile_directory() / "data" / "atlas.sqlite")
export ATLAS_SESSION_ROOT := env_var_or_default("ATLAS_SESSION_ROOT", env_var("HOME") / ".local/share/atlas/sessions")
export ATLAS_MIN_FREE_BYTES := env_var_or_default("ATLAS_MIN_FREE_BYTES", "1073741824")

default: dev

# Local Atlas UI + webhook listeners (http://127.0.0.1:3000)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v bun >/dev/null; then
      echo "bun 1.3.14 is required" >&2
      exit 1
    fi
    github_env="${ATLAS_GITHUB_ENV_PATH:-$HOME/.config/atlas/github.env}"
    if [[ -z "${ATLAS_GITHUB_ORGANIZATION:-}" || -z "${ATLAS_GITHUB_INSTALLATION_ID:-}" ]]; then
      if [[ -f "$github_env" ]]; then
        :
      elif command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
        if [[ -z "${ATLAS_GITHUB_ORGANIZATION:-}" ]]; then
          ATLAS_GITHUB_ORGANIZATION="$(gh repo view --json owner --jq .owner.login 2>/dev/null || true)"
          if [[ -z "$ATLAS_GITHUB_ORGANIZATION" ]]; then
            ATLAS_GITHUB_ORGANIZATION="$(gh api user --jq .login)"
          fi
          export ATLAS_GITHUB_ORGANIZATION
        fi
        if [[ -z "${ATLAS_GITHUB_INSTALLATION_ID:-}" ]]; then
          account_type="$(gh api "users/${ATLAS_GITHUB_ORGANIZATION}" --jq .type 2>/dev/null || true)"
          if [[ "$account_type" == "Organization" ]]; then
            ATLAS_GITHUB_INSTALLATION_ID="$(
              gh api "orgs/${ATLAS_GITHUB_ORGANIZATION}/installations" --jq '
                [.installations[] | select(.app_slug == "atlas" or (.app_slug | test("atlas"; "i")))]
                | .[0].id // empty
              ' 2>/dev/null || true
            )"
          fi
          if [[ -z "${ATLAS_GITHUB_INSTALLATION_ID:-}" || "$ATLAS_GITHUB_INSTALLATION_ID" == "null" ]]; then
            ATLAS_GITHUB_INSTALLATION_ID="0"
            echo "No Atlas GitHub App installation found; using id 0 (inventory stays empty until you add App creds)."
          fi
          export ATLAS_GITHUB_INSTALLATION_ID
        fi
      else
        echo "GitHub scope missing. Run gh auth login, or put ATLAS_GITHUB_ORGANIZATION and ATLAS_GITHUB_INSTALLATION_ID in $github_env (mode 0600)." >&2
        exit 1
      fi
    fi
    bun install --frozen-lockfile
    mkdir -p "$(dirname "$ATLAS_DATABASE_PATH")" "$ATLAS_SESSION_ROOT"
    supplier_socket="${ATLAS_SUPPLIER_SOCKET:-$HOME/.config/atlas/supplier.sock}"
    trap 'rm -f "$supplier_socket"' EXIT
    echo "Atlas UI  http://127.0.0.1:${ATLAS_PORT}  (or http://localhost:${ATLAS_PORT})"
    echo "Webhook   http://127.0.0.1:${ATLAS_WEBHOOK_PORT}/webhooks/github"
    echo "Sign-in   Authorization: Bearer \$ATLAS_SHARED_TOKEN  (or the login form)"
    if [[ -n "${ATLAS_GITHUB_ORGANIZATION:-}" ]]; then
      echo "GitHub    ${ATLAS_GITHUB_ORGANIZATION} / installation ${ATLAS_GITHUB_INSTALLATION_ID:-from github.env}"
    fi
    bun run dev

# Build the checklist payload and open the static previewer
checklist:
    npx bearings checklist
