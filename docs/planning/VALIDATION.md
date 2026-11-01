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

## Merge record: T05 design spec (2026-11-01, Opus queue)
- Merged at `f22eb2e216144471ac68805aa0fc0f84f3404539` (fast-forward). Author: Claude (fix r1 07ae1c6). Reviewer: GPT. r1 changes
  (5 P2), then r2 **pass** (`docs/reviews/T05-r2.md`, 8f387ff).
- Rebased-tree verification (Opus): `design/prototypes/check/run.sh` headless: 190 page states,
  0 axe violations, AA contrast pass (lowest 3.39 light, 4.44 dark), copy table in sync.
- Hosted CI: no workflow covers `docs/design/` or `design/prototypes/` (static, no build
  integration). Consent, update and insecure-origin copy is marked Provisional until T10 is approved.
  Follow-on: copy for `agent-restarted` and the T10 R-X7 outcomes (in T22 or a T05 follow-up).
- Merged ahead of T04a. The two are independent; T04a is still on its format-scope fix r2.

## Merge record: T03 SP-4a packaging dry run (2026-11-01, Opus queue)
- Merged at `f38e3ea89aaadb5cf130f371611123f2e39c6d32` (fast-forward). Author: Claude (OD-2 gap; fix r1 7869d17, fix r2 26f5ab5).
  Reviewer: GPT. r1 changes, r2 changes (1 medium), then r3 **pass** (`docs/reviews/T03-r3.md`,
  dc19861).
- Hosted CI: packaging-dryrun run 41315822436 on 26f5ab5 is **success on all 5 jobs**: Linux deb/rpm
  plus test-key signing, the macOS universal pkg build, the Windows MSI install smoke (HKCU self-test,
  sibling sentinel, `MSI SMOKE PASS`), the rpm smoke and the deb smoke.
- **Hosted CI on the exact merged SHA `f38e3ea`: success.** Push-triggered on main: packaging dry run
  41316990218 and Backend CI 41316990194, both green. This closes the exact-SHA gap without D-012
  reuse. D-012's post-merge backstop is satisfied.
- Not cleared: shipping signing (D-011, real CA), notarization, macOS runtime, WiX 6+/EULA choice.

## Merge record: T12-proto (2026-11-01, Opus queue)
- Merged at `32051c657c36304e50558388c43d1a38e93e36ef` (fast-forward). Author: Claude (OD-2 gap, author head 574aa2c, rebased). Reviewer:
  GPT. r1 changes, then r2 **pass** (`docs/reviews/T12-proto-r2.md`, review commit fc72aa9).
- Rebased-tree verification (Opus): `dotnet restore --locked-mode` + `dotnet test spikes/virtual-pages`
  on SDK 10.0.403, Linux. Debug 183/183, Release 183/183.
- Hosted CI: no workflow covers `spikes/virtual-pages` (standalone prototype). Cross-OS identity is
  **pending**. This is not production T12 and not scanner evidence.

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
