#!/usr/bin/env bash
# SP-4a .deb install/uninstall smoke. Runs as root INSIDE a disposable Ubuntu LTS environment
# (CI: `ubuntu:24.04` container; locally: packaging/linux/smoke/rootless-chroot.sh).
# usage: deb-smoke.sh <path-to-zilo-agent.deb>
# Uses the network for apt only (the package scripts themselves never do).
set -euo pipefail
deb=$(readlink -f "$1")
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n=== %s\n' "$*"; }
fail() { echo "SMOKE FAIL: $*"; exit 1; }

snapshot() { # whole-rootfs listing (path, type, mode) + content hashes of config-ish trees
  find / -xdev \( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /tmp \
       -o -path /work -o -path /var/cache -o -path /var/log -o -path /var/lib/apt/lists \) -prune \
       -o -printf '%p %y %m\n' | sort
  # Hashes are best effort (an unreadable file must not abort the snapshot); the listing above is strict.
  { find /etc /usr/share/applications /usr/lib/systemd -xdev -type f -exec md5sum {} + 2>/dev/null || true; } | sort -k2
}

step "os"; . /etc/os-release; echo "$PRETTY_NAME"; uname -m
step "tooling (installed before any snapshot)"
apt-get update -qq
# systemd is installed without recommends: its recommends (dbus, resolved) are irrelevant here.
apt-get install -y -qq --no-install-recommends systemd desktop-file-utils >/dev/null
dpkg-query -W systemd desktop-file-utils

step "dependency resolution (apt, recommends on)"
if [ "${ZILO_SMOKE_NO_RECOMMENDS:-}" = 1 ]; then
  # Rootless chroot: resolve with recommends, then install depends + the direct recommend only.
  apt-get install -y --simulate "$deb" | grep -E '^Inst (zilo-agent|dotnet-runtime-10.0|libsane1|sane-airscan) '
  step "install (no transitive recommends; sane-airscan named explicitly)"
  apt-get install -y --no-install-recommends "$deb" sane-airscan
else
  apt-get install -y "$deb"
fi
dpkg-query -W -f '${Package} ${Version} ${Status}\n' zilo-agent dotnet-runtime-10.0 libsane1 sane-airscan

step "files"
dpkg -L zilo-agent
for f in /usr/lib/zilo/Zilo.Agent /usr/lib/zilo/Zilo.Agent.dll /usr/lib/zilo/Zilo.Drivers.Naps2.dll \
         /usr/lib/systemd/user/zilo-agent.service /usr/share/applications/zilo-agent.desktop; do
  [ -f "$f" ] || fail "missing $f"
done
[ -L /usr/bin/zilo-agent ] || fail "missing /usr/bin/zilo-agent symlink"
[ -L /etc/systemd/user/default.target.wants/zilo-agent.service ] || fail "user unit not globally enabled"
ls -l /etc/systemd/user/default.target.wants/zilo-agent.service

step "agent runs against the distro .NET 10 runtime"
out=$(/usr/bin/zilo-agent); echo "$out"
[ "$out" = "Zilo.Agent scaffold: scanning is not implemented." ] || fail "unexpected agent output"

step "unit and desktop entry validate"
systemd-analyze --version | head -1
systemd-analyze verify /usr/lib/systemd/user/zilo-agent.service
echo "systemd-analyze verify: exit 0"
desktop-file-validate /usr/share/applications/zilo-agent.desktop
echo "desktop-file-validate: exit 0"
grep -F 'x-scheme-handler/zilo=zilo-agent.desktop' /usr/share/applications/mimeinfo.cache \
  || fail "zilo:// not registered in mimeinfo.cache"

step "purge"
dpkg --purge zilo-agent
[ ! -e /usr/lib/zilo ] || fail "/usr/lib/zilo left behind"
[ ! -e /usr/bin/zilo-agent ] || fail "/usr/bin/zilo-agent left behind"
[ ! -e /etc/systemd/user/default.target.wants/zilo-agent.service ] || fail "enablement symlink left behind"
! grep -q 'x-scheme-handler/zilo' /usr/share/applications/mimeinfo.cache 2>/dev/null \
  || fail "zilo:// still registered after purge"
dpkg-query -W zilo-agent 2>/dev/null && fail "dpkg still knows zilo-agent" || true

step "purge leaves nothing behind: snapshot diff around a second install+purge"
snapshot > /tmp/before.txt
dpkg -i "$deb"
dpkg --purge zilo-agent
snapshot > /tmp/after.txt
if ! diff -u /tmp/before.txt /tmp/after.txt; then fail "rootfs differs after purge"; fi
echo "rootfs identical before install and after purge ($(wc -l < /tmp/before.txt) entries)"

echo; echo "DEB SMOKE PASS"
