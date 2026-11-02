# ci-backend: manual Apple Silicon runner choice (DeepSeek, OD-11; GPT reviewer)

**Why:** GitHub cancelled the macOS arm64 job twice on `38a859b` ("not acquired by Runner … after
multiple attempts", arm64 capacity constraints). There is still no arm64 evidence for the T11p
macOS fix. Both masters co-approved a bounded manual override.

**Target:** worktree `ci-backend-arm-dispatch`, branch `ci-backend-arm-dispatch`, from `38a859b`.

## Change
`.github/workflows/ci-backend.yml` only.
1. Under `workflow_dispatch:`, add one input:
   - `macos_arm_label`, `type: choice`;
   - options `macos-latest` and `macos-15` **only**, default `macos-latest`;
   - **never** `macos-14`: it is retired, per the GitHub changelog of 2026-10-01.
2. Matrix:
   - **push and pull_request:** exactly as now,
     `[ubuntu-latest, windows-latest, macos-latest, macos-15-intel]`;
   - **workflow_dispatch:** one Apple Silicon job only, on the chosen label. For example:
     `os: ${{ fromJSON(github.event_name == 'workflow_dispatch' && format('["{0}"]', inputs.macos_arm_label) || '["ubuntu-latest","windows-latest","macos-latest","macos-15-intel"]') }}`.
   - Keep `fail-fast: false`, the job name format, `timeout-minutes` and permissions unchanged.
3. Add a step **before the tests**, only when `github.event_name == 'workflow_dispatch'`:
   - fail unless `runner.arch == 'ARM64'`, so the label alone is never taken as proof;
   - print `uname -a`, `sw_vers`, `$env:ImageOS` / `$env:ImageVersion`, `git rev-parse HEAD`, and
     the SHA-256 of every `packages.lock.json` under `backend/`.
4. Don't change any other step, assertion, skip or permission. No self-hosted runners and no
   free-form runner input.

## Validation (no hosted runs)
- The YAML parses.
- A short truth table in `docs/validation/logs/ci-backend-arm-dispatch.md`:
  - push event → 4 OSes;
  - dispatch with `macos-latest` → `["macos-latest"]`;
  - dispatch with `macos-15` → `["macos-15"]`.
- Note honestly that a manual run tests the **workflow revision's** commit. Its source must be
  compared separately with `38a859b`: the source diff must be empty outside this workflow file.

## Push policy
**Commit locally only. Do NOT push.** A push of this file triggers the full 4-OS push matrix,
which is billed. Report the local SHA. GPT reviews the worktree directly, and the masters
coordinate one combined push.

**Acceptance:** `worker_done` with the local head SHA, the diff summary and the truth table.
