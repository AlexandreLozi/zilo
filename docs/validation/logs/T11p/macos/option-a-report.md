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

Local validation results are recorded below. Linux guard tests can
prove managed option guards and declaration/source invariants, not Darwin ABI behavior.
New native Darwin cases require actual x64 and ARM64 execution.

**HOLD PUSH:** no push, manual hosted dispatch or CI bypass for this checkpoint.
Coordinator combines the separately GPT-reviewed cancellation-test fix before Opus
coordinates one exact combined-head run on both Mac jobs. Independent Claude review
and that native evidence still gate slice PASS; full T11p remains held.

## Executed local evidence

- Mac fix commit: `6716f46` (full identity available in git); source includes an explicit
  empty-size guard before each allowed fchmod. Stream ownership persists through
  SafeFileHandle use; existing lock descriptors are never mode-normalized.
- Coordinator `msg_ed5ab7f61517` approved composition of GPT-reviewed cancellation
  author SHA `f4619037d6e7768cc8752687df3e643b7248e449`. Clean cherry-pick produced
  combined code head `606e8e51975f4fc0ab8008462527eacaacffa532`.
- `option-a-red.log`: baseline native declaration regression fails Expected3/Actual4;
  `option-a-targeted.log`: final Mac guards18 PASS, native Darwin12 + Windows guard1
  explicitly skipped on Linux. Initial compile exposed CA1416 on the UnixCreateMode
  setter; explicit Windows rejection fixed that rather than suppressing analysis.
- Managed guards exercise exclusive empty creation, private mode bits, EEXIST and
  no mutation of existing contents/mode. Source/reflection guards enforce current
  three-argument native declaration and noncreating call sites; no padding trick.
- On combined code head, pinned Linux .NET SDK10.0.403 locked restore PASS;
  Release build PASS with0 warnings/errors; combined SecurityInvariant/Mac targeted
  regression **25 PASS,13 skipped,0 failed**.
- Full locked Release suite executed **once on combined code**: **249 PASS,14 skipped,
  0 failed** (Agent208 + Virtual28 + Core7 + Scaffold6). Skips:12 Darwin-native,
  Windows-only managed guard1, existing unavailable Linux setfacl1.
- Combined logs: `option-a-combined-restore.log`, `option-a-combined-build.log`,
  `option-a-combined-targeted.log`, `option-a-combined-suite.log`; absolute workspace
  paths redacted. Staged diffcheck PASS; no product change follows this tested code head.
- Darwin x64/ARM64 runtime proof remains **PENDING**, not inferred from these Linux
  results; strict actual fullflush, ACL, lock reopen and create-mode behavior must be
  checked on both native jobs. No push or hosted dispatch was performed.
