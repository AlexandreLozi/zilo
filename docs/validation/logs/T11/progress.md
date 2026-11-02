# T11 evidence ledger

Plan: `docs/tasks/T11.md`; base `add1d73` (frozen Core handoff).

## Preflight

- Coordinator verified actual GPT-6.1 Sol HIGH footer before substantive work.
- Task 1 composition is consumed by Tasks 2–4; auth state remains separate from transport.
- Discovery owns refresh/coalescing in the frozen Core backend; HTTP owns authorization and bounds.
- No production driver edits; empty discovery is intentional pending T12 integration.
- Port choice and IANA evidence: `ports.md`; tuple sent to coordinator immediately.

## Evidence path and ownership

- Backend lane: test-first Security state tests with fake clock/native-consent seams; real Kestrel
  HTTP integration tests for guard ordering, JSON/CORS/auth/discovery and port fallback.
- CI/package lane: bounded self-test invocation and syntax/workflow validation; preserve installer checks.
- Parent: final locked restore, Release build, complete tests, bounded self-test, contract check,
  workflow lint, diff whitespace check and exact-result evidence reconciliation.
- Stronger remaining gate: independent Claude HIGH review and exact-resulting-SHA hosted star CI.
- No native Windows execution on SAC host; no scanner/browser/cross-OS runtime claims from Linux tests.

## Progress

- Implementation and CI/package scopes dispatched independently with non-overlapping ownership.
- Contract check launched against unchanged normative API files.
- Contract check passed: 60 tests, 60 pass, 0 fail; Redocly lint and generated 2518-line
  TypeScript surface compile under both pinned compiler versions.
- Masters approved a narrow packaging exception through coordinator ask: add ASP.NET Core
  runtime dependencies and metadata/installed-runtime assertions, retaining .NET/SANE checks.
- CI/package syntax: bash -n passed; actionlint 1.7.7 passed (temporary custom runner config
  for pre-existing macos-15-intel label); pinned yaml@2.8.1 parsing passed.
- Native package installs and PowerShell parsing/execution not measured on this Linux host.
- Initial backend slices were NOT acceptance evidence: parent found missing security invariants.
- Read-only author risk triage identified GET eviction, stale prompts, revoked-history bounds,
  fractional deadlines, LRU status and asynchronous authorization; focused corrections added tests.
- Final integrated tests: Agent21 + Core7 + Scaffold6 =34 passed, none failed/skipped.
- Final locked restore/Release build/self-test/actionlint/bash syntax/diff checks passed; see logs.
- Coordinator confirmed T11p persistent-consent split and HOLD T11 merge pending R-A6.
- Gate remains CLOSED for persistence, final atomic issuance/removal race and remaining matrix;
  `report.md` is the authoritative partial checkpoint, not an acceptance claim.
