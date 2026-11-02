# T11 Remaining gate closure Implementation Plan

> **For agentic workers:** use `executing-plans` yourself; one writer, no helpers/fanout.

**Goal:** close the concrete remaining non-persistence gates at checkpoint
`db1e415c4ebbd1ec9fe925ba27059c36acd55e7c` without another open-ended architecture pass.
**Architecture:** shared consent/token response-commit boundary; cooperative in-process discovery,
one outstanding call per backend, bounded host shutdown. Unkillable native work belongs to T24's
out-of-process isolation, not an attempted in-process force-kill.
**Spec:** T10 read-only contract; `docs/tasks/T11.md`; continuation report gap rows46–60;
joint triage Opus `msg_ab4049833456`, GPT `msg_16c62f6a433e`; D-013 persistence remains T11p.
**Tech Stack:** existing .NET10/ASP.NET/xUnit, no new dependency.

## Ownership and constraints
- GPT HIGH; independent Claude HIGH after closure/T11p, Opus merge queue. Budget45min.
- Existing `t11-agent-skeleton` branch, base exactdb1e415; sole Agent/Security writer.
- Allowed: Agent/Security source, Agent/Security tests and necessary own reference metadata;
  `docs/validation/logs/T11/closure/**` including T24-HANDOFF.md. No Core/Virtual/API/SDK/shared
  scaffold/CI/packaging/config edits, new dependencies, disk store, new HTTP endpoint or native driver.
- Do not merge main or T12; factory registration waits for the reviewed merge handoff.
- Do not await network/driver/native callbacks under the authorization monitor. Bound prepared
  response material; preserve exact serialized Origin and T10 §2.1 ordering, status and headers.
- Commit/push coherent task files, not local skip-worktree overrides. If unfinished, explicit
  partial/failed with exact remaining rows; no full T11 PASS. R-A6/T11p still holds merge.

## Review focus
1. Removal wins immediately before protected success/error commitment, including caps exceptions.
2. Caps requests bypassing a hung discovery probe's single-backend admission slot.
3. Timer/caller cancellation, late completion and shutdown racing cached route ownership.
4. Framework rejection of duplicate/mapped headers versus app-generated Problem/CORS responses.
5. Unknown capability kinds and streaming bodies silently bypassing validation/resource budgets.

## Concrete minimal gate list (write tests first; one row per prior gap)
| Prior report row | Required tests / disposition |
|---|---|
|46 R-A6|OPEN by design, named T11p; no persistence implementation/claim here.|
|47 issue/remove|Retain AtomicConsentTests behavioral regressions; no resurrection after completed Remove/Block.|
|48 response commit|Barrier before commit for devices/list, refresh, caps success and caps typed-error catch. Removal winning gives403/noCORS/no data; family revoke with allowed origin gives401 token-revoked/CORS. Pre-commit response may finish; no5xx.|
|49 timeout|Never-completing fake probe AND caps call each yield bounded HTTP wait with typed existing contract outcome.|
|50 lifecycle|Startup refresh,30s periodic refresh and stale-owner removal with deterministic injected time; successful backend disposed once.|
|51 noncooperative shutdown|Never-completing fake: at most one outstanding call/backend across probe+caps; repeated calls do not grow retained tasks, backend marked incomplete/unavailable/stale; tracked resources bounded. Test process exits within configured bounded shutdown grace and emits bounded redacted shutdown diagnostic.|
|52 discovery matrix|Two concurrent refresh callers coalesce; cancel one caller without cancelling other; old timed-out result cannot overwrite a newer committed cache; late faults observed; shutdown/time tests use barriers/fake time, not25ms scheduling luck.|
|53 renew/ports|Retain real-HTTP renewal/grace/final/replay and all-three-ports-occupied tests.|
|54 Host/Origin|Real HTTP root-qualified/mapped loopback classification, duplicate/malformed Host/Origin, OPTIONS routing/Allow, absent-Origin consent and public/full hello; raw request harness where framework blocks invalid headers. Record framework transport rejection separately, not fictitious application status.|
|55 caps defaults|Retain six typed HTTP failures and list/range/default-membership/alignment tests.|
|56 unknown/extreme caps|Real HTTP unknown resolution kind follows R-D4 fallback with unknown values retained; nonfinite/extreme max-area/DPI and unsupported defaults safely reject with contract Problem, no invalid JSON.|
|57 schema/order|Retain strict token diagnostics/unknown-field tolerance and issue-budget-before-body tests.|
|58 body/rate|GET/POST consent rate-limit-before-body, body with missing content type, unknown-length over-limit and slow-read cancellation, byte limit+1 stop. Assert exact contract limits/headers and no credential/CORS leak.|
|59 configuration|Theory for min/max/zero/negative/overflow across body/time/rate/history/family config; bounded histories under rotating origins. Add only missing cases, retain existing tests.|
|60 review/CI|OPEN external gates: Claude HIGH, exact-resulting-SHA star CI; no author self-PASS.|

## Task1 — response commitment
**Files:** `Consent.cs`, `Tokens.cs`, `AgentPipeline.cs`, focused `ResponseCommitTests.cs`.
- [ ] Pin row48 races behaviorally red with deterministic gates; retain origin-before-token precedence.
- [ ] Expose a focused synchronous commit operation using the existing shared monitor; prepare bounded
  success/problem payload outside, re-evaluate authorization and select final status/headers atomically
  with revocation, then do async network IO outside the lock. Document the exact logical commit point;
  if framework send behavior prevents the stated guarantee, ask rather than claim an atomic flush.
- [ ] Exercise both removal-winning and commit-winning schedules, protected error paths, no deadlock;
  run targeted suite and commit/push. No SSE endpoint is added (T20 owns it).

## Task2 — cooperative backend and host lifecycle
**Files:** `DiscoveryService.cs`, `AgentHost.cs`, `AgentOptions.cs`, discovery/process tests.
- [ ] Add rows49–52 red tests, especially a hung caps call (not just a refresh) and shared backend slot.
- [ ] Implement bounded call admission/accounting, stale/incomplete status, injected timing, late-result
  suppression and bounded host shutdown. Never dispose resources still owned by work; process exit is
  the final release boundary. No threads aborted and no hidden native process manager.
- [ ] Prove shutdown via a managed fake-backend child process on Linux; hosted cross-OS evidence is
  still required later. Write `closure/T24-HANDOFF.md` specifying native noncooperative isolation and
  kill/relaunch ownership without claiming T24 implemented. Run targeted suite; commit/push.

## Task3 — fixed matrix and final handoff
- [ ] Complete only the missing cases in rows54/56/58/59; run each failing behavior red before fixes.
- [ ] Run existing regression suite plus final locked restore/Release build/tests, bounded self-test,
  real Kestrel/process tests, contract check and diffcheck. Reuse unchanged lint evidence explicitly.
- [ ] Write <=90line `closure/report.md`: exactSHA, row-by-row closed/open with test names/evidence,
  timing/resource values and commands/counts, logical response-commit semantics, cooperative boundary,
  T11p exact seam signatures/wiring and limitations. No encoded green count as a substitute for rows.
- [ ] Commit/push; worker_done then idle. Non-persistence slice may be ready only when every in-scope
  row closes; full T11 acceptance still requires T11p/R-A6, independent review and star hosted CI.
