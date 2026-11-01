#!/usr/bin/env bash
# Local fallback for the container smoke when no headless OCI runtime exists (SP-4a).
# Runs deb-smoke.sh / rpm-smoke.sh as uid 0 inside an unprivileged user+mount+pid namespace,
# chrooted into an OFFICIAL base image rootfs (checksum- and signature-verified by the caller).
#
# This is NOT an OCI container: single-uid/gid mapping (only "root" exists, no newuidmap),
# host network, host /dev bind. Consequences, all confined to this local fallback:
#  - chown/chgrp to an unmapped id fails with EINVAL. A shim in /usr/local/sbin (ahead of
#    /usr/sbin on PATH) ignores only that error, so dependency postinsts such as
#    fontconfig-config's `chown root:staff` complete. Ownership is emulated, nothing else.
#  - dpkg-statoverride (C code, not shimmable this way) fails for dbus, which only arrives via
#    transitive recommends; ZILO_SMOKE_NO_RECOMMENDS=1 makes the smoke resolve recommends with a
#    simulated install and then install without transitive recommends.
# The canonical smoke is the container job in .github/workflows/packaging-dryrun.yml.
#
# usage: rootless-chroot.sh deb <ubuntu-base-*.tar.gz>              <zilo-agent.deb> <workdir>
#        rootless-chroot.sh rpm <Fedora-Container-Base-*.oci.tar.xz> <zilo-agent.rpm> <workdir>
set -euo pipefail
kind=$1 image=$(readlink -f "$2") pkg=$(readlink -f "$3") work=$4
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$work"; work=$(cd "$work" && pwd)
root="$work/rootfs-$kind"

if [ "${ZILO_IN_NS:-}" != 1 ]; then
  exec unshare --map-root-user --mount --pid --fork --kill-child \
    env ZILO_IN_NS=1 "$0" "$@"
fi

rm -rf "$root"; mkdir -p "$root"
case "$kind" in
  deb)
    tar --no-same-owner -xzf "$image" -C "$root" --exclude='./dev/*'
    # apt drops to the _apt uid for downloads; only uid 0 is mapped here.
    # apt runs dpkg with its own PATH (DPkg::Path); put the chown shim first.
    printf '%s\n' 'APT::Sandbox::User "root";' \
      'DPkg::Path "/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin";' \
      > "$root/etc/apt/apt.conf.d/99zilo-rootless-smoke"
    smoke=deb-smoke.sh ;;
  rpm)
    oci="$work/oci-$kind"; rm -rf "$oci"; mkdir -p "$oci"
    tar -xJf "$image" -C "$oci"
    layers=$(python3 -I - "$oci" <<'EOF'
import json, sys, os
d = sys.argv[1]
def blob(dg): return os.path.join(d, "blobs", *dg.split(":"))
idx = json.load(open(os.path.join(d, "index.json")))
man = json.load(open(blob(idx["manifests"][0]["digest"])))
if "manifests" in man:  # nested index
    man = json.load(open(blob(man["manifests"][0]["digest"])))
print("\n".join(blob(l["digest"]) for l in man["layers"]))
EOF
)
    for l in $layers; do tar --no-same-owner -xf "$l" -C "$root" --exclude='dev/*'; done
    smoke=rpm-smoke.sh ;;
  *) echo "kind must be deb or rpm" >&2; exit 2 ;;
esac

mkdir -p "$root"/{dev,proc,sys,work,tmp,run}
mount --rbind /dev "$root/dev"
mount -t proc proc "$root/proc"
mount --rbind /sys "$root/sys"
rm -f "$root/etc/resolv.conf"; cp /etc/resolv.conf "$root/etc/resolv.conf"
cp "$here/$smoke" "$pkg" "$root/work/"
chmod 1777 "$root/tmp"
mkdir -p "$root/usr/local/sbin"
for tool in chown chgrp; do
  printf '%s\n' '#!/bin/sh' \
    '# rootless-chroot shim (SP-4a local fallback only): ignore EINVAL from unmapped ids.' \
    "err=\$(/usr/bin/$tool \"\$@\" 2>&1) && exit 0" \
    'case "$err" in *"Invalid argument"*) exit 0 ;; esac' \
    'echo "$err" >&2; exit 1' > "$root/usr/local/sbin/$tool"
  chmod 0755 "$root/usr/local/sbin/$tool"
done
exec chroot "$root" /usr/bin/env -i PATH=/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root \
  LANG=C.UTF-8 ZILO_SMOKE_NO_RECOMMENDS=1 /bin/bash "/work/$smoke" "/work/$(basename "$pkg")"
