# T11p durable authorization — UNACCEPTED partial checkpoint

- Baseline: `99766593f46705812dc8ca9f1ea8438b89181a3c`, initially clean.
- Exact source/test checkpoint: `e170d171fe7307e85a06a2ec8bb4825a6639bbcc`.
- Following commit is report/evidence only; LOCAL COMMIT / HOLDPUSH. **Do not wire or accept this WIP.**
- Canonical main AGENTS/BRIEF/latest owner directives, D-013/all addenda, approved `design.md`,
  and T11 closure seam report were read; coordinator confirmed this terminal's actual GPT HIGH.
- Coordinator accepted the bounded seam/file plan, then explicitly authorized a partial checkpoint
  after parent reconciliation found security defects. No rushed authority fixes were attempted.

## Authorship / ownership manifest

The requested sole-author/no-helper execution was **not** met: higher-priority manager instructions
required delegation. This was disclosed; the liaison authorized retaining GPT-family helper work.
Configured values below were read from the active local Slim `openai` preset, not changed or committed.
They are **configuration provenance, not observed helper runtime/footer evidence**.

| Lane | Session | Configured provider/model/variant | Work / terminal state |
| --- | --- | --- | --- |
| Parent | this dispatched terminal | `openai/gpt-6.1-sol`, high | Tests, every helper source hunk inspected, evidence/reconciliation; actual HIGH separately coordinator-confirmed |
| Explorer | `ses_e5fd5e36cffeiJiaIJOJ4vzfoM` | `openai/gpt-5.6-luna`, low | Read-only old-interface/test recon; completed, no edits |
| Fixer | `ses_e5fd4ab6bffesYYrMMyb2k8Eqs` | `openai/gpt-5.6-luna`, high | `Consent.cs` + new `ConsentPersistenceCoordinator.cs`; completed, no remaining active helper |

The fixer session first stopped without edits awaiting RED, then resumed after parent captured RED.
No independent helper-runtime model line was available; none is fabricated. Parent owns
`DurableConsentTests.cs` and the async-fixture migration in `AtomicConsentTests.cs`.

## Preserved implementation (not accepted)

- Replaces obsolete namespace-local synchronous Load/Save persistence with the existing approved
  `Persistence.IConsentPersistence`; no lazy persistence callbacks in getters.
- Adds async mutation APIs, bound-store synchronous-helper rejection, initial fail-closed state,
  hydration, desired snapshots, a nominal 64-reservation single writer, and unsupported-reset result.
- Restrictive mutation/token revocation and durable-ack/stale-grant fixtures are present.
- Production Agent/HTTP startup is **unwired and unchanged**; the current Agent still uses its
  preexisting in-memory composition. No production persistence factory/session wrapper was added.
- Core/IScanBackend/API/Tokens/AgentPipeline/native adapters/config/workflows/dependencies untouched.
  Frozen API/Core/Agent paths were diff-checked against the baseline (empty diff).
- Existing logical response selection is unchanged: removed origin403/no CORS; revoked family with
  still-allowed origin401/CORS. No atomic wire-flush claim or new HTTP status contract is made.

## Evidence and limits

Pinned Linux SDK `/tmp/opencode/zilo-sdk/sdk/dotnet` reports **10.0.403**. Both test invocations held
`flock --close /tmp/opencode/zilo-real-port-tests.lock`, used Release, `--no-restore`,
`-p:UseSharedCompilation=false -nodeReuse:false`; final targeted invocation had a90s watchdog.

| Evidence | Observed result |
| --- | --- |
| `red.log`, original sync baseline | **2 behavioral assertion failures**: pre-ack grant authority; persistence callback owns authorization monitor |
| `initial-targeted.log` | Parent test xUnit1051 cancellation-analyzer compile failures; **not behavioral RED** |
| `partial-targeted.log`, exact source/test checkpoint above | Compile-correct targeted DurableConsent + AtomicConsent: **26 passed / 3 failed / 0 skipped**, exit1 |
| Diff checks | Working and staged `git diff --check` passed before source checkpoint |

Parent fixed test cancellation plumbing without suppressing analyzers. The initial two defects now
have passing async equivalents in the targeted run; this does **not** establish overall coordinator PASS.
No final locked solution restore/build/full suite, self-test, API suite, pnpm, hosted CI or native
execution was claimed: coordinator directed a minimal partial checkpoint while targeted tests are red.
Controlled persistence and memory-directory reopen tests are fixtures, not native/crash/power-loss proof.

## Required corrections before acceptance

1. **Reproduced:** `Open_ack_after_stop_must_never_publish_ready_or_saved_authority` observes Ready
   after Stop. `InitializeAsync` publishes hydrated state without a lifecycle/epoch recheck.
2. **Reproduced:** `Stop_fences_late_grant_commit_and_rejects_new_mutations` observes Durable instead
   of Superseded for a grant ack after stopping; commit has no health/epoch guard.
3. **Observed failure:** `Cancelled_grant_requires_durable_compensation_before_clean_drain` times out
   at10s waiting for the compensating snapshot after cancellation/old-write acknowledgement.
   Callback registration/observer-completion ordering needs investigation; no stronger cause claim.
4. **Inspection-only, high risk:** `CancelGrant` unconditionally removes desired state and advances
   the origin sequence without verifying that this grant is still current: a newer saved block can
   be erased if that callback runs. The added superseded-grant/block test passed this run; it did
   **not** establish the problematic callback branch, so deterministic reproduction remains open.
5. **Inspection-only:** native result checks prompt identity under gate, releases it, then calls
   GrantAsync; a newer restriction can intervene before reservation. Validation+reservation must be
   one short memory transaction, with all persistence/callback waits outside it.
6. **Inspection-only:** per-origin `_sequences` history has no pruning; denied/rejected requests can
   retain extra ConsentStore entries before admission. Audit bounded retained state, not just queue64.
7. **Inspection-only:** Stop bounds the worker wait, not CompleteSessionAsync; concurrent stop/open/
   dispose and cancellation must not clear an uncertain fence or publish late authority. No OS
   lifecycle implementation/proof is included; these are coordinator lifecycle-safety gaps.

## Carry-forwards / release hold

Independent **Claude HIGH** review is still mandatory after corrections; current WIP is not ready
for approval. One later coordinator-authorized combined exact-head CI gate, not per-fix runs, remains.
Production Agent composition/startup, trusted reset/quarantine/recovery, tray warning/action wiring,
actual shutdown/logoff/installer lifecycle, and pre-M6 write no-retry availability remain separate.
Linux x64-only support, strict symlink-ancestor rejection/ostree limitation, filesystem allowlist,
tmpfs volatility, unavailable setfacl ACL evidence and runtime libc-resolution gates carry forward.
Previously accepted native-adapter evidence is not evidence for this new authorization coordinator.
Full T11p/T11 acceptance remains **HELD**; source ownership is released with this partial checkpoint.
