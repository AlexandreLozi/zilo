# T12 author handoff — independent review required

Code head: `390de6131d0da08b852bf9b5cb647f2acfc9905f`.
Base: `add1d73` (merged T11a); evidence milestone: `3e2840d`.
Final evidence commit is documentation-only; production tree unchanged afterward.

## Delivered

Production-owned reviewed renderer/PNG encoder and neutral Core backend adapter;
no runtime spike reference. Eight stable routes cover healthy, empty/finite feeder,
jam, cover-open, timeout, disconnect and injected-clock slow acquisition.
Source caps/defaults, color/gray/bw, duplex, typed retained-page failures,
16..64-character JobIds, 0-based API/QR indices and 1-based visible labels.
One page per move, no queue, checked finite preallocation arithmetic,
cooperative cancellation and shared disposal completion. Compression polls by
iteration rather than exact byte offsets skipped by LZ77 jumps.

## Parent-run acceptance

Linux x64 Ubuntu 24.04, SDK 10.0.403 / runtime 10.0.14.
DOTNET_ROOT=/tmp/opencode/t12-proto-r2/sdk; DOTNET_CLI_HOME and NUGET_PACKAGES
are the task-private home/nuget paths recorded in verify-linux.sh; telemetry off.
Commands use that SDK's dotnet; complete logs are beside this report.

```sh
bash docs/validation/logs/T12/verify-linux.sh
dotnet restore backend/Zilo.slnx --locked-mode
dotnet build backend/Zilo.slnx -c Release --no-restore
dotnet test backend/Zilo.slnx -c Release --no-build --no-restore -p:RestoreLockedMode=true
dotnet test backend/tests/Zilo.Scaffold.Tests -c Release --no-build --no-restore --filter FullyQualifiedName~Restored_runtime_graph
dotnet backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll
dotnet build backend/Zilo.slnx -c Release --no-restore --no-incremental
dotnet test backend/tests/Zilo.Drivers.Virtual.Tests -c Release --no-build --no-restore --filter FullyQualifiedName~MaximumLegal600RawObservation --logger 'console;verbosity=detailed'
python3 docs/validation/logs/T12/audit-dependencies.py
git diff --check
```

Locked restore PASS; Release build/rebuild PASS, 0 warnings/errors;
full suite **40 passed, 0 failed, 0 skipped**: Core7 + Virtual26 + Scaffold6 + Agent1.
Separate no-NAPS2 guard: 1 passed. Agent scaffold smoke exits0; no virtual
registration/self-test exists yet. Dependency audit and whitespace checks pass.
Tests cover decoded RGB/luma, real QR JSON, rulers/targets, retained pages,
controlled-timer cancellation/disposal, lazy huge counts and allocation guards.

Legal600 color: 5100x8400, encoded2,306,981 bytes; elapsed569.1ms,
allocated287,725,736 bytes, process peak working set342,532,096 bytes.
One Linux observation only, no performance gate or scanner-support claim.

## Dependency and factory handoff

Only new package: exact managed ZXing.Net0.16.11, Apache-2.0, jointly approved;
no new transitive/native/image stack. See DEPENDENCIES.md and dependency-audit.log.
Preserve generated QR entries in backend/src/Zilo.Agent/packages.lock.json and
backend/tests/Zilo.Scaffold.Tests/packages.lock.json when T11 rebases.
Factory: VirtualBackendFactory.Create(TimeProvider?, IEnumerable<FailureVariant>?)
returns IScanBackend; default construction requires no arguments. T11 registers
after merge; FACTORY-HANDOFF.md gives exact caps/routes/lifetime details.

## Limitations and gates

Independent Claude MEDIUM review and Opus merge approval remain mandatory.
No full original-plan TDD claim: missing-assets and NU1004 failures were setup,
not behavioral red; helper returned no reproducible behavioral-red command evidence.
One local fixer helper was required by higher-priority runtime delegation rules,
contrary to task no-helpers; coordinator acknowledged the bounded deviation.
Helper ses_e6662054dffe0NNoCJN7R9Hxl3 was reused after completed envelopes only;
effective helper model/effort was not exposed. Author MEDIUM footer was verified.
No author/helper self-review substitutes for independent cross-model review.
Windows runtime blocked-by-host-SAC/pending; macOS/hosted pending, not passes.
No native scanner/NAPS2/eSCL/storage/SSE/export/soak/signing/release evidence.
In-flight arithmetic bounds finite buffers, not measured process-wide aggregate
memory; T20 owns aggregate resource policy. Usage-limit suspension extended wall
time; no extra implementation followed final validated code. Not a full-plan PASS.
