# Zilo browser-to-local-service research (GPT)

**Research date/access date:** 2026-10-31  
**Scope:** HTTPS public web app contacting loopback HTTP/WebSocket endpoints; LNA/PNA, secure contexts, certificates, protocol launching, and security validation.  
**Status:** Research notes only. These are not architecture decisions. GPT validation owner; Opus cross-review remains required.

## Facts and dated evidence

### Secure contexts and mixed content

- MDN defines HTTPS, `wss`, `file`, `localhost`, `127.0.0.0/8`, and `::1` as potentially trustworthy in the standards model. `http://localhost` can therefore be a secure context, but that does not guarantee cross-origin request compatibility in every browser.  
  Source: [MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts), accessed 2026-10-31.
- HTTPS pages generally block active mixed content. Insecure WebSockets (`ws://`) from HTTPS pages are generally blocked; MDN recommends `wss://` for real HTTPS applications.  
  Sources: [MDN Mixed Content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content), [MDN WebSocket clients](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications), accessed 2026-10-31.

### Chrome / Chromium

- Chrome 142 release notes state that local-network requests from websites are gated behind a permission prompt, restricted to secure contexts, and that granted permission can relax mixed-content blocking for local requests.  
  Source: [Chrome 142 release notes](https://developer.chrome.com/release-notes/142), accessed 2026-10-31.
- Chrome’s current LNA guidance distinguishes `local-network` and `loopback-network`, recommends checking permission state, and says not to rely on deprecated PNA preflight headers. Standard CORS remains relevant for reading cross-origin HTTP responses.  
  Source: [Chrome LNA guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access), accessed 2026-10-31.
- Chrome’s 2024 PNA rollout was put on hold; the old `Access-Control-Request-Private-Network` / `Access-Control-Allow-Private-Network` enforcement plan is not a safe current integration assumption.  
  Source: [Private Network Access on hold](https://developer.chrome.com/blog/pna-on-hold), accessed 2026-10-31.
- Chrome’s WebSocket-specific LNA feature is separately tracked in ChromeStatus. The entry lists estimated milestones, but explicitly says the data has not been verified recently. Its milestone claims therefore are evidence of planned work, not proof of the behavior of a particular stable build.  
  Source: [ChromeStatus: LNA restrictions for WebSockets](https://chromestatus.com/feature/5197681148428288), accessed 2026-10-31.
- Chrome 154 release-note material mentioning WebSocket `targetAddressSpace` is treated here as **unverified/future evidence**, not as a current cross-browser capability. It must be tested in the exact target build before use.  
  Source: [ChromeStatus release notes](https://chromestatus.com/release-notes/154), accessed 2026-10-31.

### Microsoft Edge

- Microsoft documents LNA restrictions shipping by default beginning with Edge 143. Its initial documented scope is subresources, `fetch()`, and subframe navigation; WebSockets are explicitly described as not initially included.  
  Source: [Adapting websites for Edge LNA](https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access), accessed 2026-10-31.
- Edge provides enterprise allow/block policies for local and loopback access. Policy support varies by version/platform; iOS is listed as unsupported on the cited policy pages.  
  Source: [Edge LNA policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/LocalNetworkAccessAllowedForUrls), accessed 2026-10-31.

### Firefox

- Mozilla has an active LNA implementation and rollout tracked through Bugzilla and Firefox support documentation. Evidence includes permission UI/settings and work concerning rollout, persistence, proxies, and iframe behavior.  
  Sources: [Bug 1481298](https://bugzilla.mozilla.org/show_bug.cgi?id=1481298), [Bug 2054512](https://bugzilla.mozilla.org/show_bug.cgi?id=2054512), [Firefox local-network permissions support article](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox/), accessed 2026-10-31.
- The exact claim that Firefox 153 made LNA on by default is **uncertain here**: the evidence found is a Bugzilla documentation task and support-material history, not an actual primary Firefox 153 release-note confirmation. Do not use “Firefox 153” as a guaranteed compatibility boundary without direct build testing or a primary release source.
- Firefox behavior may vary by release, OS, privacy/ETP mode, profile, temporary versus persistent permission, and proxy path. Bug reports are evidence of implementation risk, not proof of behavior for all stable builds.  
  Examples: [Bug 2066674](https://bugzilla.mozilla.org/show_bug.cgi?id=2066674), [Bug 2067324](https://bugzilla.mozilla.org/show_bug.cgi?id=2067324), accessed 2026-10-31.

### Safari / WebKit

- WebKit has active LNA implementation and test work, but the existence of landed patches or open meta bugs does not prove complete support in every Safari stable release.  
  Sources: [WebKit LNA meta bug](https://bugs.webkit.org/show_bug.cgi?id=250607), [feature-flag bug](https://bugs.webkit.org/show_bug.cgi?id=295048), [test-import bug](https://bugs.webkit.org/show_bug.cgi?id=295049), accessed 2026-10-31.
- WebKit bug reports document longstanding localhost mixed-content inconsistencies and Safari regressions, including HTTPS pages attempting HTTP localhost resources. These reports establish compatibility risk; they do **not** prove that all stable Safari builds behave identically.  
  Sources: [WebKit bug 171934](https://bugs.webkit.org/show_bug.cgi?id=171934), [Safari 18 regression bug 279249](https://bugs.webkit.org/show_bug.cgi?id=279249), accessed 2026-10-31.
- WebKit announced support for HTTP(S) URL forms in the WebSocket constructor in Safari 17. This is syntax/API support, not a guarantee that insecure local `ws://` from an HTTPS page will pass mixed-content or LNA checks.  
  Source: [WebKit Interop 2024](https://webkit.org/blog/14955/the-web-just-gets-better-with-interop/), accessed 2026-10-31.

### WebSockets, CORS, and Origin

- Browser WebSocket handshakes include an `Origin` header. Servers can reject unexpected origins, which helps prevent Cross-Site WebSocket Hijacking; `Origin` is not authentication because non-browser clients can forge it.  
  Source: [MDN WebSocket servers](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers), accessed 2026-10-31.
- CORS must use an exact allowlisted origin for credentialed requests; `Access-Control-Allow-Origin: *` cannot be combined with credentials. Dynamic allowlists should emit `Vary: Origin`.  
  Source: [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS?retiredLocale=it), accessed 2026-10-31.

### URL launching: native scheme versus PWA handlers

- A native `zilo://` handler installed by an OS installer is distinct from a PWA manifest `protocol_handlers` entry or `registerProtocolHandler()`. PWA registration is browser/OS-managed, consented, allowlisted, and commonly constrained to schemes such as `web+...`; it does not establish that a native `zilo://` scheme can be registered or detected.
- The PWA protocol-handler registration list is intentionally not exposed to web content, and programmatic/non-user-initiated navigations may not launch the handler.  
  Sources: [Chrome URL protocol handlers](https://developer.chrome.com/docs/web-platform/best-practices/url-protocol-handler), [MDN protocol_handlers](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/protocol_handlers), accessed 2026-10-31.
- Chrome’s Launch Handler API controls launch behavior for an installed web app; it is not a native service-discovery mechanism.  
  Source: [Chrome Launch Handler](https://developer.chrome.com/docs/web-platform/launch-handler), accessed 2026-10-31.

## Conservative proposals for review

These are security recommendations, not approved architecture decisions.

1. Serve the public application over HTTPS and prefer a local HTTPS service plus `wss://` for Safari and conservative cross-browser behavior. Keep HTTP/WS only as a tested fallback, never as an assumption.
2. Use an explicit user-initiated probe/handshake and capability detection rather than UA/version detection. A browser cannot reliably reveal whether a native handler, service, permission, enterprise policy, or certificate trust exists.
3. Pair each installation using a per-installation asymmetric key pair and a high-entropy, short-lived, one-time challenge. Do not treat loopback, port secrecy, Origin, CORS, or LNA permission as authentication.
4. Validate `Origin` against an exact production allowlist for HTTP and WebSocket handshakes. Use narrow CORS methods/headers and `Vary: Origin`; never reflect arbitrary origins.
5. Protect state-changing operations against CSRF with per-install authorization and request proof, not merely preflight behavior or cookies. Use appropriate SameSite cookies and CSRF tokens if cookies are retained.
6. Bind the service to loopback only by default, validate `Host`, avoid arbitrary redirects, minimize unauthenticated endpoint data, and design for DNS-rebinding resistance.
7. If local TLS is used, treat CA/certificate trust as security-sensitive: generate a unique per-installation key/certificate; never share a private key or root across installations; grant the least authority possible; provide rotation/revocation and clean uninstall removal; and do not imply that root installation is automatically approved. Installation/trust must be explicit and platform-appropriate.
8. Treat a native `zilo://` launch as an optional installer capability with a normal web fallback/download flow. Do not infer native-scheme support from PWA `web+...` support.

## Validation matrix

Run on exact supported versions, fresh and previously paired profiles, and record browser build, OS, privacy mode, permission state, console/network events, and service logs.

| Scenario | Chrome | Edge | Firefox | Safari |
|---|---:|---:|---:|---:|
| HTTPS public page → `http://127.0.0.1` HTTP probe | test | test | test | test |
| HTTPS public page → trusted `https://127.0.0.1` | test | test | test | test |
| HTTPS public page → `ws://127.0.0.1` | test | test | test | test |
| HTTPS public page → trusted `wss://127.0.0.1` | test | test | test | test |
| HTTP public page → loopback negative control | expect denial | expect denial | expect denial | expect denial |
| Fresh-profile loopback permission prompt | test | test | test | test |
| Fresh-profile RFC1918 permission prompt | test | test | test | test |
| Deny then retry; restart/persistence | test | test | test | test |
| Cross-origin iframe without and with loopback/local permissions policy | test | test | test | test |
| Valid and rejected HTTP `Origin` | must reject invalid | must reject invalid | must reject invalid | must reject invalid |
| Valid and rejected WebSocket `Origin` | must reject invalid | must reject invalid | must reject invalid | must reject invalid |
| Exact-origin CORS and credentialed wildcard negative control | test | test | test | test |
| DNS name changing from public to loopback | test | test | test | test |
| IPv4-only and IPv6-only loopback service | test | test | test | test |
| Trusted local CA versus untrusted certificate | test | test | test | test |
| Native `zilo://` user click, absent handler, and programmatic navigation | test | test | test | test |
| PWA `web+...` handler separately (if offered) | document only | document only | document only | document only |

## Explicitly unverified

- Chrome WebSocket-LNA shipping milestone and Chrome 154 WebSocket `targetAddressSpace` support are not accepted as current facts without direct build testing.
- Firefox 153 as an exact stable LNA boundary lacks primary Firefox release evidence in this research.
- Safari/WebKit bug reports do not establish behavior of every Safari stable build.
- No browser UA string can establish native Zilo installation, native scheme registration, certificate trust, LNA permission, or enterprise policy state.
