#!/usr/bin/env bash
# Run from repository root after implementation settles. Linux-only evidence.
set -euo pipefail
export DOTNET_ROOT=/tmp/opencode/t12-proto-r2/sdk
export DOTNET_CLI_HOME=/tmp/opencode/t12-proto-r2/home
export NUGET_PACKAGES=/tmp/opencode/t12-proto-r2/nuget
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
logdir=docs/validation/logs/T12
run() {
  local name="$1"; shift
  printf 'COMMAND:' > "$logdir/$name.log"
  printf ' %q' "$@" >> "$logdir/$name.log"
  printf '\n' >> "$logdir/$name.log"
  "$@" 2>&1 | tee -a "$logdir/$name.log"
}
run sdk "$DOTNET_ROOT/dotnet" --info
run restore "$DOTNET_ROOT/dotnet" restore backend/Zilo.slnx --locked-mode
run build "$DOTNET_ROOT/dotnet" build backend/Zilo.slnx -c Release --no-restore
run tests "$DOTNET_ROOT/dotnet" test backend/Zilo.slnx -c Release --no-build --no-restore -p:RestoreLockedMode=true
run no-naps2 "$DOTNET_ROOT/dotnet" test backend/tests/Zilo.Scaffold.Tests -c Release --no-build --no-restore --filter FullyQualifiedName~Restored_runtime_graph
run agent-smoke "$DOTNET_ROOT/dotnet" backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll
run whitespace git diff --check
