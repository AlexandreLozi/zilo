#!/bin/sh
# SP-4a .rpm install/uninstall smoke. Runs as root INSIDE a disposable Fedora environment
# (CI: `fedora:43` container; locally: packaging/linux/smoke/rootless-chroot.sh).
# usage: rpm-smoke.sh <path-to-zilo-agent.rpm>
# Uses the network for dnf only (the package scripts themselves never do).
set -eu
rpmf=$(readlink -f "$1")
step() { printf '\n=== %s\n' "$*"; }
fail() { echo "SMOKE FAIL: $*"; exit 1; }

snapshot() {
  find / -xdev \( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /tmp \
       -o -path /work -o -path /var/cache -o -path /var/log -o -path /var/lib/dnf \) -prune \
       -o -printf '%p %y %m\n' | sort
  find /etc /usr/share/applications /usr/lib/systemd -xdev -type f -exec md5sum {} + 2>/dev/null | sort -k2
}

step "os"; . /etc/os-release; echo "$PRETTY_NAME"; uname -m
step "tooling (installed before any snapshot)"
dnf -y -q install --setopt=install_weak_deps=False systemd desktop-file-utils findutils diffutils >/dev/null
rpm -q systemd desktop-file-utils

step "dependency resolution (dnf, weak deps on)"
if [ "${ZILO_SMOKE_NO_RECOMMENDS:-}" = 1 ]; then
  dnf -y install --assumeno "$rpmf" 2>&1 | grep -E 'zilo-agent|dotnet-runtime-10.0|sane-backends |sane-airscan' || true
  step "install (no transitive weak deps; sane-airscan named explicitly)"
  dnf -y install --setopt=install_weak_deps=False "$rpmf" sane-airscan
else
  dnf -y install "$rpmf"
fi
rpm -q zilo-agent dotnet-runtime-10.0 sane-backends sane-airscan

step "files"
rpm -ql zilo-agent
for f in /usr/lib/zilo/Zilo.Agent /usr/lib/zilo/Zilo.Agent.dll /usr/lib/zilo/Zilo.Drivers.Naps2.dll \
         /usr/lib/systemd/user/zilo-agent.service /usr/share/applications/zilo-agent.desktop; do
  [ -f "$f" ] || fail "missing $f"
done
[ -L /usr/bin/zilo-agent ] || fail "missing /usr/bin/zilo-agent symlink"
[ -L /etc/systemd/user/default.target.wants/zilo-agent.service ] || fail "user unit not globally enabled"
rpm -V zilo-agent && echo "rpm -V: clean"

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

step "erase"
rpm -e zilo-agent
[ ! -e /usr/lib/zilo ] || fail "/usr/lib/zilo left behind"
[ ! -e /usr/bin/zilo-agent ] || fail "/usr/bin/zilo-agent left behind"
[ ! -e /etc/systemd/user/default.target.wants/zilo-agent.service ] || fail "enablement symlink left behind"
! grep -q 'x-scheme-handler/zilo' /usr/share/applications/mimeinfo.cache 2>/dev/null \
  || fail "zilo:// still registered after erase"
rpm -q zilo-agent && fail "rpm still knows zilo-agent" || true

step "erase leaves nothing behind: snapshot diff around a second install+erase"
snapshot > /tmp/before.txt
rpm -i "$rpmf"
rpm -e zilo-agent
snapshot > /tmp/after.txt
if ! diff -u /tmp/before.txt /tmp/after.txt; then fail "rootfs differs after erase"; fi
echo "rootfs identical before install and after erase ($(wc -l < /tmp/before.txt) entries)"

echo; echo "RPM SMOKE PASS"
