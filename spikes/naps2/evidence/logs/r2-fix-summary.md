# T02 fix r2 — F4-r2 and owner M7 licence deferral

- Base: `d30d592458f018abff4e6ba112caab22ee5758de`.
- Branch: `AlexandreLozi/t02-fix-r2`; final commit SHA is supplied in worker_done.
- Coordinator verified actual TUI footer GPT-6.1 Sol / medium before substantive work.
- Read authoritative amended task, main owner directives and joint DISCUSSION licence agreement.

## Reproduction and correction

- Both unchanged Claude F4-r2 regressions reproduced red before edits (2/2).
- Unanchored LICENSE text rule overrode upstream `-text`; staged SDK licence SHA256
  became `dcf0177ab1a32b833ff52c4c33b7c740ac73d23581f231bdfd0b93e84733e040`.
- Removed premature root MIT LICENSE and first-party policy pin, file/hash references.
- Remaining `/Naps2Spike.csproj` and `/Program.cs` LF patterns are root-only.
- Retained complete existing first-party source identity and all four output records.
- Explicit `UNLICENSED`, private pending owner M7; no OSI licence or LicenseRef approval.
- Source SHA512 now hashes actual remaining csproj + Program bytes; generator and projections agree.
- Wrapper rejects first-party approval pins and source metadata/hash drift independently of outcome.
- Gate semantics, allowed-expression set, exceptions and reviewed payloads are unchanged.

## Verification

- Gate suite: `python3 -B -m unittest discover -s tools/license-gate -p 'test_*.py'`: 66/66.
- Spike suite: 28/28, including both unchanged F4-r2 regressions; `r2-fix-spike-tests.log`.
- Initial spike run lacked dotnet/binaries: three runtime errors, not counted as a pass.
- One allowed Linux locked restore/Release publish using SDK 10.0.403 succeeded, 0 warnings/errors.
- Rebuild updated only Linux first-party DLL/PDB hashes/PDB size (path-dependent output).
- All ten full/gate inventories retain identical third-party package/payload records versus base.
- All 72 tracked upstream licence/source evidence files are byte-identical to base/index.
- New scratch staging regression checks raw bytes for all 72 files; LF autocrlf check passes.
- New mutation subcases reject missing source file, source hash drift, source-list omission,
  source-identity omission, licence metadata drift, gate omission/MIT/LicenseRef and policy pin.
- Existing denied-pin/exception and hidden payload-waiver regressions remain passing.
- `actionlint` 1.7.12 passes changed workflow; F4-r2 tests added to gate-tests wiring.
- Python YAML module unavailable; actionlint supplied workflow parsing/lint instead.
- `git diff --check` passes. Local config overrides remain skip-worktree, never staged.

## Exact complete-graph outcomes (wrapper exits 0; raw gate exits 1, denied)

| RID | Packages | Payloads | Errors | Original third-party + new first-party |
|---|---:|---:|---:|---|
| win-x64 |28|79|8|3 + 5|
| win-arm64 |28|78|7|2 + 5|
| osx-arm64 |27|77|5|0 + 5|
| osx-x64 |27|77|5|0 + 5|
| linux-x64 |32|81|19|14 + 5|

Every RID adds one unlicensed first-party missing-pin error and four dependent output denials.
Exact error multisets: `r2-fix-exact-outcomes.log`; every shippingClearance remains false.
No native Windows/macOS execution, unsigned Windows-host run, full five-RID publish or hosted rerun.
Independent Claude r3 remains mandatory before merge; shipping clearance and T06 remain blocked.
