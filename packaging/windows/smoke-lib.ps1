# Helpers shared by install-smoke.ps1 and smoke-lib-selftest.ps1. Strict-mode safe.

# True when $Item (the result of Get-ItemProperty, possibly $null for an absent or empty key)
# carries a property named $Name. Never dereferences a missing member.
function Test-HasValue($Item, [string] $Name) {
  if ($null -eq $Item) { return $false }
  return @($Item.PSObject.Properties | Where-Object { $_.Name -eq $Name }).Count -gt 0
}

# True when registry value $Name exists under $Path. Absent key -> $false; key without values -> $false.
function Test-RegValuePresent([string] $Path, [string] $Name) {
  if (-not (Test-Path $Path)) { return $false }
  return Test-HasValue (Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue) $Name
}
