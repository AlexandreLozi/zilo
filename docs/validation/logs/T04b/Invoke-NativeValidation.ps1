param(
    [Parameter(Mandatory)][string] $TaskRoot,
    [string] $SourceSha = '7624bfa5ca9621c01149e16ad6cc7df8f023dd30',
    [switch] $Supplemental
)
# Task-authored validation only. Run normally with pwsh -File; no policy changes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSStyle.OutputRendering = 'PlainText'
if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7) { throw 'Native Windows pwsh 7 required' }
$source = Join-Path $TaskRoot 'source checkout'
$sdk = Join-Path $TaskRoot 'dotnet'
$dotnet = Join-Path $sdk 'dotnet.exe'
$logs = Join-Path $source 'backend/artifacts/logs'
$env:DOTNET_ROOT = $sdk
$env:DOTNET_ROOT_X64 = $sdk
$env:PATH = "$sdk;$env:PATH"
$env:DOTNET_CLI_HOME = Join-Path $TaskRoot 'cli-home'
$env:NUGET_PACKAGES = Join-Path $TaskRoot 'nuget-empty-cache'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:RestoreLockedMode = 'true'
$env:CI = 'true'
Set-Location $source
if (-not $Supplemental) {
    if (Test-Path $env:NUGET_PACKAGES) { throw 'Fresh package cache required' }
    if (@(Get-ChildItem backend -Recurse -Directory | Where-Object Name -in 'bin', 'obj').Count) { throw 'Source must start without bin/obj' }
}
New-Item -ItemType Directory -Force $logs | Out-Null
Write-Output "SOURCE_SHA=$SourceSha (externally verified git archive; not a rebased queue SHA)"
Write-Output "OS=$([Environment]::OSVersion.VersionString)"
Write-Output "ARCH=$([Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"
Write-Output "PWSH=$($PSVersionTable.PSVersion)"
Write-Output "PSNativeCommandUseErrorActionPreference=$PSNativeCommandUseErrorActionPreference"
Write-Output "ExecutionPolicy=$(Get-ExecutionPolicy) (unchanged)"
Write-Output "WINDOWS_LOCAL_SOURCE=$source"
Write-Output "MODE=$(if ($Supplemental) { 'supplemental only; no solution restore/build/test replay' } else { 'fresh workflow; initial bin/obj and package cache absent' }); CI=true; RestoreLockedMode=true"
& $dotnet --info
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$sourceHashes = @{}
Get-ChildItem . -Recurse -File | Where-Object FullName -NotMatch '\\(bin|obj|artifacts)\\' | ForEach-Object {
    $sourceHashes[$_.FullName] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
}

function Invoke-WorkflowStep([string] $Name, [string[]] $NativeArgs) {
    Write-Output "COMMAND: dotnet $($NativeArgs -join ' ') 2>&1 | Tee-Object backend/artifacts/logs/$Name.log"
    & $dotnet @NativeArgs 2>&1 | Tee-Object (Join-Path $logs "$Name.log")
    $code = $LASTEXITCODE
    Write-Output "EXIT: $code ($Name; workflow if LASTEXITCODE -ne 0 => exit)"
    if ($code -ne 0) { exit $code }
}

if (-not $Supplemental) {
    Invoke-WorkflowStep 'restore' @('restore', 'backend/Zilo.slnx', '--locked-mode')
    Invoke-WorkflowStep 'build' @('build', 'backend/Zilo.slnx', '--configuration', 'Release', '--no-restore')
    Invoke-WorkflowStep 'test' @('test', 'backend/Zilo.slnx', '--configuration', 'Release', '--no-build', '--no-restore', '-p:RestoreLockedMode=true', '--logger', 'trx', '--results-directory', "$PWD/backend/artifacts/test-results")
}
Invoke-WorkflowStep 'agent' @('backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll')

$passed = 0
Get-ChildItem backend/artifacts/test-results -Filter '*.trx' | ForEach-Object {
    [xml] $trx = Get-Content $_.FullName -Raw
    $c = $trx.TestRun.ResultSummary.Counters
    Write-Output "TRX: total=$($c.total) executed=$($c.executed) passed=$($c.passed) failed=$($c.failed)"
    # Report the original run, including policy failures; never reinterpret as green.
    $passed += [int] $c.passed
}
Write-Output "ORIGINAL_WORKFLOW_TEST_PASSED_COUNT=$passed (6 required for acceptance)"

# Compare every runtime output file, including the Windows apphost, recursively.
$agentDir = Join-Path $source 'backend/src/Zilo.Agent/bin/Release/net10.0'
$copyDir = Join-Path $source 'backend/tests/Zilo.Agent.Tests/bin/Release/net10.0/agent'
$originalFiles = @(Get-ChildItem $agentDir -File -Recurse)
$copiedFiles = @(Get-ChildItem $copyDir -File -Recurse)
if ($originalFiles.Count -ne $copiedFiles.Count) { throw 'Copy file count differs' }
foreach ($f in $originalFiles) {
    $relative = [IO.Path]::GetRelativePath($agentDir, $f.FullName)
    $copied = Join-Path $copyDir $relative
    if ((Get-FileHash $f.FullName).Hash -ne (Get-FileHash $copied).Hash) { throw "Copy mismatch: $relative" }
    Write-Output "COPY_SHA256_MATCH: $relative"
}
Write-Output "COPY: $($originalFiles.Count) files, exact relative paths and SHA256 matches"

function Test-AgentProcess([string] $Name, [string] $Executable, [string[]] $NativeArgs) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($arg in $NativeArgs) { $start.ArgumentList.Add($arg) }
    $p = [Diagnostics.Process]::Start($start)
    try {
        $outTask = $p.StandardOutput.ReadToEndAsync()
        $errTask = $p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit(10000)) { throw "$Name timed out" }
        $stdout = $outTask.GetAwaiter().GetResult()
        $stderr = $errTask.GetAwaiter().GetResult()
        if ($p.ExitCode -ne 0 -or $stderr.Length -ne 0 -or $stdout -cne "Zilo.Agent scaffold: scanning is not implemented.`r`n") { throw "$Name unexpected exit/output" }
        $bytes = [Text.Encoding]::UTF8.GetBytes($stdout)
        Write-Output "SMOKE: $Name exit=$($p.ExitCode) stderrBytes=0 stdoutBytes=$($bytes.Length) exactNotice=true finalBytes=$($bytes[-2].ToString('X2')) $($bytes[-1].ToString('X2'))"
    } finally {
        if (-not $p.HasExited) { $p.Kill($true); $p.WaitForExit() }
        $p.Dispose()
    }
}
Test-AgentProcess 'built DLL' $dotnet @((Join-Path $agentDir 'Zilo.Agent.dll'))
Test-AgentProcess 'built Windows apphost' (Join-Path $agentDir 'Zilo.Agent.exe') @()
Test-AgentProcess 'copied DLL' $dotnet @((Join-Path $copyDir 'Zilo.Agent.dll'))
Test-AgentProcess 'copied Windows apphost' (Join-Path $copyDir 'Zilo.Agent.exe') @()

# Dotnet itself is absolute; the startup child must use DOTNET_HOST_PATH.
$savedPath = $env:PATH
try {
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    if (Get-Command dotnet -ErrorAction SilentlyContinue) { throw 'dotnet unexpectedly on constrained PATH' }
    Invoke-WorkflowStep 'test-no-dotnet-on-path' @('test', 'backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj', '--configuration', 'Release', '--no-build', '--no-restore')
} finally { $env:PATH = $savedPath }

# Exercise precisely the pwsh pipeline/exit guard used by Actions, not PS5.1.
Write-Output 'COMMAND: cmd.exe /d /c "echo expected-native-stderr 1>&2 & exit /b 23" 2>&1 | Tee-Object <pipeline.log>'
$before = $Error.Count
& "$env:SystemRoot\System32\cmd.exe" /d /c 'echo expected-native-stderr 1>&2 & exit /b 23' 2>&1 | Tee-Object (Join-Path $logs 'pipeline.log')
$nativeExit = $LASTEXITCODE
if ($nativeExit -ne 23 -or $Error.Count -ne $before) { throw 'pwsh pipeline native stderr/exit semantics differ' }
Write-Output "PWSH_PIPELINE: nativeExit=$nativeExit guardWouldExit=23 additionalPowerShellErrors=0 ErrorActionPreference=Stop"
$guard = '& $env:ComSpec /d /c "echo guard-stderr 1>&2 & exit /b 23" 2>&1 | Tee-Object -FilePath (Join-Path $env:TEMP "zilo-t04b-native-guard.log"); if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
$guard = $guard.Replace('(Join-Path $env:TEMP "zilo-t04b-native-guard.log")', ('"' + (Join-Path $TaskRoot 'guard.log') + '"'))
& (Join-Path $PSHOME 'pwsh.exe') -NoLogo -NoProfile -Command ('$ErrorActionPreference="Stop"; ' + $guard)
if ($LASTEXITCODE -ne 23) { throw 'Workflow exit guard did not return failing native code' }
Write-Output 'PWSH_CHILD_GUARD: processExit=23 (expected intentional failure preserved)'

# Scratch-only probe projects; no reviewed source file is edited.
foreach ($relative in @('spikes/naps2/Probe', 'backendx/Probe', 'tools/x/Probe', 'backend/src/Zilo.Probe')) {
    $dir = Join-Path $source $relative
    New-Item -ItemType Directory -Force $dir | Out-Null
    $project = Join-Path $dir 'Probe.csproj'
    [IO.File]::WriteAllText($project, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
    Write-Output "COMMAND: dotnet msbuild $relative/Probe.csproj -getProperty:TargetFramework,ManagePackageVersionsCentrally,TreatWarningsAsErrors,RestorePackagesWithLockFile,RestoreLockedMode,ContinuousIntegrationBuild -getItem:PackageVersion"
    $json = & $dotnet msbuild $project '-getProperty:TargetFramework,ManagePackageVersionsCentrally,TreatWarningsAsErrors,RestorePackagesWithLockFile,RestoreLockedMode,ContinuousIntegrationBuild' '-getItem:PackageVersion'
    if ($LASTEXITCODE -ne 0) { throw 'Probe MSBuild failed' }
    $result = ($json -join "`n") | ConvertFrom-Json
    $p = $result.Properties
    $inside = $relative.StartsWith('backend/')
    if ($p.TargetFramework -ne $(if ($inside) { 'net10.0' } else { 'net8.0' })) { throw 'TFM isolation failed' }
    foreach ($name in @('ManagePackageVersionsCentrally', 'TreatWarningsAsErrors', 'RestorePackagesWithLockFile', 'RestoreLockedMode', 'ContinuousIntegrationBuild')) {
        if ($inside -and $p.$name -ne 'true') { throw "Expected true: $relative $name" }
        if (-not $inside -and $p.$name -eq 'true') { throw "Expected unset/false: $relative $name" }
    }
    if (@($result.Items.PackageVersion).Count -ne $(if ($inside) { 3 } else { 0 })) { throw 'PackageVersion isolation failed' }
    Write-Output "PATH_PROBE: $relative TFM=$($p.TargetFramework) CPM=$($p.ManagePackageVersionsCentrally) WarningsAsErrors=$($p.TreatWarningsAsErrors) Lock=$($p.RestorePackagesWithLockFile) Locked=$($p.RestoreLockedMode) CIBuild=$($p.ContinuousIntegrationBuild) PackageVersionCount=$(@($result.Items.PackageVersion).Count)"
}
foreach ($file in $sourceHashes.Keys) {
    if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $sourceHashes[$file]) { throw "Original source changed: $file" }
}
Write-Output "SOURCE_INTEGRITY: all $($sourceHashes.Count) original archive files unchanged, including all 7 lock files"
Write-Output 'RESULT: supplemental copy/CRLF/path/pwsh7 checks PASS; original workflow test result remains independently authoritative'
