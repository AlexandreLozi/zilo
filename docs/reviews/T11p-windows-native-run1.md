# T11p Windows adapter: first native run analysis (Opus master)

Run: Backend CI **41570527419** on exactly **c3dec94** (the single combined run). Packaging
41570527450 is green on all 5 jobs.

## Result: NOT accepted
- **ubuntu and macos-15-intel:** green.
- **windows-latest:** Agent 248 passed, **20 failed**, 16 skipped. The native tests **executed**,
  which is the evidence this run had to provide.
- **macos-latest (arm64):** 1 failure, `StartupTests.Self_test_exits_successfully_without_starting_a_listener`.
  Every Mac storage test passed.

## Windows: one root cause, most likely
- **Pattern:** every test that needs a successful first `ConsentSession.OpenAsync` on a fresh store
  fails with `Unavailable`. These tests do pass natively:
  - `Open` itself: the root is owned and protected and can't be renamed while pinned;
  - the lifetime lock: a second open fails until dispose;
  - Open-level rejections: null or unprotected DACL, unknown principal, reparse ancestors,
    failed-open unwind.
- So `Open` and `Validate` work. The failure is in the first `ReplaceAsync("session.fence")`,
  or in `ReadAsync`.
- **Most likely:**
  - `SetFileInformationByHandle(FileRenameInfo)` in KernelBase converts `FileName` with
    `RtlDosPathNameToNtPathName_U` unconditionally. Wine mirrors this. A bare relative name
    becomes an absolute NT path based on the current directory, while `RootDirectory` is still
    set, so the NT rename is rejected as an invalid parameter or path.
  - This means the documented-looking "handle-relative rename" cannot work through the Win32
    wrapper.
  - Not yet proven: the session maps every IOException to `consent-storage-unavailable`, so the
    native error code is not in the trx.
- **Fix, recommended:** call `SetFileInformationByHandle(FileRenameInfo)` with the **full DOS
  path** `_rootPath\name` and `RootDirectory = NULL`.
  - It is as safe as before: every chain directory is pinned without `FILE_SHARE_DELETE`, so the
    path resolves to the same root.
  - `ValidateNamed(name, temp)` after the rename already proves the identity.
  - The buffer is `FIELD_OFFSET(FileName) + bytes`, with a terminator for safety.
  - The alternative, `NtSetInformationFile(FileRenameInformation)` with the handle-relative name,
    is also acceptable but adds NTSTATUS plumbing.
- **Diagnosability, required in the same fix:**
  - Add one native adapter-level test that calls `directory.ReplaceAsync` directly on a fresh
    store and asserts success, so that any native error code (`:87`, `:123`, ...) surfaces
    verbatim in the trx.
  - Native tests that assert `Ready` should include `DiagnosticCode` in the failure message.
- After the fix: run the full local suite, Claude narrow r3 on the diff, then **one** Backend
  run, which may be `workflow_dispatch` on the branch, Windows only plus macos-latest if
  practical. Every native WindowsConsent* test must have executed and passed.

## macOS arm64 startup self-test
- `RunAgentAsync` has a **10 s** timeout for starting the agent process and waiting for it to
  exit. On c3dec94 it timed out (OperationCanceledException at `WaitForExitAsync`, 14 s
  total).
- The same test passed on arm64 on 38a859b (attempt 3), b460df9 (41567150592) and 22d5194
  (41568194417). c3dec94 does not change agent startup, so it is treated as a cold-runner
  timeout candidate, **not waived**.
- The next run re-exercises it. If it recurs, capture the agent's stdout and stderr and its
  timing, and consider a bounded timeout only with evidence.

## Port test (observation)
`RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback` passed on Windows on c3dec94,
and on both `t11-port-flake` pushes (b460df9 and 22d5194, each a full 4-OS run that went green).
That is 3/3 on Windows since the client-disposal change. It is supporting evidence, not proof
of root cause.

Note: those two `t11-port-flake` pushes each started a full matrix. That is outside the
"one combined run" plan, though harmless now that minutes are free (OD-16).
