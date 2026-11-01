# SP-1a — transport spike results (T01)

**Status:** feasibility evidence for D-003. This is not release evidence (D-009, D-010). **Date:** 2026-10-31;
**fix r1** (review `docs/reviews/T01-r1.md`) 2026-11-01, see [Fix r1](#fix-r1-review-findings--changes).
**fix r2** (review `docs/reviews/T01-r2.md`) 2026-11-01, see [Fix r2](#fix-r2-review-findings--changes).
**Code:** `spikes/transport/` (see its README). **Logs:** `docs/validation/logs/T01/{linux,windows}.log`.
**Interim note for T10:** `docs/spikes/SP-1a-interim.md`.

## Verdict
- **Chromium 156 and Firefox 157:** an HTTPS public page reaches `http://127.0.0.1` once the user
  grants the loopback permission. That covers `fetch` with or without `targetAddressSpace`, SSE over
  fetch streaming, and binary bodies. The D-003 default candidate holds for these browsers.
- **Playwright WebKit 27.2 (Linux and Windows ports):** the same fetch is **blocked as mixed
  content before it is sent**. The console says `[blocked] … requested insecure content from
  http://127.0.0.1…`, and the agent sees no request. HTTP-primary does not work in the WebKit engine.
  This is an HTTPS-hostname / mixed-content observation only: the WebKit page was **not** in the
  public address space (its resolver proxy connects to 127.0.0.1 and WebKit has no override), so
  **public → loopback semantics are unproven for WebKit and Safari**.
- **S2 popup bridge:** it works in all three engines, and every negative control holds. COOP
  `same-origin` breaks it explicitly with `coop-severed`. COOP `same-origin-allow-popups` keeps it
  working. Since fix r1 the popup is opened synchronously on the click, every op is bound to the
  session, binary and event relays are acknowledged (bounded queue toward a slow app), and
  navigation or reload of the popup is detected (with a fresh handshake on reload). These are
  prototype properties in Playwright engines, not a proven D-003-safe Safari transport.
- **Real Safari 26:** **pending** (manual script below).

## What runs where
| Where | Projects | Result |
|---|---|---|
| Local Linux (WSL2 Ubuntu 24.04), code SHA 17accfa (fix r2) | stub, chromium (including the reviewer's `review-s2.spec.ts`), firefox, webkit ("Playwright WebKit on Linux (scratch libs)", not Safari). Headless only (OD-4). | **60 passed, 5 skipped**, exit 0. Skipped: the headful Chromium prompt test (3 projects; not run headless-only) and 2 WebKit n/a rows. |
| Local native Windows 11, code SHA c921bd2, **observed before OD-6** | stub, webkit ("Playwright WebKit on Windows", not Safari) | 17 passed, 3 skipped. Not re-run: OD-6 forbids native Windows runs. The COOP allow-popups and fix r1 rows have no Windows evidence. |
| Hosted `ubuntu-latest`, `windows-latest`, `macos-latest` (`.github/workflows/spike-transport.yml`) | linux: all; windows and macOS: stub plus webkit. macOS is observe-only. | **pending**: not yet observed for this head (OD-7). |
| Real Safari 26 | manual | **pending** |

## Method
- **Test origin:** `https://app.zilo.test:8443`, plus `evil.zilo.test`, the COOP variants and an HTTP
  control on `:8080`. Each run uses its own CA.
- **Never served from localhost.** The page server is forced into the *public* address space:
  - Chromium: `--ip-address-space-overrides`;
  - Firefox: `network.lna.address_space.public.override`.
  - The row "Method control" proves this matters: without the override, LNA does not apply at all.
- **Hostname mapping and TLS trust:**
  - Chromium: host-resolver-rules, and the leaf is trusted through an SPKI pin;
  - Firefox: `network.dns.localDomains`, and the CA is installed by enterprise policy;
  - WebKit: a resolver proxy, plus `ignoreHTTPSErrors`. `isSecureContext` is verified true.
    The proxy really connects to 127.0.0.1 and WebKit has no address-space override or
    diagnostic, so the WebKit page is a non-localhost HTTPS **name** in the **loopback** address
    space. A non-localhost URL alone does not make the source public; WebKit rows never claim it.
- **Permission states:**
  - granted: `context.grantPermissions(['local-network-access'])`;
  - denied: CDP `Browser.setPermission` in Chromium, `permissions.default.*` prefs in Firefox;
  - prompt: the default.
- All browsers run headless (OD-4). The one headful Chromium test runs only on an Xvfb virtual
  display; fix r1 did not run it (headless only), so its row is the d17a78e observation.
- **Evidence:** a JSON file and a screenshot per cell, the agent's audit log, and the browser's
  console lines.

## Results matrix
`pass` means the property in the row holds. For control and negative rows, that is the expected
behaviour or denial. `fail` cells in the WebKit fetch rows are **expected failures that the tests
assert**. Regenerate the matrix with `node spikes/transport/scripts/matrix.ts`.

| Scenario | Chromium 156.0.8078.4 | Firefox 157.0 | PW WebKit · Linux 27.2 | PW WebKit · Windows 27.2 (observed before OD-6) | PW WebKit · macOS pending | Real Safari 26 |
|---|---|---|---|---|---|---|
| HTTPS page on a non-loopback hostname is a secure context (public address space only where forced) | pass · address space public (forced) ([json](../../spikes/transport/evidence/linux/chromium/env.json)) | pass · address space public (forced) ([json](../../spikes/transport/evidence/linux/firefox/env.json)) | pass · secure context only; public address space **unproven** ([json](../../spikes/transport/evidence/linux/webkit/env.json)) | pass · secure context only; public address space **unproven** ([json](../../spikes/transport/evidence/win32/webkit/env.json)) | pending | **pending** |
| fetch `hello` with `targetAddressSpace:'loopback'` (granted where grantable) | pass · 200 ([json](../../spikes/transport/evidence/linux/chromium/hello-tas.json)) | pass · 200 ([json](../../spikes/transport/evidence/linux/firefox/hello-tas.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/hello-tas.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/hello-tas.json)) | pending | **pending** |
| fetch `hello` without the option (granted where grantable) | pass · 200 ([json](../../spikes/transport/evidence/linux/chromium/hello-plain.json)) | pass · 200 ([json](../../spikes/transport/evidence/linux/firefox/hello-plain.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/hello-plain.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/hello-plain.json)) | pending | **pending** |
| SSE over fetch streaming with `Authorization`, 5 incremental ticks | pass · 200, spread 801 ms ([json](../../spikes/transport/evidence/linux/chromium/sse-fetch-stream.json)) | pass · 200, spread 801 ms ([json](../../spikes/transport/evidence/linux/firefox/sse-fetch-stream.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/sse-fetch-stream.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/sse-fetch-stream.json)) | pending | **pending** |
| 1 MiB binary over fetch | pass · 200 ([json](../../spikes/transport/evidence/linux/chromium/blob.json)) | pass · 200 ([json](../../spikes/transport/evidence/linux/firefox/blob.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/blob.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/blob.json)) | pending | **pending** |
| Permission **prompt** (default): never silently allowed | pass · headless auto-deny ([json](../../spikes/transport/evidence/linux/chromium/perm-prompt.json)) | pass · held on prompt ([json](../../spikes/transport/evidence/linux/firefox/perm-prompt.json)) | n/a · query=prompt; fetch TypeError ([json](../../spikes/transport/evidence/linux/webkit/perm-prompt.json)) | n/a · query=prompt; fetch TypeError ([json](../../spikes/transport/evidence/win32/webkit/perm-prompt.json)) | pending | **pending** |
| Permission prompt, headful Chromium: request held on the real prompt | pass ([json](../../spikes/transport/evidence/linux/chromium/perm-prompt-headful.json)) | n/a | n/a | n/a | pending | **pending** |
| Permission **denied**: refused fast | pass · query=denied; TypeError ([json](../../spikes/transport/evidence/linux/chromium/perm-denied.json)) | pass · query=prompt; TypeError ([json](../../spikes/transport/evidence/linux/firefox/perm-denied.json)) | n/a | n/a | pending | **pending** |
| S2 bridge: handshake + typed `hello` + 1 MiB ArrayBuffer transfer + SSE relay + bounds | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-bridge.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-bridge.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-bridge.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-bridge.json)) | pending | **pending** |
| S2 bridge: window closure detected | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-closure.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-closure.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-closure.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-closure.json)) | pending | **pending** |
| S2 envelope (fix r1): version, unique request ID and bound session required; mismatches refused | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-session-envelope.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-session-envelope.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-session-envelope.json)) | not run (OD-6) | pending | **pending** |
| S2 backpressure (fix r1): binary slot held until ack; stalled event consumer cut off | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-backpressure.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-backpressure.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-backpressure.json)) | not run (OD-6) | pending | **pending** |
| S2 navigation/reload (fix r1): bound state invalidated; reload re-handshakes; reopen recovers | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-navigation-reconnect.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-navigation-reconnect.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-navigation-reconnect.json)) | not run (OD-6) | pending | **pending** |
| S2 with COOP `same-origin`: explicit `coop-severed` failure, nothing minted | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-coop.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-coop.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-coop.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-coop.json)) | pending | **pending** |
| S2 with COOP `same-origin-allow-popups`: bridge still works | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-coop-allow-popups.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-coop-allow-popups.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-coop-allow-popups.json)) | n/a | pending | **pending** |
| S2 hostile opener: no ready, forced hello rejected, nothing minted | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-hostile-opener.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-hostile-opener.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-hostile-opener.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-hostile-opener.json)) | pending | **pending** |
| S2 forged `bridge-ready` from the wrong window ignored | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-wrong-source.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-wrong-source.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-wrong-source.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-wrong-source.json)) | pending | **pending** |
| S2 nonce replay refused by the agent (409) | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-nonce-replay.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-nonce-replay.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-nonce-replay.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-nonce-replay.json)) | pending | **pending** |
| Negative: hostile HTTPS origin cannot read the agent | pass · agent 403 origin-denied ([json](../../spikes/transport/evidence/linux/chromium/neg-hostile-origin.json)) | pass · agent 403 origin-denied ([json](../../spikes/transport/evidence/linux/firefox/neg-hostile-origin.json)) | pass · browser-blocked (mixed content) ([json](../../spikes/transport/evidence/linux/webkit/neg-hostile-origin.json)) | pass · browser-blocked (mixed content) ([json](../../spikes/transport/evidence/win32/webkit/neg-hostile-origin.json)) | pending | **pending** |
| Negative: DNS-rebinding Host refused (403 host-denied) | pass ([json](../../spikes/transport/evidence/linux/chromium/neg-bad-host.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/neg-bad-host.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/neg-bad-host.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/neg-bad-host.json)) | pending | **pending** |
| Negative: public page cannot mint a bridge capability | pass · agent 403 mint-requires-bridge-origin ([json](../../spikes/transport/evidence/linux/chromium/neg-forged-mint.json)) | pass · agent 403 mint-requires-bridge-origin ([json](../../spikes/transport/evidence/linux/firefox/neg-forged-mint.json)) | pass · browser-blocked (mixed content) ([json](../../spikes/transport/evidence/linux/webkit/neg-forged-mint.json)) | pass · browser-blocked (mixed content) ([json](../../spikes/transport/evidence/win32/webkit/neg-forged-mint.json)) | pending | **pending** |
| Control: HTTP (insecure) page → loopback (browser policy only) | pass · LNA not grantable; blocked ([json](../../spikes/transport/evidence/linux/chromium/neg-http-control.json)) | pass · reaches loopback after grant ([json](../../spikes/transport/evidence/linux/firefox/neg-http-control.json)) | pass · reaches loopback, no prompt ([json](../../spikes/transport/evidence/linux/webkit/neg-http-control.json)) | pass · reaches loopback, no prompt ([json](../../spikes/transport/evidence/win32/webkit/neg-http-control.json)) | pending | **pending** |
| Method control: page on loopback address space is not LNA-gated | pass · no prompt, 200 ([json](../../spikes/transport/evidence/linux/chromium/control-no-override.json)) | pass · no prompt, 200 ([json](../../spikes/transport/evidence/linux/firefox/control-no-override.json)) | n/a | n/a | pending | **pending** |

## Key findings
1. `targetAddressSpace` is optional for the `127.0.0.1` literal. Chromium recognises it; Firefox
   ignores it. Keep sending it.
2. While the state is `prompt`, the first request is held until the user answers, which can take
   seconds or longer. The SDK must not report "unreachable" early.
3. A Firefox deny set by pref or policy still reports `prompt` in `permissions.query`. The SDK
   cannot always tell "blocked" from "not running", so it keeps D-008's `unreachable-or-blocked`
   state.
4. Neither browser sends a PNA/LNA preflight header. CORS must reflect the exact origin, including
   on error responses.
5. Chromium refuses LNA to an HTTP page. Firefox 157 allows it after a grant. WebKit lets an HTTP
   page reach loopback with no prompt.
6. **S2 needs no LNA permission in any engine.** The agent's consent (D-004) is the only gate on
   that path.
7. The bridge's exact-`targetOrigin` announcement logs `Unable to post message…` console errors in
   WebKit for the non-matching allowlisted origins. Page script cannot read these lines.

## Recommendation: S2 over S1 for Safari (for both masters to decide)
**Recommend S2** (popup bridge) as the Safari path for T25. Do not pursue S1 for v1 unless S2
fails on real Safari.

**Why:**
- S2 transfers binary and relays events in the tested Playwright WebKit port without trust-store
  changes. The following D-003 properties are **prototyped and tested** (including negatively) in
  Chromium, Firefox and Playwright WebKit on Linux:
  - exact source, origin and nonce checks;
  - a capability minted server-side, bound to the app origin and to one session;
  - every op carries the protocol version, a unique request ID and the bound session ID;
    mismatched, missing or reused values are refused (fix r1);
  - typed ops only;
  - a bounded, transferred `ArrayBuffer`, with flow control: one unacknowledged binary reply,
    at most 2 unacknowledged events, and a stalled consumer cut off (fix r1);
  - explicit COOP, closure and navigation failures; a reload re-handshakes with a fresh session
    (fix r1);
  - the popup opens on the click itself, before any network wait (fix r1). The real-popup-blocker,
    slow-network proof runs in **Chromium only**; Firefox and WebKit run with Playwright's defaults.
- **Not proven, so S2 is a candidate, not a proven D-003-safe Safari transport:** real Safari 26
  (popup blocker, isolation, ITP, Private Relay, Lockdown Mode); public → loopback semantics in
  WebKit/Safari; production consent, pairing, denial and revocation (D-004); the production
  credit scheme for multi-page jobs (T25; the spike's window is a single slot); the bridge's own
  detection of the opener navigating away; and agent-side revocation when the bridge unloads (the
  stub relies on re-mint revocation and the 10-minute TTL).
- S2 leaves no trust-store state behind and is easy to reverse, as D-003's deadlock rule prefers.
- S1 needs interactive root trust on macOS. Whether Keychain and Safari honour name constraints is
  unproven, and no macOS machine was available here. S1 also needs rotation and uninstall
  proofs, and it adds a trusted root to the user's machine.

**Costs of S2:**
- an extra window;
- it must be opened synchronously in the click handler, before any `await`, because popup
  blockers need live user activation (review finding 1 reproduced the failure);
- the owner's app must not send COOP `same-origin` on the scan page. `same-origin-allow-popups`
  works.

**Open question:** should S2 also be a Chromium/Firefox fallback when LNA is denied, and should
installer-baked origins still get one agent consent prompt?

## What Playwright WebKit cannot prove
- **It is not Safari.**
  - The network stacks differ: libsoup and curl versus CFNetwork.
  - It lacks Safari's UI and policies: the popup blocker (Chromium also runs with
    `--disable-popup-blocking` under Playwright), ITP, Private Relay and Lockdown Mode.
  - It has no Keychain trust, so S1 cannot be tested.
  - WebKit 27.2 is not the same as shipping Safari 26.x.
- The mixed-content logic lives in WebCore, so the same result in Safari is a strong prior, not
  proof.
- **Public → loopback address-space semantics are unproven.** Playwright WebKit has no
  address-space override, and its page reached the agent's host through a proxy to 127.0.0.1. Only
  the mixed-content and secure-context observations carry over; the Chromium/Firefox methodology
  control shows why the source's address space matters.
- TLS trust for WebKit used `ignoreHTTPSErrors`.
- The macOS WebKit job is observe-only until its first run.

## Real Safari 26: manual script (pending; owner or a Mac runner)
The script has two parts. **Part A** maps `app.zilo.test` to 127.0.0.1 through `/etc/hosts`, so the
page is in the **loopback** address space: it is an HTTPS-hostname, mixed-content and S2 experiment
only, and cannot close the public → loopback gate. **Part B** serves the same page from a genuinely
public HTTPS origin; only Part B can close that gate. Neither part has been executed.

**Part A — HTTPS hostname, mixed content and S2 (loopback-sourced page)**
1. `cd spikes/transport && npm ci && node scripts/gen-certs.ts`
2. `sudo sh -c 'echo "127.0.0.1 app.zilo.test evil.zilo.test rebind.zilo.test" >> /etc/hosts'`
3. `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain .certs/ca.pem`
   (this is a test-only CA; remove it in step 10).
4. In two terminals, run `node agent-stub/server.ts` and `node app/server.ts`.
5. Open Safari at `https://app.zilo.test:8443/`. Record the Safari and macOS versions, and open Web
   Inspector.
6. Type the token (`spike-app-token-…` from `config.ts`). Then click each button in turn and record
   the page log line and the console:
   - hello (both variants);
   - SSE;
   - blob;
   - query permissions;
   - forged mint;
   - open bridge, which is expected to give `ok:true`. Note whether a popup or a prompt appeared;
   - in the bridge window, reload it: the page log should show `bridge-lost` then
     `bridge-reconnect` with `ok:true`; then navigate the bridge window to `about:blank`: the page
     log should show `bridge-lost` (Safari's own popup and navigation behaviour);
   - close bridge.
7. Repeat the bridge on:
   - `/coop`, which is expected to give `coop-severed`;
   - `/coop-allow-popups`, which is expected to give `ok`;
   - `https://evil.zilo.test:8443/`, which is expected to fail and mint nothing.

   Also open `http://app.zilo.test:8080/` and click hello. Finally, visit
   `http://rebind.zilo.test:47613/zilo/v1/hello`, which is expected to return `403 host-denied`.

**Part B — genuinely public source (closes the public → loopback gate)**

8. Put a public HTTPS front in front of the page server: any HTTPS tunnel or host whose hostname
   resolves to a **public** IP and that forwards to `https://127.0.0.1:8443` with the public
   `Host` (for example a quick tunnel: `cloudflared tunnel --url https://127.0.0.1:8443
   --no-tls-verify`; if the page answers `unknown host`, add `--http-host-header <name>.example`).
   Note the public origin, for example `https://<name>.example`. Check with `dig +short
   <name>.example` that it is not a loopback or private address.
   1. Restart **both** servers with `ZILO_PUBLIC_APP_ORIGIN=https://<name>.example` (the stub
      allowlists it; the page server accepts its Host).
   2. Open `https://<name>.example/` in Safari, type the `spike-public-token-…` fixture from
      `config.ts`, and repeat step 6 (hello, SSE, blob, permissions, bridge) and the `/coop` and
      `/coop-allow-popups` variants. Record whether the fetches are blocked as mixed content and
      whether any local-network prompt appears.
   3. Stop the tunnel. The page is public while it runs; it carries no secret, only spike fixtures.
9. **S1 trust scope (optional):**
   1. Run `node scripts/gen-s1-certs.ts` and trust `.certs-s1/ca.pem` as in step 3. This root is
      name-constrained to 127.0.0.1 and localhost.
   2. Restart the app server with
      `ZILO_LEAF_CERT=.certs-s1/out-of-scope.pem ZILO_LEAF_KEY=.certs-s1/out-of-scope.key`.
   3. Open `https://app.zilo.test:8443/`. Safari **must reject** it if it honours the constraints.
      OpenSSL already rejects it: `permitted subtree violation`. This negative check alone is not
      the positive, negative, rotation and uninstall trust proof D-003 requires for S1.
10. Clean up:
    - `sudo security delete-certificate -c "Zilo SP-1a throwaway test CA" /Library/Keychains/System.keychain`
      (and the S1 CA, if you added it);
    - remove the hosts lines;
    - attach `artifacts/agent-audit.jsonl`.

Record each result as pass, fail or n/a in the "Real Safari 26" column. Part A results must be
labelled "loopback-sourced"; only Part B results may fill the public → loopback rows.

## Fix r1: review findings → changes
Review: `docs/reviews/T01-r1.md` (verdict `changes`). Its three regression tests,
`spikes/transport/tests/review-s2.spec.ts`, are unchanged; they failed at b6c3aec (3 of 3) and pass
at 3c753ff in the `chromium` project, which now includes them.

| # | Finding | Change | Evidence |
|---|---|---|---|
| 1 | The COOP `HEAD` before `window.open` can consume the click's user activation (popup-blocked with a real blocker and a slow response). | `app/app.js`: `window.open` is the first statement of the click handler; the COOP diagnostic starts after it and is bounded to 3 s (`unknown:timeout`), and is awaited only to classify a failure. | `review-s2.spec.ts` "S2: opening the popup…" passes (real popup blocker, 6 s HEAD delay). |
| 2 | Binary requests are not bound to the session; `busy` is released at `postMessage`, so nothing bounds bytes queued toward a slow app. | `agent-stub/bridge.js`: every op needs `v`, a unique positive `id` and the bound `sessionId` (`session-mismatch`, `bad-version`, `duplicate-request-id`); every reply carries `v`, `id` and `sessionId`, which the app checks. The binary slot is released only by the app's `ack`; events stop after 2 unacked and the stream is cancelled after 2 s (`consumer-stalled`). `agent-stub/server.ts`: the capability is valid only with its own session in `X-Zilo-Bridge-Session`. | `review-s2.spec.ts` "D-003: a binary request…" passes; new rows `s2-session-envelope` and `s2-backpressure` pass in all three engines; `stub-http.spec.ts` asserts `bridge-session-mismatch`. The production credit scheme stays a T25 item. |
| 3 | Navigation leaves an unusable bridge reported as `bound`. | `bridge.js` posts `bridge-gone` on `pagehide`; `app.js` also pings every 500 ms and reports `lost` after 1.5 s of silence; a fresh `bridge-ready` from the same popup (reload) runs a new handshake with a fresh nonce and session; a new click reopens and rebinds. | `review-s2.spec.ts` "D-003: navigation…" passes; new row `s2-navigation-reconnect` (reload → new session; `about:blank` → `lost`; ping fallback with the notice suppressed → `no-pong`; reopen → bound; three distinct sessions, three 201 mints) passes in all three engines. |
| 4 | The WebKit and manual-Safari recipes do not establish a public source address space. | WebKit `env` evidence records `addressSpace: unproven…` and its matrix cell says so; the Verdict, Method and "cannot prove" sections state public → loopback as unproven for WebKit and Safari; the manual script is split into Part A (loopback-sourced: mixed content and S2 only) and Part B (a genuinely public HTTPS front via `ZILO_PUBLIC_APP_ORIGIN`). | Matrix row 1; this file. Part B is unexecuted. |

Not changed by fix r1: the Windows column is the pre-OD-6 observation at c921bd2 (no native rerun,
OD-6); hosted CI and macOS remain pending; the headful Chromium prompt row is the d17a78e
observation.

## Fix r2: review findings → changes
Review: `docs/reviews/T01-r2.md` (verdict `changes`; r1 findings 1–4 closed). The reviewer showed a
test-synchronization defect, not a product defect: no forged source was accepted. Bridge semantics,
the source/origin/schema checks and `review-s2.spec.ts` are unchanged.

| # | Finding | Change | Evidence |
|---|---|---|---|
| 1 | The forged-ready negative control races the legitimate ready: if the real `bridge-ready` arrives first, `waitFor` drops its listener, the forged ready is never checked, and no `wrong-source` rejection is logged (1 of 5 local failures). | `app/app.js` (test harness only, active only with `injectFakeReady`): `waitFor` holds an accepted legitimate ready, and keeps listening, until a message is rejected at the `ready` step. The forged ready therefore always goes through the same checks, whichever arrives first. If it is never rejected, the held ready is released at the 5 s timeout and the test fails (no rejection). The test still requires a `wrong-source` rejection at `ready` and, in strict engines, a completed bridge. | Local Linux at 17accfa (`linux.log`): full headless suite **60 passed, 5 skipped**, exit 0; `wrong event.source` test `--repeat-each=20` in chromium, firefox and webkit: **60 passed, 0 failed**, each with exactly one rejection `{at: ready, code: wrong-source}`. |

Not changed by fix r2: the Windows column (pre-OD-6, c921bd2), hosted macOS observe-only rows, and the
pending real-Safari / public-source gate.
