# T11p prompt cancellation lifetime — local evidence

**LOCAL / HOLD-PUSH. Full authorization remains UNACCEPTED and unwired.**
This is a defensive source correction against a demonstrated cancellation-source lifetime
hazard, not proof of the cause of the earlier full-suite `FirstCancelled` timeout.

## Starting point and authorization

- Clean starting HEAD: `3ecfe30d0505bbab1541b5fdc9694bf488d12536`.
- Prior source/test HEAD: `853bc5524385f697fa5cb89fdb668d73f00dae84`.
- Exact final source/test HEAD: `19d895e92f5b6c9d1d9a1751c24a283aad4b5d8c`.
- Task `task_4c9363804103`, dispatch `ctx_ebf0e0f37bd8`.
- Parent actual GPT-6.1 Sol HIGH independently confirmed by coordinator messages
  `msg_a9bb5f871ddf` / `msg_c512f861fdd0`; narrow owner plan sent before production changes
  (`msg_12fa3d147913`) and approved with timer/stale-owner conditions (`msg_ad92b2b17f97`).
- Read canonical main AGENTS/BRIEF/OD-18/EXECUTION 4a/D-013 and the clean-drain report,
  real-Store diagnostic and controlled CTS characterization logs.

## Evidence interpretation

The previous full suite remains honestly recorded as 386 passed / 1 failed / 48 skipped.
Its `SecurityInvariantTests.Removing_a_prompt_cancels_native_wait_and_stale_completion_cannot_grant`
timeout was not reproduced by the prior gated real-Store diagnostic. The standalone runtime
characterization showed callback suppression when disposing before the queued CancelAsync
worker captured registrations, but did not establish that the Store failure took that ordering.

The new baseline SecurityInvariant run passed 7/7; this is not proof the prior failure was
pre-existing or harmless. Five new real-Store controlled schedules all failed on unchanged
production source because ResolvePrompt had disposed the CTS while a registered cancellation
callback was still running. These establish the lifetime invariant violation, not reproduction
of the original missing-callback timeout. Existing `FirstCancelled` assertions remain unchanged.

## Ownership and validation plan

One per-prompt owner reserves cancellation before scheduling it, captures the token safely,
and retires only after resolver completion and any reserved actual CancelAsync completion.
Deadline cancellation uses that same owner, not an unobserved CTS timer path. Natural
completion retires promptly; stale cleanup detaches only its matching owner. No waits or native
callbacks execute on a call stack holding the authorization monitor, and there is no task history.

The owner has four monotone flags: resolver finished, cancellation reserved, cancellation finished,
and retired. Reservation wins under its private gate before a single off-stack worker is queued.
Resolver completion alone cannot retire a reserved cancellation. That worker observes the actual
`CancelAsync` task, including callback faults, before setting cancellation finished; retirement then
requires both sides finished and occurs exactly once outside both gates. A timer callback uses the
same reservation method, never `CancelAfter` or an independently timed CTS. The token is captured
before cancellation can race native dispatch. No-native owners start resolver-finished but remain
live until explicit/deadline cancellation. Natural native completion wins retirement atomically
against a late timer; its timer is disposed and a late callback cannot reserve a retired owner.

The single latest `NativePromptRetirement` internal Task is bounded observation, not a task history
or authority signal. As before, a native cancellation callback that never returns can keep that
prompt's cleanup pending indefinitely; this lane promises ownership, not forced native completion.

Parent owns tests, logs, report, inspection of every source hunk and final validation. Test
barriers are instance-local with bounded waits and finally releases; no ThreadPool saturation,
shared mutable test globals, sleeps, retries, timeout increases or new skips are used.

Pinned SDK: `/tmp/opencode/zilo-sdk/sdk/dotnet` (10.0.403),
`DOTNET_ROOT=/tmp/opencode/zilo-sdk/sdk`; each test command uses
`flock --close /tmp/opencode/zilo-real-port-tests.lock`, Release, `--no-restore`,
`-p:UseSharedCompilation=false -nodeReuse:false`. Narrow tests precede the single changed-final
backend suite. No push, hosted CI, owner Windows execution or main-worktree writes are authorized.

| Artifact | Observation |
| --- | --- |
| `baseline-security.log` | 7 passed, 0 failed, exit 0 on original production source |
| `red.log` | 0 passed, 5 failed, exit 1; real premature CTS disposal in Remove/Grant/Deny/Block/Expire schedules |
| `green-security-lifetime.log` | Initial integrated lifetime cases plus unchanged SecurityInvariant: 15 passed, 0 failed, 0 skipped, exit 0 |
| `final-consent-targeted.log` | Final source/tests, all Consent plus SecurityInvariant: 251 passed, 0 failed, 48 skipped, exit 0 |
| `final-backend.log` | **One** changed-final-code full backend suite: 397 passed, 0 failed, 48 skipped, exit 0 |

Full breakdown: Agent 356 passed / 48 skipped; Core 7 passed, Virtual 28 passed, Scaffold 6 passed.
The ten new cases cover the five RED schedules, exact manual 29/30-second deadline dispatch,
natural completion and late deadline, no-native deadline retirement, cancellation before native
registration, and idempotent cancellation with a throwing callback. The five real-Store blocked
callback cases assert source access remains legal and retirement pending before release, then
actual cancellation callback delivery, retirement, disposed source and unchanged authority afterward.
They also start a new granted prompt while old cancellation is blocked; old retirement must not
affect it. Existing NativeConsentPublication replacement/stale/lifecycle cases remain in the targeted
set, and the pre-existing strict `FirstCancelled` assertion was not changed.

The timer schedule is controlled by the existing instance-local ManualTime helper through a trailing
internal constructor parameter; public construction still uses TimeProvider.System and the original
timeout seconds. No public API shape changed. The callback delivery deadline still depends on runtime
scheduling, as all native cancellation dispatch does; the authorization transaction retains its
independent exact PendingUntil check. A native Request barrier tests removal before cancellation
registration without starving the full test process or modifying ThreadPool settings.

All successful compilations had no reported warnings/errors. `git diff --check` passed; differences
from starting HEAD are only Consent.cs, the new test file and this evidence directory. Diffs from
starting HEAD are empty for persistence/coordinator, Core, Agent/startup, API, driver/native paths,
workflows and central backend build/package inputs. Thus accepted fixes 1–4 and fix 5 owner/budget/
admission/late-clean source semantics are preserved byte-for-byte outside this narrow prompt owner.
The 48 skips are the same platform/environment exclusions as before this lane, including the
previously authored Windows shutdown-lock case; this change added no skip.

Full green is local regression evidence only. It neither proves the original timeout's exact causal
schedule nor supersedes required independent whole-coordinator review or cross-platform evidence.

## Provenance and remaining gates

Exactly one source helper was dispatched because the parent workflow requires implementation
delegation: `ses_e5e66b7efffeuCBZUTk7o3wPND`, fixer, only `backend/src/Zilo.Security/Consent.cs`.
Model lookup returned `openai/gpt-6.1-sol` with variant `high`, explicit dispatch used
`openai/gpt-6.1-sol#high`, and both active worktree config and fixer preset specify Sol/high.
Actual helper runtime is independently **unverified**. The helper completed, parent inspected every
source hunk after completion, and the helper ran no tests and edited no other files. No other helpers
ran; parent wrote all tests/report and executed all validation commands, with no direct production
source edits and no worktree configuration changes.

Independent Claude HIGH whole-coordinator review remains required after local quality; under
OD-18 it is **HELD-for-Claude** if unavailable, never self-PASS. Hosted exact-head/cross-OS
acceptance, Agent wiring, recovery and actual OS lifecycle are not established by this lane.
