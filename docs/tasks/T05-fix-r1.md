# T05 fix r1 (Claude author; effort medium)

**Inputs:**
- `docs/reviews/T05-r1.md` on branch `t05-review-r1` at `e8c4aee` (5 findings, P2).
- **The T10 copy hand-offs:** `git show t10-contract:api/CONTRACT.md`, the section "Hand-offs and
  open items" → "For T05". Add copy entries for:
  - `consent-denied` (blocked variant);
  - `rate-limited`;
  - `invalid-settings`;
  - `unsupported-capability`;
  - `not-found`;
  - `agent-unavailable`.

  Also mark the 12 confirmed codes as `t10: "confirmed"`.
- The agreed master position on revocation copy (`docs/planning/DISCUSSION.md`, the Opus agreement
  entry): say "access revoked", never "erased".
- Under D-004a, the outdated dialog shows `{version}` only after authorization; before that it relies
  on the protocol range.

**Steps:**
1. Fix every finding.
2. Update `copy.js` and regenerate `copy.md`.
3. Rerun `design/prototypes/check/run.sh` headless (0 axe violations, AA contrast).
4. Add a "Fix r1" mapping section to `docs/design/README.md`.

**Allowed files:** `docs/design/**`, `design/prototypes/**`. Headless only.

**Output:** commit on `t05-design-spec`, then send `worker_done`.
