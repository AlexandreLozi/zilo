# T11p Windows native run 4: startup lock (D-013 addendum 3), Opus analysis

**Verdict: the combined run is GREEN on the exact reviewed head `9976659`. The startup-lock slice
is accepted natively.**

- **Runs:** one push of `9976659` (final code `940a996`; r6 PASS 1250515):
  - Backend CI 41591658456: all 4 jobs succeeded;
  - Packaging 41591658302: all 5 jobs succeeded.
- **Totals from the trx files:**

  | Job | Passed | Not executed | Failed |
  |---|---|---|---|
  | windows-latest | 337 | 16 | 0 |
  | macos-latest (arm64) | 317 | 36 | 0 |
  | macos-15-intel | 317 | 36 | 0 |
  | ubuntu-latest | 307 | 46 | 0 |

- **Windows native WindowsConsent\*:** 89 passed, and 1 not executed:
  `Open_rejects_non_windows_before_identity_or_native_entry`, which is the non-Windows guard and
  correctly skips on Windows.

## Startup-lock evidence (Windows test output)

| Test | Result | Logged |
|---|---|---|
| `Native_single_open_waits_for_brief_external_lock_handle_then_succeeds` | Passed | attempts=12, lockElapsedMs=609.4 (600 ms holder) |
| `Native_single_open_fails_closed_when_external_handle_outlasts_budget` | Passed (exact `:32`) | attempts=35 or 36, lockElapsedMs=2005.7 or 2014.2 |
| `Native_second_session_cannot_acquire_lock_until_disposal` | Passed (exact `:32`) | the other failed bounded open |
| `Native_kill_before_rename_preserves_old_snapshot_and_dirty_evidence` | Passed | attempts=1, lockElapsedMs=0.6 |

- The two held-lock outcomes (35 and 36 attempts) are matched to their tests by assertion, not by
  log line.
- **Bounded wait proven natively:**
  - A real external share-0 holder released after about 600 ms: the product `Open` retried at
    the 50 ms backoff and acquired the lock.
  - A holder kept past the budget made `Open` fail closed at about 2.0 s with exactly 32, and
    then unwind its pins.
  - A live second session is still excluded.
- **Kill-reopen:** passed on the first attempt. The run-3 sharing violation **did not recur**, so
  the wait wasn't needed this time. This run therefore proves the bounded wait through the
  external-holder fixtures, not through a recurrence. What held the lock in run 3 is still
  unproven.
- **Supporting results:**
  - The startup self-test passed on macOS arm64 and Intel.
  - The Linux and Packaging smokes (MSI install, deb/rpm, the universal pkg) passed.

## Status
- **Accepted natively:** the T11p Windows storage adapter slice, namely:
  - the D-013 addendum 2 replace primitive;
  - the addendum 3 startup lock;
  - the ACE, owner and inherited fixtures;
  - process kill.
- **Still held:**
  - the full T11p acceptance: the auth/Agent integration, recovery and quarantine (leftover-temp
    parity), and lifecycle;
  - the combined T11+T11p Claude HIGH review, then exact-SHA CI;
  - T14;
  - the pre-M6 write-retry availability item;
  - the Linux carry-forwards: an unskipped ACL test, the runtime-only libc proof, `IsVolatile`.
