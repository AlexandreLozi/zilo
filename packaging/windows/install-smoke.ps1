# SP-4a MSI install/uninstall smoke. HOSTED WINDOWS RUNNER ONLY (no Smart App Control there).
# Never run on the owner's host: it executes an unsigned installer (OD-6 -> blocked-by-host-SAC).
#
# usage: pwsh packaging/windows/install-smoke.ps1 -Msi <file.msi> -LogDir <dir>
param(
  [Parameter(Mandatory)] [string] $Msi,
  [Parameter(Mandatory)] [string] $LogDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
New-Item -ItemType Directory -Force $LogDir | Out-Null
$msiPath = (Resolve-Path $Msi).Path
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Zilo'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$protoKey = 'HKCU:\Software\Classes\zilo'
function Fail($m) { Write-Host "SMOKE FAIL: $m"; exit 1 }
function Msiexec($argList) {
  $p = Start-Process msiexec.exe -ArgumentList $argList -Wait -PassThru -NoNewWindow
  return $p.ExitCode
}

Write-Host '=== install (per-user, quiet, no elevation requested)'
$rc = Msiexec @('/i', "`"$msiPath`"", '/qn', '/norestart', '/l*v', "`"$LogDir\install.log`"")
if ($rc -ne 0) { Fail "msiexec /i exit $rc" }

Write-Host '=== files'
$expected = 'Zilo.Agent.exe','Zilo.Agent.dll','Zilo.Agent.deps.json','Zilo.Agent.runtimeconfig.json',
            'Zilo.Core.dll','Zilo.Drivers.Naps2.dll','Zilo.Drivers.Virtual.dll','Zilo.Security.dll'
foreach ($f in $expected) { if (-not (Test-Path (Join-Path $installDir $f))) { Fail "missing $f" } }
Get-ChildItem $installDir | Format-Table Name, Length

Write-Host '=== autostart and zilo:// registration (HKCU)'
$run = (Get-ItemProperty $runKey -Name ZiloAgent).ZiloAgent
Write-Host "Run\ZiloAgent = $run"
if ($run -ne "`"$installDir\Zilo.Agent.exe`"") { Fail 'Run key value' }
if ((Get-ItemProperty $protoKey -Name 'URL Protocol') -eq $null) { Fail 'URL Protocol value' }
$cmd = (Get-ItemProperty "$protoKey\shell\open\command").'(default)'
Write-Host "zilo open command = $cmd"
if ($cmd -ne "`"$installDir\Zilo.Agent.exe`" `"%1`"") { Fail 'zilo open command' }

Write-Host '=== agent runs (framework-dependent; hosted runner has the .NET runtime)'
$out = & (Join-Path $installDir 'Zilo.Agent.exe')
Write-Host $out
if ($LASTEXITCODE -ne 0 -or $out -ne 'Zilo.Agent scaffold: scanning is not implemented.') { Fail 'agent run' }

Write-Host '=== uninstall'
$rc = Msiexec @('/x', "`"$msiPath`"", '/qn', '/norestart', '/l*v', "`"$LogDir\uninstall.log`"")
if ($rc -ne 0) { Fail "msiexec /x exit $rc" }
if (Test-Path $installDir) { Fail "$installDir left behind" }
if ((Get-ItemProperty $runKey -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'ZiloAgent') { Fail 'Run key left behind' }
if (Test-Path $protoKey) { Fail 'zilo:// key left behind' }
if (Test-Path 'HKCU:\Software\Zilo') { Fail 'HKCU\Software\Zilo left behind' }
Write-Host 'MSI SMOKE PASS'
