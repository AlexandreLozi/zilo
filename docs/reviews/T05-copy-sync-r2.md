# T05 copy sync r2 — GPT review / OD-11 pilot

**Verdict: pass.** Reviewed DeepSeek's fix at
`601d775866f26f95db008a413621bee95afc0590`, using
`git diff b32303c..601d775`, against `docs/reviews/T05-copy-sync-r1.md`
and the coordinator's `docs/tasks/T05-copy-sync-fix-r1.md`. Both r1 findings
are resolved; no new findings. No implementation changes were made.

## Numbered findings and dispositions

1. **R1 finding 1 (P2): resolved — preserve scans instead of restarting.**
   `design/prototypes/assets/copy.js:117` now says, “Let any scans already
   running finish, then try again.” It no longer recommends restarting Zilo.
   The notes at line 119 explain that restarting ends scans across tabs and
   sites and loses their pages, consistent with `api/CONTRACT.md:422–426`
   and `1291–1294`. The visible recovery advice is non-destructive, so it no
   longer needs a warning about a destructive action. Waiting is advice, not
   a guarantee that every cause will resolve; the user still initiates retry.

2. **R1 finding 2 (P2): resolved — separate unknown consent from issuance failure.**
   `design/prototypes/assets/copy.js:119` limits “no token is requested there”
   to unknown consent, matching `packages/sdk/src/detection.ts:504–510`.
   It separately states that token issuance sent `POST /zilo/v1/auth/token`
   and failed, matching `packages/sdk/src/auth.ts:177–185` and the
   `limits-exceeded` handling at `detection.ts:551–558`, including preservation
   of `retryAfterSeconds`. The new-user-action retry description agrees with
   the detection transition model and `detection.ts:203–208`.

## Scope and voice

- The complete delta contains only two changed source lines (body and notes
  for `state.auth-unavailable`) and its one regenerated Markdown row: three
  insertions and three deletions across the two permitted files. No other
  rows, fields, generator, implementation, package, or lockfile changed.
- The body remains two plain, calm sentences: what happened, then an
  actionable next step. The unchanged title is sentence case without a
  trailing period; **Try again** and **Close** remain verb buttons. No blame,
  protocol/auth jargon, unsupported installation claim, new placeholder, or
  claim of lost data is introduced in user-facing text. Technical details
  remain in implementation notes.

## Headless verification

Selected Node **24.22.2** with `source ~/.nvm/nvm.sh && nvm use`
(the shell initially used Node 22); pnpm **11.17.0**.

- `pnpm exec prettier --check docs/design/copy.md design/prototypes/assets/copy.js`:
  exit **0**, all matched files use Prettier code style.
- `design/prototypes/check/run.sh`: exit **0**, all T05 prototype checks passed.
  The generated copy table is in sync with **72 keys**; required states,
  error codes, T10 alignment, revocation, and Safari wording checks pass.
  Headless Chromium scanned **190 page states** across both themes with no
  axe violations; all **16 contrast pairs per theme** pass (lowest reported
  ratios: light **3.39:1**, dark **4.44:1**, under the check's applicable
  thresholds).
- The unchanged standard matrix limitation documented in r1 still applies:
  this is existing-prototype regression evidence, not new detection-state
  rendering or expanded-localisation layout coverage. No hosted reruns or
  native Windows/macOS runs were performed; no SDK rerun was needed for this
  copy-only delta. The working tree remained clean after these checks.

## OD-11 pilot assessment across both rounds

The pilot passes within two rounds: DeepSeek's initial bounded synchronization
covered the requested outcomes and passed mechanical checks, while GPT r1 found
two substantive auth/recovery reasoning errors that those checks could not
detect. DeepSeek's second-round fix addressed both narrowly, preserved all other
rows, and passed fresh Node 24 formatting and headless prototype checks. This
supports using DeepSeek for bounded copy synchronization with cross-model review
of user consequences and cause-specific claims, but not treating correct source
citations or green prototype checks alone as proof that recovery guidance is
safe; no further changes are required for this bounded task.
