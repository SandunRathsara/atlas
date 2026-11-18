#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture=$(mktemp -d)
cleanup() {
  chmod -R u+w "$fixture" 2>/dev/null || true
  rm -rf -- "$fixture"
}
trap cleanup EXIT

fail() {
  echo "deployment command regression failed: $*" >&2
  exit 1
}

expect_failure() {
  if "$@" >"$fixture/failure.out" 2>"$fixture/failure.err"; then
    fail "command unexpectedly succeeded: $*"
  fi
}

version=9.8.7-beta.6
mkdir -p "$fixture/package/package/bin" "$fixture/bin"
cat > "$fixture/package/package/bin/opencode" <<EOF
#!/usr/bin/env bash
[[ "\${1:-}" == --version ]] && { echo 'opencode v$version'; exit 0; }
exit 1
EOF
chmod 0555 "$fixture/package/package/bin/opencode"
tar --create --gzip --file="$fixture/opencode-cli.tgz" --directory="$fixture/package" package
integrity="sha512-$(openssl dgst -sha512 -binary "$fixture/opencode-cli.tgz" | base64 --wrap=0)"
cat > "$fixture/metadata.json" <<EOF
{"version":"$version","dist":{"integrity":"$integrity","tarball":"https://fixtures.invalid/opencode-cli.tgz"}}
EOF
cat > "$fixture/missing-integrity.json" <<EOF
{"version":"$version","dist":{"tarball":"https://fixtures.invalid/opencode-cli.tgz"}}
EOF
cat > "$fixture/mismatched-integrity.json" <<EOF
{"version":"$version","dist":{"integrity":"sha512-AAAAAAAA","tarball":"https://fixtures.invalid/opencode-cli.tgz"}}
EOF

cat > "$fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=
url=
while (( $# > 0 )); do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --proto) shift 2 ;;
    --fail|--silent|--show-error|--location|--tlsv1.2) shift ;;
    *) url=$1; shift ;;
  esac
done
printf '%s\n' "$url" >> "$ATLAS_TEST_CURL_LOG"
if [[ "$url" == https://fixtures.invalid/opencode-cli.tgz ]]; then
  cp "$ATLAS_TEST_TARBALL" "$output"
else
  cp "$ATLAS_TEST_METADATA" "$output"
fi
EOF
cat > "$fixture/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ATLAS_TEST_SYSTEMCTL_LOG"
exit 99
EOF
chmod 0555 "$fixture/bin/curl" "$fixture/bin/systemctl"
: > "$fixture/curl.log"
: > "$fixture/systemctl.log"

mkdir -p "$fixture/active/1.0.0/bin"
printf '#!/usr/bin/env bash\necho "opencode v1.0.0"\n' > "$fixture/active/1.0.0/bin/opencode"
chmod 0555 "$fixture/active/1.0.0/bin/opencode"
ln -s 1.0.0 "$fixture/active/current"
active_before=$(readlink "$fixture/active/current")

stage="$fixture/staged"
ATLAS_STAGE_CURL_BINARY="$fixture/bin/curl" \
ATLAS_OPENCODE_REGISTRY_URL=https://fixtures.invalid \
ATLAS_TEST_CURL_LOG="$fixture/curl.log" \
ATLAS_TEST_METADATA="$fixture/metadata.json" \
ATLAS_TEST_TARBALL="$fixture/opencode-cli.tgz" \
ATLAS_TEST_SYSTEMCTL_LOG="$fixture/systemctl.log" \
PATH="$fixture/bin:$PATH" \
  "$root/stage-opencode.sh" "$version" "$stage" >/dev/null

[[ -x "$stage/tools/opencode/$version/bin/opencode" ]] || fail "server executable was not staged"
[[ $(find "$stage" -type f | wc -l) -eq 2 ]] || fail "staging included more than the server and manifest"
grep -Fxq "server_version=$version" "$stage/OPENCODE_ARTIFACTS" || fail "manifest omitted the chosen version"
grep -Fxq "registry_integrity=$integrity" "$stage/OPENCODE_ARTIFACTS" || fail "manifest omitted registry integrity"
[[ $(readlink "$fixture/active/current") == "$active_before" ]] || fail "staging changed the active selection"
[[ ! -s "$fixture/systemctl.log" ]] || fail "staging attempted a service lifecycle command"
[[ $(wc -l < "$fixture/curl.log") -eq 2 ]] || fail "staging downloaded unexpected artifacts"
grep -Eq 'client|schema|protocol' "$fixture/curl.log" && fail "staging downloaded an Atlas client package"

expect_failure "$root/stage-opencode.sh" "$fixture/no-version"
expect_failure "$root/stage-opencode.sh" latest "$fixture/latest"
expect_failure env \
  ATLAS_STAGE_CURL_BINARY="$fixture/bin/curl" \
  ATLAS_OPENCODE_REGISTRY_URL=https://fixtures.invalid \
  ATLAS_TEST_CURL_LOG="$fixture/curl.log" \
  ATLAS_TEST_METADATA="$fixture/missing-integrity.json" \
  ATLAS_TEST_TARBALL="$fixture/opencode-cli.tgz" \
  "$root/stage-opencode.sh" "$version" "$fixture/missing-integrity"
expect_failure env \
  ATLAS_STAGE_CURL_BINARY="$fixture/bin/curl" \
  ATLAS_OPENCODE_REGISTRY_URL=https://fixtures.invalid \
  ATLAS_TEST_CURL_LOG="$fixture/curl.log" \
  ATLAS_TEST_METADATA="$fixture/mismatched-integrity.json" \
  ATLAS_TEST_TARBALL="$fixture/opencode-cli.tgz" \
  "$root/stage-opencode.sh" "$version" "$fixture/mismatched-integrity"
[[ ! -e "$fixture/missing-integrity" && ! -e "$fixture/mismatched-integrity" ]] || fail "failed staging published a destination"
[[ $(readlink "$fixture/active/current") == "$active_before" && ! -s "$fixture/systemctl.log" ]] || fail "failed staging changed active OpenCode"

release="$fixture/release"
tools="$fixture/tools/opencode"
mkdir -p "$release/deploy" "$release/node_modules/@opencode/client" "$tools/2.0.0/bin" "$tools/3.0.0/bin"
printf '{"version":"0.0.1-client"}\n' > "$release/node_modules/@opencode/client/package.json"
printf '#!/usr/bin/env bash\necho "opencode v2.0.0"\n' > "$tools/2.0.0/bin/opencode"
printf '#!/usr/bin/env bash\necho "opencode v3.0.0"\n' > "$tools/3.0.0/bin/opencode"
chmod 0555 "$tools/2.0.0/bin/opencode" "$tools/3.0.0/bin/opencode"
ln -s 2.0.0 "$tools/current"
printf 'ATLAS_OPENCODE_BINARY=%s\n' "$tools/current/bin/opencode" > "$release/deploy/pins.env"
preflight=$(ATLAS_RELEASE_ROOT="$release" "$root/check-opencode.sh")
[[ "$preflight" == *'opencode v2.0.0' ]] || fail "preflight did not report the selected executable version"
ln -sfn 3.0.0 "$tools/current"
preflight=$(ATLAS_RELEASE_ROOT="$release" "$root/check-opencode.sh")
[[ "$preflight" == *'opencode v3.0.0' ]] || fail "preflight did not follow current"
ln -sfn missing "$tools/current"
expect_failure env ATLAS_RELEASE_ROOT="$release" "$root/check-opencode.sh"
mkdir -p "$tools/unusable/bin"
printf '#!/usr/bin/env bash\necho unusable\n' > "$tools/unusable/bin/opencode"
chmod 0444 "$tools/unusable/bin/opencode"
ln -sfn unusable "$tools/current"
expect_failure env ATLAS_RELEASE_ROOT="$release" "$root/check-opencode.sh"

mkdir -p "$fixture/wal-release/deploy" "$fixture/recovery/current/checksums" "$fixture/wal-tools/current/bin"
cat > "$fixture/wal-tools/bun" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == --version ]] && { echo '1.3.14'; exit 0; }
[[ "${1:-}" == --eval ]] && { echo '3.51.3'; exit 0; }
exit 1
EOF
# The WAL probe scrubs the environment, so this fake reads its mode from and
# logs to fixture paths baked in here. Its own text embeds exactly one SQLite
# source ID, like a real single-file executable.
wal_source_id='2026-01-02 03:04:05 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
printf 'fixed\n' > "$fixture/wal-mode"
cat > "$fixture/wal-tools/current/bin/opencode" <<EOF
#!/usr/bin/env bash
mode=\$(cat '$fixture/wal-mode')
printf 'BUN_BE_BUN=%s HOME=%s XDG_DATA_HOME=%s PWD=%s ARGS=%s\n' "\${BUN_BE_BUN:-}" "\${HOME:-}" "\${XDG_DATA_HOME:-}" "\$PWD" "\$*" >> '$fixture/opencode.log'
if [[ "\${BUN_BE_BUN:-}" != 1 || "\$mode" == no-bun ]]; then
  [[ "\${1:-}" == --version ]] && { echo 'opencode v88.0.0-test'; exit 0; }
  exit 1
fi
[[ "\${1:-}" == --version ]] && { echo '1.4.4'; exit 0; }
if [[ "\${1:-}" == --eval ]]; then
  [[ "\$mode" == unfixed ]] && echo '3.51.2' || echo '3.51.3'
  echo '$wal_source_id'
  exit 0
fi
exit 1
EOF
chmod 0755 "$fixture/wal-tools/bun" "$fixture/wal-tools/current/bin/opencode"
cat > "$fixture/wal-release/deploy/pins.env" <<EOF
ATLAS_BUN_VERSION=1.3.14
ATLAS_BUN_BINARY=$fixture/wal-tools/bun
ATLAS_OPENCODE_BINARY=$fixture/wal-tools/current/bin/opencode
EOF
printf 'fixture-commit\n' > "$fixture/wal-release/RELEASE_COMMIT"
: > "$fixture/opencode.log"
run_wal() {
  ATLAS_WRITERS_STOPPED=YES \
  ATLAS_RELEASE_ROOT="$fixture/wal-release" \
  ATLAS_RECOVERY_CONFIG_ROOT="$fixture/recovery" \
  XDG_DATA_HOME=/var/lib/atlas/opencode-data \
    "$root/verify-sqlite-wal.sh"
}
wal_record="$fixture/recovery/current/checksums/sqlite-wal-versions"
run_wal >/dev/null
grep -Fxq 'opencode_version=opencode v88.0.0-test' "$wal_record" || fail "WAL record did not use the observed server version"
grep -Fxq 'opencode_sqlite_version=3.51.3' "$wal_record" || fail "WAL record omitted the observed OpenCode SQLite version"
grep -Fxq 'opencode_bun_version=1.4.4' "$wal_record" || fail "WAL record omitted the executable's embedded Bun runtime"
grep -Fxq "opencode_sqlite_source_id=$wal_source_id" "$wal_record" || fail "WAL record omitted the observed SQLite source ID"
grep -Fxq 'wal_reset_fix=verified' "$wal_record" || fail "WAL record did not mark the fix verified"
grep -Eq '^BUN_BE_BUN= .*ARGS=--version$' "$fixture/opencode.log" || fail "WAL verification did not probe the selected executable"
grep -Fq 'BUN_BE_BUN=1 ' "$fixture/opencode.log" || fail "WAL verification did not ask the executable's embedded runtime"
grep -Fq 'ARGS=--eval import { Database } from "bun:sqlite";' "$fixture/opencode.log" || fail "WAL verification did not query the embedded SQLite build"
if grep '^BUN_BE_BUN=1 ' "$fixture/opencode.log" | grep -Eq "HOME=$HOME |XDG_DATA_HOME=/var/lib/atlas|PWD=$PWD "; then
  fail "WAL runtime probe used live OpenCode home, state, or working directory"
fi
cp -p "$wal_record" "$fixture/wal-record.verified"
expect_failure env \
  ATLAS_RELEASE_ROOT="$fixture/wal-release" \
  ATLAS_RECOVERY_CONFIG_ROOT="$fixture/recovery" \
  "$root/verify-sqlite-wal.sh"
printf 'unfixed\n' > "$fixture/wal-mode"
expect_failure run_wal
grep -Fq 'predates the fix' "$fixture/failure.err" || fail "unfixed embedded SQLite was not rejected"
printf 'no-bun\n' > "$fixture/wal-mode"
expect_failure run_wal
grep -Fq 'embedded Bun runtime' "$fixture/failure.err" || fail "an executable without its Bun runtime was not rejected"
printf 'fixed\n' > "$fixture/wal-mode"
printf '# 2026-01-02 03:04:05 %s\n' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >> "$fixture/wal-tools/current/bin/opencode"
expect_failure run_wal
grep -Fq 'exactly the one SQLite build' "$fixture/failure.err" || fail "a second embedded SQLite build was not rejected"
cmp -s "$wal_record" "$fixture/wal-record.verified" || fail "failed WAL verification changed the recorded result"

config_home="$fixture/opencode-config"
mkdir -p "$config_home"
"$root/install-opencode-config.sh" "$config_home" >/dev/null
installed_config="$config_home/opencode/opencode.json"
cmp -s "$root/opencode/opencode.json" "$installed_config" || fail "headless OpenCode configuration was not installed"
[[ "$(stat -c %a "$installed_config")" == 400 && "$(stat -c %a "$config_home/opencode")" == 700 ]] || fail "headless OpenCode configuration has unsafe modes"
"$root/install-opencode-config.sh" "$config_home" | grep -Fq 'already installed' || fail "re-installing the headless configuration was not idempotent"
chmod u+w "$installed_config"
printf '{"operator":"copy"}\n' > "$installed_config"
"$root/install-opencode-config.sh" "$config_home" >/dev/null
cmp -s "$root/opencode/opencode.json" "$installed_config" || fail "headless OpenCode configuration did not replace a stale copy"
replaced=("$installed_config".replaced-*)
[[ ${#replaced[@]} -eq 1 && "$(cat "${replaced[0]}")" == '{"operator":"copy"}' ]] || fail "replacing the OpenCode configuration did not keep the prior copy"
printf '{}\n' > "$config_home/opencode/opencode.jsonc"
expect_failure "$root/install-opencode-config.sh" "$config_home"
rm -f -- "$config_home/opencode/opencode.jsonc"
ln -s "$config_home" "$fixture/opencode-config-link"
expect_failure "$root/install-opencode-config.sh" "$fixture/opencode-config-link"
[[ $(readlink "$fixture/active/current") == "$active_before" && ! -s "$fixture/systemctl.log" ]] || fail "configuration install changed active OpenCode"

mkdir -p "$fixture/release-source"
git -C "$fixture/release-source" init -q
git -C "$fixture/release-source" config user.email fixture@example.invalid
git -C "$fixture/release-source" config user.name Fixture
printf 'fixture\n' > "$fixture/release-source/file"
git -C "$fixture/release-source" add file
git -C "$fixture/release-source" commit -qm fixture
cat > "$fixture/bin/bun" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == --version ]] && { echo '1.3.14'; exit 0; }
exit 0
EOF
chmod 0555 "$fixture/bin/bun"
ATLAS_STAGE_GIT_BINARY=$(command -v git) \
ATLAS_STAGE_BUN_BINARY="$fixture/bin/bun" \
ATLAS_TEST_SYSTEMCTL_LOG="$fixture/systemctl.log" \
PATH="$fixture/bin:$PATH" \
  "$root/stage-release.sh" "$fixture/release-source" "$fixture/staged-release" >/dev/null
[[ -f "$fixture/staged-release/RELEASE_COMMIT" ]] || fail "Atlas release was not staged"
[[ $(readlink "$fixture/active/current") == "$active_before" && ! -s "$fixture/systemctl.log" ]] || fail "Atlas deployment changed active OpenCode"

echo "OpenCode deployment commands verified with isolated fixtures"
