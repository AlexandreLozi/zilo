# T11 Windows port-flake diagnosis

**Scope:** diagnosis of Backend CI run `41519793144`, job `Backend (windows-latest)`
(job id `125540938143`), head `38a859b`. Evidence read only from that run's job log and its
uploaded `backend-windows-latest` artifact (`.trx` for `Zilo.Agent.Tests`). No hosted run was
started; no Windows binary was executed natively.

**Result:** the failed bind is the test's own "occupy 47841" socket, not the agent's fallback
listener. It failed 1 ms after the previous test in the same collection killed its agent; the
timeline puts that test on 47841 immediately before the failure, but no socket or process snapshot
shows what else, if anything, held the port, so causality and the exact TCP state are not proven.
The evidence is consistent with a test-harness lifecycle race and does not implicate the production
port contract. A bounded candidate mitigation is included; this correction only relabels it and the
prior Linux runs are reused unchanged, while Windows proof is held for CI (see "Evidence limits").

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

## 2. What the timeline shows about 47841

The `.trx` records test timing only; it contains no OS socket or process snapshot. Within the
assembly's test inventory, the measured timeline from the run (same assembly, same machine, UTC) is:

| start | end | test |
| --- | --- | --- |
| 20:31:54.615 | 20:31:55.304 | `RealAuthHttpTests.Baked_origin_can_issue_and_read_full_hello` (agent on 47841) |
| 20:31:55.774 | 20:31:56.305 | `RealHttpTests.All_three_contract_ports_occupied_fails_without_an_arbitrary_listener` (harness holds 47841–43) |
| 20:31:56.305 | 20:31:57.006 | `RealHttpTests.Real_loopback_http_exposes_public_hello_and_enforces_host_first` (agent on 47841) |
| 20:31:57.007 | 20:31:57.019 | `RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback` — **failed** |

The preceding test is the last test in this assembly's inventory known to use 47841, and its
recorded end (57.006) is 1 ms before the failing bind (57.007). The `.trx` cannot show whether any
other OS process or socket also held 47841 at that instant. That test kills the agent and awaits
`WaitForExitAsync` (`RealHttpTests.cs:94-95` at the fixed head), so the *process* is gone, but
`WaitForExitAsync` waits for process termination, not for the Windows TCP stack to release the local
port. The test's `HttpClient` is declared at `RealHttpTests.cs:53` and scope disposal runs after the
`finally`, so under the original order the agent was killed while the client's pooled connection was
still open and the client-side close happened afterwards; connection teardown could therefore
overlap the next test's bind window. That overlap is a hypothesis about timing, not an observed
socket state.

Every fixed-port and process-spawning test in this assembly's test inventory (not a snapshot of all
OS processes or sockets on the runner):

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

Within this inventory, only `RealHttpTests` / `RealAuthHttpTests` bind real contract ports; that is
not a claim about other processes on the runner.

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
  52.245 while `ContinuationHttpTests` (in the collection) ran 20:31:49.797–53.269. Within this
  assembly's test inventory, only the two `RealHttpTests` classes bind the contract ports and both
  are in the collection; the `.trx` cannot rule out another OS process holding 47841.

## 4. Exclusive-address / reuse semantics

The harness sets no socket option. `new TcpListener(...).Start()` uses a plain `Socket.Bind`:
.NET's `TcpListener` default `ExclusiveAddressUse` is false, and it only applies
`SO_EXCLUSIVEADDRUSE` when that property is set to true (`dotnet/runtime` `TCPListener.cs`,
constructor and `CreateNewSocketIfNeeded`). Kestrel's default listen socket likewise calls
`Socket.Bind` with no socket option (`dotnet/aspnetcore`
`Transport.Sockets/src/SocketTransportOptions.cs`, `CreateDefaultBoundListenSocket`).

So the difference is not an option the tests set; any Windows-specific effect would come from OS
teardown/bind timing. As a general Windows behaviour (not observed here), a plain bind rejects a
local port that a socket still owns, potentially including a socket in deferred TCP teardown after
its process exited, and `WaitForExitAsync` does not order against that kernel work. No Linux failure
was reproduced (30 targeted repeats, see below), but Linux is **not** Windows proof, this note does
not claim a Linux-versus-Windows option difference, and it does not claim that deferred teardown is
what happened in this run.

## 5. Candidate mitigation (hypothesis, pending Windows proof)

Test harness only, `backend/tests/Zilo.Agent.Tests/RealHttpTests.cs`: dispose each test's
`HttpClient` **before** killing its agent (in the `finally`), in
`Real_loopback_http_exposes_public_hello_and_enforces_host_first`,
`Occupied_primary_port_uses_only_ordered_fallback`, and
`RealAuthHttpTests.Baked_origin_can_issue_and_read_full_hello`.

This is a bounded candidate mitigation, not a proven fix. Its only claim is reduced overlap between
the client's connection lifetime and the agent kill: the client is disposed before the kill instead
of afterwards. `HttpClient.Dispose` does **not** await the TCP FIN handshake and does not establish
a kernel release barrier for 47841, so immediate kill can still race socket teardown; the report
does not claim which side closes first, that the agent becomes the responder, or that no
server-side `TIME_WAIT`/`FIN_WAIT` can remain. No sleep, retry, skip, arbitrary port, socket-option
change (reuse/exclusive flags) or production change is involved; the ordered 47841 → 47842 → 47843
contract and the fallback assertion are untouched.

Code diff under review (behaviour unchanged by this correction; three `finally` blocks):

```diff
         finally
         {
+            client.Dispose();
             if (!process.HasExited) process.Kill(entireProcessTree: true);
             await process.WaitForExitAsync(TestContext.Current.CancellationToken);
         }
```

## 6. Evidence limits and local validation

- The `.trx` proves the failing bind and the immediately preceding test in the same collection. It
  does **not** prove that the preceding test's agent was the only OS holder of 47841, the exact TCP
  substate (for example a server-side `FIN_WAIT_2`/`TIME_WAIT`), or causality. Those remain
  unobserved hypotheses inferred from a 1 ms gap.
- OD-6/OD-16: no Windows binary was executed natively and no hosted run was started. **Windows
  proof is held for CI**, to be batched per OD-16 with the adapter work.
- Local Linux (WSL, .NET SDK 10.0.403, Linux is not Windows proof), all real-port runs serialized
  with the shared `flock` path, recorded at `b460df9`: targeted `RealHttpTests` +
  `RealAuthHttpTests` **30/30 runs passed, 0 failed**; full locked suite once **Failed 0** (Agent
  208 passed / 14 skipped, Core 7, Scaffold 6, Drivers.Virtual 28). The comment/report correction
  does not change code behaviour, so these results are reused rather than rerun.
- Next evidence needed: one batched hosted Windows run of `Zilo.Agent.Tests` on the reviewed head,
  ideally with the fixed-port classes repeated. If the occupy-bind failure still occurs, the next
  step is to capture actual socket and process state at the failing bind (for example the runner's
  active TCP connections for 47841 with owning processes, plus a process snapshot) instead of
  recording another annotation or a pass. Any Windows instrumented diagnostic must stay
  test-harness-only and public-redacted.
