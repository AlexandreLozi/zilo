# T11p Linux storage slice: Claude review r1 (HIGH, Opus master)

**Verdict: CHANGES (1 P1).** The slice is otherwise well built.

Reviewed: `1e3fc3d..085ba8f`:
- `LinuxConsentDirectory.cs`: 252 lines;
- `LinuxConsentDirectoryTests.cs`: 287 lines;
- the logs.

This review covers this slice only. It is not a T11p or T11 pass.

## Reproduced
- Pinned SDK 10.0.403, Release build, local Linux x64:
  `dotnet test --filter LinuxConsentDirectory` passes **25/25**.
- **Mutation** (`NoFollow = 0`): 3 tests fail, the symlink cases at lock, ancestor and snapshot. So
  the tests catch a missing no-follow flag. That matters for P1-1, because no CI runs on arm64.

## Correct (checked line by line)
- **`statx` layout.** The UAPI offsets are right: mask@0, nlink@16, uid@20, mode@28, ino@32,
  size@40, dev_major@136, dev_minor@140. The required mask `0x30f` covers
  TYPE|MODE|NLINK|UID|INO|SIZE. `AT_EMPTY_PATH 0x1000`, `AT_SYMLINK_NOFOLLOW 0x100`,
  `AT_FDCWD -100`, `LOCK_EX|LOCK_NB` and the modes 0700/0600 are all correct.
- **Path walk.** It opens one component at a time from `/`, with retained handles and no symlinks.
  It re-checks each ancestor's inode and device through its parent on every operation, and checks
  owner, mode and type at every level.
- **Ancestor rules.** An ancestor that is group- or world-writable is accepted only if root owns it
  and it has the sticky bit set.
- **File checks.** Files must be exact-mode 0600 regular files with `nlink == 1` (no hard links).
  The lock is checked the same way.
- **Durable write order.** The write goes: exclusive no-follow temp file, write, `fsync(file)`,
  re-check the anchored names, `renameat`, `fsync(root)`, then re-check identity. Any failure
  poisons the adapter (fail closed), and the temp and dirty evidence stays in place.
- **Reads.** Reads are size-bounded before allocation; they check for EOF and that the size didn't
  change.
- **No authorization lock.** All I/O runs under a private lock, not the authorization monitor.
  Cancellation is checked before the `try`, so a cancel doesn't poison the store.

## Findings

### P1-1: the `open` flag constants are x86-64 only, so on arm64 there is no no-follow protection
`LinuxConsentDirectory.cs:10` hard-codes `O_DIRECTORY = 0x10000` and `O_NOFOLLOW = 0x20000`. Those
are the asm-generic/x86-64 values. **On Linux arm64 (and arm),
`arch/arm64/include/uapi/asm/fcntl.h` defines `O_DIRECTORY = 040000` (0x4000) and
`O_NOFOLLOW = 0100000` (0x8000).** There, 0x10000 means `O_DIRECT` and 0x20000 means
`O_LARGEFILE`.
- On arm64, every `openat` would follow symlinks and drop the directory check, which silently
  defeats the whole no-follow design.
- The framework-dependent `Zilo.Agent.dll` can run on arm64 (`dotnet Zilo.Agent.dll`), even though
  packaging ships x64 today.

**Fix:**
- **Minimum:** throw `PlatformNotSupportedException` (fail closed) unless
  `RuntimeInformation.ProcessArchitecture == Architecture.X64`, with a test.
- **Or:** use per-architecture constants for x64 and arm64, plus hosted arm64 evidence (the
  `ubuntu-24.04-arm` runner) before arm64 is enabled.

Add a comment that ties each constant to its UAPI header.

### P2-1: symlinked system ancestors make the store unavailable on common distros
Fedora Silverblue, Kinoite and other ostree systems use `/home -> var/home`. Some setups symlink
`$HOME` or `~/.local`. A no-follow walk fails closed there, so prompts stay disabled for every
user on those systems. Pick one, explicitly:
- (a) accept a symlinked ancestor only when the symlink and its parent are root-owned and not
  writable, resolve it with `readlinkat`, and recurse with a bound;
- (b) document it as unsupported, with diagnostics and copy (T05 handoff) that names the cause.

Option (a) is preferred, since ostree desktops are mainstream.

### P2-2: a group-writable private group under umask 002
Ancestors that are group-writable are rejected. Some systems pair user-private groups with
`umask 002`, so `~/.local` or `~/.local/state` can be 0775 with a group that only the user
belongs to. The store is then unavailable, and fixing it means the user running `chmod g-w`. Decide
whether to accept group-write when the group is the user's own primary private group with no other
members (hard to prove, so probably not). Otherwise give a precise diagnostic and remediation. At
minimum, add a test and the diagnostic.

### P2-3: the filesystem type is unchecked
On NFS, CIFS/SMB, FUSE or ZFS-with-NFSv4-ACLs, the mode and owner bits do not bound access, and
fsync/rename durability differs. Mirror the Windows "local NTFS only" rule:
- `fstatfs` on the root handle;
- allow local types only: ext4, xfs, btrfs, f2fs, tmpfs;
- fail closed on everything else, with a test (tmpfs works as a local case).

### P3-1: verify `libc` resolution on a runtime-only image
`DllImport("libc")` passed on the dev machine. Prove it on a container that has only the .NET
runtime (the existing deb install-smoke Ubuntu 24.04 image is a good place) during the hosted
gate, so a missing libc dev symlink can't make every boot fail.

### P3-2: consider `DangerousAddRef` around fd use
`Fd()` uses `DangerousGetHandle()` without `DangerousAddRef`. It is safe today, because every use
and `Dispose` take `_io`. Note that invariant in a comment, or use AddRef/Release.

## Rulings requested by the author
- **Privileged ownership (root or admin):** this is outside the D-013 threat model, which excludes
  same-user malware and admin. Root-owned ancestors are accepted, and that's correct. Document it.
  It is **not** a production blocker.
- **Extended POSIX ACLs:** the exact-mode checks (0700/0600) already bound POSIX ACL effective
  rights, because the group bits carry the ACL mask, so a named-user or group entry has no effect
  on a 0700/0600 object.
  - Default ACLs on the root are masked by the 0600 create mode.
  - Add one real test: set a named-user ACL and a default ACL on the root (where `setfacl` is
    available, else skip with a reason) to show the mode check rejects or neutralizes them.
  - NFSv4 and other ACL models are covered by P2-3.
- **Actual disk-error matrix (real kernel errno):** this is not needed for this slice. The
  simulated-acknowledgement faults plus real process kills meet the agreed bar ("ordered flush
  requests plus process-crash tests", no hardware claim). Keep the distinction stated in the
  report, as it is now.

## Required before this slice counts as done
P1-1, plus a decision with tests for P2-1, P2-2 and P2-3. The P3s can go to the hosted gate.
