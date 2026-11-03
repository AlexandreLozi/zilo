# T11p Windows storage adapter: Claude review r3 (HIGH, narrow, Opus master)

**Verdict: PASS. The slice is ready for one combined Backend run.**
- **Reviewed:** `c3dec94..a7b05e2` (tested code `9a508b7`, local, not pushed).
- **Not a PASS for:** native acceptance, which waits for the trx.

## Checked
- **Production change matches D-013 addendum 2 exactly.** `BuildRenameInformation(rootPath,
  name)`:
  - validates the canonical root and the fixed target name;
  - builds the full DOS path `root\name` and rejects unpaired surrogates, with a throwing
    `UnicodeEncoding`, so there is no silent replacement;
  - leaves `RootDirectory` at 0, sets `FileNameLength` to the byte count excluding the
    terminator, and appends a 2-byte NUL.
- **Unchanged:** the pinned chain, the pre-validation, the same-handle flush → rename → flush, and
  `ValidateNamed` after the rename. `_rootPath` is now readonly and set in the constructor.
- **ABI test:** byte-level asserts for the union, the zero root, the length, the path bytes and
  the terminator, plus negative cases for the root, the surrogates and the names. The author
  recorded 3 real buffer-mutation RED → GREEN cycles.
- **Diagnosability:**
  - `Native_fresh_directory_direct_fence_replace_roundtrips_bytes` calls `ReplaceAsync` directly,
    so a native error code appears verbatim in the trx.
  - The `Ready` asserts print `DiagnosticCode`.
- **Startup self-test:**
  - The 10 s timeout is **unchanged**. A timeout is now reported as `TimedOut`, with the elapsed
    time, stdout and stderr, and a bounded drain and kill.
  - The assertions are equivalent to before (exit 0, empty stderr, the exact PASS line, both runs
    equal), now carrying failure context.

## Required in the combined run
- One Backend run on the exact head.
- The Windows trx shows every native WindowsConsent* test executed and passed, including the
  direct-replace, process-kill and sharing-violation tests.
- The Mac native tests stay green on arm64 and Intel.
- The arm64 startup self-test passes; if it doesn't, its captured output decides the next step.
- The real native cause of run 1 is confirmed or refuted by the direct test.
- The no-retry availability item and the Linux carry-forwards remain open.
