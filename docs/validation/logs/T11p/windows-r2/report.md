# T11p Windows r1 response — bounded authored slice, native evidence pending

Historical checkpoint: first native run41570527419 on this code was NOT accepted; the current
jointly approved Windows primitive amendment and next evidence gate are in `../windows-r3/report.md`.

Base: `caa7b740e7641c81e159ea49e1f6ebf0c8c172ef`.
Verified code/fixture checkpoint: `c3bc032cdbde8f1a6081be16a2e4e469bbe4c03c`;
the following report-only commit does not change that tested code.
Review: `1bd19ac:docs/reviews/T11p-windows-r1.md` (Claude HIGH).
Current-terminal GPT HIGH was independently confirmed before this slice's code changes.
This branch does not change the reviewed port-test mitigation, auth, Agent, ConsentStore,
recovery/lifecycle wiring, Linux/macOS adapters, dependencies or workflows.

## Review response / authored native fixtures

| Item | Change | Evidence boundary |
|---|---|---|
| P2-1 foreign owner | BA owner on root and snapshot, native owner precondition, rejection/no repair, cleanup restores owner only after assertions | Hosted Windows only; assignment assumes the elevated runner token can assign BA |
| P2-1 ACE kinds | Inherited allow, deny, Everyone allow, callback allow on root and snapshot; exact installed-ACE preconditions and unchanged descriptor after rejection | Hosted Windows only; setup failure is not silently skipped or counted as rejection proof |
| P2-1 process death | Existing executable test assembly as child; pipe signal at BeforeRename, real kill + bounded exit wait, lock reacquisition, old bytes and interrupted temp, unavailable reopen | Hosted Windows only; no new native helper/project or production entrypoint |
| P2-1 external target handle | Actual open target without SHARE_DELETE, native rename error32/5, retained temp and old bytes, sticky failure after blocker release, unavailable reopen | Hosted Windows only; no simulated acknowledgement substitutes for the kernel result |
| P3-1 SID within ACE | Bound SID length to ACE bytes before constructing SecurityIdentifier; reject lengths outside8..68 or beyond ACE remainder | Pure policy assertions are runnable on Linux; actual Windows descriptor parsing remains native-pending |
| P3-2 minimal ancestry access | Unrelated ancestors request READ_ATTRIBUTES + SYNCHRONIZE only; private metadata opens add READ_CONTROL; writable store root retains required data/directory access | Pure masks checked locally, hardened-profile access compatibility requires Windows |
| P3-3 interrupted temps | Explicit recovery/quarantine acceptance inputs below; no cleanup or promotion added | Existing Windows/Linux/macOS behavior is intentionally unchanged |

Object ACE fixtures are not authored: the callback fixture covers an additional rejected ACE kind,
while a valid NTFS object-ACE setup still needs native verification. Native volume fixtures require
FAT/remote/read-only volumes or a VHD; native flush-failure injection remains pending. No power-loss
guarantee is claimed. Real child death here covers BeforeRename only, not every durability boundary.

## P2-2 decision: KEEP FAIL-CLOSED / NO RETRY for this slice

Both masters approved this limited choice (coordinator relay `msg_d83db6275b1a`, Opus approval
`msg_222a5e6ca9ca`). No retry, sleep schedule, validated reopen or recovery logic was added.
An external reader/indexer/backup handle can cause native rename error32/5. Even when that handle
is transient, the first failed operation permanently poisons the current adapter/session; releasing
the handle does not restore authority or permit a quick retry. The failed CREATE_NEW source remains
as evidence. Trusted shutdown/restart is required to release ownership, but **restart alone may
still find that temp and remain unavailable** until explicit trusted recovery/quarantine succeeds.
This slice never deletes a temp, overwrites it, promotes it into a snapshot or treats it as a grant.

**OPEN full-T11p / recovery / pre-M6 availability item:** indefinite desktop unavailability until
restart is not accepted as the final M6 behavior. Before M6, jointly approve and validate either
bounded rename retry, automatic in-process validated reopen/recovery, or sufficient native rarity
evidence supporting another approved outcome. This checkpoint does not choose or implement it.

## P3-3 recovery/quarantine acceptance input (all three adapters)

`consent.tmp` and `fence.tmp` are interrupted-state evidence. CREATE_NEW refuses existing temp
names; normal startup reports interrupted artifacts and cannot silently resume saved authority.
Windows, Linux and macOS must preserve that behavior in the later trusted recovery slice:
retain the lifetime lock, validate owner/ACL-or-mode/type/link count and anchored identity, quarantine
the permitted evidence without following links or deleting the active dirty fence, respect slot/byte
bounds, and remain unavailable on failed preservation. Never reuse stale temp bytes as authority.
Tests for recovery must cover both temp names, crash-left temp and sharing-failure temp, malicious
link/foreign/insecure entries, occupied quarantine slots, and interrupted recovery itself.
Existing saved restrictive metadata versus unsaved restrictive intent must remain distinguished.

## Local verification and provenance

The policy regression logs are **mutation RED**, not a fabricated pre-implementation TDD record:
one removes the SID-within-ACE enforcement, the other reinstates ancestor LIST/READ_CONTROL.
Each produced a real test assertion failure, followed by restored-source green checks. Tests were
then strengthened from reflection into direct typed boundary assertions. Compile/analyzer errors
from fixture authoring are retained separately and do not count as behavioral RED evidence.
Final locked restore, Release build, targeted and once-only serialized full-suite results are
recorded in this directory; all native fixtures remain explicitly skipped on Linux.

- Locked restore PASS; Release build PASS with **0 warnings / 0 errors**.
- Targeted Windows cases: **32 passed, 30 explicitly skipped, 0 failed**.
- Full local suite executed **once**, under the shared real-port `flock`:
  **281 passed, 44 skipped, 0 failed** (Agent240 + Virtual28 + Core7 + Scaffold6).
  Skips: Windows-native30, Darwin-native12, Windows-only managed guard1, Linux setfacl1.
- Final diffcheck PASS; no product or test edits followed this verification.
- All Windows x64/arm64 native behavior remains PENDING; Linux compilation, guard tests and
  policy mutations do not establish ACL installation, real process death, or Win32 rename results.

Fixture contract limits: callback `CommonAce` construction with optional null opaque data is
supported by .NET, but NTFS preservation is deliberately asserted after installation, not assumed.
BA owner assignment depends on owner-eligible enabled token membership/privileges, not elevation
as a universal guarantee; a setup failure fails the fixture rather than silently passing/skipping.
Official references: Microsoft Learn [CommonAce constructor](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.commonace.-ctor)
and [SetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo).

## Gates and pickup

LOCAL COMMIT / HOLDPUSH remains in force. No native Windows host execution, SAC bypass, hosted
dispatch, push or retry occurred. Coordinator owns shared main EXECUTION §4a and the open availability
carry-forward; this writer did not edit it. Next: narrow independent Claude HIGH r2 on this diff,
then one coordinator-authorized combined Backend push/run. Its Windows native fixtures must execute,
not skip; macOS-arm64/Intel and Linux evidence remain in that same batch. Full T11p/T14 remain held.
