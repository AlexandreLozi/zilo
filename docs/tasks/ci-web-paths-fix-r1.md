# ci-web push path filter fix r1 (DeepSeek; GPT reviewer)

**Target:** worktree `ci-web-paths`, branch `ci-web-paths`, at `20586b7`. That is your 6e24376 plus
the GPT r1 review commit. Read `docs/reviews/ci-web-paths-r1.md`.

**Change:** `.github/workflows/ci-web.yml`, in **both** path lists, kept identical and in the same
order. Also update the truth table in `docs/validation/logs/ci-web-paths.md`.
1. **P1.** Add `'api/openapi.yaml'`. The SDK `contract.test.ts` reads it.
2. **P2 #2 and #3.** Add a root-level `'*'` pattern, which matches every file at the repo root
   because `*` does not cross `/`. It covers:
   - `AGENTS.md`, which `prettier --check .` reads;
   - `.npmrc`, if one is ever added;
   - any future root config or README.

   Keep the existing explicit entries. Confirm in the log that GitHub's filter glob matches root
   dotfiles with `*`, citing the GitHub docs "Filter pattern cheat sheet". If it does not, also
   add `'.*'`.

**Truth-table rows:**

| Changed files | Expected |
|---|---|
| `docs/**` only | false |
| `design/**` only | false |
| `backend/**` only | false |
| `spikes/**` only | false |
| `packaging/**` only | false |
| `api/openapi.yaml` | true |
| `api/openapi.yaml` + docs | true |
| `AGENTS.md` | true |
| `.npmrc` | true |
| `README.md` | true |
| each existing input | true |
| mixed docs + input | true |

**Constraints:** no job, security or concurrency change; push only `ci-web-paths` (no PR).

**Acceptance:** `worker_done` with the head SHA and the updated truth table.
