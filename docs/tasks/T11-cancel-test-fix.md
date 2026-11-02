# T11 cancellation-observation test race fix (DeepSeek, OD-11; GPT reviewer)

**Why:** hosted Backend CI has failed on every T11 and T11p head. Two `SecurityInvariantTests`
fail only at `Assert.True(prompt.CancellationRequested)`:
- `Prompt_timeout_cancels_native_callback_and_releases_global_slot`;
- `Removing_a_prompt_cancels_native_wait_and_stale_completion_cannot_grant`.

**Cause:** the `GatePrompt` test double (`SecurityInvariantTests.cs:125-140`) calls
`cancellationToken.Register(() => CancellationRequested = true)` **before** `WaitAsync(token)`
registers its own callback. CTS runs callbacks in LIFO order, so the wait cancels first and
`finally` sets `Finished`. With `RunContinuationsAsynchronously`, the test then reads the
non-volatile bool before the first callback has set it. In the Remove test, the store cancels
outside the gate, so `Complete(Granted)` can also finish the wait before the cancel arrives.

**Target:** worktree `t11-cancel-test-fix`, branch `t11-cancel-test-fix`, from `70769cf` (the
t11p-integration head).

**Change:** `backend/tests/Zilo.Agent.Tests/SecurityInvariantTests.cs` **only**, plus
`docs/validation/logs/T11/cancel-test-fix.md`.
1. In `GatePrompt`, replace the `CancellationRequested` bool with **one cancellation signal per
   `RequestAsync` call**: a `TaskCompletionSource<bool>` created with
   `RunContinuationsAsynchronously`, set from the `Register` callback.
   - Expose the **first** call's signal, for example `FirstCancelled`, or a list indexed by call.
   - A later `RequestAsync` (the timeout test's `next.example` call) must never satisfy the first
     call's observation.
2. In both tests, replace `Assert.True(prompt.CancellationRequested)` with a bounded await of the
   first call's signal, for example
   `await prompt.FirstCancelled.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken)`.
3. Keep every other assertion exactly: state `none`, the global slot released (`next` is
   `pending`), and stale completion can't grant.
   - No sleeps, no retries, no `Skip`.
   - No production code change, and no change to any other test.

**Validation (pinned SDK):**
```
export DOTNET_ROOT=/tmp/opencode/t12-proto-r2/sdk/dotnet   # or .../sdk if dotnet is there
export PATH=$DOTNET_ROOT:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
```
- Targeted, repeated: run `dotnet test backend/tests/Zilo.Agent.Tests -c Release --filter FullyQualifiedName~SecurityInvariantTests`
  **50 times** in a loop. Report the pass count (it must be 50/50).
- Then run the full locked suite once:
  `dotnet restore backend/Zilo.slnx --locked-mode`, then `dotnet test backend/Zilo.slnx -c Release`.
  Report the counts.
- Record both in the evidence log.

**Constraints:**
- Push only branch `t11-cancel-test-fix` (no PR).
- This branch has backend changes, so the push triggers hosted Backend CI. That is expected: it is
  the evidence.
- Don't edit `opencode.json` or `.opencode/*`.

**Acceptance:** `worker_done` with the head SHA, the 50x count, the full-suite counts and the
diff summary.
