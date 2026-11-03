# T11p durable authorization coordinator: Claude HIGH review r1 (whole coordinator, ★)

**Verdict: PASS for the coordinator slice. There is no P1 or P2. Five P3 carry-forwards are listed
below.** It is still unwired and not T11p acceptance.

- **Reviewed:** `9976659..7178250` on `AlexandreLozi/t11p-integration`. The tested code is
  `19d895e`; `7178250` only adds the report.
  - Product code: `Consent.cs` (+463/−) and the new `ConsentPersistenceCoordinator.cs` (473
    lines).
  - Tests: Durable, Shutdown, PromptLifetime, MetadataRetention, NativeConsentPublication and
    Atomic, plus the Windows retained-lock fixture.
  - The fix 1 to 5 reports, ending with `docs/validation/logs/T11p/prompt-lifetime/report.md`.
- **Author's local evidence (checked in `final-backend.log`):** 7 + 6 + 28 + 356 = **397 passed,
  48 skipped, 0 failed**.
- **Provenance:** every helper is GPT-family (the manifests are in the reports), so this Claude
  review is cross-family.

## Checked and correct
- **Durable before grant.** A grant changes in-memory authority only in `CommitLocked`, after
  `WriteSnapshotAsync` returns.
  - The commit also requires the same lifecycle epoch, no seal, health Ready, no failure, the
    current origin sequence and an unchanged desired record.
  - Otherwise the outcome is `Superseded`, and no authority is published.
- **Restrictive first.**
  - Deny, block and remove change memory under the gate *before* they reserve the write, and
    `OriginRemoved` fires before the ack.
  - If a restriction is rejected because the store is full, the store is marked Unavailable.
- **Fails closed while not Ready.**
  - `IsGranted`, `StatusReadOnly` and `RequestAsync` return false, "none" or 503 whenever health
    isn't Ready. So durable restrictions that aren't committed while Unavailable can't leave a
    grant live.
  - Startup does no lazy disk reads.
- **Stale operations can't win.**
  - Generations are global and never reset, and the per-origin sequence is that generation.
  - `CancelGrant` does nothing when the sequence or desired record has moved on. In an old epoch
    or after the seal, it marks the store Unavailable and never compensates.
  - Compensation reserves a durable remove. If there's no capacity or the generation is
    exhausted, it marks the store Unavailable.
  - Cancelling a grant that is already committed returns the real result, not a pretend rollback.
- **Prompts.**
  - One gate transaction checks the prompt's identity (id, GUID, active prompt, owner reference,
    epoch, Ready) and reserves the write.
  - The deadline is re-checked at the decision transaction, and a decision after the deadline
    is dropped.
  - `PromptCancellationOwner` disposes the CTS only after both the resolution and any
    cancellation in flight finish, which closes the premature-Dispose failures (`red.log`).
- **Limits, as co-approved.**
  - Store 4160 = 4096 + 64, and sequences 8320.
  - Pruning never removes desired, owned, pending, prompt-hour or 24-hour-denial state.
  - A grant over the limit rejects only that grant. A restriction over the limit fences the store.
  - Generation exhaustion fails closed. An oversized snapshot at open is rejected before
    hydration.
- **Shutdown (joint A/B).**
  - One owner and one epoch, with a monotonic 5 s total budget shared by open, writer, marker and
    release.
  - The seal and channel completion happen in one transaction, so admitted pending work still
    drains and nothing new is admitted.
  - Clean is issued only after the seal, with every admitted write durable, zero owned work, no
    failure or abandon or dispose, and budget left.
  - Dispose-first never cleans.
  - A late clean or a late release is never reported as success.
  - The single release happens only after real quiescence, and the observer timeout never
    unlocks.
  - A failed clean poisons the store, and the bytes on disk are only the old dirty state or the
    new clean one.
- **The five required test classes are all present.**
  1. The seal race: `Restriction_after_clean_reservation…` and `Stop_fences_late_grant…`.
  2. Dispose-first: `Dispose_before_marker_suppresses_clean…`.
  3. Late clean: `Writer_and_marker_share_remaining_budget…` and `Total_budget_expires_during_write…`.
  4. In-process reopen: `Native_pending_shutdown_retains_lock_32…` (Windows-native; skipped on
     Linux).
  5. Failed clean: `Failed_atomic_clean_has_only_actual_old_dirty_or_new_clean_bytes…`.

## P3 carry-forwards (non-blocking; owners named)
1. **Denied records never expire from desired state or disk, so the store-full fence can come
   back every time.**
   - Expired denials (past their cooldown and past the 24-hour streak window) are never retired.
   - After 4096 distinct denied or blocked origins, each new-origin restriction marks the store
     Unavailable. A restart restores the same full set, so the trap recurs.
   - Reaching it needs at least 410 hours of user-denied prompts at 10 an hour, so the
     likelihood is low, but it is persistent.
   - **Owner:** the recovery/lifecycle slice, before M6, beside the write-retry item. Retire
     expired denials to "none" when snapshotting; the tray Remove (T44) is the manual way out.
2. **Dispose-first reports `Health=Stopped` before quiescence**
   (`ReserveShutdownLocked`). It's safe, because non-Ready already fails closed and a reopen
   fails with :32.
   - The Agent integration slice must use `ShutdownPending` or the owner task, not `Health`, to
     mean "released". Alternatively, report Stopping until release.
3. **`StopAsync` never throws on timeout or cancellation, and caller cancellation suppresses the
   clean.** That is conservative: the next start sees a dirty fence. The Agent wiring must read
   `Health` and `CleanShutdownSucceeded`, and must not pass a token shorter than the budget.
4. **Writes drained after the seal report `Superseded` even when they are durable.** That
   includes a grant that will be active next session.
   - This is deliberate: there is no post-seal Durable ack.
   - The T05 and T44 copy must not tell the user "not saved" for a shutdown-time Superseded.
     Record this in the copy table.
5. **Native evidence is stale for the new Windows fixture.** The retained-lock fixture is
   Windows-only and hasn't run natively, because the native test set changed after `9976659`.
   - It must execute and pass in the next combined Windows run.
   - Batch it with the Agent integration slice (OD-15) unless the masters want earlier signal.

## Status
- **Reviewed:** the coordinator slice is reviewed (★ cross-family).
- **Still not done:** Agent/Core/API wiring; the recovery, quarantine and lifecycle slices;
  native evidence for the new fixture; the combined T11+T11p Claude HIGH review; exact-SHA CI;
  T14; the pre-M6 availability items; the Linux carry-forwards.
- **Branch:** HOLD-PUSH remains the masters' call; no CI is required by this review alone.
