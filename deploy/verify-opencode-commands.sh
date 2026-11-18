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
# A caller that is neither root nor the config home's owner is refused before
# any write (root-owned /usr stands in for someone else's config home).
if (( EUID != 0 )); then
  expect_failure "$root/install-opencode-config.sh" /usr
  grep -Fq 'run as root or as the owner' "$fixture/failure.err" || fail "a caller that does not own the config home was not refused"
fi
# Root installing into another user's config home must write only as that
# user. A user namespace gives an unprivileged root plus a distinct owner uid.
if (( EUID != 0 )) && unshare --map-auto --map-root-user true 2>/dev/null; then
  ns_work=$(mktemp -d)
  chmod 0711 "$ns_work"
  cat > "$fixture/ns-root.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root=$1 work=$2
trap 'rm -rf -- "$work/ns"' EXIT
mkdir -m 0711 "$work/ns"
mkdir "$work/ns/home"
printf 'root-only\n' > "$work/ns/root-only"
chmod 0600 "$work/ns/root-only"
chown 1000:1000 "$work/ns/home"
"$root/install-opencode-config.sh" "$work/ns/home" >/dev/null
f="$work/ns/home/opencode/opencode.json"
[[ "$(stat -c '%u:%g %a' "$f")" == "1000:1000 400" && "$(stat -c '%u:%g %a' "$work/ns/home/opencode")" == "1000:1000 700" ]] || { echo "root install did not write as the config home owner"; exit 1; }
cmp -s "$root/opencode/opencode.json" "$f" || { echo "root install changed the shipped configuration"; exit 1; }
"$root/install-opencode-config.sh" "$work/ns/home" | grep -Fq 'already installed' || { echo "root re-install was not idempotent"; exit 1; }
# The owner swaps the installed file for a symlink to a root-only file.
setpriv --reuid=1000 --regid=1000 --clear-groups -- bash -c "rm -f '$f'; ln -s '$work/ns/root-only' '$f'"
if "$root/install-opencode-config.sh" "$work/ns/home" >/dev/null 2>&1; then echo "root install followed an owner symlink"; exit 1; fi
[[ "$(cat "$work/ns/root-only")" == root-only && "$(stat -c '%u %a' "$work/ns/root-only")" == "0 600" ]] || { echo "root install changed a root-only file"; exit 1; }
echo ns-root-ok
EOF
  ns_result=$(unshare --map-auto --map-root-user bash "$fixture/ns-root.sh" "$root" "$ns_work" 2>&1) || true
  rmdir -- "$ns_work" 2>/dev/null || true
  [[ "$ns_result" == ns-root-ok ]] || fail "root install as the config home owner: $ns_result"
else
  echo "skipped the root-to-owner install fixture: unprivileged user namespaces are unavailable" >&2
fi

# The restore scrub removes every saved OpenCode credential from the database,
# including secrets that exist only in the WAL of a live-copied snapshot.
real_bun=$(command -v bun) || fail "bun is required for the credential scrub fixture"
mkdir -p "$fixture/scrub/live" "$fixture/scrub/copy"
cat > "$fixture/scrub/build.ts" <<'EOF'
import { Database } from "bun:sqlite";
import { copyFileSync } from "node:fs";
const [live, copy] = Bun.argv.slice(2);
const db = new Database(`${live}/opencode.db`, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA wal_autocheckpoint = 0");
db.run("CREATE TABLE credential (id text PRIMARY KEY, value text NOT NULL)");
db.run("CREATE TABLE account (id text PRIMARY KEY, access_token text NOT NULL, refresh_token text NOT NULL)");
db.run("CREATE TABLE account_state (id integer PRIMARY KEY, active_account_id text, active_org_id text)");
db.run("CREATE TABLE control_account (id text PRIMARY KEY, access_token text NOT NULL)");
db.run("CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL)");
db.run("CREATE TABLE project (id text PRIMARY KEY)");
db.run("INSERT INTO credential VALUES ('c1', '{\"type\":\"key\",\"key\":\"FAKEKEY-SCRUB\"}'), ('c2', '{\"type\":\"oauth\",\"access\":\"FAKEOAUTH-SCRUB\"}')");
db.run("INSERT INTO account VALUES ('a1', 'FAKEACCESS-SCRUB', 'FAKEREFRESH-SCRUB')");
db.run("INSERT INTO account_state VALUES (1, 'a1', 'FAKEORG-SCRUB')");
db.run("INSERT INTO control_account VALUES ('k1', 'FAKECONTROL-SCRUB')");
db.run("INSERT INTO kv VALUES ('wellknown:config:x', 'FAKEWELLKNOWN-SCRUB'), ('other', 'kept')");
db.run("INSERT INTO project VALUES ('p1')");
// A credential deleted before the snapshot leaves its bytes on free pages.
db.run("INSERT INTO credential VALUES ('c0', ?)", ["FAKEDELETED-SCRUB".repeat(1000)]);
db.run("DELETE FROM credential WHERE id = 'c0'");
for (const suffix of ["", "-wal", "-shm"]) copyFileSync(`${live}/opencode.db${suffix}`, `${copy}/opencode.db${suffix}`);
db.close();
EOF
"$real_bun" "$fixture/scrub/build.ts" "$fixture/scrub/live" "$fixture/scrub/copy"
[[ -s "$fixture/scrub/copy/opencode.db-wal" ]] && LC_ALL=C grep -aqF FAKE "$fixture/scrub/copy/opencode.db-wal" || fail "the scrub fixture did not leave secrets in the WAL"
"$real_bun" "$root/scrub-opencode-credentials.ts" "$fixture/scrub/copy/opencode.db" || fail "the credential scrub failed on a restored database"
! LC_ALL=C grep -alF FAKE "$fixture/scrub/copy"/opencode.db* >/dev/null || fail "the credential scrub left secrets in the database files"
scrubbed=$("$real_bun" --eval '
import { Database } from "bun:sqlite";
const db = new Database(process.argv[1], { readonly: true });
const n = (sql) => db.query(sql).get().n;
console.log([n("SELECT count(*) AS n FROM credential"), n("SELECT count(*) AS n FROM account"), n("SELECT count(*) AS n FROM control_account"),
  n("SELECT count(*) AS n FROM account_state WHERE active_account_id IS NOT NULL OR active_org_id IS NOT NULL"),
  n("SELECT count(*) AS n FROM kv WHERE key LIKE '\''wellknown:%'\''"), n("SELECT count(*) AS n FROM kv WHERE key = '\''other'\''"),
  n("SELECT count(*) AS n FROM project")].join(" "));
' "$fixture/scrub/copy/opencode.db")
[[ "$scrubbed" == "0 0 0 0 0 1 1" ]] || fail "the credential scrub removed the wrong rows: $scrubbed"
"$real_bun" --eval 'import { Database } from "bun:sqlite"; const db = new Database(process.argv[1], { create: true }); db.run("CREATE TABLE project (id text)"); db.close();' "$fixture/scrub/unknown.db"
expect_failure "$real_bun" "$root/scrub-opencode-credentials.ts" "$fixture/scrub/unknown.db"
grep -Fxq 'OpenCode credential scrub failed: the database has no credential table, so its credential store is unknown' "$fixture/failure.err" || fail "the credential scrub accepted a database with an unknown credential store"
expect_failure "$real_bun" "$root/scrub-opencode-credentials.ts" "$fixture/scrub/missing.db"
[[ ! -e "$fixture/scrub/missing.db" ]] || fail "the credential scrub created a missing database"
[[ $(readlink "$fixture/active/current") == "$active_before" && ! -s "$fixture/systemctl.log" ]] || fail "configuration install changed active OpenCode"

echo "OpenCode deployment commands verified with isolated fixtures"
