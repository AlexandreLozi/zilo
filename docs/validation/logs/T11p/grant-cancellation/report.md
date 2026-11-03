# T11p grant cancellation — bounded correction, full authorization UNACCEPTED

Later bounded correction: `../native-prompt-publication/report.md` fixes the prompt identity/reservation
gap with forced-interleaving evidence. Metadata bounds and clean-marker completion defects remain open;
full authorization is still UNACCEPTED.

- Starting checkpoint: clean LOCAL `d660096e725b5a77d51ec4818feef19f1584f8bb`.
- Exact tested source/test commit: `26808a22c5dc99b2c660577f1e74294297eac934`.
- This report/log commit adds evidence only; **LOCAL COMMIT / HOLD-PUSH**.
- Task `task_3fc2b0048e12`, dispatch `ctx_92436fce8ed9`.
- Scope: missing grant-cancellation compensation and stale cancellation erasing a newer restriction.
  The prior lifecycle-publication fix remains intact. Full authorization remains unwired/UNACCEPTED.

## Approved semantics and diagnosis

Read approved `docs/validation/logs/T11p/design.md` §§4,6,7, especially lines 338–346:
admitted grant cancellation invalidates late authority; a physically written canceled grant requires
durable removal before the fence becomes clean; cancellation racing an already committed grant returns
the actual completion, not a claimed rollback. Observer cancellation must not cancel critical disk work.
These refine, not replace, D-013's durable-before-authority and restart-fence requirements.

The baseline missing-compensation test timed out awaiting a second write after caller cancellation and
the old write's acknowledgement. The original grant observer registered CancelGrant and then awaited
`WaitAsync` on the same cancellation token inside that registration's using scope. The wait has its own
cancellation completion path: it can finish the observer and dispose/unregister the compensation
registration before that callback runs. Thus required work incorrectly depended on cancellation callback
ordering. The correction removes the competing cancellation-aware wait for grant observers entirely.

Separately, CancelGrant unconditionally advanced the origin sequence and removed desired state for any
unfinished grant, without verifying that the grant still owned that origin's desired record. A forced
reserve-to-observe gap reproduced the destructive branch: a newer Block was reserved, then the old
grant's cancellation callback ran synchronously during registration of an already-canceled token; the
next real worker snapshot was empty instead of containing the block. Repeating that callback also
created two compensation generations instead of one. These are reproduced defects, not inspection claims.

## Bounded implementation

The only production file changed is `Persistence/ConsentPersistenceCoordinator.cs`:

- Grant observers now wait on the owned reservation completion or a separate cancellation signal.
  The single cancellation callback performs the compensation/fail-closed decision **before** signaling
  observer cancellation. Disposing the observer registration can no longer suppress that required work
  merely because a different callback canceled WaitAsync first.
- If the reservation already completed, return that actual result; do not roll back committed authority.
- Reservations retain their lifecycle epoch. Under the existing short authorization monitor, cancellation
  checks unfinished grant, exact current origin sequence and desired record before any mutation.
  A superseded grant cannot remove a newer block/revocation or supersede its completion.
- Successful compensation advances the sequence, removes the grant from desired state, reserves one new
  generation and signals the existing writer. Repeating cancellation then fails the original sequence
  check, so it cannot create another compensation.
- If the current grant belongs to an ended epoch, do not reserve work into that epoch; mark sticky
  Unavailable so its uncertain write cannot justify clean completion. Capacity/generation exhaustion also
  remains fail-closed. This does **not** repair the separate clean-marker completion/budget defects.

Critical writes still use `CancellationToken.None`, run outside the authorization monitor and remain
owned after callers stop waiting. No blocking durability wait, callback wait, I/O or await was added under
the monitor. Earlier late-open/late-commit Stop/Dispose guards, durable-before-grant and immediate
restrictive-memory/token-revocation rules remain covered by the targeted run.

## Deterministic test evidence

The original compensation test was strengthened: while the compensating write is held, Stop remains
incomplete, the fixture has no clean-session completion, authority is absent and the write token cannot
be caller-canceled. Only acknowledging that removal permits clean drain.

Six new tests cover:

1. **Forced old callback after newer Block reservation**: explicitly separate the existing internal
   ReserveLocked and ObserveAsync seam, exactly modeling preemption between those calls in MutateAsync;
   register an already-canceled token only after Block. This deterministically executes the real
   cancellation callback before the old write completes. **RED:** next snapshot lacks the block.
2. **Forced old callback after newer Block acknowledgement**: acknowledge the old write and newer Block
   before delayed observer registration; then force another snapshot and verify the saved block remains.
   This is a baseline-passing characterization of the completed-reservation guard, not new RED proof.
3. **Repeated cancellation of one pending reservation**: register the canceled observer twice before the
   old acknowledgement. Exactly one removal generation/write must follow. **RED:** generation 4 versus 3.
4. **Cancellation after committed authority**: delay observation until the grant is committed, then cancel;
   actual Durable completion and authority remain. This was already green; no rollback semantics invented.
5. **No compensation capacity**: fill all 64 reservations, cancel a pending grant, then drain. **RED:** health
   stayed Ready instead of Unavailable; after correction no clean-session completion occurs.
6. **Cancellation after Stop invalidated the epoch**: cancel while the old write is paused; no new write
   enters the ended epoch and no clean completion occurs. **RED:** baseline incorrectly completed clean.

The older unforced superseded-grant/block test is retained, but its passing result is **not** used as
proof of the destructive callback branch. No existing failing test was weakened, removed or skipped.
Fixtures prove coordinator sequencing only, not native crash, sudden power-loss or OS shutdown behavior.

## Commands and results

Pinned SDK `/tmp/opencode/zilo-sdk/sdk/dotnet`: **10.0.403**;
`DOTNET_ROOT=/tmp/opencode/zilo-sdk/sdk`. All invocations held
`flock --close /tmp/opencode/zilo-real-port-tests.lock`, used Release, `--no-restore`,
`-p:UseSharedCompilation=false -nodeReuse:false`. Targeted watchdog: 90 seconds; final suite: 180 seconds.

Command shape:

```text
flock --close /tmp/opencode/zilo-real-port-tests.lock timeout <90s-or-180s> \
  /tmp/opencode/zilo-sdk/sdk/dotnet test <project-or-solution> \
  -c Release --no-restore -p:UseSharedCompilation=false -nodeReuse:false [--filter '<filter>']
```

| Artifact | Inputs / observed result |
| --- | --- |
| `baseline-compensation.log` | Original compensation case alone on clean baseline: **0 passed / 1 failed**, timeout at 10 seconds, exit 1 |
| `red-cancellation.log` | Initial original case + four additions, production unchanged: **2 passed / 3 failed**, exit 1; missing compensation, erased block and duplicate compensation |
| `red-final-cancellation.log` | Strengthened original case + all six additions, production unchanged: **2 passed / 5 failed**, exit 1; adds authentic capacity and stale-epoch failures |
| `after-targeted.log` | `backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj`, `FullyQualifiedName~DurableConsentTests\|FullyQualifiedName~AtomicConsentTests`: **37 passed / 0 failed / 0 skipped**, exit 0 |
| `final-backend.log` | One final-code pass of `backend/Zilo.slnx` on exact source/test commit above: **338 passed / 0 failed / 47 skipped**, exit 0 |

The seven-case RED filter ORs FullyQualifiedName substrings `Cancelled_grant_requires_durable_compensation`,
`Delayed_grant_cancellation`, `Repeated_cancellation`, `Cancellation_after_committed`,
`Cancellation_with_no_compensation`, and `Cancellation_after_stop`; the earlier five-case filter omits
the last two. All failures were behavior assertions or the original timeout, never compiler errors.
Final backend breakdown: Agent **297 passed / 47 skipped**, Core **7 passed**, Virtual **28 passed**,
Scaffold **6 passed**. Skips are existing platform/environment cases, including Windows/Mac native tests
and unavailable Linux ACL tooling; no native-platform pass or ACL evidence is inferred from them.
Compilation succeeded without printed compiler warnings/errors. No full-suite rerun was needed.

## Authorship / validation manifest

Parent is sole source/test/report author and validation owner, independently checked approved semantics
and every source/test hunk. Coordinator independently confirmed this terminal's actual GPT-6.1 Sol HIGH
in `msg_bfc76b5a8fe1` before implementation. The no-helper preference was not fully met because the
higher-priority workflow required bounded delegation; exactly one **read-only** lane was reused:

| Lane | Session | Configuration versus actual evidence | Files/status |
| --- | --- | --- | --- |
| Parent | dispatched terminal | System `openai/gpt-6.1-sol`; actual HIGH coordinator-confirmed | Coordinator source, DurableConsentTests, report and generated logs; bounded slice completed |
| Explorer | `ses_e5fc6d92dffeV4Q5ji26z5duxw` | Local active preset `openai/gpt-6.1-sol` / high; the earlier session result self-reported configured `openai/gpt-5.6-luna`; **actual helper runtime/model/effort unverified** | Reused only to locate approved cancellation semantics in design/planning/task documents; completed, **no edited files** |

No fixer/helper writer or other helper ran. The prior config/self-report discrepancy remains disclosed,
not resolved into a runtime-model claim. Configuration stays local skip-worktree and uncommitted.

Diff checks against accepted native baseline `99766593f46705812dc8ca9f1ea8438b89181a3c` are empty for
API, Core, Agent/startup, Linux/Mac/Windows adapters, Windows lock helper, workflows and central build/package
inputs. Working/staged `git diff --check` passed. No dependency, push, CI, owner Windows-host execution or
main-worktree write occurred. The full-suite run is Linux-only regression evidence for this exact WIP,
not independent cross-family review or acceptance.

## Remaining risks / hold

No observed test failure remains in this slice's final targeted/backend runs. **This is not full
coordinator PASS**: native prompt identity validation and reservation are still non-atomic; retained
sequence/ConsentStore metadata bounds remain unresolved; Stop's clean-marker completion budget,
concurrent completion and cancellation safety still require their separate correction. Dispose can
still wait for blocked work. Production Agent composition, recovery/quarantine, actual OS lifecycle,
native/release carry-forwards and the coordinated exact-head gate remain separate work.

The missing-compensation and destructive stale-cancellation reproductions are corrected only within
this bounded result. **Full authorization WIP remains UNACCEPTED and unwired; T11p/T11 acceptance stays
HELD. Independent Claude HIGH review of the whole coordinator remains required after all corrections.**
