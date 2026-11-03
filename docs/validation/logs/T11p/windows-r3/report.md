# T11p native-run response — full-path candidate and diagnostics

Base: `c3dec941ca2df0165608a01908714c7c7596390a`.
Verified code/diagnostic checkpoint: `9a508b79c8214848c0f1056d9222c86957753c03`;
the following report-only commit does not change the tested code.
Read Claude HIGH analysis `eda2855:docs/reviews/T11p-windows-native-run1.md`.
Actual current-terminal GPT HIGH was independently confirmed before code.

## Native result and bounded interpretation

Backend run41570527419 on c3dec94 is **NOT accepted**: Windows had20 failures, all at or
behind fresh-session Ready assertions; Open/lock and Open-level rejection cases passed.
The prior session mapping did not expose the underlying native error. No unobserved Win32
error code, KernelBase/Wine behavior or single proven Windows root cause is asserted here.
The macOS-arm64 startup self-test timeout also remains unaccepted; its storage tests passed.
The reviewed port-test change remains an unchanged, unproven mitigation.

## Exact jointly approved amendment

D-013 addendum2 in `93a878382d681bb584d6998df6d29c20f1045e64`, relayed by coordinator
`msg_25fa2c7b4c1a`, authorizes the compatibility candidate: retained private CREATE_NEW
WRITE_THROUGH temp → file flush → FileRenameInfo replacement with **full fixed DOS ChildPath,
RootDirectory=NULL** → flush on the **same** still-open renamed handle → identity/privacy checks.
The immutable validated root and every ancestor remain pinned without FILE_SHARE_DELETE;
chain/temp/target validation stays in place before the rename. Only consent.json/session.fence
can be appended to the trusted root. No arbitrary destination input, NtAPI, copy/path fallback,
retry, recovery change, permission relaxation or hardware power-loss claim was added.

The Win64 buffer retains offsets0/8/16/20, has a zero root field, and includes a trailing UTF-16
NUL excluded from FileNameLength. Strict UTF-16 validation prevents malformed surrogate replacement
from encoding a different root. Pure tests include non-ASCII/a valid surrogate pair, unpaired
surrogates, unsafe roots, non-fixed names, byte length, reserved padding and terminator bounds.
Task/design and historical-report pointers now reference the current amendment, not a parallel
stale relative-root architecture.

## Official contract, not causal proof

Microsoft [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info)
documents absolute drive/directory/file paths and RootDirectory=NULL as the common case; it also
explicitly permits relative names with a directory handle. Thus the old relative form is not declared
invalid by these docs. FileNameLength is in bytes and excludes an optional terminator; this candidate
supplies one. [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)
documents class3 and GetLastError on failure. [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
documents delete/rename sharing. Sources checked2026-11-03; no additional native experiment ran.
Even a future full-path PASS would establish candidate behavior, not conclusively diagnose the old
failure without additional evidence. No extra A/B experiment or hosted run is authorized here.

## Diagnostics and evidence matrix

| Claim / failure | Added or retained evidence path | Current status |
|---|---|---|
| Fresh file replacement, exact native exception | Native test calls ReadAsync/ReplaceAsync directly, without ConsentSession exception-to-status mapping, then checks marker bytes | Authored; Linux explicitly skips |
| Ready failures need useful TRX messages | Every Windows-native Ready assertion includes actual health and DiagnosticCode | Authored; native outcome pending |
| Full DOS/null-root compatibility | Same-handle native replacement plus existing lock/ACL/reparse/crash fixtures | PENDING next reviewed Windows run |
| Buffer encoding guard coverage | Three independent mutations: relative payload, nonzero root, length including NUL | Actual local assertion RED, then restored-source GREEN |
| arm64 startup10s failure | Elapsed time, timeout flag and max4096 characters per stdout/stderr in failure messages; bounded reap/drain | Authored; no timeout waiver or increase |
| Owner/ACL/lock/security/process death | Existing native fixtures preserved, no fake acknowledgements added | Full native acceptance remains PENDING |
| Arbitrary hardware power loss | No test or assertion | OUTSIDE CLAIM |

The buffer RED logs are explicitly **regression mutations**, not fabricated pre-implementation
TDD or native failures. Each was built successfully before a real assertion failed; original
source was restored byte-for-byte, and the focused encoding cases passed. Compile errors would
not count as RED proof. Linux guards/encoding assertions cannot establish Win32 runtime behavior.

Startup still has the same **10-second process-exit timeout** and exact output/stderr/exit checks.
An explicit TimedOut assertion prevents a late successful exit from quietly passing. Cleanup
and output draining have separate one-second bounds; failure diagnostics are truncated, not a
longer startup allowance. A recurrence on arm64 still fails and must be investigated, not waived.

## Local verification and release gates

Locked restore PASS; Release build PASS with **0 warnings / 0 errors**. Targeted Windows/startup:
**44 passed, 31 explicitly skipped, 0 failed**. Full suite executed **once** under the shared
real-port `flock`: **292 passed, 45 skipped, 0 failed** (Agent251 + Virtual28 + Core7 + Scaffold6).
Skips: Windows-native31, Darwin-native12, Windows-only managed guard1, Linux setfacl1.
Final diffcheck PASS; no code/test changes followed this verification. Logs are in this directory.
No native Windows owner-host execution, SAC bypass,
push, workflow edit, hosted dispatch or rerun occurred. No auth/Agent/recovery/lifecycle or
Linux/macOS storage code changed; the startup change is test diagnostics only.

The no-retry decision and OPEN fullT11p/recovery/pre-M6 availability item from windows-r2 remain:
a transient rename failure poisons the session, preserves temp evidence, and restart alone can
still remain unavailable pending trusted recovery. This slice does not solve desktop availability.
LOCAL COMMIT / HOLDPUSH remains in force. Next: narrow independent Claude HIGH r3, then ONE
coordinator-authorized combined Backend run on the reviewed head, including Windows native tests
executing rather than skipping and the unwaived macOS-arm64 startup case. Full T11p/T14 remain held.
