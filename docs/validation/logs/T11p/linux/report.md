# T11p Linux native storage slice — author evidence, review pending

- Base: `1e3fc3d849cb9ab1dd5a9a46fc6bb0b6d404427d`, clean integration branch.
- Tested code commit: `62b8f090ba1b84e4eda97316d15fea57d33babcc`.
- GPT HIGH footer confirmed by coordinator `msg_76d0db3efd76`; sole writer, no helpers.
- Scope: internal `LinuxConsentDirectory : IPrivateConsentDirectory` and Linux tests only.
- No ConsentStore/Token/Agent wiring, recovery/UI, OS session lifecycle or contract changes.
- No packages, lock changes, workflows, hosted runs, main writes or Windows-host execution.

## Implemented primitives

- Absolute XDG state root or absolute-home fallback resolver; no environment/test mutation.
- `openat(O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)` component walk with retained descriptors.
- `mkdirat(0700)` for missing components; fsync parent; never chmod existing ancestors/root.
- Linux UAPI `statx(AT_EMPTY_PATH)` on actual handles, not architecture-specific glibc stat.
- Current-euid root0700/files0600, regular type/single-link checks, no symlink following.
- Ancestors require root/current-euid ownership and no group/other write, except root-owned sticky
  shared ancestors; root/name inode+device identities are rechecked through retained parent handles.
- Retained private `consent.lock` with `flock(LOCK_EX|LOCK_NB)`, revalidated during operations.
- Exact byte reads bounded before allocation (snapshot4MiB, marker24bytes), detect length changes.
- Encode-input validation, exclusive nofollow0600 temp, write, fsync(temp), anchored renameat,
  fsync(root), resulting identity/privacy rechecks; failure poisons adapter and preserves evidence.
- New snapshots/markers use fixed approved names; stale temp/quarantine artifacts prevent fresh boot.
- Disposal closes handles/releases flock, never unlinks evidence or marks a dirty session clean.
- Private serialization monitor only; adapter has no authorization-monitor or HTTP dependencies.
- Native methods execute synchronously on the future owned persistence worker; do not call from auth.
- Non-Linux invocation throws PlatformNotSupportedException; no Windows/macOS success stubs.

## Evidence and limits

- `red.log`: initial11 behavioral failures, followed by native implementation; no compiler-red claim.
- `path-red.log`:3 resolver assertion failures; other added attack tests were conformance checks.
- `green.log`:25 targeted tests passed on local Linux,0 failed/skipped.
- Real filesystem:0700/0600, unsafe root/file modes, root/ancestor/snapshot/lock symlinks, hardlink,
  oversize, XDG fallback, actual competing flock, lock/target/temp/root swaps and clean reopen.
- Foreign-owned root rejection uses real root-owned `/proc`; no isolated foreign-chown fixture or
  sudo/owner-host permission changes. Extended POSIX ACL masking is not separately exercised.
- Real child-process kills at three write checkpoints (before file fsync, after file fsync before
  rename, after rename before directory fsync) leave DIRTY and allow lock reacquisition after exit;
  reopen returns unavailable with no hydrated grants. This is process-crash, not power-loss proof.
- Three additional fault callbacks throw before actual syscalls: these are simulated write/flush
  acknowledgements, NOT observed kernel fsync/rename errno failures or physical-disk faults.
- Pinned SDK `/tmp/opencode/t12-proto-r2/sdk/dotnet`: locked solution restore passed (`restore.log`),
  Release build0 warnings/errors (`build.log`), full suite212 passed0 failed/skipped (`suite.log`:
  Agent171,Virtual28,Core7,Scaffold6); full suite run once after final code changes.
- Staged diffcheck passed; generated logs replace the absolute workspace with `<workspace>`.
- Actual platform evidence is local Linux x64 only; no native macOS/Windows/arm64 evidence.
- Remaining: independent Claude review; privileged ownership/ACL and actual disk-error matrices;
  other OS adapters; production bounded coordinator/auth composition and monitor/race proof;
  trusted reset/quarantine; HTTP restart and OS session/installer drain; hosted three-OS exact-SHA
  CI, combined review/Opus gates. This storage-slice result is NOT T11p completion or full T11 PASS.

## Claude r1 fix / T05 handoff and tracked product limitation

- Review `e4eccd6:docs/reviews/T11p-linux-r1.md` required CHANGES; follow-up evidence is in
  `../linux-r1/report.md`. Native adapter is now deliberately **Linux x64 only**, before any syscall.
- Strict nofollow option(b) remains: symlinked home/state ancestors, including affected Fedora
  Silverblue/ostree paths, are unsupported; user consent cannot load and prompts stay disabled
  when this adapter is composed. Separately validated baked authority remains independent; this
  slice neither wires it nor promises broader distro compatibility.
- **T11p.1 — REQUIRED BEFORE M6 tester builds:** implement bounded, validated root-owned symlink-
  ancestor resolution option(a), then obtain independent Claude review. Not implemented here.
- T05 diagnostic `consent-symlink-ancestor-unsupported`: explain the symbolic-link ancestor and
  offer a supported absolute XDG_STATE_HOME using real directory ancestors or trusted maintenance;
  never automatically resolve links, reset permissions, or suggest enabling prompts on failure.
- T05 diagnostic `consent-ancestor-writable`: explain group/other-write on state-path ancestors;
  trusted maintenance can remove those write permissions. Never autochmod or assume a primary
  group is private. The0775 regression verifies refusal without changing existing mode.
- T05 diagnostic `consent-filesystem-unsupported`: move state through trusted maintenance to a
  supported local filesystem, not NFS/CIFS/FUSE/unknown ACL models; do not reset saved permissions.
- tmpfs is allowed for local process-crash semantics but is volatile: no reboot/power-loss retention.
- Reviewer rulings supersede the earlier pending-matrix wording: admin/root and same-user malware
  are outside D-013 threat model; real kernel errno faults are not this slice's acceptance bar.
  Simulated pre-syscall fault acknowledgements and actual process kills remain distinct evidence.
- Runtime-only libc resolution remains a hosted gate; no new workflow or billed CI was requested.
