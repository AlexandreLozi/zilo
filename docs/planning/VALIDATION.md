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

## Merge record: T01 transport spike / SP-1a (2026-11-01, Opus queue)
- Merged at `4a2a7dcc70de9ba4cfa2845bdf02c8ba6ce1ce22` (fast-forward): a no-conflict rebase of
  83df7dd plus the review commit b26f06d onto main.
- Author: Claude. Fix r1 resolved the 4 r1 findings; fix r2 (17accfa, 83df7dd) made the
  forged-ready negative control deterministic.
- Reviewer: GPT. r1 changes, r2 changes (1 residual), **r3 PASS** (`docs/reviews/T01-r3.md`,
  b26f06d): 5/5 headless Chromium bridge-spec repetitions (45 tests), no bypass or drift.
- Hosted: spike-transport run 41320440243 on 83df7dd is green. **D-012 evidence reuse:** the rebase
  had no conflicts, and `git diff 83df7dd 4a2a7dc -- spikes/transport
  .github/workflows/spike-transport.yml` is empty. This is not an exact-SHA pass. The push to main
  reruns spike-transport (path-filtered) on the exact SHA as the OD-7 backstop.
  **Backstop result:** spike-transport run 41341965635 on exact 4a2a7dc is **green**.
- Still pending outside this scope (M6): real Safari 26 (SP-1b), the public-to-loopback proof in
  WebKit, and the production S2 path.

## Merge record: T10 ★ contract (2026-11-01, Opus queue)
- **Integrated review record:** GPT r1 changes (13 findings), r2 changes (5 residuals), r3 changes
  (root-dot localhost), **r4 PASS** (`docs/reviews/T10-r4.md`, e939912, high footer verified),
  reviewed at exact `f3ba1209ab34b3431a9344e36999f2b2484d017a`.
- **Approved-by: GPT master (2026-11-01).** Covers the exact `api/openapi.yaml` and
  `api/CONTRACT.md` at f3ba120 (DISCUSSION, main 77f92e1).
- **Approved-by: Opus master (2026-11-01).** Covers the same exact files at f3ba120.
- Both approvals are of the protocol and schema only, not of any runtime or security
  implementation. They exclude the 9 T13 ambiguities, which go to joint triage and a possible T10.1
  amendment.
- Merged at `79d6ec3389d75d54f6ec8df78dd4d7613123656f` (fast-forward). This is a no-conflict rebase
  of f3ba120 plus e939912 onto main 77f92e1, and `git diff --quiet f3ba120 79d6ec3 -- api` is empty,
  so the approved bytes are unchanged.
- **Exact-SHA evidence (★, no D-012 reuse):** on the tree at exactly 79d6ec3, local Linux, Node
  22.23.1:
  - `bash api/tools/check.sh` exit 0: Redocly lint valid, strict typegen 2518 lines, 60/60 tests;
  - `node --test api/tests/t10-r3-loopback.test.mjs` 3/3.
- No hosted workflow covers `api/**` today; T10's acceptance is local and headless by spec. A hosted
  `ci-contract` job is a follow-up (proposed for T11). The push to main runs ci-web as the backstop.
- Known non-blocking documentation nit: the CONTRACT.md status header and the "(GPT approval
  pending)" provenance markers are stale. They stay byte-unchanged here, so this commit is the
  approved one. This record supersedes those markers; cleanup goes in T10.1.

## Merge record: T04a web scaffold (2026-11-01, Opus queue)
- Merged at `463934049f739b5d5309bc1c7ef1e70df6679325` (fast-forward). Author: Claude (fix r1 a715ea0 Node 24.22.2; fix r2 02c4374
  FE-scoped format check). Reviewer: GPT. r1 changes, r2 **pass** (Node), r3 **pass** (format scope;
  `docs/reviews/T04a-r3.md`, 5750ed7).
- Hosted CI: ci-web run 41319600327 on 02c4374 (PR #1, merge ref with main) is green on every step,
  incl. Playwright Chromium, Firefox and WebKit. **D-012 evidence reuse:** a no-conflict rebase,
  and `git diff 02c4374 463934049f739b5d5309bc1c7ef1e70df6679325 -- packages apps package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc
  .prettierignore .prettierrc* tsconfig* eslint.config.* .github/workflows/ci-web.yml` is empty.
  This is not an exact-SHA pass. The push to main runs ci-web on the exact SHA as the backstop.

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
