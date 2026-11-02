# T12 P1 r2 — local evidence; exact-head hosted gate remains mandatory

Base: f5339b3adcd86ff6a96dd7d06995c21b4baee89c; actual HIGH footer verified by coordinator.
Failed hosted runs: 41396258842 (c351847), 41399053415 (e1e7f9c); downloaded logs/artifacts inspected.
No source, dependency, codec, global build, API/Core/SDK, workflow or Agent-wiring change.

## Root cause and red-first evidence
- Both RID assets select exactly ZXing.Net 0.16.11 `lib/net9.0/zxing.dll` for compile/runtime.
- zxing.dll bytes already match: SHA256 `2d9a1a3276fa21f5e20c0e8afa4ea33ca18fd6f984bd5b32ad457279e2709d73`.
- Virtual's differing strings are generated regex file-local type-name hashes; compiler inputs
  differ in isolated intermediate paths, not references/assets/source contents.
- RED independently built Virtual hashes: arm64 `29619604fee06ffc14ec4981ac93a24ae2c49903fb31fdcefe8690151820d676`,
  x64 `5a44c37bd55e398b44d54721fe12c9c21ebe017759528c7bc067c736c557c50d`.
- Single-variable path-map experiment made independently compiled Virtual binaries identical.
- Fix is a Virtual-project-only pre-CoreCompile mapping of ArtifactsPath, preserving SDK PathMap.
  With CI=true, both Virtual hashes are `4ad6fb7f9fd3d720c207ec3bcd470b0ee9e8fce7f5e0a48b4d247bb0a882ecf3`.
- `rid-evidence.log` records every original managed assembly plus zxing, assets and compiler diff.
- Linux RED: existing inspect script rejects hosted deb's extra zxing file; mode is 0744.
- Linux fix preserves the original full tree and overlays only zxing's mode with a single-file
  nfpm tree. Fresh deb contains 12 files, zxing root/root 0644, apphost 0755, directories 0755.
- MSI's explicit file list actually omits zxing; prior green smoke only ran the Agent scaffold.
  Added that file, a strict installed-file assertion and installed Virtual factory/PNG-QR proof.
- Proof compiles against installed Core/Virtual without copying them and checks actual loaded
  assembly paths and ZXing version. Removing zxing from a Linux extracted payload gives red;
  restoring it gives green. This is a proof-harness check, NOT hosted Windows acceptance.

## Local validation
- Locked Release solution restore/build: PASS, 0 warnings/errors; full tests 42/42 (28+7+6+1).
- Exact dependency audit PASS: only approved managed ZXing 0.16.11, no new native/image closure.
- Fresh nfpm 2.48.0 deb/rpm built; deb manifest/modes verified; bash syntax and diff checks PASS.
- Native rpm CLI unavailable locally; full existing rpm/security/install assertions remain hosted.
- `verify-rids.sh` preserves both independent RID outputs and compares all six DLLs.
- No hash comparison, determinism check, dependency/security assertion or original MSI check removed.

## Provenance / remaining gate
- Parent sole owner of diagnosis, Virtual fix, MSI amendments and final verification.
- Authorized exception: read-only explorer `ses_e6511bfa5ffeVCoaEbL500wvrq`, GPT-5.6 Luna,
  effort unknown; returned lock/audit evidence and hypotheses only.
- Authorized mechanical fixer `ses_e640859baffe8UKGNQUyvpmP6J`, effective model/effort unknown;
  Linux manifest/mode and publish lists only; parent narrowed its nfpm change to preserve full tree.
- No extra helpers/fanout, no Windows payload execution on owner host, no CI reruns/dispatches.
- Backend CI AND Packaging must be green on the exact pushed fix head before Claude r3;
  exact head/run links and hosted MSI load proof are reported separately after the push.
- T11's later runtime dependency amendment remains queue-owned and must be preserved at integration.
- Unsigned dry run only; no merge, production signing, notarization or hardware acceptance claimed.
