# Questions for the owner

The owner checks these directly in the app repo that uses Dynamsoft and fills in the answers here,
or tells the liaison terminal. Masters: add new owner questions **here**, not in DISCUSSION.md.

## Answered
- **Safari on macOS:** **required for v1** (owner, 2026-10-31). The Safari path (T25-BE/FE, the S2
  bridge per T01) is release-blocking, not optional.
- **Front-end framework:** the owner left this to the agents. The decision is in OD-8.
- **CI hosting:** private GitHub repo, AlexandreLozi/zilo (OD-7).

## Open: Dynamsoft integration (check in the app repo)
Each answer narrows what `@zilo/dwt-compat` must emulate. Because Zilo is meant to become open
source (OD-9), the adapter will also cover the commonly used DWT API. Your answers set the priority
order and the test cases.

1. **Version.** Which Dynamic Web TWAIN version is deployed? Check the `dwt` version in
   `package.json`, or the version in `Resources/dynamsoft.webtwain.initiate.js`. Versions 18.5–19.2
   return blank images on Chrome 142+.
2. **How it's loaded.**
   - Is it the npm `dwt` package or `<script>` tags?
   - Is there a `dynamsoft.webtwain.config.js`, and which settings does it change (`ResourcesPath`,
     `AutoLoad`, `Containers`, `ServiceInstallerLocation`, ports)?
3. **Initialization.**
   - Which of these does the app call: `Dynamsoft.DWT.CreateDWTObjectEx`, `Dynamsoft.DWT.Load`,
     `GetWebTwain`, or `RegisterEvent('OnWebTwainReady')`?
   - Is the licence key set in code (`Dynamsoft.DWT.ProductKey`)?
4. **Scanner selection.**
   - Which of `GetSourceNames`, `GetDevicesAsync`, `SelectSource` / `SelectSourceAsync`,
     `SelectDeviceAsync` or `OpenSource` does it use?
   - Does it show Dynamsoft's source picker, or its own list?
5. **Acquisition.**
   - `AcquireImage` or `AcquireImageAsync`, and with which options: `IfShowUI`, `PixelType`,
     `Resolution`, `IfFeederEnabled`, `IfDuplexEnabled`, `PageSize`,
     `IfAutoDiscardBlankpages`, `IfCloseSourceAfterAcquire`?
   - Does it read or set capabilities directly (`getCapabilities` / `setCapabilities`)?
   - Does it show the driver's own UI?
6. **Viewer and editing.**
   - Does the app use Dynamsoft's **built-in viewer** (a container div, `Viewer.bind`, thumbnails)
     or the `ImageEditor`?
   - Or does it only take the images and render them itself?

   This is the largest single factor in the adapter's scope.
7. **Buffer operations.** Which of these does it use: `HowManyImagesInBuffer`, `RemoveAllImages`,
   `RemoveImage`, `RotateLeft`/`RotateRight`, `SwitchImage`, `MoveImage`, `CurrentImageIndexInBuffer`,
   `SelectImages`, crop, blank-page detection?
8. **Output and upload.**
   - Which output calls: `ConvertToBlob`, `ConvertToBase64`, `SaveAsPDF`/`SaveAllAsPDF`,
     `HTTPUpload` (and which URL/fields), `OutputSelectedAreaAsync`, or `GetImageURL`?
   - Which formats: PDF, JPEG, PNG or TIFF?
   - Does it use multi-page PDF or TIFF, and what compression or quality settings?
9. **Events.** Which does it use: `OnPostTransfer`, `OnPostAllTransfers`, `OnBufferChanged`,
   `OnBitmapChanged` or `OnTopImageInTheViewChanged`? Any error callbacks?
10. **Add-ons.** Does it use the PDF Rasterizer (loading existing PDFs into the buffer), the Webcam
    add-on, barcode/OCR, `LoadImageEx` (loading local files), or RemoteScan?
11. **Install flow.** Does it customize Dynamsoft's install dialog (`dynamsoft.webtwain.install.js`,
    `Dynamsoft.OnWebTwainNotFound`, its own download link)? Where are installers hosted?
12. **Hosting and security headers** (for the web app page that scans):
    - **CSP** `connect-src`: does it allow `http://127.0.0.1:*`/`localhost`? Dynamsoft's service
      needed an allowance too.
    - **COOP/COEP** headers. These matter for the Safari pop-up bridge.
13. **iframe.** Does the scanning UI run inside an `<iframe>`? This covers two cases: your app
    embeds the scan page from another domain, or your whole app is embedded in someone else's
    portal (for example an EHR or customer portal).
    - **Why it matters:** browsers now gate requests from a web page to the local machine (Local
      Network Access). In a cross-origin iframe, the parent page must explicitly delegate that
      permission (`<iframe allow="loopback-network">`; the legacy `local-network-access` name should not
      be relied on), or every
      call to the Zilo agent is blocked.
    - If scanning happens in your own top-level page, this doesn't apply.
14. **Customers' environment.**
    - Which OS and browser mix do they use (rough %)?
    - Do users have **admin rights** to install software, or do we need a per-user install with
      no admin?
    - Are fleets managed (GPO/Intune/Jamf MDM)? If so, we can pre-approve the browser's
      local-access permission and push installs.
15. **Scanners in use.** Which models or brands are most common? Typical page volume per scan
    (1 page, 10 pages, 100+ ADF)? Duplex? This feeds the owner hardware checklist (T34).
16. **Pain points with Dynamsoft today.** Install failures, certificate or HTTPS problems, slow
    scans, browser breakages? These are the reliability targets Zilo should beat.

## Open: product and governance
17. **Open-source ownership.** Is Zilo yours personally or your employer's? Does publishing it
    need sign-off? This decides who holds the copyright line and the CLA/DCO choice before the
    first public release.
18. **Licence preference** for the open-source release: permissive (MIT/Apache-2.0) or
    copyleft (LGPL/MPL)? The masters will propose one (OD-9). NAPS2 is LGPL, which works with
    either.
