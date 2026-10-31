# T04a fix r1 (Claude author; effort low)

Apply finding 1 of `docs/reviews/T04a-r1.md`, which is on branch `t04a-review-r1`; read it with
`git show t04a-review-r1:docs/reviews/T04a-r1.md`.

**Change:** pin Node **24** (active LTS) instead of 22 in `.nvmrc`, in `engines` in every
`package.json` that declares it, and in `.github/workflows/ci-web.yml`. Use an exact 24.x version
that you verify exists on nodejs.org.

**Then:**
1. Install that Node task-private on Linux (official tarball, checksum verified).
2. Rerun the full T04a acceptance:
   `pnpm install --frozen-lockfile && pnpm license-check && pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`,
   then `CI=1 pnpm e2e` headless.
3. Regenerate `pnpm-lock.yaml` only if the engine change requires it.
4. Commit on `t04a-web-scaffold`.

**Allowed files:** the same set as T04a.

**Constraints:** headless only; no native Windows runs.

**Report:** the exact versions, the commands and the outcomes in `worker_done`.
