# T11p fix 5 — bounded clean-drain implementation, full-suite gate RED

- Starting clean HEAD: `02bfa3b560826c61add3e6ffab145cca1d18f4d0`.
- Exact tested source/test HEAD: `853bc5524385f697fa5cb89fdb668d73f00dae84`.
- Task `task_85934b0e3720`, dispatch `ctx_a22bedba27d5`.
- **LOCAL COMMIT / HOLD-PUSH. Full coordinator remains UNACCEPTED and unwired.**
- **Bounded implementation checkpoint, not a green full-suite completion claim:** targeted 86/86;
  the one final-code full suite had 386 passed, 1 failed, 48 skipped. Independent Claude HIGH
  whole-coordinator review and the future combined exact-head hosted gate remain mandatory.

## Authorization and scope

Read the complete `/tmp/opencode/t11p-clean-drain-handoff.md`, including joint approvals and D1–D4;
canonical main AGENTS, BRIEF, OWNER-DIRECTIVES, D-013/addenda and EXECUTION section 4a; current
design shutdown/cancellation contract and fixes 1–4 reports. Main `708119c` records joint scope;
the later main pickup board records the narrowly authorized source-writer exception. Actual fresh
parent GPT-6.1 Sol HIGH was coordinator-confirmed before code in `msg_2f2a9a7ee79b`.

The parent requested clarification of a mandatory delegation/sole-author conflict before source
changes (`msg_4a56c5c0fb84`). Coordinator reply `msg_4173bf2b011f` authorized **one GPT-family
source fixer**, with parent-owned controlled tests/report, no overlapping source writers, full
parent hunk inspection and explicit configuration/runtime uncertainty. No second source helper ran.

Only the coordinator and minimal internal ConsentStore admission/time-provider seam changed in
production. No Agent composition, Core, API, native adapter/protocol, recovery, OS lifecycle hooks,
dependencies, workflow or main-worktree changes. No push, hosted CI or owner Windows execution.

## Root cause and implementation

Baseline Stop bounded only its worker wait, then awaited the marker indefinitely; each concurrent
Stop incremented the epoch and could issue another clean marker. Dispose could release before a
reserved/in-flight Open, and postseal restrictions could reuse a fence being cleaned as proof.
The four authentic new baseline failures are preserved in `red.log`.

- One shutdown owner/epoch and one monotonic five-second start timestamp are reserved under the
  authorization gate. Concurrent Stop/Dispose join that lifecycle; no fresh drain/marker budget.
- One Open completion slot is reserved **before** external dispatch, including the controlled
  reserve-to-dispatch gap. Critical Open/write/clean I/O receives no observer cancellation token.
- The retained owner awaits actual Open and writer completion before marker eligibility. Clean
  reservation checks admission sealed, captured eligible session, zero owned mutations, exact
  generation, no sticky failure/abandon/dispose, and remaining total budget in one gate transaction.
  Persistence calls/awaits and the dispatch barrier remain outside the authorization monitor.
- Dispose-first never issues clean. Dispose after Stop suppresses an unissued marker. An already
  reserved/issued marker is observed, not aborted, but Dispose before acknowledgement suppresses
  the current clean-success outcome. Only one release follows real I/O quiescence.
- Postseal mutations reject before Store metadata changes/admission and cannot claim Durable or
  FenceCovered. Already-admitted restrictions retain actual dirty-fence proof until marker ownership
  is reserved; a failed admitted write can remain FenceCovered without allowing clean.
- Stop/Dispose keep nonthrowing void ValueTask observation. A shared abandonment latch publishes
  Unavailable and prevents late clean/Ready authority. Internal `ShutdownPending` distinguishes
  outstanding ownership from observer completion; `CleanShutdownSucceeded` is explicit clean proof,
  unlike ordinary inactive Dispose-first Stopped health.
- A timely known clean acknowledgement is not rolled back by later observer cancellation or an
  expired release observation. Release joins the original deadline; no new release-only budget.
- Late clean can truthfully leave physical clean bytes while this instance remains Unavailable.
  No compensating dirty write, abort, forced unlock, automatic reopen or dirty-after-issued-I/O
  guarantee was introduced.

There is one retained shutdown coroutine, one owner/decision pair, one Open slot and the existing
writer, not a per-caller cleanup task/map. Observer wait frames/registrations live only for their
calls. Pending synchronous I/O is rooted by its executing worker; asynchronous I/O retains the
owner continuation through the pending operation's completion machinery, which retains persistence
and its handles. This is not reliance on an otherwise unreachable task/object cycle or a global
orphan registry. If native I/O never settles, public observation can finish while resources remain
owned indefinitely; no bounded native completion or bounded actual disposal is promised.

Parent inspected every source hunk and sent two narrow corrections back to the **same** fixer:
Dispose during an issued marker must not publish clean success, and sealing rejection must not erase
actual dirty-fence coverage for previously admitted writes. Parent re-inspected both corrections.

## Deterministic matrix and limits

The 18 controlled shutdown cases use a monotonic manual TimeProvider (wall-clock access throws),
barriers and bounded test waits. They exercise real Store/coordinator logic, plus real ConsentSession
for marker failure before/after simulated atomic replacement. They are not native durability proof.

| Claim / schedule | Evidence |
| --- | --- |
| One owner/epoch/marker for concurrent Stops | Concurrent_stop_callers case; authentic baseline RED |
| Cancellation during issued clean is nonthrowing, shared, does not abort I/O | Cancelled_clean_observer and Cancelled_joiner cases; first has authentic RED |
| Postseal rejection has no FenceCovered/Durable proof or metadata growth | Restriction_after_clean_reservation case, 100 origins and zero entries/sequences/reservations; authentic RED |
| Open ownership precedes dispatch; no release-before-late-Open | Dispose_joins_open baseline RED, Reserved_open_before_external_dispatch, Open_stall cases |
| Five seconds total through write; no marker after exhausted drain | Total_budget_expires_during_write, late acknowledgement and late fault variants |
| Four seconds writer plus only one second marker observation | Writer_and_marker_share_remaining_budget, late success and fault variants |
| Admitted restriction remains in durable generation before marker | Marker case asserts saved blocked record and exact written/clean generation |
| Dispose-first/Stop-first before marker never clean; one release | Dispose_before_marker variants |
| Dispose during issued marker retains ownership, cannot abort, no clean-success claim | Dispose_during_issued_marker case |
| Known timely clean remains true after late cancel/expired release observation | Timely_clean_success and Release_observation cases |
| Failed marker leaves only actual old Dirty/new Clean bytes, never successful current clean | Failed_atomic_clean variants through real ConsentSession and simulated replacement boundary |
| Actual Windows retained-lock sharing error 32 and eventual reopen | Authored small test in existing WindowsConsentDirectoryTests fixture; **SKIPPED/unexecuted on Linux** |
| Fixes 1–4 remain locally covered | Existing four targeted classes, 68 pre-existing cases, remain green |

The native test holds a coordinator-owned write before dispatching the real Session write while
the accepted Windows directory lock is genuinely retained. It does not simulate native syscall
cancellation, prove stalled OS calls or change the accepted bounded OpenLock/error-32 policy.
Controlled `LockHeld` assertions alone are not native exclusion proof. No new artificial generation
corruption or owned-set mismatch test was added; normal exact-generation and ownership checks are
covered, but independent whole-coordinator review remains required.

The existing late-Open Dispose test was rescheduled to release Open **before** awaiting normal
disposal, preserving its Stopped/no-authority assertions. Under D4 a bounded timeout must instead
remain Unavailable; the separate new manual-time Open-stall case asserts that approved outcome.
No old test was removed or skipped to obtain green results.

## Validation and unresolved full-suite failure

Pinned SDK `/tmp/opencode/zilo-sdk/sdk/dotnet` (10.0.403),
`DOTNET_ROOT=/tmp/opencode/zilo-sdk/sdk`. Every run held
`flock --close /tmp/opencode/zilo-real-port-tests.lock`; Release, `--no-restore`,
`-p:UseSharedCompilation=false -nodeReuse:false`. Targeted watchdog 90s, full 180s;
the narrow post-failure isolation used 60s and `--no-build` on the same final assemblies.

| Artifact | Observed result |
| --- | --- |
| `red.log` | Baseline production: 0 passed / 4 failed, exit 1, the four genuine behavioral failures above |
| `first-targeted.log` | Initial integrated correction: 86 passed / 0 failed / 0 skipped, exit 0 |
| `final-targeted.log` | Exact final source/test: 86 passed / 0 failed / 0 skipped, exit 0 |
| `final-backend.log` | **One** final-code full suite: 386 passed / 1 failed / 48 skipped, exit 1 |
| `prompt-failure-isolation.log` | The failing existing test alone on identical assemblies: 1 passed, exit 0; does not erase the full-suite failure |
| `deterministic-prompt-diagnostic.log` | Real Store with a gated later cancellation callback: native callback called once, exit 0; **did not reproduce** the failure |
| `cts-callback-characterization.log` | Controlled queued CancelAsync worker: callback count **1 without** premature CTS.Dispose, **0 with** premature CTS.Dispose; both cancellation tasks settled, exit 0 |

Full breakdown: Agent 345 passed / 1 failed / 48 skipped; Core 7 passed, Virtual 28 passed,
Scaffold 6 passed. The failure is
`SecurityInvariantTests.Removing_a_prompt_cancels_native_wait_and_stale_completion_cannot_grant`:
five-second timeout waiting for `FirstCancelled` at line 58. Its unbound in-memory path and test
were not modified by fix 5. Inspection shows a completion/cancellation-callback scheduling race is
plausible, but **pre-existing flakiness/root cause is not proven** by the passing isolated rerun.
No out-of-scope prompt-cancellation fix or second full-suite run was attempted. This checkpoint
therefore has a red full-suite gate and cannot claim completed full validation.

Coordinator authorized a final bounded standalone diagnostic (`msg_940fd0c01378`), not a production
fix. The first real-Store schedule blocked a later LIFO cancellation callback, awaited the actual
NativePromptResolution before releasing it, then awaited a retained CancelAsync task: the earliest
native callback still ran once. Thus disposing after callback execution has already entered did
**not** reproduce this failure. The second .NET-only characterization held the sole threadpool
worker before the CancelAsync work item could run and compared the same schedule with/without
premature CTS.Dispose: actual native-callback counts were 0 versus 1. All gates have bounded waits
and finally release. These diagnostics support a callback-lifetime hazard **before worker capture**;
they do not establish that the original Store failure took exactly that ordering. Both standalone
inputs are retained as noncompiled diagnostic text beside their logs. No final source/test inputs
changed, and no broader tests were rerun. Prompt CTS disposal/CancelAsync ownership needs a separately
approved diagnosis/fix; the exact Store failure remains unresolved.

The 48 skips comprise 47 existing platform/environment skips and one new authored Windows native
case. No compiler warnings/errors appeared in the successful targeted/full compilation. Initial
new fixture compilation required ordinary warnings-as-errors/analyzer corrections before authentic
behavioral RED was captured; that compiler error is not represented as the RED proof.

`git diff --check` passed. Against accepted storage baseline
`99766593f46705812dc8ca9f1ea8438b89181a3c`, diffs are empty for Core, Agent/startup, API,
native directories, ConsentSession protocol, Windows lock policy, workflows and central backend
build/package inputs. Reports/logs are evidence only, not new source/test changes.

## Authorship/provenance and next gate

| Lane | ID | Configuration versus actual evidence | Files/status |
| --- | --- | --- | --- |
| Parent | term_0d22586d-a489-4cc0-8236-ee7156222e57 | Actual fresh GPT-6.1 Sol HIGH coordinator-confirmed | All controlled/native test edits, report, full source-hunk inspection and validation; no direct production source edits |
| Read-only explorer | ses_e5e7b0798ffegx7XGhjIS8GqTo | Worktree config pins Sol HIGH; helper self-reported configured gpt-5.6-luna; actual runtime independently unverified | Canonical/main requirements and prior reports only; completed, **no edits** |
| Single source fixer | ses_e5e781e1effeb7XFO5dQlTr2ln | Worktree fixer pin verified Sol HIGH; available model lookup then explicit launch openai/gpt-6.1-sol#high; no contrary identity observed, **runtime independently unverified** | Only ConsentPersistenceCoordinator.cs and minimal Consent.cs seam; completed, same session reused for two narrow corrections, no other writers/helpers/commits |

Local configuration was not changed or committed. The source helper's work is not independent
cross-family acceptance review. **Next:** resolve/reproduce the full-suite failure in an authorized
bounded lane, obtain independent Claude HIGH whole-coordinator review, then the future combined
exact-head hosted gate. Agent wiring, recovery, actual OS lifecycle and native platform acceptance
remain open; full T11p and T14 remain held.
