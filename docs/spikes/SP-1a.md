# SP-1a — transport spike results (T01)

**Status:** feasibility evidence for D-003. This is not release evidence (D-009, D-010). **Date:** 2026-10-31.
**Code:** `spikes/transport/` (see its README). **Logs:** `docs/validation/logs/T01/{linux,windows}.log`.
**Interim note for T10:** `docs/spikes/SP-1a-interim.md`.

## Verdict
- **Chromium 156 and Firefox 157:** an HTTPS public page reaches `http://127.0.0.1` once the user
  grants the loopback permission. That covers `fetch` with or without `targetAddressSpace`, SSE over
  fetch streaming, and binary bodies. The D-003 default candidate holds for these browsers.
- **Playwright WebKit 27.2 (Linux and Windows ports):** the same fetch is **blocked as mixed
  content before it is sent**. The console says `[blocked] … requested insecure content from
  http://127.0.0.1…`, and the agent sees no request. HTTP-primary does not work in the WebKit engine.
- **S2 popup bridge:** it works in all three engines, and every negative control holds. COOP
  `same-origin` breaks it explicitly with `coop-severed`. COOP `same-origin-allow-popups` keeps it
  working.
- **Real Safari 26:** **pending** (manual script below).

## What runs where
| Where | Projects | Result |
|---|---|---|
| Local Linux (WSL2 Ubuntu 24.04), code SHA d17a78e | stub, chromium, firefox, webkit ("Playwright WebKit on Linux (scratch libs)", not Safari) | 49 passed, 4 skipped (n/a), exit 0 |
| Local native Windows 11, code SHA c921bd2 | stub, webkit ("Playwright WebKit on Windows", not Safari) | 17 passed, 3 skipped. A re-run at d17a78e is **pending**; it would add the COOP allow-popups row. |
| Hosted `ubuntu-latest`, `windows-latest`, `macos-latest` (`.github/workflows/spike-transport.yml`) | linux: all; windows and macOS: stub plus webkit. macOS is observe-only. | **pending**: no remote (D-010) |
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
- **Permission states:**
  - granted: `context.grantPermissions(['local-network-access'])`;
  - denied: CDP `Browser.setPermission` in Chromium, `permissions.default.*` prefs in Firefox;
  - prompt: the default.
- All browsers run headless (OD-4). The one headful Chromium test runs only on an Xvfb virtual
  display.
- **Evidence:** a JSON file and a screenshot per cell, the agent's audit log, and the browser's
  console lines.

## Results matrix
`pass` means the property in the row holds. For control and negative rows, that is the expected
behaviour or denial. `fail` cells in the WebKit fetch rows are **expected failures that the tests
assert**. Regenerate the matrix with `node spikes/transport/scripts/matrix.ts`.

| Scenario | Chromium 156.0.8078.4 | Firefox 157.0 | PW WebKit · Linux 27.2 | PW WebKit · Windows 27.2 | PW WebKit · macOS pending | Real Safari 26 |
|---|---|---|---|---|---|---|
| HTTPS page on a public non-loopback origin is a secure context | pass ([json](../../spikes/transport/evidence/linux/chromium/env.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/env.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/env.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/env.json)) | pending | **pending** |
| fetch `hello` with `targetAddressSpace:'loopback'` (granted where grantable) | pass · 200 ([json](../../spikes/transport/evidence/linux/chromium/hello-tas.json)) | pass · 200 ([json](../../spikes/transport/evidence/linux/firefox/hello-tas.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/hello-tas.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/hello-tas.json)) | pending | **pending** |
| fetch `hello` without the option (granted where grantable) | pass · 200 ([json](../../spikes/transport/evidence/linux/chromium/hello-plain.json)) | pass · 200 ([json](../../spikes/transport/evidence/linux/firefox/hello-plain.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/hello-plain.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/hello-plain.json)) | pending | **pending** |
| SSE over fetch streaming with `Authorization`, 5 incremental ticks | pass · 200, spread 802 ms ([json](../../spikes/transport/evidence/linux/chromium/sse-fetch-stream.json)) | pass · 200, spread 800 ms ([json](../../spikes/transport/evidence/linux/firefox/sse-fetch-stream.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/sse-fetch-stream.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/sse-fetch-stream.json)) | pending | **pending** |
| 1 MiB binary over fetch | pass · 200 ([json](../../spikes/transport/evidence/linux/chromium/blob.json)) | pass · 200 ([json](../../spikes/transport/evidence/linux/firefox/blob.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/linux/webkit/blob.json)) | fail · mixed-content blocked, never sent ([json](../../spikes/transport/evidence/win32/webkit/blob.json)) | pending | **pending** |
| Permission **prompt** (default): never silently allowed | pass · headless auto-deny ([json](../../spikes/transport/evidence/linux/chromium/perm-prompt.json)) | pass · held on prompt ([json](../../spikes/transport/evidence/linux/firefox/perm-prompt.json)) | n/a · query=prompt; fetch TypeError ([json](../../spikes/transport/evidence/linux/webkit/perm-prompt.json)) | n/a · query=prompt; fetch TypeError ([json](../../spikes/transport/evidence/win32/webkit/perm-prompt.json)) | pending | **pending** |
| Permission prompt, headful Chromium: request held on the real prompt | pass ([json](../../spikes/transport/evidence/linux/chromium/perm-prompt-headful.json)) | n/a | n/a | n/a | pending | **pending** |
| Permission **denied**: refused fast | pass · query=denied; TypeError ([json](../../spikes/transport/evidence/linux/chromium/perm-denied.json)) | pass · query=prompt; TypeError ([json](../../spikes/transport/evidence/linux/firefox/perm-denied.json)) | n/a | n/a | pending | **pending** |
| S2 bridge: handshake + typed `hello` + 1 MiB ArrayBuffer transfer + SSE relay + bounds | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-bridge.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-bridge.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-bridge.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-bridge.json)) | pending | **pending** |
| S2 bridge: window closure detected | pass ([json](../../spikes/transport/evidence/linux/chromium/s2-closure.json)) | pass ([json](../../spikes/transport/evidence/linux/firefox/s2-closure.json)) | pass ([json](../../spikes/transport/evidence/linux/webkit/s2-closure.json)) | pass ([json](../../spikes/transport/evidence/win32/webkit/s2-closure.json)) | pending | **pending** |
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
- S2 is proven in the WebKit engine, with D-003's mandatory properties prototyped and tested
  negatively:
  - exact source, origin and nonce checks;
  - a capability minted server-side;
  - typed ops only;
  - a bounded, transferred `ArrayBuffer`;
  - explicit COOP and closure failures.
- S2 leaves no trust-store state behind and is easy to reverse, as D-003's deadlock rule prefers.
- S1 needs interactive root trust on macOS. Whether Keychain and Safari honour name constraints is
  unproven, and no macOS machine was available here. S1 also needs rotation and uninstall
  proofs, and it adds a trusted root to the user's machine.

**Costs of S2:**
- an extra window;
- it must be opened on a click, because of popup blockers;
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
- TLS trust for WebKit used `ignoreHTTPSErrors`.
- The macOS WebKit job is observe-only until its first run.

## Real Safari 26: manual script (pending; owner or a Mac runner)
1. `cd spikes/transport && npm ci && node scripts/gen-certs.ts`
2. `sudo sh -c 'echo "127.0.0.1 app.zilo.test evil.zilo.test rebind.zilo.test" >> /etc/hosts'`
3. `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain .certs/ca.pem`
   (this is a test-only CA; remove it in step 9).
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
   - close bridge.
7. Repeat the bridge on:
   - `/coop`, which is expected to give `coop-severed`;
   - `/coop-allow-popups`, which is expected to give `ok`;
   - `https://evil.zilo.test:8443/`, which is expected to fail and mint nothing.

   Also open `http://app.zilo.test:8080/` and click hello. Finally, visit
   `http://rebind.zilo.test:47613/zilo/v1/hello`, which is expected to return `403 host-denied`.
8. **S1 trust scope (optional):**
   1. Run `node scripts/gen-s1-certs.ts` and trust `.certs-s1/ca.pem` as in step 3. This root is
      name-constrained to 127.0.0.1 and localhost.
   2. Restart the app server with
      `ZILO_LEAF_CERT=.certs-s1/out-of-scope.pem ZILO_LEAF_KEY=.certs-s1/out-of-scope.key`.
   3. Open `https://app.zilo.test:8443/`. Safari **must reject** it if it honours the constraints.
      OpenSSL already rejects it: `permitted subtree violation`.
9. Clean up:
   - `sudo security delete-certificate -c "Zilo SP-1a throwaway test CA" /Library/Keychains/System.keychain`
     (and the S1 CA, if you added it);
   - remove the hosts lines;
   - attach `artifacts/agent-audit.jsonl`.

Record each result as pass, fail or n/a in the "Real Safari 26" column.
