# T04b-V — native evidence for T04b on the rebased SHA (Claude worker, OD-2; evidence only)

**Target:** queue branch `q/t04b` at SHA `7284a3b`. That is T04b author SHA `7624bfa`, rebased onto
`main`; the rebase added only docs and config changes. Your worktree is based on it.

**Read first:** `docs/planning/DECISIONS.md` D-010, D-010a and D-010b;
`docs/planning/OWNER-DIRECTIVES.md`; the backend CI workflow `.github/workflows/ci-backend.yml`
(the steps you reproduce); and the earlier GPT attempt on branch `t04b-native-validation` (read it
with `git show`/`git log`; do not merge it).

**Change (evidence only, no code edits):**
1. **Linux (WSL), native:** reproduce the `ci-backend` steps on this SHA: locked restore, Release
   build, `dotnet test`.
   - Use the pinned SDK from `global.json`, installed task-private (official tarball with its SHA-512
     verified, under a scratch dir, no global install).
   - Save a redacted log to `docs/validation/logs/T04b/linux.log`.
2. **Windows, native on the WSL host:**
   - Make a Windows-side clone of this SHA. Clone from the WSL path into
     `C:\Users\<user>\zilo-t04bv`, because cmd can't use a UNC cwd.
   - Use the official .NET SDK **zip** (verify its SHA-512) extracted into a task-private dir such as
     `%LOCALAPPDATA%\zilo-tools\t04bv\dotnet`. Invoke it by full path.
   - **Do NOT run `dotnet-install.ps1`.** Do not change ExecutionPolicy, use `-Bypass`, unblock
     files, sign anything or change trust. Respect host Application Control.
   - Run locked restore, then Release build, then tests. If test DLL loads are blocked by Application
     Control (0x800711C7 or similar), stop there: that is the D-010a policy-blocked state.
   - Save a redacted log to `docs/validation/logs/T04b/windows.log`. Include the exact denial lines.
3. Write `docs/validation/T04b.md`: the SHA, commands, tool versions, and each row's verdict:
   - `local-linux`: pass or fail;
   - `local-windows-build`: pass or fail;
   - `local-windows-runtime`: pass, fail or pending (policy-blocked);
   - `macos`: pending;
   - `hosted`: pending.

**Redaction:** remove usernames and home paths where practical. Never include tokens.

**Allowed files:** `docs/validation/**` only. Commit on your branch. Do not push or merge.

**Observable acceptance:** the logs and `T04b.md` exist and match the commands run. The verdicts are
honest; a pending row is never written as pass.
**Effort budget:** medium. If something unrelated to policy blocks you for more than ~20 minutes,
record it as pending with the reason and finish.
