#!/usr/bin/env bash
# SP-4a: build the unsigned dry-run macOS .pkg. REQUIRES macOS (lipo, pkgbuild, productbuild).
# usage: packaging/macos/build-pkg.sh <out-dir> [version]
#
# Layout:
#   /Applications/Zilo Agent.app/Contents/{Info.plist,MacOS/<universal apphost + assemblies>}
#   /Library/LaunchAgents/dev.zilo.agent.plist
# D-011/SP-4b (production): codesign every Mach-O and the app with a Developer ID Application
# certificate, hardened runtime and a secure timestamp; productsign with Developer ID Installer;
# notarytool submit + stapler staple. The dry run does none of that (notarization: pending, M6).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?out dir}; version=${2:-0.0.1}
[ "$(uname -s)" = Darwin ] || { echo "build-pkg.sh needs macOS (pkgbuild/productbuild)" >&2; exit 2; }
mkdir -p "$out"; out=$(cd "$out" && pwd)

pub="$out/publish-osx"
"$repo/packaging/publish.sh" osx "$pub"
lipo -archs "$pub/Zilo.Agent" | grep -q 'x86_64 arm64\|arm64 x86_64' || { echo "apphost not universal" >&2; exit 1; }

root="$out/pkgroot"; rm -rf "$root"
app="$root/Applications/Zilo Agent.app"
mkdir -p "$app/Contents/MacOS" "$root/Library/LaunchAgents"
cp -R "$pub"/. "$app/Contents/MacOS/"
sed "s/@VERSION@/$version/g" "$here/Info.plist" > "$app/Contents/Info.plist"
cp "$here/dev.zilo.agent.plist" "$root/Library/LaunchAgents/"
plutil -lint "$app/Contents/Info.plist" "$root/Library/LaunchAgents/dev.zilo.agent.plist"
chmod 0755 "$here/scripts/postinstall"

pkgbuild --root "$root" --identifier dev.zilo.agent --version "$version" \
  --scripts "$here/scripts" --install-location / "$out/zilo-agent-component.pkg"
sed "s/@VERSION@/$version/g" "$here/distribution.xml" > "$out/distribution.xml"
productbuild --distribution "$out/distribution.xml" --package-path "$out" \
  "$out/zilo-agent-$version-universal.pkg"
pkgutil --payload-files "$out/zilo-agent-$version-universal.pkg"
pkgutil --check-signature "$out/zilo-agent-$version-universal.pkg" || true  # expected: unsigned
ls -l "$out"/*.pkg
