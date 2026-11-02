# T13 fix r4: restart cleanup honours the run signal (Claude, effort medium)

**Why medium (OD-3):** one missed branch inside the fix-r3 run model. The model already exists;
the job is to thread the signal through it and guard one critical section.

**Target:** worktree `t13-sdk-core`, local branch `AlexandreLozi/t13-sdk-core` (pushes to
`origin t13-sdk-core`), at `eaf410c`. That is fix r3 1a84ea7 plus the GPT r4 review commit. Read
`docs/reviews/T13-r4.md` first. Its 2 proofs in `packages/sdk/src/review-r4.test.ts` must pass
**unchanged**, and so must all 10 earlier review proofs.

**Change (r4 finding 1, P2):**
- Forward the run signal from authorization's full `hello` into `observeInstance` and
  `dropAllExcept` (`client.ts:295,310–325`, `auth.ts:253–258`).
- Check the signal and the closed-client state before acquiring the lock, and again inside the
  critical section before the write. No credential write may **start** after the deadline or after
  `dispose()`.
- Keep the instance-loss behaviour: renewal `401 token-invalid` → `agent-restarted`, family
  cleanup on a real restart. When cleanup is skipped because the run was aborted, the stale
  families must be cleaned on the next live run, not lost. Add a test for that.
- Then audit every other `await` reachable from a run that leads to a credential-store call, and
  list them in the log, each with its guard. If you find another unguarded path, fix it and add a
  test.

**Constraints:**
- Don't edit the review proofs, `api/**` or `docs/reviews/**`.
- No new dependencies; `pnpm-lock.yaml` stays unchanged.
- Existing tests may only be extended, not weakened.
- Allowed files: `packages/sdk/**`, `docs/validation/logs/T13/**`. Append a fix-r4 section to the
  T13 validation log.
- Headless only.
- Push **only** to `origin t13-sdk-core`; don't create other remote branches.

**Observable acceptance:**
- On Node 24: a frozen install, lint, typecheck, `pnpm -r test`, build and format:check all pass,
  including the 12 review proofs.
- `worker_done` gives the head SHA and the counts.
