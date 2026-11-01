# The owner app's Dynamic Web TWAIN integration (call inventory)

Source: the owner, 2026-11-01, read from the app's code (`apps/web-app`). It answers
OWNER-QUESTIONS Q1–Q13. It is the **owner call inventory** that T50 (`@zilo/dwt-compat`) was
blocked on. API names are listed from the owner's own code, for clean-room compatibility (OD-9);
no Dynamsoft code or docs are copied.

## Scope
- **One feature uses DWT:** the Scan button on the patient Documents page
  (`PatientDocumentsHeader.tsx:109`). The admin app has the env var but no scan UI.
- **Framework:** React + TSX (Vite env vars, Radix UI dialogs). This matches OD-8's React-first
  wrapper.

## Version and loading
- `dwt` **19.4.2** from npm (`import Dynamsoft from "dwt"`), upgraded from 19.0.0 for a vendor
  security release. It is outside the 18.5–19.2 range that returns blank images on Chrome 142+.
- There is no `dynamsoft.webtwain.config.js` and no `install.js` override. Everything is set in
  code in `src/hooks/useScan.tsx`:
  - `ResourcesPath = "/dwt-resources"`. The build copies `node_modules/dwt/dist` there, including
    the unused `addon/`.
  - `ServiceInstallerLocation = "https://demo.dynamsoft.com/DWT/DWTResources/dist"`. Installers
    come from Dynamsoft's demo CDN; the app used to self-host them.
  - `Containers = [{ WebTwainId: "dwtObject", ContainerId: "dwtControlContainer", Width: "100%", Height: "400px" }]`
  - `CustomizableDisplayInfo.loaderBarSource = "/rotating_logo.svg"`
  - `AutoLoad` and the ports keep their defaults.

## Lifecycle
1. `Dynamsoft.DWT.RegisterEvent("OnWebTwainReady", handler)`
2. `await Dynamsoft.DWT.Load()`
3. In the handler: `Dynamsoft.DWT.GetWebTwain(containerId)`
4. `Dynamsoft.DWT.Unload()` runs when the dialog closes, so **every open loads DWT again**. Load
   must therefore be fast and idempotent.

Never used: `CreateDWTObjectEx`.

`Dynamsoft.DWT.ProductKey = import.meta.env.VITE_APP_DYNAMSOFT_WEB_TWAIN_LICENSE`. The key is baked
into the frontend bundle from GCP Secret Manager. The compat layer accepts the key and ignores it.

## Device selection
- `GetDevicesAsync()`, then `SelectDeviceAsync(device)`. The device is matched by `displayName`.
- The app shows its **own list** (a `SingleSelect` in `CustomScanCard.tsx`), and the first device
  is selected by default.

Never used: `GetSourceNames`, `SelectSource*`, `OpenSource`.

## Acquisition
- `AcquireImageAsync({...})`, then `CloseSourceAsync()`, with these options:
  - `IfFeederEnabled: pageFeeder`: a user toggle, **default true** (ADF).
  - `IfDuplexEnabled: duplex`: a user toggle, default false.
  - `IfDisableSourceAfterAcquire: true`
  - `IfGetImageInfo: true`
  - `IfGetExtImageInfo: true`
  - `extendedImageInfoQueryLevel: 0`
- Not set: `IfShowUI` (the DWT default applies; the app never asks for the driver UI),
  `PixelType`, `Resolution`, `PageSize`, `IfAutoDiscardBlankpages`, `IfCloseSourceAfterAcquire`.
- `getCapabilities` and `setCapabilities` are never called.

## Viewer (the largest part of the adapter)
- It uses **Dynamsoft's built-in viewer** in `#dwtControlContainer`, 400px high.
- It adds `Viewer.createThumbnailViewer(...)`:
  - on the left, 25% wide, 1 column × 3 rows, vertical scroll;
  - `allowPageDragging: true` (**drag to reorder**);
  - `allowKeyboardControl: true`;
  - custom teal hover and selected colours.
- It does not use the `ImageEditor`, and the app never renders images itself.
- **The adapter must provide:** a main viewer, a thumbnail strip with drag reorder and keyboard
  control, current-page selection, and themeable colours.

## Buffer
- `HowManyImagesInBuffer`: to build the list of all page indexes for export.
- `CurrentImageIndexInBuffer`
- `RotateLeft(currentIndex)`: one "Rotate Page Left" button.
- Reorder happens only through thumbnail drag, not `MoveImage`. Users **cannot delete pages**.

Never used: `RemoveImage`, `RemoveAllImages`, `RotateRight`, `SwitchImage`, `SelectImages`, crop,
blank-page detection.

## Output and upload
- **The real path:** `ConvertToBase64(allIndexes, IT_PDF, onSuccess, onError)`. That gives **one
  multi-page PDF** of all pages, with no compression or quality settings.
- The code also references `ConvertToBlob(…, IT_PDF)` and `SaveAllAsPDF("scanned.pdf")`, but
  nothing calls them.
- `HTTPUpload` is not used. The app posts the base64 string to its own API (`createDocument`)
  with `file_name: "scanned.pdf"`, `file_content_type: "application/pdf"`, plus the document name
  and type from a form.

## Events and errors
- Only `OnWebTwainReady` is used.
- The convert calls have error callbacks, and the app shows a "Failed to save document" toast.
- A device-not-found path carries a `// TODO: Log this error into sentry` comment.

## Add-ons
None: no PDF Rasterizer, Webcam, barcode, OCR, `LoadImageEx` or RemoteScan.

## Install flow
- The app doesn't customize the install dialog or `OnWebTwainNotFound`, and has no download link
  of its own.
- **Known issue:** DWT's install dialog conflicts with the **Radix modal**. `ScanDialog.tsx`
  resets `body.style.pointerEvents` as a workaround and blocks `onPointerDownOutside`, so clicking
  outside no longer closes the dialog.
  - **Zilo requirement:** our dialogs and viewer must work inside a host app's modal (Radix and
    similar) without hacks. That covers nested focus traps, pointer-events, portals and z-index.
    It applies to T15, T22 and T45.

## Hosting and security headers (`src/web-clients/nginx.conf`, `location /`)
- CSP `connect-src 'self' ws: wss: http: https: blob: …` allows any http/ws origin, so loopback
  works today. A future tightening would need explicit `http://127.0.0.1:<port>`; document it in
  the integration guide.
- No COOP and no COEP. This is good for the Safari S2 pop-up bridge: no
  `same-origin-allow-popups` change is needed on the owner's side.
- `X-Frame-Options: SAMEORIGIN` and no `frame-ancestors`. Scanning runs in the app's own top-level
  page, so **Local Network Access iframe delegation doesn't apply** to the owner.

## Compat priority for T50 (derived)
**P0** is exactly the surface above:
- the lifecycle (`RegisterEvent`/`OnWebTwainReady`, `Load`, `Unload`, `GetWebTwain`, `ProductKey`,
  `ResourcesPath`, `Containers`);
- `GetDevicesAsync`, `SelectDeviceAsync`;
- `AcquireImageAsync` with the options above, `CloseSourceAsync`;
- `HowManyImagesInBuffer`, `CurrentImageIndexInBuffer`, `RotateLeft`;
- `ConvertToBase64(IT_PDF)`;
- the built-in viewer plus `Viewer.createThumbnailViewer` (drag reorder, keyboard, colours).

**P1** is the common public DWT API beyond that (OD-9 open-source scope): `ConvertToBlob`,
`SaveAllAsPDF`, `RemoveImage`, `RotateRight`, `MoveImage`, `SelectSourceAsync`, `GetSourceNames`,
`HTTPUpload`, the transfer and buffer events, `PixelType`/`Resolution`/`PageSize`, and more.
