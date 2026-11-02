#!/usr/bin/env bash
# Run from repository root. Keep both independently built RID payloads for diagnosis.
set -euo pipefail
scratch=${1:?scratch path outside the repository}
scratch=$(realpath -m "$scratch")
for rid in osx-arm64 osx-x64; do
  dotnet restore backend/src/Zilo.Agent/Zilo.Agent.csproj --locked-mode --artifacts-path "$scratch/$rid"
  dotnet publish backend/src/Zilo.Agent/Zilo.Agent.csproj -c Release --no-restore \
    --runtime "$rid" --self-contained false --artifacts-path "$scratch/$rid" \
    -p:PlatformTarget=AnyCPU -p:PublishSingleFile=false -p:PublishTrimmed=false \
    -p:DebugType=none -p:GenerateDocumentationFile=false -o "$scratch/$rid.out"
done
for file in Zilo.Agent.dll Zilo.Core.dll Zilo.Drivers.Naps2.dll Zilo.Drivers.Virtual.dll Zilo.Security.dll zxing.dll; do
  sha256sum "$scratch/osx-arm64.out/$file" "$scratch/osx-x64.out/$file"
  cmp "$scratch/osx-arm64.out/$file" "$scratch/osx-x64.out/$file"
done
