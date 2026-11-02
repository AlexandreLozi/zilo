# T12 production virtual backend evidence ledger

Base: `add1d73` (merged frozen T11a). Author terminal actual MEDIUM footer was
verified by coordinator before substantive work (`msg_c0485f40a5e1`).

## Ownership and provenance

Only Virtual, Virtual.Tests, required solution/dependency/lock references, and
this evidence directory may change. Core, Agent, Security, API, prototype, shared
scaffold tests, workflows and configuration are read-only.

Runtime workflow-manager instructions required one bounded implementation helper,
contrary to the dispatched no-helper constraint. This deviation was escalated to
the coordinator as `msg_1d99add41959`; helper effort/model was not independently
verified. The parent owns final evidence and reporting. This is not independent
cross-model review: Claude MEDIUM review and Opus merge approval remain required.
Helper identity: `ses_e6662054dffe0NNoCJN7R9Hxl3` (fixer); the local tool exposes no
Orca Dispatch ID or actual provider effort. Coordinator acknowledged the bounded
deviation and required no further fanout (`msg_b641a607ec5a`).

## Work graph

1. Virtual implementation/test lane: caps, production-owned reviewed renderer,
   deterministic decoded-content/QR tests, bounded lazy streams, typed failures.
2. Parent evidence lane: dependency inventory, acceptance commands, limitations.
3. After implementation reconciliation: parent locked restore, Release build,
   full backend suite, no-NAPS2 guard, available agent smoke, diff check.
4. Independent Claude review, then Opus merge queue: external gates, not author claims.

## Interim observations (not acceptance)

- First helper pass reported three scoped tests green, but parent/coordinator
  inspection found first-page QR `page:1` instead of production `page:0` and missing
  adversarial coverage. The same completed helper session was resumed for correction;
  no additional helper was launched.
- An early whole-solution locked restore failed with `NU1004` because Agent and
  Scaffold test transitive locks did not yet include the approved QR dependency.
  The failure is retained in `initial-restore-failure.log`. Required generated
  transitive lock updates are in scope, not permission to edit Agent or scaffold code.
  Final acceptance must run after the corrective lane settles and after lock repair.

## Evidence path

Tests must observe actual immutable Core pages and decode PNG pixels and QR JSON;
encoded-byte hashes alone cannot establish D-007 content. Cancellation, failure
after N pages, source rejection, byte/pixel limits, lazy counts and backend disposal
need explicit boundary assertions. An injected clock makes slow fixtures repeatable
without long sleeps or an HTTP mutation endpoint. Linux-only maximum-settings raw
memory/time observations are diagnostic, never a performance budget or support claim.

Required final commands (SDK `/tmp/opencode/t12-proto-r2/sdk/dotnet`):

```sh
dotnet restore backend/Zilo.slnx --locked-mode
dotnet build backend/Zilo.slnx -c Release --no-restore
dotnet test backend/Zilo.slnx -c Release --no-build --no-restore -p:RestoreLockedMode=true
dotnet test backend/tests/Zilo.Scaffold.Tests -c Release --no-build --no-restore --filter FullyQualifiedName~Restored_runtime_graph
dotnet backend/src/Zilo.Agent/bin/Release/net10.0/Zilo.Agent.dll
git diff --check
```

Windows runtime is blocked-by-host-SAC/pending and will not be executed here;
macOS/hosted/native scanner/eSCL/job storage/export/soak evidence remains pending.
