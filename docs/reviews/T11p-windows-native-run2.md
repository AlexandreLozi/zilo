# T11p Windows adapter: second native run (Opus master)

Run: Backend CI **41577346041** on exactly **a7b05e2** (tested code 9a508b7). Packaging
41577346044 is green on all 5 jobs.

## Result: native evidence obtained, 2 fixture failures left
- **ubuntu, macos-15-intel and macos-latest (arm64): green.** On arm64 the startup self-test
  passed and all native MacConsentDirectoryTests passed (13/13 matching cases in the trx), so
  run 1's self-test timeout behaved as a cold-start candidate.
- **windows-latest:** Agent 278 passed, **2 failed**, 16 skipped. Every other native Windows
  test **executed and passed**:
  - the direct `ReplaceAsync` round trip, and the full-path rename ABI;
  - the private store round trip with the exclusive lock retained;
  - checkpoint faults at stages 0, 1 and 2, and a flush failure leaving dirty evidence;
  - the real child-process kill before the rename: old snapshot intact, interrupted state
    reported;
  - an external handle without `FILE_SHARE_DELETE`: sticky failure, temp preserved;
  - a foreign Administrators owner, and deny, Everyone and callback ACEs (root and file), each
    rejected without repair;
  - null or unprotected DACLs, an unknown principal, reparse snapshots and ancestors, a hardlink,
    an oversized snapshot, the root pinned against rename, the lock contention, and the
    failed-open unwind.
- **Causal note (GPT caution, agreed):** the full-path form works natively. This run does not
  prove that the old relative form caused run 1, because the old Win32 error was never
  captured.

## The 2 failures: a fixture precondition, not product behaviour
- `Native_foreign_ace_kind_is_rejected_without_repair(kind: "inherited", mutateRoot: False|True)`
  fails in `AssertFixtureAce` (line 648), **before the product is exercised**.
- The descriptor read back has no ACE with `AceFlags.Inherited`: Windows normalized the attack
  state away. The .NET `SetAccessControl` path goes through `SetSecurityInfo`-style inheritance
  processing, which does not keep an `INHERITED_ACE` entry on a protected DACL the way the
  fixture wrote it.
- **Fix (test only):** write the fixture descriptor raw with `SetFileSecurityW` (or
  `NtSetSecurityObject`), which stores the descriptor without auto-inheritance processing.
  - Keep the precondition assert.
  - If Windows still refuses to store it, record "OS-unreachable through the supported APIs".
    The product's `flags != 0` rejection stays as defense in depth, and the test asserts the
    normalization explicitly rather than skipping.
- After the fix: a local suite, a narrow Claude review, then one Backend run. A
  Windows-relevant run is enough.

## Still open
- Full T11p: auth/Agent integration, recovery and quarantine, OS lifecycle, the combined
  T11+T11p Claude HIGH review, and exact-SHA star CI.
- The no-retry availability item (before M6).
- The Linux carry-forwards.
