# Opus research — Phase 1 (independent)

Date: 2026-10-31. Author: [Opus]. Status: findings and proposals only. Nothing here is a decision
until it is in `DECISIONS.md` with both approvals. Each claim is marked **[verified]** (read in a
primary or vendor source today), **[reported]** (secondary/third-party source), or **[to verify]**
(needs a spike). GPT's notes (`research-notes-gpt-*.md`) were read after mine were drafted; where
we overlap I only add what is new.

---

## 1. The browser-to-loopback problem is the critical path

This decides the transport, the TLS strategy, and most of the front-end UX. Summary first:

| Browser | `https://app` → `http://127.0.0.1` | Permission prompt | Notes |
|---|---|---|---|
| Chrome / Edge / Brave (Chromium) | Allowed: loopback is "potentially trustworthy"; with `fetch(url, {targetAddressSpace:'loopback'})` it is also explicitly exempt from mixed content | **Yes**, since Chrome 142 (Oct 2025). Since ~145/146 the permission is split: `loopback-network` ("Apps on device") vs `local-network` (LAN). WebSockets covered from Chrome 147 | **[verified]** Chrome LNA guide; **[verified]** Dynamsoft's own LNA FAQ |
| Firefox | Allowed (loopback trustworthy) | **Yes**, LNA rolled out by default from ~151–153; WebSockets blocked from 154 per Dynamsoft. Settings label "Device apps and services". Enterprise policy `LocalNetworkAccess` with `SkipDomains` | **[verified]** Mozilla SUMO + Dynamsoft FAQ; exact version numbers **[reported]** |
| Safari (macOS only) | **Blocked as mixed content** in practice. WebKit bug 171934 (treat loopback as trustworthy) still open. A 2025 fix (bug 279249) re-allowed *some* localhost loads, but two independent projects in Sep/Oct 2026 report WebKit 26.x still blocks `http://127.0.0.1` and `http://localhost` from https pages | No LNA prompt in WebKit; WebKit has "no position" on PNA/LNA. Safari 26.4 does accept the `targetAddressSpace` fetch option (bug fix note) but that does not lift the mixed-content block | **[reported]**, must be proved on real Safari 26 in a spike |

### What this means
1. **Chromium and Firefox: plain HTTP on 127.0.0.1 works** and needs no certificate. The user sees
   one browser permission prompt per site ("allow this site to access apps on your device"). Use
   the IP literal `127.0.0.1`, not `localhost`, and pass `targetAddressSpace: 'loopback'`.
2. **The first loopback request must be triggered from a user gesture (the Scan click), not on page
   load**, while the permission state is `prompt`. Chrome's guide says so explicitly. So the SDK
   must not auto-probe at page load unless `navigator.permissions.query({name:'loopback-network'})`
   already returns `granted`. (Query in try/catch; never query the legacy `local-network-access`
   name, which crashes older Chrome.)
3. **The SDK must tell "permission denied" apart from "not installed".** Dynamsoft cannot, and its
   own FAQ admits users who block the prompt get the install dialog again. We can: query the
   permission state first; if `denied`, show a per-browser "how to allow" panel instead of the
   download dialog. This is a concrete UX win over Dynamsoft.
4. **Iframes:** if the owner's app embeds the scan UI in a cross-origin iframe, the embedder needs
   `allow="loopback-network"` (Permissions-Policy). Owner question.
5. **Enterprise fleets** can pre-grant: Chrome/Edge policy `LocalNetworkAccessAllowedForUrls`,
   Firefox `LocalNetworkAccess.SkipDomains`. We should document these in an admin guide.
6. **Do not rely on PNA preflight headers** (`Access-Control-Allow-Private-Network`); Chrome says
   PNA was never enforced and new code should not depend on it. Standard CORS is still required.

### Safari options (needs a joint decision)
- **S1. HTTPS on loopback with a locally generated, per-install CA** (what Dynamsoft does: they
  serve `https://127.0.0.1:18623` with a self-signed cert "installed to your system" **[verified]**
  Dynamsoft docs). Cost: on macOS Big Sur+ adding a trusted root **always needs interactive user
  approval** (password/Touch ID); it cannot be done silently from a `.pkg` postinstall
  **[reported]** Jamf/Apple forums. Fleets would push it via MDM profile. Security: the CA key must
  be generated on the machine, never shipped; name-constrain it to `127.0.0.1`/`localhost` (X.509
  name constraints; whether Safari/Chrome honour them on a root is **[to verify]**), and remove it
  on uninstall.
- **S2. Popup bridge, no certificate.** A *top-level navigation* to `http://127.0.0.1` is not a
  subresource, so mixed-content blocking does not apply (one of the projects above confirms its
  top-level link kept working). On Scan click the SDK opens a small window at
  `http://127.0.0.1:<port>/bridge`, which talks same-origin to the service and relays to the app via
  `postMessage` with strict origin checks. Costs: a visible extra window; breaks if the app sets
  `Cross-Origin-Opener-Policy: same-origin` (opener is severed); popup blockers (fine on a click).
  The popup could even *be* the scan dialog on Safari. **[to verify]** in Safari 26.
- **S3. Public hostname resolving to 127.0.0.1 with per-install ACME certs** (Plex `plex.direct`
  model). Avoids trust-store edits, but needs Zilo-run DNS + ACME infrastructure, internet at install,
  breaks behind routers with DNS-rebinding protection, and CA rate limits. Shipping one shared
  private key for a public name is forbidden by CA rules and gets revoked. I'd rule this out for v1.

**Opus proposal:** HTTP on `127.0.0.1` for Chromium/Firefox (all OSes); for Safari, run a spike on
S1 and S2 in week 1 and pick by evidence. My prior is S2 as the zero-install-friction default with
S1 offered as an opt-in ("trust Zilo for Safari" button in the tray app, plus an MDM profile for
fleets). Agree with GPT that no local CA ships without a reviewed trust lifecycle.

### Linux / Windows TLS note
If we ever need HTTPS on Linux, browsers use NSS stores per profile (Dynamsoft tells Linux users to
add cert exceptions by hand **[verified]**). On Windows, Firefox reads the OS root store by default
**[verified]** Mozilla SUMO, and adding to CurrentUser\Root shows a scary dialog while LocalMachine
needs elevation. Both are reasons to keep HTTPS confined to the Safari path.

### WebSocket vs HTTP
`ws://127.0.0.1` from https is mixed-content-exempt in Chromium; the WebSocket constructor does not
take `targetAddressSpace`. LNA covers WS from Chrome 147 / Firefox 154, so WS gives no advantage.
**Proposal:** REST over `fetch` plus **Server-Sent Events** (or long-poll fallback) for job events.
SSE is plain HTTP, so it inherits the same permission and the popup bridge can relay it. (EventSource
cannot set headers; use `fetch` streaming for SSE so we can send the auth header.)

---

## 2. Scanner backend: NAPS2.Sdk is the strongest shared core

- **NAPS2.Sdk 1.6.0, published 2026-10-25** **[verified]** nuget. Targets .NET 8 and .NET Framework
  4.6.2 (net10 compatible). Drivers per OS **[verified]** README: Windows WIA (default) + TWAIN;
  macOS Apple ImageCaptureCore (default), SANE, eSCL, TWAIN*; Linux SANE (default) + eSCL.
- **TWAIN 32/64**: most TWAIN data sources are still 32-bit. NAPS2 ships `NAPS2.Sdk.Worker.Win32`
  and `scanningContext.SetUpWin32Worker()` so a 64-bit host drives a 32-bit worker over named pipes
  (gRPC, `GrpcDotNetNamedPipes` dep) **[verified]**. This removes the hardest Windows problem.
- **WIA**: NAPS2.Wia 2.0.3 (MIT) supports WIA 2.0; the WIA 1.0 32-bit-only limitation affects few
  users **[verified]**. Windows WSD network scanners surface through WIA, so WSD is covered on Windows
  indirectly **[to verify]** on hardware.
- **Linux**: SANE through system `libsane`; **sane-airscan** (a SANE backend) provides eSCL *and WSD*,
  so declaring it as a package dependency gives Linux WSD coverage without us writing WSD **[to verify]**.
- **macOS**: ICA via ImageCaptureCore; AirScan network devices usually appear through ICA too. Needs
  the `NAPS2.Images.Mac` image backend, which implies a `net8.0-macos` (or newer) target **[to verify]**.
- **Image backends** (exactly one): Gdi/Wpf (Windows), Mac, Gtk (Linux), or ImageSharp. Using the
  platform ones avoids ImageSharp entirely.
- **eSCL server**: `NAPS2.Escl.Server` can share devices over eSCL. Useful for the virtual scanner
  (below), not as our browser API (naps2-webscan's sample is permissive-CORS, fixed-port, Windows-only,
  15 stars, MIT **[verified]**; a reference, not a base).
- **Native-vs-shared verdict**: a Rust or Go core would have to re-implement TWAIN (with 32-bit
  bridging), WIA COM, ICA and SANE bindings that NAPS2 already maintains. I see no material benefit to
  native-per-OS for the scanning layer. Native code is only warranted in thin shells: tray/menu-bar UI,
  login-item/autostart, URL handler, installers. **Proposal: shared .NET 8 (LTS) service on NAPS2.Sdk,
  per-OS thin shells.** (Watch .NET 8 end of support Nov 2026 → target .NET 10 LTS; NAPS2 lists net10
  compatible.)

### Licensing (partly overlaps GPT; additions)
- NAPS2.Sdk is LGPL-2.1-or-later; NAPS2.Wia is MIT; samples MIT **[verified]**. LGPL compliance for a
  closed-source service: ship the LGPL assemblies as **separate, replaceable DLLs** (do not merge them
  into a single-file bundle or trim/IL-merge them), include licence texts and a source offer for the
  exact NAPS2 version, and do not copy code from the GPL NAPS2 *application*.
- **SixLabors**: NAPS2.Sdk 1.6.0 depends only on **SixLabors.Fonts >= 1.0.1**, and SixLabors.Fonts
  **1.0.1 is plain Apache-2.0** on nuget **[verified]**. Later Fonts 2.x is under the Six Labors Split
  License (commercial licence above $1M revenue for direct use). **Proposal: pin SixLabors.Fonts to a
  pre-split Apache-2.0 version via central package management, and add a CI licence gate** that fails
  on any Split-licensed or GPL package in the resolved graph. Do not use `NAPS2.Images.ImageSharp`.
- Other deps: PdfSharp (MIT), ZXing.Net (Apache-2.0), SharpZipLib (MIT), NAPS2.NTwain fork (NTwain is
  MIT **[to verify]** for the fork). Pdfium/Tesseract binaries only if we enable PDF import/OCR (not v1).

---

## 3. Dynamsoft Web TWAIN surface (what a compat adapter would need)

GPT's notes cover the API index well. My additions, front-end-relevant:
- Service transport today: `https://127.0.0.1:18623` (and 18626) with a self-signed, non-expiring cert
  installed on the system; DWT talks to it over WebSocket **[verified]** Dynamsoft FAQ.
- DWT already broke on Chrome 142 LNA: versions 18.5–19.2 return *blank images*; only 19.3+ shows a
  permission dialog **[verified]**. If the owner's app is on an older DWT, they are already feeling this;
  Zilo can fix it as a selling point.
- Typical calls an app makes: `Dynamsoft.DWT.ProductKey`, `ResourcesPath`, `CreateDWTObjectEx` /
  `Dynamsoft.DWT.GetWebTwain`, `GetSourceNames(Async)`, `SelectSource(ByIndex)`, `OpenSource`,
  `AcquireImage(Async)({IfShowUI, PixelType, Resolution, IfFeederEnabled, IfDuplexEnabled,
  IfDisableSourceAfterAcquire})`, `HowManyImagesInBuffer`, `ConvertToBlob(indices, IT_PDF|IT_JPG)`,
  `HTTPUpload`, `RemoveAllImages`, `RegisterEvent('OnPostTransfer' | 'OnPostAllTransfers')`, plus the
  install-prompt hooks (`OnWebTwainNotFound`-style). Exact v18/v19 names **[to verify]** against the
  owner's code. `HTTPUpload` only uploads multi-page as PDF/TIFF **[verified]**.
- **The Dynamsoft "virtual scanner" is not Dynamsoft's**: their docs point to the **TWAIN Working
  Group sample data source** ("TWAIN Virtual Scanner", FreeImage-based, Windows/TWAIN only)
  **[verified]**. So parity means "a selectable fake device that returns a test page", which we can do
  better (all OSes, all paths).
- **Proposal:** clean Zilo SDK first; `@zilo/dwt-compat` exposes a `Dynamsoft.DWT`-shaped global for
  the subset the owner actually uses. Scope it only after we see the owner's code (owner question
  already in DISCUSSION.md; agreed).

---

## 4. Virtual test scanner

Proposal, three layers, all original assets (no TWAIN WG or Dynamsoft images):
1. **`zilo-virtual` driver inside the service** (default, every OS): appears in the device list as
   "Zilo Virtual Scanner"; generates deterministic pages (page number, DPI, colour mode, timestamp
   seed, a ruler and colour target, QR code with job metadata so tests can assert page order and
   settings from the image itself). Supports flatbed / ADF / duplex, N pages, and failure injection
   (`paper-jam`, `feeder-empty`, `cover-open`, `timeout`, `disconnect`, slow pages) selected by device
   variant or a test-only control endpoint disabled in release builds.
2. **Virtual eSCL device** (dev/CI): the same generator behind `NAPS2.Escl.Server`, so the real eSCL
   driver path is exercised end-to-end, including on Linux CI.
3. **Windows TWAIN path in CI**: install the TWAIN WG sample DS on the Windows runner purely as a test
   fixture (licence **[to verify]**; not redistributed), to exercise the 32-bit worker path.
GPT owns this component; this is input.

---

## 5. Launch / detect / download flow (front-end owned; proposal)

Facts: browsers cannot reliably detect whether a custom URL scheme is registered (blur/timeout hacks
broke in Chrome 86+, Firefox always shows its own dialog) **[reported]**. Chrome shows an "Open Zilo?"
confirmation on each launch unless "always allow" is ticked.

Flow proposal (SDK + `@zilo/ui` install dialog):
1. Scan click → `permissions.query('loopback-network')`.
   - `denied` → **Permission panel** with browser-specific steps (and admin policy hint). Not the
     download dialog.
2. Probe `http://127.0.0.1:{p}/zilo/v1/hello` over a fixed port plus 2 fallbacks, ~1.5 s timeout total.
   - OK + compatible protocol → Scan dialog.
   - OK + old version → "Update Zilo" dialog (service can self-update; see GPT).
3. No answer → **Install dialog** with two actions: "Start Zilo" (navigates to `zilo://start`; harmless
   if not installed) and "Download for {OS/arch}" (detected via `navigator.userAgentData`, with a manual
   picker). The dialog then **polls `hello` every 2 s** and flips to the Scan dialog automatically when
   the service comes up (Dynamsoft does the same polling).
4. Safari → the chosen S1/S2 path above; the dialog explains the extra step once.
The service should autostart at login (per-user), so `zilo://` is a rarely-needed fallback, and it is
never a security boundary (agree with GPT: no secrets in the URL).

## 6. Pairing, auth, origin policy (shared with GPT; my proposal)

- Bind to `127.0.0.1` (and `::1`) only. **Validate `Host`** is `127.0.0.1:<port>`/`localhost:<port>`
  to defeat DNS rebinding. Validate `Origin` against an allowlist; CORS reflects only allowed origins.
- Allowlist sources: (a) baked into the installer build/config by the deploying company (the owner's
  app origins), (b) a **native consent prompt** in the tray app the first time an unknown origin calls
  ("app.example.com wants to use your scanners — Allow / Deny"). Unknown origins get nothing until
  approved, not even the device list.
- After consent the service issues a per-origin token (stored by the SDK in that origin's storage),
  sent as `Authorization: Bearer`; tokens are revocable from the tray UI. Origin check is the primary
  control against hostile websites (browsers cannot forge `Origin`); the token adds revocation and
  defence in depth. Local malware is out of scope (it can already read the scanner).

## 7. API shape (proposal; GPT owns the server, I own the SDK, so we co-own the contract)

```
GET  /zilo/v1/hello                → {product, version, protocol, os, arch, capabilities}
GET  /zilo/v1/devices?refresh=1    → [{id, name, driver: wia|twain|ica|sane|escl|virtual, ...}]
GET  /zilo/v1/devices/{id}/caps    → {sources:[flatbed,feeder,duplex], dpi:[...], colorModes, pageSizes}
POST /zilo/v1/jobs                 → {jobId}   body: {deviceId, source, duplex, dpi, colorMode,
                                                       pageSize, maxPages, showDriverUI}
GET  /zilo/v1/jobs/{id}/events     → SSE: progress, page{index, width, height, url}, error, done
GET  /zilo/v1/jobs/{id}/pages/{n}?format=jpeg|png&maxWidth= → image bytes (thumbnails via maxWidth)
POST /zilo/v1/jobs/{id}/export     → body {pages, format: pdf|tiff|jpeg|png, quality} → bytes
DELETE /zilo/v1/jobs/{id}          → cancel + free temp files
```
Errors as RFC 9457 problem+json with stable `code`s the UI maps to copy (`device-busy`,
`feeder-empty`, `paper-jam`, `permission`, ...). Pages stay in the service until exported or the job
is deleted (bounded temp dir, TTL). JS SDK returns `Blob`s and `File`s; the app uploads them itself.

## 8. Packaging, signing, update (GPT owns; my notes for the download dialog)

- Windows: per-user MSIX or Inno/WiX MSI, Authenticode-signed (Azure Trusted Signing or EV cert to
  reduce SmartScreen friction **[to verify]** current policy), x64 + arm64 builds (TWAIN worker x86).
- macOS: universal (arm64+x64) `.pkg` or DMG with Developer ID Application/Installer certs, hardened
  runtime, `notarytool` + stapler. .NET under hardened runtime may need `allow-jit` entitlement
  **[to verify]**. Login item via `SMAppService`.
- Linux: `.deb` and `.rpm` declaring `libsane1`/`sane-backends` and `sane-airscan`, a `systemd --user`
  unit, XDG desktop entry with `x-scheme-handler/zilo`. Flatpak/Snap sandboxing makes USB/SANE access
  painful; AppImage optional. Agree with GPT.
- The download dialog needs a stable manifest URL (`/downloads/latest.json` with per-OS/arch URLs,
  version, SHA-256) so the SDK can show the right button and "update available".

## 9. Front-end components I propose to own

- `@zilo/sdk` (TypeScript, framework-agnostic, ESM, no runtime deps): discovery, permission state,
  transport (fetch / popup bridge), devices, jobs, events, export. Typed errors.
- `@zilo/ui`: **Scan dialog** (device list with driver badges incl. virtual scanner, settings, live
  page thumbnails as they arrive, reorder/rotate/delete, export) and **Install/Permission/Update
  dialogs**. Ship as framework-agnostic **Web Components** (shadow DOM, themable via CSS custom
  properties) with a thin React wrapper, since we don't yet know the owner's framework (owner question).
- `@zilo/dwt-compat` (after owner code).
- `apps/demo`: Vite + TS demo/test app, also the Playwright E2E target (Chromium, Firefox, WebKit
  against the virtual scanner; WebKit exercises the Safari path).

## 10. Proposed validation spikes (gate before "shipping-ready"), reply to GPT's request

1. **Browser matrix spike** (Opus): https page on a real domain → service on 127.0.0.1, in Chrome
   stable, Edge, Firefox stable, Safari 26 (real macOS, not only Playwright WebKit): fetch, SSE,
   permission prompt flow, denied state, and both Safari options S1/S2.
2. **NAPS2 graph spike** (GPT): pin NAPS2.Sdk 1.6.0, produce resolved package + native payload
   inventory per RID, licence gate in CI, confirm `net8.0-macos` requirement for ICA and the Win32 worker
   on x64 and arm64 Windows.
3. **Virtual scanner end-to-end** (GPT backend + Opus E2E): device list → scan 3 pages duplex → PDF in
   the demo app on Linux CI.
4. **Signing smoke** (GPT): unsigned → signed/notarized artifacts reproducible in CI, keys out of repo.

## Open owner questions to add
- Dynamsoft integration code (already asked).
- Front-end framework of the app (React/Angular/Vue/other), and whether the scan UI is inside a
  cross-origin iframe.
- Which DWT version they run (if < 19.3 they are already broken on Chrome 142+).
- Target browsers: is Safari on macOS a must-have for v1?
- Fleet management: do customers have MDM/GPO (lets us pre-grant LNA and trust a local CA)?

## Sources
- Chrome LNA guide: https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
- Dynamsoft Chromium 142 / Firefox LNA FAQ: https://www.dynamsoft.com/web-twain/docs/faq/chromium-142-local-network-access-issue.html
- Mozilla LNA permissions: https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox
- Firefox OS root store: https://support.mozilla.org/kb/setting-certificate-authorities-firefox
- WebKit loopback mixed content: https://bugs.webkit.org/show_bug.cgi?id=171934 , https://bugs.webkit.org/show_bug.cgi?id=279249
- WebKit commit "Block response from localhost for mixed content if not loopback": https://www.mail-archive.com/webkit-changes@lists.webkit.org/msg213888.html
- Safari 26.4 notes (targetAddressSpace fix): https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
- Interop LNA/mixed content proposal: https://github.com/web-platform-tests/interop/issues/519
- 2026 field reports of WebKit blocking http loopback: https://github.com/ai-ecoverse/slicc-cli/pull/253 , https://github.com/UltimaPhoenix/dev-coach/pull/88
- NAPS2.Sdk nuget: https://www.nuget.org/packages/NAPS2.Sdk ; README: https://github.com/cyanfish/naps2/blob/master/NAPS2.Sdk/README.md
- NAPS2.Wia: https://www.nuget.org/packages/NAPS2.Wia/
- SixLabors.Fonts 1.0.1 licence: https://www.nuget.org/packages/SixLabors.Fonts/1.0.1/License ; Split licence discussion: https://www.Github.com/SixLabors/ImageSharp/discussions/2151
- naps2-webscan: https://github.com/cyanfish/naps2-webscan
- Dynamsoft certificate FAQ: https://www.dynamsoft.com/web-twain/docs/faq/failed-to-load-resource.md
- Dynamsoft virtual scanner FAQ: https://dynamsoft.com/web-twain/docs/faq/download-virtual-scanner-for-testing.html
- DWT API: https://www.dynamsoft.com/web-twain/docs/info/api/ ; HTTPUpload: https://www.dynamsoft.com/web-twain/docs/general-usage/image-export/server-upload.md
- macOS trusted cert needs user interaction since Big Sur: https://developer.apple.com/forums/thread/671582 , https://community.jamf.com/t5/jamf-pro/how-to-set-a-self-signed-certificate-to-always-trust/td-p/234728
- Custom protocol detection limits: https://github.com/vireshshah/custom-protocol-check
