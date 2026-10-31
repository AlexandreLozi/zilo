#!/usr/bin/env bash
# SP-4a: publish the T04b hello agent for packaging.
#
# Framework-dependent, NOT single-file, NOT trimmed: every assembly stays a separate,
# replaceable file (D-002). Restore runs in locked mode against the committed lock files.
#
# A self-contained publish (`-r <rid> --self-contained`) is rejected by locked restore with
# NU1004 because the lock files carry no runtime identifiers. Adding RuntimeIdentifiers means
# changing backend/** and regenerating lock files, which T03 may not do without approval, so the
# dry run uses the portable framework-dependent output and only swaps the native apphost:
#   linux -> linux-x64 apphost  (`Zilo.Agent`)
#   win   -> win-x64 apphost    (`Zilo.Agent.exe`, a PE we test-sign)
#   osx   -> osx-arm64 + osx-x64 apphosts, merged with lipo on macOS into a universal binary
#
# usage: packaging/publish.sh <linux|win|osx> <out-dir>
set -euo pipefail

target=${1:?target: linux|win|osx}
out=${2:?out dir}
repo=$(cd "$(dirname "$0")/.." && pwd)
proj="$repo/backend/src/Zilo.Agent/Zilo.Agent.csproj"

publish() { # <apphost-rid> <dir>
  dotnet publish "$proj" --configuration Release \
    -p:RestoreLockedMode=true \
    -p:PublishSingleFile=false -p:PublishTrimmed=false \
    -p:DebugType=none -p:GenerateDocumentationFile=false \
    -p:DefaultAppHostRuntimeIdentifier="$1" \
    -o "$2"
}

rm -rf "$out"
case "$target" in
  linux) publish linux-x64 "$out" ;;
  win)   publish win-x64 "$out" ;;
  osx)
    publish osx-arm64 "$out"
    publish osx-x64 "$out.x64"
    if command -v lipo >/dev/null; then
      lipo -create "$out/Zilo.Agent" "$out.x64/Zilo.Agent" -output "$out/Zilo.Agent.universal"
      mv "$out/Zilo.Agent.universal" "$out/Zilo.Agent"
      lipo -info "$out/Zilo.Agent"
    else
      echo "lipo not available: osx apphost left arm64-only (build the pkg on macOS)" >&2
    fi
    rm -rf "$out.x64"
    ;;
  *) echo "unknown target $target" >&2; exit 2 ;;
esac
ls -l "$out"
