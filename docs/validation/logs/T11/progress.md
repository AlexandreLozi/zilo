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
