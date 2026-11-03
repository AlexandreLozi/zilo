# T11p inherited-ACE fixture response — test-only checkpoint

Base: `a7b05e2872493dff9e63baf976f90cff3f6a7d4f`.
Verified fixture/evidence checkpoint: `11882fa95383b9fd9e330b5d729b1615c3e4e48c`;
the following report-only commit leaves all tested code unchanged.
Read Claude analysis `330b86c:docs/reviews/T11p-windows-native-run2.md`.
Actual current-terminal GPT HIGH was independently confirmed before this slice.

## Existing native evidence and remaining boundary

Backend run41577346041 on a7b05e2 obtained native Windows product-case evidence: direct
replacement, private round trip/locking, checkpoint failures, child death, external sharing,
foreign owners, deny/Everyone/callback ACLs and the other listed security cases passed.
Only two inherited-ACE fixture preconditions failed **before the product was exercised**.
Ubuntu and both macOS jobs were green, including the arm64 startup self-test; that does not
retroactively establish the old relative-rename failure's cause.

This slice changes test fixtures only. The production adapter and every other production file
remain byte-identical to a7b05e2. No retry/recovery/lifecycle/auth changes, privilege changes,
NtSetSecurityObject, helper binary, dependency, workflow or native Windows host execution is added.

## Supported API contract and limits

Official Microsoft [SetFileSecurityW](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw)
is an available but obsolete BOOL-returning API taking a UTF-16 path, SECURITY_INFORMATION and
a security-descriptor pointer; failure is diagnosed through GetLastError. Microsoft recommends
SetNamedSecurityInfo for general application use; this legacy API is used only in the fixture.
[GetFileSecurityW](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-getfilesecurityw)
returns a self-relative descriptor copy and the required buffer size, permitting raw readback
without the managed ACL wrapper reconstructing the observation.
[SECURITY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-information)
distinguishes DACL/protection flags from owner/group updates; [descriptor control](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-control)
and [ACE inheritance](https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance)
distinguish protected-DACL policy from the individual INHERITED_ACE header flag.
Sources checked2026-11-03. These docs do **not** guarantee that this API preserves an inherited
flag on this protected-DACL construction or bypasses Windows normalization. Readback decides
which narrowly asserted fixture outcome occurred; an API/setup failure is not a product pass.

The inherited fixture alone now uses raw descriptor input/write/readback. The write requests
DACL plus protected-DACL information (`0x80000004`), not owner/group changes; bounded raw reads
request OWNER|GROUP|DACL (`0x7`) with the documented size query and a1MiB allocation ceiling.
The two inherited cases have a separate TRX name explicitly allowing either installed-state
rejection or exact normalization. Deny/Everyone/callback case names and managed fixture paths
are retained. If the inherited bit is absent, the **only** accepted normalization is the exact
clean baseline DACL (revision, order, three expected principals and FA masks), with unchanged
owner, group and control flags. Any different readback fails rather than silently expanding
the set of accepted normalizations. No such raw native outcome has been observed locally.

## Evidence limitations and gates

Any successful installed-inherited-state branch must assert the real raw descriptor precondition
before invoking the product, then assert rejection and no descriptor repair. A normalized branch
must assert its exact expected construction-specific descriptor outcome and identify itself as
normalization evidence, not inherited-state product coverage. No skip or universal claim that
inherited states are OS-unreachable is authorized by this fixture.

Pure fixture byte/normalization tests, if present, cover fixture logic only. The production
`flags != 0` check has no independently callable pure guard; a test-only slice cannot add one
or truthfully claim Linux execution of native GetSecurityInfo/ACE validation. Existing native
product evidence is reused only for unchanged code; the changed inherited fixtures still require
their own reviewed Windows-relevant hosted execution.

Locked restore PASS; Release build PASS with **0 warnings / 0 errors**. Targeted Windows cases:
**44 passed, 31 explicitly skipped, 0 failed**. The full local suite executed **once** under the
shared real-port flock: **293 passed, 45 skipped, 0 failed** (Agent252 + Virtual28 + Core7 + Scaffold6).
Skips: Windows-native31, Darwin-native12, Windows-only managed guard1, Linux setfacl1.
An actual fixture-classifier mutation produced Assert.True failure, then1/1 passed after exact
restoration; this is mutation regression evidence, **not** pre-implementation TDD or product proof.
The source blob after restoration matches the full-suite fixture exactly; no full-suite rerun
was needed. Production diff and final diffcheck PASS. Public logs are sanitized; explicit native
API diagnostics use operation/error codes and lengths, not private-path/raw-descriptor logging.
LOCAL COMMIT / HOLDPUSH remains in force. Next: narrow
Claude review and one coordinator-authorized Windows-relevant hosted gate. This writer does not
push or dispatch it. Full T11p/T14 and the pre-M6 no-retry availability carry-forward remain held.
