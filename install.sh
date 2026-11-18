#!/bin/sh
# Atlas installer: downloads one Atlas Release into a new root-only folder,
# checks its SHA-256, and runs `atlas setup` from it. It never lays out
# /opt/atlas itself; setup does. Runs as root only, so nothing another account
# can change is ever run or read by root.
#
#   curl -fsSL https://github.com/SandunRathsara/atlas/releases/latest/download/install.sh | sudo sh
#   curl -fsSL .../install.sh | sudo sh -s -- --answers /root/atlas-answers.json
#   curl -fsSL .../install.sh | sudo sh -s -- --version v1.2.0+build.7
#
# Options: --version <vX.Y.Z+build.N> (or ATLAS_VERSION) pins a Release; every
# other argument is passed to `atlas setup` (see docs/INSTALL.md).
# Needs: root, Linux x86_64 with glibc, curl, sha256sum, coreutils.
# Prompts read /dev/tty, so `curl | sudo sh` works. The whole script is one
# function called on the last line, so a cut-off download runs nothing.
# Test hooks: ATLAS_INSTALL_BASE_URL replaces https://github.com/SandunRathsara/atlas/releases;
# ATLAS_INSTALL_TMP_PARENT replaces /var/tmp (TMPDIR is ignored).

atlas_install() {
  set -eu
  umask 077
  repo_releases=https://github.com/SandunRathsara/atlas/releases
  base=${ATLAS_INSTALL_BASE_URL:-$repo_releases}
  version=${ATLAS_VERSION:-}
  asset=atlas-linux-x64

  say() { printf '%s\n' "$*"; }
  die() { printf 'atlas install: %s\n' "$*" >&2; exit 1; }
  have() { command -v "$1" >/dev/null 2>&1; }

  # Split our options from the ones setup gets (rebuilds "$@" in order).
  count=$#
  while [ "$count" -gt 0 ]; do
    arg=$1; shift; count=$((count - 1))
    case $arg in
      --version)
        [ "$count" -gt 0 ] || die "--version needs a value, like v1.2.0+build.7"
        version=$1; shift; count=$((count - 1)) ;;
      --version=*) version=${arg#*=} ;;
      *) set -- "$@" "$arg" ;;
    esac
  done

  # 1. this host
  for tool in uname id mktemp chmod rm cut tr sed grep sha256sum; do
    have "$tool" || die "$tool is missing. Install coreutils/grep/sed first (apt install coreutils grep sed)."
  done
  if [ "$(id -u)" -ne 0 ]; then
    printf 'atlas install: run this as root. Nothing was downloaded. For example:\n' >&2
    printf '  curl -fsSL %s/latest/download/install.sh | sudo sh -s --' "$repo_releases" >&2
    for arg in "$@"; do printf " '%s'" "$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")" >&2; done
    printf '\n' >&2
    exit 1
  fi
  if ( : </dev/tty ) 2>/dev/null; then
    tty=yes
  else
    tty=no
  fi
  [ "$(uname -s)" = Linux ] || die "Atlas runs only on Linux (this is $(uname -s))."
  [ "$(uname -m)" = x86_64 ] || die "Atlas runs only on x86_64 (this is $(uname -m))."
  if { have ldd && ldd --version 2>&1 | grep -qi musl; } || ls /lib/ld-musl-* >/dev/null 2>&1; then
    die "this system uses musl libc (for example Alpine). Atlas needs glibc: use Debian, Ubuntu, Fedora, or similar."
  fi
  { have getconf && getconf GNU_LIBC_VERSION >/dev/null 2>&1; } || die "glibc was not found. Atlas needs a glibc Linux (Debian, Ubuntu, Fedora, ...)."
  # curl only: --proto/--proto-redir keep every hop, redirects included, on
  # HTTPS. (wget cannot refuse an https -> http redirect.) Only the test hook
  # may use other schemes.
  have curl || die "curl is needed (apt install curl)."
  if [ -n "${ATLAS_INSTALL_BASE_URL:-}" ]; then
    fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
  else
    fetch() { curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 3 -o "$2" "$1"; }
  fi

  # 2. which Release
  if [ -n "$version" ]; then
    case $version in v*) ;; *) version=v$version ;; esac
    printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+\+build\.[0-9]+$' ||
      die "--version must look like v1.2.0+build.7 (got $version)."
    url=$base/download/$(printf '%s' "$version" | sed 's/+/%2B/g')
    say "Atlas installer: Release $version"
  else
    url=$base/latest/download
    say "Atlas installer: latest Release"
  fi

  # 3. download and check, in a new root-only folder on disk (not TMPDIR)
  tmp_parent=${ATLAS_INSTALL_TMP_PARENT:-/var/tmp}
  tmp=$(mktemp -d "$tmp_parent/atlas-install.XXXXXX") || die "could not make a folder in $tmp_parent."
  chmod 0700 "$tmp"
  keep_tmp=no
  trap '[ "$keep_tmp" = yes ] || rm -rf -- "$tmp"' EXIT
  trap 'exit 130' INT TERM
  for name in "$asset" "$asset.sha256" atlas-release.json; do
    fetch "$url/$name" "$tmp/$name" || die "download failed: $url/$name"
  done
  expected=$(cut -d' ' -f1 <"$tmp/$asset.sha256" | tr -d '\r\n')
  printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || die "$asset.sha256 is not a SHA-256 line."
  actual=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
  [ "$actual" = "$expected" ] || die "SHA-256 mismatch for $asset (expected $expected, got $actual). Nothing was installed."
  grep -q "\"$expected\"" "$tmp/atlas-release.json" || die "atlas-release.json does not describe this binary. Nothing was installed."
  chmod 0500 "$tmp/$asset"
  say "Downloaded and verified $asset ($actual)."

  # 4. run setup (it copies the Release again and re-checks it before installing)
  if [ "$tty" = no ] && [ $# -eq 0 ]; then
    # Nothing to answer the questions with: keep the root-only folder and say what to run.
    keep_tmp=yes
    say "No terminal to ask the setup questions on, and no answers were given."
    say "The verified files are in $tmp (root only). Next, run as root:"
    say "  $tmp/$asset setup --source-dir $tmp"
    say "or pass answers: $tmp/$asset setup --source-dir $tmp --answers <file.json>"
    exit 0
  fi
  status=0
  if [ "$tty" = yes ]; then
    "$tmp/$asset" setup --source-dir "$tmp" "$@" </dev/tty || status=$?
  else
    "$tmp/$asset" setup --source-dir "$tmp" "$@" </dev/null || status=$?
  fi
  exit "$status"
}

atlas_install "$@"
