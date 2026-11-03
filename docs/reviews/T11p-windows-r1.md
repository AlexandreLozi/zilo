# T11p Windows storage adapter: Claude review r1 (HIGH, Opus master)

**Verdict: CHANGES. There is no security P1; two P2 test-readiness items are needed before the
single combined hosted run, plus three P3s.**

- **Reviewed:** local head `caa7b74` on `AlexandreLozi/t11p-integration`, not pushed.
  - Adapter `4fbec92`: `WindowsConsentDirectory.cs` and its tests.
  - Tested composition `f3de1be`, with the GPT-reviewed port-test candidate b460df9 + 22d5194.
  - The author report `docs/validation/logs/T11p/windows/report.md`.
- **Scope:** the slice only. There is no native Windows evidence yet; its matrix is entirely
  PENDING, as the report honestly says.
- **Local evidence (author):**
  - locked restore and Release build, with 0 warnings;
  - targeted tests: 17 passed, 18 skipped;
  - full suite (flock-serialized): 266 passed, 32 skipped, 0 failed.

## Checked and correct
- **Platform guard first.** `RequireSupportedPlatform` runs before any identity or Win32 call,
  including the `SecurityIdentifier` field initializers, which run in the constructor after it.
- **ABI layouts (Win64):**
  - `SECURITY_ATTRIBUTES`: 24 bytes, with the pointer at 8 and the BOOL at 16.
  - `BY_HANDLE_FILE_INFORMATION`: 52 bytes; the serial, size, links and index are at
    28/32/36/40/44/48.
  - `ACL_SIZE_INFORMATION`, class 2.
  - `FILE_RENAME_INFO`: a 4-byte union at 0, `RootDirectory` at 8, the length at 16 and the name
    at 20. The buffer is at least the struct size for every fixed name.
  - The P/Invoke signatures match the SDK. `out bool` marshals as a 4-byte BOOL,
    `SE_FILE_OBJECT` is 1 and `SDDL_REVISION_1` is 1.
- **Pinning.** Every chain directory is held open without `FILE_SHARE_DELETE`, so it can't be
  renamed or deleted, which is what a junction swap needs first.
  - Each `Validate` reopens by path and compares the volume and the 64-bit file index. That is
    sufficient on NTFS, and only NTFS is accepted.
  - Path-based child creates are therefore bound to the pinned root.
  - Mount points and junctions are rejected as reparse points, together with the same-volume
    check.
- **Security descriptors.**
  - New objects get an explicit protected SDDL at creation: the owner is the user, and FA goes
    to the user, SY and BA, with no inheritance flags. Nothing is inherited and then tightened.
  - Checks:
    - the owner equals the user SID, and the DACL is present, non-null and protected;
    - only allow ACEs with flags 0, so inherited, deny, object and callback ACEs are rejected;
    - only the user, SYSTEM and Administrators may appear, and the user ACE is required.
  - The descriptor length and ACE bounds are checked, and `LocalFree` is called in a `finally`.
- **Files.**
  - `OPEN_REPARSE_POINT` on every open, a single link, and the same volume.
  - `CREATE_NEW` refuses an existing name, including a reparse point.
  - The fixed-name allowlist rules out ADS and traversal.
  - Reads are bounded before allocation, with an identity and size re-check and an extra-byte
    probe.
- **Sharing.**
  - The lock is share-0 for the process lifetime, and the temp is `ShareRead`.
  - The validation opens ask only for `READ_CONTROL|FILE_READ_ATTRIBUTES`, which never conflict
    with share modes, so `ValidateNamed` works on the still-open temp before and after the rename.
- **Write order.**
  - Write to a `CREATE_NEW` `WRITE_THROUGH` temp, then `FlushFileBuffers`.
  - Then a handle-relative `FileRenameInfo` with `ReplaceIfExists`, then `FlushFileBuffers` on
    the same renamed handle.
  - Then the identity and privacy re-check.
  - Any failure poisons the adapter. There is no `MoveFileEx`, `ReplaceFile`, copy fallback,
    directory-flush assumption or power-loss claim.
  - Cancellation is checked at admission only.
- **Volume.** `DRIVE_FIXED`, NTFS, persistent ACLs and not read-only; UNC and device paths are
  rejected before any native call.

## P2-1: authorable native fixtures are missing, and the one hosted run should carry them
The combined run is the only native Windows evidence under OD-15/16. These cases are cheap to
author on a hosted runner, and without them that run cannot back the claims the adapter makes:
1. **Foreign owner.** A root or file owned by Administrators (or another SID) is rejected and
   not repaired. The runner is elevated, so `SetOwner` to BA works.
2. **ACE kinds.**
   - An inherited allow ACE (flags `0x10`), a deny ACE, an `Everyone` allow ACE, and an
     object/callback ACE where it's easy.
   - Each on the root and on `consent.json`, rejected without repair.
3. **Process death.**
   - A child process opens the store, then writes up to `BeforeRename`.
   - The test kills it with `Kill(entireProcessTree)`, then reopens in the test process.
   - Expected: the lock is reacquired, the interrupted temp is reported, and `consent.json` holds
     the old bytes.
4. **External handle on the target.**
   - A third-party style handle on `consent.json` opened without `FILE_SHARE_DELETE`, as
     indexers and backup tools do.
   - It shows the actual rename-over result and the fail-closed state (see P2-2).

Volume fixtures (FAT, remote, read-only) and native flush failure can stay PENDING with the
reason recorded, because they need a VHD or fault injection. Real power loss stays outside the
claim.

## P2-2: a transient sharing violation from another process poisons the store until restart
- Third-party scanners and indexers (Defender, Search, backup) often hold short-lived handles.
  A rename-over then fails with `ERROR_SHARING_VIOLATION` (32) or `ERROR_ACCESS_DENIED` (5):
  the well-known Windows "EPERM on rename" problem.
- Today the first such failure sets `_faulted`, and consent becomes unavailable for the rest of
  the process. It fails closed, but it hurts availability on real desktops.
- **Fix:** a bounded retry of the `SetFileInformationByHandle` rename only, on 32 or 5. Use a
  small fixed schedule, for example 5 tries over about 250 ms, under `_io`, with no caller
  cancellation inside it.
  - The rename is atomic, so a retry can't observe a half state.
  - Re-run `ValidateNamed(temp)` and `ValidateTarget` before each try. After the limit, poison
    as today.
- **Proof:** the P2-1 case 4 fixture, with the handle released within the window (succeeds) and
  held past it (faults, with the temp evidence preserved).
- If both masters prefer no retry, record the availability trade-off explicitly instead.

## P3
1. **The SID must fit inside the ACE.** `SidAt(ace+8)` doesn't check `8 + GetLengthSid ≤
   AceSize`. Kernel-returned ACLs are well-formed, but add the bound because it is cheap.
2. **Minimal access for non-private ancestors.**
   - Pinning needs only an open handle without share-delete, so request
     `FILE_READ_ATTRIBUTES|SYNCHRONIZE`.
   - Add `READ_CONTROL` only where the privacy check runs.
   - `FILE_LIST_DIRECTORY` makes Open fail on hardened profiles that grant traverse but not list
     on an ancestor.
3. **A leftover temp blocks every replace.** `CREATE_NEW` on a leftover `consent.tmp` or
   `fence.tmp` faults each `ReplaceAsync` until recovery runs. That is correct for this slice:
   `ReadAsync` reports it as interrupted.
   - Record it as an acceptance input for the recovery and quarantine slice, with parity
     against the Linux and Mac adapters.

## Before the combined hosted run
- P2-1 fixtures authored.
- P2-2 decided, and fixed or recorded.
- P3-1 and P3-2 are cheap: do them in the same fix.
- One local full suite (flock-serialized), then a narrow Claude r2 on the fix diff.
- **Then the single combined Backend run.** It covers native Windows x64, macOS arm64 and
  Intel, and Linux on one head, and its trx must show the Windows native tests **executed**, not
  skipped.
- The port-test candidate is still an unproven mitigation, and a recurrence needs socket and
  PID capture.
- The Linux carry-forwards (unskipped ACL test, runtime-only libc proof, `IsVolatile`) and the
  remaining T11p slices (auth/Agent integration, recovery, lifecycle, and the combined T11+T11p
  Claude HIGH review) are unchanged.
