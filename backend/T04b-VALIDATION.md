# T04b author evidence

Date: 2026-10-31. Branch: `t04b-backend-scaffold`.
Implementation commit: `68e54cf`; SDK/build-policy commit: `117f09b`.

## Scope

- Five production projects and two focused test projects in `backend/Zilo.slnx`.
- The agent prints `Zilo.Agent scaffold: scanning is not implemented.` and exits
  successfully. It opens no HTTP listener and exposes no scanner endpoints.
- Core, driver and security libraries are empty: no contracts, NAPS2 packages,
  acquisition or security implementation. T06/T10/T11 remain separate tasks.
- Root build/package policies apply only beneath `backend/`; independent spikes
  retain their own SDK/package policy. No spike, licence-gate, planning or web
  files were changed.

## Toolchain and local setup

No `dotnet` was initially available. Installed only into this task's private
directory, without sudo or machine-global changes:

```sh
mkdir -p /tmp/opencode/zilo-t04b-evidence
curl --fail --show-error --location https://dot.net/v1/dotnet-install.sh \
  --output /tmp/opencode/zilo-t04b-evidence/dotnet-install.sh
bash /tmp/opencode/zilo-t04b-evidence/dotnet-install.sh \
  --version 10.0.403 --install-dir /tmp/opencode/zilo-t04b-dotnet --no-path
export DOTNET_ROOT=/tmp/opencode/zilo-t04b-dotnet
export PATH="$DOTNET_ROOT:$PATH"
export NUGET_PACKAGES=/tmp/opencode/zilo-t04b-nuget
```

`dotnet --info` confirmed SDK **10.0.403**, runtime **10.0.14**, Ubuntu 24.04,
`linux-x64`. The [official .NET 10 release metadata](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json)
identified that exact stable SDK. `global.json` disables roll-forward and
prereleases and selects VSTest.

Central exact pins: Microsoft.NET.Test.Sdk **18.11.0**,
xunit.runner.visualstudio **4.0.1**, xunit.v3.mtp-off **4.0.2**. The explicit
MTP-off package follows the current xUnit VSTest template; both test projects
are executables as required by xUnit v3. All seven lock files were generated
by actual NuGet restore, never handwritten.

## Executed acceptance

The author ran these commands against the final implementation:

```sh
dotnet restore backend/Zilo.slnx --locked-mode
dotnet build backend/Zilo.slnx --configuration Release --no-restore -t:Rebuild
dotnet test backend/Zilo.slnx --configuration Release --no-build --no-restore \
  -p:RestoreLockedMode=true --logger trx \
  --results-directory "$PWD/backend/artifacts/final-test-results"
dotnet run --project backend/src/Zilo.Agent/Zilo.Agent.csproj \
  --configuration Release --no-build --no-restore
backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent
```

Results: locked restore succeeded; Release rebuild had **zero warnings/errors**;
**6 passed, 0 failed, 0 skipped** across both test projects; both smoke commands
printed the expected notice and exited zero. The startup test launches the real
built agent twice, with bounded completion and captured stdout/stderr. The other
tests guard the temporary empty-library/no-real-NAPS2 boundary, not scanning
functionality.

The implementation helper reported observing the startup test fail on missing
stdout before implementing the notice, then pass after implementation. Its
original red-green command was:

```sh
dotnet test backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj \
  --configuration Release --no-restore --logger 'console;verbosity=normal'
```

Original red-green output is in the helper conversation, not a saved log;
the final acceptance above was independently rerun by the parent worker.

Additional executed checks:

- `actionlint` **1.7.12**: workflow lint exited zero with no diagnostics.
  The downloaded official binary archive's SHA-256 matched
  `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.
- An external temporary MSBuild probe imported both root props files and
  asserted its `net8.0` framework, warning policy, lock policy and package
  management remained unchanged: passed. This is an isolation probe, not an
  execution of T02's independently owned spike.
- Evaluating the backend with `CI=true` confirmed `RestoreLockedMode=true`,
  `ContinuousIntegrationBuild=true`, and central package management enabled.
- `git diff --check`: passed.

Task-local logs/TRX are under ignored `backend/artifacts/`; SDK installation
and isolation-probe inputs are under `/tmp/opencode/zilo-t04b-evidence/`.

## Provenance and pending gates

The parent worker is GPT-6.1 Sol. Coordinator-approved implementation and
read-only research helpers were both requested as `openai/gpt-6.1-sol` through
built-in subagents; tool receipts expose session IDs but no independent
effective-model field. Implementation session:
`ses_e6d664f1cffeFWNE2C7aRbTATS`; research session:
`ses_e6d66dd22ffesqmpk3JMvVqkDc`. All helper calls completed before settlement.
No additional Orca workers were launched.

The workflow configures native `ubuntu-latest`, `windows-latest`,
`macos-latest` (arm64), and `macos-15-intel` (x64), with locked restore, Release
build/tests, agent smoke, and always-uploaded logs/TRX. Runner labels and
PowerShell availability were checked against official GitHub documentation.
**No GitHub Actions run or native Windows/macOS execution was performed here.**
Cross-OS CI, GPT-master acceptance and the mandatory independent Claude
cross-model review remain pending before integration. No merge or push was
performed.
