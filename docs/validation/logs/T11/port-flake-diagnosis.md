# T11 Windows port-flake diagnosis

**Scope:** diagnosis of Backend CI run `41519793144`, job `Backend (windows-latest)`
(job id `125540938143`), head `38a859b`. Evidence read only from that run's job log and its
uploaded `backend-windows-latest` artifact (`.trx` for `Zilo.Agent.Tests`). No hosted run was
started; no Windows binary was executed natively.

**Result:** the failed bind is the test's own "occupy 47841" socket, not the agent's fallback
listener. It failed 1 ms after the previous test in the same collection killed its agent, which
was still the only process using 47841. The evidence supports a test-harness lifecycle defect, not
a production port-contract defect. A minimal harness fix is included; it is verified on Linux only
(Windows proof is held for CI, see "Evidence limits").

## 1. Which bind failed

`RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback` failed in 1 ms
(20:31:57.007–57.019 UTC) with:

```
System.Net.Sockets.SocketException: Only one usage of each socket address
  at System.Net.Sockets.Socket.DoBind(...)
  at System.Net.Sockets.Socket.Bind(EndPoint localEP)
  at System.Net.Sockets.TcpListener.Start(Int32 backlog)
  at Zilo.Agent.Tests.RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback()
      in backend/tests/Zilo.Agent.Tests/RealHttpTests.cs:line 99
```

Line 99 at `38a859b` is `using var occupied = new TcpListener(IPAddress.Loopback, 47841); occupied.Start();`
(line 102 at the fixed head).
The exception is `WSAEADDRINUSE` (10048), raised before the agent child process is even started
(line 100), so it is **not** the agent's ordered-fallback bind and not `WSAEACCES` (10013).

## 2. What held 47841 at that moment

The measured test timeline from the run's `.trx` (same assembly, same machine, UTC):

| start | end | test |
| --- | --- | --- |
| 20:31:54.615 | 20:31:55.304 | `RealAuthHttpTests.Baked_origin_can_issue_and_read_full_hello` (agent on 47841) |
| 20:31:55.774 | 20:31:56.305 | `RealHttpTests.All_three_contract_ports_occupied_fails_without_an_arbitrary_listener` (harness holds 47841–43) |
| 20:31:56.305 | 20:31:57.006 | `RealHttpTests.Real_loopback_http_exposes_public_hello_and_enforces_host_first` (agent on 47841) |
| 20:31:57.007 | 20:31:57.019 | `RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback` — **failed** |

The previous test's agent is the only 47841 user in the preceding millisecond. That test kills the
agent and awaits `WaitForExitAsync` (`RealHttpTests.cs:94-95` at the fixed head), so the *process*
is gone. But the test's `HttpClient` is declared at `RealHttpTests.cs:53` and scope disposal runs
after the `finally`, so the agent is killed first and the client's pooled connection is closed
afterwards. The server-side connection teardown therefore lands after `WaitForExitAsync` returns —
inside the next test's bind window. `WaitForExitAsync` waits for process termination, not for the Windows TCP stack
to release the local port.

Every fixed-port and process-spawning test in the assembly:

| test | fixed port | process / socket | cleanup |
| --- | --- | --- | --- |
| `RealHttpTests.All_three_contract_ports_occupied...` (`RealHttpTests.cs:15-18`) | 47841/42/43 held by harness | agent child (`:20-21`) | kill + `WaitForExitAsync` (`:33-34`) |
| `RealHttpTests.Real_loopback_http...` (`:49-50`) | agent on 47841 | agent child | client disposed, then kill + wait (`:89-95`) |
| `RealHttpTests.Occupied_primary_port...` (`:102`) | harness holds 47841, agent uses 47841→47842 | agent child (`:103-105`) | client disposed, then kill + wait (`:114-120`) |
| `RealAuthHttpTests.Baked_origin...` (`:133-136`) | agent on 47841 | agent child | client disposed, then kill + wait (`:151-157`) |
| `StartupTests` (`StartupTests.cs:9-21`) | none (`--self-test`) | agent child | kill in `finally` (`:47-53`), no wait |
| `CooperativeHostTests` (`:51-95`) | Kestrel on port 0 (`:26,58`) | test-assembly child (`:74-80`) | kill (`:94`), no wait |
| `LinuxConsentDirectoryTests` (`:45-51`) | none (child uses port 0) | test-assembly child | `:51` |
| `MacConsentDirectoryTests` (`:171-172`), `LinuxConsentReviewTests` (`:34-35`) | none | `chmod` / `setfacl` child | wait |
| `BodyRateTests` (`:108-109`), `ResponseCommitTests` (`:33-34,68-69`) | 47841 only as a fake `HttpContext.Connection.LocalPort` | no socket | n/a |
| `HttpTestAgent` and the other Kestrel-based classes | ephemeral port 0 (`HttpTestAgent.cs:20`) | in-process host | `DisposeAsync` |

Only `RealHttpTests` / `RealAuthHttpTests` bind real contract ports.

## 3. Is the collection non-parallel?

- There is **no** `[CollectionDefinition("Agent process")]` anywhere under `backend/tests`, so no
  `DisableParallelization` is set (and there is no `xunit.runner.json` / `.runsettings`).
- A named collection without a definition still serializes its member classes, and every class that
  touches 47841–43 is in `[Collection("Agent process")]` (`RealHttpTests.cs:9,125`,
  `CooperativeHostTests.cs:13`, `AuthorizationRaceTests.cs:15`, `TransportClosureTests.cs:8`,
  `CapabilityHttpTests.cs:13`, `BodyRateTests.cs:12`, `ContinuationHttpTests.cs:13`,
  `DiscoveryBoundTests.cs:7`). No serialization defect was observed: the 47841 tests do not overlap
  in the `.trx`.
- The collection still runs **in parallel with other collections** (no assembly-wide
  `DisableParallelization`): `ConfigurationBoundsTests` (not in the collection) ran 20:31:49.026–
  52.245 while `ContinuationHttpTests` (in the collection) ran 20:31:49.797–53.269. That does not
  matter for the fixed ports, because only the two `RealHttpTests` classes bind them and both are
  in the collection.

## 4. Exclusive-address / reuse semantics

The harness sets no socket option. `new TcpListener(...).Start()` uses a plain `Socket.Bind`:
.NET's `TcpListener` default `ExclusiveAddressUse` is false, and it only applies
`SO_EXCLUSIVEADDRUSE` when that property is set to true (`dotnet/runtime` `TCPListener.cs`,
constructor and `CreateNewSocketIfNeeded`). Kestrel's default listen socket likewise calls
`Socket.Bind` with no socket option (`dotnet/aspnetcore`
`Transport.Sockets/src/SocketTransportOptions.cs`, `CreateDefaultBoundListenSocket`).

So the difference is not an option the tests set; it is OS teardown/bind timing. On Windows a plain
bind rejects a local port that any socket still owns, including a socket in deferred TCP teardown
after its process exited; `WaitForExitAsync` does not order against that kernel work. No Linux
failure was reproduced (30 targeted repeats, see below), but Linux is **not** Windows proof and
this note does not claim a Linux-versus-Windows option difference.

## 5. Minimal fix

Test harness only, `backend/tests/Zilo.Agent.Tests/RealHttpTests.cs`: dispose each test's
`HttpClient` **before** killing its agent (in the `finally`), in
`Real_loopback_http_exposes_public_hello_and_enforces_host_first`,
`Occupied_primary_port_uses_only_ordered_fallback`, and
`RealAuthHttpTests.Baked_origin_can_issue_and_read_full_hello`.

Why this ordering: the client then closes its pooled connection first. The agent side becomes the
responder, so it does not create a server-side `TIME_WAIT` on 47841, and no user-space close is
left to happen after `WaitForExitAsync`, which is exactly the window the timeline shows. No sleep,
retry, skip, arbitrary port, assertion change, or production change is involved; the ordered
47841 → 47842 → 47843 contract and the fallback assertion are untouched.

Fixed diff (three `finally` blocks):

```diff
         finally
         {
+            client.Dispose();
             if (!process.HasExited) process.Kill(entireProcessTree: true);
             await process.WaitForExitAsync(TestContext.Current.CancellationToken);
         }
```

## 6. Evidence limits and local validation

- The `.trx` identifies the failing bind and the immediately preceding 47841 user; it does not
  expose the Windows kernel socket state, so the exact teardown substate (for example a
  server-side `FIN_WAIT_2`/`TIME_WAIT` for the accepted connection) is inferred from the 1 ms gap,
  not directly observed. This is a lifecycle-ordering fix supported by the timeline, not a measured
  Windows fix.
- OD-6/OD-16: no Windows binary was executed natively and no hosted run was started. **Windows
  proof is held for CI**, to be batched per OD-16.
- Local Linux (WSL, .NET SDK 10.0.403, Linux is not Windows proof), all real-port runs serialized
  with the shared `flock` path:
  - targeted `RealHttpTests` + `RealAuthHttpTests`: **30/30 runs passed, 0 failed**;
  - full locked suite once: **Failed 0** (Agent 208 passed / 14 skipped, Core 7, Scaffold 6,
    Drivers.Virtual 28).
- Next evidence needed: one batched hosted Windows run of `Zilo.Agent.Tests` on the reviewed head,
  ideally with the fixed-port classes repeated, showing the occupy-bind failure absent. A stronger
  optional probe would instrument a Windows-only diagnostic around the bind (active TCP
  connections for 47841), but that is not required to accept the harness fix.
