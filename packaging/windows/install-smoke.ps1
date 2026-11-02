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
. (Join-Path $PSScriptRoot 'smoke-lib.ps1')
New-Item -ItemType Directory -Force $LogDir | Out-Null
$msiPath = (Resolve-Path $Msi).Path
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Zilo'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$protoKey = 'HKCU:\Software\Classes\zilo'
$ownKey = 'HKCU:\Software\Zilo\Agent'
$siblingKey = 'HKCU:\Software\Zilo\SmokeSiblingSentinel'  # NOT ours: must survive uninstall
function Fail($m) { Write-Host "SMOKE FAIL: $m"; exit 1 }
function Msiexec($argList) {
  $p = Start-Process msiexec.exe -ArgumentList $argList -Wait -PassThru -NoNewWindow
  return $p.ExitCode
}

Write-Host '=== pre-existing sibling sentinel under the vendor key (owned by someone else)'
# Never `New-Item -Force` an existing vendor key (that would recreate it); create only what is missing.
if (-not (Test-Path 'HKCU:\Software\Zilo')) { New-Item 'HKCU:\Software\Zilo' | Out-Null }
if (-not (Test-Path $siblingKey)) { New-Item $siblingKey | Out-Null }
New-ItemProperty -Path $siblingKey -Name Sentinel -Value 'keep-me' -PropertyType String -Force | Out-Null

Write-Host '=== install (per-user, quiet, no elevation requested)'
$rc = Msiexec @('/i', "`"$msiPath`"", '/qn', '/norestart', '/l*v', "`"$LogDir\install.log`"")
if ($rc -ne 0) { Fail "msiexec /i exit $rc" }

Write-Host '=== files'
$expected = 'Zilo.Agent.exe','Zilo.Agent.dll','Zilo.Agent.deps.json','Zilo.Agent.runtimeconfig.json',
            'Zilo.Core.dll','Zilo.Drivers.Naps2.dll','Zilo.Drivers.Virtual.dll','Zilo.Security.dll','zxing.dll'
foreach ($f in $expected) { if (-not (Test-Path (Join-Path $installDir $f))) { Fail "missing $f" } }
Get-ChildItem $installDir | Format-Table Name, Length

Write-Host '=== owned marker key (HKCU)'
if ((Get-ItemProperty $ownKey -Name Installed).Installed -ne 1) { Fail 'HKCU\Software\Zilo\Agent\Installed' }

Write-Host '=== autostart and zilo:// registration (HKCU)'
$run = (Get-ItemProperty $runKey -Name ZiloAgent).ZiloAgent
Write-Host "Run\ZiloAgent = $run"
if ($run -ne "`"$installDir\Zilo.Agent.exe`"") { Fail 'Run key value' }
if ((Get-ItemProperty $protoKey -Name 'URL Protocol') -eq $null) { Fail 'URL Protocol value' }
$cmd = (Get-ItemProperty "$protoKey\shell\open\command").'(default)'
Write-Host "zilo open command = $cmd"
if ($cmd -ne "`"$installDir\Zilo.Agent.exe`" `"%1`"") { Fail 'zilo open command' }

Write-Host '=== bounded agent self-test (framework-dependent; hosted runner has the .NET runtime)'
$agentStdout = Join-Path $LogDir 'agent-self-test.stdout.log'
$agentStderr = Join-Path $LogDir 'agent-self-test.stderr.log'
$agent = Start-Process -FilePath (Join-Path $installDir 'Zilo.Agent.exe') `
  -ArgumentList @('--self-test') -RedirectStandardOutput $agentStdout `
  -RedirectStandardError $agentStderr -PassThru -NoNewWindow
if (-not $agent.WaitForExit(30000)) {
  try {
    $agent.Kill()
  } catch {
    Fail "agent self-test timed out after 30 seconds and could not be terminated: $($_.Exception.Message)"
  }
  Fail 'agent self-test timed out after 30 seconds'
}
$agent.WaitForExit()
$out = [IO.File]::ReadAllText($agentStdout)
$err = [IO.File]::ReadAllText($agentStderr)
Write-Host $out
if ($agent.ExitCode -ne 0) { Fail "agent self-test exit $($agent.ExitCode): $out$err" }
if ($out.TrimEnd([char[]]"`r`n") -ne 'Zilo.Agent self-test: PASS') { Fail "unexpected agent self-test output: $out" }
if ($err.TrimEnd([char[]]"`r`n") -ne '') { Fail "agent self-test stderr: $err" }

Write-Host '=== installed Virtual factory and ZXing dependency load (hosted .NET only)'
# Compile only against installed assemblies; never copy them into the proof output. The
# separate process resolves dependencies exclusively from the real MSI installation.
$proofDir = Join-Path (Resolve-Path $LogDir).Path 'installed-payload-proof'
New-Item -ItemType Directory -Force $proofDir | Out-Null
$escapedInstall = [System.Security.SecurityElement]::Escape($installDir)
@"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup>
  <ItemGroup>
    <Reference Include="Zilo.Core"><HintPath>$escapedInstall\Zilo.Core.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="Zilo.Drivers.Virtual"><HintPath>$escapedInstall\Zilo.Drivers.Virtual.dll</HintPath><Private>false</Private></Reference>
  </ItemGroup>
</Project>
"@ | Set-Content (Join-Path $proofDir 'InstalledPayloadProof.csproj')
Copy-Item (Join-Path $PSScriptRoot '../../docs/validation/logs/T12/fix-r2/InstalledPayloadProof.cs') (Join-Path $proofDir 'Program.cs')
& dotnet build (Join-Path $proofDir 'InstalledPayloadProof.csproj') -c Release -o (Join-Path $proofDir 'out')
if ($LASTEXITCODE -ne 0) { Fail 'installed payload proof build' }
& dotnet (Join-Path $proofDir 'out/InstalledPayloadProof.dll') $installDir
if ($LASTEXITCODE -ne 0) { Fail 'installed Virtual/ZXing load' }

Write-Host '=== uninstall'
$rc = Msiexec @('/x', "`"$msiPath`"", '/qn', '/norestart', '/l*v', "`"$LogDir\uninstall.log`"")
if ($rc -ne 0) { Fail "msiexec /x exit $rc" }
if (Test-Path $installDir) { Fail "$installDir left behind" }
if (Test-RegValuePresent $runKey 'ZiloAgent') { Fail 'Run key left behind' }
Write-Host 'Run\ZiloAgent removed'
if (Test-Path $protoKey) { Fail 'zilo:// key left behind' }
if (Test-Path $ownKey) { Fail 'HKCU\Software\Zilo\Agent left behind' }
if ((Get-ItemProperty $siblingKey -Name Sentinel -ErrorAction SilentlyContinue).Sentinel -ne 'keep-me') {
  Fail 'uninstall removed a sibling key it does not own (HKCU\Software\Zilo\SmokeSiblingSentinel)'
}
Write-Host 'sibling sentinel survived uninstall'
Remove-Item -Recurse -Force $siblingKey
Write-Host 'MSI SMOKE PASS'
