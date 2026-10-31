# T04a review r1 (GPT reviewer, cross-model)

**Target:** branch `t04a-web-scaffold` at author SHA `1842f4e`. The diff is `main...1842f4e`.

**Read first:** `docs/tasks/T04a.md` (the spec and acceptance), `docs/planning/DECISIONS.md` (D-002
licensing, D-009 repo layout, D-010 evidence), and `docs/planning/EXECUTION.md` §2 (review rules).

**Check, in this order:**
1. **Scope:** every changed file is inside T04a's allowed file set. List any that are not.
2. **Acceptance:** re-run it yourself from a clean checkout:
   `pnpm install --frozen-lockfile && pnpm license-check && pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`,
   then `CI=1 pnpm e2e`. WebKit may need host libraries; the author used apt-get-downloaded libraries
   on a scratch browser copy. If you can't reproduce WebKit, mark it pending; don't fail the review
   for that. Record the exact commands and outcomes.
3. **Licence gate:** it is default-deny. Check that seeding a disallowed licence fails it, and that
   MPL-2.0 is accepted only for dev-only packages.
4. **CI workflow:** `ci-web.yml` is correct (frozen lockfile, SHA-pinned actions, least-privilege
   `permissions:`) and passes actionlint, or a parse check if actionlint isn't available.
5. **Quality:** strict TS settings as specified; packages have no runtime dependencies (except
   justified ones); ESM exports correct; nothing secret committed.
6. **Coordinator-requested change** to list as a finding: pin Node **24** LTS instead of 22
   (`.nvmrc`, `engines`, workflow).

**Allowed writes:** only `docs/reviews/T04a-r1.md`, plus new failing test files if they demonstrate a
defect. Commit them on your review branch. Do not fix code.

**Output:** `docs/reviews/T04a-r1.md` with a verdict of `pass` or `changes` and numbered findings, each
with severity (blocker, major or minor), file:line and evidence. Then send `worker_done`. Its summary
gives the verdict, the number of findings and the report path.
