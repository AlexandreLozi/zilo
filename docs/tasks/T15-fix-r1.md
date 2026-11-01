# T15 fix r1: focus and React defects, plus the host-modal fixture (Claude, effort high)

**Why high (OD-3):** finding 5 is a design problem. Our dialog has to coordinate dismissal and focus
with a host app's modal (Radix) that we don't control, and it has to work in 3 browsers.

**Target:** worktree `t15-ui-foundation`, branch `t15-ui-foundation`, at `55f6300`. That is the T15
head 5814593 plus the GPT r1 review commit. Read `docs/reviews/T15-r1.md` first. The review's
failing proofs are `apps/catalog/e2e/review-r1.spec.ts` and `packages/react/src/review-r1.test.tsx`.
They must pass **unchanged**.

**Binding:** CLAUDE.md, OD-4 (headless), OD-8. Read `docs/tasks/T15.md` on main, including its
2026-11-01 host-modal addendum, and `docs/context/dwt-integration-inventory.md` ("Install flow"):
DWT's install dialog breaks the owner's Radix modal, and the owner had to work around it in
`ScanDialog.tsx`.

**Change:**
1. **P1, disabled fieldsets.** Focus eligibility must use the effective disabled state: a control
   inside a disabled `<fieldset>` is disabled, except inside that fieldset's first `<legend>`.
   Never prevent Tab and then target a stop that can't take focus.
2. **P2, `display: contents`.** In the flattened-tree traversal, decide whether a node is eligible
   separately from whether its descendants are visible. A `display: contents` wrapper doesn't take
   focus, but its visible children do.
3. **P2, React prop order.** Apply all opening-time configuration (`initialFocus`, heading, alert,
   `hideClose`, and so on) before the `open` transition, in the same update.
4. **P2, the initial `onOpen` event.** Attach event listeners before any property assignment that
   can emit an event synchronously, so that mounting with `open` fires `onOpen` exactly once.
5. **Required addition: the host-modal fixture.** In `apps/catalog`, add a React Radix `Dialog` host
   that opens `<zilo-dialog>`. Make it work **without hacks in the host**: no `body.style`
   resets, no `onPointerDownOutside` blocking. The fixture must assert, with real pointer and
   keyboard input in Chromium, Firefox and WebKit:
   - nested focus-trap hand-off, with focus returning to the host dialog when ours closes;
   - no `pointer-events` lock-out of our dialog while the host has locked `body`;
   - correct stacking (top layer, portals, z-index);
   - Escape and outside-click close **only the topmost dialog**. A capture-phase host listener must
     not dismiss the host while ours is open;
   - axe passes on 0 violations.

   Design it in `@zilo/ui`. Expect the review's points to need a coordinated approach, not a higher
   z-index:
   - the focus stack only knows Zilo dialogs;
   - Escape suppression runs in the bubble phase;
   - there's no outside-click or backdrop policy;
   - there's no explicit pointer-events policy.

   Document the integration contract briefly in `packages/ui/README.md`: what a host must and must
   not do. `@radix-ui/react-dialog` may be added only as an **`apps/catalog` devDependency**. Keep
   `@zilo/ui` free of dependencies; T15 owns `pnpm-lock.yaml`, and the licence gate must stay green.

**Constraints:**
- Don't edit the review's proof tests or `docs/reviews/**`.
- Existing tests may only be extended, not weakened.
- Allowed files are the same as in `docs/tasks/T15.md`.
- No native Windows runs (OD-6).

**Observable acceptance:**
- Locally on Node 24: a frozen install, the licence check, format, lint, typecheck, `pnpm -r test`
  and build all pass. `CI=1 pnpm e2e` passes in Chromium and Firefox; say so if local WebKit is
  blocked.
- Push `t15-ui-foundation` **once, at the end**: draft PR #2 runs ci-web, and every push costs
  billed minutes. Hosted ci-web must be green on the pushed head in all 3 browsers, including the
  new fixture.
- `worker_done` gives the head SHA, the run URL and the counts.
