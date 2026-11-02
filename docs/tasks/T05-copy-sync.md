# T05 copy sync: copy for the SDK outcomes (DeepSeek pilot, OD-11; GPT reviewer)

**Why:** the merged T13 SDK (`packages/sdk/src`) and the T10 contract (`api/openapi.yaml`,
`api/CONTRACT.md`) produce user-facing outcomes that have no row in `docs/design/copy.md`. This is
the follow-up recorded in VALIDATION.md (T13 merge record). It is also the **OD-11 pilot**: a
bounded, non-★ task, authored by DeepSeek and reviewed by GPT.

**Target:** worktree `t05-copy-sync`, branch `t05-copy-sync`, from `main`.

**Read first:**
- `docs/design/copy.md`, all of it: the voice, placeholder, column and localisation rules are
  binding;
- `docs/design/detection-dialogs.md`;
- `docs/context/BRIEF.md`;
- DECISIONS D-008;
- `api/CONTRACT.md`;
- the SDK error and outcome types in `packages/sdk/src`: grep for each code below.

## Change

`docs/design/copy.md` only.

1. **Add rows** for each of these codes, after checking in the SDK source when it is emitted and
   what the user can do:
   - `agent-restarted`;
   - `auth-unavailable`;
   - `sdk-too-old`;
   - `agent-too-old`;
   - `outdated-authorized`;
   - `consent-blocked`;
   - `consent-state-unknown`;
   - `missing-capabilities`.

   Put each row in the section that fits: detection states, error codes, or "Codes added by T10".
   Follow the existing columns exactly.
2. **Leave out internal outcomes.** For codes that are not user-facing (for example `no-store`
   or `local-network-access`), either leave them out, or add a one-line note saying why they get
   no copy. Don't invent user-facing text for internal states.
3. **Honour the copy rules** already in copy.md. In particular:
   - never claim Zilo is "not installed";
   - `sdk-too-old` points to an app or SDK upgrade, never to an agent install;
   - `agent-restarted` is retryable;
   - follow the per-browser help wording in detection-dialogs.md.

**Constraints:**
- Edit `docs/design/copy.md` only. Don't touch code, `api/**`, prototypes or other docs.
- Don't change existing rows, except to fix a direct contradiction. List any such fix in the
  commit message.
- No secrets in the session (OD-11 data note).

## Observable acceptance

- Every listed code either has a row with every column filled, or a one-line reason for having
  none.
- Each row's trigger and action match the SDK source. In the commit message, give the
  `file:line` where each code is emitted.
- `pnpm exec prettier --check docs/design/copy.md` passes (Node 24:
  `source ~/.nvm/nvm.sh && nvm use`, then a frozen install).
- Commit on `t05-copy-sync` and push that branch (no PR). Then send `worker_done` with the head
  SHA and the list of rows added.
