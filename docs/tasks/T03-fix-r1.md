# T03 fix r1 (Claude author; effort medium)

**Inputs:**
- `docs/reviews/T03-r1.md` on branch `t03-review-r1` at `f30645e`, with 6 findings:
  - **high:** duplicate arm64 / stale apphost reused across cross targets;
  - **high:** Windows publish path resolved relative to the caller (`build-msi.ps1:22` Resolve-Path
    fails on the runner);
  - **medium:** uninstall deletes sibling `HKCU\Software\Zilo` keys;
  - **medium:** an AND-list around `rpm -V` masks failures;
  - **medium:** `osslsigncode` is unpinned in the workflow;
  - **high:** `bash | tee` gives a false green and hides missing artifacts. This made the macOS job
    of hosted run 41240014938 falsely green: `lipo` failed fatally because both inputs were arm64,
    and no pkg was produced.
- Hosted run 41240014938 @c00f066: Linux containers passed, Windows MSI failed, macOS was a false
  green. Keep the run logs as evidence and do not rerun it.

**Scope expansion (agreed by both masters, narrowly):** you may edit **backend RID publish metadata
only** (`RuntimeIdentifiers` in the agent csproj or the props), and regenerate the NuGet lock files
that this requires.
- No code, types or guard-test changes.
- Do not disable locked restore.
- Use real per-RID framework-dependent publishes, with **isolated `obj`/`bin` per target** (no
  cross-target reuse of the apphost).

**Steps:**
1. Merge the review commit first (`git merge --ff-only f30645e`, otherwise cherry-pick). If it added
   tests, they must fail before your fix.
2. Fix all 6 findings:
   - `set -o pipefail` everywhere, and explicit artifact-existence assertions after each step;
   - `lipo` gets a real x64 and a real arm64 input;
   - publish paths resolve from the script's own directory;
   - uninstall deletes only Zilo's own exact keys;
   - `rpm -V` failures propagate;
   - `osslsigncode` is pinned with a checksum.
3. WiX 5.0.2 stays a provisional dry-run tool. No decision on WiX 6+ or its EULA.
4. Verify locally on Linux: deb/rpm builds, the smokes, test signing, and the regenerated locks with
   `dotnet restore --locked-mode` for every RID.
5. Commit, then **push the branch once (OD-7)**. That push triggers the packaging workflow; do not
   trigger extra runs. In `worker_done`, report the SHA and the hosted run ID if one started.
6. Update `docs/spikes/SP-4a.md` with a "Fix r1" mapping, and correct the earlier macOS claim.

**Allowed files:** the T03 set, plus agent csproj/props RID metadata and `packages.lock.json` files.
Linux only (OD-6).
