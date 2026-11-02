# T11p macOS storage slice: Claude review r1 (HIGH, Opus master)

**Verdict: CHANGES (1 P1, found by hosted CI).** Reviewed `780337d..70769cf`, the
`MacConsentDirectory` adapter and its tests. This is the slice only.

## Hosted evidence: Backend CI 41516769735 on 70769cf
- **macos-15-intel (x64):** every `MacConsentDirectoryTests` test passes. Agent is 214 passed,
  1 failed, 2 skipped. The one failure is the known `SecurityInvariantTests` cancellation race (fix
  in flight, docs/tasks/T11-cancel-test-fix.md), and the 2 skips are Linux-only tests. That is
  native Darwin x64 proof of real F_FULLFSYNC, ACL rejection, the paths with spaces, the lock and
  reopen.
- **macos-latest (arm64):** almost every native `MacConsentDirectoryTests` test fails in
  `CheckPrivate` at `MacConsentDirectory.cs:79`.
- ubuntu green; windows red only on the same cancellation race.

## P1-1: `openat`'s `mode` is a variadic argument, which breaks on Apple arm64
- `openat(int, const char *, int, ...)` takes `mode` as a C variadic argument. On Apple arm64,
  every variadic argument is passed **on the stack**. The P/Invoke at `:263` declares
  `uint mode` as a fixed argument, which goes in a register.
- So on arm64, `O_CREAT` reads garbage from the stack as the mode. `consent.lock` (`:78`) and the
  temp files get random modes. The strict `CheckPrivate` correctly rejects them, which keeps the
  failure closed, but the store never works on Apple Silicon.
- On x86-64, variadic arguments go in registers, so Intel passes.
- The author already handled this correctly for `fcntl(F_FULLFSYNC)` (`:267`), but not for
  `openat`.

**Fix (preferred):**
- Never pass `mode` through `openat`. Declare `openat(int fd, string name, int flags)` for every
  call.
- For each create:
  1. `openat(..., O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC)` in the private 0700 root;
  2. immediately `fchmod(fd, 0600)` (not variadic), before any write;
  3. then `CheckPrivate`.
- For `consent.lock`, try `O_EXCL` first. On `EEXIST`, reopen without `O_CREAT` and apply the strict
  check, with **no chmod repair** of an existing file.
- The root is already private (0700, owned by the uid), so the moment between create and `fchmod`
  exposes nothing.
- Don't use the "pad x3-x7 with dummy arguments" stack trick: it's fragile.

Add a unit test that the create path never passes a mode. The proof is the hosted macos-latest
(arm64) job going green.

## Checked and correct
- **Constants:**
  - `O_NOFOLLOW 0x100`, `O_DIRECTORY 0x100000`, `O_CLOEXEC 0x1000000`, `O_CREAT 0x200`,
    `O_EXCL 0x800`, `O_NONBLOCK 4`, `AT_SYMLINK_NOFOLLOW 0x20`;
  - `F_FULLFSYNC 51`, `ACL_TYPE_EXTENDED 0x100`;
  - `MNT_LOCAL 0x1000` required; `MNT_RDONLY|MNT_IGNORE_OWNERSHIP` rejected.
- **Struct layouts:** `struct stat` with 64-bit inodes (144 bytes: dev@0, mode@4, nlink@6, ino@8,
  uid@16, size@96) and `struct statfs` (2168 bytes: flags@64, fstypename@72). They use the right
  `$INODE64` entry points on x64 and the plain ones on arm64.
- **Flushes:** strict full flush on the file before rename and on the directory after it; any
  failure poisons the adapter, with no fsync-only fallback.
- **Filesystem and ACLs:** an APFS/HFS allowlist. An extended ACL on the root or a file is rejected
  through `acl_get_fd_np`, with the `acl_free` lifetime handled. The real `chmod +a` tests pass on
  Intel.
- **Architecture guard:** Darwin x64 and arm64 only.

## Required before this slice counts as done
P1-1, then **one** hosted Backend CI run on the fixed head with **both** macOS jobs green on the
MacConsentDirectory tests. Ideally the cancellation race fix is included, so the whole job is
green.
