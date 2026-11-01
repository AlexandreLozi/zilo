# T02 fix r2 — resumed with owner licence-deferral input

Effort medium; fresh GPT author dispatch in existing `t02-fix-r2`, base `d30d592`.
Prior `ctx_0713a663fd69` was usage-paused with no edits/tests, not an author failure.

## Target and change
- Resolve only F4-r2 in `docs/reviews/T02-r2.md` and the new owner no-Zilo-LICENSE requirement.
- Preserve the two reviewer regressions. Make source LF patterns root-only so upstream hashed
  evidence stays `-text`; anchor remaining first-party source patterns.
- Remove `spikes/naps2/LICENSE` (premature MIT grant). Remove its first-party MIT policy pin,
  licence-file/source-hash references and fabricated licence metadata.
- Retain the first-party source/output inventory, explicitly UNLICENSED/private pending owner M7.
  Hash actual remaining source inputs; do not invent an OSI licence or allow a LicenseRef.
  The unchanged default-deny gate must deny this unapproved identity/output. Update the wrapper's
  exact outcomes on all RIDs and the report: formerly passing macOS graphs may now correctly deny
  unlicensed first-party material. Separate that new reason from original third-party denials.
- Update source generation, tests and evidence consistently. Third-party evidence bytes and licence
  hashes must remain unchanged. No suppression, waiver, reviewed-payload approval or exclusion of
  first-party artifacts from the inventory. Shipping clearance and T06 remain blocked.

## Ownership
Allowed: `spikes/naps2/**`, `docs/spikes/SP-2a.md`, `.github/workflows/spike-naps2.yml`
(only necessary regression-test wiring). Gate semantics in `tools/license-gate/**`, production
backend/config/locks, planning docs and existing review reports are read-only. If the existing
gate cannot represent the truthful negative result, ask; do not weaken it.
Local `opencode.json` and `.opencode/oh-my-opencode-slim.json` overrides are skip-worktree;
never stage them. No upstream evidence/LICENSE normalization, broad cleanup or unrelated refactor.

## Observable acceptance
1. Reproduce the two F4 regressions before fixes, then pass them without weakening assertions.
   Adapt only the test's first-party LICENSE expectation to deliberate removal; keep all
   third-party raw-byte and staged-hash preservation assertions.
2. Gate suite and spike tests pass. If runtime binaries are missing, one bounded Linux locked
   build is allowed; existing verified SDK: `/tmp/opencode/t12-proto-r2/sdk/dotnet`.
3. On all five RID inventories, wrapper matches exact package/payload/denial sets; every
   first-party unlicensed identity is denied, old third-party denials remain, no waiver added.
4. Test first-party source omission/metadata/policy mutation fail closed, root-source LF still
   applies, all upstream LICENSE byte/index hashes stay unchanged, and worktree is clean after
   explicit task-file commit. Preserve unrelated changes if found; never `git add -A`.
5. Workflow lint/parse if changed; no full five-RID publish or hosted rerun unless required by
   the actual change. No native unsigned Windows-host execution, global changes or helpers.

Budget25min; summary <=70lines under `spikes/naps2/evidence/logs/r2-fix-summary.md`.
Commit/push the fresh task branch after commits. `worker_done`: exact branch/head, counts,
new exact outcome matrix, limitations and clean/dirty paths. Mandatory Claude r3 before merge.
