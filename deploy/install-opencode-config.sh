#!/usr/bin/env bash
set -euo pipefail

# Installs Atlas's headless OpenCode configuration into one OpenCode
# XDG_CONFIG_HOME. Never starts, stops, or restarts OpenCode; the server reads
# the file at the latest on its next start.
#
# Every write inside the config home runs as that directory's owner. When
# root runs this (bootstrap, restore rehearsal) for an omega-owned config
# home, root only reads the shipped document and then drops to the owner, so
# no privileged write ever follows a path the owner could swap or redirect.

usage() {
  echo "usage: $0 <opencode-xdg-config-home>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_config="$root/opencode/opencode.json"
config_home=$(realpath -ms -- "$1")

[[ -f "$source_config" && ! -L "$source_config" ]] || { echo "shipped OpenCode configuration is missing" >&2; exit 1; }
# The owner side checks that what arrived on stdin is exactly this document.
expected_sha256=$(sha256sum < "$source_config" | cut -d ' ' -f 1)
[[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "shipped OpenCode configuration could not be hashed" >&2; exit 1; }
[[ "$config_home" = /* && "$config_home" != "/" ]] || { echo "OpenCode config home must be a safe absolute path" >&2; exit 1; }
[[ -d "$config_home" && ! -L "$config_home" ]] || { echo "OpenCode config home is missing or unsafe: $config_home" >&2; exit 1; }

# The config home's owner (omega on the host) owns the installed file.
owner=$(stat -c %u -- "$config_home")
group=$(stat -c %g -- "$config_home")

# Runs as the config home's owner and reads the shipped document on stdin.
# Self-contained: it is also executed through `declare -f` after setpriv.
install_as_owner() {
  set -euo pipefail
  umask 0077
  cd /
  local config_home=$1 expected_sha256=$2
  local directory="$config_home/opencode"
  local target="$directory/opencode.json"
  local temporary backup
  [[ -d "$config_home" && ! -L "$config_home" ]] || { echo "OpenCode config home is missing or unsafe: $config_home" >&2; return 1; }
  if [[ -e "$directory" || -L "$directory" ]]; then
    [[ -d "$directory" && ! -L "$directory" ]] || { echo "OpenCode config directory is unsafe: $directory" >&2; return 1; }
  else
    mkdir -m 0700 -- "$directory"
  fi
  chmod 0700 -- "$directory"

  # OpenCode also loads opencode.jsonc from the same directory; two global
  # documents would make the effective headless policy ambiguous.
  [[ ! -e "$directory/opencode.jsonc" && ! -L "$directory/opencode.jsonc" ]] || {
    echo "refusing to install beside $directory/opencode.jsonc; merge it into deploy/opencode/opencode.json first" >&2
    return 1
  }

  temporary=$(mktemp -- "$directory/.opencode.json.XXXXXX")
  # shellcheck disable=SC2064
  trap "rm -f -- '$temporary'" EXIT
  cat > "$temporary"
  [[ "$(sha256sum < "$temporary" | cut -d ' ' -f 1)" == "$expected_sha256" ]] || { echo "shipped OpenCode configuration did not arrive intact" >&2; return 1; }

  if [[ -e "$target" || -L "$target" ]]; then
    [[ -f "$target" && ! -L "$target" ]] || { echo "existing OpenCode configuration is unsafe: $target" >&2; return 1; }
    if cmp -s -- "$temporary" "$target"; then
      echo "headless OpenCode configuration already installed at $target; OpenCode was not restarted"
      return 0
    fi
    # Keep the prior document for review. A hard link never follows a
    # symlink and fails if the backup name exists. OpenCode loads only
    # opencode.json(c), so the backup is inert.
    backup="$target.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
    ln -- "$target" "$backup" || { echo "could not keep the previous OpenCode configuration as $backup" >&2; return 1; }
    echo "kept the previous OpenCode configuration as $backup"
  fi

  chmod 0400 -- "$temporary"
  mv -fT -- "$temporary" "$target"
  echo "installed headless OpenCode configuration at $target; OpenCode was not restarted"
}

if (( EUID == owner )); then
  install_as_owner "$config_home" "$expected_sha256" < "$source_config"
elif (( EUID == 0 )); then
  setpriv=$(command -v setpriv) || { echo "setpriv (util-linux) is required to install as the config home's owner" >&2; exit 1; }
  "$setpriv" --reuid="$owner" --regid="$group" --clear-groups --no-new-privs -- \
    /usr/bin/env -i PATH=/usr/bin:/bin \
    /bin/bash -c "$(declare -f install_as_owner)"'
install_as_owner "$1" "$2"' install-opencode-config "$config_home" "$expected_sha256" < "$source_config"
else
  echo "run as root or as the owner of $config_home (uid $owner)" >&2
  exit 1
fi
