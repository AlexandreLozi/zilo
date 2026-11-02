# macOS consent storage — authored checkpoint, Darwin validation PENDING

- Base: `780337df31d3ab79e41d444a73f7b83840389c47` (Linux r2 slice PASS, not T11p PASS).
- Locally compiled/tested code: `8180878e0b45d9db4784276bbfddac6353d5ddae`.
- Same sole GPT HIGH author; actual footer independently confirmed in `msg_f4f6c231e699`.
- Scope: MacConsentDirectory plus scoped guard/native tests; Linux adapter and shared seam unchanged.
- NO Windows/auth/Token/Agent/ConsentStore/reset/lifecycle work, dependency/workflow or main changes.

## Authored native protocol (not executed on this Linux host)

- Pre-native-entry guard permits only macOS ProcessArchitecture.X64/Arm64; all other targets fail.
- Darwin open flags, AT_FDCWD=-2 and AT_SYMLINK_NOFOLLOW=0x20; retained component-by-component
  O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC walk, mkdirat0700, no production resolver or ancestor chmod.
- fstat/fstatat use Darwin STAT64 (144bytes: dev0,mode4,nlink6,ino8,uid16,size96), not Linux statx.
  x64 entrypoints are `fstat$INODE64`, `fstatat$INODE64`, `fstatfs$INODE64`; arm64 unsuffixed.
- fstatfs uses Darwin STATFS64 (2168bytes:flags64,fstypename72); only writable MNT_LOCAL APFS/HFS
  without MNT_IGNORE_OWNERSHIP qualify. IsVolatile=false for these candidates, not a hardware proof.
- Current-euid root0700/files0600, regular type/single-link, device/inode name identity checks;
  retained nonblocking flock; bounded snapshot4MiB/marker24byte reads and validated write inputs.
- Extended root/file ACLs are rejected even when mode bits look private. acl_get_fd_np(EXTENDED)
  buffers are freed; only documented fd-ACL absence ENOENT or valid empty ACL qualifies. Darwin
  acl_get_entry returns0 for an entry and -1/EINVAL for end, unlike Linux's1/0 convention.
- Exclusive private nofollow temp → write → fsync(temp) → fcntl(F_FULLFSYNC) → anchored renameat →
  fsync(root) → fcntl(F_FULLFSYNC) → identity/privacy rechecks. Startup also requires lock/root flush.
- **STRICT** joint clarification `msg_107ba8db1f0d`: ANY required fullflush failure, including ENOTSUP,
  fails unavailable/poisons ownership; NO fallback/degradation flag. Root directory support is not
  inferred from filesystem name: hosted APFS must demonstrate both actual calls succeed. Otherwise
  report unsupported/blocked, never weaken protocol or infer power-loss durability.
- Private _io monitor covers native descriptor lifetime and Dispose, never authorization monitor.

## Local evidence and hosted handoff

- `guard-red.log`:15 behavioral assertion failures before guard implementation.
- `local-targeted.log`:15 pure guard tests PASS;11 Darwin-native cases explicitly SKIPPED on Linux.
  These do NOT validate Darwin flags/ABI/ACL/locks/flushes or native x64/arm64 compatibility.
- Native cases authored for private modes/spaces, clean reopen, retained lock, symlink/root swaps,
  real chmod+a "everyone allow read" root/file ACL rejection, bounds, successful flush ordering,
  and separately labelled simulated failure at EACH required temp/root fullflush checkpoint.
- Test fixtures alone use realpath to avoid Darwin /var and /tmp aliases; production remains strict
  nofollow with actionable diagnostic. Tests do not add production symlink resolution.
- Pinned SDK locked restore PASS, Release build0 warnings/errors; final full suite run once:
  **246 passed,12 skipped,0 failed** (11 Darwin skips+existing unavailable Linux setfacl skip).
  `restore.log`, `build.log`, `suite.log`; staged diffcheck PASS; absolute workspace paths redacted.
- Existing ci-backend matrix runs all scoped tests on macos-latest and macos-15-intel, with TRX
  artifacts; sufficient without workflow edits. Final push may trigger this existing push workflow:
  coordinator/Opus own exact-head run ID and artifact validation; do NOT dispatch a duplicate run.
- Hosted run IDs/results: **PENDING**; author has not dispatched a workflow or claimed native PASS.
- Independent Claude HIGH review and actual hosted Darwin execution are mandatory before slice PASS.
- Carry-forwards: Linux IsVolatile composition, real ACL/runtime-only libc gate, T11p.1 symlink
  support before M6; Windows/auth/recovery/lifecycle/full T11p/T14 acceptance remain HELD.

## Native source references consulted (Apple authoritative declarations/implementation)

- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stat.h
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/mount.h
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/cdefs.h
- https://github.com/apple-oss-distributions/Libc/blob/main/include/sys/acl.h
- https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_file.c
- https://github.com/apple-oss-distributions/Libc/blob/main/posix1e/acl_entry.c
- https://github.com/apple-oss-distributions/Libc/blob/main/gen/filesec.c
