# Validation log

Each row records one merge into `main` (EXECUTION §2.5, D-010).

- **Evidence columns:** local-linux, local-windows-build, local-windows-runtime, macos, hosted.
- **Allowed values:** pass, fail, pending, or pending (policy-blocked) under D-010a.
- **Rule:** pending is never a pass, and these rows are dev-integration evidence only, never release
  clearance.

## Merges

| Task | Merged SHA (main) | Validated code SHA | Author | Reviewer (verdict, report) | local-linux | local-win build | local-win runtime | macos | hosted | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| T04b backend scaffold | 9e43bf7 | 7284a3b (non-docs tree identical at 9e43bf7) | GPT (gpt-6.1-sol) | Claude opus-5-5, PASS, `docs/reviews/T04b-r1.md` | pass (6/6) | pass | pending (policy-blocked: App Control 0x800711C7, 3/5 Scaffold tests) | pending | pending | `docs/validation/T04b.md`, `docs/validation/logs/T04b/` |

## Open evidence debts (must turn green before release; M6)
- T04b: Windows runtime tests (needs signed builds or a hosted runner), macOS, hosted CI.

## Pending cross-model reviews queued for GPT resume (OD-1)
- T04a (reviewer ctx_6f602d7fa893 stalled by the outage; restart it on resume).
- T05 design spec.
- T01 SP-1a interim note (reviewed together with T10, per OD-2).
- T04b-V evidence: evidence only, Claude-run; GPT may spot-check it on resume.
