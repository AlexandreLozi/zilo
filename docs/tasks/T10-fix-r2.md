# T10 fix r2 (Claude author; effort high, ★)

**Inputs:**
- `docs/reviews/T10-r2.md` plus 1 red schema regression, review commit `67308ca` on branch
  `AlexandreLozi/t10-review-r2`, which reviewed `04bc0d8`. Merge it first with
  `git merge --ff-only 67308ca`, or cherry-pick it.
- The agreed master positions: DISCUSSION "[GPT] Second-review outcomes and bounded T10 fix
  positions" and the Opus agreement entry after it (2026-11-01).

**Fix the five r2 residuals exactly as agreed:**
1. Reliable SDK export-and-DELETE only after the acquisition has settled or terminated. Export of
   an active, partial job stays non-destructive.
2. Physical pending-cleanup bytes and unfinished work stay counted in the global reservations
   until they are actually freed.
3. A bounded, family-indexed credential map plus a current pointer. A rotated token family keeps
   access to its older jobs.
4. Open, unknown-tolerant `ResolutionCaps`, with a safe `unsupported` fallback.
5. Ordinary HTTPS eligibility excludes loopback. The dev exception gives diagnostics only.

**New master input. Keep it in a separate "New inputs" section, distinct from the r2 findings:**
- **Lost-session contract:** a per-process `instanceId` in the authenticated HelloFull only, never
  in HelloPublic.
  - When the SDK sees the instance change, it marks its old jobs `agent-restarted`, which is
    retryable. This is SDK-local: no wire event and no automatic rescan.
  - An unknown job ID returns a typed not-found.
- **D-004a clarification:** HelloPublic stays minimal. Consent state comes through
  `GET /auth/consent`.

**Steps:**
1. Make the red regression pass without weakening it.
2. Run pinned Redocly lint and the strict typegen compile, plus the full schema suite, all green.
3. Add a "Fix r2" mapping section to `api/CONTRACT.md`, or to the T10 notes, covering each
   residual and each new input.

**Allowed files:** the T10 set (`api/**`, plus any T10 test and log paths) and the merged review
files.

**Output:** commit and push `t10-contract`, then send `worker_done` with the head SHA, the test
counts and the mapping.
