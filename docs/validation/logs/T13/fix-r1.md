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

## Fix r4 (r4 finding 1, P2): restart cleanup honours the run signal

Base `eaf410c` (fix r3 `1a84ea7` plus the r4 review). Files changed: `packages/sdk/src/auth.ts`,
`packages/sdk/src/client.ts`, a new test file `packages/sdk/src/fix-r4.test.ts`, and this log.

- **The finding.** `readFullHello` → `observeInstance` → `dropAllExcept` now carries the caller's
  signal (for detection, the run's signal). `dropAllExcept` and `dropFamily` share one guarded
  `dropWhere`. It calls `assertLive(signal)` (the client is not closed and the signal has not
  aborted) before it acquires the lock, again when the critical section starts, and again right
  before `store.write`. The signal also goes to `withLock`, so a queued section skips its callback.
  No credential write starts after the deadline or after `dispose()`.
- **Instance loss kept.** Jobs are still marked `agent-restarted` before the drop, and the lost
  listeners and `instance.changed` log still fire (now from a `finally`, so a deferred drop does not
  hide lost jobs). Renewal `401 token-invalid` still leads to `agent-restarted`, and the existing
  tests for that pass unchanged.
- **Deferred, not lost.** `observeInstance` removes the stale families from `familyInstance` only
  after the drop has landed. When the drop is skipped because the run aborted, they stay recorded
  under the old instance. The next live run's full `hello` sees them again and performs the drop.
  After `dispose()` this client never runs again. A later client over the same store drops those
  families through the normal R-A10 path, because their tokens get `401 token-invalid` from the
  restarted agent. The log now records `droppedFamilies` (0 when deferred) and `dropDeferred`.

### Audit: every await reachable from a run that leads to a credential-store write

| Path | Write | Guard |
| --- | --- | --- |
| `currentCredential` → `issue` / `renewIfDue` | `store.write` | `assertLive` before the lock (new), as the section starts, before each request and right after each answer; signal passed to `withLock` |
| `freshCredential` → `renewIfDue` | `store.write` | same (pre-lock `assertLive` new) |
| `withRecovery` / `readFullHello` → `recoverInvalid` | `store.write` | was signal-only. Now `assertLive` (adds the closed check) before the lock, as the section starts and right before the write |
| `readFullHello` → `observeInstance` → `dropAllExcept` | `store.write` | **was unguarded (the finding).** Now signal forwarded, and `dropWhere` guards before the lock, as the section starts and before the write |
| `withRecovery` `token-revoked` → `dropFamily` | `store.write` | **was unguarded**: `throwIfAborted` ran before it, but the lock wait and the write had no checks. Now the signal is forwarded through `dropWhere` |
| `afterTransportFailure` consent revoked → `dropAllExcept(undefined)` | `store.write` | **was unguarded.** Now the signal is forwarded through `dropWhere` |
| `afterTransportFailure` / `jobGone` → `checkInstance` → `currentCredential`, `readFullHello` | as above | signal forwarded already; covered by the rows above |
| `disconnect` → `revokeCurrent` → `dropFamily` | `store.write` | not part of a run (an explicit user call). Now guarded by the closed check through `dropWhere`, before the lock, inside it and before the write. The signal is not forwarded, so a revocation request already sent still drops its local entry |
| `hasUsableCurrent`, `familyCredential`, `revokeCurrent`'s read | read only | none needed (`hasUsableCurrent` already races the signal) |

`markRevoked()` still runs only after a successful drop. I tried calling it from a `finally`, but
an aborted, stale run could then stop its replacement, so I reverted that.

New tests (`fix-r4.test.ts`, 7):
- **Deferred drop.** Connect, plant an extra stored family of the old process, restart the agent,
  and hold the credential lock when the replacement token's full `hello` arrives. The run reaches
  its deadline, then the lock is released. The orphan is still stored. The next `connect()` reaches
  `ready` and drops it, leaving one family. This test also fails if stale families are forgotten
  before the drop lands (checked by mutation).
- **Every drop is guarded.** For `dropAllExcept`, `dropFamily` and `recoverInvalid`: a call on a
  closed client, a call disposed while queued behind the lock, a call with an aborted signal, and a
  call aborted while waiting for the lock. Each one rejects with `ZiloDisposedError` or
  `ZiloAbortError`, and the store sees no write.

Against the `eaf410c` sources, 6 of the 7 new tests fail, along with both r4 proofs. The one that
passes is `recoverInvalid`'s signal case, which already held.

Node v24.22.2, pnpm 11.17.0: frozen install (lockfile unchanged), lint, typecheck, `pnpm -r test`,
build and format:check all exit 0. SDK **159/159** (14 files), dwt-compat 1/1, license-gate 10/10,
ui 1/1, demo 1/1. All 12 review proofs (r1 5, r2 2, r3 3, r4 2) pass and are byte-identical to
`eaf410c` (blobs `0641aaf`, `d6d547d`, `acd050c`, `56f7a90`). No existing test changed. Not run:
browsers, native Windows/macOS, hosted CI.
