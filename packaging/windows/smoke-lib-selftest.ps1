# Self-test of the Run-value absence assertion (review T03-r2 finding 1). Strict mode on.
# Without -Registry it tests the object-level check only (runs on Linux pwsh).
# With -Registry it uses a throwaway HKCU test key (hosted Windows runner only; installs nothing).
param([switch] $Registry)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'smoke-lib.ps1')
$failed = 0
function Check($label, $present, $expectFail) {
  $wouldFail = [bool]$present
  $ok = $wouldFail -eq $expectFail
  $verdict = if ($wouldFail) { 'assertion FAILS' } else { 'assertion continues' }
  Write-Host ("{0} {1}: {2}" -f ($(if ($ok) { 'OK  ' } else { 'BAD ' }), $label, $verdict))
  if (-not $ok) { $script:failed++ }
}

Write-Host '--- object-level'
Check '(a) key absent (null item)'          (Test-HasValue $null 'ZiloAgent') $false
Check '(b) key without ZiloAgent'           (Test-HasValue ([pscustomobject]@{ Other = 'x' }) 'ZiloAgent') $false
Check '(c) key retains ZiloAgent'           (Test-HasValue ([pscustomobject]@{ ZiloAgent = 'x' }) 'ZiloAgent') $true

if ($Registry) {
  Write-Host '--- registry (throwaway HKCU key)'
  $k = 'HKCU:\Software\ZiloSmokeSelfTest'
  if (Test-Path $k) { Remove-Item -Recurse -Force $k }
  Check '(a) key absent'                    (Test-RegValuePresent $k 'ZiloAgent') $false
  New-Item $k | Out-Null
  Check '(b0) key exists, no values'        (Test-RegValuePresent $k 'ZiloAgent') $false
  New-ItemProperty -Path $k -Name Other -Value 'x' -PropertyType String | Out-Null
  Check '(b) key exists without ZiloAgent'  (Test-RegValuePresent $k 'ZiloAgent') $false
  New-ItemProperty -Path $k -Name ZiloAgent -Value 'x' -PropertyType String | Out-Null
  Check '(c) key retains ZiloAgent'         (Test-RegValuePresent $k 'ZiloAgent') $true
  Remove-Item -Recurse -Force $k
}

if ($failed) { Write-Host "SELFTEST FAIL ($failed)"; exit 1 }
Write-Host 'SELFTEST PASS'
