# T05 copy sync r1 — GPT cross-model review / OD-11 pilot

**Verdict: changes.** Reviewed DeepSeek-authored
`f45bfceaabf4a86039ff00bb840668c19a854ac9`, using
`git diff origin/main...f45bfce`. Scope: the three new copy entries, the
no-separate-copy explanations, regeneration, and the prototype package boundary.
The approved amendments permit editing the copy source and adding the private
CommonJS package; neither is a scope violation. No implementation fixes were made.

## Numbered findings

1. **P2 / medium — Warn about scan loss before recommending a restart.**
   `design/prototypes/assets/copy.js:117` (generated at
   `docs/design/copy.md:85`) offers restarting Zilo as ordinary connection
   troubleshooting, without saying that it ends existing scans and loses their
   agent-held pages. This matters particularly for the documented family-limit
   cause: `api/CONTRACT.md:422–426` rejects issuance when the origin's families
   all still own jobs, or the global family bound is reached. Restarting then
   destroys jobs, including those belonging to other tabs/sites, rather than
   merely resetting this failed connection (`api/CONTRACT.md:1291–1294`). The
   new notes themselves acknowledge this loss, but notes are not user copy.
   This contradicts the voice requirement to say plainly when data is lost
   (`docs/design/copy.md:16–17`). Remove restart as generic advice, or make its
   destructive consequence explicit and prefer preserving/finishing existing
   scans. Regenerate the table after changing the source.

2. **P2 / medium — Restrict the no-token-request claim to unknown consent.**
   `design/prototypes/assets/copy.js:119` (generated at
   `docs/design/copy.md:85`) says “No token is ever requested” for the whole
   `auth-unavailable` row, but the row also covers a token issuance failure.
   `AuthClient.issue` actually sends `POST /zilo/v1/auth/token` at
   `packages/sdk/src/auth.ts:177–185`; a `limits-exceeded` response reaches
   `auth-unavailable` through `packages/sdk/src/detection.ts:551–558`.
   The existing regression test at `packages/sdk/src/fix-r1.test.ts:327–339`
   injects that precise issuance failure and confirms this outcome. Only the
   unknown-consent branch at `detection.ts:504–510` avoids authorization/token
   issuance; its separate test at `fix-r1.test.ts:342–356` asserts zero issuance
   calls. Qualify the notes by cause instead of applying the latter guarantee
   to both. The author's cited emission lines are correct; the explanation of
   the resulting auth history is not.

## Source and copy audit

- **`state.sdk-too-old`: correct.** `packages/sdk/src/compat.ts:40` checks
  `hello.protocol.min > SDK_PROTOCOL.max`; `detection.ts:409–414` emits the
  separate SDK-too-old state before consent. The new copy points to updating
  the site/app, never downloading/installing the agent, and exposes no installed
  version. The commit's source citations match.
- **`state.auth-unavailable`: both triggers correctly identified.** Unknown
  consent is emitted at `detection.ts:509–510`; a resource-bound auth failure is
  emitted at `detection.ts:555–557`, retaining its typed cause and retry delay.
  `TRANSITIONS` permits a new user-initiated retry (`detection.ts:78,203–208`).
  Findings 1–2 concern the recovery advice and the overly broad notes, not the
  existence of this row.
- **`agent-restarted`: correct.** `client.ts:318–321` classifies tracked jobs
  after an observed instance change; `errors.ts:133–136` declares the local
  code and `retryable = true`, and `client.ts:360,379,484` throws it. The copy
  names the restart and loss and offers a user-initiated **Scan again**, not an
  automatic rescan. Same-instance missing jobs remain `not-found`. Its placement
  in the T10 hand-off section is acceptable because the notes explicitly say
  SDK-local, not a wire code (`api/CONTRACT.md:1441–1443`).
- **All seven no-separate-row explanations are supported; no omitted
  user-visible outcome needs another row.** `agent-too-old` and
  `missing-capabilities` are Fit reasons (`compat.ts:39,42`) mapped to
  `state.outdated` (`detection.ts:412`); `outdated-authorized`
  (`detection.ts:472–475`) uses the existing version-bearing row;
  `consent-blocked` (`detection.ts:498,544`) uses the existing permanent-block
  variant with no Ask again/countdown; `consent-state-unknown` is the cause
  inside the new auth row, not another state. `no-store` is transport/cache
  policy (`transport.ts:92`, contract R-T7), and `local-network-access` is an
  unverified diagnostic hint, not permission-help copy
  (`permission.ts:13–18`, `detection.ts:375–382`).
- **Other copy checks:** the new titles are sentence case without trailing
  periods; bodies contain two plain sentences; buttons are verbs; no user text
  claims “not installed” or exposes protocol/auth jargon. `{trayArea}` is an
  existing documented placeholder and substitutes correctly. No new plural or
  sentence-fragment assembly is introduced. Existing per-browser help, origin
  wording, revocation wording, rows, and columns are unchanged. Finding 1 is the
  exception to the otherwise calm, actionable voice.

## Headless Linux evidence

Node **24.22.2**, pnpm **11.17.0**, selected with
`source ~/.nvm/nvm.sh && nvm use`:

- `pnpm install --frozen-lockfile`: exit **0**, six workspace projects.
- `pnpm exec prettier --check docs/design/copy.md design/prototypes/assets/copy.js design/prototypes/package.json`:
  exit **0**.
- `design/prototypes/check/run.sh`: exit **0**; generated table in sync,
  **72 keys**, **190 page states**, no axe violations, **16 contrast pairs per
  theme** pass. All five existing HTML prototype pages ran without script
  errors in headless Chromium; classic-script loading still works.
- `pnpm --filter @zilo/sdk test -- src/fix-r1.test.ts src/detection.test.ts src/lost-session.test.ts`:
  exit **0**; this script invocation ran the entire SDK suite, **159/159**.
  A separate `pnpm exec vitest run src/fix-r1.test.ts src/detection.test.ts src/lost-session.test.ts`
  from `packages/sdk` ran exactly the three files, **57/57**.
- An additional stdin-driven headless Playwright smoke check loaded the three
  new entries through browser `ziloCopy`, verified filled placeholders and
  title/body/primary, and directly rendered the restart banner with its visible
  **Scan again** button in both themes; no script errors.
- **Coverage limit:** the unchanged standard matrices include none of the three
  new rows. The two new detection states have no prototype render branches yet
  (`detection.html:86–99,293–319`), and `agent-restarted` is not in
  `copy.js:527–529`'s banner list. Thus the 190-state result proves existing-page
  regression safety, not new detection layouts or expanded-localisation layout
  coverage. Wiring those states is outside this bounded copy-only review.
- `pnpm-workspace.yaml:1–3` selects only `packages/*` and `apps/*`;
  `pnpm -r list --depth -1 --json` confirms the root plus the five named
  workspace packages, not `design/prototypes`. The new package's
  `private: true` / `type: commonjs` repairs Node's interpretation of the
  existing copy source under the root ESM package without changing browser
  script semantics. `pnpm-lock.yaml` is unchanged both in the author delta and
  after installation; its `origin/main` and reviewed-HEAD blob IDs are both
  `897c23edbbe9ac512a7304643a82ae67df73c613`.

No hosted reruns or native Windows/macOS runs were performed. Only this review
report is changed on the review branch; the author branch is untouched.

## OD-11 pilot assessment

DeepSeek's bounded change is mostly accurate: every requested outcome is
accounted for, the cited SDK emission lines are real and relevant, compatibility
direction and restart retry semantics are correct, existing copy is preserved,
and the source-of-truth/package amendments are applied narrowly with passing
checks. The weakness is reasoning across the two auth-unavailable causes: the
author generalized the unknown-consent no-token guarantee to an issuance failure
and recognized destructive restart semantics only in implementation notes,
not in the advice users read. This pilot supports using the author for bounded
copy synchronization with cross-model review, but not accepting auth/recovery
guidance solely on correct citations and passing prototype checks; both findings
need correction before approval.
