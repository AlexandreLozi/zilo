# SP-4a: build the dry-run MSI with the pinned WiX tool (.config/dotnet-tools.json, WiX 5.0.2).
# Hosted Windows runner only. Never run on the owner's SAC-enforcing host: WiX is not a
# Microsoft-signed tool (OD-6), and WiX does not support Linux (WIX0000, see docs/spikes/SP-4a.md).
#
# usage: pwsh packaging/windows/build-msi.ps1 -PublishDir <dir> -Out <file.msi> [-Version 0.0.1]
param(
  [Parameter(Mandatory)] [string] $PublishDir,
  [Parameter(Mandatory)] [string] $Out,
  [string] $Version = '0.0.1'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $here
try {
  dotnet tool restore
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  dotnet wix --version
  # D-011: in production, sign every PE under $PublishDir here, before it is embedded.
  dotnet wix build -arch x64 `
    -d "ProductVersion=$Version" -d "PublishDir=$((Resolve-Path $PublishDir).Path)" `
    Zilo.Agent.wxs -o $Out
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  # D-011: in production, sign $Out here.
  Get-Item $Out | Format-List FullName, Length
} finally {
  Pop-Location
}
