# GPT backend research notes

**Research complete:** 2026-10-31. Phase 1 research only. Facts and proposals
are separated below. Every **Proposal** requires approval from both masters and
is not a decision. No tests were run; hardware, browser, signing, and license
verification remain future work.

## NAPS2 evidence

The reviewed NAPS2 SDK documentation describes asynchronous pages, scan
settings, images, and PDF output. Its documented driver matrix is:

| Route | Documented platform scope |
|---|---|
| WIA | Windows |
| TWAIN | Windows; macOS is marked optional/starred |
| Apple/ImageCaptureCore | macOS |
| SANE | Linux and macOS |
| eSCL | Windows, macOS, and Linux |

ImageCaptureCore is the ICA route. It is incorrect to say the matrix lacks ICA.
The reviewed material does not document a separate NAPS2 WSD backend. WSD may
be reachable through WIA or a SANE AirScan backend, but this was not verified.

The NuGet flat index at
<https://api.nuget.org/v3-flatcontainer/naps2.sdk/index.json> lists 1.6.0 as
latest and has an index modification date of 2026-10-25. **Follow-up
correction, 2026-10-31:** the actual
<https://api.nuget.org/v3-flatcontainer/naps2.sdk/1.6.0/naps2.sdk.1.6.0.nupkg>
and its nuspec (repository commit `f914a4ec2af090aca4fa55eb3242ec91641482c3`)
were inspected. The nupkg contains SDK DLLs for `net10.0`, `net8.0`, and
`net462`, but no `net10.0-macos` SDK DLL. That does **not** establish that macOS
support is absent: platform packages and an actual Mac build remain unresolved.
The earlier statement that the nuspec was not inspected is superseded by this
dated correction.

The inspected net10 dependency entries name `NAPS2.Escl`, `NAPS2.Images`, and
`NAPS2.Internals` 1.6.0; `GrpcDotNetNamedPipes` 3.1.0;
`Microsoft.Extensions.Logging.Abstractions` 10.0.10; `NAPS2.NTwain` 1.0.1;
`NAPS2.PdfSharp` 1.0.2; `NAPS2.Wia` 2.0.3; `SharpZipLib` 1.4.2;
`SixLabors.Fonts` 1.0.1; `NAPS2.Resources.Extensions` 10.0.10; and
`ZXing.Net` 0.16.11. The net8/net462 groups additionally name
`System.Collections.Immutable` and `System.Threading.Tasks.Dataflow` 10.0.10.
These are dependency version entries, not necessarily exact pins: NuGet
minimum-version ranges and `[exact]` constraints must not be conflated. A full
restore lock and RID-specific graph are still required.

`NAPS2.Images` 1.6.0 contains net10/net8/net462/netstandard2.0 assets and
depends on `NAPS2.Internals` 1.6.0, `Bcl.AsyncInterfaces` 10.0.10, and
`ZXing.Net` 0.16.11, with Immutable on non-net10 groups. Its base image
abstraction needs a GDI, Mac, or Gtk platform package; the exact platform
package graph was not verified. The current master
<https://raw.githubusercontent.com/cyanfish/naps2/master/NAPS2.Sdk/NAPS2.Sdk.csproj>
targets net8/net10.0 and conditionally net10.0-macos; this is a master-source
fact, not a 1.6.0 package fact.

Repository licensing identifies the main NAPS2 application as GPL-2.0-or-later,
SDK/Escl/Images/Internals as LGPL-2.1-or-later, and SDK samples as MIT. Treat
these as component headlines, not blanket clearance for a product bundle. The
actual closure must be generated from the lock files/package assets used by
Zilo, including `SixLabors.Fonts` (the inspected NAPS2 graph showed no other
SixLabors package, but this does not mean Fonts is the only dependency),
Grpc.Tools, GrpcDotNetNamedPipes, Logging.Abstractions, NAPS2.NTwain/PdfSharp/Wia,
SharpZipLib, immutable/resources/dataflow, ZXing, and any other resolved assets.
Optional Pdfium, Tesseract, SANE binaries, and the Win32 worker require RID-
specific inventory. Dynamic assemblies can add source and notices obligations.
Legal review of the intended loading and redistribution model is a release
blocker; no legal conclusion is made here.

The inspected `SixLabors.Fonts` 1.0.1 package declares Apache-2.0 in its
nuspec. Package URL:
<https://api.nuget.org/v3-flatcontainer/sixlabors.fonts/1.0.1/sixlabors.fonts.1.0.1.nupkg>;
source commit: `be8883caf13f364292508274d68c39c2455ec3e2`. Its package listing
contained no license/NOTICE file, so Zilo must acquire and preserve required
notice/source attribution separately. This confirms the observed SixLabors
dependency is Fonts; it does not replace whole-graph license inventory or
runtime/RID validation.

**Proposal (both approvals required):** use NAPS2 only behind a Zilo-owned
interface and only after a versioned dependency/native-license inventory and
legal review. Do not ship OCR or PDF-rasterization extras by default when they
are not required by the scanning contract.

## Worker and platform constraints

The NAPS2 SDK README documents `SetUpWin32Worker()` and optional
`NAPS2.Sdk.Worker.Win32`. Test x86-only drivers, x64 drivers, driver crashes,
cancellation, and user-visible driver UI. TWAIN and WIA are separate Windows
paths. A session-0 Windows service is a poor default for interactive or
UI-sensitive drivers.

**Proposal (both approvals required):** default to a per-user desktop/tray
agent and isolate Win32 TWAIN work in a separately supervised process. Keep a
machine-wide/session service as an enterprise variant only if an actual need
justifies it. This is a safety and compatibility proposal, not a performance
measurement.

For macOS, ImageCaptureCore is the ICA integration path. A production package
must account for Developer ID signing, hardened runtime, notarization, nested
helper/framework signatures, and arm64/x86_64 universal delivery where
feasible. Do not infer a generic scanner TCC prompt: scanner access, vendor ICA
support, sandbox entitlements, and Local Network privacy must be tested
separately.

For Linux, SANE availability depends on backend packages, user permissions, and
distro setup. USB access may require least-privilege udev rules; eSCL can avoid
USB permissions but depends on network discovery/firewall policy. AppImage does
not automatically package kernel/device access, udev policy, or every distro
SANE backend. Exact distro dependencies and support policy are unknown.

## naps2-webscan reference and limits

The MIT-licensed `cyanfish/naps2-webscan` repository is an eSCL/HTTP reference:

* `NAPS2.WebScan.LocalService/Worker.cs` uses `ScanningContext`,
  `ScanController`, and `ScanServer`/`EsclServer`.
* It sets `SecurityPolicy.ServerAllowAnyOrigin`, selects the first WIA device,
  and registers port 9880.
* Its browser code hardcodes `127.0.0.1:9880`, requests
  `ScannerCapabilities`, starts jobs at resolution 300, and calls
  `NextDocument` until 404.

These choices show a possible eSCL-shaped flow, not a secure product protocol.
Allow-any-origin is unsafe for Zilo, first-device selection fails the required
device list, fixed port and no browser discovery are operational limitations,
and manual per-device ports are not a general installation strategy. No
documented WebScan behavior establishes WSD support or complete Dynamsoft
parity.

## Backend alternatives

### Shared .NET service using NAPS2

Advantages are one primary implementation language, existing documented routes,
and a path to shared settings/page/PDF handling. Risks are dependency/license
closure, API stability, native binaries, TWAIN worker behavior, and gaps such
as unverified WSD.

### Native services per OS

Advantages are direct platform APIs and potentially clearer driver debugging.
Risks are three implementations, duplicated job/export/security code, more
installers, and separate behavior contracts. macOS ICA, Windows TWAIN/WIA, and
Linux SANE still need actual devices.

### Rust or Go with native FFI

This remains an alternative, not an evidenced winner. It needs substantial
platform FFI and TWAIN isolation. No benchmark, compatibility study, or
maintenance comparison was performed. Language choice does not solve driver
discovery or browser security.

**Proposal (both approvals required):** start with a .NET implementation behind
a language-neutral Zilo contract. Preserve replaceable adapter boundaries so a
native worker is added only where hardware evidence requires it. Do not expose
NAPS2 classes as the wire contract.

## Proposed neutral backend contract

The contract should independently represent:

1. **Devices:** installation-local ID, display name, backend (TWAIN, WIA,
   ICA/ImageCaptureCore, SANE, eSCL, or a verified future WSD path), local or
   network origin, connection state, and capability schema.
2. **Capabilities:** DPI values/ranges, pixel/color modes, paper sizes,
   flatbed/ADF, duplex, multipage limits, source selection, and constraints;
   unsupported settings must be explicit.
3. **Jobs:** requested/effective settings, ordered pages, progress,
   cancellation, timeout, feeder-empty/jam/disconnect/device-busy errors, and
   bounded retention.
4. **Exports:** explicit image formats and PDF, selected pages, size limits,
   content type, and safe server-managed output handles rather than arbitrary
   filesystem paths.
5. **Negotiation/diagnostics:** protocol version, feature flags, service
   version, backend failures, and permission state without document data.

**Proposal (both approvals required):** use a Zilo-native REST plus event
protocol, with an optional thin Dynamsoft adapter after the owner's actual API
inventory is supplied. Verify target Dynamsoft behavior by contract tests, not
guessed signatures.

## Virtual scanner

The exact Dynamsoft virtual scanner source name and activation mechanism were
not established by authoritative evidence. Do not implement against a guessed
name, reproduce its sample page, or treat it as redistributable.

**Proposal (both approvals required):** create an original deterministic virtual
scanner using owned fixtures (generated SVG/PNG pages and fixed multipage
content, for example). It must use the same capability/job/export model as a
real device and cover:

* DPI, monochrome/grayscale/color, paper metadata, flatbed/ADF, duplex, and
  ordered multipage results;
* deterministic delay/progress, cancellation, feeder-empty, paper-jam,
  timeout, disconnect, and malformed-setting errors;
* explicit limits on pages, pixels, bytes, duration, and concurrent jobs;
* repeatable pixel/content hashes and page-order assertions.

PDF byte equality is not always valid because timestamps, producer metadata, or
object ordering may vary. Compare normalized PDF content/page images and
separately test metadata policy. Keep fixtures and generated art original and
documented.

## Service security and transport

Bind to loopback only by default. Validate `Host` and exact expected `Origin`
for HTTP and WebSocket handshakes; use exact CORS allowlists and `Vary: Origin`.
CORS and Origin are policy signals, not authentication. Pair with a
per-installation asymmetric key and high-entropy, short-lived, one-time
challenge. Reject replay, CSRF, DNS rebinding, arbitrary URLs/filepaths,
unbounded resource requests, state-changing GETs, and unauthenticated document
access. Isolate scanner-worker crashes and retain temporary documents only as
long as required.

**Proposal (both approvals required):** use explicit user-approved pairing and
scoped short-lived credentials for the browser client. Expose only minimal
unauthenticated diagnostics and never let a URL handler bypass pairing.

The public app and local transport remain a spike question. HTTPS pages
generally reject active mixed content, including `ws://`; localhost can be
potentially trustworthy but this does not guarantee cross-origin success.
Chrome 142 documents secure-context LNA permission for public-to-local
requests. Edge documents LNA rollout from Edge 143 with WebSockets initially
excluded. Chrome's old PNA headers are not a current primary mechanism. Exact
Chrome WebSocket behavior, Firefox rollout, and Safari stable behavior are
unverified; Safari/WebKit bugs establish risk, not universal failure.

**Superseding transport proposal (both approvals required):** the earlier
HTTPS-everywhere preference is superseded in this GPT research by willingness
to evaluate an HTTP-first local transport against local TLS in a spike-gated
comparison, including the Safari S1/S2 comparison. Never claim WSS by itself
fixes LNA. If local trust is used,
generate a unique per-install key/certificate or CA; never ship a shared
private key/root, silently install trust, or omit rotation, revocation, and
uninstall cleanup. This remains a proposal, not a decision; only a
`DECISIONS.md` entry approved by both masters can put either transport choice
in force.

## Discovery and protocol launch

A native `zilo://` handler installed by the OS is distinct from a PWA
`protocol_handlers` entry or `registerProtocolHandler()`. PWA registration is
browser/OS-managed and does not prove a native handler. User gestures, policy,
consent, and app state affect launch. A web app cannot reliably infer handler
presence from a UA or timeout.

**Proposal (both approvals required):** provide user-click-only native scheme
launch as an optional convenience, followed by a bounded probe and normal
download/install fallback. Treat timeout/absence as indeterminate and keep
recovery UI actionable.

## Packaging and acceptance

Windows: per-user installation is safer for device/session access and updates.
Sign installers and executables, timestamp signatures, publish an HTTPS
manifest and SHA-256 hashes, and do not advise disabling SmartScreen. Validate
x86/x64 worker delivery and rollback.

macOS: sign hardened-runtime Developer ID artifacts, notarize, verify nested
helpers/frameworks, and build universal arm64/x86_64 outputs where feasible.
Record actual entitlements and privacy observations.

Linux: choose supported distros first. Native `.deb` and `.rpm` packages are
explicit for managed fleets; AppImage is optional, not proof of SANE/udev
portability. Install least-privilege udev policy only when required and remove
it on uninstall. Desktop scheme registration is environment-dependent and must
retain localhost fallback.

**Proposal (both approvals required):** make clean install, upgrade, rollback,
uninstall, signature verification, anti-downgrade, crash recovery, and
incompatible-protocol behavior acceptance tests on all three OSes. Signing
credentials, notarization accounts, hardware keys, and publisher reputation
are owner-operated gates and cannot be marked complete by simulation.

## Test and CI proposal

**Proposal (both approvals required):** use native Windows, macOS, and Linux CI
runners to build/test service, workers, SDK, and packages. Run neutral contract
tests against the virtual scanner; security tests for origins, pairing, replay,
CSRF, file/path boundaries, quotas, crash isolation, and retention; browser
tests across Chromium, Firefox, and WebKit; and package install/update/uninstall
checks. Track real Safari and hardware separately.

The hardware checklist should include Windows TWAIN and WIA, macOS ICA on each
architecture where possible, Linux SANE USB, and eSCL. Report unsupported
capability behavior rather than coercing a pass. WSD is marked verified only
after an actual route and device test.

## Open questions and blockers

The owner's Dynamsoft integration and target major version are needed before
committing to a drop-in adapter. Target browsers/OSes/distros determine support
and packaging. The owner must decide whether local CA trust is acceptable and
whether enterprise machine-wide deployment is required. Actual NAPS2 package
closure, native RID assets, notices, and licenses must be inventoried and
reviewed. Browser LNA/TLS/protocol behavior, hardware coverage, notarization,
publisher signing, rollback, and clean install/update/uninstall evidence are
release blockers.
