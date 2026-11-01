# Scan dialog

Prototype: [`design/prototypes/scan-dialog.html`](../../design/prototypes/scan-dialog.html). States are listed under
"State" in its control bar. Copy keys `scan.*` and the error codes are in [copy.md](copy.md). Implemented by T22 on the
T15 foundation (`@zilo/ui`, Web Component `<zilo-scan-dialog>`).

Decisions honoured: D-005 (caps, effective settings, pages, export), D-007 (virtual scanner), D-004 (pages kept after
export, ownership by token), PLAN §1 (rotate, reorder and delete only; no other editing in v1).

## 1. Layout

```
┌ Scan documents ─────────────────────────────────────────────── [×] ┐
│ Scanner          [⟳ Refresh] │ Pages (6)            [PDF|JPEG|PNG] │
│ ○ Brother ADS-2700W          │ ┌ banner: error / effective settings ┐
│   Network [eSCL]             │ └────────────────────────────────────┘
│ ● Canon DR-C225 II           │ ┌────┐ ┌────┐ ┌────┐ ┌────┐          │
│   USB [TWAIN]                │ │ p1 │ │ p2 │ │ p3 │ │ p4 │  …       │
│ ○ Canon DR-C225 II  USB [WIA]│ └────┘ └────┘ └────┘ └────┘          │
│ ─────────────                │ 1 [Front]   ⟲ ⟳ ‹ › 🗑                │
│ ○ Zilo Virtual Scanner       │                                      │
│   Test pages [Virtual]       │ ▸ Keyboard shortcuts                 │
│ Settings                     │                                      │
│ Source [Feeder|Flatbed]      │                                      │
│ ☑ Scan both sides            │                                      │
│ Resolution [200 dpi ▾]       │                                      │
│ Colour [Colour|Grey|B&W]     │                                      │
│ Paper size [Letter ▾]        │                                      │
├──────────────────────────────┴──────────────────────────────────────┤
│ ▬▬▬▭▭ Scanning page 3…                 [Cancel scan] [Scan / Add N] │
└─────────────────────────────────────────────────────────────────────┘
```

- Modal dialog, max 64rem × 44rem, centred over a scrim. The left column is fixed at 19rem; the page grid takes the rest.
- Below 44rem of container width (a container query on the dialog, not the viewport), the columns stack: scanner and
  settings first, then pages. The footer stays pinned.
- On viewports under 640px wide the dialog fills the screen (no margins, no corner radius). Mobile browsers are out of
  scope for v1, but the layout must not break at 320 CSS px (WCAG 1.4.10 Reflow).

## 2. Scanner list

| Element | Spec |
|---|---|
| Group | `role="radiogroup"` labelled by the "Scanner" heading. Native radio inputs, visually styled as rows. |
| Row | Connection icon, device name (wraps, never truncated), connection label ("USB", "Network", "Test pages"), driver badge. |
| Driver badge | Text, not colour: `WIA`, `TWAIN`, `ICA`, `SANE`, `eSCL`, `Virtual`. Mono font, outlined. Virtual uses a dashed accent outline. Screen readers hear "…, driver TWAIN". |
| Same device, two drivers | Listed twice (e.g. WIA and TWAIN), separated only by the badge. We do not merge or hide routes: drivers expose different caps. Order: network, then USB alphabetically, then virtual last after a divider. |
| Selection | Last-used device per origin (SDK stores the device ID), else the first physical device, else the virtual scanner. |
| Virtual scanner | "Zilo Virtual Scanner", connection "Test pages", always last. Hosts can hide it with an option (`showVirtualScanner`, default `true`, so the owner's parity requirement holds). |
| Refresh | Ghost button "Refresh" (`aria-describedby` the heading). Sends `POST devices/refresh` (runs discovery now, joins one already running; T10 R-D1), then reads the list with `GET devices`, which has no side effects (D-004: no state-changing GET). Existing rows stay; the list gets `aria-busy="true"` and the button shows a spinner and "Refreshing…" (`aria-disabled`). Disabled while scanning. Prototype state `refreshing`. |
| Loading | First load: spinner + "Looking for scanners…" + three skeleton rows. Polite announcement once. |
| Empty | "No scanners found" box with guidance and a Refresh button (focused). Settings show "Choose a scanner to see its settings." Scan is disabled. |
| Only virtual | Info banner "No physical scanners found" above the list; the virtual scanner is selected. |
| While scanning or exporting | Radios disabled. |

## 3. Settings bound to capabilities

Settings come from `GET devices/{id}/caps` (D-005). **Only values the device supports are offered.** No value is ever
shown and then rejected.

| Setting | Control | Rules |
|---|---|---|
| Source | Segmented radio: "Document feeder", "Flatbed" | Shown only for sources in caps. With a single source, show it as text: "Document feeder (only option)". Default: feeder if present. |
| Both sides | Checkbox "Scan both sides" | Only when the feeder reports duplex. Hidden when Flatbed is selected. |
| Resolution | Select, values in dpi | Discrete caps list. If caps give a range, offer the standard stops inside it (75, 100, 150, 200, 300, 400, 600, 1200). Default 200 dpi, or the closest supported. |
| Colour | Segmented: "Colour", "Grey", "B&W" | Only supported modes. Default Colour. |
| Paper size | Select | "Auto-detect" first when supported, then Letter, Legal, A4, A5, "Full scan area". Default: Auto-detect, else Letter for `en-US`/`en-CA`/`es-MX` locales and A4 elsewhere. |

- **Persistence:** the last settings are remembered per device ID and origin. When a remembered value is no longer in
  caps, fall back silently to the default.
- **Loading caps:** when the selection changes, the settings fieldset is disabled and shows "Reading scanner settings…"
  in place of its fields. Scan stays disabled until caps arrive. Keep the old values visible if the request takes under
  300 ms, to avoid flicker.
- **Effective settings:** after a scan, if the job reports different effective settings (D-005), an info banner (not an
  alert) above the pages reads "Your scanner used different settings: Scanned at 300 dpi. You chose 400 dpi, which
  Canon DR-C225 II doesn't support." It is announced politely once.
- **Driver UI (`showDriverUI`):** not exposed in v1 UI. It stays an SDK option for integrators who need the TWAIN
  driver's own dialog.

## 4. Scan action and progress

| State | Footer left | Footer right |
|---|---|---|
| No pages | — | `Cancel` · **`Scan`** (primary, scanner icon) |
| Scanning | Progress bar + "Scanning page *n*…" (or "*n* of *total*" when known) | `Cancel scan` (focused) · **`Scanning…`** (busy, `aria-disabled`) |
| Pages present | "*N* pages · PDF" | `Scan more` · **`Add N pages`** (primary) |
| Exporting | Progress bar + "Preparing your PDF…" | both buttons `aria-disabled`, primary busy |

- **Progress:** `role="progressbar"`, labelled "Scan progress". Indeterminate for feeders (the page count is unknown),
  with `aria-valuetext` carrying the text. Determinate when the agent reports per-page progress for a known total.
- **Cancel:** sends cancel. Pages already received are kept (D-004 lets the caller choose; the UI keeps them). The
  footer shows "Scan stopped. *N* pages kept."
- **Feeder end:** running out of paper after at least one page ends the scan normally. `feeder-empty` is an error only
  when no page was fed.
- **Primary label:** "Add *N* pages" by default; hosts can override it (`confirmLabel`, for example "Attach" or "Save").
  The count stays in the label.
- **Done:** the dialog exports in the chosen format, resolves the SDK promise with `Blob`/`File` objects (D-005), and
  closes. The host uploads them.

## 5. Page thumbnails

- Pages appear as they arrive on the event stream. The next expected page shows a dashed "Receiving…" card with a
  spinner. Thumbnails use `pages/{n}?maxWidth=` sized for 2× the card width.
- The card shows the page number, a Front/Back badge for duplex, and an action row: **Rotate left**, **Rotate right**,
  **Move earlier**, **Move later**, **Delete**. Every icon button has a full accessible name ("Rotate page 3 left").
  Move earlier is `aria-disabled` on the first page and Move later on the last.
- **Arrival motion:** a 320 ms fade-and-rise. With reduced motion, the card appears without moving.
- **Rotation** turns the thumbnail with a 200 ms transform and scales it down so it fits. It is applied at export.
- **Reorder:** with buttons and the keyboard. Drag and drop may be added as a pointer enhancement, but never as the only
  way (WCAG 2.5.7).
- **Delete** is immediate, with no confirmation. A toast "Page 3 deleted. Undo" (`role="status"`) stays 8 s, and
  Ctrl/⌘+Z also undoes. Deleting the last page returns to the empty pages state.
- **Keyboard:** see [accessibility.md](accessibility.md) §3. The grid uses a roving tabindex, so it is one Tab stop.
- **Contract dependency (for T10):** export needs the page order and a per-page rotation in the request body, for
  example `pages: [{index, rotate}]`. Without that, the SDK would have to rotate client-side.

## 6. Export

- "Save as" segmented control in the pages header: **PDF** (one file), **JPEG**, **PNG** (one file per page). TIFF is
  supported by the contract and can be enabled by host option (`formats`). The host can also preset or lock the format.
- Export runs when the user confirms. On failure (`export-failed`) the pages stay (D-004), the banner offers "Try
  again" and "Change format", and the footer becomes active again.

## 7. Errors

- Job or export errors show as a **danger banner at the top of the pages panel** with `role="alert"`: title, body,
  actions, and the code in small mono text ("Code: paper-jam") for support. The dialog stays open, and the pages
  already received stay visible.
- Copy and actions for every code are in [copy.md](copy.md). Placeholders: `{device}` is the device name, `{count}` the
  number of pages kept, `{format}` the export format.
- Banner codes (`scanBannerCodes` in `copy.js`): the ten scan-time codes plus the T10-added `rate-limited`,
  `invalid-settings`, `unsupported-capability`, `not-found` and `agent-unavailable`. `invalid-settings` focuses the first
  field named in `errors[].field`; `unsupported-capability` re-reads caps; `rate-limited` disables Try again until
  `Retry-After` ends; `not-found` never says why the scan is gone or who owns it (R-J1).
- `unauthorized-origin`, `consent-denied` (both variants) and `token-revoked` are not banner errors. They replace the
  Scan dialog with the Connect dialog (see [detection-dialogs.md](detection-dialogs.md)), because no further call can
  succeed. `token-invalid` is silent (the SDK renews and retries once).
- Codes unknown to this UI version map to `unknown`. The SDK ignores unknown fields (PLAN §4).

## 8. Closing

- Close (×), Esc and Cancel close immediately when there are no pages.
- With unsaved pages, an `alertdialog` asks "Discard 6 scanned pages?". **Keep pages** is primary and focused; "Discard
  pages" is a danger button. When discarded, the SDK disposes the job (`DELETE jobs/{id}`).
- During a scan, Esc first cancels the scan (same as "Cancel scan"). A second Esc then follows the rules above.
- On close, focus returns to the element that opened the dialog (the host's Scan button).

## 9. States in the prototype

`ready`, `loading`, `empty`, `virtual-only`, `caps-loading`, `scanning`, `refreshing`, `pages`, `deleted`,
`exporting`, `error` and `discard`, each in light and dark, with Windows, macOS or Linux device lists. The prototype's
`matrix()` lists `state=error&code=…` explicitly for **all 15 banner codes**, and `check.cjs` fails if any banner code
is missing from it (review r1 #5).
