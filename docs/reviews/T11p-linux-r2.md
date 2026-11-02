# T11p Linux storage slice: Claude review r2 (HIGH, Opus master)

**Verdict: PASS for this slice.** This is not T11p or T11 acceptance.

Reviewed: `085ba8f..780337d`. The code change is in `cf621b9`.

## Reproduced
- Pinned SDK 10.0.403, Release build, local Linux x64:
  `dotnet test --filter LinuxConsent` gives **44 passed, 1 skipped**.
- The skip is the real ACL test, because `setfacl` is not installed on this machine.

## r1 findings
- **P1-1: closed.** `RequireSupportedPlatform` throws on anything but Linux x64. It runs before
  the first syscall in `Open`. Each constant cites its UAPI header, and a comment calls the guard
  security-critical. A unit test covers every non-x64 architecture.
- **P2-1: closed as option (b)**, by joint choice. Strict no-follow stays, and a symlinked ancestor
  gets a specific `consent-symlink-ancestor-unsupported` diagnostic, with a test.
  - Follow-up **T11p.1**, before the M6 tester builds: bounded root-owned symlink-ancestor
    resolution, so that Fedora Silverblue and other ostree users get prompts.
- **P2-2: closed.** A 0775 ancestor is still rejected, now with the actionable
  `consent-ancestor-writable` message and no automatic chmod, with a test.
- **P2-3: closed.** `fstatfs` on the root descriptor uses an allowlist from
  `include/uapi/linux/magic.h`:
  - ext family `0xEF53`, xfs `0x58465342`, btrfs `0x9123683E` and f2fs `0xF2F52010` are allowed;
  - tmpfs `0x01021994` is allowed but marked `IsVolatile`, covered by a real `/dev/shm` test;
  - anything else fails closed with a non-reset message.

  The x86-64 glibc `struct statfs` layout is correct: 120 bytes, `f_type` a long at offset 0, and
  only valid behind the x64 guard, as the comment says.
- **P3-2: closed** by the documented `_io` fd-lifetime invariant.
- **ACL ruling: test added.** A named-user ACL on the root is rejected. A default ACL is masked to
  0600 by the create mode.

## Carried to the hosted gate and follow-ups (non-blocking for this slice)
1. **The ACL test must run unskipped in hosted CI.** Make sure `acl` is installed on the Linux
   runner, and have CI fail if this test reports Skipped there.
2. **P3-1 (`libc` on a runtime-only image)** stays open for the hosted gate, as agreed.
3. **More filesystems for T11p.1:**
   - **ZFS (`0x2FC12FC1`):** Ubuntu offers ZFS-on-root. Linux ZFS supports only `acltype`
     off/posixacl, which the exact-mode check bounds. Add it to the allowlist after one real test.
   - **eCryptfs home (`0xF15F`)** and **overlayfs** stay unsupported. The T05 diagnostic copy names
     them.
4. **Composition must honour `IsVolatile`** when it is wired in, for example a "permissions reset
   at reboot" note, or refusing tmpfs outside tests.
