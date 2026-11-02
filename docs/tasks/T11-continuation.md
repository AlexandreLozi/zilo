# T11 Non-persistence closure Implementation Plan

> **For agentic workers:** use `executing-plans` yourself. One implementation writer; no helpers.

**Goal:** close the explicitly known non-persistence defects in partial checkpoint
`315c688616740880fd7d0b959d2d99f63e668988`, leaving a stable reviewed handoff for T11p.
**Architecture:** keep the current Agent/Security split and frozen Core. Make authorization
mutations linearizable, discovery bounded and lifecycle-owned, and HTTP behavior match T10.
**Tech Stack:** existing .NET10/ASP.NET/xUnit/locked dependencies, no new packages.
**Spec:** `docs/tasks/T11.md`, checkpoint `docs/validation/logs/T11/report.md`, approved T10
`api/CONTRACT.md` + `api/openapi.yaml`, D-013 (persistence is a separate task).

## Global constraints and ownership
- GPT HIGH author; Opus owns independent Claude HIGH review and merge queue.
- Same author branch/worktree, starting exact315c688. Allowed: Agent/Security source and
  Agent/Security tests, own project/test reference metadata/locks only if necessary, and
  `docs/validation/logs/T11/continuation/**`. Existing packaging/CI milestone is read-only
  unless a demonstrated regression requires the already approved T11-owned path correction.
- Core, Virtual, SDK/API/schema and shared scaffold tests stay read-only. No dependency addition,
  native scanner/unsigned host Windows execution, first-party licence, new wire endpoint or disk store.
- Ports stay47841,47842,47843. Do not merge main or T12 concurrently; exact integrated lock/solution
  evidence is the merge queue's later responsibility. No other writer on Agent/Security.
- D-013 is in force, but **do not implement T11p here**. Preserve a useful persistence seam;
  document any signature changes for the later author. R-A6 remains an explicit blocker.
- Budget45min; commit/push coherent milestones. If unfinished, report partial/failed with exact
  defects, not another green-count-based acceptance claim. No self-review PASS or merge.

## Review focus
1. Deterministically interleaved consent removal/block versus issue/renew/authenticated response.
2. A backend that ignores cancellation, finishes late or faults after timeout/shutdown.
3. Rotating origins, bounded retained histories and invalid/extreme configuration values.
4. Route/method/OPTIONS/Origin/auth/rate/body ordering under malicious and slow requests.
5. Known/unknown capability discriminators, truthful defaults and exact typed failure mapping.

## Task1 — close atomic authorization race
**Files:** `backend/src/Zilo.Security/{Consent,Tokens}.cs`, focused security coordinator file if
needed, `backend/src/Zilo.Agent/AgentPipeline.cs`, `backend/tests/Zilo.Agent.Tests/AuthorizationRaceTests.cs`.
**Consumes:** existing ConsentStore mutation/event APIs and TokenService Issue/Renew/Validate/RevokeOrigin.
**Produces:** a single documented linearization boundary for consent mutation and credential issuance.
- [ ] Add deterministic barrier-based tests: removal/block between final consent check and issuance
  must not leave a valid credential after removal completes; renewal must not resurrect a family.
- [ ] Run the behavioral regression red; record actual failure rather than setup/compile failure.
- [ ] Implement synchronization with explicit lock order and no await/native callback under locks;
  merely adding a second unsynchronized check does not close the race.
- [ ] Run regression plus existing stale-prompt/revoked-history/final-deadline/auth-removal tests;
  include fake-clock boundary and cross-origin/family controls, then commit/push.

## Task2 — bounded discovery and capability correctness
**Files:** `backend/src/Zilo.Agent/{DiscoveryService,AgentHost,AgentOptions}.cs`, focused lifecycle
file if needed, Agent.Tests discovery/caps tests.
**Consumes:** frozen `IScanBackend`, `docs/tasks/T11-interface.md` typed failures and lifetime rules.
**Produces:** owned startup/periodic refresh and shutdown lifecycle, coalesced bounded refresh and cache.
- [ ] Add failing tests for ignored-cancellation timeout, late result not overwriting newer cache,
  concurrent refresh/caller cancellation, stale route-owner removal and exactly-once backend disposal.
- [ ] Pin T10 discovery startup/periodic timing and incomplete-driver behavior from the contract;
  deterministic fake time/barriers, not long sleeps. Bound waiting even for a noncooperative backend,
  observe late faults and do not dispose backend resources while driver work still owns them.
- [ ] Add caps tests for typed backend failure HTTP mapping, unknown response values, finite positive
  bounds, source default membership/list-range alignment and max-area/DPI constraints.
- [ ] Implement smallest focused fix, run targeted tests and commit/push. Missing lifecycle safety
  for noncooperative work must remain an explicit limitation/blocker rather than a hidden background leak.

## Task3 — complete HTTP/security conformance matrix and handoff
**Files:** `AgentPipeline.cs`, `OriginPolicy.cs`, `AgentOptions.cs`, focused Agent HTTP tests/evidence.
- [ ] Add missing failing tests from report49-60: allportsoccupied; mapped/duplicate/malformed
  Host/Origin; public/full hello; consent absentOrigin403/noCORS; renewal/grace/final/replay HTTP;
  strict request schema; rate-before-body ordering and bounded unknown-length body reads.
- [ ] Pin every expected status/header/schema/limit to normative T10, including Problem.limit
  required fields, credentialed CORS denial behavior and check ordering. Do not invent wire defaults.
- [ ] Validate configuration arithmetic/time/history bounds at construction; reject invalid values
  predictably, not runtime allocations/overflow. Implement focused fixes and rerun affected cases.
- [ ] Final once: locked solution restore, Release build/test, real Kestrel HTTP suite,
  bounded --self-test, contract check, affected workflow/shell lint and `git diff --check`.
- [ ] Write <=90line `docs/validation/logs/T11/continuation/report.md`: exactSHA, red/green evidence,
  final counts, each known checkpoint gap closed/open, T11p exact signatures/wiring ownership,
  limitations and R-A6 merge hold. Commit/push; worker_done then idle.

**Outcome:** if all non-persistence gates close, explicitly say that slice is ready for the next
handoff, **not full T11 acceptance**. T11p plus independent Claude review and exact-resulting-SHA
star hosted CI are still required. Ask about genuine contradictions; do not silently narrow tests.
