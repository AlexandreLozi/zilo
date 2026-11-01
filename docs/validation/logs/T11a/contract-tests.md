# T11a focused evidence

SDK: `/tmp/opencode/t12-proto-r2/sdk/dotnet` (10.0.403). The host did not have `dotnet` on PATH,
so commands below use the supplied SDK path.

## TDD red

After adding the revised contract tests, before the acquisition-boundary implementation:

```text
/tmp/opencode/t12-proto-r2/sdk/dotnet test backend/tests/Zilo.Core.Tests/Zilo.Core.Tests.csproj --no-restore
...
error CS7036: no argument given for ScanRequest.Limits
error CS1503: adjustment scalar/page contract mismatch
```

## Green

```text
/tmp/opencode/t12-proto-r2/sdk/dotnet restore backend/tests/Zilo.Core.Tests/Zilo.Core.Tests.csproj --locked-mode
/tmp/opencode/t12-proto-r2/sdk/dotnet test backend/tests/Zilo.Core.Tests/Zilo.Core.Tests.csproj --no-restore
Passed! Failed: 0, Passed: 7, Skipped: 0, Total: 7

/tmp/opencode/t12-proto-r2/sdk/dotnet restore backend/tests/Zilo.Scaffold.Tests/Zilo.Scaffold.Tests.csproj --locked-mode
/tmp/opencode/t12-proto-r2/sdk/dotnet test backend/tests/Zilo.Scaffold.Tests/Zilo.Scaffold.Tests.csproj --no-restore
Passed! Failed: 0, Passed: 3, Skipped: 0, Total: 3
```

Final mechanical follow-up rerun retained the same 7 focused green tests after adding newline
identifier rejection, finite-limit guards, duplex ordering, backend-disposal retention, and copied
page adjustment assertions.

The newline regression was also run red against the old `$` patterns: the identifier test failed with
`Assert.Throws() Failure: No exception was thrown`; restoring `\A...\z` made the focused suite green.

## Final whole-solution gate (Linux, 2026-11-01)

The final page-content encoding assertion was first run red: CS1061, `Page` had no `ContentType`.
After adding the immutable encoding property (default `image/png`), the following all exited 0:

```text
/tmp/opencode/t12-proto-r2/sdk/dotnet restore backend/Zilo.slnx --locked-mode
/tmp/opencode/t12-proto-r2/sdk/dotnet build backend/Zilo.slnx --configuration Release --no-restore
/tmp/opencode/t12-proto-r2/sdk/dotnet test backend/Zilo.slnx --configuration Release --no-build --no-restore
git diff --check
```

Build: 0 warnings, 0 errors. Tests: Core 7, Scaffold 6, Agent 1; total 14 passed, 0 failed,
0 skipped. The scaffold count includes the four dependency-direction cases replacing obsolete
empty-type checks; the actual no-NAPS2 restored-package guard remains unchanged.

The finite streaming examples are deterministic test fakes, not a production backend or hardware
certification. No cross-OS execution, HTTP/auth, storage/export, native Windows, performance,
or five-OS support claim is made. Independent Claude MEDIUM review and Opus merge are still required;
T11/T12 must not start from an unreviewed/unmerged interface.
