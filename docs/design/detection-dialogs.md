# Detection dialogs

Prototype: [`design/prototypes/detection.html`](../../design/prototypes/detection.html). Copy keys `state.*` are in
[copy.md](copy.md). Implemented in `@zilo/ui` as one `<zilo-connect-dialog>` whose content changes with the SDK's
detection state; the Install, Permission-help and Update "dialogs" are states of it, so focus and position do not jump
between them.

Decisions honoured: D-008 (detection order, `unreachable-or-blocked`, 2 s re-check only while open, signed updates),
D-003 (Safari S2 properties, the "not yet supported" state, probing only on a user gesture), D-004 (consent and
tokens).

## 1. Flow

```
Scan click (user gesture)
  └─ permissions.query('loopback-network')  (try/catch → unknown)
       ├─ denied ───────────────────────────────▶ Permission denied (per-browser help)
       └─ granted | prompt | unknown
            └─ probe hello  (prompt: show "Choose Allow in your browser")
                 ├─ answers, protocol OK, origin allowed ──▶ Scan dialog
                 ├─ answers, origin unknown to agent ──────▶ Waiting for consent ─┬─ allowed ▶ Scan dialog
                 │                                                               └─ denied  ▶ unauthorized-origin
                 ├─ answers, version < required ───────────▶ Update ─▶ Updating ─┬─ ok ▶ Scan dialog
                 │                                                               └─ fail ▶ Update failed
                 ├─ token rejected ────────────────────────▶ token-revoked
                 └─ no answer ─────────────────────────────▶ Install (unreachable-or-blocked)
                                                               re-probe every 2 s while open, cap 5 min
Safari (macOS): S2 approved by SP-1 ▶ Open Zilo window ▶ (blocked | closed | unavailable)
                no approved path    ▶ Safari not yet supported
```

- **Nothing shows if detection succeeds quickly.** The Connect dialog opens only after 400 ms of checking; on success it
  goes straight to the Scan dialog. This avoids a flash on every scan.
- The dialog is modal, 32rem wide (36rem for the permission help), with a 3rem state icon, a heading, a lede and actions.
  The heading is the accessible name; the lede is the description.
- **Wording rule:** never "not installed", "missing" or "absent". The SDK cannot tell an absent agent from a blocked one
  (D-008). The check script fails if any copy says "not installed".

## 2. States

| State | Prototype `state` | Content | Actions |
|---|---|---|---|
| Checking | `checking` | Spinner, "Connecting to Zilo…" | Cancel |
| Browser prompt open | `permission-prompt` | Shield icon, "Choose Allow in your browser". Shown when the permission is `prompt` and a probe is in flight, because Chrome and Firefox show their own prompt at that moment. | Cancel |
| Permission denied | `denied` | Browser tabs (Chrome, Edge, Firefox), detected browser selected. Address-bar schematic with the icon to select, numbered steps with the setting name highlighted, and a collapsed "On a work computer?" admin hint. | **Try again** (re-query + re-probe), Close |
| Unreachable or blocked | `unreachable` | "Connect Zilo to scan". **Download for {OS}** (primary), **Start Zilo** (`zilo://start`), the browser-open hint, a live "Waiting for Zilo" status, an "Other systems" picker, and a "Zilo is running but this still shows?" troubleshooting disclosure. | Download, Start Zilo, Close (×) |
| Re-check stopped | `unreachable-stopped` | Same dialog after the 5-minute cap, with a static "Not checking" status. | **Check again**, Start Zilo |
| Waiting for consent | `awaiting-consent` | "Approve this site in Zilo", the exact origin in a chip, a live "Waiting for your answer in Zilo…" and where to find the window. | Cancel |
| Site not allowed | `unauthorized-origin` | The user chose Deny in the tray prompt. Explains how to allow. During the D-004 cool-down the primary is disabled: "Ask again in 9 min". | **Ask again**, Close |
| Access removed | `token-revoked` | The token was revoked or expired. States plainly that earlier pages are gone (jobs are owned by the token). | **Connect again**, Close |
| Outdated | `outdated` | "Update Zilo to continue", with installed, needed and latest versions. | **Update Zilo** (agent self-update, if `hello` advertises it), Download update |
| Updating | `updating` | Determinate progress while downloading ("18 of 29 MB"), then indeterminate "Installing…". Closing does not stop the update. On success, focus moves to the Scan dialog and "Zilo updated to 1.4.2" is announced. | Close |
| Update failed | `update-failed` | Says nothing was changed and which version remains (D-008: verify, atomic replace, recover). | **Try again**, Download update |
| Safari: open window | `safari-bridge` | Explains the small Zilo window before opening it. The button click is the user gesture for `window.open`. | **Open Zilo window**, Cancel |
| Safari: popup blocked | `safari-bridge-blocked` | `window.open` returned null. Points to Safari Settings, Websites, Pop-up Windows. | **Open Zilo window** |
| Safari: window closed | `safari-bridge-closed` | The popup closed or navigated away. Pages already scanned are kept. | **Reopen Zilo window** |
| Safari: page can't use window | `safari-bridge-unavailable` | The opener link is cut (COOP) or the page is framed. User copy plus a developer note. We never weaken COOP silently (D-003). | **Copy page link**, Close |
| Safari not yet supported | `safari-unsupported` | Explicit state when neither S1 nor S2 is proven on this machine (D-003). Suggests Chrome, Edge or Firefox and offers to copy the page link. | **Copy page link**, Close |
| Bridge window | `bridge-window` | The popup page itself, served from `127.0.0.1`: wordmark, "Zilo is connected to" plus the **verified** opener origin, "Keep this window open", the current activity and Disconnect. | Disconnect |

## 3. Install dialog details

- **OS and architecture:** use `navigator.userAgentData.getHighEntropyValues(['platform','architecture','bitness'])`
  where available (Chromium). Otherwise use the UA string. Firefox and Safari cannot report Windows ARM64 reliably, so they
  default to x64, and the picker lists ARM64. macOS ships one universal `.pkg`, so it needs no arch choice.
- **Linux:** the package type cannot be detected, so two equal buttons are shown: ".deb (Debian, Ubuntu)" (primary)
  and ".rpm (Fedora, RHEL)". AppImage is added only if D-008 packaging ships it.
- **Download data** comes from the signed `latest.json` (D-008): version, size and URL per OS/arch. The picker shows OS,
  arch, version, size and file type. Downloads are plain links to the artifact URL; the SDK never runs anything.
- **Start Zilo** is a link to `zilo://start`. It does nothing visible if Zilo isn't registered, and browsers may ask
  "Open Zilo?". The hint "Your browser may ask to open it. Choose Open." sits under the buttons. We never claim the
  launch worked; the re-check notices.
- **Live re-check (D-008):** re-probes `hello` every 2 s **only while the dialog is open**, with a 5-minute cap. It
  stops on dismissal, navigation or success. The status line is static text inside `role="status"`; only outcomes
  are announced ("Zilo is running", or the stopped state), never each attempt. On success the dialog moves straight on
  to the Scan dialog (or to consent or update).
- **Troubleshooting disclosure:** covers the `unknown` permission case and security software. Its button opens the
  permission-help view, with the detected browser's tab selected.

## 4. Permission help, per browser

| Browser | Steps (copy in [copy.md](copy.md)) | Setting name | Verify in SP-1a |
|---|---|---|---|
| Chrome | Site controls icon left of the address → **Apps on device** → Allow → reload | "Apps on device" (`loopback-network`) | Exact icon and label path |
| Edge | Lock icon → Permissions for this site → **Apps on device** → Allow → reload | Assumed to match Chromium | Label may differ |
| Firefox | Permissions icon → clear Blocked next to **Device apps and services** → reload | "Device apps and services" | Exact path |
| Other | Not shown. Unknown browsers fall back to the generic Install troubleshooting. | — | — |

- **Admin hint**, always present and collapsed: Chrome/Edge policy `LocalNetworkAccessAllowedForUrls`, Firefox policy
  `LocalNetworkAccess`. T01 (SP-1a) owns verifying these labels and policy names. Until it confirms them, the copy is
  marked "verify" in the notes column.
- Browser-specific steps are text plus a neutral address-bar schematic. No browser logos or screenshots (trademarks,
  and they go stale).

## 5. Safari

- **S2 (popup bridge), if SP-1 approves it:**
  - The dialog explains the window first.
  - The SDK opens `http://127.0.0.1:<port>/bridge` on the button's click, as a small window (420 × 320).
  - The bridge page shows only the opener origin it **verified** through the D-003 handshake, never one the caller
    claims.
  - The Scan dialog then works normally in the app. The popup shows status and a Disconnect button.
  - If the popup closes mid-session, the app shows `safari-bridge-closed`. Pages already received stay in memory.
- **S1 (local trust), if SP-1 picks it instead:** it needs an extra "Trust Zilo for Safari" flow in the tray app
  (explicit user approval, never silent; D-003). It is **not designed here**, because S1 is not approved. It would be a
  follow-up task.
- **Neither proven:** `safari-unsupported`. This is never a silent failure and never the Install dialog (that would send
  Safari users into an install loop).

## 6. Focus and announcements

- Initial focus goes to the primary action. For waiting states (checking, consent, updating) it goes to Cancel or Close.
- State changes inside the open dialog move focus to the new heading (`tabindex="-1"`) when the actions change, so
  screen-reader users hear the new state. A status-only change (for example the download progress) does not move focus.
- Announcement politeness per state is the `Announce` column in [copy.md](copy.md).
