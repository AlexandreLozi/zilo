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

## Fix r2 (finding 1, P2): the overall deadline bounds every continuation

Base `db8ef93`. Change confined to `packages/sdk/src/detection.ts`:

- One deadline per run (`run.since` + `recheckCapMs`). `stopIfExpired()` runs after the probe
  resolves, after the token check (before `POST`/`GET /auth/consent`), before and after `authorize`,
  when a poll timer fires and after each `GET /auth/consent` answers. On expiry the run is aborted
  and the flow moves to `unreachable-stopped`.
- Consent polling, including the `429` backoff, never waits past the deadline: the last wait is
  shortened to end at it, then the run stops with no timer left.
- `unreachable-stopped` is now in `OUTCOMES`, so every active flow state (`checking`,
  `permission-prompt`, `unreachable-or-blocked`, `awaiting-consent`) may move to it.

Node v24.22.2, pnpm 11.17.0: frozen install (lockfile unchanged), lint, typecheck, `pnpm -r test`,
build and format:check all exit 0. SDK **130/130** (10 files): the two r2 proofs in
`review-r2.test.ts` and the five r1 proofs pass unchanged (`git diff db8ef93` is empty for both).
dwt-compat 1/1, license-gate 10/10, ui 1/1, demo 1/1. Not run: browsers, native Windows/macOS, hosted CI.

## Fix r3 (r3 findings 1–3, P2): one run model for the deadline, in-flight work and ownership

Base `6b6134a`. Changes are limited to `packages/sdk/src/` (`detection.ts`, `auth.ts`, `credentials.ts`,
`client.ts`, `transport.ts`, new `abort.ts`), plus the new `fix-r3.test.ts`.

- **One model.** Each detection run owns an `AbortController`, one deadline timer armed at
  `since + cap` that stops the run and aborts its signal, and its identity: the run object held in
  `Detector.run`. Every way a run ends goes through `end()`, which aborts the signal, clears that
  run's own deadline timer and wait, and releases ownership: deadline, `cancel()`, replacement by
  `start()`, settling in a non-active state, `markRevoked()` and `dispose()`/`disconnect()`. A
  settled run (`ready`, etc.) keeps no timer.
- **r3 #1, in flight.** Every awaited step (permission query, probe, token check, `authorize`,
  consent `POST`/`GET`) gets the run's signal and is awaited through `step()`. That rejects as soon
  as the signal aborts, so a step still pending at the deadline is abandoned. `hasToken(signal)` is
  now in `DetectionDeps`. `CredentialStore.withLock(origin, fn, signal?)`: the memory store rejects
  an aborted waiter at once and never runs its `fn`. The auth client checks the signal as each
  lock section starts and before every token request and credential write, and `withRecovery`
  starts no recovery step after an abort. The transport drops an answer whose caller aborted while
  the body was read. The write that records an issued token follows its answer with no await in
  between, so an abort can drop a token the agent already minted, but it can never cause a second
  issuance (r3 proof 1: issuance stays at 1).
- **r3 #2, boundary.** A single helper, `expired(run, at)`, applies `at >= deadline`. At the
  deadline the run starts nothing. A re-check or poll wait (including the `429` backoff) that would
  end at or after the deadline is not armed, and the deadline timer stops the run at exactly the
  cap. A re-check that runs out of time therefore stops at the cap, no longer one interval early.
- **r3 #3, ownership.** `live(run)` checks ownership first, then the deadline. It runs right
  before each side effect and after each await. `stopAtDeadline` is a no-op for a run that no
  longer owns the detector, so a stale run cannot change state or stop its replacement.

New tests (`fix-r3.test.ts`, 17, all fake timers):
- The deadline fires during each pending step: the token read, `authorize` waiting on the
  credential lock, `authorize` reading the full `hello`, the consent `POST`, a consent `GET`, and the
  `429` backoff. Each test checks that the state holds at cap − 1 ms and is `unreachable-stopped`
  at the cap, that no timers are left, and that after a late release no request is made, no token
  is issued and nothing is written to the store.
- `dispose()` during the same six steps: `start()` settles, no timers are left, abort listeners
  balance, and nothing is notified, requested, issued or stored afterwards.
- The A → B → C chain: A's and B's token reads answer late, one before its deadline and one after.
  C stays `awaiting-consent` and makes no token request. C still stops at its own cap, once.
  `cancel()` clears the run's deadline. A settled run keeps no timer.
- The deadline is exclusive: no re-probe at the cap itself (rounds at 0, 2 and 4 s with a 6 s
  cap), and a consent answer that arrives exactly at the cap is ignored.

Against the `6b6134a` sources, 10 of the 17 new tests fail. The other 7 guard behavior that
already held.

Node v24.22.2, pnpm 11.17.0: frozen install (lockfile unchanged), lint, typecheck, `pnpm -r test`,
build and format:check all exit 0, as does `git diff --check`. SDK **150/150** (12 files).
dwt-compat 1/1, license-gate 10/10, ui 1/1, demo 1/1. The 10 review proofs (r1 5, r2 2, r3 3) pass
and are byte-identical to `6b6134a` (blobs `0641aaf`, `d6d547d`, `acd050c`). No existing test
changed. Not run: browsers, native Windows/macOS, hosted CI.
