# T11p Windows startup lock: Claude review r6 (narrow, Opus master)

**Verdict: PASS. Push the reviewed head for the one combined 4-OS run.**

- **Reviewed:**
  - the fix diff `7f3027e..940a996` (final code), and the evidence-only commit `9976659`, which
    is the local head (HOLDPUSH);
  - the author report `docs/validation/logs/T11p/windows-startup-lock-r6/report.md`.
- **r5 P2 closed:**
  - The deadline check between CREATE_NEW and OPEN_EXISTING is gone, so the pair is one attempt.
  - `AssertSharingBudgetExhausted` now asserts the exact `:32` suffix first, and the 80/183
    allowance is removed.
  - The held-past-bound gate can only pass by failing closed on the held lock.
- **r5 P3 closed:**
  - The brief holder now holds for 600 ms; its assertions are unchanged.
  - The report wording is aligned: the pair is one logical attempt, and file-exists is never an
    accepted diagnostic.
- **Nothing else changed:** no write retry, no change to authority, recovery or ports, and every
  boundary from r5 still holds.
- **Local evidence on the exact final code `940a996`:**
  - locked restore and a Release build with 0 warnings;
  - targeted tests: 57 passed, 33 skipped;
  - one serialized full suite: 6 + 7 + 28 + 265 = **306 passed, 47 skipped, 0 failed**, checked
    in `suite.log`.

## Combined run acceptance (one push run on the exact reviewed head)
- **Windows trx:** all native WindowsConsent* tests EXECUTED and passing, and specifically:
  - the strict kill-reopen test, with attempts and elapsed time logged;
  - brief-holder success, with at least 2 attempts;
  - held-past-bound, failing closed with exactly `:32`.
- **Also green:** macOS arm64 and Intel (including the startup self-test), Linux, and Packaging.
- **Still not proven:** what held the lock in run 3. A fast pass doesn't prove it either.
- **Still held after a green run:**
  - the full T11p acceptance (auth/Agent integration, recovery, lifecycle);
  - the combined T11+T11p Claude HIGH review;
  - T14;
  - the pre-M6 write-retry availability item;
  - the Linux carry-forwards.
