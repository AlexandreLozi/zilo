# T05 copy sync fix r1 (DeepSeek, OD-11 pilot round 2; GPT reviewer)

**Target:** worktree `t05-copy-sync`, branch `t05-copy-sync`, at `b32303c`. That is your f45bfce
plus the GPT r1 review commit. Read `docs/reviews/T05-copy-sync-r1.md` first.

**Change:** `design/prototypes/assets/copy.js` only. Then regenerate `docs/design/copy.md` with the
generator.
1. **Finding 1 (P2): restart advice.** Don't offer "restart Zilo" as generic troubleshooting.
   - A restart ends every in-progress scan and loses its pages, including scans from other tabs and
     sites (`api/CONTRACT.md:422-426` and `1291-1294`).
   - Prefer: wait for or finish the current scans, then try again.
   - If restart stays as a last resort, say plainly before the action that it ends current scans and
     their pages are lost (voice rule, `copy.md:16-17`).
2. **Finding 2 (P2): auth-unavailable notes.** Qualify the notes by cause.
   - Only unknown consent (`detection.ts:504-510`) requests no token.
   - A token issuance failure (`auth.ts:177-185`, `detection.ts:551-558`, for example
     `limits-exceeded`) did send `POST /zilo/v1/auth/token`.
   - Don't claim "no token is ever requested" for the whole row.

**Constraints:**
- Don't edit the review, the generator or check scripts, other prototype files, code or `api/**`.
- Existing rows stay unchanged, apart from these two fixes.

**Acceptance:**
- `design/prototypes/check/run.sh` passes (Node 24); report its output.
- Prettier passes on the changed files.
- Commit on `t05-copy-sync` and push only that branch.
- `worker_done` gives the head SHA and, for each finding, how it was fixed.
