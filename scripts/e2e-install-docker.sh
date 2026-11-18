#!/usr/bin/env bash
# End-to-end install test in throwaway systemd containers (Docker, privileged).
#
# Usage: bash scripts/e2e-install-docker.sh [ubuntu:24.04] [debian:12]   (default: both)
#        KEEP=1 keeps the containers and images for debugging.
#
# Per distro (systemd as PID 1, stock apt git/gh, no Bun, non-root sudo user):
#   1. fresh: the real `curl … install.sh | sh -s -- --answers …` (served from
#      file://, so curl decodes %2B like a web server) with a throwaway PEM;
#      asserts units active, /health identity, /login page, `atlas version` on
#      PATH, root-owned read-only Release folders, secret file modes;
#   2. update: install.sh --version <build.2> (re-run of setup) moves current to
#      build.2, keeps the token, and /health reports build.2;
#   3. adopt: a fresh container with the older layout (Bun units from commit
#      432fe69, a stand-in Bun that only sleeps, old env and data) is adopted;
#      data and secrets stay byte-identical, the backup holds the old units.
# Not covered: the updater's own GitHub download (needs github.com), Tailscale.
# Changes nothing on this host besides Docker; release files go to ~/.cache.
# shellcheck disable=SC2016 # single-quoted commands expand inside the container
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
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
sha=$(git -C "$root" rev-parse HEAD)
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
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$work/app.pem" 2>/dev/null
chmod 0644 "$work/app.pem"
cat >"$work/answers.json" <<'EOF'
{ "user": "alice", "organization": "acme-e2e", "appId": "12345", "installationId": "67890",
  "privateKeyPath": "/srv/fixture/app.pem", "origin": "https://atlas.e2e.test", "tailscale": "ask" }
EOF

# ---------- container helpers ----------
image_for() {
  local distro=$1 image="atlas-e2e-${1//[:.]/-}:local"
  docker build -q -t "$image" - >/dev/null <<EOF
FROM $distro
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv dbus curl ca-certificates sudo git gh util-linux \
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
install_cmd='curl -fsSL file:///srv/releases/latest/download/install.sh | ATLAS_INSTALL_BASE_URL=file:///srv/releases sh -s --'
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

for distro in "${distros[@]}"; do
  echo "== $distro"
  image=$(image_for "$distro")
  images+=("$image")
  in_root_versions() { in_root 'echo "git $(git --version | cut -d" " -f3), gh $(gh --version | head -1 | cut -d" " -f3), systemd $(systemctl --version | head -1 | cut -d" " -f2)"'; }

  # 1. fresh install
  container="atlas-e2e-fresh-${distro//[:.]/-}"
  start "$image" "$container"
  echo "  $(in_root_versions); bun: $(in_root 'command -v bun || echo none')"
  as_alice "$install_cmd --answers /srv/fixture/answers.json" >"$work/fresh.log" 2>&1 || { cat "$work/fresh.log"; fail "fresh install failed"; }
  grep -q 'Downloaded and verified' "$work/fresh.log" || fail "install.sh did not verify the download"
  grep -q 'Tailscale is not installed; skipping' "$work/fresh.log" || fail "Tailscale skip line missing"
  grep -q 'OpenCode not found' "$work/fresh.log" || fail "missing-OpenCode warning missing"
  grep -q 'Sign-in token (shown once):' "$work/fresh.log" || fail "token not shown"
  pass "fresh install via curl | sh"
  assert_running "$tag1"
  [[ $(in_root "stat -c '%U:%G %a' /etc/atlas /etc/atlas/atlas.env /etc/atlas/github.env /etc/atlas/github-app.pem /var/lib/atlas" | tr '\n' ' ') == \
    "root:alice 750 root:root 600 alice:alice 600 alice:alice 600 alice:alice 700 " ]] || fail "config modes: $(in_root "stat -c '%n %U:%G %a' /etc/atlas /etc/atlas/* /var/lib/atlas")"
  pass "config and data modes"
  in_root 'ls /tmp | grep -q atlas-install' && fail "install.sh left its temp folder"
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
      git -C "$root" show "432fe69:deploy/systemd/$unit.$kind" >"$work/old-$unit.$kind" 2>/dev/null || { rm -f "$work/old-$unit.$kind"; continue; }
      docker cp "$work/old-$unit.$kind" "$container:/etc/systemd/system/$unit.$kind"
    done
  done
  git -C "$root" show 432fe69:deploy/atlas.env.example | sed \
    -e 's/^ATLAS_SHARED_TOKEN=.*/ATLAS_SHARED_TOKEN=old-shared-token-0123456789abcdefghij/' \
    -e 's/^ATLAS_GITHUB_WEBHOOK_SECRET=.*/ATLAS_GITHUB_WEBHOOK_SECRET=old-webhook-secret-0123456789/' \
    -e 's/^ATLAS_ORIGIN=.*/ATLAS_ORIGIN=https:\/\/atlas.e2e.test/' >"$work/old-atlas.env"
  git -C "$root" show 432fe69:deploy/github.env.example | sed 's/your-organization/acme-e2e/' >"$work/old-github.env"
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
  fingerprint='cd / && sha256sum etc/atlas/github.env etc/atlas/github-app.pem etc/atlas/supplier.key etc/atlas/updater.key var/lib/atlas/sessions/s1/notes.txt var/lib/atlas/session-scopes.json && grep -E "^ATLAS_(SHARED_TOKEN|GITHUB_WEBHOOK_SECRET|ORIGIN)=" etc/atlas/atlas.env'
  before=$(in_root "$fingerprint")
  as_alice "$install_cmd --adopt --tailscale no" >"$work/adopt.log" 2>&1 || { cat "$work/adopt.log"; fail "adopt failed"; }
  grep -q 'adopting the older install' "$work/adopt.log" || fail "setup did not detect the older install"
  assert_running "$tag1"
  [[ $(in_root "$fingerprint") == "$before" ]] || fail "adopt changed data or secrets"
  pass "data and secrets byte-identical"
  in_root 'grep -qx "User=omega" /etc/systemd/system/atlas.service' || fail "service user not taken from the old units"
  backup=$(in_root 'ls -d /var/backups/atlas/2*' | head -1)
  in_root "grep -q bun $backup/etc/systemd/system/atlas.service && test -f $backup/ROLLBACK.txt && test -f $backup/etc/atlas/atlas.env" || fail "backup incomplete"
  in_root 'test ! -e /etc/systemd/system/atlas-snapshot.timer' || fail "old snapshot timer kept off Btrfs"
  in_root 'test -f /opt/atlas/releases/atlas-v0.9.0+build.3/src/server.ts' || fail "old Release tree removed"
  pass "adopt: user from old units, backup + ROLLBACK.txt, old tree kept"
  docker rm -f "$container" >/dev/null
done
echo "e2e install: all checks passed (${distros[*]})"
