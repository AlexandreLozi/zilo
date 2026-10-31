# GPT Phase 1 research

**Research complete:** 2026-10-31. **Status:** research only; no item here is
an approved architecture decision. Any **Proposal for both masters** requires
approval from both GPT and Opus before it is put in force. No tests were run.

## Executive conclusion

Zilo can plausibly replace the Dynamsoft local bridge with an original
localhost service and browser SDK, but scanner support, browser transport, and
distribution are separate compatibility problems. The strongest starting point
is a shared .NET service using NAPS2.Sdk where its documented drivers fit, with
a Zilo-owned interface rather than NAPS2 public types. Windows 32-bit TWAIN
isolation, macOS ImageCaptureCore/ICA behavior, Linux SANE packaging, eSCL,
and WSD still require platform validation. This is a recommendation, not a
decision, and does not prove every scanner is supported.

The browser is an untrusted client. Loopback, CORS, Origin, a secret port, or
an LNA permission are not authentication. The public application and local
transport need a spike-gated HTTP-first versus local-TLS comparison, including
the Safari S1/S2 comparison; either outcome still requires explicit pairing,
origin policy, request authorization, and bounded document handling. Exact
Chrome, Edge, Firefox, and Safari builds need real-device tests.

## Scope and evidence

This synthesis uses the dated backend, distribution, and browser notes in this
directory and their cited primary sources. Important references are:

* NAPS2 SDK: <https://www.naps2.com/sdk>
* NAPS2 repository/license: <https://github.com/cyanfish/naps2>
* NuGet index: <https://api.nuget.org/v3-flatcontainer/naps2.sdk/index.json>
* NAPS2 README and project:
  <https://raw.githubusercontent.com/cyanfish/naps2/master/NAPS2.Sdk/README.md>
  and <https://raw.githubusercontent.com/cyanfish/naps2/master/NAPS2.Sdk/NAPS2.Sdk.csproj>
* Reference web scanner: <https://github.com/cyanfish/naps2-webscan>
* Dynamsoft docs: <https://www.dynamsoft.com/web-twain/docs/introduction/> and
  <https://www.dynamsoft.com/web-twain/docs/info/api/>
* Chrome LNA: <https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access>
* Edge LNA: <https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access>
* Full browser matrix: `research-notes-gpt-browser.md`
* Distribution details: `research-notes-gpt-distribution.md`

These sources document behavior at the research date, not guarantees for all
future browsers, packages, or hardware.

## 1. Requirements and clean-room boundary

The brief requires Windows, macOS, and Linux; local USB and network devices;
TWAIN/WIA/ICA/SANE/eSCL and WSD where feasible; a virtual scanner; DPI, color,
paper size, flatbed/ADF, duplex, and multipage acquisition; image and PDF
results; and installation detection/download. The owner's actual Dynamsoft
call sites are unavailable. That code may materially change whether a
compatibility adapter is small or substantial, so it remains an owner question.

Implement independently from public behavior. Do not copy Dynamsoft code,
binaries, reverse-engineered protocol details, fake-scanner artwork, or
trademarked UI. Public method names can inform an optional adapter, but
signatures, callbacks, event payloads, and multipage semantics are
version-sensitive and need contract tests against the target app.

## 2. Backend and architecture findings

### NAPS2 capability and license facts

The reviewed NAPS2 materials document asynchronous pages, scan settings, image
and PDF output, and a matrix including WIA on Windows; TWAIN on Windows with an
optionally marked macOS path; Apple/ImageCaptureCore on macOS; SANE on
Linux/macOS; and eSCL on all three platforms. ImageCaptureCore is the ICA
route; it must not be described as missing ICA coverage. The material reviewed
does not document a separate NAPS2 WSD backend. WSD through WIA or a SANE
AirScan backend may be possible, but was not verified.

The NuGet flat index lists `NAPS2.Sdk` 1.6.0 as latest and was modified
2026-10-25. **Follow-up correction, 2026-10-31:** the actual
<https://api.nuget.org/v3-flatcontainer/naps2.sdk/1.6.0/naps2.sdk.1.6.0.nupkg>
and its nuspec (repository commit `f914a4ec2af090aca4fa55eb3242ec91641482c3`)
were inspected. The nupkg contains SDK DLLs for `net10.0`, `net8.0`, and
`net462`, but no `net10.0-macos` SDK DLL. That absence does **not** establish
that macOS support is absent: platform packages and an actual Mac build remain
unresolved. The earlier statement that the nuspec was not inspected is
superseded by this dated correction.

The inspected net10 dependency entries name `NAPS2.Escl`, `NAPS2.Images`, and
`NAPS2.Internals` 1.6.0; `GrpcDotNetNamedPipes` 3.1.0;
`Microsoft.Extensions.Logging.Abstractions` 10.0.10; `NAPS2.NTwain` 1.0.1;
`NAPS2.PdfSharp` 1.0.2; `NAPS2.Wia` 2.0.3; `SharpZipLib` 1.4.2;
`SixLabors.Fonts` 1.0.1; `NAPS2.Resources.Extensions` 10.0.10; and
`ZXing.Net` 0.16.11. The net8/net462 asset groups additionally name
`System.Collections.Immutable` and `System.Threading.Tasks.Dataflow` 10.0.10.
These are dependency version entries, not necessarily exact pins: NuGet
minimum-version ranges and `[exact]` constraints must not be conflated. A full
restore lock and RID-specific graph are still required.

`NAPS2.Images` 1.6.0 contains net10/net8/net462/netstandard2.0 assets and
depends on `NAPS2.Internals` 1.6.0, `Bcl.AsyncInterfaces` 10.0.10, and
`ZXing.Net` 0.16.11, with Immutable on non-net10 groups. Its base image
abstraction needs a GDI, Mac, or Gtk platform package; the exact platform
package graph was not verified. The current master project targets
net8/net10.0 and conditionally net10.0-macos; that describes current source,
not the target frameworks of the 1.6.0 package.

NAPS2 main application code is GPL-2.0-or-later. SDK/Escl/Images/Internals are
LGPL-2.1-or-later, while SDK samples are MIT according to repository material.
This is not blanket clearance. The exact transitive/native inventory is a
release blocker, including `SixLabors.Fonts` (the inspected NAPS2 graph showed
no other SixLabors package, but this does not mean Fonts is the only
dependency), optional Pdfium/Tesseract/SANE binaries, and the optional Win32
worker, by version, RID, and distribution mode. Current master also references
Grpc.Tools, GrpcDotNetNamedPipes, Logging.Abstractions, NAPS2.NTwain/PdfSharp/Wia,
SharpZipLib, immutable/resources/dataflow, and ZXing. Dynamic assemblies may
create source/notices obligations. Legal review is required before shipping.

The inspected `SixLabors.Fonts` 1.0.1 package declares Apache-2.0 in its nuspec;
its package URL is
<https://api.nuget.org/v3-flatcontainer/sixlabors.fonts/1.0.1/sixlabors.fonts.1.0.1.nupkg>
and its source commit is `be8883caf13f364292508274d68c39c2455ec3e2`. The
package listing contained no license/NOTICE file, so Zilo must acquire and
preserve the required notice/source attribution separately. This confirms the
observed SixLabors dependency is Fonts; it does not replace a whole-graph
license inventory or runtime/RID validation.

### Reference web scanner

`naps2-webscan` is useful as an eSCL/HTTP reference, not a production design.
Its local worker uses `ScanningContext`, `ScanController`, and
`ScanServer`/`EsclServer`, configures `SecurityPolicy.ServerAllowAnyOrigin`,
chooses the first WIA device, and registers port 9880. Its web client
hardcodes `127.0.0.1:9880`, requests capabilities, starts jobs at resolution
300, and polls `NextDocument` until 404. It documents no browser discovery, and
manual per-device ports are a limitation. Allow-any-origin and first-device
selection are not acceptable Zilo security or product behavior. Its MIT
license permits reuse subject to its conditions, including preservation of
the copyright and permission notice; that does not clear dependencies under
other licenses or make the sample production-ready.

### Shared versus native implementation

NAPS2 provides a plausible shared acquisition layer and avoids reimplementing
several scanner protocols, but cannot remove driver, permission, packaging, or
architecture differences. Rust or Go would still need substantial platform FFI
and TWAIN isolation; no benchmark evidence shows either is better. Native
per-OS code may improve edge compatibility but multiplies APIs and packaging.
The neutral contract should be Zilo-owned: device identity/capabilities,
scan jobs/events, cancellation/errors, and image/PDF export must not expose
NAPS2 types.

**Proposal for both masters:** prototype a .NET backend behind that neutral
contract, use NAPS2 where documented and legally cleared, and keep platform
shims/workers replaceable. Compare native alternatives only against measured
compatibility and maintenance evidence, not language preference.

### Platform constraints

Windows TWAIN and WIA are distinct stacks. NAPS2 documents
`SetUpWin32Worker()` with optional `NAPS2.Sdk.Worker.Win32`; test x86 and x64
drivers, crashes, cancellation, and user-visible driver UI. A per-user
tray/desktop agent is safer than a session-0 service for interactive drivers.

macOS ImageCaptureCore is the documented ICA route. Distribution needs hardened
runtime, Developer ID signing, notarization, universal arm64/x86_64 artifacts
where feasible, and verification of nested helpers/frameworks. Do not invent a
generic scanner TCC prompt: scanner access, vendor support, entitlements, and
Local Network privacy are separate concerns.

Linux SANE is user-space and depends on backend packages, permissions, and
distro configuration. USB may need least-privilege udev policy; eSCL can avoid
USB permissions but depends on network/firewall policy. A reasonable package
investigation covers native `.deb`/`.rpm` and optionally AppImage, without
assuming AppImage bundles kernel/device access or distro SANE backends.

## 3. Browser transport and security

HTTPS public pages generally block active mixed content, including insecure
WebSockets. `http://localhost` can be potentially trustworthy in the secure
contexts model, but that does not guarantee cross-origin compatibility. Chrome
142 documents secure-context LNA permission for public-to-local/loopback fetches;
old PNA headers are not a safe current primary mechanism. Edge documents LNA
rollout beginning with Edge 143 and initially excludes WebSockets. Exact Chrome
WebSocket behavior, Firefox rollout builds, and Safari behavior remain
unverified. Safari/WebKit mixed-content bugs establish risk, not universal
failure. Playwright WebKit is not proof of real Safari or OS privacy prompts.

The required matrix is HTTPS public page to loopback HTTP, trusted HTTPS, WS,
and WSS; fresh/paired profiles; granted/denied permission and restart; iframes
and permission policy; proxies; exact Origin/CORS; IPv4/IPv6; trusted/untrusted
local CA; and Chrome, Edge, Firefox, and Safari. Include HTTP-page negative
controls. No browser UA can prove installation, scheme registration, trust,
permission, or enterprise policy.

**Superseding transport proposal (both approvals required):** the earlier
HTTPS-everywhere preference is superseded in this GPT research by willingness
to evaluate an HTTP-first local transport against local TLS in a spike-gated
comparison, including the Safari S1/S2 comparison. Use user-initiated
capability probing, not version detection, and
do not claim WSS alone fixes LNA. This remains a proposal, not a decision;
only a corresponding entry in `DECISIONS.md` approved by both masters can put
either transport choice in force.

Pair with a per-installation asymmetric key and high-entropy, short-lived,
one-time challenge. Bind authorization to the approved web origin, reject
unexpected Origin/Host, use exact CORS allowlists, and prevent CSRF, DNS
rebinding, replay, arbitrary URLs/filepaths, state-changing GETs, unbounded
scans, and excessive document retention. CORS and loopback are not auth.

Local TLS is security-sensitive. A per-install certificate/key or CA must never
use a shared private key/root; installation must be explicit, least-trusted,
rotatable/revocable, and removed on uninstall. This is a proposal requiring
both approvals, not permission to silently install a root certificate.

## 4. API, adapter, and virtual scanner

Public Dynamsoft reference behavior includes source enumeration/selection,
open/close, acquisition settings, lifecycle/error events, buffer
count/navigation, image export, and PDF/image output. Exact signatures and
callbacks need the owner's integration code and target-version tests. A Zilo
API should model device identity/backend/capabilities, jobs/events/cancel/error,
bounded page/image retrieval, explicit image/PDF export, and version negotiation.

**Proposal for both masters:** implement a Zilo-native REST plus event contract
and an optional thin Dynamsoft adapter only after the owner's call inventory is
supplied. Report effective capabilities/settings; do not assume devices honor
every requested option.

No authoritative source reviewed here established the exact Dynamsoft virtual
scanner name or activation mechanism. Do not use a guessed name or redistribute
its assets. Instead, use original deterministic one- and three-page fixtures
with DPI/color/paper/ADF/duplex/multipage, delay, cancellation, feeder-empty,
jam, timeout, disconnect, and malformed-setting cases. Bound pages, pixels,
bytes, duration, and concurrency. Compare normalized image/PDF content rather
than raw PDF bytes where timestamps/producer metadata vary.

**Proposal for both masters:** ship that original virtual scanner through the
same capability/job/export model as physical devices, with repeatable hashes and
page-order assertions and documented fixture licensing.

## 5. Install, update, packaging, and protocol launch

Native `zilo://` registration is distinct from PWA `protocol_handlers` and
`registerProtocolHandler()`. Native handlers are installer/OS registrations;
PWA handlers are browser-managed and do not prove native registration. Launch
must be user-initiated, with bounded timeout and normal probe/download fallback.
Absence or timeout cannot conclusively prove the service is not installed.

**Proposal for both masters:** use a per-user agent by default, expose a
versioned authenticated capability probe, and handle absent, stopped,
incompatible, denied, updating, and crashed states without blocking. Native
protocol launch is convenience only.

Windows: sign installers/executables, timestamp signatures, publish hashes and
an HTTPS update manifest, and never advise disabling SmartScreen. macOS: use
signed/notarized hardened-runtime artifacts and verify nested components.
Linux: state supported distros, dependencies, and udev uninstall behavior.
Clean install/update/uninstall, rollback, signatures, and anti-downgrade are
acceptance tests; credentials, hardware signing keys, notarization accounts,
and publisher reputation remain owner-operated gates.

## 6. Proposed repository, tests, and CI

**Proposal for both masters:** keep the proposal nonbinding, with `backend/` for
the .NET service, API, pairing, jobs, exports, and virtual scanner;
`backend/adapters/` for NAPS2/platform workers/eSCL; `sdk/` for TypeScript and
the optional adapter; `packaging/` for installers/signing metadata/manifests;
`tests/virtual`, `tests/integration`, `tests/browser`, and `tests/security`; and
`docs/` for API, threat model, support matrix, notices, and hardware results.

Use native Windows, macOS, and Linux CI runners. Run virtual contract/security
tests and Playwright Chromium/Firefox/WebKit, but do not treat automation as
real Safari, hardware, signing, notarization, or OS privacy verification. The
hardware matrix should include Windows TWAIN/WIA, macOS ICA on both
architectures where possible, Linux SANE USB, and eSCL. WSD is reported only
after a verified route/device test.

## Release blockers and owner questions

Blockers are the complete dependency/native license inventory and legal review;
the real browser matrix; TWAIN worker evidence; macOS/Linux packaging policy;
security tests; clean install/update/uninstall/signature evidence; and hardware
results. Do not claim signing/notarization without owner credentials and
artifacts.

The owner must provide the current Dynamsoft integration and target version;
target browser/OS/distro support; whether local CA trust is acceptable; and
whether enterprise machine-wide deployment is required.
