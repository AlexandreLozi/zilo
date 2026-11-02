# T15 fix r2: topmost-layer Escape ownership (Claude, effort high)

**Why high (OD-3):** this is a cross-browser design problem. Zilo has to decide which layer owns a
keypress, across native `<dialog>` top-layer modals and React layers it does not control, in
Chromium, Firefox and WebKit. A naive gate either swallows keys that belong to the host or brings
back the Radix capture-phase bug that r1 fixed.

**Target:** worktree `t15-ui-foundation`, branch `t15-ui-foundation`, at `4ece1fe`. That is fix r1
e158d0d plus the GPT r2 review commit. Read `docs/reviews/T15-r2.md` first. Its failing proof
`apps/catalog/e2e/review-r2.spec.ts` must pass **unchanged**, and so must the r1 proofs
(`apps/catalog/e2e/review-r1.spec.ts`, `packages/react/src/review-r1.test.tsx`).

**Binding:** CLAUDE.md, OD-4 (headless), OD-8. Read `docs/tasks/T15.md` on main, including the
host-modal addendum, and `docs/tasks/T15-fix-r1.md`.

**Change (r2 finding 1, P2):** Zilo claims Escape only when the topmost Zilo dialog is in fact the
topmost modal layer **and** focus or the event target is that dialog's own content. It must not be
inside a newer layer nested in it.
- A newer layer is any open modal or dismissable layer opened after this Zilo dialog: a native
  `dialog:modal` (or a non-modal `dialog[open]` that holds focus), an `[aria-modal="true"]` or
  `role="dialog"`/`"alertdialog"` element, or a popover (`:popover-open`). It may be inside the
  Zilo dialog's DOM or rendered through a portal container that the host placed inside it.
- When a newer layer owns the key, Zilo does **nothing**: no `preventDefault`, no
  `stopPropagation`, and no close. That newer layer then handles Escape the normal way (native
  `cancel`, or its own listener).
- Keep the r1 protection: while Zilo is the topmost layer, an **outer** host's capture-phase
  document listener (Radix `DismissableLayer`) still must not dismiss the host. Keep the current
  Zilo-on-Zilo stack gating.
- Apply the same ownership rule to **Tab** handling and to the backdrop or outside-click close:
  when a newer layer is topmost, Zilo doesn't trap its Tab and doesn't treat clicks on it as
  "outside".

**Tests (extend only):**
- The r2 proof passes unchanged in Chromium and Firefox; it must pass in WebKit too, in hosted CI.
- Add a catalog fixture: a Radix `Dialog` (or Popover) opened **inside** `<zilo-dialog>`, portaled
  into a container inside it. Escape closes only the Radix layer; a second Escape closes Zilo; a
  third closes the outer host. If a browser makes this impossible, prove that with a test and
  document the exact remaining limit in `packages/ui/README.md` (replacing the current blanket
  "nested Radix layers don't get Escape" note).
- Add a regression test that the r1 outer-host capture-listener case still holds.
- Update the README integration contract: what counts as a newer layer, and what a host must do
  for a layer that Zilo can't detect.

**Constraints:**
- Don't edit the review's proof tests or `docs/reviews/**`.
- Existing tests may only be extended, not weakened.
- `@zilo/ui` stays free of dependencies. Radix stays a catalog-only devDependency, and
  `pnpm-lock.yaml` changes only if an existing catalog devDependency truly needs a new Radix
  package; the licence gate must stay green.
- Allowed files are the same as in `docs/tasks/T15.md`. No native Windows runs (OD-6).

**Observable acceptance:**
- Locally on Node 24 (`source ~/.nvm/nvm.sh && nvm use`): a frozen install, the licence check,
  format, lint, typecheck, `pnpm -r test` and build all pass. `CI=1 pnpm e2e` passes in Chromium
  and Firefox; say so if local WebKit is blocked.
- Push `t15-ui-foundation` **once, at the end**: draft PR #2 runs ci-web, and every push costs
  billed minutes. Hosted ci-web must be green on the pushed head in all 3 browsers.
- `worker_done` gives the head SHA, the run URL and the counts.
