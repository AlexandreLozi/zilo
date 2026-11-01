# T11a fix r1 — documentation evidence

- Base: `cf58cd711a42c2b361db5dcbbebf4313a0045ff3`.
- Branch: `AlexandreLozi/t11a-core-contracts`.
- Coordinator verified actual GPT MEDIUM footer before substantive work.
- Review read from `cc70a0d:docs/reviews/T11a-r1.md` (not copied into this branch).
- Scope: only this log and `docs/tasks/T11-interface.md`; no source, tests, API,
  schema, guards, config, or skip-worktree configuration changes.

## Required findings

- F1: shared typed failures now cover every interface method, including pre-page
  acquisition, with `PagesKept = 0` outside streams and cancellation kept as
  `OperationCanceledException`; table distinguishes route lookup, busy, device
  loss, timeout, unsupported capability, invalid settings, and runtime limits.
- Discovery driver timeouts preserve cached devices and populate
  `Discovery.IncompleteDrivers`, not a blanket timeout exception.
- F2: refinement whitelist is resolution/colorMode/pageSize/pageSizeMm;
  Source/MaxPages invariant, source capabilities and device/acquisition bounds
  mandatory, typed failure on violation, per-page actual metadata authoritative.
- Driver scalar adjustments use prior effective Requested and device-applied;
  T11 rewrites publication to original requested value (null when omitted).
- Coordinator explicitly confirmed dimensions-only reconciliation: PageSizeMm
  travels in AppliedSettings only; no object adjustment/new field convention;
  existing scalar pageSize adjustment only on ID changes; publish full effective
  snapshot before page even for dimensions-only changes. Opus must review this.
- Optional F3/F4/F7: outbound capability validation owner, nonstructural array
  equality, configured refresh bound, and upper-owner Busy overlay clarified.
- F5 shape and F6 guard unchanged; no wire/API amendment.

## Verification and limits

- Compared handoff against exact base Core Acquisition/Capabilities/Discovery/
  IScanBackend sources and T10 api/CONTRACT.md R-J5–R-J8, error table; checked
  api/openapi.yaml refreshDevices/getDeviceCaps, Adjustment scalar schemas.
- `git diff --check`: passed; scoped diff contains only the two allowed docs.
- Base Core/API source unchanged; no restore/build/test rerun for docs-only fix.
- Existing review evidence remains 14 passed tests; no new execution claim.
- Native Windows, hardware, HTTP integration and downstream implementations
  remain unvalidated; no helpers used.
- Mandatory independent Claude Opus re-review and Opus merge remain outstanding;
  T11/T12 stay blocked until merged.
