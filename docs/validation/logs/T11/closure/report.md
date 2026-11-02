# T11 non-persistence closure — local evidence, full acceptance HELD

- Plan: `git show 5259a3d:docs/tasks/T11-closure.md`; base `db1e415c4ebbd1ec9fe925ba27059c36acd55e7c`.
- Measured source/test SHA: **`70df5ecf63bf966a945c939986d46de1fb01aa0a`**; following commit is evidence only.
- GPT HIGH actual footer confirmed by coordinator before substantive work; sole writer, no helpers.
- Pushed milestones: `7f682dc` response commitment, `527b33a` cooperative lifecycle, `70df5ec` fixed matrix.
- No Core/Virtual/API/SDK/scaffold/CI/packaging/config/dependency changes, main/T12 merge, disk store or native execution.
- Port tuple remains47841/47842/47843. This is not full T11 PASS; D-013/T11p and external gates hold merge.

## Fixed row matrix (prior continuation report rows46–60)

| Row | Disposition and concrete evidence |
|---|---|
|46 R-A6|**OPEN T11p**: no production persistence/restart claim. |
|47 issue/remove|Retained AtomicConsentTests: shared issue/renew monitor; no resurrection after Remove/Block. |
|48 response commit|Closed locally: ResponseCommitTests (10 cases), AuthorizationRaceTests (5) cover removal/family revoke, list/refresh/caps404/renew commit-winning IO, stalled success and typed caps catch;403/noCORS versus401 token-revoked/CORS. |
|49 timeouts|Closed cooperative scope: CooperativeHostTests real HTTP probe+caps with never-completing fake, fake15s deadline; refresh200 incompleteDrivers versus caps504 timeout. |
|50 lifecycle|DiscoveryClosureTests startup/30s periodic fake time, stale-route clearance; DiscoveryBoundTests successful disposal once retained. |
|51 shutdown|Closed cooperative scope only: shared per-instance slot across probe+caps; repeated caps requests retain exactly1 call; fake2s grace with blocked cancellation callback; managed child exits under10s watchdog with250ms grace and one redacted diagnostic, no fake release/dispose. T24 native isolation remains separate. |
|52 discovery matrix|DiscoveryClosureTests: coalesced callers, one cancelled waiter, late success/fault cannot replace newer cache, fake timers and ownership shutdown barrier. No25ms scheduling assertion in new matrix. |
|53 renew/ports|Retained ContinuationHttpTests rotation/grace/final/replay and RealHttpTests all-three-ports-occupied; final solution run includes both. |
|54 transport|TransportClosureTests16: root-dot/mapped loopback dev diagnostics only; malformed/duplicate Origin403 app Problem; malformed/duplicate Host400 Kestrel transport rejection WITHOUT app requestId; unlisted valid Host403 app, OPTIONS/Allow/absent consent. RealAuthHttpTests retains full hello. |
|55 caps defaults|Retained typed failures6, list/range/default membership/alignment and completion; capability-focused suite23 passed. |
|56 caps extremes|CapabilityHttpTests preserves unknown resolution kind/values/step, source/color/page strings and fallback default; NaN/infinity/overflowing area, extreme/unsupported opaque DPI, negative maxPages return existing500 unknown Problem, valid JSON. |
|57 schema/order|Retained strict token diagnostics, unknown-field tolerance and issue-budget-before-body; AtomicConsentTests poll limits. |
|58 body/rate|BodyRateTests6: GET/POST consent rate before invalid body/type; missing Content-Type rejected; chunked HTTP413 at65536-byte contract limit; direct stream stops at65537; slow read cancels without credential/CORS output. |
|59 config/history|ConfigurationBoundsTests17: every positive Agent limit at0/-1, security family/rate/history limits, min/max/timer overflow and grace; existing rotating-origin/history tests retained. |
|60 review/CI|**OPEN external**: independent Claude HIGH + exact-resulting-SHA star hosted CI; no author self-PASS. |

## Observed RED → GREEN

- Caps typed-error race: RED2 (409 instead of403/401) → focused auth/commit GREEN15.
- Hung caps/shared probe admission: RED2 (unbounded caps wait / caps bypassing hung probe) → discovery/host GREEN15.
- Body/rate: RED3 (missing type accepted201; consent rate loses to400) → body/auth GREEN11.
- Caps extremes: RED2 (overflowing area/negative maxPages returned200) → capability GREEN23.
- Other added matrix tests passed as conformance evidence, not invented baseline RED; compiler/harness fixes are not behavioral RED.

## Final commands and counts

- `dotnet` below is `/tmp/opencode/t12-proto-r2/sdk/dotnet` (10.0.403).
- `dotnet restore backend/Zilo.slnx --locked-mode`: exit0; lockfiles unchanged.
- `dotnet build backend/Zilo.slnx --configuration Release --no-restore`: exit0,0 warnings/errors.
- `dotnet test backend/Zilo.slnx --configuration Release --no-build --no-restore -p:RestoreLockedMode=true --logger trx --results-directory /tmp/opencode/t11-closure/final-results`: **134 passed (Agent121/Core7/scaffold6),0 failed/skipped**, real Kestrel and child process included.
- `timeout 15s dotnet backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll --self-test`: exit0/PASS.
- `TMPDIR=/tmp/opencode bash api/tools/check.sh`: exit0, pinned lint/strict generated types and60 tests passed.
- `git diff --check`: passed; unchanged actionlint and Linux shell-syntax evidence reused from continuation report, no hosted CI inference.
- Durable command outputs: `closure/evidence/`; all final code tests above measured70df5ec, not a later merged SHA.

## Logical commitment and cooperative boundary

- Prepare bounded serialized JSON (4MiB internal maximum) and denial alternatives outside the monitor.
- Under the same ConsentStore/TokenService monitor, re-evaluate serialized origin BEFORE token, select final bytes/status/headers, and assign in-memory headers synchronously. This selection is the **logical commit point**.
- No network IO, serialization, await or backend callback occurs in that critical section. Async body write is outside it.
- Removal/revoke winning the monitor selects the contract denial, including protected errors; already-selected responses may finish afterward. This is NOT an atomic wire flush or rollback of bytes already committed.
- Discovery retains at most one owned call/backend instance across probe/caps. HTTP waiting and shutdown waiting are bounded; call ownership is not falsely released on timeout. Backend disposal waits for actual completion; permanent managed hangs release at process exit.
- No in-process force-kill/native isolation implemented. See `T24-HANDOFF.md`; hosted cross-OS/native-driver proof remains external.

## T11p stable seam / merge hold

- `IConsentPersistence.Load(string exactOrigin): ConsentPersistenceRecord?`; `Save(string exactOrigin, ConsentPersistenceRecord record): void`, unchanged synchronous interface.
- Record unchanged: `(string State, bool Managed, int DenialStreak, DateTimeOffset CooldownUntil, DateTimeOffset LastDenied = default)`.
- `ConsentStore(ConsentOptions? = null, IClock? = null, INativeConsentPrompt? = null, IConsentPersistence? = null)` unchanged.
- `TokenService(TokenLimits? = null, IClock? = null, ConsentStore? = null, Func<string,bool>? isBaked = null)` shares that same consent monitor in AgentHost; OriginRemoved synchronously invokes RevokeOrigin inside it.
- T11p owns production store configuration/composition, D-013 fail-closed persistence exceptions, reconstruction/crash/corruption/ownership evidence, and preserving same-instance wiring. Existing synchronous persistence remains under monitor; it must be bounded/nonblocking.
- Author implementation ready for independent review of this bounded slice; full acceptance/merge remains HELD for T11p/R-A6, Claude HIGH, Opus queue and exact-resulting-SHA hosted CI.
