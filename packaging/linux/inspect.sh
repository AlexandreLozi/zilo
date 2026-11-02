#!/usr/bin/env bash
# SP-4a static inspection of the built .deb and .rpm (no install, no root).
# usage: packaging/linux/inspect.sh <deb> <rpm> <scratch-dir>
# Needs dpkg-deb, rpm (or RPM=<wrapper>), systemd-analyze, desktop-file-validate (optional).
set -euo pipefail
deb=$1 rpmf=$2 scratch=$3
RPM=${RPM:-rpm}
fail() { echo "INSPECT FAIL: $*"; exit 1; }
expected="/usr/bin/zilo-agent
/usr/lib/systemd/user/zilo-agent.service
/usr/lib/zilo/Zilo.Agent
/usr/lib/zilo/Zilo.Agent.deps.json
/usr/lib/zilo/Zilo.Agent.dll
/usr/lib/zilo/Zilo.Agent.runtimeconfig.json
/usr/lib/zilo/Zilo.Core.dll
/usr/lib/zilo/Zilo.Drivers.Naps2.dll
/usr/lib/zilo/Zilo.Drivers.Virtual.dll
/usr/lib/zilo/Zilo.Security.dll
/usr/lib/zilo/zxing.dll
/usr/share/applications/zilo-agent.desktop"

echo "=== deb: control"
dpkg-deb -I "$deb"
dpkg-deb -f "$deb" Depends | grep -q 'dotnet-runtime-10.0' || fail "deb Depends lacks dotnet-runtime-10.0"
dpkg-deb -f "$deb" Depends | grep -q 'libsane1' || fail "deb Depends lacks libsane1"
dpkg-deb -f "$deb" Recommends | grep -q 'sane-airscan' || fail "deb Recommends lacks sane-airscan"
echo "=== deb: contents"
dpkg-deb -c "$deb"
got=$(dpkg-deb -c "$deb" | awk '$1 !~ /^d/ {print $6}' | sed 's|^\.||' | sort)
[ "$got" = "$expected" ] || { diff <(echo "$expected") <(echo "$got"); fail "deb file list"; }
dpkg-deb -c "$deb" | grep -E ' \./usr/lib/zilo/Zilo\.Agent$' | grep -q '^-rwxr-xr-x root/root' || fail "apphost mode"
dpkg-deb -c "$deb" | awk '$1 == "-rw-r--r--" && $2 == "root/root" && $6 == "./usr/lib/zilo/zxing.dll" { found++ } END { exit found != 1 }' || fail "zxing.dll mode/owner"
echo "deb file list: as expected (12 files, assemblies separate, no single-file bundle)"

echo "=== rpm: header"
"$RPM" -q -p "$rpmf" --qf 'Name: %{NAME}\nVersion: %{VERSION}-%{RELEASE}\nArch: %{ARCH}\n[Requires: %{REQUIRENAME}\n][Recommends: %{RECOMMENDNAME}\n]' 2>/dev/null
reqs=$("$RPM" -q -p "$rpmf" --qf '[%{REQUIRENAME}\n]' 2>/dev/null)
grep -qx dotnet-runtime-10.0 <<<"$reqs" || fail "rpm Requires lacks dotnet-runtime-10.0"
grep -qx sane-backends <<<"$reqs" || fail "rpm Requires lacks sane-backends"
"$RPM" -q -p "$rpmf" --qf '[%{RECOMMENDNAME}\n]' 2>/dev/null | grep -qx sane-airscan || fail "rpm Recommends"
echo "=== rpm: contents"
"$RPM" -q -p "$rpmf" --qf '[%{FILEMODES:perms} %{FILEUSERNAME}/%{FILEGROUPNAME} %{FILENAMES}\n]' 2>/dev/null
got=$("$RPM" -q -p "$rpmf" --qf '[%{FILEMODES:perms} %{FILENAMES}\n]' 2>/dev/null | awk '$1 !~ /^d/ {print $2}' | sort)
[ "$got" = "$expected" ] || { diff <(echo "$expected") <(echo "$got"); fail "rpm file list"; }
"$RPM" -q -p "$rpmf" --qf '[%{FILEMODES:perms} %{FILEUSERNAME}/%{FILEGROUPNAME} %{FILENAMES}\n]' 2>/dev/null \
  | grep -qx -- '-rw-r--r-- root/root /usr/lib/zilo/zxing.dll' || fail "rpm zxing.dll mode/owner"
echo "rpm file list: as expected"
echo "=== rpm: scriptlets"
"$RPM" -q -p "$rpmf" --qf 'PREIN:%{PREIN}\nPOSTIN:%{POSTIN}\nPREUN:%{PREUN}\nPOSTUN:%{POSTUN}\n' 2>/dev/null \
  | grep -E '^(PREIN|POSTIN|PREUN|POSTUN):' | cut -c1-40

echo "=== no network in maintainer scripts"
rm -rf "$scratch"; mkdir -p "$scratch/ctrl" "$scratch/root"
dpkg-deb -e "$deb" "$scratch/ctrl"
if grep -nE 'curl|wget|https?://|apt-get|dnf |nc |ssh ' "$scratch/ctrl/postinst" "$scratch/ctrl/prerm"; then
  fail "network-looking command in maintainer scripts"
fi
echo "postinst/prerm: no network commands"

echo "=== unit file (host systemd-analyze, against the extracted payload)"
dpkg-deb -x "$deb" "$scratch/root"
systemd-analyze --version | head -1
# systemd 255 cannot verify user units under --root, so verify a copy whose ExecStart points at
# the extracted apphost. The smokes verify the unit in place inside the target images.
mkdir -p "$scratch/unit"
sed "s|^ExecStart=/usr/bin/zilo-agent|ExecStart=$scratch/root/usr/lib/zilo/Zilo.Agent|" \
  "$scratch/root/usr/lib/systemd/user/zilo-agent.service" > "$scratch/unit/zilo-agent.service"
systemd-analyze verify "$scratch/unit/zilo-agent.service"
echo "systemd-analyze verify (payload unit, ExecStart re-pointed): exit 0"
if command -v desktop-file-validate >/dev/null; then
  desktop-file-validate "$scratch/root/usr/share/applications/zilo-agent.desktop"
  echo "desktop-file-validate: exit 0"
else
  echo "desktop-file-validate: not on this host (runs in the smoke)"
fi
grep -qx 'MimeType=x-scheme-handler/zilo;' "$scratch/root/usr/share/applications/zilo-agent.desktop"
echo "INSPECT PASS"
