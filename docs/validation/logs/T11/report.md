# T11 checkpoint — acceptance gate CLOSED

## Scope and handoff

- Base: `add1d73`; frozen Core/T11a interface consumed without edits.
- Measured source milestone: `22a0bbe` (final follow-up commit contains evidence/docs only).
- Ports: fixed **47841**, fallback **47842**, fallback **47843**; IANA evidence in `ports.md`.
- Native scanner drivers, jobs, pages, SSE, export, signing and browser support are not claimed.
- Production discovery is honestly empty until a backend is supplied; T12 integration remains separate.
- Native consent callback is injectable; production without native UI never auto-approves.
- No first-party LICENSE, local configuration, or skipfile changes.

## Acceptance blocker

- **Restart-persistent consent grants/blocks are NOT implemented.** `IConsentPersistence` is an
  interface only, not a durable production store. Both masters' coordinator explicitly instructed
  checkpointing this blocker instead of inventing a JSON/ACL policy.
- Required jointly approved persistence plan must cover private ownership/path, atomic replacement,
  crash/corruption fail-closed behavior, concurrency, ACL/symlink defenses and hosted Windows evidence.
- Coordinator confirms separate **T11p** GPT author/Claude review; no disk store in this slice,
  and **HOLD T11 merge until T11p meets R-A6**. Coordinator now confirms D-013 jointly approved;
  T11p implementation starts only after this stable checkpoint, with no parallel writers.
- Therefore passing measured checks cannot establish full T11 acceptance or permit merge.

## Measured evidence

- Contract check: pinned Redocly lint passed; 2518-line generated TypeScript compiles under both
  pinned compiler versions; **60 tests passed, 0 failed** (`contract.log`). API files unchanged.
- CI/package syntax: actionlint **1.7.7** passed with temporary custom runner-label configuration
  for existing `macos-15-intel`; pinned YAML **2.8.1** parsing and `bash -n` passed.
- Linux runtime dependency amendment was explicitly approved by both masters through coordinator;
  adds ASP.NET Core runtime while keeping .NET/SANE dependencies and all original security checks.
- Initial backend runs (17/22/24 tests) are intermediate, NOT final acceptance evidence.
- Final measured backend: **34 passed, 0 failed, 0 skipped** (Agent 21, Core 7, scaffold 6).
- Locked restore passed; Release build passed with **0 warnings, 0 errors**; bounded self-test
  printed `Zilo.Agent self-test: PASS` and exited 0; final actionlint/bash syntax/diff checks passed.
- Real Kestrel tests cover public/full hello, bad Host, absent-Origin consent/preflight,
  primary occupied fallback, and stalled discovery/body authorization rechecks.
- Exact commands (SDK `/tmp/opencode/t12-proto-r2/sdk/dotnet`, version **10.0.403**):
  - `dotnet restore backend/Zilo.slnx --locked-mode`
  - `dotnet build backend/Zilo.slnx --configuration Release --no-restore`
  - `dotnet test backend/Zilo.slnx --configuration Release --no-build --no-restore -p:RestoreLockedMode=true --logger trx --results-directory /tmp/opencode/t11-evidence/results`
  - `timeout 15s dotnet backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll --self-test`
  - `TMPDIR=/tmp/opencode bash api/tools/check.sh`
  - `/tmp/opencode/bin/actionlint -config-file /tmp/opencode/actionlint.yaml .github/workflows/ci-backend.yml .github/workflows/ci-contract.yml`
  - `bash -n packaging/linux/smoke/deb-smoke.sh packaging/linux/smoke/rpm-smoke.sh`
  - `git diff --check`

## Remaining gates and limitations

- Complete persistence policy, implementation and restart tests before T11 acceptance.
- Atomic token issuance versus concurrent consent removal still needs a synchronized security seam;
  rechecking after awaited body reads narrows but does not close the final check/issue race.
- Discovery is not acceptance-complete: no periodic refresh/lifecycle disposal proof, timeout relies
  on backend cancellation cooperation, and stale route-owner cache cleanup needs correction/evidence.
- Full required matrix remains incomplete: all ports occupied; renewal/final/grace/replay HTTP cases;
  mapped/duplicate malformed Host/Origin; typed caps failure HTTP and capability-default validity;
  strict body schema and rate-before-body ordering; adversarial concurrency and configuration bounds.
- TDD evidence is mixed: baked-origin regression was observed behaviorally red then green;
  several invariant APIs were initially compile-red, not a full behavioral-red proof of every rule.
- Independent Claude HIGH review by coordinator; no author self-PASS or merge.
- Exact-resulting-SHA star hosted CI remains required after review/integration.
- Linux-host evidence does not certify Windows/macOS installers, native scanner runtime or browsers.
- Windows unsigned installer/binary was not executed on the owner's SAC-protected host.
- Self-test is bounded composition smoke, not HTTP/scanner/runtime certification.
- No performance or broad browser/OS-support claims were measured.

## Stable T11p persistence seam

- `backend/src/Zilo.Security/Consent.cs`: public `IConsentPersistence` has synchronous
  `ConsentPersistenceRecord? Load(string exactOrigin)` and
  `void Save(string exactOrigin, ConsentPersistenceRecord record)`.
- Record signature: `ConsentPersistenceRecord(string State, bool Managed, int DenialStreak,
  DateTimeOffset CooldownUntil, DateTimeOffset LastDenied = default)`.
- `ConsentStore(ConsentOptions? options = null, IClock? clock = null,
  INativeConsentPrompt? nativeConsent = null, IConsentPersistence? persistence = null)`.
- Clock: `Zilo.Security.IClock.UtcNow` is a read-only `DateTimeOffset`; default `SystemClock` UTC.
- `Load` is used for missing exact-origin state; `Save` is used on native decisions and internal
  Grant/Deny/Block/Remove; a grant resets streak, denial doubles 600s to 24h, streak expires after24h.
- No origin enumeration/load-all API exists; persistence must distinguish missing state from corrupt
  state. Load/Save exceptions currently propagate: T11p must define fail-closed integration per D-013.
- `OriginRemoved` is `event Action<string>`; AgentHost wires it to `TokenService.RevokeOrigin`.
- `backend/src/Zilo.Agent/AgentHost.cs` creates ConsentStore **without persistence**; AgentOptions
  has NativeConsent/Clock but no persistence option. T11p owns adding configuration/composition wiring.
- No persistent consent tests exist; current SecurityInvariantTests cover in-memory churn, prompt
  expiry/stale decisions, deadlines/history. Add reconstruction/crash/corruption and OS ownership tests.
