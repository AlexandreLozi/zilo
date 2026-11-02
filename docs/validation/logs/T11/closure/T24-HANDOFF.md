# T24 native noncooperative backend boundary

T11 owns cooperative in-process calls only. `DiscoveryService` admits at most one
outstanding call per backend instance across discovery and capabilities, bounds
the HTTP wait (default15s), retains and observes a timed-out call, and does not
dispose a backend until its owned call actually finishes. Successful backends
release independently; permanently hung work retains one slot/resources until
process exit. Repeated requests do not accumulate calls.

Host shutdown uses configured `AgentOptions.BackendShutdownGrace` (default2s).
Cancellation callback completion is also bounded for host waiting; no callback is
force-aborted. A redacted diagnostic reports only retained call count. Managed
fake child-process tests prove Linux process exit without releasing the fake,
not native thread termination or cross-OS driver recovery.

T24 must own native process isolation: establish an out-of-process driver host,
bounded authenticated IPC, per-process resource limits, process-tree ownership,
kill/relaunch policy, stale-generation rejection, and disposal after confirmed
exit. Native code that blocks forever must not be put behind another in-process
Task.Run and described as isolated. T11 neither implements nor certifies this
native process manager. Windows/macOS hosted and real-driver evidence remain
external gates, with no unsigned native execution on the owner's SAC host.
