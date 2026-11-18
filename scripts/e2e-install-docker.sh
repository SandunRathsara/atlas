#!/usr/bin/env bash
# End-to-end install test in throwaway systemd containers (Docker, privileged).
#
# Usage: bash scripts/e2e-install-docker.sh [ubuntu:24.04] [debian:12]   (default: both)
#        bash scripts/e2e-install-docker.sh --published [tag] [distro…]
#        KEEP=1 keeps the containers and images for debugging.
#
# --published installs a PUBLISHED Release from github.com exactly as the docs
# say (no fixture server, no ATLAS_INSTALL_BASE_URL); tag defaults to latest.
# It needs the internet and is never run by default or in CI. Per distro:
# non-root refusal; no-terminal run keeps the files and its printed command
# works (dry run); `… | sudo sh -s -- --answers … --create-user` from an admin
# account; /health tag + gitSha (EXPECT_SHA, default: the tag's commit on
# GitHub), /login, `atlas version`, the docs' owner/mode table; the app's
# release check against the GitHub API ("up to date"); the root updater asked
# over its socket to stage the installed tag fetches metadata from GitHub and
# refuses it; a re-run with ATLAS_VERSION through sudo; then a second
# container installs the pinned `--version <tag>` piped to sh as root.
#
# Per distro (systemd as PID 1, stock apt git/gh, no Bun, non-root sudo user):
#   0. install.sh without root is refused before any download; `atlas setup`
#      run as root from a folder the sudo user owns is refused;
#   1. fresh: the real `curl … install.sh | sudo sh -s -- --answers …
#      --create-user` (served from file://, so curl decodes %2B like a web
#      server) with a throwaway PEM; asserts the dedicated `atlas` account,
#      units active, /health identity, /login page, `atlas version` on PATH,
#      root-owned read-only Release folders, config/secret owners and modes, the
#      root-only download folder removed; the root recovery-status writer does
#      not follow a link the service user planted;
#   2. update: install.sh --version <build.2> (re-run of setup) moves current to
#      build.2, keeps the token, and /health reports build.2;
#   3. adopt: a fresh container with the older layout (Bun units from commit
#      432fe69, a stand-in Bun that only sleeps, old env and data). First a
#      failed adopt (a drop-in blocks the new Release) must restore everything,
#      /etc/atlas owners and modes included; then the real adopt;
#      data and secrets stay byte-identical (github.env by value), secrets
#      move to root:<group> 0640, the backup holds the old units.
# Not covered: the updater's own GitHub download (needs github.com), Tailscale.
# Changes nothing on this host besides Docker; release files go to ~/.cache.
# shellcheck disable=SC2016 # single-quoted commands expand inside the container
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
published=""
if [[ ${1:-} == --published ]]; then
  shift
  published=latest
  if [[ ${1:-} == v* ]]; then published=$1; shift; fi
fi
distros=("$@")
[[ ${#distros[@]} -gt 0 ]] || distros=(ubuntu:24.04 debian:12)
work=${XDG_CACHE_HOME:-$HOME/.cache}/atlas-e2e-install
containers=()
images=()
cleanup() {
  if [[ ${KEEP:-0} != 1 ]]; then
    for container in "${containers[@]}"; do docker rm -f "$container" >/dev/null 2>&1 || true; done
    for image in "${images[@]}"; do docker rmi -f "$image" >/dev/null 2>&1 || true; done
    chmod -R u+w "$work" 2>/dev/null || true
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }

# ---------- two Releases (build.1, build.2) from this checkout ----------
rm -rf -- "$work"
mkdir -p "$work/releases/latest/download"
if [[ -z $published ]]; then
sha=$(git -C "$root" rev-parse HEAD)
old_install=$root/scripts/fixtures/old-install-432fe69
tag1=v0.0.1+build.1
tag2=v0.0.1+build.2
make_release() {
  local tag=$1 out=$2
  mkdir -p "$out"
  bun "$root/scripts/build-binary.ts" --out "$work/build" --tag "$tag" --sha "$sha" >/dev/null
  mv "$work/build/atlas" "$out/atlas-linux-x64"
  (cd "$out" && sha256sum atlas-linux-x64 >atlas-linux-x64.sha256)
  (cd "$root" && bun -e '
    const { createReleaseMetadata } = await import("./src/release.ts");
    const client = (await Bun.file("node_modules/@opencode/client/package.json").json()).version;
    const [tag, sha, out] = process.argv.slice(1);
    const bytes = await Bun.file(`${out}/atlas-linux-x64`).bytes();
    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    await Bun.write(`${out}/atlas-release.json`, JSON.stringify(createReleaseMetadata(tag, sha, { sha256: digest, size: bytes.length }, client), null, 2));
  ' "$tag" "$sha" "$out")
  cp "$root/install.sh" "$out/install.sh"
}
echo "building $tag1 and $tag2 binaries"
make_release "$tag1" "$work/releases/latest/download"
make_release "$tag2" "$work/releases/download/$tag2"
rm -rf -- "$work/build"
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$work/app.pem" 2>/dev/null
chmod 0644 "$work/app.pem"
cat >"$work/answers.json" <<'EOF'
{ "organization": "acme-e2e", "appId": "12345", "installationId": "67890",
  "privateKeyPath": "/srv/fixture/app.pem", "origin": "https://atlas.e2e.test", "tailscale": "ask" }
EOF

# ---------- container helpers ----------
image_for() {
  local distro=$1 image="atlas-e2e-${1//[:.]/-}:local"
  docker build -q -t "$image" - >/dev/null <<EOF
FROM $distro
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus curl ca-certificates sudo git gh util-linux socat \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -s /bin/bash alice && echo 'alice ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/alice \
 && useradd -m -s /bin/bash omega
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
EOF
  echo "$image"
}
start() {
  local image=$1 name=$2
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    --tmpfs /run --tmpfs /run/lock -v "$work/releases:/srv/releases:ro" -v "$work:/srv/fixture:ro" "$image" >/dev/null
  containers+=("$name")
  for _ in $(seq 60); do
    state=$(docker exec "$name" systemctl is-system-running 2>/dev/null || true)
    [[ $state == running || $state == degraded ]] && return 0
    sleep 1
  done
  fail "$name: systemd did not boot ($state)"
}
in_root() { docker exec "$container" bash -c "$1"; }
as_alice() { docker exec -u alice -w /home/alice "$container" bash -c "$1"; }
install_cmd='curl -fsSL file:///srv/releases/latest/download/install.sh | sudo ATLAS_INSTALL_BASE_URL=file:///srv/releases sh -s --'
user_install_cmd='curl -fsSL file:///srv/releases/latest/download/install.sh | ATLAS_INSTALL_BASE_URL=file:///srv/releases sh -s --'
health_tag() { in_root '. /etc/atlas/atlas.env; curl -fsS -H "Authorization: Bearer $ATLAS_SHARED_TOKEN" http://127.0.0.1:3000/health' | grep -o '"tag":"[^"]*"' | head -1; }
assert_running() {
  local tag=$1
  for unit in atlas.service atlas-credentials.service atlas-updater.service; do
    in_root "systemctl is-active --quiet $unit" || { in_root "systemctl status $unit --no-pager -n 30" || true; fail "$unit not active"; }
  done
  pass "units active"
  [[ $(health_tag) == "\"tag\":\"$tag\"" ]] || fail "/health does not report $tag: $(health_tag)"
  pass "/health reports $tag"
  in_root 'curl -fsS http://127.0.0.1:3000/login' | grep -qi 'sign' || fail "/login is not the sign-in page"
  pass "/login sign-in page"
  [[ $(as_alice 'atlas version') == *"$tag"* ]] || fail "atlas version on PATH: $(as_alice 'atlas version')"
  pass "atlas version on PATH"
  in_root "stat -c '%U %a %n' /opt/atlas /opt/atlas/releases /opt/atlas/releases/* /opt/atlas/releases/*/atlas /opt/atlas/services/releases/*" >"$work/stat.txt"
  ! grep -Ev '^root (755|555) ' "$work/stat.txt" | grep -q . || { cat "$work/stat.txt"; fail "release folders not root-owned read-only"; }
  pass "release folders root-owned (755/555)"
}

if [[ -n $published ]]; then
  repo=https://github.com/SandunRathsara/atlas
  if [[ $published == latest ]]; then
    landing=$(curl -fsSL --proto '=https' -o /dev/null -w '%{url_effective}' "$repo/releases/latest")
    published=${landing##*/tag/}
    published=${published//%2B/+}
  fi
  [[ $published =~ ^v[0-9]+\.[0-9]+\.[0-9]+\+build\.[0-9]+$ ]] || fail "not a Release tag: $published"
  expect_sha=${EXPECT_SHA:-$(git ls-remote "$repo.git" "refs/tags/$published^{}" "refs/tags/$published" | head -1 | cut -f1)}
  [[ $expect_sha =~ ^[0-9a-f]{40}$ ]] || fail "could not find the commit of $published on GitHub"
  echo "published Release $published ($expect_sha)"
  url="$repo/releases/latest/download/install.sh"
  answers=/srv/fixture/answers.json
  pub_identity() {
    local health
    health=$(in_root '. /etc/atlas/atlas.env; curl -fsS -H "Authorization: Bearer $ATLAS_SHARED_TOKEN" http://127.0.0.1:3000/health')
    [[ $health == *"\"tag\":\"$published\""* && $health == *"\"gitSha\":\"$expect_sha\""* ]] || fail "/health identity: $health"
    pass "/health reports $published ($expect_sha)"
  }
  pub_installed() {
    local unit
    for unit in atlas.service atlas-credentials.service atlas-updater.service; do
      in_root "systemctl is-active --quiet $unit" || { in_root "systemctl status $unit --no-pager -n 30" || true; fail "$unit not active"; }
    done
    pass "units active"
    pub_identity
    in_root 'curl -fsS http://127.0.0.1:3000/login' | grep -qi 'sign' || fail "/login is not the sign-in page"
    pass "/login sign-in page"
    [[ $(in_root 'atlas version') == "atlas $published ($expect_sha)" ]] || fail "atlas version on PATH: $(in_root 'atlas version')"
    pass "atlas version on PATH: $published ($expect_sha)"
    for unit in atlas.service atlas-credentials.service; do
      [[ $(in_root "stat -c %U /proc/\$(systemctl show -p MainPID --value $unit)") == atlas ]] || fail "$unit does not run as the atlas account"
    done
    [[ $(in_root 'getent passwd atlas | cut -d: -f6,7') =~ ^/var/lib/atlas/home:/(usr/)?s?bin/nologin$ ]] || fail "atlas account: $(in_root 'getent passwd atlas')"
    pass "runs as the dedicated atlas account"
    # docs/INSTALL.md "Files setup writes"
    local paths=(/opt/atlas "/opt/atlas/releases/atlas-$published" /etc/atlas /etc/atlas/atlas.env /etc/atlas/github.env /etc/atlas/github-app.pem
      /etc/atlas/supplier.key /etc/atlas/updater.key /var/lib/atlas /var/lib/atlas-updater /etc/systemd/system/atlas.service
      /etc/systemd/system/atlas-credentials.service /etc/systemd/system/atlas-updater.service /etc/systemd/system/opencode.service)
    [[ $(in_root "stat -c '%U:%G %a' ${paths[*]}" | tr '\n' ' ') == \
      "root:root 755 root:root 555 root:atlas 750 root:root 600 root:atlas 640 root:atlas 640 root:atlas 640 root:atlas 640 atlas:atlas 700 root:atlas 700 root:root 644 root:root 644 root:root 644 root:root 644 " ]] ||
      fail "owners/modes differ from docs/INSTALL.md: $(in_root "stat -c '%n %U:%G %a' ${paths[*]}")"
    in_root 'find /var/lib/atlas -mindepth 1 -maxdepth 1 -type d ! -user atlas -o -mindepth 1 -maxdepth 1 -type d ! -perm 700' | grep . && fail "data folders not atlas 0700"
    [[ $(in_root 'readlink /usr/local/bin/atlas') == /opt/atlas/current/atlas ]] || fail "/usr/local/bin/atlas link"
    pass "owners and modes match docs/INSTALL.md"
    in_root 'ls /var/tmp /tmp | grep -q atlas-install' && fail "install.sh left its download folder"
    return 0
  }

  for distro in "${distros[@]}"; do
    echo "== $distro (published $published)"
    image=$(image_for "$distro")
    images+=("$image")

    # A: an admin account with sudo, the latest one-liner
    container="atlas-e2e-pub-${distro//[:.]/-}"
    start "$image" "$container"
    echo "  $(in_root 'echo "git $(git --version | cut -d" " -f3), gh $(gh --version | head -1 | cut -d" " -f3)"'); bun: $(in_root 'command -v bun || echo none')"
    # 4. non-root
    if as_alice "curl -fsSL $url | sh -s -- --answers $answers --create-user" >"$work/user.log" 2>&1; then cat "$work/user.log"; fail "ran without root"; fi
    { grep -q 'Nothing was downloaded' "$work/user.log" && grep -qF "$url | sudo sh -s -- '--answers' '$answers' '--create-user'" "$work/user.log"; } ||
      { cat "$work/user.log"; fail "non-root refusal text"; }
    in_root 'find / -xdev \( -name "atlas-linux-x64*" -o -name "atlas-install.*" \) -print 2>/dev/null' | grep . && fail "non-root run downloaded something"
    pass "non-root: refused, sudo command printed, nothing downloaded"
    # docs: no terminal and no options keeps the verified files and prints the setup command
    as_alice "curl -fsSL $url | sudo sh" >"$work/notty.log" 2>&1 || true
    keep=$(grep -o '/var/tmp/atlas-install\.[A-Za-z0-9]*/atlas-linux-x64 setup --source-dir /var/tmp/atlas-install\.[A-Za-z0-9]*' "$work/notty.log" | head -1)
    [[ -n $keep ]] || { cat "$work/notty.log"; fail "no-terminal run did not print the setup command"; }
    in_root "$keep --answers $answers --create-user --dry-run" >"$work/dry.log" 2>&1 || { cat "$work/dry.log"; fail "printed setup command (dry run) failed"; }
    in_root 'test ! -e /etc/atlas && ! id atlas >/dev/null 2>&1' || fail "dry run changed the host"
    in_root "rm -rf -- '${keep##* }'"
    pass "no terminal: verified files kept, printed setup command works (dry run)"
    # 1. the documented one-liner through real sudo
    as_alice "curl -fsSL $url | sudo sh -s -- --answers $answers --create-user" >"$work/fresh.log" 2>&1 || { cat "$work/fresh.log"; fail "install failed"; }
    grep -q 'Downloaded and verified' "$work/fresh.log" || fail "install.sh did not verify the download"
    grep -q 'Sign-in token (shown once):' "$work/fresh.log" || fail "token not shown"
    grep -q 'Runs as:  atlas (new system account)' "$work/fresh.log" || fail "service user not reported"
    pass "curl … | sudo sh -s -- --answers … --create-user (from github.com)"
    pub_installed
    # 3a. the app's release check (what Settings → Updates → Check does), against the GitHub API
    in_root '. /etc/atlas/atlas.env; curl -fsS -o /dev/null -X POST -H "Authorization: Bearer $ATLAS_SHARED_TOKEN" -H "HX-Request: true" http://127.0.0.1:3000/updates/check' ||
      fail "POST /updates/check"
    card=""
    for _ in $(seq 60); do
      card=$(in_root '. /etc/atlas/atlas.env; curl -fsS -H "Authorization: Bearer $ATLAS_SHARED_TOKEN" -H "HX-Request: true" http://127.0.0.1:3000/updates/status')
      [[ $card == *"Atlas is up to date"* || $card == *"Couldn"*"t check for updates"* || $card == *" is available"* ]] && break
      sleep 1
    done
    [[ $card == *"Atlas is up to date"* ]] || { echo "$card" | sed 's/<[^>]*>/ /g' | tr -s ' \n' ' ' | head -c 1500; echo; fail "release check did not conclude 'up to date'"; }
    pass "app release check via api.github.com: up to date at $published"
    # 3b. the root updater, asked over its socket like the app, fetches the metadata itself and refuses a non-newer tag
    in_root 'systemctl set-property --runtime atlas-updater.service IPAccounting=yes'
    bytes() { in_root 'systemctl show -p IPIngressBytes --value atlas-updater.service'; }
    # ignoreeof: a half-closed request makes the updater close before an async reply.
    in_root "curl -fsSL --proto '=https' '$repo/releases/download/${published//+/%2B}/atlas-release.json'" | grep -qF "\"tag\": \"$published\"" ||
      fail "the metadata the updater fetches is not on GitHub"
    stage() {
      in_root "key=\$(tr -d '\\n' </etc/atlas/updater.key); printf '{\"operation\":\"%s\",\"tag\":\"%s\",\"key\":\"%s\"}\\n' stage '$1' \"\$key\" | timeout 90 socat -t 90 -,ignoreeof UNIX-CONNECT:/run/atlas-updater/updater.sock"
    }
    status=$(in_root "key=\$(tr -d '\\n' </etc/atlas/updater.key); printf '{\"operation\":\"status\",\"key\":\"%s\"}\\n' \"\$key\" | timeout 30 socat -t 30 -,ignoreeof UNIX-CONNECT:/run/atlas-updater/updater.sock")
    [[ $status == *'"ok":true'* && $status == *'"state":"idle"'* ]] || fail "updater status over its socket: $status"
    before=$(bytes)
    reply=$(stage "$published")
    after=$(bytes)
    echo "    updater stage $published -> $reply (received $((after - before)) bytes)"
    [[ $reply == *'"ok":false'* ]] || fail "updater accepted the installed tag: $reply"
    (( after - before > 1000 )) || fail "updater did not fetch anything from GitHub ($before -> $after bytes)"
    status=$(in_root "key=\$(tr -d '\\n' </etc/atlas/updater.key); printf '{\"operation\":\"status\",\"key\":\"%s\"}\\n' \"\$key\" | timeout 30 socat -t 30 -,ignoreeof UNIX-CONNECT:/run/atlas-updater/updater.sock")
    [[ $status == *'"state":"idle"'* && $status != *'"stagedPath":"/'* ]] || fail "updater state changed: $status"
    journal=$(in_root 'journalctl --namespace=atlas -u atlas-updater.service --no-pager -o cat' || true)
    echo "    updater journal: $(echo "$journal" | tail -3 | tr '\n' '|')"
    if [[ $journal == *"not newer than the active $published"* ]]; then pass "root updater fetched $published metadata from GitHub and refused it: not newer"
    else pass "root updater fetched from GitHub (${after}B in) and refused $published; reason not logged (see report)"; fi
    # 5. docs walk: re-run with ATLAS_VERSION through sudo, help, status/journal commands, sign-in paths, rollback path
    token=$(in_root 'grep ^ATLAS_SHARED_TOKEN= /etc/atlas/atlas.env')
    as_alice "curl -fsSL $url | sudo ATLAS_VERSION='$published' sh -s -- --tailscale no" >"$work/rerun.log" 2>&1 || { cat "$work/rerun.log"; fail "re-run with ATLAS_VERSION failed"; }
    grep -q 'Sign-in token: unchanged' "$work/rerun.log" || fail "re-run re-showed the token"
    [[ $(in_root 'grep ^ATLAS_SHARED_TOKEN= /etc/atlas/atlas.env') == "$token" ]] || fail "re-run changed the token"
    pub_identity
    pass "docs: re-run with ATLAS_VERSION through sudo keeps the token"
    in_root 'atlas setup --help' | grep -q -- '--health-timeout' || fail "atlas setup --help"
    in_root 'systemctl status atlas atlas-credentials atlas-updater --no-pager >/dev/null' || fail "documented systemctl status"
    in_root 'journalctl --namespace=atlas -u atlas.service -n 5 --no-pager' | grep -q . || fail "documented journalctl --namespace=atlas shows nothing"
    in_root 'sudo -u atlas env HOME=/var/lib/atlas/home XDG_CONFIG_HOME=/var/lib/atlas/opencode-config XDG_DATA_HOME=/var/lib/atlas/opencode-data XDG_STATE_HOME=/var/lib/atlas/opencode-state XDG_CACHE_HOME=/var/lib/atlas/opencode-cache sh -c "test -w \$HOME && test -d \$XDG_CONFIG_HOME"' ||
      fail "OpenCode sign-in paths from the docs do not exist for atlas"
    in_root "test -d /opt/atlas/releases/atlas-$published && grep -Eq '\"codeOnlyCompatible\": ?true' /opt/atlas/releases/atlas-$published/RELEASE_METADATA.json" || fail "rollback path or metadata from the docs missing"
    pass "docs: setup --help, status/journal commands, OpenCode sign-in paths, rollback folder + metadata"
    docker rm -f "$container" >/dev/null

    # B: pinned --version, piped to sh as root (no sudo)
    container="atlas-e2e-pubpin-${distro//[:.]/-}"
    start "$image" "$container"
    in_root "curl -fsSL $url | sh -s -- --version '$published' --answers $answers --create-user" >"$work/pinned.log" 2>&1 || { cat "$work/pinned.log"; fail "pinned install as root failed"; }
    grep -q "Downloaded and verified" "$work/pinned.log" || fail "pinned: download not verified"
    pass "curl … | sh -s -- --version $published (as root, %2B URL against github.com)"
    pub_installed
    docker rm -f "$container" >/dev/null
  done
  echo "e2e published install: all checks passed ($published on ${distros[*]})"
  exit 0
fi

for distro in "${distros[@]}"; do
  echo "== $distro"
  image=$(image_for "$distro")
  images+=("$image")
  in_root_versions() { in_root 'echo "git $(git --version | cut -d" " -f3), gh $(gh --version | head -1 | cut -d" " -f3), systemd $(systemctl --version | head -1 | cut -d" " -f2)"'; }

  container="atlas-e2e-fresh-${distro//[:.]/-}"
  start "$image" "$container"
  echo "  $(in_root_versions); bun: $(in_root 'command -v bun || echo none')"

  # 0. refusals
  if as_alice "$user_install_cmd --answers /srv/fixture/answers.json" >"$work/user.log" 2>&1; then cat "$work/user.log"; fail "install.sh ran without root"; fi
  { grep -q 'run this as root. Nothing was downloaded' "$work/user.log" && grep -q '| sudo sh -s --' "$work/user.log"; } || { cat "$work/user.log"; fail "non-root refusal text"; }
  in_root 'ls /var/tmp | grep -q atlas-install' && fail "non-root run left a download folder"
  pass "install.sh without root refused before download"
  as_alice 'mkdir -p ~/rel && cp /srv/releases/latest/download/atlas-* ~/rel/'
  if as_alice "sudo ~/rel/atlas-linux-x64 setup --source-dir ~/rel --answers /srv/fixture/answers.json --create-user" >"$work/source.log" 2>&1; then
    cat "$work/source.log"; fail "setup accepted a source folder alice owns"
  fi
  grep -q 'must be owned by root' "$work/source.log" || { cat "$work/source.log"; fail "unsafe source refusal text"; }
  in_root 'test ! -e /etc/atlas && test ! -e /opt/atlas && ! id atlas >/dev/null 2>&1' || fail "refused setup changed the host"
  pass "setup refuses a source folder the sudo user owns"

  # 1. fresh install
  as_alice "$install_cmd --answers /srv/fixture/answers.json --create-user" >"$work/fresh.log" 2>&1 || { cat "$work/fresh.log"; fail "fresh install failed"; }
  grep -q 'Downloaded and verified' "$work/fresh.log" || fail "install.sh did not verify the download"
  grep -q 'Tailscale is not installed; skipping' "$work/fresh.log" || fail "Tailscale skip line missing"
  grep -q 'OpenCode not found' "$work/fresh.log" || fail "missing-OpenCode warning missing"
  grep -q 'Sign-in token (shown once):' "$work/fresh.log" || fail "token not shown"
  grep -q 'Runs as:  atlas (new system account)' "$work/fresh.log" || fail "service user not reported"
  pass "fresh install via curl | sudo sh"
  [[ $(in_root 'getent passwd atlas | cut -d: -f3,6,7') =~ ^[0-9]+:/var/lib/atlas/home:/(usr/)?s?bin/nologin$ ]] || fail "atlas account: $(in_root 'getent passwd atlas')"
  (( $(in_root 'id -u atlas') < 1000 )) && [[ $(in_root 'id -nG atlas') == atlas ]] || fail "atlas is not a plain system account: $(in_root 'id atlas')"
  in_root 'grep -qx User=atlas /etc/systemd/system/atlas.service' || fail "units do not run as atlas"
  pass "dedicated system account atlas (nologin, own group)"
  assert_running "$tag1"
  modes=(/etc/atlas /etc/atlas/atlas.env /etc/atlas/github.env /etc/atlas/github-app.pem /etc/atlas/supplier.key /etc/atlas/updater.key
    /opt/atlas /var/lib/atlas /var/lib/atlas/home /var/lib/atlas/sessions /var/lib/atlas-updater)
  [[ $(in_root "stat -c '%U:%G %a' ${modes[*]}" | tr '\n' ' ') == \
    "root:atlas 750 root:root 600 root:atlas 640 root:atlas 640 root:atlas 640 root:atlas 640 root:root 755 atlas:atlas 700 atlas:atlas 700 atlas:atlas 700 root:atlas 700 " ]] ||
    fail "config modes: $(in_root "stat -c '%n %U:%G %a' ${modes[*]}")"
  pass "config, data, and updater-state owners and modes"
  in_root 'ls /var/tmp /tmp | grep -q atlas-install' && fail "install.sh left its download folder"
  # Root recovery-status writer vs. a link planted by the service user.
  docker cp "$root/deploy/lib/recovery-status.sh" "$container:/root/recovery-status.sh"
  in_root 'set -e; cp /etc/shadow /root/shadow.before
    sudo -u atlas ln -s /etc/shadow /var/lib/atlas/recovery-status
    ATLAS_RECOVERY_STATUS_PATH=/var/lib/atlas/recovery-status ATLAS_RECOVERY_STATUS_LOCK_PATH=/run/lock/atlas-e2e.lock \
      bash -c "set -euo pipefail; source /root/recovery-status.sh; atlas_status_write space 2026-11-18T10:00:00Z healthy 123 5 none"
    cmp -s /etc/shadow /root/shadow.before
    test -f /var/lib/atlas/recovery-status && test ! -L /var/lib/atlas/recovery-status
    test "$(stat -c %U /var/lib/atlas/recovery-status)" = atlas
    grep -qx space_state=healthy /var/lib/atlas/recovery-status' || fail "root status write followed a planted link"
  pass "root status write runs as the folder owner, ignores planted link"
  in_root 'set -e; lib=/root/recovery-status.sh
    install -d -m 0755 /srv/status && ln -s /srv/status /srv/status-link
    if ATLAS_RECOVERY_STATUS_PATH=/srv/status-link/recovery-status ATLAS_RECOVERY_STATUS_LOCK_PATH=/run/lock/atlas-e2e.lock \
      bash -c "source $lib; atlas_status_write space 2026-11-18T10:00:00Z healthy 1 5 none"; then exit 1; fi
    test ! -e /srv/status/recovery-status
    install -d -m 0777 /srv/open && install -d -m 0755 /srv/open/status
    if ATLAS_RECOVERY_STATUS_PATH=/srv/open/status/recovery-status ATLAS_RECOVERY_STATUS_LOCK_PATH=/run/lock/atlas-e2e.lock \
      bash -c "source $lib; atlas_status_write space 2026-11-18T10:00:00Z healthy 1 5 none"; then exit 1; fi
    rm -f /var/lib/atlas/recovery-status && sudo -u atlas mkfifo /var/lib/atlas/recovery-status
    sudo -u atlas mkfifo /var/lib/atlas/fifo && sudo -u atlas ln -s /etc/shadow /var/lib/atlas/shadow-link
    start=$SECONDS
    ATLAS_RECOVERY_STATUS_PATH=/var/lib/atlas/recovery-status ATLAS_RECOVERY_STATUS_LOCK_PATH=/run/lock/atlas-e2e.lock \
      timeout 60 bash -c "source $lib; atlas_status_write space 2026-11-18T10:00:00Z healthy 1 5 none"
    test -f /var/lib/atlas/recovery-status && test ! -p /var/lib/atlas/recovery-status
    if timeout 60 bash -c "source $lib; atlas_read_regular /var/lib/atlas/fifo"; then exit 1; fi
    if timeout 60 bash -c "source $lib; atlas_read_regular /var/lib/atlas/shadow-link"; then exit 1; fi
    (( SECONDS - start < 30 ))
    rm -f /var/lib/atlas/fifo /var/lib/atlas/shadow-link' || fail "root status/read hardening"
  pass "root refuses symlinked or open status folders; FIFOs and links cannot hang or redirect reads"
  token=$(in_root 'grep ^ATLAS_SHARED_TOKEN= /etc/atlas/atlas.env')

  # 2. update to build.2 by pinned install (setup re-run)
  as_alice "$install_cmd --version '$tag2' --tailscale no" >"$work/update.log" 2>&1 || { cat "$work/update.log"; fail "update failed"; }
  assert_running "$tag2"
  [[ $(in_root 'readlink /opt/atlas/current') == "/opt/atlas/releases/atlas-$tag2" ]] || fail "current not at $tag2"
  [[ $(in_root 'grep ^ATLAS_SHARED_TOKEN= /etc/atlas/atlas.env') == "$token" ]] || fail "update changed the token"
  grep -q 'Sign-in token: unchanged' "$work/update.log" || fail "update re-showed the token"
  pass "update to $tag2 keeps the token"
  docker rm -f "$container" >/dev/null

  # 3. adopt the older (Bun + source tree) layout
  container="atlas-e2e-adopt-${distro//[:.]/-}"
  start "$image" "$container"
  for unit in atlas atlas-credentials atlas-updater opencode atlas-snapshot atlas-space-check; do
    for kind in service timer; do
      [[ -f $old_install/$unit.$kind ]] || continue
      docker cp "$old_install/$unit.$kind" "$container:/etc/systemd/system/$unit.$kind"
      in_root "chown root:root /etc/systemd/system/$unit.$kind && chmod 0644 /etc/systemd/system/$unit.$kind"
    done
  done
  sed \
    -e 's/^ATLAS_SHARED_TOKEN=.*/ATLAS_SHARED_TOKEN=old-shared-token-0123456789abcdefghij/' \
    -e 's/^ATLAS_GITHUB_WEBHOOK_SECRET=.*/ATLAS_GITHUB_WEBHOOK_SECRET=old-webhook-secret-0123456789/' \
    -e 's/^ATLAS_ORIGIN=.*/ATLAS_ORIGIN=https:\/\/atlas.e2e.test/' "$old_install/atlas.env.example" >"$work/old-atlas.env"
  sed 's/your-organization/acme-e2e/' "$old_install/github.env.example" >"$work/old-github.env"
  docker cp "$work/old-atlas.env" "$container:/etc/atlas-old.env"
  docker cp "$work/old-github.env" "$container:/etc/github-old.env"
  in_root '
    set -e
    install -d -m 0750 -o root -g omega /etc/atlas
    install -m 0600 /etc/atlas-old.env /etc/atlas/atlas.env && rm /etc/atlas-old.env
    install -m 0600 -o omega -g omega /etc/github-old.env /etc/atlas/github.env && rm /etc/github-old.env
    install -m 0600 -o omega -g omega /srv/fixture/app.pem /etc/atlas/github-app.pem
    head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" >/etc/atlas/supplier.key; chown omega:omega /etc/atlas/supplier.key; chmod 600 /etc/atlas/supplier.key
    head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" >/etc/atlas/updater.key; chown root:omega /etc/atlas/updater.key; chmod 640 /etc/atlas/updater.key
    install -d -m 0700 -o omega -g omega /var/lib/atlas /var/lib/atlas/sessions /var/lib/atlas/sessions/s1
    echo "work in progress" >/var/lib/atlas/sessions/s1/notes.txt; echo "{\"scopes\":[]}" >/var/lib/atlas/session-scopes.json
    chown -R omega:omega /var/lib/atlas
    mkdir -p /opt/atlas/tools/bun/1.3.14/bin /opt/atlas/tools/git/2.55.0/bin /opt/atlas/tools/gh/2.100.0/bin
    printf "#!/bin/sh\nexec sleep infinity\n" >/opt/atlas/tools/bun/1.3.14/bin/bun; chmod 755 /opt/atlas/tools/bun/1.3.14/bin/bun
    ln -s /usr/bin/git /opt/atlas/tools/git/2.55.0/bin/git; ln -s /usr/bin/gh /opt/atlas/tools/gh/2.100.0/bin/gh
    old=/opt/atlas/releases/atlas-v0.9.0+build.3; mkdir -p $old/deploy/bin $old/src; touch $old/src/server.ts
    printf "#!/bin/sh\nexec /usr/bin/git \"\$@\"\n" >$old/deploy/bin/git; chmod 755 $old/deploy/bin/git; ln -sfn $old /opt/atlas/current
    bundle=/opt/atlas/services/releases/bootstrap-1-1; mkdir -p $bundle/atlas-credentials $bundle/atlas-updater
    touch $bundle/atlas-credentials/credential-server.ts $bundle/atlas-credentials/credentials.ts
    touch $bundle/atlas-updater/updater-server.ts $bundle/atlas-updater/updater.ts $bundle/atlas-updater/release.ts $bundle/atlas-updater/credentials.ts
    printf "#!/bin/sh\n" >$bundle/atlas-updater/check-activation-health.sh; chmod 755 $bundle/atlas-updater/check-activation-health.sh
    ln -sfn $bundle /opt/atlas/services/current
    systemctl daemon-reload
    systemctl start atlas-credentials.service atlas-updater.service atlas.service
    systemctl is-active --quiet atlas.service atlas-credentials.service atlas-updater.service
  ' || fail "could not model the older layout"
  pass "older layout running (stand-in Bun)"
  fingerprint='cd / && sha256sum etc/atlas/github-app.pem etc/atlas/supplier.key etc/atlas/updater.key var/lib/atlas/sessions/s1/notes.txt var/lib/atlas/session-scopes.json && grep -E "^ATLAS_(SHARED_TOKEN|GITHUB_WEBHOOK_SECRET|ORIGIN)=" etc/atlas/atlas.env && grep -E "^ATLAS_GITHUB_(ORGANIZATION|APP_ID|INSTALLATION_ID)=" etc/atlas/github.env'
  before=$(in_root "$fingerprint")
  # 3a. a failed adopt restores everything, including /etc/atlas owners and
  # modes. A drop-in lets atlas.service start only from the old Release, so the
  # new one never runs (the database is untouched) and the restore can start it.
  owners="stat -c '%n %u:%g %a' /etc/atlas /etc/atlas/*"
  owners_before=$(in_root "$owners")
  printf '[Service]\nExecStartPre=/bin/sh -c "readlink /opt/atlas/current | grep -q v0.9.0"\n' >"$work/only-old.conf"
  in_root 'mkdir -p /etc/systemd/system/atlas.service.d'
  docker cp "$work/only-old.conf" "$container:/etc/systemd/system/atlas.service.d/only-old.conf"
  in_root 'chown -R root:root /etc/systemd/system/atlas.service.d && systemctl daemon-reload'
  if as_alice "$install_cmd --adopt --tailscale no --health-timeout 5" >"$work/adopt-fail.log" 2>&1; then
    cat "$work/adopt-fail.log"; fail "adopt with a broken new Release succeeded"
  fi
  grep -q 'Restored\.' "$work/adopt-fail.log" || { cat "$work/adopt-fail.log"; fail "failed adopt did not restore"; }
  [[ $(in_root "$owners") == "$owners_before" ]] || fail "failed adopt left other owners/modes: $(in_root "$owners")"
  [[ $(in_root "$fingerprint") == "$before" ]] || fail "failed adopt changed data or secrets"
  [[ $(in_root 'readlink /opt/atlas/current') == /opt/atlas/releases/atlas-v0.9.0+build.3 ]] || fail "failed adopt left current moved"
  in_root 'systemctl is-active --quiet atlas.service atlas-credentials.service atlas-updater.service' || fail "old services not running after restore"
  failed_backup=$(in_root 'ls -d /var/backups/atlas/2*' | head -1)
  key_owner=$(in_root "stat -c '%u:%g' /etc/atlas/supplier.key")
  in_root "grep -qx 'sudo chown $key_owner /etc/atlas/supplier.key' $failed_backup/ROLLBACK.txt && grep -qx 'sudo chmod 600 /etc/atlas/supplier.key' $failed_backup/ROLLBACK.txt" ||
    fail "ROLLBACK.txt lacks chown/chmod lines"
  in_root 'rm -r /etc/systemd/system/atlas.service.d && systemctl daemon-reload'
  pass "failed adopt: restored, /etc/atlas owners+modes as before, old services up"
  as_alice "$install_cmd --adopt --tailscale no" >"$work/adopt.log" 2>&1 || { cat "$work/adopt.log"; fail "adopt failed"; }
  grep -q 'adopting the older install' "$work/adopt.log" || fail "setup did not detect the older install"
  assert_running "$tag1"
  [[ $(in_root "$fingerprint") == "$before" ]] || fail "adopt changed data or secrets"
  pass "data and secrets byte-identical"
  in_root 'grep -qx "User=omega" /etc/systemd/system/atlas.service' || fail "service user not taken from the old units"
  [[ $(in_root "stat -c '%U:%G %a' /etc/atlas/github.env /etc/atlas/github-app.pem /etc/atlas/supplier.key" | tr '\n' ' ') == "root:omega 640 root:omega 640 root:omega 640 " ]] ||
    fail "adopted secrets not root:omega 0640: $(in_root "stat -c '%n %U:%G %a' /etc/atlas/*")"
  backup=$(in_root 'ls -d /var/backups/atlas/2*' | tail -1)
  in_root "grep -q bun $backup/etc/systemd/system/atlas.service && test -f $backup/ROLLBACK.txt && test -f $backup/etc/atlas/atlas.env" || fail "backup incomplete"
  in_root 'test ! -e /etc/systemd/system/atlas-snapshot.timer' || fail "old snapshot timer kept off Btrfs"
  in_root 'test -f /opt/atlas/releases/atlas-v0.9.0+build.3/src/server.ts' || fail "old Release tree removed"
  pass "adopt: user from old units, backup + ROLLBACK.txt, old tree kept"
  docker rm -f "$container" >/dev/null
done
echo "e2e install: all checks passed (${distros[*]})"
