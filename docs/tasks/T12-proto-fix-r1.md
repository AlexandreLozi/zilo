# T12-proto fix r1 (Claude author; effort medium)

**Inputs:** `docs/reviews/T12-proto-r1.md` on branch `t12-proto-review-r1` at `dd9a1eb` (3 findings,
4 red tests).

**Steps:**
1. Bring the review commit in: `git merge --ff-only dd9a1eb`, otherwise cherry-pick. The 4 tests
   must fail first.
2. Fix:
   - **M1:** job-ID validation must reject a trailing LF. In .NET, `$` matches before a final `\n`,
     so use `\z` or explicit checks. The emitted QR JSON must always be valid.
   - **M2:** an `int.MaxValue` page count must not wrap negative or loop forever in the iterator.
     Bound it, or use checked arithmetic and reject it.
   - **L3:** the PNG self-verifier must reject a missing IEND, and generator corruption must be
     detectable. Do not build a general-purpose PNG parser.
3. The review asks that the prototype adapt to the T10 contract vocabulary where they meet, without
   forcing an API regex. Keep that in mind, but no API work.
4. Rerun `dotnet test spikes/virtual-pages` on Linux with the pinned SDK. Update
   `docs/validation/logs/T12-proto/linux.log`.
5. Add a "Fix r1" note to the README.

**Allowed files:** the same set as T12-proto. Linux only (OD-6), headless.

**Output:** commit on `t12-proto-pages`, **push the branch to origin (OD-7)**, then send `worker_done`
with the SHA and test counts.
