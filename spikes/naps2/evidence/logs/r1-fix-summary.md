# T02 r1 author fix handoff (2026-11-01)

- Branch: `AlexandreLozi/t02-fix-r1`; final pushed head is in the worker completion.
- Base: `7e09b609f3372a457fcd603b0778401a998db28e`.
- First operation: fast-forward `8895977055b019c31290dc7c814f4e3f42ecae3b`.
- `docs/reviews/T02-r1.md` remains byte-unchanged from that review commit.
- Reproduced the three original review regressions: 3 tests, 3 failures before fixes.

## Findings disposition

1. F1 fixed: removed worker interpretation/approval pin; generator explicitly skips it.
   Missing exact pin is now the Windows package denial; single-file/non-replaceable
   deployment remains an independent deny layer, not a waiver.
2. F2 fixed: wrapper rejects all eight denied package identities (case-insensitive),
   all exceptions and all reviewed payloads independently of gate outcomes.
   Sixteen pin/exception mutations retain the raw macOS pass but fail the wrapper;
   the existing hidden worker waiver fails the wrapper while raw Windows still denies.
3. F3 fixed: main-only push, no SP-2a doc trigger, manual/main-only native matrix,
   superseded-run cancellation and no PR/branch-push duplicate native jobs.
4. F4 fixed: exact hashed source files forced LF; autocrlf checkout regression passes
   and verifies the existing first-party policy hash without changing source bytes.
5. F5 fixed in evidence caveats: five LGPL DLL hashes match untrimmed nupkg entries;
   worker EXE is unsigned, signing changes bytes, worker.dll provenance unresolved.
   Corrected the two Windows projections to avoid claiming LGPL trimming.
6. F6 fixed: every action use pinned to SHA verified by official upstream tag refs;
   exact refs and SHA table recorded in SP-2a.
7. F7 documented: exact outcomes/counts/errors are asserted, evidence bytes are not;
   path-dependent first-party output hashes and deterministic-build work remain explicit.
8. F8 fixed: prose spacing; unsupported application-code owners deny even with an
   approved owner and reviewed payload, with regression and updated legacy expectation.

## Validation and limitations

- `r1-fix-gate-tests.log`: 66 passed (one new test; old permissive application-code
  expectation intentionally changed to default-deny).
- `r1-fix-spike-tests.log`: 23 passed (18 original + 3 reviewer + 2 author tests).
- `r1-fix-exact-outcomes.log`: five wrappers pass; raw exits 1/1/0/0/1;
  denial counts 3/2/0/0/14, package counts 28/28/27/27/32,
  payload counts 79/78/77/77/81 (Windows x64/arm64, macOS arm64/x64, Linux x64).
- Linux locked restore/Release build: SDK 10.0.403, zero warnings/errors.
- `r1-fix-workflow-lint.log`: actionlint 1.7.12 parses/lints workflow, exit 0.
- Locks, project/source and full package inventories unchanged; no five-RID
  cross-publish rerun was needed for policy/projection/workflow/doc-only changes.
- No hosted manual dispatch, unsigned Windows-host execution, GPL app code,
  new exception, planning/global config/model edit or helper was used.
- Initial validation caught two seeded-fixture schema mistakes and an obsolete
  permissive test expectation; corrected tests, then final affected suites passed.
- Cross-model Claude re-review is mandatory before merge; coordinator owns dispatch.
- Shipping graph and T06 remain **BLOCKED**; native Windows/macOS runtime pending.
