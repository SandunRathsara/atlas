#!/usr/bin/env bash
set -euo pipefail

# Installs Atlas's headless OpenCode configuration into one OpenCode
# XDG_CONFIG_HOME. Never starts, stops, or restarts OpenCode; the server reads
# the file at the latest on its next start.

usage() {
  echo "usage: $0 <opencode-xdg-config-home>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_config="$root/opencode/opencode.json"
config_home=$(realpath -ms -- "$1")

[[ -f "$source_config" && ! -L "$source_config" ]] || { echo "shipped OpenCode configuration is missing" >&2; exit 1; }
jq -e 'type == "object"' "$source_config" >/dev/null || { echo "shipped OpenCode configuration is not a JSON object" >&2; exit 1; }
[[ "$config_home" = /* && "$config_home" != "/" ]] || { echo "OpenCode config home must be a safe absolute path" >&2; exit 1; }
[[ -d "$config_home" && ! -L "$config_home" ]] || { echo "OpenCode config home is missing or unsafe: $config_home" >&2; exit 1; }

# The config home's owner (omega on the host) owns the installed file.
owner=$(stat -c %u "$config_home")
group=$(stat -c %g "$config_home")
directory="$config_home/opencode"
if [[ -e "$directory" || -L "$directory" ]]; then
  [[ -d "$directory" && ! -L "$directory" ]] || { echo "OpenCode config directory is unsafe: $directory" >&2; exit 1; }
else
  install -d -m 0700 -o "$owner" -g "$group" "$directory"
fi

# OpenCode also loads opencode.jsonc from the same directory; two global
# documents would make the effective headless policy ambiguous.
[[ ! -e "$directory/opencode.jsonc" && ! -L "$directory/opencode.jsonc" ]] || {
  echo "refusing to install beside $directory/opencode.jsonc; merge it into deploy/opencode/opencode.json first" >&2
  exit 1
}

target="$directory/opencode.json"
if [[ -e "$target" || -L "$target" ]]; then
  [[ -f "$target" && ! -L "$target" ]] || { echo "existing OpenCode configuration is unsafe: $target" >&2; exit 1; }
  if cmp -s "$source_config" "$target"; then
    echo "headless OpenCode configuration already installed at $target; OpenCode was not restarted"
    exit 0
  fi
  # Keep the prior document for review. OpenCode loads only opencode.json(c).
  backup="$target.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
  [[ ! -e "$backup" && ! -L "$backup" ]] || { echo "backup path already exists: $backup" >&2; exit 1; }
  cp -p -- "$target" "$backup"
  echo "kept the previous OpenCode configuration as $backup"
fi

temporary=$(mktemp "$directory/.opencode.json.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
cat -- "$source_config" > "$temporary"
chown "$owner:$group" "$temporary"
chmod 0400 "$temporary"
mv -f -- "$temporary" "$target"
trap - EXIT
echo "installed headless OpenCode configuration at $target; OpenCode was not restarted"
