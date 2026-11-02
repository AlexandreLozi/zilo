# T11 cancellation test fix — GPT r1

Verdict: **PASS** for the test-only fix at
`f4619037d6e7768cc8752687df3e643b7248e449`, based on `70769cf`.

Reviewed the exact diff and surrounding `SecurityInvariantTests` helper and assertions.
No production code changes or security assertion weakening were found.

- Each request captures its own asynchronous-continuation cancellation signal. Only that
  request's token callback completes it; a later request cannot satisfy `FirstCancelled`.
- The list insertion precedes `Started`, and the lock protects publication and selection.
  The tests access the first signal only after observing `Started`.
- Both observations now await the cancellation callback with a five-second bound and the
  test cancellation token, rather than racing an unsynchronized boolean against `Finished`.
- Stale completion, `none` state, native-wait completion and next-prompt slot assertions remain.
  There are no sleeps, retries, skips or production fixes disguised as a test repair.

Evidence reused: the author's 50 passing targeted repetitions and locked full suite
(246 passed, 12 explicitly documented platform/tool skips). These were not independently
rerun for this review: the exact diff supplies the synchronization argument, and repeating
the same probabilistic stress run would not strengthen that argument proportionately.
Hosted Backend run `41518625514` remains the cross-OS evidence source; its unrelated
Apple Silicon adapter failure must not be mistaken for a cancellation-fix failure or waived.

Scope: approval to compose this test fix into the macOS adapter correction. This is not a
macOS adapter PASS, hosted-CI PASS, T11p acceptance, or merge authorization.
