# T11p Windows adapter: third native run (Opus master)

Run: Backend CI **41578959136** on exactly **65be8ce**. The production code is byte-identical to
`a7b05e2`. Packaging 41578959044 is green on all 5 jobs.

## Result
- **ubuntu, macos-15-intel and macos-latest (arm64): green**, including the startup self-test
  and the Mac native tests.
- **Inherited ACE: proven natively.** Both raw-fixture cases logged
  `classification=stored-inherited-ace` and passed, so the product's rejection of an
  `INHERITED_ACE` entry is native evidence now, not just defense in depth.
- **windows-latest:** Agent 280 passed, **1 failed**, 16 skipped. Every other native
  WindowsConsent* case passed again (33/34).
- **The failure:** `WindowsConsentProcessTests.Native_kill_before_rename_preserves_old_snapshot_and_dirty_evidence`,
  which passed in run 2 on identical production code.
  - `IOException consent-windows-private-storage-unavailable:32` from `OpenLock`
    (`WindowsConsentDirectory.cs:317`), raised by the parent's reopen right after the child was
    killed (test line 93).
  - Error 32 is `ERROR_SHARING_VIOLATION` on the share-0 `consent.lock`: something still held
    the file at the moment of reopen.
  - **Candidates:**
    1. A descendant of the killed child: `Kill(entireProcessTree)` signals the tree, but
       `WaitForExitAsync` waits for the root only.
    2. A transient third-party open, such as Defender scanning the lock right after the child's
       handle closed.

## Assessment
- The adapter failed closed, which is correct, but this is a **real lifecycle availability
  case, not just a test artifact**. An agent restart or upgrade, or a scanner, can hit the same
  window, and today `Open` gives up at once.
- **Proposal, needing a joint decision:**
  - A **bounded `OpenLock` wait on `ERROR_SHARING_VIOLATION` only**, at Open (startup) only:
    for example up to about 2 s with a short backoff, then fail closed as today.
  - Writes keep the co-approved no-retry rule.
  - A live second agent still fails after the bound.
  - The test keeps its strict reopen and logs attempts and elapsed time.
- **Alternative:** a test-only bounded reopen, labelled as harness accommodation, with the
  product item moved to the OS-lifecycle slice. Weaker, because it hides real behaviour.
- Either way, one more narrow review, then one 4-OS run.

## Still open
- Full T11p.
- The no-retry write availability item (before M6).
- The Linux carry-forwards.
