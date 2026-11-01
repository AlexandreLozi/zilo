# SP-4a: build the dry-run MSI with the pinned WiX tool (.config/dotnet-tools.json, WiX 5.0.2).
# Hosted Windows runner only. Never run on the owner's SAC-enforcing host: WiX is not a
# Microsoft-signed tool (OD-6), and WiX does not support Linux (WIX0000, see docs/spikes/SP-4a.md).
#
# usage: pwsh packaging/windows/build-msi.ps1 -PublishDir <dir> -Out <file.msi> [-Version 0.0.1]
# Relative -PublishDir/-Out are resolved against the CALLER's working directory, before this
# script changes into its own directory (review T03-r1 finding 2). WiX inputs (the .wxs and the
# tool manifest) are resolved from the script's own directory.
param(
  [Parameter(Mandatory)] [string] $PublishDir,
  [Parameter(Mandatory)] [string] $Out,
  [string] $Version = '0.0.1'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$caller = (Get-Location).Path
$PublishDir = [System.IO.Path]::GetFullPath($PublishDir, $caller)
$Out = [System.IO.Path]::GetFullPath($Out, $caller)
if (-not (Test-Path -LiteralPath (Join-Path $PublishDir 'Zilo.Agent.exe') -PathType Leaf)) {
  throw "publish dir $PublishDir has no Zilo.Agent.exe"
}
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
$wxs = Join-Path $here 'Zilo.Agent.wxs'

Push-Location $here
try {
  dotnet tool restore
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  dotnet wix --version
  # D-011: in production, sign every PE under $PublishDir here, before it is embedded.
  dotnet wix build -arch x64 `
    -d "ProductVersion=$Version" -d "PublishDir=$PublishDir" `
    $wxs -o $Out
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not (Test-Path -LiteralPath $Out -PathType Leaf) -or (Get-Item -LiteralPath $Out).Length -eq 0) {
    throw "WiX reported success but $Out is missing or empty"
  }
  # D-011: in production, sign $Out here.
  Get-Item $Out | Format-List FullName, Length
} finally {
  Pop-Location
}
