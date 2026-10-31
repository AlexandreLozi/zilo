# SP-1a interim handoff for T10: transport facts only

**Author:** T01 worker (Claude). **Date:** 2026-10-31. **Status:** interim. Chromium and Firefox
results exist; WebKit and real Safari do not yet. The full matrix will be in `docs/spikes/SP-1a.md`.

**Evidence:** branch `t01-transport-spike`, `spikes/transport/evidence/linux/{chromium,firefox}/*.json`
(plus a `.jpg` per scenario), and the agent audit log the tests assert on.

**Setup:**
- Browsers: Playwright 1.64.1 with Chrome for Testing **156.0.8078.4** (new headless) and
  Firefox **157.0**, on Ubuntu 24.04 (WSL2).
- The test page is `https://app.zilo.test:8443`, served through a per-run CA. It is never served
  from localhost.
- The page server is forced into the **public** address space, so the browsers see a real
  public → loopback request:
  - Chromium: `--ip-address-space-overrides`;
  - Firefox: `network.lna.address_space.public.override`.
- A control without that override shows a page on loopback is not LNA-gated at all, so testing from
  localhost would have hidden the constraint.

## Facts (observed, both browsers unless stated)

1. **`https://` public page → `http://127.0.0.1:<port>` works** for `fetch` once the loopback
   permission is granted. There is no mixed-content block for the `127.0.0.1` IP literal.
2. **`targetAddressSpace: 'loopback'` is optional for the IP literal.**
   - Chromium 156 recognises it (`Request.targetAddressSpace === 'loopback'`).
   - Firefox 157 ignores it (the property is `undefined`).
   - With and without the option, both browsers return 200.
   - Recommendation: the SDK keeps passing it, because it is harmless and forward-compatible.
3. **SSE over fetch streaming works**, with `Authorization: Bearer` (EventSource cannot set it).
   - 5 ticks arrive incrementally, about 200 ms apart (spread of 801 ms).
   - Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-store`, and the CORS
     headers below.
4. **Binary works.** A 1 MiB `application/octet-stream` body was read with `arrayBuffer()` and its
   pattern verified.
5. **Permission states:**
   - **prompt** (default):
     - Firefox holds the request pending until the user answers the doorhanger.
     - Chromium headful also holds it pending.
     - Chromium *new headless* auto-denies, after which the query reports `denied`. That is an
       automation artifact.
     - ⇒ While the state is `prompt`, the first probe can hang for as long as the user takes. **Do
       not treat a slow first probe as "unreachable"** (D-008 step 5).
   - **granted:** both `loopback-network` and `local-network` query as `granted`, and every call
     succeeds.
   - **denied:** the fetch fails fast with `TypeError`, which looks the same as connection refused.
     - Chromium's `permissions.query` reports `denied`.
     - **Firefox under a pref/policy-level deny still reports `prompt`**, so the SDK cannot always
       tell "blocked" from "agent not running". Keep the `unreachable-or-blocked` state.
   - `permissions.query({name:'loopback-network'|'local-network'})` does not throw in either
     browser.
6. **Insecure (HTTP) page control:**
   - Chromium refuses to grant LNA to an insecure context, and the fetch is blocked.
   - **Firefox 157 allows it once granted.** That is a finding, not a requirement. D-003 already
     requires an HTTPS app.

## What the agent and contract need (T10/T11)

- **Host:** the browser sends exactly `127.0.0.1:<port>` when the SDK uses the IP literal.
  - A rebinding name (`rebind.zilo.test:<port>` → 127.0.0.1) arrived and was refused with
    `403 host-denied`.
  - Keep the exact allowlist `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`.
- **Origin:** cross-origin calls carry `Origin: https://app…`, `Sec-Fetch-Site: cross-site` and
  `Sec-Fetch-Mode: cors`.
  - Reflect only exact allowlisted origins: `Access-Control-Allow-Origin: <origin>` plus
    `Vary: Origin`. Never use `*`.
  - **Include the CORS headers on error responses too** (problem+json), or the SDK cannot read the
    error code.
- **Preflights:**
  - `GET` with `Authorization` preflights with `Access-Control-Request-Headers: authorization`.
  - `POST` JSON preflights with `authorization,content-type`.
  - Answer `204` with `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers: Authorization,
    Content-Type`.
  - Preflights carry no credentials, so `OPTIONS` must be served without a bearer.
  - `hello` as a plain `GET` without headers sends no preflight.
- **No PNA/LNA preflight headers were sent** by either browser (`Access-Control-Request-Private-Network`
  and `…-Local-Network` were absent). The agent should not emit `Access-Control-Allow-Private-Network`,
  and does not need to.
- **Hostile origin:** the agent answers `403` with no CORS headers. The browser surfaces a
  `TypeError`, so the page learns nothing. This holds even when the user granted LNA to that
  origin.

## S2 popup bridge prototype (works in Chromium and Firefox)

**What works:**
- `window.open('http://127.0.0.1:<port>/bridge')` from the HTTPS app on a click.
  - The bridge posts `bridge-ready` only to allowlisted origins, each with an exact `targetOrigin`.
  - The app checks `event.source`, the origin and the schema, then sends `bridge-hello` with a
    128-bit nonce, the app token and a `MessagePort`.
- **Capability minting:** the bridge calls `POST /zilo/v1/bridge/session` with
  `{appOrigin: event.origin, nonce}`.
  - The agent mints only when all of these hold:
    - the request has `Origin: http://127.0.0.1:<port>` and `Sec-Fetch-Site: same-origin`;
    - the app origin is allowlisted;
    - the app token is valid for that origin;
    - the nonce has not been used before.
  - The result is a capability bound to the app origin. A re-mint makes the old one stale.
- **Typed relay:** `hello` was relayed; a 1 MiB `ArrayBuffer` was **transferred** through the port;
  5 SSE ticks were relayed.
  - An oversize request returns `too-large` (cap 8 MiB).
  - An arbitrary op returns `unknown-op`.
  - Window closure is detected.

**Negative cases that held:**
- COOP `same-origin` on the app page is detected explicitly (`coop-severed`); the popup has no
  opener and nothing is minted.
- A hostile opener gets no `bridge-ready`, a forced hello is rejected (`origin-not-allowed`), and
  nothing is minted.
- A forged `bridge-ready` from the wrong window is ignored (`wrong-source`).
- A replayed nonce gets `409 nonce-replayed`.
- A mint attempted from the public page is refused (`403 mint-requires-bridge-origin`).

**Bridge request headers seen by the agent:**

| Request | Origin | Sec-Fetch-Site | Sec-Fetch-Mode |
|---|---|---|---|
| Popup navigation | none | `cross-site` | `navigate` |
| Same-origin `GET` | none | `same-origin` | `cors` |
| Same-origin `POST` | `http://127.0.0.1:<port>` | `same-origin` | `cors` |

⇒ To recognise bridge calls, the agent needs `Sec-Fetch-Site: same-origin` (or the bridge `Origin`),
plus the minted capability.

**Important for D-003/D-004:**
- **S2 needs no LNA permission and shows no browser prompt in Chromium or Firefox.** The top-level
  loopback navigation and the bridge's same-origin calls are not LNA-gated.
- Under S2, the agent's own consent (D-004) is therefore the only user-facing gate. Installer-baked
  origins would see no prompt at all.

## Open questions (for T10/T25 and the masters)

1. Under S2, should installer-baked origins still get a one-time agent consent? The browser's LNA
   prompt no longer exists on that path.
2. Should S2 be offered as a fallback on Chromium and Firefox too? It works there and avoids the LNA
   prompt. A Firefox user who denied the prompt is stuck on the fetch path.
3. **Real Safari 26 is pending**, and Playwright WebKit results are not in yet. Nothing here says
   anything about Safari. Whether `http://127.0.0.1` fetch is mixed-content-blocked in WebKit is the
   open item.
4. The bridge binary transfer is bounded only by a size cap and one in-flight transfer. T25 still
   needs credit-based backpressure for multi-page jobs.
