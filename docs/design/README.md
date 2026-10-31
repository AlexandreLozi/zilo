# Zilo UX and visual design (T05)

Design spec for every user-facing Zilo surface. Prototypes are static HTML/CSS/JS under
[`design/prototypes/`](../../design/prototypes/). Open `design/prototypes/index.html` straight from disk; there is no
build and nothing is fetched from the network. Each prototype has a control bar for state, theme (light, dark, system)
and platform. The state is kept in the URL (`?state=…&theme=dark`), so any state can be linked.

| Surface | Spec | Prototype |
|---|---|---|
| Scan dialog | [scan-dialog.md](scan-dialog.md) | `scan-dialog.html` |
| Detection dialogs (checking, permission, install, consent wait, update, Safari) | [detection-dialogs.md](detection-dialogs.md) | `detection.html` |
| Tray / menu-bar agent (consent, allowed sites, menu; Windows, macOS, Linux notes) | [tray-agent.md](tray-agent.md) | `tray.html` |
| Design tokens (light, dark, host theming) | [tokens.md](tokens.md) | `tokens.html`, `assets/tokens.css` |
| Copy table (every detection state and error code) | [copy.md](copy.md) | `assets/copy.js` (source) |
| Accessibility (WCAG 2.2 AA) | [accessibility.md](accessibility.md) | all, checked by `check/run.sh` |

## Principles

1. **Never strand the user.** Every state names the next step. No silent failures, and no "not installed" claim the SDK
   cannot know (D-008).
2. **Tell blocked from absent.** A browser permission denial gets help for that browser, never the Install dialog
   (research §1, D-008).
3. **Exact origins, everywhere.** Consent, the web dialogs and the bridge window show the full origin, never a page-supplied
   name (D-004, D-003).
4. **Offer only what the device can do.** Settings come from caps, and the effective settings are reported (D-005).
5. **Keep the user's pages.** Errors, cancel and export failures keep scanned pages. Losing pages always needs explicit
   confirmation, and when it is unavoidable we say so (D-004).
6. **Fit the host.** Neutral branding, host-themable tokens, system fonts, light and dark themes. No Dynamsoft look
   (D-002).

## Checks (observable acceptance)

```sh
design/prototypes/check/run.sh            # installs playwright + axe-core into check/.deps once
node design/prototypes/check/copy-table.cjs --write   # after editing assets/copy.js
```

The script verifies:
- each surface has a prototype and a spec;
- the copy covers every required state and code, `copy.md` is in sync, and nothing says "not installed";
- axe finds 0 violations across all prototype states in light and dark;
- token contrast pairs meet AA.

It is not wired into any workflow (T05 constraint).

## Hand-offs and open items

| For | Item |
|---|---|
| T10 (contract) | Confirm the 12 error codes and set `t10` in `copy.js`. Add `rotate` per page plus page order to the export request. Add a consent-pending signal so the SDK can show "Approve this site in Zilo". Add a cool-down remaining time on `unauthorized-origin`. Add a self-update capability flag in `hello`. |
| T01 (SP-1a) | Verify the Chrome, Edge and Firefox permission UI labels and paths, and the policy names (marked "verify" in copy.md). Pick S1 or S2. S1 would need an extra tray flow, not designed here. |
| T15 | Port `tokens.css` and the component patterns. Use `<dialog>` + `showModal()` in shadow DOM. Implement the focus trap, return focus and live-region helpers. |
| T22 | Scan dialog per scan-dialog.md, with the roving-tabindex page grid and batched announcements. |
| T44 (BE) | Native consent per tray-agent.md §1: spoof resistance, 1 s input delay, no default button, platform button order. Allowed sites with Managed/Reset. Menu and icon states. |
| Owner | The default primary label "Add N pages" and whether the virtual scanner is visible in production. Both are host options. |
