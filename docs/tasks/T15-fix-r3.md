# T15 fix r3: robust layer ownership, plus the corrected host advice (Claude, effort high)

**Why high (OD-3):** this is the third round on layer ownership. The open-time snapshot of "older
layers" relies on lifecycle events that don't cross shadow roots, aren't delivered while an element
is detached, and coalesce for popovers. Patching each event gap is fragile, so this round should
reach a model that **doesn't depend on a complete event history**.

**Target:** worktree `t15-ui-foundation`, branch `t15-ui-foundation`, at `d6740ec`. That is fix r2
d5a7840 plus the GPT r3 review commit. Read `docs/reviews/T15-r3.md` first. Its failing proofs in
`apps/catalog/e2e/review-r3.spec.ts` must pass **unchanged**, and so must all earlier proofs
(`review-r1.spec.ts`, `review-r2.spec.ts`, `packages/react/src/review-r1.test.tsx`).

**Change:**
1. **P2, stale layer classification (r3 #1).** Make ownership robust to close and reopen across
   open shadow roots, detached elements and coalesced popover toggles.
   - **Preferred:** decide at event time, from current state, not from an opening-order history.
     For example: Zilo owns the key only if the event target is in Zilo's own content and is not
     inside an open dialog, popover or role=dialog/aria-modal layer nested in Zilo. A layer outside
     Zilo can only receive focus or events while it is above Zilo's modal top layer, so a focused
     target outside Zilo's own content never belongs to Zilo.
   - Where an open-order fact is truly needed (for example, an unfocused popover's light-dismiss),
     re-validate it at event time, using `:popover-open` and `:modal` on the live element, with no
     cached state.
   - If you keep any snapshot, its invalidation must cover the same roots it scans, and it must
     re-validate on use. Explain in the README why it can't go stale.
2. **P2, host workaround (r3 #2).** Fix the `packages/ui/README.md` native-layer advice:
   `preventDefault()` in Radix `onEscapeKeyDown` also cancels the native child's own Escape
   dismissal. Either document that the host must close the child explicitly, with the exact code
   (tested by the r3 proof's scenario), or recommend only the host-library layer alternative. The
   tested contract must match the README word for word.
3. **The flaky test:** `apps/catalog/e2e/nested-layers.spec.ts:147` (the third outside click in
   Chromium) flaked once in r3. Find the cause (focus or animation timing, pointer target) and fix
   it deterministically. Don't add retries or sleeps.

**Tests (extend only):** the r3 proofs pass unchanged in Chromium and Firefox, and in WebKit in
hosted CI. Add cases for a layer inside a **closed** shadow root (document what can and can't be
known) and for a Zilo dialog that is itself reopened while a child layer is open.

**Constraints:**
- Don't edit the review proofs or `docs/reviews/**`.
- Existing tests may only be extended, not weakened.
- `@zilo/ui` stays free of dependencies; `pnpm-lock.yaml` is unchanged.
- Allowed files are the same as in `docs/tasks/T15.md`. No native Windows runs (OD-6).

**Observable acceptance:**
- Locally on Node 24: a frozen install, the licence check, format, lint, typecheck, `pnpm -r test`
  and build all pass. `CI=1 pnpm e2e` passes in Chromium and Firefox with `--retries=0`, run twice.
- Push `t15-ui-foundation` **once, at the end** (draft PR #2 runs billed ci-web). Hosted ci-web
  must be green on the pushed head in all 3 browsers with no flaky tests.
- `worker_done` gives the head SHA, the run URL and the counts.
