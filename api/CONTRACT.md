# Zilo wire contract, `/zilo/v1`

**Status:** draft 1 (T10 ★). Claude wrote it under OD-2. It is queued for GPT review on resume and
for approval by both masters. It is not in force until that review passes.

**Normative files:** this file and [`openapi.yaml`](openapi.yaml). They bind the agent (GPT lane,
T11/T20) and `@zilo/sdk` (FE lane, T13/T21). The schemas, paths and status codes are in the
OpenAPI file. This file holds the rules that OpenAPI cannot express. If the two disagree, raise
it as a contract bug; neither file wins silently.

**Implements:** D-003, D-004, D-005, D-007, D-008 and D-010, and the provisional
**D-004a (Proposed; GPT approval pending)**. It also takes in the T05 hand-offs on branch
`t05-design-spec`, and the **unreviewed** SP-1a interim note (commit `8cbc264`).

**Markers:**
- **[SP-1a]** marks a rule that depends on the unreviewed SP-1a interim note. In the YAML it
  carries `x-zilo-source: SP-1a-interim (unreviewed)`.
- **[D-004a]** marks a rule that depends on D-004a, which is not yet in force. In the YAML it
  carries `x-zilo-source: D-004a (pending GPT)`.

Both kinds are listed in [Unreviewed inputs](#unreviewed-inputs).

**Acceptance check:** `api/tools/check.sh`. It runs a pinned Redocly lint, then, in a scratch
directory outside the repo, runs pinned `openapi-typescript` and compiles the result with
`tsc --strict`. The run is headless (OD-4).

Rule IDs (`R-…`) are stable, so tests and reviews can cite them.

---

## 1. Versioning and compatibility

**R-V1 Path version.** Every endpoint lives under `/zilo/v1/`. A breaking change means a new
path prefix, `/zilo/v2/`. An agent may serve several majors side by side.

A **breaking change** is any of the following:
- removing or renaming an endpoint, field, enum value or event type;
- changing a field's type or meaning;
- making an optional request field required;
- changing a status code or problem `code` for an existing condition;
- tightening validation that existing clients relied on.

**R-V2 `hello`.** `GET /zilo/v1/hello` returns:
- always: `product` (`"zilo"`), `scope`, `protocol` and `capabilities[]`. `protocol` is
  `{min, max}` in `major.minor` form; the major equals the path version, and the minor counts
  additive changes.
- only with `scope: full`, meaning a valid bearer token for an allowed origin: `version` (SemVer),
  `os`, `arch`, `instanceId` and `limits`. **[D-004a]**

An invalid token on `hello` never produces a 401. The response falls back to `scope: public`.

**R-V3 Additive changes.** A new optional field, endpoint, event type, enum value or capability
is allowed within v1, under these conditions:
- It is advertised by a new **capability flag** in `hello`.
- It raises `protocol.max` minor.
- Both masters review it (PLAN §4).
- A client uses an additive feature **only** if its capability flag is present.

**R-V4 Client tolerance.** Clients must:
- ignore unknown JSON fields;
- ignore unknown SSE event types;
- treat unknown enum values in responses as opaque. Every response enum is open
  (`x-zilo-open-enum`).
- map an unknown problem `code` to `unknown`, keeping its `retryable`.

Debug logging may record only safe metadata (type names, field names, codes), never unknown
payloads, document content or tokens (PLAN §4).

**R-V5 Server strictness.** The agent rejects request bodies that do not match the schema with
`invalid-request`. It **ignores unknown request fields**, so a newer SDK can send optional fields
gated by a capability.

### 1.3 Capability flags (v1.0)

| Flag | Scope | Meaning |
|---|---|---|
| `auth.consent` | public | `POST`/`GET /auth/consent` exist (D-004 consent flow). |
| `auth.token` | public | `POST /auth/token`, `/auth/token/renew` and `DELETE /auth/token` exist. |
| `transport.http` | public | Loopback HTTP fetch transport (D-003 default candidate). |
| `devices.refresh` | full | `POST /devices/refresh`. |
| `jobs.scan` | full | Jobs, cancel and dispose. |
| `events.replay` | full | `Last-Event-ID` replay (§6). |
| `pages.thumbnails` | full | `maxWidth` on page GET. |
| `export.pdf`, `export.tiff`, `export.jpeg`, `export.png` | full | One flag per export format. |
| `export.rotate` | full | Per-page `rotate` in export. |
| *Reserved:* `agent.self-update` | full | T05 asks for it. The endpoint is defined by the updater task (D-008), not here. The SDK shows "Update Zilo" only when the flag is present. |
| *Reserved:* `transport.bridge`, `transport.tls` | public | Safari S2 and S1 (§11). No agent advertises them until SP-1 approves one. |

With `scope: public`, the agent lists only `public` flags. **[D-004a]**

---

## 2. Transport rules

**R-T1 Bind and address.**
- The agent binds to loopback only (D-004).
- The SDK calls `http://127.0.0.1:<port>`, using the IP literal (D-003).
- The port is the fixed port or one of 2 fallbacks; T11 sets the numbers.
- The SDK passes `targetAddressSpace: 'loopback'`. It is optional for the IP literal, and
  harmless. **[SP-1a]**

**R-T2 Host allowlist.** The agent accepts only these `Host` values:
- `127.0.0.1:<port>`
- `[::1]:<port>`
- `localhost:<port>`

`<port>` is the port that received the request. Any other `Host`, including a missing one,
gets `403 host-denied`, a problem+json body and **no CORS headers**. This check runs before any
other (§2.1). The allowlist itself is D-004. **[SP-1a]** The `host-denied` response shape comes
from the interim note.

**R-T3 Origin classes.** The agent classifies the request `Origin` as one of:

| Class | Definition |
|---|---|
| *absent* | No `Origin` header (non-browser, or a same-origin GET). |
| *ineligible* | `null`, opaque, malformed, or a non-`https` scheme. Exception: `http://127.0.0.1:*`, `http://localhost:*` and `http://[::1]:*` are *dev-eligible*, but only when the agent runs with its dev flag. **[D-004a]** |
| *eligible* | A well-formed `https://host[:port]` origin, or a dev-eligible loopback origin when the dev flag is on. |
| *allowed* | Eligible, and either consented (state `granted`) or installer-baked. Loopback origins are **never** allowed. **[D-004a]** |

Origins are compared as exact serialised origins: scheme, lower-case host (punycode for IDN) and
port, with the default port elided.

**R-T4 Exact-origin CORS.** When CORS applies, the response carries:
- `Access-Control-Allow-Origin: <the request Origin, exactly>`, never `*`;
- `Vary: Origin`;
- `Access-Control-Expose-Headers: ETag, Retry-After, Content-Disposition, Location, Zilo-Request-Id, Zilo-Page-Count`.

There is no `Access-Control-Allow-Credentials`: cookies are not used. CORS applies:
- on **pre-auth endpoints** (`GET /hello`, `GET`/`POST /auth/consent`, `POST /auth/token`) when
  the Origin is *eligible* **[D-004a]**;
- on **every other endpoint** when the Origin is *allowed*.

It applies **to error responses too**, so the SDK can read the problem `code`. **[SP-1a]**
Otherwise the response carries no CORS headers, and the browser surfaces a `TypeError`.
`Vary: Origin` is sent on every response, CORS or not.

**R-T5 Preflight.** `OPTIONS` on any `/zilo/v1/*` path is served **without authentication**,
because preflights carry no credentials. **[SP-1a]**
- **Accepted:** `204`, no body, with:
  - `Access-Control-Allow-Origin` (exact);
  - `Access-Control-Allow-Methods: GET, POST, DELETE`;
  - `Access-Control-Allow-Headers: Authorization, Content-Type, Last-Event-ID, If-None-Match`;
  - `Access-Control-Max-Age: 600`;
  - `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.
- **Accepted when:** the path is pre-auth and the Origin is eligible **[D-004a]**, or the Origin
  is allowed.
- **Otherwise:** `403`, with no CORS headers and no body.

**R-T6 No PNA/LNA headers.** The agent never sends `Access-Control-Allow-Private-Network` or any
`…-Local-Network` header. Neither browser sent the request headers in SP-1a. **[SP-1a]**

**R-T7 No caching.** Every `/zilo/v1` response carries `Cache-Control: no-store`, including page
images and exports. Documents never reach the browser HTTP cache. The SDK may cache page bytes in
memory and revalidate them with `If-None-Match` (§7). **[SP-1a]** The SSE header in particular
comes from the interim note.

**R-T8 No state-changing GETs.** Every `GET` is free of side effects that a caller can observe.
- The GETs are: `hello`, `auth/consent`, `devices`, `devices/{id}/caps`, `jobs`, `jobs/{id}`,
  `jobs/{id}/events`, `jobs/{id}/pages` and `jobs/{id}/pages/{n}`.
- Allowed bookkeeping: refreshing a job's idle-TTL clock (§10) and opening a device to read caps.
- Showing a prompt, starting discovery, cancelling, exporting and deleting are `POST`/`DELETE`
  only.

**R-T9 Bodies.**
- Request bodies are `application/json` and at most `limits.maxRequestBodyBytes`.
- Another content type gets `400 invalid-request`. A body that is too large gets
  `413 limits-exceeded`.
- Errors are `application/problem+json` (§9).
- Every response carries `Zilo-Request-Id`.

**R-T10 Credentials never in URLs.** Tokens travel only in `Authorization: Bearer`. No query
parameter carries a credential (D-004).

### 2.1 Check order (normative)

For every request:
1. **Host** (R-T2). On failure: `403 host-denied`, no CORS.
2. **Route and method.** Unknown path: `404 not-found`. Known path, wrong method:
   `405 invalid-request`. CORS still follows R-T4.
3. **`OPTIONS`** follows R-T5 and stops here.
4. **Origin class** (R-T3).
   - Pre-auth endpoints continue to their own logic (§3).
   - On any other endpoint, an Origin that is absent, ineligible or not allowed gets
     `403 unauthorized-origin` with **no CORS headers**. The page learns nothing. **[SP-1a]**
5. **Bearer token** (§3.3). On failure: `401 token-invalid` or `401 token-revoked`, with CORS
   because the origin is allowed.
6. **Rate limits and quotas** (§10). On failure: `429 rate-limited` or `limits-exceeded`.
7. **Ownership** (§5.1). On failure: `404 not-found`.
8. **Request validation**, then the operation.

---

## 3. Auth

### 3.1 Consent (unknown origins) [D-004a]

**R-A1 Trigger.** `POST /zilo/v1/auth/consent` is the **only** call that can show the native
consent prompt. The SDK makes it only during an active user interaction (D-008). `GET` never
prompts.

**R-A2 Responses.**

| Situation | Status | Body |
|---|---|---|
| Already `granted`, or baked | `200` | `ConsentStatus{state: granted, managed}`. No prompt. |
| No consent on record | `202` | `{state: pending, pollAfterSeconds, promptExpiresAt}`. The prompt is shown. |
| A prompt for **this** origin is open | `202` | The same pending status. Coalesced, so no second prompt. |
| Another origin's prompt is open | `429 rate-limited` | `Retry-After`. At most one prompt is open on the machine. |
| A per-origin or global prompt rate limit is hit | `429 rate-limited` | `Retry-After`. |
| Denied, cool-down running | `403 consent-denied` | `Retry-After` and `retryAfterSeconds` give the cool-down left. |
| Blocked from the tray ("Block this site") | `403 consent-denied` | `blocked: true`, no `Retry-After`. The agent never prompts again. |
| Origin absent or ineligible | `403 unauthorized-origin` | No CORS. |

**R-A3 Polling.** While the state is `pending`, the SDK polls `GET /zilo/v1/auth/consent` every
`pollAfterSeconds` (default 2 s), and only while its "Approve this site in Zilo" dialog is open
(T05 `state.awaiting-consent`). It stops on `granted` (then gets a token), on `denied`/`blocked`,
or on `none` (the prompt expired or was dismissed). `GET /auth/consent` is limited to 2 requests
per second per origin, beyond which it returns `rate-limited`.

**R-A4 Prompt lifetime and limits.** The defaults below are configurable by installer policy.

| Item | Default |
|---|---|
| Prompt timeout | 120 s. Then the state returns to `none`, with no cool-down. A timeout counts toward the rate limit. |
| Closing the prompt without choosing | Same as a timeout. |
| Per-origin prompt limit | 3 per rolling hour. |
| Global prompt limit | 10 per rolling hour, and 1 open at a time. |
| Cool-down after **Deny** | 10 min. It doubles on each consecutive denial for the same origin, up to 24 h. An Allow resets it. |
| Block | Permanent until the user unblocks the site in the tray. |

**R-A5 What the prompt shows.** The exact origin, never truncated or paraphrased, with the IDN
warning and the T05 copy (`tray.consent*`). The buttons are enabled after 1 s, and there is no
default button (T05/T44).

**R-A6 Persistence.**
- A grant persists across agent restarts until the user removes the site in the tray.
- Removing a site revokes every token of that origin (§3.4) and sets its state to `none`.
- Installer-baked origins can only be **reset** (tokens revoked), not removed. They never prompt
  (D-004).

### 3.2 Token issuance [D-004a for the eligibility rule]

**R-A7** `POST /zilo/v1/auth/token` mints a token only for an *allowed* origin: granted or
baked. Baked origins **still** authenticate here; the baking only skips the prompt (D-004).
- Never minted for `null`, opaque or loopback origins (R-T3).
- Never shows a prompt.
- If the origin is not allowed, the call returns, in this precedence:
  1. `403 consent-pending` (a prompt is open; retryable after `pollAfterSeconds`);
  2. `403 consent-denied` (cool-down or blocked);
  3. `403 unauthorized-origin` (no consent on record; call `POST /auth/consent`).

  These carry CORS, because the endpoint is pre-auth.

**R-A8 Token properties.**
- An opaque random secret of ≥ 256 bits, base64url encoded (≥ 43 characters).
- The agent stores only a hash.
- Bound to exactly one origin and one **session**.
- Lifetime: `expiresAt = now + limits.tokenTtlSeconds` (default 1 h), with
  `renewAfter = expiresAt − 15 min`.
- Tokens are reusable bearer credentials while valid. They are not single-use (PLAN §5, M2).

**R-A9 Session.** Each `POST /auth/token` starts a new session.
- The session ends at `sessionExpiresAt` (absolute, default 24 h), on revocation, or on agent
  exit.
- Jobs belong to the session (§5.1).
- An origin may hold `limits.maxSessionsPerOrigin` sessions (default 16). Issuing one more
  evicts the least recently used session **that has no active job**, which is revoked as in
  §3.4. If every session has an active job, the call returns `429 limits-exceeded`.

### 3.3 Presenting and renewing

**R-A10** Every non-pre-auth request carries `Authorization: Bearer <token>`. The request
`Origin` must equal the token's origin. Failures:
- `401 token-invalid`: the header is missing or malformed, the token is unknown (for example
  after an agent restart), or it belongs to another origin. The agent does not say which. The
  SDK then calls `POST /auth/token` once, silently. If that fails, it shows the result of that
  call.
- `401 token-revoked`: the token was revoked, expired, or outlived its renewal grace, or its
  session ended. The agent remembers revoked and expired token hashes until their original
  expiry plus 24 h. The SDK shows T05 `token-revoked` copy, because the session's pages are gone.

401 responses carry `WWW-Authenticate: Bearer error="invalid_token"`.

**R-A11 Renewal.** `POST /zilo/v1/auth/token/renew` with a valid token returns a new token in the
**same session**: jobs and pages stay.
- The old token stays valid for `limits.tokenRenewGraceSeconds` (default 60 s), so in-flight
  requests can finish.
- Renewal never extends the session past `sessionExpiresAt`.

### 3.4 Revocation

**R-A12** Any of the following revokes tokens:
- `DELETE /zilo/v1/auth/token`, by the SDK: ends this session;
- tray "Remove" on an allowed site: every session of the origin, and consent goes back to `none`;
- tray "Reset access" on a baked site: every session, while consent stays `granted`;
- session expiry;
- eviction (R-A9);
- agent exit.

Revoking a session **disposes all its jobs**: active ones are cancelled first, and every page is
deleted.

**R-A13 Detecting revocation.** Once the site is removed, the origin is no longer *allowed*, so
the agent's responses carry no CORS headers and the SDK sees a `TypeError`. On a `TypeError`
from an authenticated call, the SDK:
1. probes `GET /hello` (public);
2. if `hello` answers, reads `GET /auth/consent`. A state of `none`, `denied` or `blocked` means
   access was removed, and the SDK shows the `token-revoked` copy. Otherwise it treats the
   failure as transport (agent stopped or blocked).

A baked site that is reset stays allowed, so it gets a readable `401 token-revoked`.

---

## 4. Devices

**R-D1 List.** `GET /zilo/v1/devices` returns the cached list and the discovery state, with no
side effects (R-T8). The agent runs discovery at startup and in the background.
`POST /zilo/v1/devices/refresh` runs discovery now:
- It is bounded by `limits.discoveryTimeoutSeconds`.
- It joins a discovery already running instead of starting another.
- Drivers that time out keep their last devices and are listed in
  `discovery.incompleteDrivers`.

**R-D2 Device identity.** `id` is opaque and path-safe. It is stable per **route** (device plus
driver) for as long as the device is seen. The same scanner seen through WIA and TWAIN is **two
devices** (T05 scan-dialog: routes are not merged).

**R-D3 Driver enum** (open): `wia`, `twain`, `ica`, `sane`, `escl`, `virtual`.
- WSD is not a driver. It appears through `wia` (Windows) or `sane` with sane-airscan (Linux)
  (D-001).
- `virtual` is the Zilo Virtual Scanner (D-007). Its failure-injection variants are separate
  virtual devices; their names and IDs are defined in T12.
- Installer config decides whether the virtual scanner is listed in production. That is an
  owner question (T05).

**R-D4 Caps.** `GET /zilo/v1/devices/{id}/caps` returns one `SourceCaps` per source the device
offers. Each one gives:
- `source`: `flatbed`, `feeder` or `duplex`;
- `resolutions`: a list, or a `{min, max, step}` range;
- `colorModes` (`color`, `gray`, `bw`);
- `pageSizes` (IDs plus millimetres) and `maxAreaMm`;
- `customPageSize`;
- `maxPages`, the feeder capacity if the device reports one;
- `defaults`.

`limits` gives the agent caps that apply on top of the device's own. Reading caps may open the
device. If the device is in use, the call returns `409 device-busy`.

---

## 5. Jobs

### 5.1 Ownership

**R-J1** A job belongs to the **origin and session** that created it (D-004). Every job, page,
event and export request from any other session (even of the same origin) or any other origin
returns **`404 not-found`**, identical to a job that never existed. Existence is never revealed.
`GET /zilo/v1/jobs` lists only the caller's session's jobs.

### 5.2 State machine

```
            ┌──────────── cancel ─────────────┐
            │                                  ▼
 create → queued ──→ scanning ──→ completed   cancelled
            │           │  └────→ failed         │
            │           └── cancel ──→ cancelled │
            └──→ failed                          │
 {completed, failed, cancelled} ── DELETE / TTL / session end / discardPages / deleteAfterExport ──→ disposed
 {queued, scanning} ── DELETE ──→ cancelled ──→ disposed
```

| From | To | Cause |
|---|---|---|
| — | `queued` | `POST /jobs` accepted (seq 1 is `state: queued`). |
| `queued` | `scanning` | The device has started acquiring. |
| `queued` | `failed` | A device error before the first page (e.g. `feeder-empty`, `cover-open`, `permission`). |
| `queued`, `scanning` | `cancelled` | `POST …/cancel`, `DELETE`, or session revocation. |
| `scanning` | `completed` | The source ran out normally (feeder empty after ≥ 1 page, flatbed done, `maxPages` reached). |
| `scanning` | `failed` | A device or limit error. **Pages already scanned are kept** (`pagesKept`). |
| `completed`, `failed`, `cancelled` | `disposed` | `DELETE`, `discardPages`, `deleteAfterExport`, TTL (§10), session end, agent exit. |

- **Terminal states:** `completed`, `failed` and `cancelled`. Each emits `done`.
- **`disposed`** is the final tombstone. A disposed job has `pageCount: 0`. `GET /jobs/{id}`
  returns it for `limits.tombstoneSeconds` (default 300 s), then `404`. Pages and export of a
  disposed job return `404 not-found`.
- `feeder-empty` happens **only** when no page was fed. Running out after at least one page is
  `completed` (T05).

### 5.3 Cancel versus dispose

**R-J2 Cancel** (`POST /jobs/{id}/cancel`) stops acquisition and **keeps** the pages already
scanned.
- With `discardPages: true` the job is disposed right after it reaches `cancelled`. That is
  "delete on cancel when the caller asks" (D-004).
- On a terminal job, cancel is a no-op that returns `200` and the job. It never discards there.
- Otherwise it returns `202`.

**R-J3 Dispose** (`DELETE /jobs/{id}`) deletes the job and every page and temp file.
- An active job is cancelled first.
- Dispose is idempotent within the tombstone window: `204`.

### 5.4 Concurrency

**R-J4** The defaults below are in `limits`.
- **One active job per device** (`queued` or `scanning`), across all origins. A busy device
  returns `409 device-busy`; the agent does not queue behind another job. `device-busy` also
  covers a device held by another application.
- `maxActiveJobsPerOrigin`: 2.
- `maxJobsPerSession`: 8 non-disposed jobs.
- `maxEventStreamsPerJob`: 4.
- `maxConcurrentExportsPerSession`: 2.

Exceeding a quota returns `429 limits-exceeded`, with `limit.name` and `retryable: true`. Dispose
old jobs to free capacity.

### 5.5 Capability validation and effective settings

**R-J5 Validation** of `POST /jobs` against the device's caps:
- A missing or malformed field, or contradictory settings (for example `customPageSizeMm`
  without `pageSize: custom`): `400 invalid-request`.
- A value that is well-formed but impossible for any device (for example a resolution above
  `limits.maxResolutionDpi`): `422 invalid-settings`.
- A `source` or `colorMode` the device does not offer: **always**
  `422 unsupported-capability`. These are never coerced.
- A `resolution` or `pageSize` the device does not offer:
  - with `strict: true`: `422 unsupported-capability`;
  - otherwise the agent **coerces** it. A resolution goes to the nearest supported value, and on
    a tie to the higher one. A page size goes to the nearest one that fits within `maxAreaMm`.
    Each change is recorded as an `Adjustment{reason: coerced}`.

**R-J6 Effective settings** (D-005):
- `Job.effective` holds the settings the job will use, and is known when the job is created.
- If the driver reports different values at scan time, the agent updates `Job.effective`, adds
  `Adjustment{reason: device-applied}`, and emits a `state` event carrying `effective` and
  `adjustments`.
- Each `Page` carries its actual `resolution` and `colorMode`.
- The SDK shows T05 `scan.effective-settings` when `adjustments` is non-empty.

---

## 6. Events (SSE over fetch)

**R-E1 Transport.** `GET /zilo/v1/jobs/{id}/events` returns `text/event-stream`, read with
`fetch` streaming and `Authorization: Bearer`. `EventSource` is not used, because it cannot set
the header. **[SP-1a]**

**R-E2 Framing.** Each event is:

```
id: <seq>
event: <type>
data: <JSON, one line, matching components/schemas/JobEvent>

```

**R-E3 Types:**

| Type | Payload |
|---|---|
| `state` | `state`, `previous`, and optionally `effective` and `adjustments`. |
| `progress` | `pagesCompleted`, `pageIndex`, `fraction` (nullable), `totalPages` (nullable). |
| `page` | `page`, holding the full `Page` metadata. Sent once the page is stored and fetchable. |
| `error` | `fatal` and `problem`. A `fatal: true` error is followed by `state: failed` and then `done`. |
| `done` | `state` (`completed`, `failed` or `cancelled`), `pageCount`, and `error` when the job failed. |

Unknown types must be ignored (R-V4).

**R-E4 Sequence.**
- `seq` is per job. It starts at 1 and **strictly increases**.
- Gaps are allowed, so clients must not assume `seq` is contiguous.
- The order is causal: a page's `page` event precedes `done`, and every `state` change is
  emitted in transition order.

**R-E5 Reconnect and replay.**
- The client reconnects with the `Last-Event-ID: <seq>` header, which the preflight allows. The
  agent replays every **retained** event with a larger `seq`, then continues live.
- **Retention:** every `state`, `page`, `error` and `done` event is kept for the whole life of
  the job. Of the `progress` events, only the latest is kept. So the window always covers the
  events that matter, and a reconnect can never miss a page.
- A `Last-Event-ID` that is not an integer, or that is larger than the current `seq`, returns
  `400 invalid-request`.
- With no `Last-Event-ID`, the replay starts from `seq` 1.

**R-E6 Heartbeat.** The agent sends a comment line, `: hb`, every `limits.sseHeartbeatSeconds`
(default 15 s). If nothing arrives (event or heartbeat) for 3× that period, the SDK treats the
stream as dead and reconnects.

**R-E7 End.**
- The agent closes the stream after `done`, or after `state: disposed`.
- A stream opened on a terminal job replays its events, then closes.
- A stream opened on a tombstone replays its events, ending with `state: disposed`, then closes.
- Up to `maxEventStreamsPerJob` concurrent streams are allowed per job.

**R-E8 Headers.** `Content-Type: text/event-stream`, `Cache-Control: no-store`, and CORS per
R-T4. **[SP-1a]**

---

## 7. Pages

**R-P1 Numbering.**
- `index` is 0-based, assigned in acquisition order, **stable**, and never reused or renumbered.
- There is no server-side page delete or reorder in v1. Delete, reorder and rotate are applied
  through the export selection (§8, and PLAN §1).
- Every `Page` carries `sheet` (0-based physical sheet) and `side`:
  - `duplex`: the front is `front` and the back is `back`, on the same `sheet`;
  - simplex: always `front`.
- Blank backs are **not** dropped in v1, so the index pattern stays predictable.

**R-P2 Bytes.** `GET /zilo/v1/jobs/{id}/pages/{index}` returns the page as scanned, with no
rotation applied.
- `format`: `jpeg` or `png`. The default is `png` for `bw` pages and `jpeg` otherwise.
- `quality`: JPEG quality, 1 to 100 (default 85).
- `maxWidth`: 16 to 4096. It scales the page down, preserving the aspect ratio, and never scales
  up. It is used for thumbnails (T05 scan-dialog §5).

**R-P3 ETag and caching.**
- Pages are immutable, so every variant (page, `format`, `maxWidth`, `quality`) has a **strong**
  `ETag` that never changes.
- `If-None-Match` with a matching value returns `304`.
- Responses are `Cache-Control: no-store` (R-T7). Revalidation is for the SDK's in-memory cache
  only.
- `Page.etag` is the ETag of the full-size image in the default format.

**R-P4 Availability.** A page is fetchable from the moment its `page` event is emitted until the
job is disposed. `GET /jobs/{id}/pages` lists them in `index` order.

---

## 8. Export

**R-X1 Request.** `POST /zilo/v1/jobs/{id}/export` takes:
- `format`: `pdf`, `tiff`, `jpeg` or `png`;
- `pages`: an ordered list of `{index, rotate}`. `rotate` is a clockwise rotation of 0, 90, 180
  or 270, applied at export. **The list order is the output order.** Duplicate indices return
  `422 invalid-request`. When the list is omitted, every page is exported in index order with
  no rotation.
- `quality` (default 85);
- `filename`;
- `deleteAfterExport`.

This takes in the T05 hand-off (per-page rotate and order).

**R-X2 Formats.**
- **PDF:** one page per entry. The PDF page size comes from the pixel size and the resolution.
  `color` and `gray` pages are JPEG-compressed at `quality`; `bw` pages are 1-bit lossless.
- **TIFF:** one multi-page file. `bw` pages use 1-bit CCITT G4; `gray` and `color` use lossless
  compression.
- **JPEG and PNG:** **one page per request.** `pages` must hold exactly one entry; anything else
  returns `422 invalid-request`. A `bw` page exported as JPEG becomes 8-bit greyscale, because
  JPEG has no 1-bit mode.
- Compression details are implementation-defined. Tests compare decoded content, not bytes
  (D-007). The output must open in mainstream readers.

**Why one image per request, not a zip:**
1. Browsers have no native zip reader, so a zip would add an unzip library to `@zilo/sdk` and an
   extra full copy in memory.
2. D-005 already says the SDK returns `Blob`/`File` per item, and the app uploads them. One
   request per page maps one-to-one onto that.
3. Each request is bounded, retryable and cancellable on its own, so a failure costs one page,
   not the batch.
4. The cost, N loopback requests, is negligible next to the encoding time.

A zip can be added later behind a capability (`export.zip`) if the owner's upload flow needs one.

**R-X3 Atomic responses.** The agent renders the whole output **before** it sends the status
line. So an export either returns `200` with the complete body, or a problem response. It never
returns a truncated `200`. The response carries:
- `Content-Type` for the format;
- `Content-Length`;
- `Content-Disposition: attachment; filename="<sanitised filename or 'scan'>.<ext>"`;
- `Zilo-Page-Count`.

**R-X4 Retry and repeat.**
- Export is a pure function of the stored pages and the request. **Pages are kept after every
  export** (D-004), so the caller can retry, do partial exports and export many times in any
  format.
- A failure returns `500 export-failed` (retryable), and the pages stay.
- An active job may export the pages it already has. Pages are immutable, so the result is
  consistent.

**R-X5 `deleteAfterExport`** (opt-in, default false):
- The job is disposed only after the response body has been **completely written**.
- If the export fails, or the connection drops before the body is written, nothing is deleted.
- It is allowed only on a terminal job; otherwise the call returns `409 invalid-state`.

**R-X6 Limits.**
- An output larger than `limits.maxExportBytes` (default 1 GiB) returns `413 limits-exceeded`
  with `limit.name: maxExportBytes`.
- More than `maxConcurrentExportsPerSession` concurrent exports returns `429 limits-exceeded`.

---

## 9. Errors

**R-ER1 Format.** Every error is RFC 9457 `application/problem+json` with these fields:
- `type`: `urn:zilo:problem:<code>`;
- `title`: English, for logs only; the UI copy comes from T05 by `code`;
- `status`;
- `code`;
- `retryable`;
- `requestId`.

The following are optional:
- `detail`;
- `instance`;
- `retryAfterSeconds`, together with a `Retry-After` header;
- `jobId`;
- `deviceId`;
- `pagesKept`;
- `blocked`;
- `limit{name,max}`;
- `errors[{field (JSON Pointer), reason}]`.

Problems never contain document content, tokens or file paths.

**R-ER2 Where errors appear.** An error arrives either as an HTTP response or inside an SSE
`error` event (`problem`). Device errors during scanning usually arrive as events. The `status`
field is set in both places, so the meaning is the same.

**R-ER3** Clients key on `code`, never on `status` alone. `retryable` means that the identical
request can succeed later, possibly after a physical user action such as loading paper. It does
not mean "retry automatically".

| Code | HTTP | Retryable | Meaning | T05 copy |
|---|---|---|---|---|
| `host-denied` | 403 | no | `Host` is not allowlisted (R-T2). No CORS, so the browser sees a network error. **[SP-1a]** | none (SDK sees "unreachable") |
| `unauthorized-origin` | 403 | no | The origin is not allowed. Readable only on pre-auth endpoints; elsewhere it has no CORS. | `unauthorized-origin` ✔ |
| `consent-pending` | 403 | yes (`Retry-After` = poll interval) | A consent prompt for this origin is open (from `POST /auth/token`). **[D-004a]** | `state.awaiting-consent` ✔ |
| `consent-denied` | 403 | yes after `Retry-After`; no when `blocked: true` | Denied with cool-down, or blocked from the tray. **[D-004a]** | `unauthorized-origin` with "Ask again in {minutes} min"; **new** copy for blocked |
| `token-invalid` | 401 | no | The token is missing, malformed, unknown or for another origin. Re-issue silently (R-A10). | none (silent) |
| `token-revoked` | 401 | no | The token was revoked or expired, or its session ended. The session's pages are gone. | `token-revoked` ✔ |
| `rate-limited` | 429 | yes (`Retry-After`) | A request or prompt rate limit was hit. | **new** |
| `invalid-request` | 400 (405 for a wrong method, 422 for body semantics) | no | The request is malformed or contradictory, or it violates the schema. | `unknown` (bug) |
| `invalid-settings` | 422 | no | The settings are well-formed but impossible (above agent limits, bad custom size). | **new** |
| `unsupported-capability` | 422 | no | The device does not offer this source or colour mode, or a strict mismatch. | **new** |
| `invalid-state` | 409 | no | The operation is not allowed in the job's current state (e.g. `deleteAfterExport` on an active job). | `unknown` (bug) |
| `not-found` | 404 | no | Unknown or disposed resource, **or one owned by another session or origin** (R-J1). | **new** |
| `device-busy` | 409 | yes | The device has an active Zilo job, or another application holds it. | `device-busy` ✔ |
| `feeder-empty` | 409 | yes | No page was fed at the start of a feeder scan. | `feeder-empty` ✔ |
| `paper-jam` | 409 | yes | Paper jam. Pages before it are kept. | `paper-jam` ✔ |
| `cover-open` | 409 | yes | Cover or feeder lid open. | `cover-open` ✔ |
| `timeout` | 504 | yes | The device did not respond within `pageTimeoutSeconds`. Pages are kept. | `timeout` ✔ |
| `disconnected` | 503 | yes | The device disappeared. Pages are kept. | `disconnected` ✔ |
| `permission` | 403 | no | The OS denies device access (ACL, group, policy). Never used for browser blocking. | `permission` ✔ |
| `export-failed` | 500 | yes | Rendering failed. Pages are kept. | `export-failed` ✔ |
| `limits-exceeded` | 413 (size, pages, pixels, duration, store) or 429 (concurrency quota) | no for 413, yes for 429 | A resource bound was hit (§10). For a job, the pages already scanned are kept. | `limits-exceeded` ✔ |
| `agent-unavailable` | 503 | yes | The agent is starting, updating or shutting down. | **new** |
| `unknown` | 500 | yes | Any other failure. | `unknown` ✔ |

✔ confirms a T05 code unchanged: all 12 T05 codes are confirmed under the same names. **New**
codes need a `copy.js` entry (T05 follow-up). Until then the UI maps them to `unknown`.

---

## 10. Limits and retention

**R-L1 Limits.** These are the defaults. Installer policy may override them, and `hello.limits`
(full scope) reports the effective values.

| Limit | Default | On breach |
|---|---|---|
| Pages per job | 500 | Job → `failed`, `limits-exceeded`, pages kept |
| Pixels per page | 150 MP | `422 invalid-settings` at create if predictable, else job failure |
| Resolution | 1200 dpi | `422 invalid-settings` |
| Stored bytes per job | 2 GiB | Job failure `limits-exceeded`, pages kept |
| Stored bytes, all jobs of the user | 8 GiB | New jobs get `413 limits-exceeded`; active jobs fail with pages kept |
| Export size | 1 GiB | `413 limits-exceeded` |
| Scan duration per job | 30 min | Job failure `limits-exceeded`, pages kept |
| Device silence between pages | 120 s | Job failure `timeout`, pages kept |
| Discovery | 15 s | Partial list (`incompleteDrivers`) |
| Request body | 64 KiB | `413 limits-exceeded` |
| Concurrency | §5.4 | `409 device-busy` or `429 limits-exceeded` |

**R-L2 Retention (D-004).**

| Object | Lifetime |
|---|---|
| Token | 1 h, renewable; 60 s grace after renewal |
| Session | 24 h absolute; ends on revoke or agent exit |
| Terminal job | Disposed after **60 min idle** (no request touches it), or **8 h** after creation, whichever comes first. `Job.expiresAt` gives the current deadline. |
| Active job | Bound by the scan-duration limit, not the TTL |
| Tombstone | 300 s |
| Consent grant | Until removed in the tray |
| Denial cool-down | 10 min, doubling, capped at 24 h (R-A4) |

Pages are deleted on `DELETE`, on cancel with `discardPages`, on `deleteAfterExport`, at the TTL,
at session end, and at agent exit. **They are kept after a normal export** (D-004).

**R-L3 User-private temp.**
- Page and export files live only under a per-user agent directory:
  - POSIX: mode `0700`, with files at `0600`;
  - Windows: an ACL that grants only the current user, with inheritance disabled.
- Nothing is written to shared temp locations.
- At startup the agent deletes leftovers from earlier runs.
- Uninstall removes the directory.
- Logs never contain document content, tokens or full page file paths (PLAN §4, T51).

---

## 11. Safari path (placeholder)

D-003 approves neither S1 nor S2; both are pending SP-1. This section reserves names only.

**R-S1 Capability flag the SDK reads.** `hello.capabilities` includes `transport.bridge` (S2
popup bridge) or `transport.tls` (S1 local TLS) **only** once the corresponding path is approved
and implemented. Until then no agent advertises either.

**R-S2 SDK behaviour on Safari.** The SDK uses a Safari path only if **both** of these hold:
- its own build supports that path;
- the agent advertises the flag through a reachable, approved channel.

Otherwise it shows the explicit T05 `state.safari-unsupported`, never a silent failure (D-003).
On Chromium and Firefox the flags are ignored.

**R-S3 Not in this contract.** The bridge page, `POST /zilo/v1/bridge/session`, the
`postMessage` schema, and the bridge capability are **not** part of v1. The SP-1a prototype
shapes are evidence, not contract. When a Safari path is approved, it is added under the flags
above, with its own security rules: D-003 S2 properties, and consent bound to the opener origin
(D-004).

---

## Unreviewed inputs

The rules below depend on inputs that are not yet reviewed or in force. They are provisional,
and the GPT review on resume covers them (OD-2).

**A. SP-1a interim note** (`8cbc264:docs/spikes/SP-1a-interim.md`, unreviewed). In the YAML:
`x-zilo-source: SP-1a-interim (unreviewed)`.

| Rule | Dependency |
|---|---|
| R-T1 (`targetAddressSpace` optional for the IP literal) | Fact 2 |
| R-T2 (`403 host-denied` response, no CORS) | "Host" handoff |
| R-T4 (exact-origin reflection, `Vary: Origin`, CORS on error responses) | "Origin" handoff |
| R-T5 (unauthenticated `OPTIONS`, `204`, allowed methods and headers) | "Preflights" handoff |
| R-T6 (no PNA/LNA headers) | "No PNA/LNA preflight headers" |
| R-T7 (`no-store`, in particular on SSE) | Fact 3 |
| §2.1 step 4 (non-allowed origin: `403`, no CORS) | "Hostile origin" |
| R-E1, R-E8 (SSE over fetch with `Authorization`; SSE headers) | Fact 3 |
| §9 `host-denied` row | "Host" handoff |
| YAML: `getHello`, `streamJobEvents`, `Preflight`, `PreflightDenied`, the `AccessControl*`, `Vary` and `CacheControlNoStore` headers | as above |

The SP-1a evidence covers Chromium 156 and Firefox 157 only. WebKit and real Safari are pending,
so nothing here says anything about Safari (§11).

**B. D-004a (Proposed; GPT approval pending).** In the YAML:
`x-zilo-source: D-004a (pending GPT)`.

| Rule | What depends on it |
|---|---|
| R-V2, §1.3 | Public versus full `hello` |
| R-T3 | The *eligible* origin class, the dev-flag loopback exception, "loopback never allowed" |
| R-T4, R-T5 | CORS and preflight for eligible, not-yet-allowed origins on pre-auth endpoints |
| §3.1 (R-A1 to R-A6) | The consent endpoints, coalescing, global and per-origin limits, `Retry-After` cool-down, block |
| R-A7 | Token eligibility: no loopback or null origins |
| §9 `consent-pending` and `consent-denied` rows | |
| YAML: `getHello`, `getConsent`, `requestConsent`, `issueToken`, `ConsentStatus`, `Preflight` | |

**Residual risk accepted by D-004a.** Any website can detect that Zilo is installed, and its
protocol range, by reading public `hello`. Dynamsoft has the same exposure today. Full version,
OS and arch are not exposed before authorisation.

---

## Proposed changes to D-005

D-005 fixed the shape. This contract keeps every D-005 path and meaning. The items below are
**flagged for both masters**.

**Changes:**
1. **`hello` is scope-dependent [D-004a].** D-005 lists `hello` as (product, version, protocol,
   os, arch, capabilities). Here, `version`, `os` and `arch` appear only with `scope: full`, and
   `protocol` is a `{min, max}` range rather than a single value.
2. **Events add `state`.** D-005 lists `progress, page, error, done`. The T10 spec requires
   `state`, so the full set is `state, progress, page, error, done`.

**Additions (no D-005 path changed):**
- `POST`/`GET /auth/consent`;
- `POST`/`DELETE /auth/token`;
- `POST /auth/token/renew`;
- `POST /devices/refresh` (refresh is a `POST`, because no GET may change state);
- `GET /jobs`;
- `GET /jobs/{id}`;
- `POST /jobs/{id}/cancel` (cancel differs from `DELETE`, which disposes);
- `GET /jobs/{id}/pages`;
- `OPTIONS` everywhere;
- the export request body (pages, rotate, quality, `deleteAfterExport`).

**Clarifications:**
- `jobs/{id}/pages/{n}` uses `{index}`, 0-based.
- The agent may return `image/jpeg` or `image/png`, chosen with `format`.
- JPEG and PNG export is one page per request (§8).

---

## Hand-offs and open items

**For T05 (copy):**
- All 12 codes are confirmed under the same names. Set `t10: "confirmed"`.
- Add `copy.js` entries for the new codes:
  - `consent-denied` (blocked variant);
  - `rate-limited`;
  - `invalid-settings`;
  - `unsupported-capability`;
  - `not-found`;
  - `agent-unavailable`.
- The rest need no UI copy: `host-denied` and `token-invalid` are unreachable or silent, and
  `invalid-request` and `invalid-state` map to `unknown`.
- Consent-pending signal: `202 {state: pending}` and `403 consent-pending` (§3.1).
- Cool-down: `retryAfterSeconds` on `consent-denied` and `ConsentStatus` (T05
  "Ask again in {minutes} min").
- The self-update flag `agent.self-update` is reserved (§1.3).
- **Under D-004a:**
  - Before consent, `hello` has no `version`. The "Update Zilo" dialog can show
    `{version}`/`{required}` only after authorisation. Before that, the SDK decides "outdated"
    from `protocol` and the capabilities.
  - Non-https origins get no CORS and no tokens, so `tray.consent.insecure` can never be shown
    for a site that could then use Zilo.

**For the masters:**
1. **Loopback dev origins (D-004a).** No token is ever minted for a loopback origin, so the demo
   app and the E2E runs must use a non-loopback HTTPS origin with a per-run CA, as SP-1a did
   (`https://app.zilo.test:8443`). Confirm. The dev flag only lets a loopback page read the
   pre-auth endpoints.
2. **Session-scoped ownership.** Two tabs of the same app do not share jobs, because each tab
   holds its own session. That is the literal D-004 "origin and token" rule. Confirm, or widen it
   to origin-wide ownership.
3. **Ports.** T11 sets the fixed port and the 2 fallbacks. The `servers` entry is a placeholder.
4. **SP-1a open questions 1 and 2** (S2 consent for baked origins; S2 as a Chromium and Firefox
   fallback) belong to the Safari path. They are deliberately left out of v1 (§11).
