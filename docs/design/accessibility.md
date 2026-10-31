# Accessibility spec

Target: **WCAG 2.2 level AA** for every web surface (`@zilo/ui`) and the equivalent platform guidance for the native agent
(PLAN §6). The prototypes implement the patterns below and pass an axe scan (`design/prototypes/check/run.sh`: WCAG
2.0, 2.1 and 2.2 A and AA plus best-practice rules, every state, light and dark). axe is necessary but not sufficient:
T15 and T22 add component tests and a manual screen-reader pass (§9).

## 1. Dialog semantics

| Item | Spec |
|---|---|
| Element | Native `<dialog>` opened with `showModal()` inside the component's shadow root. It makes the page inert and handles Esc. Hosts that cannot use top-layer dialogs get the same behaviour from the T15 fallback (inert siblings, plus the trap below). |
| Role | `dialog` for Scan and Connect. `alertdialog` for confirmations (discard pages, remove access, quit while scanning). |
| Name | `aria-labelledby` points at the visible heading. |
| Description | `aria-describedby` points at the lede paragraph in the Connect states and at the body in confirmations. The Scan dialog has no description (too long). |
| Modal | `aria-modal="true"`. Live regions sit **inside** the dialog, because content outside an `aria-modal` dialog may be hidden from assistive tech. |
| Focus trap | Tab from the last focusable element wraps to the first, and Shift+Tab from the first wraps to the last. Focus never reaches the host page while a dialog is open. |
| Esc | Closes (Connect) or follows the Scan dialog rules: cancel the scan first, confirm the discard of unsaved pages. In confirmations, Esc picks the safe action. |
| Return focus | On close, focus goes back to the element that opened the dialog. If that element is gone, focus goes to the host-provided `returnFocus` element, else `document.body`. |
| Scroll | The page behind does not scroll. The dialog body scrolls inside the dialog. |

## 2. Focus order and initial focus

**Scan dialog**, in DOM order:

1. Close (×)
2. Refresh
3. Scanner radio group: one Tab stop; arrow keys change the selection
4. Source → Scan both sides → Resolution → Colour → Paper size
5. Save as (PDF/JPEG/PNG): one Tab stop
6. Banner actions, when a banner is shown
7. Page grid: one Tab stop, then the active page's 5 action buttons
8. Keyboard shortcuts disclosure
9. Footer: Cancel / Cancel scan / Scan more → primary

| Dialog / state | Initial focus |
|---|---|
| Scan, scanners listed | The selected scanner's radio |
| Scan, no scanners | Refresh in the empty box |
| Scan, scanning | Cancel scan |
| Scan, discard confirm | **Keep pages** |
| Connect: checking, consent wait, updating | Cancel / Close (the only action) |
| Connect: denied | Try again |
| Connect: unreachable-or-blocked | Download for {OS} |
| Connect: Safari states | The primary action |
| Connect: `unauthorized-origin` in cool-down | Close (the primary is `aria-disabled`) |
| Native consent | **Deny**; there is no default button (see [tray-agent.md](tray-agent.md)) |

- **State changes:** when the Connect dialog changes state (for example unreachable → consent wait), focus moves to the
  new heading (`tabindex="-1"`), so it is read. When the focused element becomes disabled or disappears (for example
  the busy Scan button after an error), focus moves to the error banner's first action.
- **Never steal focus** for progress updates, arriving pages or status text.
- **Focus not obscured (2.4.11):** the footer and the toast must not cover a focused page card. The footer sits outside
  the scrolling page grid. The toast is placed above the footer, and the grid's `scroll-padding-bottom` is the toast's
  height, so cards scroll into view clear of it (`block: "nearest"`).

## 3. Keyboard

| Where | Keys | Action |
|---|---|---|
| Everywhere in a dialog | Tab / Shift+Tab | Move, wrapping inside the dialog |
| | Esc | See §1 |
| | Enter / Space | Activate buttons, links, disclosures |
| Scanner list, segmented controls | ← → ↑ ↓ | Change selection (native radio behaviour) |
| Browser tabs (denied state) | ← → / Home / End | Switch tab (automatic activation, APG Tabs) |
| Page grid (a page focused) | ← → ↑ ↓, Home, End | Move between pages (↑ ↓ move by one row) |
| | R / Shift+R | Rotate right / left |
| | Shift+← / Shift+→ | Move the page earlier / later. Focus follows the page. |
| | Delete or Backspace | Delete the page (then the next page gets focus) |
| Scan dialog | Ctrl+Z / ⌘Z | Undo the last delete (while the toast is visible) |
| Native menu | OS defaults; access keys on Windows; ⌘, and ⌘Q on macOS | |

- The single-character shortcuts (R) work only while a page card has focus, so they satisfy WCAG 2.1.4 (Character Key
  Shortcuts). The host page's shortcuts never fire while a dialog is open.
- Shortcuts are listed in a "Keyboard shortcuts" disclosure under the page grid. Each page card references the list
  with `aria-describedby`.
- No action needs a pointer. Drag-to-reorder, if added, is an extra (2.5.7).

## 4. Live regions and announcements

- Each dialog creates two empty visually hidden regions when it mounts: `aria-live="polite"` and
  `aria-live="assertive"`, both `aria-atomic="true"`. They exist before the first message, so announcements are not lost.
- **Scan progress:**
  - The progress bar is `role="progressbar"` with `aria-label="Scan progress"` and `aria-valuetext` ("Scanning page
    3…"). `aria-valuenow` is set only when the total is known.
  - Page arrivals are announced politely and **batched**: at most one announcement every 2 s ("Page 3 scanned", or
    "Pages 4 to 6 scanned").
  - At the end, "Scan finished. 6 pages scanned." is announced politely.
- **Errors:** the scan-dialog banner is `role="alert"`, which is announced once. The UI does not also write to the
  assertive region, to avoid double reading. Connect-dialog errors arrive as a state change, which moves focus to the
  heading (§2).
- **Page actions:** rotate, move and delete each announce politely ("Page moved to position 2", "Page 3 deleted").
  Delete adds a `role="status"` toast with Undo.
- **Detection:** the `Announce` column in [copy.md](copy.md) sets the politeness per state. The Install dialog's
  re-check status is static text; only the outcome is announced, never each 2 s attempt.

## 5. ARIA roles and labels

| Component | Markup |
|---|---|
| Scanner list | `role="radiogroup"` + `aria-labelledby` (heading "Scanner"). Native radios. The label text includes the name, connection and "driver TWAIN" (visually hidden "driver"). |
| Settings | `<fieldset>` + `<legend>Settings</legend>`. While caps load the fieldset is `disabled` and its status text is shown. |
| Segmented controls | Native radios in `role="radiogroup"` with `aria-labelledby` (Source, Colour) or `aria-label` (Save as). |
| Selects | Native `<select>` with `<label for>`. |
| Page grid | `<ol aria-label="Scanned pages">`. Each `<li>` is focusable (roving) with `aria-label="Page 3 of 6, back side, rotated 90 degrees"` and `aria-describedby` the shortcuts list. Thumbnail images are `aria-hidden` (the label carries the meaning). |
| Page actions | `<button>` with full names ("Rotate page 3 left"). Unavailable moves use `aria-disabled="true"` (still focusable and discoverable), not `disabled`. |
| Receiving card | `aria-label="Page 4, receiving"`, with no actions. |
| Busy buttons | `aria-busy="true"` + `aria-disabled="true"`. The label changes ("Scanning…"). |
| Icon-only buttons | `aria-label` (Close, Refresh, …). Icons are `aria-hidden="true"` and `focusable="false"`. |
| Banners | Info and effective settings: plain region, no live role. Errors: `role="alert"`. |
| Browser tabs | `role="tablist"` / `tab` / `tabpanel` with `aria-controls` and `aria-selected`. The panels are focusable (`tabindex="0"`). |
| Disclosures | Native `<details>/<summary>`. |
| Download links | `<a>` with the full text "Download for Windows (x64)". Picker entries include arch, version and size in their text. |
| `zilo://start` | An `<a>`, because it navigates. Its text says "Start Zilo". |
| Origin chip | Plain text in monospace. It is never an image. |
| Toast | `role="status"`. Its Undo is a real button, reachable with Tab. It is not dismissed while it has focus. |

## 6. Contrast and visual targets (WCAG 2.2 AA)

| Requirement | Target | How it is met |
|---|---|---|
| Text (1.4.3) | ≥ 4.5:1; ≥ 3:1 for large text | Token pairs measured by `check/run.sh` in both themes; axe `color-contrast` on every state |
| Non-text (1.4.11) | ≥ 3:1 for control boundaries, focus and state indicators | `--z-border-strong`, `--z-focus` and the accent measured against bg and sunken |
| Focus visible (2.4.7) | Always visible | 2 px `--z-focus` outline with 2 px offset. Never removed without a replacement. |
| Use of colour (1.4.1) | Not colour alone | Driver badges are text. Selection uses a border + tint + checked radio. Errors use an icon + title. Duplex uses a "Front"/"Back" text badge. |
| Target size (2.5.8) | ≥ 24 × 24 px | Controls 36 px; thumbnail actions 28 px |
| Reflow (1.4.10) | 320 CSS px with no 2-D scrolling | Container query stacks the Scan dialog; the dialog goes full screen on small viewports |
| Text spacing (1.4.12) | No clipping | No fixed heights on text containers |
| Resize (1.4.4) | 200% | rem units throughout |

## 7. Motion and other preferences

- `prefers-reduced-motion: reduce`: see [tokens.md](tokens.md) §6. Nothing that matters is conveyed only by motion.
  Nothing flashes more than 3 times a second.
- `forced-colors: active`: system colours. Borders stay visible. Focus uses `Highlight`.
- `prefers-color-scheme`: the default `theme="auto"` follows it. Hosts can pin a theme.
- Timing (2.2.1): the Install re-check cap and the 8 s Undo toast do not hurt users. The re-check can be restarted, and
  undo is also available with Ctrl/⌘+Z while the toast is open. The toast stays while it is hovered or focused.

## 8. Other WCAG 2.2 criteria that apply

- **3.2.6 Consistent help:** "Get help" and "Copy details" are always in the same place (banner secondary action).
- **3.3.7 Redundant entry:** scanner settings are remembered per device and origin, so users don't re-enter them.
- **3.3.1 / 3.3.3 Error identification and suggestion:** every error states what happened and the next step
  ([copy.md](copy.md)).
- **2.5.7 Dragging movements:** reorder works with buttons and the keyboard.
- **4.1.2 Name, role, value:** see §5. **4.1.3 Status messages:** see §4.

## 9. Verification plan

- **T05 (this task):** axe on every prototype state × light/dark (`design/prototypes/check/run.sh`). Not added to CI,
  per the T05 constraint.
- **T15 / T22:** Playwright + axe on the component catalog and Scan dialog states; keyboard-only E2E for the scan flow
  (no mouse); focus-trap and return-focus tests.
- **Manual (before M4 exit):** NVDA + Firefox and JAWS + Chrome on Windows, VoiceOver + Safari and + Chrome on macOS,
  Orca + Firefox on Linux, using the checklist that §1–§5 imply. Results go in VALIDATION.md as evidenced or pending.
