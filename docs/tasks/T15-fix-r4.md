# T15 fix r4: bound the native Escape recovery (Claude, effort high)

**Why high (OD-3):** this is the fourth round on layer ownership. The fix must reconcile two proof
sets that pull in opposite directions: r3 #4, where Zilo recovers a cancelled Escape, and r4, where
Zilo must not override a cancellation. This round is about safety limits, not about adding
features.

**Target:** worktree `t15-ui-foundation`, branch `t15-ui-foundation`, at `25f5930`. That is fix r3
d09b8c5 plus the GPT r4 review commit. Read `docs/reviews/T15-r4.md` first.
- Its failing proofs in `apps/catalog/e2e/review-r4.spec.ts` must pass **unchanged**.
- So must every earlier proof: `review-r1.spec.ts`, `review-r2.spec.ts`, `review-r3.spec.ts`,
  including r3 #4 "documented host Escape prevention must still let the native child dismiss",
  and `packages/react/src/review-r1.test.tsx`.

## Change

Keep the automatic recovery, the active close after a host cancels Escape, but only when **all**
of these hold at event time:

1. **Containment (r4 #1).** The native layer (a modal `<dialog>`, or an `auto` or `hint` popover)
   is inside this Zilo dialog's own content, in the flat tree. That covers light-DOM children and
   open shadow roots reached from Zilo content. Never touch a layer outside Zilo, such as one
   appended to `body` or owned by another host modal.
2. **Known order (r4 #2).** The layer is **known** to have opened after this opening of the Zilo
   dialog.
   - Without a lifecycle history, one fail-safe test is acceptable: the layer was **not** open
     (`:modal` / `:popover-open`) when this Zilo dialog opened.
   - The record taken at open time may only ever *withhold* recovery, never authorize closing
     something. An element recorded as open at open time is "order unknown", even if it later
     closed and reopened. For those elements, Zilo does nothing after a cancellation, which is
     what the browser does.
   - The event-time ownership model from r3 (who owns the key when nothing cancels it) is
     unchanged. Only the active-close fallback uses this stricter test.
   - An equally safe alternative is fine: for example, an inertness check that proves the layer is
     above Zilo's modal dialog. Explain it in the README.
3. **Opt-out.** A host that wants a native layer inside Zilo to stay open on Escape has a
   documented, tested way to say so. For example, `stopPropagation()` together with
   `preventDefault()` in its listener, if Zilo's handler then never sees the key. Or a marker
   attribute. Pick the smallest option and pin it with a test.

When any of the three conditions fails, Zilo does nothing: no `preventDefault`, no close.

**README (`packages/ui/README.md`, Escape section and the host advice):** state the exact boundary
(inside Zilo content, opened after Zilo, the opt-out), and say what happens for an "order unknown"
layer. The tested contract must match the README word for word.

## Tests (extend only)

All r4 and earlier proofs pass unchanged in Chromium and Firefox, and in WebKit in hosted CI. Add:
- the opt-out case;
- an older child that closed and reopened while Zilo was open, with a cancellation: it is not
  closed;
- a layer in an open shadow root inside Zilo, opened after Zilo, with a cancellation: it is
  recovered.

## Constraints

- Don't edit the review proofs or `docs/reviews/**`.
- Existing tests may only be extended, not weakened.
- `@zilo/ui` stays free of dependencies, and `pnpm-lock.yaml` is unchanged.
- Allowed files are the same as in `docs/tasks/T15.md`. The proof-file lint waiver may extend to
  `review-r4.spec.ts` only if it is needed.
- No native Windows runs (OD-6).

## Observable acceptance

- Locally on Node 24: a frozen install, the licence check, format, lint, typecheck, `pnpm -r test`
  and build all pass. `CI=1 pnpm e2e` passes in Chromium and Firefox with `--retries=0`, run
  twice.
- Push `t15-ui-foundation` **once, at the end** (draft PR #2 runs billed ci-web). Hosted ci-web
  must be green on the pushed head in all 3 browsers, with no flaky tests.
- `worker_done` gives the head SHA, the run URL and the counts.
