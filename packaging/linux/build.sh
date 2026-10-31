#!/usr/bin/env bash
# Build the SP-4a .deb and .rpm with nfpm.
# usage: packaging/linux/build.sh <out-dir>
# Requires: dotnet (global.json SDK), nfpm on PATH.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?out dir}
mkdir -p "$out"
out=$(cd "$out" && pwd)

export ZILO_VERSION=${ZILO_VERSION:-0.0.1}
export ZILO_LINUX_DIR="$here"
export ZILO_PUBLISH_DIR="$out/publish-linux"

"$repo/packaging/publish.sh" linux "$ZILO_PUBLISH_DIR"
chmod 0755 "$here/scripts/"*.sh

nfpm --version | sed -n '/GitVersion/p'
# nfpm does not expand environment variables inside `contents`/`scripts`; render them here.
sed -e "s|\${ZILO_PUBLISH_DIR}|$ZILO_PUBLISH_DIR|g" \
    -e "s|\${ZILO_LINUX_DIR}|$ZILO_LINUX_DIR|g" \
    -e "s|\${ZILO_VERSION}|$ZILO_VERSION|g" \
    "$here/nfpm.yaml" > "$out/nfpm.rendered.yaml"
nfpm package --config "$out/nfpm.rendered.yaml" --packager deb --target "$out/"
nfpm package --config "$out/nfpm.rendered.yaml" --packager rpm --target "$out/"
deb="$out/zilo-agent_${ZILO_VERSION}-1_amd64.deb" rpm="$out/zilo-agent-${ZILO_VERSION}-1.x86_64.rpm"
[ -s "$ZILO_PUBLISH_DIR/Zilo.Agent" ] || { echo "BUILD FAIL: publish output missing" >&2; exit 1; }
[ -s "$deb" ] || { echo "BUILD FAIL: missing $deb" >&2; exit 1; }
[ -s "$rpm" ] || { echo "BUILD FAIL: missing $rpm" >&2; exit 1; }
ls -l "$deb" "$rpm"
