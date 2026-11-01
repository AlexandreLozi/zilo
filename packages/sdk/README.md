# @zilo/sdk

Zilo JS SDK core (ESM, framework-agnostic TypeScript, no runtime dependencies). It talks to the
local Zilo agent over the `/zilo/v1` contract (`api/openapi.yaml`, `api/CONTRACT.md`).

## What is here (T13)

- **Detection** (`Detector`, D-008): an explicit state machine whose states are the T05 detection
  states (`docs/design/detection-dialogs.md` §2): `checking`, `permission-prompt`, `denied`,
  `unreachable-or-blocked`, `unreachable-stopped`, `outdated`, `awaiting-consent`,
  `consent-expired`, `unauthorized-origin`, `consent-denied`, `consent-blocked`, `rate-limited`,
  `outdated-authorized`, `token-revoked`, `insecure-origin`, `safari-unsupported`, `ready`, plus
  `idle`. Allowed moves are in `TRANSITIONS`. The Safari bridge and self-update states belong to
  later tasks (T25, the updater). Two SDK states have no T05 copy yet; the UI shows a safe generic
  message for them until T05 adds it:
  - `sdk-too-old` (`fit.reason: sdk-too-old`): the agent only speaks a newer protocol. The fix is
    an update of the site or app (its SDK), never of the agent. `outdated` is only for an agent
    that is too old or misses capabilities.
  - `auth-unavailable`, with a typed `cause`: an unknown consent state (`consent-state-unknown`,
    R-A2 "not usable yet") or a real `limits-exceeded` (for example the family bound, R-A9). An
    unknown state is never shown as `consent-expired`, a resource bound never as `rate-limited`,
    and neither leads to a token request.
- **Permission query** for `loopback-network`, with `unknown` wherever the query is unsupported
  (never `denied`). The older Chromium name `local-network-access` is queried as a fallback, but
  it is **unverified**: no browser evidence yet shows it guards the same loopback access (T01 /
  SP-1a). Its answer is only a `permissionHint`; detection never stops on it.
- **HTTP transport** (`HttpTransport`): fetch to `http://127.0.0.1:<port>` with
  `targetAddressSpace: 'loopback'`, bounded timeouts, caller abort, bearer header only, typed
  errors (`ZiloProblemError` for every §9 code, unknown codes as `unknown`), and redacted debug
  logging (operation names, status, codes and timings only).
- **Auth** (`AuthClient`): public `hello`, `POST /auth/consent` (only from `connect()`, which must
  run in a user gesture), polling `GET /auth/consent`, `POST /auth/token`, renewal that keeps the
  family, the R-A15 rollover rule and per-job family selection. Credential acquisition and renewal
  run inside the same recovery path as the protected request: a renewal answered `401
token-invalid` (for example after an agent restart) re-reads storage, re-acquires, reads the
  full `hello` and reports `agent-restarted`; `token-revoked` and transport failures of a renewal
  take the R-A12 / R-A13 paths. A new scan selects its credential once, so it rolls over at most
  once.
- **Devices and caps** with unknown-field and unknown-enum tolerance. `isResolutionList()` and
  `isResolutionRange()` are runtime guards for the known kinds (the generated `ResolutionUnknown`
  overlaps them, so TypeScript cannot narrow on `kind`); `resolutionChoice()` applies R-D4's
  default-only fallback to anything else and never casts an unknown payload to a list or range.
  `refreshDevices()` uses the `DeviceList` that `POST /devices/refresh` returns after discovery,
  without a second `GET`, and keeps its incomplete-driver and timeout fields.
- **Lost session** (§12): the full `hello`'s `instanceId` is recorded per family before the first
  job; on a change, tracked jobs become the SDK-local outcome `agent-restarted`
  (`ZiloAgentRestartedError`, retryable, never rescanned automatically) and `onJobsLost` fires.

```ts
import { ZiloClient } from '@zilo/sdk';

const zilo = new ZiloClient();
zilo.onState((s) => render(s)); // drive <zilo-connect-dialog>
scanButton.onclick = async () => {
  const s = await zilo.connect(); // user gesture: the only path that can prompt
  if (s.state === 'ready') render(await zilo.listDevices());
};
```

## Lifecycle

- `connect()` starts one detection run per user gesture. A run sends `POST /auth/consent` at most
  once; a later re-probe of the same run reads the state with `GET`, which never prompts. The
  re-probe only continues the same user-opened install flow while its dialog is shown and within
  the run's overall deadline (`recheckCapMs`, 5 min), which auth and consent retries never reset.
  The agent coalesces prompts and the denial cool-down ends the run; the SDK never retries consent
  on its own, never probes at startup, and never infers consent from visibility.
- `detection.cancel()`: the dialog was dismissed. Stops the re-check and consent polling.
- `disconnect()`: cancels detection, then revokes the current family (`DELETE /auth/token`). The
  instance stays usable.
- `dispose()`: full teardown for the host's Unload, which the owner's app runs on every dialog
  close (and for navigation away). It cancels detection, aborts every in-flight request, drops all
  subscribers and the local job registry, and makes every later call fail with
  `ZiloDisposedError`. A grant that arrives afterwards never makes the instance issue or store a
  token. It is idempotent and does not revoke: give the next instance the same `CredentialStore`
  and it reuses the family without a new issuance (the issuance budget is 20 per hour).

## Notes

- **No "not installed" state.** No browser signal proves that the agent is absent rather than
  stopped or blocked, so detection says `unreachable-or-blocked` (D-008, T05).
- **Ports** `48100`–`48102` (`DEFAULT_PORTS`) are a placeholder until T11 publishes the shared
  fixed-plus-two-fallbacks tuple; the SDK then takes that tuple, never its own constants.
- **Jobs are tracked per SDK instance.** Shared-storage job association and cross-tab job recovery
  are T21's; this package does not claim them.

## Credential storage

The default `MemoryCredentialStore` keeps tokens in memory for one SDK instance: nothing outlives
the page, nothing is enumerable by other pages, but tabs do not share jobs (each tab holds its own
family). To share jobs across tabs (R-A15), pass a `CredentialStore` over storage shared by the
app's same-origin tabs, with cross-tab mutual exclusion (for example the Web Locks API). Any
same-origin script (an XSS) can read such tokens; never persist one beyond its `familyExpiresAt`.

A client cannot see the jobs of other clients that share a store, so it never removes a live
family entry when it starts a new family: it prunes only entries that provably ended by time
(`familyExpiresAt` passed, or the stored token expired without a stored successor). Other ended
families are removed where their end is observed (`401 token-invalid` with no other stored token,
`token-revoked`, an agent restart). With the default rollover rule the map stays at one or two
entries; when it is full, the agent's own bound answers (R-A9).

## Contract types

`src/generated/` is generated from `api/openapi.yaml` by `scripts/gen-types.sh`, with the pinned
`openapi-typescript` and `yaml` versions of `api/tools/check.sh`, run outside the workspace (no new
dependency). A unit test fails when the spec's SHA-256 no longer matches; re-run the script.

## Tests

`pnpm test` runs Vitest against an OpenAPI-driven mock agent (`src/test-support/`): routes come
from the spec's `paths`, default limits from `x-zilo-default`, and every response is validated
against the schema declared for its operation and status. `ZILO_T13_RECORD=1 pnpm test` also
writes raw detection timings to `docs/validation/logs/T13/`.
