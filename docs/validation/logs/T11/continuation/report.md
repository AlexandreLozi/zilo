# T11 bounded continuation — PARTIAL / acceptance CLOSED

- Author: GPT HIGH, actual footer verified by coordinator before substantive work.
- Plan: `git show 341372d:docs/tasks/T11-continuation.md`; base `315c688616740880fd7d0b959d2d99f63e668988`.
- Measured source/test SHA: **`2cab277b9c97b432197f6c26bb97da4246080a26`**.
- Pushed milestones: `611c0a8`, `5c2802c`, `cab722f`, `2cab277`; following commit is evidence only.
- No main/T12 merge, dependency changes, Core/Virtual/API/SDK/scaffold edits, config/skipfile edits or disk store.
- Ports remain 47841/47842/47843; no native scanner or unsigned Windows execution.

## Behavioral evidence (not acceptance inference)

| Regression | Observed RED | Latest GREEN |
|---|---|---|
| Removal/block versus bound issue/renew | 2 failures: issued credential after consent mutation | AtomicConsentTests |
| Noncooperative discovery / synchronous refresh | 2 failures: unbounded wait / null refresh task | DiscoveryBoundTests |
| Host-owned backend disposal | 1 failure: backend never disposed | DiscoveryBoundTests |
| Token schema, rate-before-type, invalid caps/defaults | 10 failed, 2 already passed | HTTP/caps suites |
| Unsafe token/consent/Agent/timeout configuration | 8 failures: no construction rejection | ConfigurationBoundsTests |
| Native cancellation callback under monitor | 1 failure: cross-thread authorization read blocked | AtomicConsentTests |
| Unknown consent poll rate / obsolete origin history | 1 failure each: 200 instead of429 / 50 retained entries | AtomicConsentTests |
| Missing caps default completion | 2 failures: HTTP500 rather than supported defaults | CapabilityHttpTests |

- Typed caps failure mappings (6 cases), rotation/grace/final/deadline HTTP and port exhaustion
  passed on first execution: added conformance evidence, **not** behavioral-red claims.
- Initial test setup/compiler errors were corrected before the behavioral RED runs above.
- Security fractional-deadline test now uses wire-valid 3600/3601-second policy instead of300/301.

## Final measured commands

- SDK `/tmp/opencode/t12-proto-r2/sdk/dotnet` (10.0.403); below `dotnet` means that exact binary.
- `dotnet restore backend/Zilo.slnx --locked-mode`: passed; locks unchanged subsequently.
- `dotnet build backend/Zilo.slnx --configuration Release --no-restore`: passed, 0 warnings/errors.
- `dotnet test backend/Zilo.slnx --configuration Release --no-build --no-restore -p:RestoreLockedMode=true --logger trx --results-directory /tmp/opencode/t11-continuation/final-results`:
  **73 passed, 0 failed/skipped** (Agent60, Core7, scaffold6), including real Kestrel/process tests.
- `timeout 15s dotnet backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll --self-test`: exit0/PASS.
- `TMPDIR=/tmp/opencode bash api/tools/check.sh`: pinned lint/type compilation and60 tests passed.
- `/tmp/opencode/bin/actionlint -config-file /tmp/opencode/actionlint.yaml .github/workflows/ci-backend.yml .github/workflows/ci-contract.yml`: exit0.
- `bash -n packaging/linux/smoke/deb-smoke.sh packaging/linux/smoke/rpm-smoke.sh`: exit0.
- `git diff --check`: passed; unchanged contract/workflow evidence reused, no acceptance inference.
- Final build/test/self-test supersede the earlier cab722f run after the last focused caps/history fixes.

## Exact checkpoint gap matrix

| Checkpoint gap | Current state and boundary |
|---|---|
| Restart-persistent consent, R-A6 | **OPEN/BLOCKER**: separate T11p; no production store or restart evidence. |
| Final consent-check/issue race | Shared ConsentStore/TokenService monitor closes bound issue/renew mutations; host wires it. |
| Removal versus authenticated response commitment | **OPEN**: post-await rechecks are not an atomic response-commit boundary; caps failure catch also needs recheck. |
| Discovery timeout | HTTP wait bounded even if driver ignores cancellation; one retained probe/backend, late faults observed and late snapshot discarded. |
| Discovery ownership/lifecycle | Startup +30s periodic hosted refresh; stale owner map cleared; exactly-once successful disposal test. |
| Noncooperative shutdown | **OPEN/BLOCKER**: disposal deferred until owned calls finish; permanently hung work retains resources indefinitely. No process-isolation proof. |
| Discovery adversarial evidence | **OPEN**: no deterministic fake-time periodic/shutdown, late-newer-cache or caller-cancellation/coalescing matrix; timeout test uses25ms timer. |
| HTTP renewal/grace/final/replay, all ports occupied | Covered with fake security clock / real HTTP; exhausted tuple fails bounded without arbitrary listener. |
| Host/Origin/OPTIONS/full hello | Existing coverage retained; **OPEN** complete mapped/duplicate/malformed HTTP matrix and framework-rejection behavior. |
| Typed caps/default validity | Six typed HTTP mappings; deterministic list/range defaults, empty pages→max, finite dimensions and membership/alignment validation. |
| Caps unknown/extreme matrix | **OPEN** complete unknown-discriminator HTTP and adversarial max-area/DPI matrix (unit unknown-value evidence remains). |
| Strict schema/rate/body ordering | Token diagnostics schema strict; unknown fields ignored; issue budget precheck before body, rechecked at issuance; unknown polling bounded. |
| Remaining HTTP body/rate matrix | **OPEN** other pre-auth rate/body ordering, missing content type with body, slow/unknown-length bounded-read adversarial proof. |
| Configuration/history bounds | Construction guards; overflow-safe body accounting/cooldown; fixed auth counter tables and obsolete none-origin cleanup; full extreme-value matrix still OPEN. |
| Independent review/resulting-SHA CI | **OPEN**: coordinator owns Claude HIGH review and exact-resulting-SHA star hosted CI; no author PASS or merge. |

## Stable T11p seam / integration ownership

- Unchanged `IConsentPersistence.Load(string exactOrigin): ConsentPersistenceRecord?` and
  `Save(string exactOrigin, ConsentPersistenceRecord record): void` (synchronous).
- Unchanged record `(string State, bool Managed, int DenialStreak, DateTimeOffset CooldownUntil, DateTimeOffset LastDenied = default)`.
- Unchanged `ConsentStore(ConsentOptions? = null, IClock? = null, INativeConsentPrompt? = null, IConsentPersistence? = null)`.
- Added `TokenService(TokenLimits? = null, IClock? = null, ConsentStore? consent = null, Func<string,bool>? isBaked = null)`.
  AgentHost passes the **same** ConsentStore plus OriginPolicy.IsBaked; standalone unbound TokenService is not a consent authority.
- `OriginRemoved: event Action<string>` now fires synchronously **inside the shared monitor** on Remove/Block/Deny;
  AgentHost wires TokenService.RevokeOrigin. Subscribers must be synchronous/nonblocking, no await/native callbacks.
- Native cancellation callbacks are dispatched asynchronously; synchronous persistence Load/Save stays under the monitor.
- T11p owns production persistence configuration/composition in AgentHost (currently absent), D-013 fail-closed
  Load/Save exception integration, reconstruction/crash/corruption/ownership evidence, and preserving this shared-instance wiring.
- DiscoveryService is hosted + IAsyncDisposable; `ShutdownCompletion: Task` exposes deferred release, not bounded native termination.
- **Not a completed non-persistence slice; not full T11 PASS; HOLD merge for remaining gaps + R-A6/T11p.**
