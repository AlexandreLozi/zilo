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
  later tasks (T25, the updater).
- **Permission query** for `loopback-network` (then the older `local-network-access` name), with
  `unknown` wherever the query is unavailable.
- **HTTP transport** (`HttpTransport`): fetch to `http://127.0.0.1:<port>` with
  `targetAddressSpace: 'loopback'`, bounded timeouts, caller abort, bearer header only, typed
  errors (`ZiloProblemError` for every §9 code, unknown codes as `unknown`), and redacted debug
  logging (operation names, status, codes and timings only).
- **Auth** (`AuthClient`): public `hello`, `POST /auth/consent` (only from `connect()`, which must
  run in a user gesture), polling `GET /auth/consent`, `POST /auth/token`, renewal that keeps the
  family, the R-A15 rollover rule and per-job family selection.
- **Devices and caps** with unknown-field and unknown-enum tolerance; `resolutionChoice()` applies
  the R-D4 fallback for an unknown `ResolutionCaps.kind`.
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

## Credential storage

The default `MemoryCredentialStore` keeps tokens in memory for one SDK instance: nothing outlives
the page, nothing is enumerable by other pages, but tabs do not share jobs (each tab holds its own
family). To share jobs across tabs (R-A15), pass a `CredentialStore` over storage shared by the
app's same-origin tabs, with cross-tab mutual exclusion (for example the Web Locks API). Any
same-origin script (an XSS) can read such tokens; never persist one beyond its `familyExpiresAt`.

## Contract types

`src/generated/` is generated from `api/openapi.yaml` by `scripts/gen-types.sh`, with the pinned
`openapi-typescript` and `yaml` versions of `api/tools/check.sh`, run outside the workspace (no new
dependency). A unit test fails when the spec's SHA-256 no longer matches; re-run the script.

## Tests

`pnpm test` runs Vitest against an OpenAPI-driven mock agent (`src/test-support/`): routes come
from the spec's `paths`, default limits from `x-zilo-default`, and every response is validated
against the schema declared for its operation and status. `ZILO_T13_RECORD=1 pnpm test` also
writes raw detection timings to `docs/validation/logs/T13/`.
