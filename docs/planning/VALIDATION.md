# Validation log

Each row records one merge into `main` (EXECUTION §2.5, D-010, and OD-7: hosted CI on the rebased SHA replaces local-only evidence wherever a workflow exists).

- **Evidence columns:** local-linux, local-windows-build, local-windows-runtime, macos, hosted.
- **Allowed values:** pass, fail, pending, or pending (policy-blocked) under D-010a.
- **Rule:** pending is never a pass, and these rows are dev-integration evidence only, never release
  clearance.

## Merges

| Task | Merged SHA (main) | Validated code SHA | Author | Reviewer (verdict, report) | local-linux | local-win build | local-win runtime | macos | hosted | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| T04b backend scaffold | 9e43bf7 | 7284a3b (non-docs tree identical at 9e43bf7) | GPT (gpt-6.1-sol) | Claude opus-5-5, PASS, `docs/reviews/T04b-r1.md` | pass (6/6) | pass | local: blocked-by-host-SAC; **hosted windows-latest: pass** | **hosted macos-latest + macos-15-intel: pass** | **pass**: run 41240050339 @35019a3 (backend tree identical to 9e43bf7), ubuntu/windows/macos-arm64/macos-intel all success | `docs/validation/T04b.md`, `docs/validation/logs/T04b/`, https://github.com/AlexandreLozi/zilo/actions/runs/41240050339 |

## Open evidence debts (must turn green before release; M6)
- T04b: none at scaffold level. Hosted CI backfilled (OD-7). Signed-build runtime on SAC machines is a D-011 concern at M6.

## Pending cross-model reviews queued for GPT resume (OD-1)
- T04a (reviewer ctx_6f602d7fa893 stalled by the outage; restart it on resume).
- T05 design spec.
- T01 SP-1a full spike @b4e14e1 and the interim note @8cbc264. The interim note is reviewed together
  with T10 (OD-2). Linux: 49 passed, 4 n/a at d17a78e. Windows WebKit evidence was observed
  natively at c921bd2 (17 passed) **before OD-6 was known**; no further native-Windows runs, so
  later rows are blocked-by-host-SAC. Real Safari, macOS and hosted CI are pending.
- T04b-V evidence: evidence only, Claude-run; GPT may spot-check it on resume.
