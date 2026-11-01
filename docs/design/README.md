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
| T10 (contract) | Done in fix r1: the 12 codes are `confirmed`, the six added codes have copy, and the consent, update and refresh flows follow the draft. Still open: `rotate` per page plus page order in the export request; approval of D-004a and T10 (the flows marked "Provisional" follow them). |
| T13/T21 (SDK) | Consent request and polling, pre-auth versus authorised Update, `token-invalid` silent recovery and the R-A13 revocation probe, per detection-dialogs.md §1. Silent single retry for `rate-limited` (≤ 2 s) and `agent-unavailable` before showing copy. |
| T01 (SP-1a) | Verify the Chrome, Edge and Firefox permission UI labels and paths, and the policy names (marked "verify" in copy.md). Pick S1 or S2. S1 would need an extra tray flow, not designed here. |
| T15 | Port `tokens.css` and the component patterns. Use `<dialog>` + `showModal()` in shadow DOM. Implement the focus trap, return focus and live-region helpers. |
| T22 | Scan dialog per scan-dialog.md, with the roving-tabindex page grid and batched announcements. |
| T44 (BE) | Native consent per tray-agent.md §1: spoof resistance, 1 s input delay, no default button, platform button order. Allowed sites with Managed/Reset, Recently denied (Forget, Block) and Blocked sites (Unblock). Never prompt for a non-https or loopback origin. Menu and icon states. |
| Owner | The default primary label "Add N pages" and whether the virtual scanner is visible in production. Both are host options. |

## Fix r1

Round-1 review: `docs/reviews/T05-r1.md` on `t05-review-r1` (5 findings, all P2). Inputs: the T10 hand-off
(`api/CONTRACT.md` on `t10-contract`, "For T05"), the masters' revocation position ("access revoked", never "erased"),
D-004a (public `hello` has no version), and OD-8 (Safari required). Items under D-004a or the T10 draft are marked
**Provisional** in the spec and copy notes; they are not claimed to be in force.

| # | Finding | Change | Where | Evidence |
|---|---|---|---|---|
| 1 | T10 copy hand-off incomplete | 12 original codes set to `t10: "confirmed"` (plus the consent-pending and effective-settings signals). New entries, `t10: "added"`: `consent-denied` (cool-down), `consent-denied.blocked` (permanent), `rate-limited`, `invalid-settings`, `unsupported-capability`, `not-found` (non-disclosing: never why or whose), `agent-unavailable`. `copy.md` regenerated; the added codes have their own table. `token-revoked` now says access was **revoked**, never erased; `token-invalid` is silent. Tray gains Recently denied → **Block** and a **Blocked sites** list with **Unblock**; the web side has a distinct blocked state with no countdown. | `assets/copy.js`, `docs/design/copy.md`, `tray-agent.md` §1–2, `tray.html` (`sites`, `block-confirm`), `detection.html` (`consent-denied`, `consent-blocked`, `rate-limited`), `scan-dialog.html` banners | check §2: "12 codes confirmed, 7 added-code entries, revocation and Safari wording" |
| 2 | Update/consent flow vs public `hello` | Flow rewritten: public `hello` → explicit user-initiated `POST /auth/consent` → `202 pending` → poll `GET /auth/consent` only while open → granted/denied/blocked/none/unknown, each with a state (`consent-expired` added). Update split: pre-auth `state.outdated` names no installed version (decided from `protocol`/capabilities); `state.outdated.authorized` shows versions. Self-update stays reserved, so Download is primary; `update-failed` no longer needs `{version}`. Marked provisional. | `detection-dialogs.md` §1–2, `copy.js`, `detection.html` (`outdated`, `outdated-authorized`, `consent-expired`) | check §3: detection.html 29 states × 2 themes, 0 violations |
| 3 | HTTP dev consent advertises an unusable Allow | Removed `tray.consent.insecure` and the `consent-insecure` tray view. Tray spec states that only HTTPS origins are ever prompted and loopback is never allowed, dev flag or not. New web state `state.insecure-origin` (no probe, no prompt) with developer guidance to use an HTTPS test host (`https://app.zilo.test:8443`). | `tray-agent.md` §1 item 5, `tray.html`, `copy.js`, `detection.html` (`insecure-origin`) | check §3: tray.html 36 states × 2 themes, 0 violations |
| 4 | Refresh via state-changing GET | Refresh sends `POST devices/refresh`, then reads `GET devices` (R-D1); loading/disabled design kept and prototyped as state `refreshing`. | `scan-dialog.md` §2, `scan-dialog.html` | `grep refresh=1` finds nothing |
| 5 | axe matrix skips most error banners | `scan-dialog.html` has an explicit `matrix()` with `state=error&code=…` for all 15 banner codes (10 original scan-time + 5 added). `check.cjs` fails if any banner code is missing from the matrix. `accessibility.md` states what "every state" covers. | `scan-dialog.html`, `check/check.cjs`, `accessibility.md`, `scan-dialog.md` §9 | check §3: "renders all 15 scan-banner error codes"; scan-dialog.html 28 states × 2 themes, 0 violations |

Also, per OD-8: `state.safari-unsupported` is now an interim test state ("Use another browser for now"), and the check
fails if any copy calls Safari unsupported.

Check run (headless Chromium, Playwright 1.64.1, axe-core 4.14.0): 69 copy keys; 190 page states (95 states × 2 themes), **0 axe
violations**; token contrast 16 pairs per theme pass AA (lowest light 3.39:1, dark 4.44:1, minima are 3:1 non-text pairs).
