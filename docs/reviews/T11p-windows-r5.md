# T11p Windows startup lock (D-013 addendum 3): Claude review r5 (narrow HIGH, Opus master)

**Verdict: CHANGES. One small P2 (it deletes one product check and tightens one assertion) and
two P3s. There is no security finding. A narrow r6 covers only that fix diff.**

- **Reviewed:** local `7f3027e` (HOLDPUSH) on `AlexandreLozi/t11p-integration`, as the diff
  `65be8ce..7f3027e`:
  - product `5ce022c`, plus the test commits `835f6fc` and `6adfcd5`;
  - the author report `docs/validation/logs/T11p/windows-startup-lock/report.md`.
- **Author's local evidence:**
  - full suite on `5ce022c`: 306 passed, 47 skipped, 0 warnings in Release;
  - targeted tests on `6adfcd5`: 57 passed, 33 skipped.
- There is no native evidence yet; the native cases skip on Linux.

## Checked and correct
- **Scope.** Only error 32 waits, and only in `OpenLock`, which runs from `Open` after the chain is
  pinned and before `Validate` and any read of authority. Writes are unchanged and still never
  retry.
- **Bounds.**
  - The budget is monotonic (`TimeProvider.GetTimestamp`), with a fixed 50 ms backoff capped to
    the remaining time.
  - A separate cap of 41 attempts holds even if the clock freezes or the sleep does nothing.
  - No attempt is admitted after the deadline, including after an oversleep.
  - The policy simulations cover all of these.
- **Fail-closed paths.**
  - Error 5 and every other non-32 error fail at once, with no pause.
  - A security or identity failure on an acquired candidate disposes that candidate and is never
    retried.
  - Exclusive ownership is unchanged: share-0 for the process lifetime. A live holder still fails
    closed at the bound.
- **Validation still matches the old code.**
  - The removed `ValidateLock()` was `CheckPrivate` plus a same-volume check, and `CheckPrivate`
    already checks the volume.
  - `Open` still calls `Validate()` after `OpenLock`.
  - Each attempt revalidates the chain and the root, and does it again after acquisition.
- **Diagnostics.** `Exception.Data` carries only the attempt count and elapsed milliseconds: no
  path, SID or descriptor.
- **Tests.**
  - The kill-reopen test keeps one strict product `Open`, with no retry in the harness, and logs
    attempts and elapsed time on both success and failure.
  - The brief-holder and held-past-bound fixtures exist, and the held case checks that the pins
    unwind: the store directory can be moved afterwards.
  - No test claims who held the lock.

## P2: the deadline check between CREATE_NEW and OPEN_EXISTING breaks the 32-only outcome
After `CREATE_NEW` returns 80 or 183 (file exists), the product checks the deadline again before
`OPEN_EXISTING`, and if it has passed, it throws the *file-exists* code.

**Effects:**
1. **The gate gets weaker.** `AssertSharingBudgetExhausted` must now accept `:80` and `:183` as
   well as `:32`. So the held-past-bound native test (and the kill-reopen test, if it fails) can
   pass on an outcome that never touched the held lock. The one native run should prove the
   exact contract: fail closed with 32 at the bound.
2. **The code is misleading.** 80 means "the file exists", which is the normal state. It isn't
   the reason startup failed.
3. **There is a first-attempt corner.** If `CREATE_NEW` on a stale, unheld lock is slow enough to
   cross the budget (unlikely), `Open` fails without ever trying to open the free lock.

**Fix:**
- Treat `CREATE_NEW` plus `OPEN_EXISTING` as one logical attempt, which the report already says
  it is. Check the deadline only at the start of an attempt (it already is, after sleep and after
  revalidation), and delete the mid-pair check.
- This overshoots by at most one native call, the same bound every other attempt has, and the
  report already says syscalls aren't hard-time-bounded.
- Then tighten `AssertSharingBudgetExhausted` to the exact `:32` suffix and drop the 80/183
  branch.
- Optional: a policy or seam test showing that a file-exists result followed by a held lock ends
  in 32.

## P3
1. **The brief-holder fixture can flake on a slow runner.** It asserts at least 2 attempts, but
   the holder lets go 200 ms after the product `Open` starts. If a cold chain open on a hosted
   runner takes longer than 200 ms, the first attempt finds the lock free, makes only one
   attempt, and the test fails.
   - Raise the holder duration to about 500 to 700 ms. That is still well inside the budget, and
     the assertions stay the same.
2. **The report wording should match the fix.** After the P2 fix, remove "before the
   existing-file open following CREATE_NEW's file-exists result" from the list of deadline checks
   in `report.md`.

## Next
- The fix, then the final local full suite on the exact head (flock-serialized), then a narrow
  Claude r6 on the fix diff.
- **Then one combined 4-OS push run.** The Windows trx must show these executed and passing:
  - the kill-reopen test, with its attempts and elapsed time logged;
  - the brief-holder success case;
  - the held-past-bound case, failing closed with exactly 32.
- macOS arm64 and Intel, and Linux, must stay green.
- These stay held: the full T11p acceptance, T14, and the pre-M6 write-retry availability item.
