# T13 fix r1: acceptance evidence

Headless Linux (WSL2), Node v24.22.2 (`nvm use`), pnpm 11.17.0. Base `d294335`.

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0, "Already up to date"; `pnpm-lock.yaml` unchanged |
| `pnpm lint` (eslint + prettier, every package) | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm -r test` | exit 0: sdk 128/128 (9 files), dwt-compat 1/1, license-gate 10/10, ui 1/1, demo 1/1 |
| `pnpm build` | exit 0 |
| `pnpm format:check` | all files formatted |

SDK test count: 105 at `d294335` (100 passing plus 5 failing review proofs). Now 128: the 5 GPT r1 proofs in
`packages/sdk/src/review-r1.test.ts` pass **unchanged** (`git diff d294335 -- packages/sdk/src/review-r1.test.ts`
is empty), plus 23 new tests in `packages/sdk/src/fix-r1.test.ts`:

- r1 #1: renewal answered `401` after a restart, both in detection (reconnect) and in a non-job call;
  renewal answered `token-revoked`; renewal failing with a `TypeError` after the site is removed (R-A13).
- r1 #2: pruning drops only families that ended by time, never another client's live family.
- r1 #3: one new scan, one issuance, and one instance-recording `hello`.
- r1 #4: **20 create/dispose cycles** over one agent and one shared store. After each `dispose()`: no
  pending timers (`vi.getTimerCount() === 0`), the `abort` listeners added and removed balance out,
  the job registry is empty, and every later call rejects with `ZiloDisposedError`. Across the cycles
  there is one issuance and one consent request (the store is reused), and old instances never notify.
  Also: 20 cycles closed during pending consent, where a later grant causes no poll and no token; a
  token that answers after dispose is never stored; and `disconnect()` stops polling.
- r1 #5: the run deadline holds across repeated consent-poll failures.
- Triage #3: one `POST /auth/consent` per gesture (a re-probe uses `GET`); the install flow; the deadline.
- Triage #4, #5: `limits-exceeded` and unknown consent states become `auth-unavailable` with a typed
  cause and no token; `sdk-too-old` gets its own state.
- Triage #6: the resolution guards. Triage #7: unsupported queries give `unknown`, and the legacy
  name's answer is not acted on.

One existing expectation changed, as triage #4 requires: in `detection.test.ts`, the
`some-future-state` row now expects `auth-unavailable` instead of `consent-expired`. The row also
gained two assertions: the typed cause, and no token issuance.

Not run: native Windows, macOS, real browsers, hosted CI.
