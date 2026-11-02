# Linux consent storage — Claude r1 fix authorship, r2 pending

- Base: `085ba8f0dcc3c1e63b2deb9f0d11ec1a02462147` on existing integration branch.
- Reviewed findings: `e4eccd6:docs/reviews/T11p-linux-r1.md` (CHANGES).
- Tested code: `cf621b9e4ace5688ab5fdf33bfaa87810ceb66ec`; next commit is report-only.
- Same sole GPT HIGH author, actual HIGH previously confirmed; no helpers/config changes.

## Disposition

- P1-1: Open's first operation is the pure Linux+ProcessArchitecture.X64 guard, before constructor
  geteuid or any native syscall. All other platforms/architectures fail closed with
  `consent-linux-x64-only`. Negative ARM/ARM64/X86/S390x guard tests are NOT native ARM evidence.
  Flag/stat/statfs constants/layout comments identify the x86-64 UAPI/glibc headers.
- P2-1: approved option(b), strict nofollow and explicit unsupported-symlink-ancestor diagnostic;
  regression models `/home` symlinks and proves no redirected child creation. T05 copy/handoff and
  **T11p.1 before M6 tester builds** are tracked in `../linux/report.md`; no resolver implemented.
  Affected ostree/Silverblue state paths cannot load user consent/prompts when composed; separately
  validated baked authority remains independent. No general distro-compatibility claim.
- P2-2: reject0775 ancestors, preserve their mode, diagnose cause and trusted remove-group/other-
  write remediation. No autochmod, group membership lookup or private-primary-group assumption.
- P2-3: fstatfs of the retained root descriptor before lock/state-file creation; allow0xEF53
  (ext4-family/shared ext2/3 magic),xfs,btrfs,f2fs,tmpfs; reject every other magic. fstatfs is not an
  ext feature probe. Pure tests cover network/FUSE/ZFS/overlay/unknown rejection, not actual mounts.
  Real `/dev/shm` test observes accepted tmpfs and IsVolatile=true; tmpfs has NO reboot durability.
- P3-2: comment records _io versus Dispose/handle lifetime and exclusive unpublished Open ownership.
- P3-1: runtime-only libc resolution stays a hosted gate, no workflow change or billed run.
- ACL ruling: real named/default POSIX ACL test added, conditionally skipped with a reason because
  `/usr/bin/setfacl` is unavailable locally. **Not passed ACL evidence**; no tool install/dependency.
- Threat model: admin/root and same-user malware are excluded, not a privileged-ownership blocker.
  Injected pre-syscall errno/acknowledgement faults remain simulated; earlier subprocess kills are
  actual process-crash evidence, not hardware power-loss proof. No need to repeat prior runs.

## Validation on local Linux x64

- `red.log`:12 genuine behavioral failures (guard/diagnostic/unknown-filesystem assertions),6 passes.
- `green.log`:44 targeted passes,1 explicit ACL skip,0 failures; includes existing25 native tests.
- Pinned `/tmp/opencode/t12-proto-r2/sdk/dotnet restore backend/Zilo.slnx --locked-mode`: passed.
- Release build `--no-restore`:0 warnings/errors (`build.log`).
- Full solution test once after code changes, Release `--no-build --no-restore` with locked restore:
  **231 passed,1 skipped,0 failed** (Agent190+1skip,Virtual28,Core7,Scaffold6); `suite.log`.
- `git diff --cached --check`: passed; logs redact the absolute workspace path.
- No Windows/macOS/auth/Agent/recovery/UI work, new dependencies, workflows, hosted CI or main writes.
- Independent Claude r2 is REQUIRED before slice acceptance; broader T11p integration, other OS and
  exact-SHA three-OS/lifecycle/review gates remain held. This is not T11p completion or full T11 PASS.
