# T11p macOS storage slice: Claude review r2 (HIGH, Opus master)

**Verdict: PASS (slice only).** Reviewed the fix `6716f46` (Option A) on head `38a859b`
(`AlexandreLozi/t11p-integration`), against r1 P1-1. This is not a T11p PASS: the Windows adapter,
auth/Agent integration, recovery, OS lifecycle, the hosted 3-OS gate and the combined Claude HIGH
review of T11+T11p are all still open.

## Hosted evidence: Backend CI 41519793144, attempt 3, on exactly 38a859b
- **Backend (macos-latest), job 125689903723:** runner image `macos-26-arm64`. Every test
  passed: Agent 219 passed, 0 failed, 3 skipped. The skips are 2 Linux-only tests and 1
  Windows-only test (`New_file_creation_options_reject_windows`).
  Core 7/7, Scaffold 6/6, Virtual 28/28.
- From the job's trx artifact, all native `MacConsentDirectoryTests` **executed and passed** on
  arm64. In r1 almost all of them failed at `CheckPrivate`. They cover:
  - spaces, the full-flush order and a clean reopen;
  - injected full-flush failures (1 and 4) that prevent a clean reopen;
  - exclusive lock release only on actual dispose;
  - the existing permissive lock rejected without repair;
  - an extended ACL on the root and on a file;
  - an oversized snapshot rejected before allocation;
  - a root swap that does not redirect the anchored replace;
  - symlinks at the ancestor, the lock and the snapshot, none of which redirect a read or create.
- The `MacConsentGuardTests` also pass, including `Darwin_64_bit_ABIs_are_the_only_candidates(Arm64)`
  and `OpenAt_is_noncreating_three_argument_native_call`.
- **Earlier attempts on 38a859b:** ubuntu and macos-15-intel green. Windows red on 1 test,
  `RealHttpTests.Occupied_primary_port_uses_only_ordered_fallback`: a port test, not the storage
  slice. It is under diagnosis (`docs/tasks/T11-port-flake-diagnosis.md`) and still gates T11p.
  Attempt 3 re-ran only the arm64 job, the single job-only retry both masters agreed (OD-15).

## P1-1 (variadic `openat` mode on Apple arm64): closed
- `openat` is now declared with three arguments and is never given a mode. The `Create` and
  `Exclusive` constants are gone, and a guard test enforces the signature and scans the source.
- New files (the temp snapshot and `consent.lock`) are created through managed
  `FileMode.CreateNew` with `UnixCreateMode` 0600, so .NET passes the mode correctly for the
  platform ABI. The fix then:
  1. re-validates the chain and the private root;
  2. requires the new file to be empty;
  3. applies `fchmod(0600)`, which is not variadic, before any write;
  4. binds the handle to the named entry (`ValidateNamed`) and re-validates the chain.
- **`consent.lock`:** an exclusive create is tried first. Only `EEXIST` (17, the same on Darwin
  and Linux) allows the non-creating anchored `openat`, which then applies the strict check with
  **no chmod repair**. A native test proves a 0640 lock is rejected and left unchanged.
- **Accepted trade-off (Option A, as co-approved):** the create step resolves a path, not an
  anchored descriptor.
  - The final component is safe, because `O_EXCL` refuses an existing name, including a symlink.
  - An ancestor swap is caught by the chain and name checks after the create. At worst it
    leaves a stray empty 0600 file, and it never yields a redirected write.
  - The native root-swap and symlink tests pass on both architectures.

## Non-blocking notes
- `FileShare.ReadWrite` on a fresh lock lets .NET take its own advisory shared `flock`. The
  adapter then upgrades it to `LOCK_EX|LOCK_NB` on the same descriptor, and the release-on-dispose
  test proves the behaviour. Keep this in mind if the share mode ever changes.
- The guard test scans the source with a regex. It is a backstop; the native arm64 job is the
  real proof.

## Carry-forwards (unchanged)
The Linux r2 carry-forwards stay tracked in EXECUTION §4b: an unskipped ACL test with `acl`
installed in the hosted gate, a runtime-only libc proof, `IsVolatile` honoured by composition, and
T11p.1 before M6.
