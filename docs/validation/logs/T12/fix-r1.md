# T12 r1 test-only fixes

- Base: `ae0c712bcecebdef2d5aba07a23df905ce6fac79`.
- Tested code commit: `ac14ccdc9a9b664cabd4a1ba757391c26e15d467`.
- Requested effort MEDIUM; coordinator verified effective HIGH and explicitly authorized deviation.
- One bounded fixer subagent edited the test file; parent inspected changes and owned all execution/validation.
  This is a deviation from the requested no-helper constraint; helper model/effort were not disclosed.
- Read full `docs/reviews/T12-r1.md`, task plan and factory handoff; optional P3s deferred.

## Regressions
- `First_acquisition_has_one_based_visible_labels_and_zero_based_metadata`: acquire index 0,
  decode PNG and QR, assert API Index/Sheet and QR page remain 0; independently pinned 5x7
  glyphs assert black large "1" and white banner "P1", including background and spacing pixels.
  Production layout supplies coordinates only; no production font/drawing/fit helper supplies expected pixels.
- `Feeder_three_completes_normally_after_three_zero_based_pages`: default `virtual-feeder-3`,
  null requested completion count, safety limit 5, drain normally and assert exactly indices 0/1/2.

## Mutation evidence (not original implementation TDD red)
- First ran both new tests against correct production: 2 passed, 0 failed/skipped.
- Mutations ran only in archived scratch `/tmp/opencode/t12-fix-r1.HE99dG` with the new tests.
- P2-1: both PageGenerator render calls changed `pageIndex + 1` to `pageIndex`:
  1 failed (large-glyph pixel expected 255, actual 0), 1 passed, exit 1.
- P2-2: positive feeder exhaustion `yield break` replaced by typed `feeder-empty` throw:
  1 failed (new feeder regression, ScanFailureException), 1 passed, exit 1.
- Both scratch production files restored byte-for-byte (`cmp` passed); workspace production never mutated.
  `git diff --quiet ae0c712bcecebdef2d5aba07a23df905ce6fac79 -- backend/src` passed.

## Final verification (Linux)
- SDK executable `/tmp/opencode/t12-proto-r2/sdk/dotnet` (10.0.403).
- `DOTNET_CLI_HOME=/tmp/opencode/t12-proto-r2/home`, `NUGET_PACKAGES=/tmp/opencode/t12-proto-r2/nuget`.
- `dotnet restore backend/Zilo.slnx --locked-mode`: PASS.
- `dotnet build backend/Zilo.slnx -c Release --no-restore`: PASS, 0 warnings/errors.
- `dotnet test backend/tests/Zilo.Drivers.Virtual.Tests/Zilo.Drivers.Virtual.Tests.csproj -c Release --no-build`
  with filter `FullyQualifiedName~First_acquisition_has_one_based_visible_labels_and_zero_based_metadata|FullyQualifiedName~Feeder_three_completes_normally_after_three_zero_based_pages`: 2 passed.
- `dotnet test backend/Zilo.slnx -c Release --no-build`: 42 passed, 0 failed/skipped
  (Virtual 28, Core 7, Scaffold 6, Agent 1).
- `git diff --check ae0c712bcecebdef2d5aba07a23df905ce6fac79`: PASS.
- Raw local logs: `/tmp/opencode/t12-fix-r1-{initial,label-mutation,feeder-mutation,restore,build,final-focused,full}.log`.
- No production/Core/Agent/config/dependency/lock/API/prototype edits; no native Windows or hosted CI rerun.
- Independent narrow Claude r2 mutation review and PASS plus queue remain required; no merge performed.
