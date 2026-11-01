# T13 fix r1: SDK auth recovery, shared families, teardown, plus the triage fixes (Claude, effort high)

**Why high (OD-3):** two P1 credential and recovery defects, in multi-tab and lifecycle logic.

**Target:** worktree `t13-sdk-core`, branch `t13-sdk-core` (local name `AlexandreLozi/t13-sdk-core`),
at `d294335`. That is the T13 head a6de031, which already contains the merged T10 contract from
main, plus the GPT r1 review commit.

**Read first:**
- `docs/reviews/T13-r1.md`. Its failing proofs in `packages/sdk/src/review-r1.test.ts` must pass
  **unchanged**.
- On main:
  - `docs/tasks/T13.md`;
  - DISCUSSION, the "[GPT] Post-merge T13 nine-item triage" entry (both masters agreed to it);
  - `docs/context/dwt-integration-inventory.md`, the Lifecycle section: the owner's app calls
    Load and Unload on every dialog open;
  - `api/CONTRACT.md`.

**Change: the r1 findings.**
1. **P1:** credential acquisition and renewal must run inside the same recovery path as the
   protected call. Example: renewal returns `401 token-invalid` after an agent restart. The SDK must
   then read the full hello again and report `agent-restarted` (R-A10, R-R3). Revocation and
   transport recovery must also apply when renewal is what failed.
2. **P1:** pruning shared family storage must never delete another client's live family. Prune only
   what this client provably owns, or what has provably expired. It must be safe under concurrent
   clients that share one store (R-A15).
3. **P2:** one new scan makes exactly one rollover. Keep the selected family through the request;
   don't select it again in `call()`.
4. **P2:** add a real disposal lifecycle (`dispose()`, or make `disconnect()` a full teardown). It
   must:
   - cancel pending detection and consent polling, and release timers and subscriptions;
   - stop any later grant from issuing a token;
   - be idempotent.

   Add a test of **20 create/dispose cycles** with no leaked timers or listeners and no stale state.
   This is the owner's Load/Unload pattern.
5. **P2:** keep the original overall detection deadline across auth and consent retries, so the
   D-008/T05 overall cap is always reached.

**Change: the agreed triage items.**
- **#4:** keep unknown consent states and the real `limits-exceeded` as distinct typed causes. Don't
  map them to `consent-expired` or `rate-limited`. Use a safe generic or unsupported UI state, and
  never mint a token on an unknown state.
- **#5:** keep `fit.reason: sdk-too-old` and point the user to an app or SDK upgrade, never to an
  agent update.
- **#6:** use explicit runtime type guards for the known resolution kinds, with R-D4's default-only
  fallback. Never cast unknown payloads to list or range.
- **#7:** an unsupported permission query gives `unknown`, never `denied`. Don't treat the
  `local-network-access` fallback as proof of the same permission. Document it as unverified,
  pending browser evidence.
- **#3:** a re-probe may continue only the same user-opened, visible install flow, within its
  overall deadline. Stop on dismiss, navigation or deadline. Coalesce prompts, respect the denial
  cooldown, and make no autonomous consent retries.
- **#1, #2, #9:** notes in `packages/sdk/README.md`. For #2, ports stay a placeholder until T11
  publishes the shared port tuple.
- **#8 is not in scope.** Don't claim cross-tab job recovery; T21 owns it.

**Constraints:**
- Don't edit the review's proof tests, `api/**` or `docs/reviews/**`.
- No new dependencies; `pnpm-lock.yaml` stays unchanged.
- Existing tests may only be extended, not weakened.
- Allowed files: `packages/sdk/**`, `docs/validation/logs/T13/**`.
- Headless only; no native Windows runs.

**Observable acceptance:**
- On Node 24 (`source ~/.nvm/nvm.sh && nvm use`): a frozen install, then lint, typecheck,
  `pnpm -r test` and build all pass, including the 5 review proofs and the new 20-cycle test.
- Push `t13-sdk-core`. No PR is needed: ci-web runs on PRs and main only.
- `worker_done` gives the head SHA and the counts.
