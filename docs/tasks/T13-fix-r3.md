# T13 fix r3: deadline enforcement in flight, plus run ownership (Claude, effort high)

**Why high (OD-3):** this is the third round on the same deadline. Fix r2 (medium) guarded the
points before and after each await, but not the pending work itself, and not the ownership of
stale runs. These are async race and cancellation semantics, and they need a single coherent model
rather than more point guards.

**Target:** worktree `t13-sdk-core`, branch `t13-sdk-core`, at `6b6134a`. That is fix r2 da9fd2f
plus the GPT r3 review commit. Read `docs/reviews/T13-r3.md` first. Its failing proofs in
`packages/sdk/src/review-r3.test.ts` must pass **unchanged**, and so must the r1 and r2 proofs
(`review-r1.test.ts`, and the r2 proof file).

**Change: one model, not three patches.** Each detection run owns:
- an `AbortController`;
- one deadline timer, armed at `run.since + cap`, that **aborts the run's signal** when it fires;
- a run identity (a token or generation counter).

Then:
1. **P2, in-flight authorization (r3 #1).** Every awaited step, including `authorize()`,
   credential-store locks, transport and `hasToken()`, takes the run's signal. When the
   deadline aborts the run, pending work rejects or is ignored, and **no side effect starts after
   the abort**: no token issuance, credential write, consent POST or GET. Check the signal right
   before each side effect, not only after it completes. If a credential write is truly atomic
   and can't be cancelled, document why it's safe, and prove that issuance stays at 1.
2. **P2, boundary semantics (r3 #2).** The deadline is exclusive. At `now >= deadline`, stop: no
   new request starts. Use the same comparison everywhere (one helper).
3. **P2, run ownership (r3 #3).** Only the current run may change the snapshot. Each
   continuation and the deadline handler check run identity first, and a stale or aborted run's
   continuation returns without touching state. Cancelling run A clears A's deadline timer, so A
   can't stop run B.

Keep `dispose()`/`disconnect()` as a full teardown that aborts the current run through the same
path.

**Tests (extend only):** the 3 r3 proofs pass unchanged. Add tests for:
- a deadline that fires during each awaited step (token read, authorize, consent POST, consent
  GET, the 429 backoff);
- an A → B → C replacement chain where A and B resolve late;
- `dispose()` during each pending step.

All of them use fake timers and must be deterministic.

**Constraints:**
- Don't edit the review proofs, `api/**` or `docs/reviews/**`.
- No new dependencies; `pnpm-lock.yaml` stays unchanged.
- Existing tests may only be extended, not weakened.
- Allowed files: `packages/sdk/**`, `docs/validation/logs/T13/**`. Append a fix-r3 section to the
  T13 validation log.
- Headless only; no native Windows runs.

**Observable acceptance:**
- On Node 24 (`source ~/.nvm/nvm.sh && nvm use`): a frozen install, then lint, typecheck,
  `pnpm -r test`, build and format:check all pass, including the 10 review proofs (r1 5, r2 2,
  r3 3).
- Push `t13-sdk-core` (no PR).
- `worker_done` gives the head SHA and the counts.
