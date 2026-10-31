# T01 fix r1 (Claude author; effort medium)

Address every finding in `docs/reviews/T01-r1.md`, which is on branch `t01-review-r1` at `b6c3aec`.
The four medium findings are:
- popup activation lost;
- missing binary-session validation and backpressure;
- popup navigation not detected;
- the WebKit/Safari public-address-space claim is unproven.

**Steps:**
1. Merge the reviewer's commit into your branch first: `git merge --ff-only b6c3aec` if possible,
   otherwise `git cherry-pick b6c3aec`. The three new failing regression tests must be present and
   must fail before your fixes.
2. Fix the S2 bridge prototype and stub so those tests pass, without weakening them.
3. Correct the evidence claims in `docs/spikes/SP-1a.md` (and the interim note, if it is affected).
   Anything Playwright WebKit cannot prove about public→loopback address-space semantics must be
   stated as unproven.
4. Rerun the full Linux headless suite. Update `docs/validation/logs/T01/linux.log` (redacted) and
   the matrix.
5. **No native Windows runs (OD-6).** Leave the Windows rows as they are, labelled "observed before
   OD-6".
6. Add a short "Fix r1" section to `SP-1a.md` that maps each finding to its change.

**Allowed files:** the same set as T01, plus the reviewer's test files you merged.

**Output:** commit on `t01-transport-spike`, then send `worker_done` with the test counts and the
finding → fix mapping.
