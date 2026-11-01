# T02 review r1 (Claude reviewer, cross-model; effort high)

**Target:** branch `t02-naps2-spike` at head `7e09b609f3372a457fcd603b0778401a998db28e`. GPT
authored it. Review the **entire task diff** against main (`git diff main...7e09b60`), including the
integrated licence-gate helper (`tools/license-gate/**`).

**Read first:**
- `docs/spikes/SP-2a.md`. Its scope is evidence and tooling only.
- DECISIONS D-001, D-002, D-010, D-010a, **D-010b** (negative-feasibility spikes) and D-011.
- `docs/planning/OWNER-DIRECTIVES.md` (OD-6).
- The T02-related entries in `docs/planning/DISCUSSION.md`: the Worker.Win32 bundle, Gtk licence
  metadata, ICA missing from the generic SDK.

**Check:**
1. **Scope:** only `spikes/naps2/**`, `tools/license-gate/**`, `.github/workflows/spike-naps2.yml`
   and `docs/spikes/SP-2a.md` (plus any evidence logs) changed.
2. **D-010b exact-denial wrapper:**
   - The workflow passes only when the gate produces **exactly** the expected denials (Windows
     worker bundle, Linux Gtk graph, and so on).
   - It must **fail** on an unexpected pass **and** on new or extra denials.
   - Prove it with seeded mutations.
3. **Licence gate:**
   - default-deny semantics;
   - per-package and per-native-payload licence detection;
   - metadata pins;
   - producer and provenance completeness;
   - exception handling: there must be **no** waivers or allowlist entries for the denied items.
4. **Evidence claims:**
   - the immutable source, bundle and PE proofs: hashes, the claim that the generic SDK has no Apple
     driver or macOS reference, and the Worker.Win32 single-file/trimmed bundle analysis;
   - the 5-RID locked cross-publishes;
   - the 65 gate tests and 18 spike tests;
   - the expected raw exit codes `1/1/0/0/1`.

   Reproduce them on Linux where possible. **Never execute Windows binaries natively (OD-6)**; static
   PE inspection is fine.
5. **CI platform assumptions** in `spike-naps2.yml`: runners, pinned SDK, locked restore,
   actionlint/YAML.
6. **Security and hygiene:** no secrets, downloads verified by checksum, no network fetches without
   pins.

**Allowed writes:** only `docs/reviews/T02-r1.md`, plus new failing tests that prove a defect. Do
not fix code.

**Output:** a verdict of `pass` or `changes` with numbered findings (severity, file:line, evidence),
then `worker_done`.
