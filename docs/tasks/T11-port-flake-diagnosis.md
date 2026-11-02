# T11 Windows port test failure: diagnose, then a minimal fix (DeepSeek, OD-11; GPT reviewer)

**Failure:** Backend CI 41519793144 on `38a859b`, job "Backend (windows-latest)".
- Failing test: `RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback`.
- Error: `System.Net.Sockets.SocketException: Only one usage of each socket address`, from
  `Socket.DoBind`.
- That is `WSAEADDRINUSE` (10048), not `WSAEACCES` (10013), so it is probably not a Windows
  excluded-port range.
- The same test passed on Windows in run 41518625514 (f461903), so the failure is intermittent.

**Target:** worktree `t11-port-flake`, branch `t11-port-flake`, from `38a859b` (the
t11p-integration head).

## Step 1: diagnosis first, no code changes
Write `docs/validation/logs/T11/port-flake-diagnosis.md`. Get the evidence from:
- the failed job log:
  `gh api repos/AlexandreLozi/zilo/actions/jobs/<windows job id>/logs --allow-escape-sequences`,
  where the job id comes from `gh run view 41519793144 --json jobs`;
- the uploaded test-results artifact (`gh run download 41519793144 -n backend-windows-latest`).

Answer, citing `file:line`:
1. **Which bind failed?** Is it the test's own "occupy the primary port" socket, or the agent's
   fallback listener? Get it from the stack trace in the log or `.trx`.
2. **What can hold 47841, 47842 or 47843 at that moment?**
   - List every test in the `Agent process` collection, and others, that binds a real port or
     starts an agent child process. Give its port and its cleanup: `Dispose`, kill, and whether it
     waits for process exit (`WaitForExitAsync` after `Kill(entireProcessTree: true)`).
   - On Windows, a killed process may still own its listening socket until it has fully exited.
     Check whether any test returns before that.
3. **Is the collection really non-parallel?** Check whether `DisableParallelization` is set on the
   `CollectionDefinition`. List the other test classes that bind those ports but are **not** in the
   collection, and say whether an assembly-level setting (`xunit.runner.json`) allows them to run in
   parallel.
4. **Does the test's own socket use exclusive-address semantics** that differ between Windows and
   Linux (`ExclusiveAddressUse`, `SO_REUSEADDR`)? Note any Linux-versus-Windows behaviour that
   explains why only Windows fails.

## Step 2: a minimal fix, only if the evidence supports one
- Examples: await the full process exit before the next test, add a missing `Dispose` or
  `WaitForExit`, or move a stray port-binding class into the non-parallel collection.
- **Forbidden:**
  - sleeps, retries or skips;
  - weakening the ordered-fallback assertion;
  - changing the production port contract (47841, then 47842/47843) or injecting an arbitrary port
    triple.
- Test and test-harness files only, plus the diagnosis log.
- If the evidence is inconclusive, stop after step 1 and report what the next evidence would need
  to be.

## Validation
- Pinned SDK at `/tmp/opencode/t12-proto-r2/sdk`.
- Run the affected test classes locally 30 times on Linux and report the count. Linux is not
  Windows proof: say so.
- Run the full locked suite once.
- **Never run anything natively on the Windows host (OD-6).** The hosted Windows job on the pushed
  head is the proof.

**Push:** only `t11-port-flake`, no PR. The push triggers Backend CI, which is the evidence.

**Acceptance:** `worker_done` with the diagnosis summary, whether a fix was made (with the diff
summary), the head SHA and the counts.
