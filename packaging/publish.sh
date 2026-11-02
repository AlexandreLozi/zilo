#!/usr/bin/env bash
# SP-4a: publish the T04b hello agent for packaging.
#
# Framework-dependent, NOT single-file, NOT trimmed: every assembly stays a separate,
# replaceable file (D-002). Restore runs in locked mode against the committed lock files.
#
# T03 fix r1: real per-RID publishes. Zilo.Agent.csproj declares
# `RuntimeIdentifiers=linux-x64;win-x64;osx-x64;osx-arm64` and its lock file carries those RID
# graphs, so each target is `dotnet publish -r <rid> --self-contained false`. Every target gets
# its OWN `--artifacts-path` (isolated obj/ and bin/), so no apphost, assets file or intermediate
# output is ever reused across targets (review T03-r1 finding 1). Restore runs once per target,
# locked and without `-r`: a `-r` restore would push the RID onto the RID-agnostic library
# references, whose lock files intentionally carry no RIDs.
#   linux -> linux-x64 apphost  (`Zilo.Agent`, ELF x86-64)
#   win   -> win-x64 apphost    (`Zilo.Agent.exe`, PE32+ x86-64, the PE we test-sign)
#   osx   -> osx-arm64 + osx-x64 apphosts, merged with lipo on macOS into a universal binary
# The native apphost format/architecture is asserted from its header bytes after every publish.
# PlatformTarget=AnyCPU: with a RID the SDK otherwise compiles Zilo.Agent.dll for that CPU only
# (PE machine arm64/x64), which would break the other slice of the macOS universal app. Every
# managed assembly is asserted to be AnyCPU, and the two osx payloads must be byte-identical.
#
# usage: packaging/publish.sh <linux|win|osx> <out-dir>
set -euo pipefail

target=${1:?target: linux|win|osx}
out=${2:?out dir}
repo=$(cd "$(dirname "$0")/.." && pwd)
proj="$repo/backend/src/Zilo.Agent/Zilo.Agent.csproj"
work="$out.work"   # per-target isolated restore/build trees, removed on exit
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

fail() { echo "PUBLISH FAIL: $*" >&2; exit 1; }

publish() { # <rid> <dir>
  local rid=$1 dir=$2 iso="$work/$1"
  rm -rf "$iso"
  dotnet restore "$proj" --locked-mode --artifacts-path "$iso"
  dotnet publish "$proj" --configuration Release --no-restore \
    --runtime "$rid" --self-contained false --artifacts-path "$iso" \
    -p:PlatformTarget=AnyCPU \
    -p:PublishSingleFile=false -p:PublishTrimmed=false \
    -p:DebugType=none -p:GenerateDocumentationFile=false \
    -o "$dir"
  for f in Zilo.Agent.dll Zilo.Agent.deps.json Zilo.Agent.runtimeconfig.json Zilo.Core.dll \
           Zilo.Drivers.Naps2.dll Zilo.Drivers.Virtual.dll Zilo.Security.dll zxing.dll; do
    [ -s "$dir/$f" ] || fail "$rid: missing $dir/$f"
  done
  grep -q "\"name\": \".NETCoreApp,Version=v10.0/$rid\"" "$dir/Zilo.Agent.deps.json" \
    || fail "$rid: deps.json runtimeTarget is not $rid"
  for f in "$dir"/*.dll; do
    [ "$(pe_machine "$f")" = 4c01 ] || fail "$f is not AnyCPU (PE machine $(pe_machine "$f"))"
  done
}

pe_machine() { # PE COFF machine field as little-endian hex (4c01 = AnyCPU IL, 6486 = x86-64)
  local off; off=$(od -An -tu4 -j60 -N4 "$1" | tr -d ' ')
  od -An -tx1 -j"$((off + 4))" -N2 "$1" | tr -d ' \n'
}

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
magic() { od -An -tx1 -N8 "$1" | tr -d ' \n'; } # first 8 header bytes as hex

assert_apphost() { # <file> <elf-x64|pe-x64|macho-x64|macho-arm64>
  [ -s "$1" ] || fail "missing apphost $1"
  local m; m=$(magic "$1")
  case "$2" in
    elf-x64)     [ "${m:0:8}" = 7f454c46 ] && [ "$(od -An -tx1 -j18 -N2 "$1" | tr -d ' \n')" = 3e00 ] ;;
    pe-x64)      [ "${m:0:4}" = 4d5a ] ;;  # MZ; PE32+/x86-64 machine checked below
    macho-x64)   [ "$m" = cffaedfe07000001 ] ;;
    macho-arm64) [ "$m" = cffaedfe0c000001 ] ;;
  esac || fail "$1 is not $2 (header $m)"
  if [ "$2" = pe-x64 ]; then
    [ "$(pe_machine "$1")" = 6486 ] || fail "$1 is not a PE x86-64 image"
  fi
  echo "apphost ok: $1 ($2, sha256 $(sha256 "$1"))"
}

rm -rf "$out" "$work"
case "$target" in
  linux) publish linux-x64 "$out"; assert_apphost "$out/Zilo.Agent" elf-x64 ;;
  win)   publish win-x64 "$out";   assert_apphost "$out/Zilo.Agent.exe" pe-x64 ;;
  osx)
    publish osx-arm64 "$out"
    publish osx-x64 "$work/osx-x64.out"
    assert_apphost "$out/Zilo.Agent" macho-arm64
    assert_apphost "$work/osx-x64.out/Zilo.Agent" macho-x64
    # Only the apphost is RID-specific; the managed payload must be byte-identical.
    for f in Zilo.Agent.dll Zilo.Core.dll Zilo.Drivers.Naps2.dll Zilo.Drivers.Virtual.dll Zilo.Security.dll zxing.dll; do
      cmp -s "$out/$f" "$work/osx-x64.out/$f" || fail "managed payload differs between osx RIDs: $f"
    done
    if command -v lipo >/dev/null; then
      lipo -create "$out/Zilo.Agent" "$work/osx-x64.out/Zilo.Agent" -output "$out/Zilo.Agent.universal"
      mv "$out/Zilo.Agent.universal" "$out/Zilo.Agent"
      lipo -info "$out/Zilo.Agent"
      archs=$(lipo -archs "$out/Zilo.Agent")
      case "$archs" in "x86_64 arm64"|"arm64 x86_64") ;; *) fail "not universal: $archs" ;; esac
    else
      echo "lipo not available: osx apphost left arm64-only (build the pkg on macOS)" >&2
    fi
    ;;
  *) echo "unknown target $target" >&2; exit 2 ;;
esac
ls -l "$out"
