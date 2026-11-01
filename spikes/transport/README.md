# SP-1a transport spike (T01) — throwaway

This spike checks whether an HTTPS public web page can reach a local agent on loopback in
Chromium, Firefox and WebKit, through fetch, SSE over fetch streaming, binary bodies and the S2
popup bridge. Results and the recommendation are in [`docs/spikes/SP-1a.md`](../../docs/spikes/SP-1a.md).
This is spike code, not a production package. Nothing here is imported by `packages/` or `backend/`.

## Layout
| Path | What |
|---|---|
| `agent-stub/server.ts` | Loopback HTTP agent stub on `127.0.0.1:47613`. It enforces an exact Host allowlist, an exact Origin allowlist with CORS reflection, and a bearer check on everything except `hello`. Endpoints: `GET /zilo/v1/hello`, `/events` (5 SSE ticks), `/blob?size=N`, `POST /zilo/v1/bridge/session` (bridge capability mint) and `GET /bridge`. Each decision is written to `artifacts/agent-audit.jsonl`. |
| `agent-stub/bridge.{html,js}` | S2 bridge page. It announces itself to allowlisted origins only, checks source, origin, schema and nonce, mints a capability, and relays typed ops over a `MessagePort`: `hello`, a bounded `blob` (transferred `ArrayBuffer`) and `events`. Every op envelope needs `v`, a unique `id` and the bound `sessionId`; a binary reply holds the single binary slot until the app acks it, and events stop after 2 unacked (`consumer-stalled` after 2 s). It sends `bridge-gone` on `pagehide`. |
| `app/server.ts`, `app/index.html`, `app/app.js` | Test page. The bridge popup is opened synchronously on the click (the COOP diagnostic runs afterwards, bounded to 3 s); a missed ping (1.5 s) or `bridge-gone` marks the bridge `lost`, and a reloaded bridge is re-handshaken with a fresh session. It is served over HTTPS for `app.zilo.test` (allowed) and `evil.zilo.test` (hostile). `/coop` and `/coop-allow-popups` are the COOP variants. It is also served over HTTP on `:8080` as the insecure control. |
| `scripts/gen-certs.ts` | Per-run throwaway CA and leaf, written to `.certs/` (gitignored). |
| `scripts/resolver-proxy.ts` | Maps `*.zilo.test` to 127.0.0.1 for WebKit, which has no host-resolver switch. It changes name resolution only. |
| `scripts/gen-s1-certs.ts` | Material for the manual S1 name-constraint experiment, written to `.certs-s1/`. |
| `scripts/matrix.ts` | Builds the SP-1a matrix from `evidence/`. |
| `tests/*.spec.ts` | Playwright projects `stub` (no browser), `chromium`, `firefox` and `webkit`. `tests/review-s2.spec.ts` holds the T01-r1 reviewer's regression proofs and runs in the `chromium` project only. |
| `evidence/<os>/<project>/<scenario>.{json,jpg}` | Committed evidence for each scenario and browser, written by the tests. |

## Run (Linux)
```sh
cd spikes/transport
npm ci
npx playwright install --with-deps chromium firefox webkit   # CI; locally see "WebKit without root"
xvfb-run -a sh -c 'ZILO_HEADFUL_DISPLAY="$DISPLAY" npx playwright test'
node scripts/matrix.ts            # markdown matrix from evidence/
```
- Every browser runs headless (owner directive OD-4).
- The only headful test is the Chromium real-prompt check. It runs only when
  `ZILO_HEADFUL_DISPLAY` names a virtual X display (xvfb), and it strips `WAYLAND_DISPLAY` so no
  window can appear on screen.

### WebKit without root (WSL, as used for the local evidence)
1. Download the missing host libraries with `apt-get download` and extract them with `dpkg -x`
   into a scratch directory. The list comes from `npx playwright install-deps --dry-run webkit` and
   `ldd`, plus `libgles2` and `glib-networking` for TLS.
2. Hard-link-copy the browser directory (`cp -al ~/.cache/ms-playwright/webkit-<rev> <scratch>/webkit-copy`).
3. Replace `minibrowser-*/MiniBrowser` in the copy with a version that appends
   `$ZILO_EXTRA_LD_PATH` to `LD_LIBRARY_PATH`.
4. Run:
```sh
GIO_EXTRA_MODULES=<scratch>/gio ZILO_WEBKIT_EXECUTABLE=<scratch>/webkit-copy/pw_run.sh \
ZILO_EXTRA_LD_PATH=<scratch>/root/usr/lib/x86_64-linux-gnu npx playwright test --project=webkit
```

### Windows (native, used for the local evidence)
- Put portable Node ≥ 22.18 on `PATH`, and add `C:\Program Files\Git\usr\bin` for `openssl`.
- Set `PLAYWRIGHT_BROWSERS_PATH` to a task-private directory.
- From PowerShell, use `npm.cmd`/`npx.cmd`, because the `.ps1` shims are blocked by execution
  policy:
```powershell
npm.cmd ci; npx.cmd playwright install webkit; npx.cmd playwright test --project=stub --project=webkit
```

## Environment variables
| Variable | Effect |
|---|---|
| `ZILO_AGENT_PORT`, `ZILO_APP_HTTPS_PORT`, `ZILO_APP_HTTP_PORT`, `ZILO_PROXY_PORT` | Ports. Defaults: 47613, 8443, 8080, 8899. |
| `ZILO_HEADFUL_DISPLAY` | A virtual X display for the headful Chromium prompt test. The test is skipped when this is unset. |
| `ZILO_WEBKIT_TRUST=system` | WebKit uses the OS trust store instead of `ignoreHTTPSErrors`. |
| `ZILO_WEBKIT_VERIFIED` | Comma-separated OS list where WebKit expectations are asserted. Default: `linux,win32`. Other platforms are observe-only. |
| `ZILO_WEBKIT_EXECUTABLE`, `ZILO_EXTRA_LD_PATH` | Local scratch-library WebKit only. CI never sets these. |
| `ZILO_LEAF_CERT`, `ZILO_LEAF_KEY` | Override the page server's TLS leaf. Used by the manual S1 step. |
| `ZILO_PUBLIC_APP_ORIGIN` | Manual real-Safari step only: the origin of a genuinely public HTTPS front (tunnel or host) for the page server. It is allowlisted in the stub, accepted as a Host by the page server, and gets the `spike-public-token-…` fixture (`ZILO_SPIKE_PUBLIC_TOKEN`). Never set in automated runs. |

## Rules this spike keeps
- The test page is never served from localhost. The page server is mapped to a public address space
  (Chromium `--ip-address-space-overrides`, Firefox `network.lna.address_space.public.override`), and
  a methodology control proves the mapping matters.
- No token or capability ever appears in a URL, a log or the evidence. The token is typed into a
  password field.
- Playwright WebKit results are never presented as Safari results.
