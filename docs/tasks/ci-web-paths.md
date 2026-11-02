# ci-web push path filter (DeepSeek author, OD-11; GPT reviewer)

**Why:** `ci-web` runs on every push to `main` with no path filter. Each docs-only push cancels the
previous run (`cancel-in-progress`), so post-merge runs keep getting cancelled. Five were wasted on
2026-11-02, and every one is billed. Both masters co-approved this change (see the VALIDATION T05
merge record).

**Target:** worktree `ci-web-paths`, branch `ci-web-paths`, from `main`.

**Change:** `.github/workflows/ci-web.yml` only.
1. Give `push: branches: [main]` the **same** `paths:` list as `pull_request`.
2. Add `'.gitignore'` to **both** lists: the licence-gate lint uses `--ignore-path ../../.gitignore`.
3. Keep both lists identical and in the same order. Use a YAML anchor only if GitHub Actions
   supports it on the runner; otherwise duplicate the list.
4. Keep `workflow_dispatch`, `permissions`, `concurrency` and the jobs unchanged.

**Validation (no hosted runs needed):**
- Check that the YAML parses: `node -e` with a YAML parser that is already in the lockfile, or
  `python3 -c 'import yaml'` if available. Run `actionlint` too if it is installed.
- Write a truth table in the commit message (or in `docs/validation/logs/ci-web-paths.md`) by
  matching sample changed-file lists against the globs:
  - docs-only → false;
  - each input path → true;
  - a mixed docs and input change → true.

**Constraints:**
- No other workflow, job, security or concurrency change. No new dependency.
- Push only branch `ci-web-paths` (no PR, so no billed run).

**Acceptance:** `worker_done` with the head SHA, the diff summary and the truth table.
