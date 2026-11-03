# T11p lifecycle publication fix — bounded result, authorization still UNACCEPTED

- Starting checkpoint: clean LOCAL `63f10e77d42072face3cb68893a53e885fd9ec22`.
- Exact tested source/test commit: `0be20c8825a3c38c67439064888255060c24628f`.
- This report/log commit adds evidence only; **LOCAL COMMIT / HOLD-PUSH**.
- Task `task_c8f83bfa2069`, dispatch `ctx_1dffbd51b99e`.
- Read canonical main AGENTS, BRIEF, owner directives, D-004a, D-013/all addenda and EXECUTION §4a
  at main `837bb6f196d90170467513a572d9e74065efa5f2`, plus the prior authorization-partial report.
- This is not approval of the prior WIP, full authorization coordinator, T11p or T11.

## Scope and diagnosis

The existing tests reproduced two missing post-await publication checks: a late open hydrated grants
and published Ready after Stop; a late write acknowledgement reported Durable after Stop because the
worker called its memory commit without a lifecycle/health check. New controlled Dispose cases
independently reproduced the same failures (Ready and Durable respectively).

The sole production edit is in `ConsentPersistenceCoordinator.cs`:

- Capture initialization's lifecycle epoch under the authorization monitor; Stop/Dispose invalidate it
  under that same monitor. An already-stopped coordinator cannot begin initialization.
- After open returns, recheck epoch, disposal/stopping flags and Starting health before hydration,
  fence-state publication, Ready or worker startup. A late open failure also cannot overwrite a
  terminal lifecycle's health.
- The worker retains its initialization epoch. After write acknowledgement, under the same short
  authorization monitor, require matching epoch, Ready health, no failure and no stopping/disposal
  before invoking the memory commit; otherwise complete the reservation as Superseded.
- Still record actual durable-write generation for drain bookkeeping, including after Stop. This
  is not a grant-authority commit. Existing restrictive-drain coverage remains passing.

All persistence calls and awaits remain outside the monitor. No blocking durability wait, new
dependency, architecture, startup composition or OS lifecycle implementation was introduced.
Existing durable-before-grant and immediate restrictive-memory/token-revocation tests still pass.
No pre-existing assertion/test was weakened, removed or skipped; two Dispose regression tests were added.

## Authorship / ownership

Parent is the **sole source, test and report author**, independently checked the recon and inspected
every diff hunk, and owns validation. Coordinator independently confirmed this terminal's actual
GPT-6.1 Sol HIGH footer before source work (`msg_cc918acb6e90`, `msg_303e1aebf8a1`).

The requested no-helper execution was not fully met: higher-priority workflow required delegation,
so exactly one read-only explorer was used, with no helper writer or additional dispatch:

| Lane | Session | Configured versus actual evidence | Files/status |
| --- | --- | --- | --- |
| Parent | dispatched terminal | System `openai/gpt-6.1-sol`; actual HIGH coordinator-confirmed | Coordinator source, DurableConsentTests, this report and generated logs; completed bounded slice |
| Explorer | `ses_e5fc6d92dffeV4Q5ji26z5duxw` | Coordinator verified local Sol HIGH before launch; parent also read active local `openai` preset showing `openai/gpt-6.1-sol` / `high`. Explorer final response instead self-reported configured `openai/gpt-5.6-luna`; **actual helper model/effort/footer unverified** | Read-only report/decision/task/source/test path and guard recon; completed; **no edited files** |

The discrepancy was disclosed in `msg_492e935635d9`; coordinator acknowledged it and authorized the
parent-only source lane in `msg_54c238cae71d`. Neither verified Sol nor verified Luna helper runtime
is claimed. Local configuration remains skip-worktree and uncommitted. No previous helper authored
any hunk in this fix slice; prior-checkpoint provenance remains in the authorization-partial report.

## Verification plan and results

Claim owner: parent. Deterministic paused Open/Write acknowledgements make Stop/Dispose happen before
publication, without timing sleeps. The existing targeted DurableConsent + AtomicConsent set checks
durable-before-authority, immediate restrictions, stale generations and logical auth response behavior.
The fixtures establish coordinator behavior, not native durability, crash, power-loss or OS shutdown proof.

Pinned SDK `/tmp/opencode/zilo-sdk/sdk/dotnet`: **10.0.403**, with
`DOTNET_ROOT=/tmp/opencode/zilo-sdk/sdk`. Each test invocation used this command shape:

```text
flock --close /tmp/opencode/zilo-real-port-tests.lock timeout 90s \
  /tmp/opencode/zilo-sdk/sdk/dotnet test \
  backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj \
  -c Release --no-restore -p:UseSharedCompilation=false -nodeReuse:false --filter '<filter>'
```

| Artifact | Filter / state | Result |
| --- | --- | --- |
| `baseline-targeted.log` | `FullyQualifiedName~DurableConsentTests\|FullyQualifiedName~AtomicConsentTests`, clean baseline | **26 passed / 3 failed / 0 skipped**, exit 1; the two publication assertions plus known compensation timeout |
| `red-publication.log` | `FullyQualifiedName~Open_ack_after_stop\|FullyQualifiedName~Stop_fences_late_grant\|FullyQualifiedName~Open_ack_after_dispose\|FullyQualifiedName~Dispose_fences_late_grant`; new tests, production unchanged | **0 passed / 4 failed / 0 skipped**, exit 1; four authentic behavioral assertion failures, not build errors |
| `after-targeted.log` | Same DurableConsent + AtomicConsent filter, exact source/test checkpoint above | **30 passed / 1 failed / 0 skipped**, exit 1; both original publication cases and both added Dispose cases pass |

The remaining observed failure is unchanged:
`Cancelled_grant_requires_durable_compensation_before_clean_drain` times out at 10 seconds awaiting
the compensating snapshot (`ControlledConsentPersistence.NextAsync`, caller test line 246).
Compilation succeeded in the targeted commands; no warning/error diagnostics were printed.
No full suite was run because targeted coverage remains red; no full-suite PASS is claimed.

Working/staged `git diff --check` passed. Source diff checks against accepted native-adapter baseline
`99766593f46705812dc8ca9f1ea8438b89181a3c` were empty for API, Core, Agent, Linux/Mac/Windows
adapters, Windows lock helper, workflow and central build/package inputs. No native adapter or
production Agent startup was changed; the authorization WIP remains unwired. No push, hosted CI,
Windows owner-host execution or main-worktree write occurred.

## Outstanding — not corrected by this slice

1. **Observed RED:** cancellation compensation/missing compensating write described above.
2. **Inspection-only:** stale CancelGrant can erase a newer block; existing passing fixture does not
   establish the problematic callback branch.
3. **Inspection-only:** native prompt validation/reservation is not one atomic short memory transaction.
4. **Inspection-only:** retained per-origin sequence/ConsentStore bookkeeping bounds remain unresolved.
5. **Inspection-only:** Stop bounds the worker wait, not CompleteSessionAsync; concurrent completion,
   cancellation and clean-fence safety still require correction. Dispose may await a blocked worker;
   this slice does not implement a shutdown budget or resolve drain-completion defects.

The existing report's Ready-after-Stop and Durable-after-Stop reproductions are corrected by this
bounded evidence only. All other remaining defects and recovery/Agent/lifecycle/native carry-forwards
remain open. **Full authorization WIP is UNACCEPTED; T11p/T11 acceptance remains HELD.** Independent
**Claude HIGH** review is required after all corrections, before acceptance and the coordinated gate.
