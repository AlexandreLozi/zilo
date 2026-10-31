# Zilo wire contract, `/zilo/v1`

**Status:** draft 2 (T10 ★, fix round r1). Claude wrote it under OD-2. Draft 1 got a GPT review
(`docs/reviews/T10-r1.md`, 13 findings, verdict "changes"). This draft resolves all 13 and
applies the agreed master positions in `docs/planning/DISCUSSION.md` ("[GPT] T10 r1 findings
and master positions" and "[Opus] Agreement on GPT's T10 r1 master positions"). It is queued for
GPT re-review and for approval by both masters, and it is not in force until both happen. See
[r1 resolution](#r1-resolution) for the finding-by-finding map.

**Normative files:** this file and [`openapi.yaml`](openapi.yaml). They bind the agent (GPT lane,
T11/T20) and `@zilo/sdk` (FE lane, T13/T21). The schemas, paths and status codes are in the
OpenAPI file. This file holds the rules that OpenAPI cannot express. If the two disagree, raise
it as a contract bug; neither file wins silently.

**Implements:** D-003, D-004, D-005, D-007, D-008 and D-010, and the provisional
**D-004a (Proposed; GPT approval pending)** as amended by the agreed r1 master positions
(§3.0). It also takes in the T05 hand-offs on branch `t05-design-spec`, and the SP-1a interim
note (commit `8cbc264`), whose evidence the r1 review checked but which is not yet approved.

**Markers:**
- **[SP-1a]** marks a rule that depends on the SP-1a interim note. In the YAML it carries
  `x-zilo-source: SP-1a-interim (unreviewed)`.
- **[D-004a]** marks a rule that depends on D-004a as amended, or on the agreed D-004
  reconciliation of ownership and revocation (§3.2 to §3.4). Neither is in force yet. In the YAML
  it carries `x-zilo-source: D-004a (pending GPT)`.

Both kinds are listed in [Unreviewed inputs](#unreviewed-inputs). A passing lint or this review
does not remove a marker; the masters' approvals do.

**Acceptance check:** `api/tools/check.sh`. It runs a pinned Redocly lint, then, in a scratch
directory outside the repo, runs pinned `openapi-typescript`, compiles the result with
`tsc --strict`, and runs the schema and rule tests in `api/tests/` with pinned `yaml`, `ajv` and
`ajv-formats`. The run is headless (OD-4).

Rule IDs (`R-…`) are stable, so tests and reviews can cite them. Draft 2 adds IDs; it renumbers
none.

---

## 1. Versioning and compatibility

**R-V1 Path version.** Every endpoint lives under `/zilo/v1/`. A breaking change means a new
path prefix, `/zilo/v2/`. An agent may serve several majors side by side.

A **breaking change** is any of the following:
- removing or renaming an endpoint, field, enum value or event type;
- changing a field's type or meaning;
- making an optional request field required;
- changing a status code or problem `code` for an existing condition;
- tightening validation that existing clients relied on;
- adding a value to a **closed** response discriminator (R-V4).

**R-V2 `hello`.** `GET /zilo/v1/hello` returns one of two schemas, discriminated by `scope`:
- `HelloPublic`: `product` (`"zilo"`), `scope: public`, `protocol` and `capabilities[]`. It
  **must not** carry `version`, `os`, `arch`, `instanceId` or `limits`; the schema forbids them,
  so the pre-auth disclosure boundary is machine-checkable. Unknown additional fields are
  tolerated. **[D-004a]**
- `HelloFull`: the same, with `scope: full`, plus `version` (SemVer), `os`, `arch`,
  `instanceId` and `limits`, **all required**. Only a valid bearer token of an *allowed* origin
  gets it.

`protocol` is `{min, max}` in `major.minor` form. Both majors equal the path version, and
`min <= max` in numeric order. The minor counts additive changes. An invalid token on `hello`
never produces a 401; the response falls back to `scope: public`.

**R-V3 Additive changes.** A new optional field, endpoint, event type, enum value or capability
is allowed within v1, under these conditions:
- It is advertised by a new **capability flag** in `hello`.
- It raises `protocol.max` minor.
- Both masters review it (PLAN §4).
- A client uses an additive feature **only** if its capability flag is present.

**R-V4 Client tolerance.** Clients must:
- ignore unknown JSON fields;
- accept unknown values of every **open** response enum and treat them as opaque;
- ignore unknown SSE event types, after recording their `seq` as processed (R-E5);
- map an unknown problem `code` to `unknown`, keeping its `retryable`.

The tolerance is in the schemas, not in an annotation:
- Every response enum is an `anyOf` of a closed `…Known` enum and a plain `string` (for example
  `Driver = DriverKnown | string`). An unknown value validates as JSON Schema, and the generated
  TypeScript type stays open.
- Requests use the closed `…Known` enums, so request validation stays strict (R-V5).
  `ScanSettings` (request) and `RequestedSettings` (its echo in responses) are separate schemas
  for that reason.
- Two response discriminators are **closed** on purpose, so generated types narrow:
  `Hello.scope` and the `type` of a known event in `JobEvent`.
- SSE `data` lines are decoded in two steps. Step 1, `JobEventEnvelope`, accepts any `type`.
  Step 2, `JobEvent`, is applied only to known types. This is the explicit known-event decoding
  boundary; unknown events never reach step 2.

Debug logging may record only safe metadata (type names, field names, codes), never unknown
payloads, document content or tokens (PLAN §4).

**R-V5 Server strictness.** The agent rejects request bodies that do not match the schema with
`400 invalid-request`. It **ignores unknown request fields**, so a newer SDK can send optional
fields gated by a capability.

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
- The port is the fixed port or one of 2 fallbacks; T11 sets the numbers. `hello.product` lets
  the SDK reject a foreign service on a fallback port.
- The SDK passes `targetAddressSpace: 'loopback'`. It is optional for the IP literal. In the
  SP-1a runs Chromium 156 recognised it and Firefox 157 ignored it; "harmless" is bounded to
  those tested versions. **[SP-1a]**

**R-T2 Host allowlist.** The agent accepts only these `Host` values:
- `127.0.0.1:<port>`
- `[::1]:<port>`
- `localhost:<port>`

`<port>` is the port that received the request. Any other `Host`, including a missing one,
gets `403 host-denied`, a problem+json body and **no CORS headers**, on **every** method,
`OPTIONS` included. This check runs before any other (§2.1). The allowlist itself is D-004.
**[SP-1a]** The `host-denied` response shape comes from the interim note.

**R-T3 Origin classes.** The agent classifies the request `Origin` as one of:

| Class | Definition |
|---|---|
| *absent* | No `Origin` header (non-browser, or a same-origin GET). |
| *ineligible* | `null`, opaque, malformed, or a non-`https` scheme. |
| *dev-eligible* | `http://127.0.0.1:*`, `http://localhost:*` or `http://[::1]:*`, **only** while the agent runs with its dev flag. Otherwise these are *ineligible*. **[D-004a]** |
| *eligible* | A well-formed `https://host[:port]` origin, compared as an exact serialised origin. |
| *allowed* | *Eligible*, and either consented (state `granted`) or installer-baked. Loopback origins are **never** allowed, dev flag or not. **[D-004a]** |

Origins are compared as exact serialised origins: scheme, lower-case host (punycode for IDN) and
port, with the default port elided.

The dev flag grants **pre-auth diagnostics only** (D-004a amendment). A *dev-eligible* origin
can read `GET /hello` (always `scope: public`) and `GET /auth/consent` (always `none`). It never
triggers a prompt, never gets a token, and never reaches a protected endpoint.

**R-T4 Exact-origin CORS.** When CORS applies, the response carries:
- `Access-Control-Allow-Origin: <the request Origin, exactly>`, never `*`;
- `Vary: Origin`;
- `Access-Control-Expose-Headers: ETag, Retry-After, Content-Disposition, Location, Zilo-Request-Id, Zilo-Page-Count`.

There is no `Access-Control-Allow-Credentials`: cookies are not used. The **CORS tier** of a
request decides whether CORS applies:

| Path | CORS applies when the Origin is |
|---|---|
| `GET /hello`, `GET /auth/consent` | *eligible* or *dev-eligible* **[D-004a]** |
| `POST /auth/consent`, `POST /auth/token` | *eligible* **[D-004a]** |
| every other path, and any unknown path under `/zilo/v1/` | *allowed* |

It applies **to error responses too**, so the SDK can read the problem `code`. **[SP-1a]**
Otherwise the response carries no CORS headers, and the browser surfaces a `TypeError`.
`Vary: Origin` is sent on every response, CORS or not.

**R-T5 Preflight.** `OPTIONS` on a known `/zilo/v1/*` path is served **without
authentication**, because preflights carry no credentials. **[SP-1a]**
- **Accepted:** `204`, no body, when the Origin is in the path's CORS tier (R-T4). It carries:
  - `Access-Control-Allow-Origin` (exact);
  - `Access-Control-Allow-Methods: GET, POST, DELETE`;
  - `Access-Control-Allow-Headers: Authorization, Content-Type, Last-Event-ID, If-None-Match`;
  - `Access-Control-Max-Age: 600`;
  - `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.
- **Origin refused, or unknown path:** `403`, with no CORS headers and **no body**. This is the
  one bodyless error (R-ER1).
- **Host not allowed:** `403 host-denied` with a problem body (R-T2), because the Host check
  runs first.

**R-T6 No PNA/LNA headers.** The agent never sends `Access-Control-Allow-Private-Network` or any
`…-Local-Network` header. Neither browser sent the request headers in SP-1a. This is
version-scoped evidence, not a guarantee about future browsers. **[SP-1a]**

**R-T7 No caching.** Every `/zilo/v1` response carries `Cache-Control: no-store`, including page
images and exports. Documents never reach the browser HTTP cache. The SDK may cache page bytes in
memory and revalidate them with `If-None-Match` (§7). **[SP-1a]** The SSE header in particular
comes from the interim note.

**R-T8 No state-changing GETs.** Every `GET` is free of side effects that a caller can observe.
- The GETs are: `hello`, `auth/consent`, `devices`, `devices/{id}/caps`, `jobs`, `jobs/{id}`,
  `jobs/{id}/events`, `jobs/{id}/pages` and `jobs/{id}/pages/{index}`.
- Allowed bookkeeping: refreshing a job's idle-TTL clock (§10), opening a device to read caps,
  and rate-limit counters.
- Showing a prompt, starting discovery, cancelling, exporting and deleting are `POST`/`DELETE`
  only.

**R-T9 Bodies.**
- Request bodies are `application/json` and at most `limits.maxRequestBodyBytes`, on any
  method.
- Another content type gets `400 invalid-request`. A body that is too large gets
  `413 limits-exceeded`; the agent stops reading at the limit.
- Errors are `application/problem+json` (§9).
- Every response carries `Zilo-Request-Id`.

**R-T10 Credentials never in URLs.** Tokens travel only in `Authorization: Bearer`. No query
parameter carries a credential (D-004).

### 2.1 Check order (normative)

For every request:
1. **Host** (R-T2). On failure: `403 host-denied`, problem body, no CORS. This applies to every
   method, `OPTIONS` included.
2. **`OPTIONS`** follows R-T5 and stops here.
3. **Route and method.** Unknown path: `404 not-found`. Known path, wrong method:
   `405 invalid-request` with an `Allow` header. CORS follows the caller's tier (R-T4).
   From this step on, the agent may answer `503 agent-unavailable` while it starts, updates or
   stops.
4. **Origin class** (R-T3).
   - Pre-auth endpoints continue to their own logic (§3), with their own rate limits.
   - On any other endpoint, an Origin that is absent, ineligible, dev-eligible or not allowed
     gets `403 unauthorized-origin` with **no CORS headers**, **before any token is looked at**.
     The page learns nothing. **[SP-1a]**
5. **Bearer token** (§3.3). On failure: `401 token-invalid` or `401 token-revoked`. A 401 is only
   reached by an allowed origin, so it always carries CORS.
6. **Rate limits and quotas** (§10). On failure: `429 rate-limited` or `limits-exceeded`.
7. **Body** (R-T9). Wrong content type: `400`. Too large: `413 limits-exceeded`.
8. **Ownership** (§5.1). On failure: `404 not-found`.
9. **Request validation**, then the operation.

There is one policy for a removed origin: it is no longer *allowed*, so step 4 answers
`403 unauthorized-origin` without CORS, whatever token it presents. The YAML `Unauthorized`
response says the same. R-A13 tells the SDK how to recognise that case.

---

## 3. Auth

### 3.0 D-004a as amended by the r1 master positions [D-004a]

These amendments are binding inputs of this draft. Masters record them in D-004a and D-004.
1. Tokens and consent are for an **exact serialised eligible HTTPS origin** only.
2. `null`, opaque and loopback origins **never** receive tokens, with or without the dev flag.
3. The **dev flag** grants pre-auth diagnostics only (R-T3).
4. Native consent stays, with bounded global and per-origin prompt budgets (R-A4), bounded
   retained bookkeeping (R-A14, R-L4), and bounded token issuance and renewal (R-A9, R-A11).
5. **Accepted residual risks:**
   - any website can detect that Zilo is installed, and its protocol range, from public
     `hello`;
   - a hostile HTTPS site can consume the global prompt budget (bounded harassment or
     starvation). Rotating origins defeats only the per-origin budget, not the global one. This
     is not authenticated scanner access;
   - the SDK prompts only from a user gesture, but that is SDK policy. The agent cannot verify a
     gesture, so it is not a server-side control.
6. CORS and check order follow one policy (§2.1), and public and full `hello` are separate
   schemas (R-V2).
7. No pre-auth access to devices, pages or events, and no pre-auth or arbitrary bridge token
   minting (§11).

### 3.1 Consent (unknown origins) [D-004a]

**R-A1 Trigger.** `POST /zilo/v1/auth/consent` is the **only** call that can show the native
consent prompt. The SDK makes it only during an active user interaction (D-008), but per §3.0
item 5 that is not a server control. `GET` never prompts.

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
| Origin absent, ineligible or dev-eligible | `403 unauthorized-origin` | No CORS for absent or ineligible origins. |

`ConsentStatus` makes the state-dependent fields required: `pending` requires
`pollAfterSeconds` and `promptExpiresAt`, `denied` requires `retryAfterSeconds`, `granted`
requires `managed`. An unknown future state requires only `origin` and `state`; the SDK treats
it as "not usable yet" and stops polling.

**R-A3 Polling.** While the state is `pending`, the SDK polls `GET /zilo/v1/auth/consent` every
`pollAfterSeconds` (default 2 s), and only while its "Approve this site in Zilo" dialog is open
(T05 `state.awaiting-consent`). It stops on `granted` (then gets a token), on `denied`/`blocked`,
on `none` (the prompt expired or was dismissed), or on an unknown state.
`GET /auth/consent` is limited to 2 requests per second per origin, beyond which it returns
`rate-limited`.

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
- Removing a site revokes every token family of that origin (R-A12) and sets its state to
  `none`.
- Installer-baked origins can only be **reset** (families revoked), not removed. They never
  prompt (D-004).

### 3.2 Token issuance and token families [D-004a]

**R-A7 Issuance.** `POST /zilo/v1/auth/token` mints a token only for an *allowed* origin:
granted or baked. Baked origins **still** authenticate here; the baking only skips the prompt
(D-004).
- Never minted for `null`, opaque or loopback origins (§3.0).
- Never shows a prompt.
- If the origin is not allowed, the call returns, in this precedence:
  1. `403 consent-pending` (a prompt is open; retryable after `pollAfterSeconds`);
  2. `403 consent-denied` (cool-down or blocked);
  3. `403 unauthorized-origin` (no consent on record; call `POST /auth/consent`).

  These carry CORS when the origin is *eligible*, because the endpoint is pre-auth.
- Each call starts a **new token family** (R-A9).
- Budget: at most `limits.tokenIssuesPerOriginPerHour` (default 20) calls per origin per
  rolling hour; beyond that, `429 rate-limited` with `Retry-After`.

**R-A8 Token properties.**
- An opaque random secret of ≥ 256 bits, base64url encoded (≥ 43 characters).
- The agent stores only a hash.
- Bound to exactly one origin and one **token family**.
- Times, for every permitted policy value:
  - `expiresAt = min(issuedAt + limits.tokenTtlSeconds, familyExpiresAt)`. The absolute family
    deadline always caps a token.
  - `renewAfter = issuedAt + floor(3 × (expiresAt − issuedAt) / 4)`. With the default 1 h this is
    45 min. Since `tokenTtlSeconds ≥ 300`, `renewAfter` lies strictly between `issuedAt` and
    `expiresAt` whenever the family has at least 2 s left.
- Tokens are reusable bearer credentials while valid. They are not single-use (PLAN §5, M2).

**R-A9 Token family.** A **token family** is one `POST /auth/token` issuance and every token
renewed from it. It has a `familyId` (not a credential) and an absolute deadline
`familyExpiresAt = issuance + limits.familyMaxSeconds` (default 24 h).
- **Ownership:** jobs belong to the origin and the family (R-J1). Renewal keeps the family, so
  jobs and pages survive rotation.
- **Shared tabs:** tabs of one app share jobs by sharing the family's current token through the
  SDK's shared same-origin storage (R-A15). This is not origin-wide access: separately issued
  families of the same origin stay isolated from each other, and there is no per-tab scan
  session.
- **The bridge** (S2, if ever approved) keeps its own session boundary (§11); it is not a token
  family.
- **A family ends** on any of these:
  1. its deadline `familyExpiresAt`;
  2. **lapse**: its current token expires without a successor (nobody renewed it in time);
  3. revocation (R-A12);
  4. agent exit.

  When a family ends, every protected operation with its tokens is denied at once, its open
  event streams close, its active jobs are cancelled, and its jobs and pages are deleted
  physically within `limits.revocationCleanupSeconds` (agent exit: by the startup sweep,
  R-L3). Only revocation is reported as `token-revoked`; the other ends make the tokens
  `token-invalid` (R-A10).
- **Bounds:** an origin may hold `limits.maxFamiliesPerOrigin` live families (default 16), and
  the agent `limits.maxFamiliesTotal` (default 64). A new issuance beyond the per-origin bound
  revokes (R-A12) the least recently used family of that origin **that has no non-disposed
  job**. If there is none, or the global bound is reached, the call returns
  `429 limits-exceeded` with `limit.name`. One origin never evicts another origin's family.
- `Job.expiresAt` is never later than the owning family's `familyExpiresAt`. An SDK that is near
  the family deadline should start a new family before a new scan, or accept the shorter
  deadline that `Job.expiresAt` shows.

### 3.3 Presenting and renewing

**R-A10 Presenting.** Every non-pre-auth request carries `Authorization: Bearer <token>`. The
request `Origin` must equal the token's origin. A token is valid while it is the family's current
token and not expired, or while it is in its renewal grace (R-A11), and its family has not ended.
Failures distinguish an **obsolete credential** from **revoked access**:
- `401 token-invalid`, an obsolete or unusable credential. The header is missing or malformed;
  the token is unknown (for example after an agent restart); it belongs to another origin; it
  expired; it was superseded and its grace is over; or its family lapsed or reached its
  deadline. The agent does not say which. **It says nothing about pages.** The SDK recovers
  silently:
  1. it re-reads its shared storage, and if another tab stored a different current token, it
     retries the request once with it;
  2. otherwise it acquires a token as in R-A15 (a new family, if needed) and retries once;
  3. a job it was tracking that is then `404 not-found` is gone for this caller; the SDK reports
     it with the `not-found` copy, never with "your pages were deleted" from the 401 itself.
- `401 token-revoked`: the token's family was **revoked** (R-A12). Access to its jobs ended at
  once; physical deletion follows within the bound. The SDK shows the T05 `token-revoked` copy,
  which must say that **access was revoked**, not that pages were erased.

401 responses carry `WWW-Authenticate: Bearer error="invalid_token"`.

**R-A11 Renewal.** `POST /zilo/v1/auth/token/renew` with the family's **current** token returns
its successor in the **same family**: jobs and pages stay.
- Allowed at or after the token's `renewAfter`. Earlier, the call returns `429 rate-limited`
  with `Retry-After` up to `renewAfter`. This is the minimum renewal interval.
- **At most one successor per token.** A second renewal with the same token, such as a
  concurrent renewal from another tab, returns `409 invalid-state`. The agent keeps only hashes,
  so it cannot hand the successor out twice; the second tab reads it from shared storage
  (R-A15).
- The old token stays valid for `limits.tokenRenewGraceSeconds` (default 60 s, at most 300 s)
  after the renewal, never past its own `expiresAt`, so in-flight requests can finish. A token
  in its grace cannot be renewed.
- Renewal never extends the family past `familyExpiresAt`. When the current token already
  expires at `familyExpiresAt`, renewal returns `409 invalid-state`. The client then starts a new
  family with `POST /auth/token`; the new family starts without jobs.
- Bound: with `renewAfter` at three quarters of the lifetime and one successor per token, a
  family renews at most `ceil(familyMaxSeconds / (0.75 × tokenTtlSeconds))` times (32 with the
  defaults).

### 3.4 Revocation, history and shared tabs

**R-A12 Revocation.** Any of the following **revokes** a family:
- `DELETE /zilo/v1/auth/token` by the SDK (self-revocation of the presented token's family);
- tray "Remove" on an allowed site: every family of the origin, and consent goes back to
  `none`;
- tray "Reset access" on a baked site: every family of the origin, while consent stays
  `granted`;
- eviction (R-A9).

Revocation is **immediate logical denial**: every token of the family (including one in grace)
gets `401 token-revoked` from then on, every open event stream of the family is closed at once
without a further event, and active jobs are cancelled. **Physical cleanup** of pages and temp
files completes within `limits.revocationCleanupSeconds` (default 60 s). Copy, retention (R-L2)
and quotas describe this same choice: access is revoked now; the bytes are gone within the
bound. Revoked jobs count against no quota from the moment of revocation.

**R-A13 Detecting removal.** Once the site is removed, the origin is no longer *allowed*, so
protected endpoints answer `403 unauthorized-origin` without CORS (§2.1 step 4) and the SDK sees a
`TypeError`. On a `TypeError` from an authenticated call, the SDK:
1. probes `GET /hello` (public);
2. if `hello` answers, reads `GET /auth/consent`. A state of `none`, `denied` or `blocked` means
   access was removed; the SDK shows the "access revoked" copy. Otherwise it treats the failure
   as transport (agent stopped or blocked).

A baked site that is reset stays allowed, so it gets a readable `401 token-revoked`.

**R-A14 Bounded auth history.**
- Per family the agent holds at most two valid token hashes: the current token and one
  predecessor in grace.
- It keeps the hash of a **revoked** token only until that token's own `expiresAt`, because
  after that the token would be `token-invalid` anyway. At most
  `limits.maxRetainedAuthRecords` (default 1024) such records are kept; on overflow the oldest is
  dropped first, and a dropped token is answered as `token-invalid`. Both are 401s, and the SDK
  recovers either way.
- An ended family's record is deleted once its jobs' tombstones are gone.
- Consent bookkeeping is bounded by the prompt budgets: prompt timestamps are kept for one
  rolling hour, a denial streak for 24 h after the last denial, and a denial needs a prompt, so
  at most `10 × 24 = 240` origins carry denial state with the defaults. Blocked origins are
  managed by the user in the tray.
- Request rate-limit counters live in a fixed-size table. Evicting a counter can only make the
  agent more permissive, never deny a valid request.

**R-A15 Shared-tab coordination (SDK obligations).** These rules bind `@zilo/sdk` (T13/T21).
- The SDK keeps one record per origin, `{token, familyId, expiresAt, renewAfter,
  familyExpiresAt}`, in storage shared by the app's same-origin tabs. Choosing that storage
  mechanism and reviewing its security is T13's job; this contract does not approve a
  browser-storage technology.
- **Acquisition** and **renewal** run under cross-tab mutual exclusion. The tab holding the
  exclusion re-reads storage first, acts only if storage still holds the token it saw, and
  writes the result to storage before releasing. Two tabs therefore never start two families
  by accident.
- A tab that gets `409 invalid-state` from renewal, or `401 token-invalid`, re-reads storage
  before doing anything else (R-A10).
- The SDK starts a new family only when storage holds no usable token of a live family.
- If a tab dies between receiving a successor and storing it, the family can lapse. That loses
  access to its jobs, which the SDK then reports as in R-A10 step 3. This is accepted.

**R-A16 Long-lived streams.** An event stream is authenticated when it opens and is then bound to
the token **family**, not to that token. Renewal and the expiry of the token that opened it do
not affect an open stream. Revocation or the end of the family closes it at once (R-A12).
On reconnect the client presents its current token, so a closed stream surfaces the reason as a
401 (`token-revoked` or `token-invalid`).

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
- `resolutions`: a list, or a `{min, max, step}` range whose values are `min + k × step` up to
  `max`;
- `colorModes` (`color`, `gray`, `bw`);
- `pageSizes`, **at least one**: IDs plus portrait millimetres, each fitting within `maxAreaMm`
  as given. When the driver lists none, the agent lists `max`, the whole `maxAreaMm`;
- `maxAreaMm`;
- `customPageSize`;
- `maxPages`, the feeder capacity if the device reports one. It is informational and caps
  nothing;
- `defaults`, **always complete**: `resolution`, `colorMode` and `pageSize` (R-J7).

`limits` gives the agent caps that apply on top of the device's own. Reading caps may open the
device. If the device is in use, the call returns `409 device-busy`.

---

## 5. Jobs

### 5.1 Ownership

**R-J1** A job belongs to the **origin and token family** that created it (D-004 as reconciled;
§3.2). **[D-004a]** Every job, page, event, export, cancel and dispose request from any other
family (even of the same origin) or any other origin returns **`404 not-found`**, identical to a
job that never existed. Existence is never revealed. `GET /zilo/v1/jobs` lists only the caller's
family's jobs.

### 5.2 State machine

```
            ┌──────────── cancel ─────────────┐
            │                                  ▼
 create → queued ──→ scanning ──→ completed   cancelled
            │           │  └────→ failed         │
            │           └── cancel ──→ cancelled │
            └──→ failed                          │
 {completed, failed, cancelled} ── DELETE / TTL / family end / discardPages / deleteAfterExport ──→ disposed
 {queued, scanning} ── DELETE ──→ cancelled ──→ disposed   (one atomic step, R-E7)
```

| From | To | Cause |
|---|---|---|
| — | `queued` | `POST /jobs` accepted (seq 1 is `state: queued`). |
| `queued` | `scanning` | The device has started acquiring. |
| `queued` | `failed` | A device error before the first page (e.g. `feeder-empty`, `cover-open`, `permission`). |
| `queued`, `scanning` | `cancelled` | `POST …/cancel`, `DELETE`, or the end of the family. |
| `scanning` | `completed` | The source ran out normally (feeder empty after ≥ 1 page, flatbed done), or `effective.maxPages` pages are stored (R-J8). |
| `scanning` | `failed` | A device or limit error, including the page safety bound (R-J8). **Pages already scanned are kept** (`pagesKept`). |
| `completed`, `failed`, `cancelled` | `disposed` | `DELETE`, `discardPages`, `deleteAfterExport`, TTL (§10), family end, agent exit. |

- **Terminal states:** `completed`, `failed` and `cancelled`. Each emits `done`.
- **`disposed`** is the final tombstone, not a terminal state; `done` never carries it. A
  disposed job has `pageCount: 0` and keeps `effective` and `adjustments`. `GET /jobs/{id}`
  returns it for `limits.tombstoneSeconds` (default 300 s), then `404`. Pages and export of a
  disposed job return `404 not-found`.
- A job is **settled** when it is terminal or a tombstone.
- `feeder-empty` happens **only** when no page was fed. Running out after at least one page is
  `completed` (T05).

### 5.3 Cancel versus dispose

**R-J2 Cancel** (`POST /jobs/{id}/cancel`) stops acquisition and **keeps** the pages already
scanned.
- On an active job (`queued`, `scanning`): `202`. With `discardPages: true`, `state: cancelled`,
  `done` and `state: disposed` are appended as one atomic step once the device has stopped. That
  is "delete on cancel when the caller asks" (D-004).
- On a **settled** job (terminal **or** tombstone): a no-op that returns `200` and the job as it
  is. It never discards there, whatever `discardPages` says; use `DELETE`.
- After the tombstone window: `404 not-found`.

**R-J3 Dispose** (`DELETE /jobs/{id}`) deletes the job and every page and temp file.
- An active job is cancelled first. Once the device has stopped, `state: cancelled`, `done` and
  `state: disposed` are appended as one atomic step, then the call returns `204`.
- A terminal job gets `state: disposed`.
- Dispose is idempotent within the tombstone window: `204`.
- An in-flight export of the job is aborted (R-X5).

### 5.4 Concurrency

**R-J4** The defaults below are in `limits`.
- **One active job per device** (`queued` or `scanning`), across all origins. A busy device
  returns `409 device-busy`; the agent does not queue behind another job. `device-busy` also
  covers a device held by another application.
- `maxActiveJobsPerOrigin`: 2.
- `maxJobsPerFamily`: 8 non-disposed jobs.
- `maxJobRecordsTotal`: 256 job records across the agent, tombstones included (R-L4).
- `maxEventStreamsPerJob`: 4; `maxEventStreamsTotal`: 64.
- `maxConcurrentExportsPerFamily`: 2; `maxConcurrentExportsTotal`: 4.

Exceeding a quota returns `429 limits-exceeded`, with `limit.name` and `retryable: true`. Dispose
old jobs to free capacity.

### 5.5 Capability validation and effective settings

**R-J5 Validation and coercion** of `POST /jobs` against the source's caps. It runs before the
`201`, so the response already holds every effective value.
- A missing or malformed field, or contradictory settings (for example `customPageSizeMm`
  without `pageSize: custom`, which the schema also encodes): `400 invalid-request`.
- A value that is well-formed but impossible for any device: `422 invalid-settings`. Examples:
  a resolution above `limits.maxResolutionDpi`; an unknown `pageSize` ID; a custom size larger
  than `maxAreaMm`.
- A `source` or `colorMode` the device does not offer: **always**
  `422 unsupported-capability`. These are never coerced.
- **Resolution** the source does not offer:
  - with `strict: true`: `422 unsupported-capability`;
  - otherwise the nearest supported value not above `limits.maxResolutionDpi`; on a tie, the
    higher one. Recorded as `Adjustment{field: resolution, reason: coerced}`.
- **Page size**, resolved in this order:
  1. **`custom`** with `customPageSizeMm`. If the source has `customPageSize`, the size must fit
     `maxAreaMm` (width ≤ max width and height ≤ max height, no rotation), else
     `422 invalid-settings`. If the source has no `customPageSize`: `strict` gives
     `422 unsupported-capability`; otherwise the size is coerced to the nearest listed size.
  2. **A listed ID** of this source, or **`max`** (always offered: the whole `maxAreaMm`): used
     as is.
  3. **A canonical ID** that is not listed. The canonical table is: `a3` 297×420, `a4` 210×297,
     `a5` 148×210, `b5` 176×250, `letter` 215.9×279.4, `legal` 215.9×355.6, `executive`
     184.15×266.7 (mm, portrait). If the source has `customPageSize` and the size fits
     `maxAreaMm`, the device honours it exactly: the effective `pageSize` keeps the ID, with
     those millimetres, and no adjustment. Otherwise `strict` gives
     `422 unsupported-capability`, and non-strict coerces to the nearest listed size.
  4. **Any other ID** (for example `banana`): `422 invalid-settings` with
     `errors[{field: "/settings/pageSize", reason: "unknown-page-size"}]`, whatever `strict`
     says. There are no dimensions to compare, so it is never coerced.

  **Nearest listed size:** the listed size with the smallest `|w − rw| + |h − rh|` (mm, both as
  given, no rotation) to the requested dimensions; on a tie, the larger area; then the earlier
  entry in `pageSizes`. Recorded as `Adjustment{field: pageSize, reason: coerced}`.
- **`maxPages`**: see R-J8.

**R-J6 Effective settings** (D-005):
- `Job.effective` and `Job.adjustments` are **required** in every `Job`, from the `201` on.
  `effective` holds every field: `source`, `resolution`, `colorMode`, `pageSize`, `pageSizeMm`
  and `maxPages`. `adjustments` is empty when nothing changed.
- If the driver reports different values at scan time, the agent updates `Job.effective`, adds
  `Adjustment{reason: device-applied}`, and emits a `state` event carrying `effective` and
  `adjustments`.
- Each `Page` carries its actual `resolution` and `colorMode`.
- The SDK shows T05 `scan.effective-settings` when `adjustments` is non-empty.

**R-J7 Defaults.** An omitted setting takes the source's `defaults` from caps. The agent always
fills `defaults` completely and deterministically:
- `resolution`: the driver's default if it is supported and not above
  `limits.maxResolutionDpi`; otherwise the supported value nearest 300 dpi within that limit
  (tie: the higher one).
- `colorMode`: the driver's default if the source offers it; otherwise the first offered of
  `color`, `gray`, `bw`.
- `pageSize`: the driver's default if it is listed; otherwise `a4` if listed; otherwise `letter`
  if listed; otherwise the first listed entry (which is `max` when the driver listed none).
- `maxPages`: see R-J8.

An omitted setting produces no adjustment.

**R-J8 Page count: completion versus the safety bound.** `effective.maxPages` is the completion
count; `limits.maxPagesPerJob` (default 500, always even) is a safety bound.
- **`flatbed`** acquires exactly one page per job; `effective.maxPages` is 1. A requested
  `maxPages` other than 1 is `422 unsupported-capability` with `strict`, otherwise coerced to 1.
- **`feeder` or `duplex` with `maxPages: N`:**
  - `N > limits.maxPagesPerJob`: `422 invalid-settings` with `strict`; otherwise capped to
    `maxPagesPerJob`, recorded as `Adjustment{field: maxPages, reason: limit}`.
  - `duplex` counts pages (sides). An odd `N` is `422 unsupported-capability` with `strict`;
    otherwise rounded up to the next even number (`coerced`), so the job ends on a whole sheet.
  - The job **completes** (`completed`) once it has stored `effective.maxPages` pages, or when
    the feeder runs out after at least one page. Reaching the count is a normal completion,
    capped or not; the `limit` adjustment tells the caller about a cap.
- **`feeder` or `duplex` without `maxPages`:** `effective.maxPages` is `null`, meaning until the
  feeder is empty. If the job stores `limits.maxPagesPerJob` pages, the agent stops acquiring
  and the job ends **`failed`** with `limits-exceeded` (`limit.name: maxPagesPerJob`,
  `pagesKept` equal to the bound), whether or not paper remains, because the agent cannot
  always tell. All pages are kept and exportable.

---

## 6. Events (SSE over fetch)

**R-E1 Transport.** `GET /zilo/v1/jobs/{id}/events` returns `text/event-stream`, read with
`fetch` streaming and `Authorization: Bearer`. `EventSource` is not used, because it cannot set
the header. **[SP-1a]**

**R-E2 Framing.** Each event is:

```
id: <seq>
event: <type>
data: <JSON, one line>

```

The `data` line matches `JobEventEnvelope` (decoding step 1, any `type`). When `type` is known,
it also matches `JobEvent` (step 2). See R-V4.

**R-E3 Types:**

| Type | Payload |
|---|---|
| `state` | `state`, `previous`, and optionally `effective` and `adjustments`. |
| `progress` | `pagesCompleted`, `pageIndex`, `fraction` (nullable), `totalPages` (nullable). |
| `page` | `page`, holding the full `Page` metadata. Sent once the page is stored and fetchable. |
| `error` | `fatal` and `problem` (an `AsyncProblem`, R-ER2). A `fatal: true` error is followed by `state: failed` and then `done`. |
| `done` | `state` (`completed`, `failed` or `cancelled`, never `disposed`), `pageCount`, and `error` when the job failed. |

Unknown types are ignored after their `seq` is recorded (R-V4).

**R-E4 Sequence.**
- `seq` is per job. It starts at 1 and **strictly increases** in the job's event log.
- Every stream delivers events in **ascending** `seq`, without duplicates.
- Gaps are allowed: a superseded `progress` event is dropped from the log. A gap never means a
  lost `page` event; clients must not infer lost pages from a gap.
- The order is causal: a page's `page` event precedes `done`, and every `state` change is
  emitted in transition order.
- **Compound transitions** are appended to the log as one atomic step, so no stream can observe
  a prefix of them and close:
  - dispose of an active job, or cancel with `discardPages`: `state: cancelled`,
    `done{cancelled}`, `state: disposed`;
  - a fatal error: `error{fatal: true}`, `state: failed`, `done{failed}`;
  - completion: `state: completed`, `done{completed}`.

**R-E5 Retention, replay and live handoff.**
- **Retention:** every emitted event is kept for the whole life of the job, tombstone included,
  except that only the latest `progress` event is kept. The agent emits at most
  `limits.maxErrorEventsPerJob` (default 16) non-fatal `error` events per job; later non-fatal
  errors are logged by the agent but not emitted. A reconnect can therefore never miss a page.
- **Connect:** let `L` be the `Last-Event-ID` (0 when absent). If `L` is not an integer, or `L`
  is larger than the job's `lastSeq`, the agent returns `400 invalid-request`.
- **High-water mark:** the agent captures `H`, the job's `lastSeq`, **atomically with
  subscribing** the stream to new events. It sends every retained event with `L < seq ≤ H` in
  ascending order. It then sends every event appended after `H`, in ascending order, as it is
  appended. That is the deterministic live handoff: nothing appended after `H` is missed, and
  nothing is sent twice.
- **No truncation at `done`:** the replay never stops at an earlier `done`. A tombstone's replay
  continues past its `done` to `state: disposed`.
- **Client side:** the client resumes from the last `seq` it processed, **including** an unknown
  event type it ignored.

**R-E6 Heartbeat.** The agent sends a comment line, `: hb`, every `limits.sseHeartbeatSeconds`
(default 15 s). If nothing arrives (event or heartbeat) for 3× that period, the SDK treats the
stream as dead and reconnects.

**R-E7 End.** The agent decides to close only after it has sent every retained event up to the
job's **current** `lastSeq` (so never before `H`). It closes when, at that point, the job is
**settled**:
- On a **tombstone**, the last event sent is `state: disposed`.
- On a job that is **terminal but not disposed**, the last event sent is `done`. A disposal
  that happens **later** (`DELETE` of a terminal job, TTL, `deleteAfterExport`) is not on this
  stream. To observe it, the client reopens the stream (whose replay then ends with
  `state: disposed`) or reads `GET /jobs/{id}`.
- Disposals that are part of a compound transition (R-E4) are always delivered on the same
  stream, because they are in the log when `done` is.
- If `L` already equals `lastSeq` and the job is settled, the stream closes right after the
  headers, with no event.
- Revocation or the end of the family closes the stream at once, without a further event
  (R-A16).
- Up to `maxEventStreamsPerJob` concurrent streams are allowed per job, and
  `maxEventStreamsTotal` per agent.

**R-E8 Headers.** `Content-Type: text/event-stream`, `Cache-Control: no-store`, and CORS per
R-T4. **[SP-1a]**

---

## 7. Pages

**R-P1 Numbering.**
- `index` is 0-based, assigned in acquisition order, **stable**, and never reused or renumbered.
  An index always names the same immutable bytes for the life of the job.
- There is no server-side page delete or reorder in v1. Delete, reorder and rotate are applied
  through the export selection (§8, and PLAN §1).
- Every `Page` carries `sheet` (0-based physical sheet) and `side`:
  - `duplex`: the front is `front` and the back is `back`, on the same `sheet`;
  - simplex: always `front`.
- Blank backs are **not** dropped in v1, so the index pattern stays predictable.

**R-P2 Bytes.** `GET /zilo/v1/jobs/{id}/pages/{index}` returns the page as scanned, with no
rotation applied.
- `format`: `jpeg` or `png`. The default is `png` for `bw` pages and `jpeg` otherwise.
- `quality`: JPEG quality, 1 to 100 (default 85). Ignored for PNG.
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

**R-X1 Request and selection snapshot.** `POST /zilo/v1/jobs/{id}/export` takes:
- `format`: `pdf`, `tiff`, `jpeg` or `png`;
- `pages`: an ordered list of `{index, rotate}`. `rotate` is a clockwise rotation of 0, 90, 180
  or 270, applied at export. **The list order is the output order.**
- `quality`, `filename` and `deleteAfterExport`.

**Snapshot.** After the ownership check and before rendering, the agent takes the job's
**selection snapshot**: the set of pages whose `page` event has been emitted at that instant.
Pages are immutable, so the snapshot fixes the content exactly.
- `pages` omitted: every page of the snapshot, in index order, with no rotation. A page stored
  after the snapshot is not included, even on an active job.
- An explicit index that is not in the snapshot (not yet scanned, or never existing):
  `422 invalid-request` with `errors[{field: "/pages/<i>/index", reason: "page-unavailable"}]`.
- A duplicate index: `422 invalid-request` with `reason: "duplicate-index"`.
- An **empty effective selection** (pages omitted and the snapshot empty, for example a queued
  job, or a job that failed or was cancelled before its first page): `409 invalid-state` with
  `errors[{field: "/pages", reason: "no-pages"}]`. An explicit empty list fails the schema
  (`minItems: 1`), so it is `400 invalid-request`.
- `Zilo-Page-Count` equals the size of the effective selection.

This takes in the T05 hand-off (per-page rotate and order).

**R-X2 Formats.**
- **PDF:** one page per entry. The PDF page size comes from the pixel size and the resolution.
  `color` and `gray` pages are JPEG-compressed at `quality`; `bw` pages are 1-bit lossless.
- **TIFF:** one multi-page file. `bw` pages use 1-bit CCITT G4; `gray` and `color` use lossless
  compression. `quality` is **ignored**.
- **JPEG and PNG:** **one page per request.** `pages` is required and holds exactly one entry;
  the schema encodes this, so anything else is `400 invalid-request`. A `bw` page exported as
  JPEG becomes 8-bit greyscale, because JPEG has no 1-bit mode. `quality` applies to JPEG and is
  ignored for PNG.
- Compression details are implementation-defined. Tests compare decoded content, not bytes
  (D-007). The output must open in mainstream readers.
- Response MIME types: `application/pdf`, `image/tiff`, `image/jpeg`, `image/png`.

**Why one image per request, not a zip:**
1. Browsers have no native zip reader, so a zip would add an unzip library to `@zilo/sdk` and an
   extra full copy in memory.
2. D-005 already says the SDK returns `Blob`/`File` per item, and the app uploads them. One
   request per page maps one-to-one onto that.
3. Each non-destructive request is bounded, retryable and cancellable on its own, so a failure
   costs one page, not the batch.
4. The cost, N loopback requests, is negligible next to the encoding time.

A zip can be added later behind a capability (`export.zip`) if the owner's upload flow needs one.

**R-X3 Rendering before headers.** The agent renders the whole output **before** it sends the
status line. That moves **render and size failures** (`export-failed`, `413 limits-exceeded`)
before the headers, so they arrive as problems, never as a `200`. It does **not** prevent a
**network failure** during the body: the connection can still drop after the `200`. The client
must check that it received `Content-Length` bytes and treat a short body as a failed transfer.
The response carries:
- `Content-Type` for the format;
- `Content-Length`;
- `Content-Disposition: attachment; filename="<sanitised filename or 'scan'>.<ext>"`. Filename
  sanitisation is mandatory;
- `Zilo-Page-Count`.

**R-X4 Retry and repeat (non-destructive exports).**
- A **non-destructive** export (`deleteAfterExport` absent or false) is a pure function of its
  selection and the request. **Pages are kept after it** (D-004), so the caller can retry it
  after any failure, do partial exports and export many times in any format. The same explicit
  selection always yields the same decoded content.
- A failure returns `500 export-failed` (retryable), and the pages stay.
- An active job may export the pages in its snapshot.
- These retry guarantees do **not** cover `deleteAfterExport: true` (R-X5).

**R-X5 `deleteAfterExport` is receipt-ambiguous** (opt-in, default false).
- The agent disposes the job once it has **handed the whole body to the connection**. That is
  not proof that the client received it: the transfer can still fail, or the client can fail to
  read it. A retry then gets `404 not-found`, and the pages are gone. The flag is therefore
  never retry-safe.
- If rendering fails, or the write fails before the whole body was handed over, nothing is
  deleted.
- It is allowed only on a terminal job; otherwise the call returns `409 invalid-state`.
- Disposing aborts other in-flight exports of the same job, as `DELETE` does: before their
  headers they answer `404 not-found`; after, their connection closes early (a short body).
- **SDK flow (normative for `@zilo/sdk`):** the SDK **never** sends `deleteAfterExport: true`,
  on the first page of a batch or anywhere else. Its "export and delete" is
  **receive-then-DELETE**: export non-destructively (one request for PDF/TIFF, one per page for
  JPEG/PNG), receive every body completely and verify its length, then `DELETE /jobs/{id}`. If
  any export fails, it does not delete, and the caller can retry.
- The wire flag stays for clients that accept the ambiguity in exchange for one round trip
  (D-004 opt-in).

**R-X6 Limits.**
- An output larger than `limits.maxExportBytes` (default 1 GiB) returns `413 limits-exceeded`
  with `limit.name: maxExportBytes`.
- More than `maxConcurrentExportsPerFamily` or `maxConcurrentExportsTotal` concurrent exports
  returns `429 limits-exceeded`.
- Export staging and output files count against `limits.maxStoreBytes` with the stored pages. If
  staging an export would exceed it, the call returns `429 limits-exceeded`
  (`limit.name: maxStoreBytes`, retryable once other exports finish or jobs are disposed).

---

## 9. Errors

**R-ER1 Format.** Every error is RFC 9457 `application/problem+json` with these fields:
- `type`: `urn:zilo:problem:<code>`, always consistent with `code`;
- `title`: English, for logs only; the UI copy comes from T05 by `code`;
- `status`, equal to the HTTP status of the response;
- `code`;
- `retryable`;
- `requestId`.

The following are optional:
- `detail`;
- `instance`;
- `retryAfterSeconds`, together with a `Retry-After` header;
- `errorId` (required in an `AsyncProblem`, R-ER2);
- `jobId`;
- `deviceId`;
- `pagesKept`;
- `blocked`;
- `limit{name,max}`;
- `errors[{field (JSON Pointer), reason}]`.

**The one exception:** a refused preflight (R-T5, origin refused or unknown path) has **no body**
and no CORS, because the browser could not read it anyway. A `host-denied` on `OPTIONS` still has
a body.

Every readable error response carries CORS per the caller's tier (R-T4). Problems never contain
document content, tokens or file paths.

**R-ER2 Where errors appear, and asynchronous identity.** An error arrives either as an HTTP
response or as an asynchronous problem (`AsyncProblem`): inside an SSE `error` event, in
`done.error`, or in `Job.error`. The `status` field is set in both places, so the meaning is the
same.

An asynchronous problem is **immutable once emitted** and identical in every delivery: live,
replayed on any later stream, in `done.error` and in `Job.error`. Its identity fields are:
- `errorId`: a stable ID of this error occurrence;
- `requestId`: the `Zilo-Request-Id` of the request that **created the job**;
- `jobId`.

Each delivery's own HTTP request ID is only the `Zilo-Request-Id` header of the stream or
snapshot response. It is never written into the payload.

**R-ER3** Clients key on `code`, never on `status` alone. `retryable` means that the identical
request can succeed later, possibly after a physical user action such as loading paper. It does
not mean "retry automatically".

The code list below is **frozen for the T05 alignment**: r1 added no code and renamed none.

| Code | HTTP | Retryable | Meaning | T05 copy |
|---|---|---|---|---|
| `host-denied` | 403 | no | `Host` is not allowlisted (R-T2). No CORS, so the browser sees a network error. **[SP-1a]** | none (SDK sees "unreachable") |
| `unauthorized-origin` | 403 | no | The origin is not allowed. Readable only on pre-auth endpoints; elsewhere it has no CORS. | `unauthorized-origin` ✔ |
| `consent-pending` | 403 | yes (`Retry-After` = poll interval) | A consent prompt for this origin is open (from `POST /auth/token`). **[D-004a]** | `state.awaiting-consent` ✔ |
| `consent-denied` | 403 | yes after `Retry-After`; no when `blocked: true` | Denied with cool-down, or blocked from the tray. **[D-004a]** | `unauthorized-origin` with "Ask again in {minutes} min"; **new** copy for blocked |
| `token-invalid` | 401 | no | An obsolete or unusable credential: missing, malformed, unknown, for another origin, expired, superseded past its grace, or of a family that lapsed or reached its deadline. Says nothing about pages. Recover silently (R-A10). | none (silent) |
| `token-revoked` | 401 | no | The token's family was **revoked** (R-A12): access to its jobs ended at once, and physical deletion follows within `revocationCleanupSeconds`. | `token-revoked` ✔ (copy must say access was revoked, not that pages were erased) |
| `rate-limited` | 429 | yes (`Retry-After`) | A request, prompt, token-issuance or early-renewal limit was hit. | **new** |
| `invalid-request` | 400 (405 for a wrong method, 422 for body semantics such as an unavailable or duplicate export index) | no | The request is malformed or contradictory, or it violates the schema. | `unknown` (bug) |
| `invalid-settings` | 422 | no | The settings are well-formed but impossible (above agent limits, unknown page-size ID, custom size beyond `maxAreaMm`). | **new** |
| `unsupported-capability` | 422 | no | The device does not offer this source or colour mode, or a strict mismatch. | **new** |
| `invalid-state` | 409 | no | The operation is not allowed in the current state: `deleteAfterExport` on an active job, an export with an empty selection, a renewal of an already renewed token or at the family deadline. | `unknown` (bug) |
| `not-found` | 404 | no | Unknown or disposed resource, a job of an ended family, **or one owned by another family or origin** (R-J1). | **new** |
| `device-busy` | 409 | yes | The device has an active Zilo job, or another application holds it. | `device-busy` ✔ |
| `feeder-empty` | 409 | yes | No page was fed at the start of a feeder scan. | `feeder-empty` ✔ |
| `paper-jam` | 409 | yes | Paper jam. Pages before it are kept. | `paper-jam` ✔ |
| `cover-open` | 409 | yes | Cover or feeder lid open. | `cover-open` ✔ |
| `timeout` | 504 | yes | The device did not respond within `pageTimeoutSeconds`. Pages are kept. | `timeout` ✔ |
| `disconnected` | 503 | yes | The device disappeared. Pages are kept. | `disconnected` ✔ |
| `permission` | 403 | no | The OS denies device access (ACL, group, policy). Never used for browser blocking. | `permission` ✔ |
| `export-failed` | 500 | yes | Rendering failed. Pages are kept. | `export-failed` ✔ |
| `limits-exceeded` | 413 (size, pages, pixels, duration, store) or 429 (concurrency quota, export staging) | no for 413, yes for 429 | A resource bound was hit (§10). For a job, the pages already scanned are kept. | `limits-exceeded` ✔ |
| `agent-unavailable` | 503 | yes | The agent is starting, updating or shutting down. | **new** |
| `unknown` | 500 | yes | Any other failure. | `unknown` ✔ |

✔ confirms a T05 code unchanged: all 12 T05 codes are confirmed under the same names. **New**
codes need a `copy.js` entry (T05 follow-up). Until then the UI maps them to `unknown`.

**R-ER4 Global errors.** These can come from any route, and the YAML lists them in
`x-zilo-global-errors`:

| Status | Code | When |
|---|---|---|
| 403 | `host-denied` | Bad `Host` (step 1), on every method. No CORS. |
| 404 | `not-found` | Unknown path (step 3). |
| 405 | `invalid-request` | Known path, wrong method (step 3), with `Allow`. The YAML `MethodNotAllowed` response is its shared representation. |
| 413 | `limits-exceeded` | Body over `maxRequestBodyBytes` (step 7), on any method. |
| 429 | `rate-limited` | A request rate limit or a prompt or token budget. |
| 500 | `unknown` | Any unexpected failure. |
| 503 | `agent-unavailable` | Starting, updating or shutting down. |

Every operation in the YAML declares `429`, `500` and `503`, every `POST` and `DELETE` also
declares `413`, and every operation has a `default` problem response. A response missing from an
operation's declaration is **never** permission to skip the guard that produces it.

---

## 10. Limits and retention

**R-L1 Limits.** These are the defaults. Installer policy may override them, and `hello.limits`
(full scope) reports every effective value; all v1.0 fields are required there.

| Limit | Default | On breach |
|---|---|---|
| Pages per job (safety bound, even) | 500 | R-J8: a capped `maxPages` completes; an unbounded feeder scan fails with `limits-exceeded`, pages kept |
| Pixels per page | 150 MP | `422 invalid-settings` at create if predictable, else job failure |
| Resolution | 1200 dpi | `422 invalid-settings` |
| Stored bytes per job | 2 GiB | Job failure `limits-exceeded`, pages kept |
| Stored bytes of the user: pages **and** export staging/output | 8 GiB | New jobs get `413 limits-exceeded`; active jobs fail with pages kept; a new export gets `429 limits-exceeded` |
| Export size | 1 GiB | `413 limits-exceeded` |
| Concurrent exports | 2 per family, 4 in total | `429 limits-exceeded` |
| Scan duration per job | 30 min | Job failure `limits-exceeded`, pages kept |
| Device silence between pages | 120 s | Job failure `timeout`, pages kept |
| Discovery | 15 s | Partial list (`incompleteDrivers`) |
| Request body | 64 KiB | `413 limits-exceeded` |
| Token issuance | 20 per origin per hour | `429 rate-limited` |
| Token renewal | not before `renewAfter`; one successor per token | `429 rate-limited`; `409 invalid-state` |
| Token families | 16 per origin, 64 in total | Eviction (R-A9), else `429 limits-exceeded` |
| Job records (non-disposed and tombstones) | 8 per family; 256 in total | `429 limits-exceeded` (R-L4) |
| Event streams | 4 per job, 64 in total | `429 limits-exceeded` |
| Non-fatal error events | 16 per job | Later ones are not emitted (R-E5) |
| Retained revoked-token records | 1024 | Oldest dropped; answered as `token-invalid` (R-A14) |
| Concurrency (devices) | §5.4 | `409 device-busy` or `429 limits-exceeded` |

**R-L2 Retention (D-004).**

| Object | Lifetime |
|---|---|
| Token | `min(1 h, family deadline)`; renewable from `renewAfter`; 60 s grace after renewal |
| Token family | 24 h absolute; ends earlier on lapse, revocation or agent exit (R-A9) |
| Terminal job | Disposed after **60 min idle** (no request touches it), **8 h** after creation, or at the family's end, whichever comes first. `Job.expiresAt` gives the current deadline. |
| Active job | Bound by the scan-duration limit, not the TTL; cancelled at the family's end |
| Tombstone | 300 s, possibly less under R-L4 |
| Revoked family's pages | Access denied at once; physically deleted within 60 s (`revocationCleanupSeconds`) |
| Revoked-token hash | Until that token's `expiresAt`, bounded by R-A14 |
| Consent grant | Until removed in the tray |
| Denial cool-down | 10 min, doubling, capped at 24 h (R-A4) |

Pages are deleted on `DELETE`, on cancel with `discardPages`, on `deleteAfterExport`, at the TTL,
at the end of the family (within the cleanup bound), and at agent exit. **They are kept after a
normal export** (D-004).

**R-L3 User-private temp.**
- Page and export files live only under a per-user agent directory:
  - POSIX: mode `0700`, with files at `0600`;
  - Windows: an ACL that grants only the current user, with inheritance disabled.
- Nothing is written to shared temp locations.
- At startup the agent deletes leftovers from earlier runs.
- Uninstall removes the directory.
- Logs never contain document content, tokens or full page file paths (PLAN §4, T51).

**R-L4 Metadata bounds.** Every structure the agent keeps is bounded, so per-family limits cannot
multiply without end:
- Job records, non-disposed and tombstones together, are at most `maxJobRecordsTotal`. When a
  new job would exceed it, the agent first ends the oldest tombstones early (they become
  `404 not-found` sooner). If every record is a non-disposed job, the call returns
  `429 limits-exceeded`.
- A job's event log holds at most its state changes, one `page` event per page (bounded by
  `maxPagesPerJob`), `maxErrorEventsPerJob` non-fatal errors, the fatal error and `done`, and
  one `progress` event.
- Auth and consent records are bounded by R-A14.

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
above, with its own security rules: D-003 S2 properties, consent bound to the opener origin
(D-004), and **its own session boundary**, separate from token families (§3.2). No pre-auth or
arbitrary bridge token minting is allowed (§3.0).

---

## Unreviewed inputs

The rules below depend on inputs that are not yet approved or in force. They stay provisional
until the masters approve them. The r1 review checked them; that does not remove a marker.

**A. SP-1a interim note** (`8cbc264:docs/spikes/SP-1a-interim.md`). In the YAML:
`x-zilo-source: SP-1a-interim (unreviewed)`. The r1 review reproduced its Linux HTTP and headless
Chromium/Firefox evidence; masters have not approved it.

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

The SP-1a evidence covers Chromium 156 and Firefox 157 on Linux only. WebKit and real Safari are
pending, so nothing here says anything about Safari (§11). Pre-auth reflection to an eligible,
not-yet-allowed origin, and DELETE, `Last-Event-ID`, `If-None-Match` and the 600 s max age in the
preflight, are contract design (D-004a or this file), not browser observations of the interim
stub.

**B. D-004a (Proposed; GPT approval pending), with the agreed r1 amendments and the D-004
reconciliation.** In the YAML: `x-zilo-source: D-004a (pending GPT)`.

| Rule | What depends on it |
|---|---|
| §3.0 | The amendment list itself |
| R-V2, §1.3 | Public versus full `hello`, as separate schemas |
| R-T3 | The *eligible* and *dev-eligible* classes; the dev flag as diagnostics only; "loopback never allowed" |
| R-T4, R-T5 | CORS and preflight tiers for eligible, not-yet-allowed origins on pre-auth endpoints |
| §3.1 (R-A1 to R-A6) | The consent endpoints, coalescing, global and per-origin limits, `Retry-After` cool-down, block |
| R-A7 | Token eligibility (no loopback, null or opaque origins); issuance budget |
| R-A8 to R-A16, R-J1 | Token families, shared-tab ownership, renewal bounds, revocation semantics, bounded history (D-004 reconciliation) |
| §9 `consent-pending`, `consent-denied`, `token-invalid`, `token-revoked` rows | |
| YAML: `getHello`, `getConsent`, `requestConsent`, `issueToken`, `renewToken`, `revokeToken`, `Hello`, `HelloPublic`, `HelloFull`, `ConsentStatus`, `Token`, `FamilyId`, `Preflight`, `PreflightDenied` | |

The residual risks D-004a accepts are listed in §3.0 item 5.

---

## Proposed changes to D-005

D-005 fixed the shape. This contract keeps every D-005 path and meaning. The items below are
**proposals for both masters**, which the r1 positions accept subject to the r1 corrections in
this draft. They are not recorded as unconditional approval of this tree.

**Changes:**
1. **`hello` is scope-dependent [D-004a].** D-005 lists `hello` as (product, version, protocol,
   os, arch, capabilities). Here, `version`, `os` and `arch` appear only in `HelloFull`, and
   `protocol` is a `{min, max}` range rather than a single value.
2. **Events add `state`.** D-005 lists `progress, page, error, done`. The T10 spec requires
   `state`, so the full set is `state, progress, page, error, done`.

**Additions (no D-005 path changed):**
- `POST`/`GET /auth/consent`;
- `POST`/`DELETE /auth/token` (a token family, §3.2);
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
- JPEG and PNG export is one page per request (§8), with an explicit one-entry selection.

**D-004 reconciliation (for the masters' rewrite).** D-004's "origin and token" ownership
becomes "origin and token family", stable across renewal and shared by the app's tabs through the
SDK. Revoking means immediate denial and stream close, with physical cleanup within a bounded
time, and copy that says "access revoked". This replaces draft 1's per-tab session and the
earlier "disposes its jobs at TTL" wording.

---

## Hand-offs and open items

**For T05 (copy), applied in T05's own fix round, not here:**
- All 12 codes are confirmed under the same names. Set `t10: "confirmed"`. The code list is
  frozen; r1 added and renamed none.
- Add `copy.js` entries for the new codes:
  - `consent-denied` (blocked variant);
  - `rate-limited`;
  - `invalid-settings`;
  - `unsupported-capability`;
  - `not-found`;
  - `agent-unavailable`.
- `token-revoked` copy must say that **access was revoked**, never that pages were erased or
  that the session's pages are gone (R-A10, R-A12). `token-invalid` stays silent.
- The rest need no UI copy: `host-denied` and `token-invalid` are unreachable or silent, and
  `invalid-request` and `invalid-state` map to `unknown`.
- Consent-pending signal: `202 {state: pending}` and `403 consent-pending` (§3.1).
- Cool-down: `retryAfterSeconds` on `consent-denied` and on `ConsentStatus` in state `denied`,
  not on every `unauthorized-origin`.
- The self-update flag `agent.self-update` is reserved (§1.3).
- **Under D-004a:**
  - Before authorisation, `hello` has no `version`. The "Update Zilo" dialog can show
    `{version}`/`{required}` only after authorisation. Before that, the SDK decides "outdated"
    from `protocol` and the capabilities.
  - Non-https origins get no CORS and no tokens, so `tray.consent.insecure` can never be shown
    for a site that could then use Zilo.
  - Do not advertise self-update or Safari flags before the corresponding approved
    implementation exists.

**For T13/T21 (SDK):** R-A10, R-A15 and R-A16 (shared token family), R-V4 (two-step event
decoding), R-E5 (resume from the last processed `seq`), R-X3 (verify `Content-Length`) and R-X5
(receive-then-DELETE; never send `deleteAfterExport`).

**For the masters:**
1. **Loopback dev origins (D-004a).** Confirmed by Opus and agreed: the demo app and the E2E runs
   use a non-loopback HTTPS origin with a per-run CA (`https://app.zilo.test:8443`). The dev
   flag is diagnostics only.
2. **Ownership.** Resolved by the agreed positions: a shared origin-bound token family (§3.2).
   Masters still rewrite the D-004 and D-004a text to match (Opus, after this fix).
3. **Ports.** T11 sets the fixed port and the 2 fallbacks. The `servers` entry is a placeholder.
4. **SP-1a open questions 1 and 2** (S2 consent for baked origins; S2 as a Chromium and Firefox
   fallback) belong to the Safari path. They are deliberately left out of v1 (§11).

---

## r1 resolution

Each finding of `docs/reviews/T10-r1.md`, the change that resolves it, and the test that covers
it. Test files are in `api/tests/`: `t10-r1-schema.test.mjs` is the reviewer's file;
`t10-fix-r1.test.mjs` is the author's. A "rule model" test runs an executable model of the rule
on its worked examples; it checks that the rule is deterministic and self-consistent, not an
implementation. T11 and T13 should reuse its vectors in their conformance tests.

| # | Finding | Change | Test |
|---|---|---|---|
| 1 | P1 destructive export not retry-safe | R-X3 separates render/size failures from network failures and requires a length check; R-X4 limits retry guarantees to non-destructive exports; R-X5 makes `deleteAfterExport` receipt-ambiguous, and the SDK never sends it (receive-then-DELETE). YAML `exportJob` and `ExportRequest.deleteAfterExport` say the same. | `F1 deleteAfterExport is documented receipt-ambiguous and SDK-forbidden`; `F1 rule model: receive-then-DELETE keeps pages until every body is verified` |
| 2 | P2 expired/superseded credentials confused with disposal | R-A8 timing formula valid for every permitted value and capped by `familyExpiresAt`; R-A9 family ends (deadline, lapse, revocation, exit); R-A10 `token-invalid` (obsolete, says nothing about pages) versus `token-revoked` (revoked access); R-A16 streams at expiry and revocation. | `F2 rule model: token times are valid for every permitted TTL and capped by the family`; `F2 Limits forbid a TTL the renewal schedule cannot serve`; `F2 rule model: renewal outcomes` |
| 3 | P2 shared-tab ownership | §3.2 shared origin-bound token family; separate families isolated; no per-tab session; bridge keeps its own boundary; R-A12 immediate denial with bounded cleanup; R-A15 SDK coordination; `Token.familyId`, `familyExpiresAt`. | `F3 Token carries the family, not a session`; `F3 no session vocabulary remains in the YAML` |
| 4 | P2 unbounded auth history and aggregate work | R-A7 issuance budget; R-A11 minimum renewal interval and one successor per token (409 on concurrent renewal); R-A14 bounded history; R-L1/R-L4 global families, job records, streams, exports, staging in `maxStoreBytes`; renewal declares 409 and 429. | `F4 Limits declare the global and auth budgets`; `F4 renewToken declares 409 and 429` |
| 5 | P2 CORS and Host-first conflicts | §2.1 one removed-origin policy (403 without CORS before any token); YAML `Unauthorized` fixed; Host failure has a body on every method including OPTIONS; R-ER1 names the bodyless refused preflight as the one exception. | `F5 Unauthorized no longer grants CORS to a removed origin`; `F5 PreflightDenied separates host-denied from the bodyless refusal` |
| 6 | P2 SSE close/replay ordering; replayed error IDs | R-E4 atomic compound transitions; R-E5 high-water mark, ascending handoff, no truncation at `done`; R-E7 close rule and when to reopen; R-ER2 `errorId` and originating `requestId`, separate from each delivery's request ID; `AsyncProblem`. | `F6 rule model: replay and close`; `F6 async problems require a stable errorId` |
| 7 | P2 open enums still closed | R-V4: response enums are `anyOf` of `…Known` and `string`; requests use `…Known`; `RequestedSettings` separate from `ScanSettings`; two-step event decoding (`JobEventEnvelope`, then `JobEvent`). | reviewer `R-V4: response Driver accepts an unknown future value`; `F7 every open response enum accepts an unknown value`; `F7 request enums stay closed`; `F7 unknown events survive the envelope and stop at the known-event boundary`; compile check in `tools/consumer.ts` |
| 8 | P2 scope and effective-settings schemas | `Hello` = `HelloPublic` (full-only fields forbidden) or `HelloFull` (all required); `Job.effective`, `Job.adjustments` and every `EffectiveSettings` field required; `ConsentStatus` state-dependent requirements; consumer smoke test fixed. | reviewer `R-V2` ×2 and `R-J6`; `F8 ConsentStatus requires the state's fields`; `F8 full hello with every field is valid` |
| 9 | P2 cancel on tombstone; page bound | R-J2: cancel on a settled job (terminal or tombstone) is a `200` no-op; `TerminalState` excludes `disposed`; R-J8 completion count versus safety bound. | `F9 rule model: cancel outcomes`; `F9 done never carries disposed`; `F9 rule model: page count completion versus safety bound` |
| 10 | P2 nondeterministic defaults and page sizes | R-J7 complete defaults with fallbacks; `SourceCaps.defaults` and `pageSizes` (≥ 1) required; R-J5 canonical table, unknown IDs rejected (`422 invalid-settings`), nearest-size metric with tie rules, custom-size validation, resolution tie rule. | `F10 caps always carry complete defaults`; `F10 rule model: page size resolution`; `F10 rule model: resolution coercion` |
| 11 | P2 export selection | R-X1 snapshot at a defined instant; `page-unavailable` (422), `duplicate-index` (422), `no-pages` (409); `ExportRequest` encodes exactly one entry for JPEG/PNG; R-P1 immutable numbering. | `F11 ExportRequest encodes the one-image selection`; `F11 rule model: selection snapshot` |
| 12 | P2 undeclared global errors | R-ER4 and `x-zilo-global-errors`; every operation declares 429/500/503 and `default`, every POST/DELETE declares 413; `MethodNotAllowed` shared 405; consistent problem headers. | `F12 every operation declares the global errors`; `F12 problem responses carry request ID and CORS headers`; `F12 the error-code list is frozen for T05` |
| 13 | P3 TIFF quality | R-X2 and `ExportRequest.quality`: quality applies to JPEG output and PDF colour/grey images, and is ignored for TIFF and PNG. | `F13 quality is not described as applying to TIFF` |
