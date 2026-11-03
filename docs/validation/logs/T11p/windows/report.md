# T11p Windows storage adapter — local checkpoint, acceptance HELD

## Exact scope and provenance

- Clean starting head: `38a859b33076785132cc60350086ab8c69fa3cff`.
- Adapter checkpoint: `4fbec92087fb74063317861b3723a96068bf3469`.
- Reviewed port-test author commits: `b460df969a0620795486beda9e03e1fa4967e588`
  and `22d5194c54b626bb4061ebe0c1065248980c8a46`.
- Conflict-free composition produced tested code head
  `f3de1be3c84dd8877a526329ef3def34a6932260`.
- Adapter changes are confined to `WindowsConsentDirectory.cs`, its tests, and these logs.
  Coordinator-authorized composition changes `RealHttpTests.cs` teardown and its report only.
  No auth, ConsentStore, recovery, lifecycle, Linux/macOS adapter, dependencies or workflows changed.
- Actual GPT HIGH was independently confirmed by the coordinator before code.
  Independent Claude HIGH review remains required; local inspection is not that review.

## Authored behavior, not a native validation claim

The internal adapter implements the existing `IPrivateConsentDirectory` seam without wiring it
into production composition. Windows x64/arm64 guards precede identity/native access; other
architectures/platforms fail closed. It accepts canonical local drive paths, pins each checked
non-reparse directory without delete sharing, and requires writable local NTFS with persistent
ACL support. Existing unrelated ancestor permissions are not modified or asserted owner-private.
Store root, newly created ancestors, and regular single-link store files require current-token
ownership and protected, non-null DACLs; only current user, SYSTEM and Administrators allow ACEs
are accepted. Unknown/inherited/object/callback ACEs fail closed. New objects receive explicit
protected security descriptors at creation, not inherited-then-tightened permissions.

The lifetime share-zero lock and retained ancestry prevent namespace redirection within the
approved threat model (not a defense against administrator or same-user malware). Metadata reads
are bounded before allocation and revalidated. Writes retain a CREATE_NEW WRITE_THROUGH source:
write → FlushFileBuffers → directory-relative FileRenameInfo replacement → FlushFileBuffers on
the **same** still-open renamed handle → identity/privacy validation. Failures poison the adapter
and preserve interrupted evidence; cancellation does not abandon admitted native operations.
There is no MoveFileEx, ReplaceFile, copy fallback, directory-flush assumption or power-loss claim.

## Evidence boundaries

- Pinned Linux SDK10.0.403 was downloaded from Microsoft and its published SHA512 verified.
- Initial pre-type compile failures in `red-pure-tests.txt` are **not behavioral TDD proof**.
  `followup-red-pure-assertions.txt` records two actual failures before the lock-name and Unicode
  declaration fixes; subsequent logs establish those local guard/declaration regressions only.
- Explicit managed layouts cover Win64 SECURITY_ATTRIBUTES24 and BY_HANDLE_FILE_INFORMATION52;
  rename encoding uses union0, root handle8, byte length16, UTF-16 name20. These match the Microsoft
  SDK header contract, but Linux layout/byte assertions do **not** execute Windows ABI marshaling.
- Final combined locked restore PASS; Release build PASS with **0 warnings / 0 errors**.
  Targeted Windows cases: **17 passed, 18 explicitly skipped, 0 failed** on Linux.
  Full local suite executed **once**: **266 passed, 32 skipped, 0 failed**
  (Agent225 + Virtual28 + Core7 + Scaffold6). Skips: Windows-native18, Darwin-native12,
  Windows-only managed guard1, unavailable Linux setfacl1. See `combined-*.log`.
  Targeted and full-suite invocations used the coordinator-prescribed `flock` real-port lock.
  Final diffcheck PASS; no code changes followed tested head, only sanitized logs and this report.
  No native Windows host execution, SAC bypass, push, hosted dispatch or rerun occurred.

## Native evidence matrix

| Claim | Authored coverage | Actual native evidence |
|---|---|---|
| x64/arm64 P/Invoke and access/share compatibility | Native open/write/clean-reopen cases | PENDING both architectures |
| Owner/protected ACL and replacement privacy | Root/file SID and ACL checks after replacement | PENDING |
| Broad/null/unprotected DACL rejection; unwind | Native negatives with fixture precondition checks | PENDING |
| Lifetime lock contention/reacquisition | Second open fails, dispose then reopen | PENDING |
| Root rename prevention; root/ancestor/file reparse | Native attack fixtures, victim untouched | PENDING |
| Hardlink and oversized snapshot rejection | Native single-link/bounded-read cases | PENDING |
| Ordered flush and failure/checkpoint handling | Stage trace and three injected checkpoint cases | PENDING; injection is not kernel-failure proof |
| Non-NTFS, remote, read-only volume rejection | Production checks; dedicated volume fixtures NOT authored | PENDING |
| Foreign owner / unknown-object-callback ACE attacks | Production checks; dedicated fixtures NOT authored | PENDING |
| Atomic readers, real process death/reopen, native flush failure | NOT authored in this bounded slice | PENDING |
| Arbitrary hardware sudden power loss | Not claimed or established | OUTSIDE CLAIM |

## Pickup / release gates

This is a coherent authored adapter checkpoint, **not full T11p or T14 acceptance**. Native runtime
proof and the remaining matrix fixtures are outstanding; passing Linux guards cannot close them.
The composed HTTP client-disposal change is an **unproven mitigation**, not a confirmed Windows
port-flake fix. Coordinator owns independent Claude HIGH review and one reviewed combined hosted
Windows/macOS-arm64/three-OS batch under OD16; HOLDPUSH remains in force until that authorization.
Coordinator owns shared main EXECUTION §4a; this writer did not edit it.

Official contracts consulted (2026-11-02): Microsoft Learn
[FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info),
[SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle),
[GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo),
[GetVolumeInformationByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationbyhandlew),
and the Microsoft win32metadata SDK `WinBase.h` / `fileapi.h` declarations.
