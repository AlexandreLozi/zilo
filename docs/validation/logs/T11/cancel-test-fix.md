# T11 cancellation-observation test race fix — evidence (OD-11)

Branch: `t11-cancel-test-fix` (from `70769cf`, the t11p-integration head).
Scope: `backend/tests/Zilo.Agent.Tests/SecurityInvariantTests.cs` only. No production code changed.

## Cause

`GatePrompt` observed cancellation with a single non-volatile `bool` set from
`cancellationToken.Register(...)`, while `WaitAsync(token)` registered its own callback *after* it.
`CancellationTokenSource` runs callbacks LIFO, so the wait's cancellation (and the `finally` that
signals `Finished`) could complete before the observation callback ran, and
`RunContinuationsAsynchronously` let the test read the bool first. In the Remove test the store
cancels outside the gate, so `Complete(Granted)` could also finish the wait before the cancel
callback was observed. This made `Assert.True(prompt.CancellationRequested)` flaky on hosted CI.

## Change

1. `GatePrompt` now creates **one** `TaskCompletionSource<bool>`
   (`RunContinuationsAsynchronously`) per `RequestAsync` call, appended to a private list, and set
   only from that call's `Register` callback.
2. It exposes `FirstCancelled` — the first call's signal — so the timeout test's later
   `next.example` prompt can never satisfy the first call's observation.
3. Both tests replace `Assert.True(prompt.CancellationRequested)` with a bounded await:

```csharp
await prompt.FirstCancelled.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
```

All other assertions are unchanged: state `none`, `Finished` observed, the global slot released
(`next` is `pending`), and stale completion cannot grant. No sleeps, retries, `Skip`, or other test
edits.

## SDK pin

```
export DOTNET_ROOT=/tmp/opencode/t12-proto-r2/sdk
export PATH=$DOTNET_ROOT:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet --version -> 10.0.403   (matches global.json, rollForward disable)
```

## Targeted, repeated 50x

Command per iteration:

```
dotnet test backend/tests/Zilo.Agent.Tests -c Release --filter FullyQualifiedName~SecurityInvariantTests
```

Result: **50/50 runs passed** (each `Failed: 0, Passed: 7, Total: 7`), 0 failures.
Full per-run log: `/tmp/opencode/t11-cancel-fix/targeted-50x.log` (ephemeral worker path).

## Full locked suite (once)

```
dotnet restore backend/Zilo.slnx --locked-mode   # succeeded
dotnet test backend/Zilo.slnx -c Release         # exit 0
```

| Project | Failed | Passed | Skipped | Total |
|---|---|---|---|---|
| Zilo.Core.Tests | 0 | 7 | 0 | 7 |
| Zilo.Scaffold.Tests | 0 | 6 | 0 | 6 |
| Zilo.Drivers.Virtual.Tests | 0 | 28 | 0 | 28 |
| Zilo.Agent.Tests | 0 | 205 | 12 | 217 |
| **Total** | **0** | **246** | **12** | **258** |

The 12 skips are the pre-existing Darwin-only `MacConsentDirectoryTests` cases (and the real-POSIX-ACL
`LinuxConsentReviewTests` case) that require native macOS/ACL hosts; they are unchanged by this fix.

## Diff summary

- `backend/tests/Zilo.Agent.Tests/SecurityInvariantTests.cs`: +15/−4 lines — per-call cancellation
  signal in `GatePrompt`, `FirstCancelled` accessor, two bounded awaits replacing two bool asserts.
- `docs/validation/logs/T11/cancel-test-fix.md`: this log.
- No production code, no other test, no `opencode.json` / `.opencode/*` change.
