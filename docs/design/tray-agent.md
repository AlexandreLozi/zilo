# Tray and menu-bar agent

Prototype: [`design/prototypes/tray.html`](../../design/prototypes/tray.html) (View × OS). Copy keys `tray.*` are in
[copy.md](copy.md). The native shells are built by T44 (BE lane, GPT); this spec owns copy and visuals (PLAN §3). The
prototype approximates native windows in HTML. **Production shells use each OS's native controls and fonts, and
follow the OS light or dark theme and accent colour.** Zilo tokens apply only to custom-drawn parts: the origin box, the
app mark and the tray glyph.

Decisions honoured: D-004 (consent, cool-down, per-origin tokens, revocation, installer-baked origins), D-008 (per-user
agent, autostart, signed updates), D-003 (consent binds the public app origin, never the bridge origin).

## 1. Consent prompt

Triggered when an unknown origin calls the agent (D-004). It is a native window owned by the agent process, and the
web page cannot draw it, style it or put text in it.

```
┌ Zilo ─────────────────────────────────────────┐
│ [▣]  Allow this website to use your scanners? │
│ ┌ Website ──────────────────────────────────┐ │
│ │ https://secure-login.accounts.verify-     │ │
│ │ session.records-portal.example-health.    │ │
│ │ co.uk:8443                                │ │
│ └───────────────────────────────────────────┘ │
│ ⚠ (IDN or http notes, when they apply)        │
│ If you allow it, this website can list your   │
│ scanners and scan pages when you start a scan │
│ there. You can remove access any time in      │
│ Zilo, Allowed sites.                          │
│                              [ Deny ] [Allow] │
└───────────────────────────────────────────────┘
```

### Spoof resistance (requirements for T44)

1. **Only the Origin is shown.** The text comes from the request's `Origin` header after the D-004 checks. Under S2 it
   is the verified opener origin. No page-supplied title, app name, icon or message ever appears in the prompt.
2. **Whole origin, never truncated.** Scheme, host and port are shown in a monospace box. The text wraps only after dots
   (`<wbr>`-style break opportunities), so each label stays whole; a single label longer than the line wraps anywhere.
   The window grows in height (up to 60% of the screen, then the box scrolls). Ellipsis is forbidden.
3. **Registrable domain emphasised.** The eTLD+1 (Public Suffix List, bundled with the agent) is bold in the primary
   text colour. Scheme, subdomains and port are muted. In `https://secure-login.accounts.verify-session.records-portal.example-health.co.uk:8443`
   the reader's eye lands on `example-health.co.uk`.
4. **IDN:** if any host label is punycode (`xn--`), show the **ASCII form** in the box, outline the box in the warning
   colour, and add "Check this address carefully". The note gives the ASCII form and says the address may look like the
   Unicode form in the browser. The Unicode form is never the main display.
5. **Insecure scheme:** `http://` origins (local development only, e.g. `http://localhost:5173`) get a warning note. The
   agent may refuse non-HTTPS origins entirely in release builds; that is the BE lane's call under D-003 ("the public
   app must be HTTPS").
6. **Click and key safety:**
   - Both buttons are disabled for the first **1 s** after the window appears, and again for 1 s after it regains focus.
     This stops click-through from a page that tricks the user into double-clicking.
   - **There is no default button.** Enter does nothing until a button has focus. Initial focus is on Deny.
   - Esc or the close box dismisses without deciding: the request fails as not allowed, but no denial is remembered.
7. **Placement:** centred on the active display, above other windows, without stealing focus from a text field the user
   is typing in (Windows: a topmost window that flashes the taskbar button; macOS: a floating panel; GNOME: a normal
   dialog plus an urgency hint).
8. **Rate limit and cool-down (D-004):** one prompt per origin at a time. Repeat requests join the open prompt. Deny is
   remembered for a cool-down (default 10 min), and during it no prompt appears; the web side shows
   `unauthorized-origin` with "Ask again in N min". Prompts not answered within 2 minutes close as dismissed.

### Outcomes

- **Allow:** the origin goes on the allowlist and a token is issued (D-004). The web Connect dialog continues by itself.
- **Deny:** remembered denial with cool-down; the web side shows `unauthorized-origin`.
- **Dismissed or timed out:** the web side returns to "Approve this site in Zilo" with an "Ask again" action.

## 2. Allowed sites window

Opened from the tray menu ("Allowed sites…") and from the main window.

- **List:** one row per allowed origin. The full origin is in monospace and wraps, never truncated. Under it: the date
  allowed and the last use. The action is on the right.
- **Remove:** a danger button labelled "Remove" with the accessible name "Remove for https://…". It asks for
  confirmation ("Remove access for {origin}?"; Cancel has focus). Remove **revokes every token for that origin** at
  once (D-004), so in-flight jobs for that origin fail with `token-revoked`.
- **Installer-baked origins:** marked with a "Managed" badge. Their action is "Reset access": it revokes tokens, but the
  origin stays allowed, so it reconnects without a prompt (D-004: baking skips consent, not authentication). They cannot
  be removed from the UI.
- **Recently denied:** a second list of origins in cool-down, with "Forget". Forget clears the denial so the site can
  ask again.
- **Empty state:** "No sites yet. When a website asks to use your scanners, Zilo asks you first."

## 3. Tray / menu-bar menu

| Item | Behaviour |
|---|---|
| Status header (not interactive) | "Zilo is running · Version 1.4.2 · 3 scanners found". While scanning: "Scanning for app.example.com · Page 3". With an update: "Update available · Zilo 1.4.3 is ready to install". |
| Restart to update | Only when a verified update is staged (D-008). |
| Allowed sites… | Opens the window above. |
| Open logs folder | Opens the per-user log directory in the file manager. Logs never contain document content or tokens (PLAN §4). |
| Check for updates | Manual check of the signed manifest. The result shows in the status header. |
| Start Zilo at login | Checkbox item for the D-008 autostart mechanism of the OS. On by default. |
| About Zilo | Version, licences and NOTICE (D-002), source offer link. |
| Quit Zilo | Quits. If a job is active, a confirm says the scan stops and its pages are deleted ("Keep running" is the safe default). |

**Icon states:** idle (glyph only), scanning (glyph with a small activity mark; animated only if the OS allows it and
reduced motion is off), attention (glyph with an amber dot: update ready or an error). The glyph is monochrome, so it
adapts to light and dark bars.

**Main window:** launching Zilo again from the Start menu, Launchpad or the app grid while it is running opens a small
main window: status, port, allowed-site count, autostart, and buttons for Allowed sites, logs and Quit. This is the
fallback on desktops without a tray.

## 4. Platform conventions

### Windows (10 and 11)
- **Location:** a notification-area icon. Left click and right click both open the menu: Zilo has no main window to
  restore, so a single gesture is simpler. Windows 11 may hide the icon in the overflow; the installer cannot pin it.
  The main window covers that case.
- **Menu:** a native context menu with standard keyboard access, including access keys (&Allowed sites, &Quit).
- **Consent:** a small topmost window with a title bar ("Zilo") and the buttons bottom-right in Windows order:
  **Allow, Deny**. Not a toast notification: toasts can be missed, suppressed by Focus Assist, and cannot enforce the
  input delay.
- **Look:** Segoe UI Variable, Fluent styles, follows `AppsUseLightTheme` and the system accent. Icon assets at 16, 20,
  24 and 32 px for each DPI scale.

### macOS (13+)
- **Location:** a menu-bar extra (an `LSUIElement` agent with no Dock icon). It uses a **template image**, so macOS tints
  it for light and dark bars.
- **Menu:** an `NSMenu` with standard shortcuts shown (⌘, for Allowed sites, ⌘Q for Quit).
- **Consent:** a floating panel (`NSPanel`, non-activating until clicked) with an alert layout: app icon, bold title,
  informative text, the origin box. Buttons in macOS order: **Deny, Allow**, with Allow rightmost. Neither is the default
  button (no blue fill, Return does nothing).
- **Login item:** `SMAppService` (D-008). macOS lists Zilo under Login Items; the menu checkbox reflects that state.

### Linux (GNOME, KDE, others)
- **Location:** a StatusNotifierItem (AppIndicator) icon. KDE Plasma and Ubuntu's GNOME show it. **Stock GNOME has no
  tray**: without a StatusNotifier host, Zilo runs headless (systemd `--user`, D-008), and the desktop entry opens the
  main window instead. The main window then shows "No system tray found" with a short explanation.
- **Menu:** the dbusmenu exported with the SNI.
- **Consent:** a libadwaita alert dialog, or Qt on KDE if the shell is built with Qt: centred title, body, origin box,
  and full-width buttons with **Deny** left and **Allow** right. The window gets an urgency hint.
- **Look:** follow the desktop theme (Adwaita or Breeze), including dark preference (`org.freedesktop.appearance
  color-scheme`).

## 5. Accessibility (native)

- Native controls give each platform's screen reader (Narrator, VoiceOver, Orca) names and roles. The origin box must
  expose the full origin as one readable string, not fragments.
- Each window has a title. The consent window's accessible description is its body text.
- Every action is keyboard-reachable. Tab order: origin box (focusable, read-only, so it can be read and copied), then
  Deny, then Allow.
- Respect the OS high-contrast and reduced-motion settings.
