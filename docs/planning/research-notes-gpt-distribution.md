# GPT research notes — Dynamic Web TWAIN parity and distribution

Date: 2026-10-31 (follow-up verification). Phase 1 research only; proposals are not
decisions. URLs were retrieved/rechecked on this date where stated. **Fact** denotes
documentation-backed material; **Proposal** denotes Zilo design advice. Unverified
claims are explicitly identified.

## 1. Dynamic Web TWAIN API surface (reference target, not an implementation license)

Official product/API documentation:

* Product docs: <https://www.dynamsoft.com/web-twain/docs/introduction/>.
* JavaScript API index: <https://www.dynamsoft.com/web-twain/docs/info/api/>.
* `WebTwain.GetSourceNames()` enumerates source names; `SelectSourceByIndex()` and
  `SelectSource()` select a source.  `OpenSource()`/`CloseSource()` open and close
  the selected device.  Verify exact signatures and promise/callback behavior for
  the installed major version before writing a compatibility layer.
* Acquisition is exposed through `AcquireImage()` and acquisition settings on the
  `IfShowUI`, `IfFeederEnabled`, `IfDuplexEnabled`, `Resolution`, `PixelType`,
  `IfAutoBright`, page-size and related properties.  A device may ignore settings;
  the adapter must report effective capabilities rather than assume every device
  supports every property.
* **Fact:** The image buffer is represented by `HowManyImagesInBuffer`,
  `CurrentImageIndexInBuffer`, `GetImageURL()`, `GetImageExtName()`, `SaveAs()`, and
  `GetImageSize()` in this API family. `SetImageInterlaced` is **not** navigation or
  deletion; it controls interlaced encoding behavior. `RemoveAllImages` is deletion;
  current-page selection uses the current-index API. Exact signatures remain
  version-sensitive and require contract tests.
* **Fact:** `SaveAs` is file-oriented. For browser/application handoff, separately
  verify `ConvertToBlob` (Blob result) and `ConvertToBase64` (Base64 result), rather
  than assuming a filesystem path is usable by a browser. These must be tested as
  distinct export paths.
* PDF/image output is normally obtained by saving one image or a selected range in
  the buffer to a format such as PDF, JPEG, PNG, TIFF, or BMP.  Multi-page PDF
  behavior is an important version-specific test: do not infer it from a single
  `SaveAs` call.  Prefer a Zilo explicit `export({pages, format})` contract.
* Events in the API index include source/acquisition lifecycle and transfer/error
  notifications (commonly `OnPostTransfer`, `OnPostAllTransfers`, `OnPreTransfer`,
  `OnTransferFailure`, `OnBufferChanged`, `OnWebTwainReady`, and `OnScannerStatusChange`).
  Names and event payloads differ between old ActiveX-era examples and current
  JavaScript SDK; compatibility code must bind only events proven in the target docs.
* **Verification status (2026-10-31):** the official API index was retrieved at
  <https://www.dynamsoft.com/web-twain/docs/info/api/>. Guessed version-independent
  method URLs for `AcquireImage`, `ConvertToBlob`, `ConvertToBase64`, `SaveAs`, and
  `SetImageInterlaced` returned 404 in the retrieval environment. This review cannot
  provide reliable per-method URLs; re-check the rendered/versioned API index before
  implementation.
* The browser SDK communicates with a locally installed Dynamsoft service/native
  component, rather than receiving arbitrary USB/TWAIN access directly from the
  page.  This is the architectural precedent for a localhost Zilo bridge, but not
  evidence that Dynamsoft's protocol or binaries may be copied.

**Clean-room boundary.** Use public behavior and an independently designed protocol.
Do not copy Dynamsoft JavaScript, service binaries, protocol details discovered by
reverse engineering, fake-scanner assets, or trademarked UI.  A separately written,
optional adapter can map commonly used public calls (`GetSourceNames`, source
selection, `AcquireImage`, buffer count, export, and lifecycle events) to Zilo.
The owner's integration code is still required to know whether that subset is enough.

## 2. Virtual/test scanner and licensing

**Unable to verify exact primary fact:** no retrieved official Dynamsoft page
established the exact virtual scanner source name or activation mechanism. The prior
wording “some distribution paths” is withdrawn. Do not implement against a guessed
name or flag; obtain exact version-specific documentation or vendor confirmation.

**Proposal:** this must not be treated as a redistributable component. The Zilo
equivalent should be an original deterministic source (for example generated
SVG/PNG pages, optional fixed multi-page fixtures, and controllable delay/failure
modes), exposed through the same capability model as physical scanners. It enables
CI without a device and tests ADF, duplex, cancellation, progress, and PDF ordering.

Unknowns requiring vendor/legal confirmation: whether a particular Dynamsoft package
includes the virtual source, whether it is covered by a runtime/development license,
and whether any sample page/image has redistribution restrictions.  Dynamsoft's
current licensing terms are at <https://www.dynamsoft.com/web-twain/license/>;
they govern use of their product and do not grant permission to reproduce it.

## 3. Proposed Zilo backend distribution (platform facts and constraints)

### Windows

* TWAIN and WIA are separate Windows acquisition stacks.  A service running as a
  non-interactive Windows service is a poor place to drive many scanner UI/driver
  interactions; prefer a per-user tray/desktop process bound to loopback, with a
  narrowly scoped service only if a device/enterprise requirement proves it.
* Per-user install avoids elevation for updates and keeps device/session access in
  the logged-in user's context.  Windows Installer/MSIX are packaging choices, not
  guarantees of driver compatibility.  Official references: Microsoft MSIX overview
  <https://learn.microsoft.com/windows/msix/overview> and code signing
  The relevant Microsoft Authenticode reference is
  <https://learn.microsoft.com/windows/win32/secauthn/authenticode>; the previously
  cited driver-signing page is not the appropriate primary reference for a user-mode
  Zilo app that installs no kernel driver.
* Sign the installer and every executable; timestamp signatures; publish SHA-256
  hashes and an HTTPS update manifest.  SmartScreen reputation can still warn a new
  publisher/file, so user-facing installation must explain publisher identity and
  never suggest disabling SmartScreen.  Exact reputation behavior is a Microsoft
  service policy and is an explicit operational unknown.
* Register a custom URL protocol (for example `zilo://`) only as a bootstrap/deep-link
  convenience, not as the security boundary.  Validate origin/nonce in the browser
  handshake and never put secrets in URL query strings.  Windows protocol handlers
  are registered through `HKCU\Software\Classes\<scheme>` for per-user installs;
  see <https://learn.microsoft.com/windows/uwp/launch-resume/handle-uri-activation>.

### macOS

* ICA/Image Capture support is mediated by Apple's ImageCaptureCore framework;
  `ICScannerDevice` and `ICScannerFunctionalUnit` model scanner discovery and
  capabilities.  Apple references: <https://developer.apple.com/documentation/imagecapturecore>
  and <https://developer.apple.com/documentation/imagecapturecore/icscannerdevice>.
* **Fact:** ImageCaptureCore exposes scanner objects; Apple references are
  <https://developer.apple.com/documentation/imagecapturecore> and
  <https://developer.apple.com/documentation/imagecapturecore/icscannerdevice>
  (retrieved 2026-10-31; Apple pages require JavaScript in this environment).
* **Unable to verify / correction:** no retrieved Apple primary source establishes a
  generic “scanner TCC permission” prompt. Do not imply one exists. Scanner access,
  ICA/vendor support, sandbox entitlements, and macOS Local Network privacy are
  separate concerns; do not conflate local-network consent with scanner permission.
  **Proposal:** test both sandboxed and non-sandboxed helper designs and record the
  exact observed prompts and entitlements. A hardened-runtime,
  Developer ID signed, notarized app is the realistic distribution baseline:
  <https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution>
  and <https://developer.apple.com/documentation/security/hardened_runtime>.
* Ship universal arm64+x86_64 binaries where feasible.  Verify all nested helpers,
  frameworks, and bundled launchers are signed for both slices before notarization;
  Apple universal-binary guidance: <https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary>.
* Custom URL schemes are declared in the app bundle's `CFBundleURLTypes` (Apple
  Launch Services reference: <https://developer.apple.com/documentation/bundleresources/information_property_list/cfbundleurltypes>).
  Prefer a localhost authenticated handshake after activation.

### Linux

* SANE is a userspace API with vendor/model-specific backends.  Device availability
  depends on installed backend packages, permissions, and distro configuration;
  SANE is not a universal driver binary.  Official project: <https://www.sane-project.org/>
  and backend docs: <https://www.sane-project.org/docs.html>.
* A practical package should declare distro dependencies and install a udev rule
  only when the selected backend requires it; rules must grant least privilege and
  be removed on uninstall.  Do not assume AppImage can package kernel/device,
  udev, or distro SANE backend dependencies.  Prefer native `.deb` and `.rpm`
  packages for managed fleets, with AppImage as an optional portable UI/runtime
  artifact.  Exact package names and udev groups differ by distribution and scanner.
* A per-user localhost process can use the user's SANE configuration, but USB
  permissions may require admin-installed udev policy.  Network eSCL/AirScan can
  avoid USB permissions but still depends on network discovery/firewall policy.
* Desktop URL handlers use the XDG desktop-entry `MimeType=x-scheme-handler/zilo`
  declaration and `xdg-mime default`; reference:
  <https://specifications.freedesktop.org/desktop-entry-spec/latest/> and
  <https://www.freedesktop.org/wiki/Software/xdg-utils/>.  Registration is
  desktop-environment dependent; the app must retain localhost fallback.

## 4. Cross-platform service security and browser constraints

Run only on loopback, authenticate browser requests with a short-lived pairing token
bound to the requesting web origin, reject unexpected `Origin`, and use explicit
capability/version negotiation.  CORS alone is not authentication.  Browser
Private Network Access / Local Network Access policies can change by browser and
deployment; test Chrome, Edge, Firefox, and Safari in the supported versions rather
than relying on one preflight result.  The bridge must expose a diagnostic endpoint
that reports install version, protocol version, permissions, and scanner backend
errors without exposing device data.

## 5. Acceptance tests for Phase 1 planning

1. **API inventory:** integration fixture proves enumeration, selection, open/close,
   acquisition settings, cancellation, progress/error events, buffer navigation,
   image export, and multi-page PDF export against a fake backend.
2. **Virtual source:** deterministic one-page and three-page fixtures; repeatable
   pixel/hash and page-order assertions; simulated feeder-empty, paper-jam, timeout,
   cancel, and device-disconnect errors.
3. **Physical matrix:** at least one TWAIN and WIA device on Windows, one ICA device
   on each macOS architecture, and one SANE USB plus one eSCL device on Linux; record
   unsupported capability behavior rather than marking the test pass by coercion.
4. **Packaging:** clean-machine install/uninstall/update on each OS; signed artifacts
   verify; macOS `codesign --verify` and notarization acceptance; Windows publisher
   and signature display; Debian/RPM dependency and udev behavior; AppImage fallback.
5. **Security:** hostile web origin cannot enumerate/acquire; token replay expires;
   malformed export paths cannot write outside an approved temp/output area; only
   loopback is listening; URL handler cannot bypass pairing.
6. **Browser/install flow:** absent service, stopped service, incompatible protocol,
   denied permissions, and upgrade-in-progress all produce actionable download/
   recovery UI without blocking the web app indefinitely.

## Explicit unknowns / requests to master

* Obtain the owner's current Dynamsoft integration code before committing to a
  drop-in adapter; exact calls and event assumptions may materially alter scope.
* Confirm target browser versions and whether localhost HTTPS/cert provisioning is
  acceptable.
* Decide whether Windows enterprise deployment requires machine-wide installation,
  signed MSI, Intune packaging, or only per-user distribution.
* Select Linux distro support policy (Ubuntu/Debian, Fedora/RHEL, others) before
  promising package names, udev rules, or scanner coverage.
* Obtain legal review of NAPS2/.NET/SANE/TWAIN/ICA dependencies and the proposed
  clean-room compatibility layer before shipping.
