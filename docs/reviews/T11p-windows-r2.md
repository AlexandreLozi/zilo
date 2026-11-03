# T11p Windows storage adapter: Claude review r2 (HIGH, narrow, Opus master)

**Verdict: PASS. The slice is ready for the single combined hosted run.**
- **Reviewed:** `caa7b74..c3dec94` (tested code `c3bc032`, local, not pushed).
- **Not a PASS for:** native Windows acceptance, which waits for that run's trx, or full T11p.

## r1 items
- **P2-1, native fixtures: closed (authored).**
  - A foreign Administrators owner on the root and on `consent.json`.
  - Inherited, deny, `Everyone` and callback ACEs on the root and the file. Each fixture
    asserts that the descriptor it built is the one intended, and that the descriptor is
    byte-identical after the rejection: no repair.
  - A real child-process kill before the rename (`WindowsConsentProcessTests`). The child is the
    xunit v3 executable run with `-method` and a named-pipe checkpoint signal. The parent kills
    the whole tree, then reopens: the old snapshot is intact, the interrupted state is
    reported, and the health is Unavailable.
  - An external handle on the target without `FILE_SHARE_DELETE`. It asserts the native error is
    `:32` or `:5`, the trace stops before the final flush, the temp is preserved, the old bytes
    are kept, the adapter is poisoned, and the reopen reports `consent-interrupted-state`.
- **P2-2: closed by the co-approved no-retry trade-off.** It is recorded in the report as an OPEN
  item for recovery, full T11p and pre-M6 availability, with the "temps retained, restart is not
  automatic recovery" warning.
- **P3-1: closed.** `RequireAceSidBounds` checks `8 ≤ sid ≤ 68` and `sid ≤ AceSize − 8`, before
  `SidAt`, and pure tests cover it.
- **P3-2: closed.**
  - Non-private ancestors open with `FILE_READ_ATTRIBUTES|SYNCHRONIZE` only (`0x00100080`,
    tested). `READ_CONTROL` is added only where the privacy check runs.
  - `GetFileType` and `GetFileInformationByHandle` need nothing more.
  - `CreatePrivateDirectory` now reports `created` honestly: a racing `ALREADY_EXISTS` is not
    treated as ours.
- **P3-3: closed.** The leftover temp behaviour is recorded as the recovery contract input.

## Note (non-blocking)
`ValidateChain` now reopens the root with `GENERIC_READ|GENERIC_WRITE` for its fresh comparison.
That's compatible with the pinned handle's share modes, but the comparison only needs
`READ_CONTROL|FILE_READ_ATTRIBUTES|SYNCHRONIZE`. Tighten it in a later slice.

## Required in the combined run
- One Backend run on the exact reviewed head, covering windows-latest, macos-latest (arm64),
  macos-15-intel and ubuntu.
- The **Windows trx must show the native WindowsConsent* tests executed and passed**, not
  skipped. That includes the process-kill test and the sharing-violation test.
- The Mac native tests must stay green on arm64 and Intel.
- The port test is a recorded observation, and a recurrence triggers socket and PID capture.
- The Linux carry-forwards (unskipped ACL test with `acl` installed, runtime-only libc proof,
  `IsVolatile`) remain tracked and are not waived.
