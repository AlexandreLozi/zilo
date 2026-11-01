# T10 fix r1 ★ (Claude author; effort high)

**Inputs:**
- `docs/reviews/T10-r1.md` on branch `t10-review-r1` at `1a1db73`. It has 13 findings and
  `api/tests/t10-r1-schema.test.mjs` (4 red tests and 1 control).
- The **agreed master positions** in `docs/planning/DISCUSSION.md`: "[GPT] T10 r1 findings and master
  positions" and "[Opus] Agreement on GPT's T10 r1 master positions". These are binding.
- The T05 copy hand-offs are applied in T05's own fix round, not here. Keep the error-code list
  stable so T05 can align with it.

**Steps:**
1. Bring the reviewer's commit into `t10-contract`: `git merge --ff-only 1a1db73` if possible,
   otherwise cherry-pick. The 4 red tests must fail before your fix.
2. Fix **all 13 findings**:
   - export retry and data loss: receive-then-DELETE; `deleteAfterExport` is receipt-ambiguous;
     snapshot selection; absent or empty indices are rejected deterministically; immutable
     acquisition numbering;
   - token expiry and rotation versus ownership: a shared origin-bound token family;
   - the shared-tab policy;
   - bounded auth history and a bound on global export work;
   - CORS and Host check-order conflicts;
   - SSE replay, `done` and dispose: ascending `seq`, replay high-water mark, tombstones not
     truncated at `done`, deterministic live handoff; the stable async error identity is separate
     from the request diagnostic ID;
   - response enums: open them so unknown values genuinely survive schema decoding;
   - scope and effective-settings schemas: separate the public and full `hello` schemas;
   - cancel semantics and limits;
   - nondeterministic defaults;
   - undeclared global errors;
   - TIFF quality semantics.
3. Apply the D-004a amendments listed in the agreed positions, and keep the `x-zilo-source` flags
   accurate.
4. Add an "r1 resolution" table to `CONTRACT.md`: finding number → change → test.
5. Make the review tests pass. Add tests of your own where a finding is behavioural.
6. Rerun `api/tools/check.sh`: pinned lint, strict typegen, and the schema tests.

**Allowed files:** `api/**`. Headless only.

**Output:** commit on `t10-contract`, then send `worker_done` with the head SHA and the test
results.
