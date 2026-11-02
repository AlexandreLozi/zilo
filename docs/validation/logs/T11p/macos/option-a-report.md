# Darwin ARM64 creation ABI correction — local checkpoint

Baseline: `70769cfe990c6b9cdb6649c9b1ca72f15e8c2996`.
Coordinator independently confirmed HIGH for this fresh session in `msg_8fa1cc100cc7`.

## Defect and approved scope

Claude r1 (`1a34112:docs/reviews/T11p-macos-r1.md`) and hosted Backend CI
41516769735 identify fixed-signature P/Invoke of variadic `openat` mode as the ARM64
creation defect. Intel native cases passed, ARM64 mode checks failed closed.
The review's initial suggestion to omit mode while retaining O_CREAT is **not** used:
the jointly approved Option A follow-up (`msg_7eb6fb9cb702`) supersedes that suggestion.

Managed `FileStream` exclusively creates an empty file with CreateNew, ReadWrite,
FileShare.ReadWrite and UnixCreateMode0600; the .NET runtime owns the platform ABI.
The owning stream must remain alive throughout descriptor use. Only this newly and
exclusively created empty descriptor may receive fixed-signature fchmod0600, before
any payload write or lock authority. Retained ancestor/root identities, strict private
mode/owner/single-link/ACL checks and anchored named identity validation gate use.
Existing lock files are reopened only after EEXIST, without creation or permission
repair, and undergo strict validation. Native openat is noncreating and three-argument.

This is a narrow pathname exception for exclusive empty creation, not a replacement
for anchored reads/rename/identity checks. D-013 excludes root/admin and same-uid
malware: no stronger same-user race guarantee is claimed. Strict F_FULLFSYNC,
filesystem allowlist, ACL rejection and fail-closed behavior remain required.

## Validation / integration gates

Local validation results are recorded below after execution. Linux guard tests can
prove managed option guards and declaration/source invariants, not Darwin ABI behavior.
New native Darwin cases require actual x64 and ARM64 execution.

**HOLD PUSH:** no push, manual hosted dispatch or CI bypass for this checkpoint.
Coordinator combines the separately GPT-reviewed cancellation-test fix before Opus
coordinates one exact combined-head run on both Mac jobs. Independent Claude review
and that native evidence still gate slice PASS; full T11p remains held.
