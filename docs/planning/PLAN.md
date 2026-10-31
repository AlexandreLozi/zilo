# Zilo plan

**Status:** v2, signed off by both masters on 2026-10-31. Built on Proposed decisions D-001 to D-009, so it changes if
they do. Nothing here is in force until both masters sign off at the bottom.

## 1. Scope

**v1 (must):** replace the Dynamsoft service and JS SDK for the owner's flow on Windows, macOS and
Linux. That means:
- detect the agent, and offer start, download, update and permission help;
- list local and network scanners plus the Zilo Virtual Scanner;
- scan with DPI, colour mode, paper size, flatbed, ADF, duplex and multi-page;
- return images or a PDF to the web app;
- support Chrome, Edge and Firefox on all three OSes, and Safari on macOS (path set by SP-1).

**v1 (should):** an optional `@zilo/dwt-compat` facade covering the owner's actual Dynamsoft calls,
once we have their code.

**Out of v1:** OCR, PDF import, image editing beyond rotate, reorder and delete, mobile browsers, a
machine-wide Windows service (unless the owner requires it), and WSD on macOS.

## 2. Architecture

```
Web app (HTTPS) ── @zilo/ui (Scan / Install / Permission / Update dialogs)
                     └─ @zilo/sdk ── transport: HTTP fetch + SSE to 127.0.0.1  (Chromium, Firefox)
                                     └─ Safari path: S1 local-CA HTTPS | S2 popup bridge   (SP-1)
                                              │
Zilo Agent (per-user, .NET) ── HTTP API /zilo/v1 (Host + Origin checks, per-origin token)
   ├─ Zilo.Core  (IScanBackend, jobs, page store, export: PDF/TIFF/JPEG/PNG)
   ├─ Zilo.Drivers.Naps2  → WIA, TWAIN (x86 worker), ICA, SANE (+sane-airscan), eSCL
   ├─ Zilo.Drivers.Virtual → deterministic pages + failure injection
   ├─ Tray/menu-bar shell: consent prompts, token revocation, status, quit, logs
   └─ Updater: signed manifest, anti-downgrade
```

## 3. Components and owners

| Component | Owner master | Notes |
|---|---|---|
| `api/openapi.yaml` contract | joint | GPT for the server, Opus for the SDK; contract tests on both sides |
| `backend/Zilo.Core`, `Zilo.Agent`, `Zilo.Security` | GPT | D-001, D-004, D-005 |
| `backend/Zilo.Drivers.Naps2` + platform workers | GPT | D-001, D-002 |
| `backend/Zilo.Drivers.Virtual` + virtual eSCL device | GPT | D-007 |
| Tray/menu-bar shells, autostart, `zilo://` | GPT | design of consent prompt copy and visuals: Opus |
| Installers, signing, notarization, updater | GPT | D-008 |
| `packages/sdk` | Opus | discovery, permission state, transports, jobs, export |
| `packages/ui` | Opus | Web Components + React wrapper, themable, a11y (WCAG 2.2 AA) |
| `packages/dwt-compat` | Opus | after owner code (D-006) |
| `apps/demo` | Opus | demo + Playwright E2E target |
| Download page / `latest.json` consumer | Opus (UI) + GPT (manifest) | |
| CI workflows | joint | GPT for backend and packaging jobs, Opus for web and E2E jobs |

## 4. API contract
D-005 fixes the shape. The **full contract is an M1 deliverable** in `api/openapi.yaml` plus
`api/CONTRACT.md`, and covers:
- token issuance, expiry, revocation and session scoping;
- job ownership by origin and token, and the job state machine (`queued → scanning → completed |
  failed | cancelled`, then `disposed`);
- cancellation versus disposal;
- page numbering (0-based, stable, with duplex front/back marked);
- the event schema, with a monotonic `seq`, `Last-Event-ID` reconnect and replay of buffered events;
- retention and export-retry semantics (D-004);
- concurrency limits, capability validation and reporting of effective settings;
- error codes.

**Compatibility rule:**
- The wire protocol is versioned. Breaking changes need a new protocol version (`/zilo/v2`).
- Backward-compatible optional additions are allowed under negotiated `capabilities` from `hello`,
  with both masters' review.
- The SDK must ignore unknown fields and unknown event types; debug logging records only safe
  schema/type metadata, never unknown payloads that could contain documents or credentials.

## 5. Gates and milestones

There are three kinds of gate. A **pending** gate never blocks independent lanes and never counts as
a pass.
- **Feasibility gates** (early, cheap) unblock decisions.
- **Implementation exit criteria** close each milestone.
- **Release-readiness gates** need real evidence, often owner-operated: real Safari, hardware,
  signing credentials, legal review.

**M0a — Feasibility wave** (parallel, no dependency on later milestones).
- SP-2a: restore the pinned NAPS2.Sdk 1.6.0 on net10 for each RID, inventory packages and native
  payloads, add the licence gate to CI, and run a minimal device-list against an independent eSCL /
  SANE fixture (not the M2 virtual implementation). An empty physical device list is not a failure.
- SP-1a: a transport stub — a 30-line loopback HTTP server and an HTTPS test page — exercised in
  Chromium, Firefox and Playwright WebKit for fetch, fetch-stream SSE, the permission states and the
  S2 bridge handshake prototype, plus S1 trust-scope experiments where an OS is available.
- SP-4a: build an unsigned packaging dry run per OS in CI.

Exit: D-001, D-002, D-004 and D-008 in force; D-003 default candidate in force. Real-Safari and
signing results may stay pending.

**M1 — Contract + skeletons.**
- The full contract (section 4).
- An agent skeleton with the virtual driver, Host/Origin checks, consent and tokens.
- The SDK skeleton, the demo app, and CI on all three OSes.

Exit: on Linux CI the demo lists "Zilo Virtual Scanner" over the real HTTP transport. Contract tests
pass from both sides.

**M2 — Virtual end-to-end.**
- Jobs, events with reconnect, pages, export with retry, cancel and dispose, and failure injection.
- Scan dialog v1.
- Playwright on Chromium, Firefox and WebKit.

Exit:
- **SP-3** passes in CI on Linux and Windows: 3 pages, duplex, exported to PDF.
- The security suite passes:
  - a hostile origin is denied;
  - a bad Host is denied;
  - replayed pairing challenges and expired or revoked tokens are denied (ordinary bearer tokens
    remain reusable while valid; they are not single-use credentials);
  - cross-origin job access is denied;
  - there are no state-changing GETs;
  - the S2 hostile-opener, forged-origin, wrong-nonce and stale-session cases are rejected if S2 is in
    scope.

**M3 — Real drivers.**
- WIA, TWAIN (x86 worker), ICA, SANE and eSCL through NAPS2.
- Capability mapping and reporting of effective settings.

Exit: per-driver contract tests pass against fakes or the virtual eSCL device, and the owner hardware
checklist is drafted.

**M4 — Install and lifecycle UX.**
- Installers per OS, autostart, `zilo://`, the signed `latest.json` and the updater.
- The Install, Permission and Update dialogs.

Exit:
- Clean install, upgrade and uninstall pass on fresh VMs for each OS.
- The SDK reports the following states:
  - positively identified: compatible, outdated, updating;
  - permission `denied` where the query API exists;
  - otherwise `unreachable-or-blocked`. The SDK never claims "not installed".
- Probing happens only during an active user interaction.

**M5 — Compat + hardening.**
- `dwt-compat`, if the owner's code has arrived.
- Consent UI polish, diagnostics, resource bounds.
- Threat-model review and the legal licence review.

**M6 — Release readiness (evidence gates, owner-assisted).** Each item stays pending until evidenced:
- real Safari 26 on macOS, run by the owner from a checklist or on a proven safaridriver lane (Playwright
  WebKit never substitutes);
- the hardware matrix;
- signing and notarization with owner credentials (SP-4b);
- legal sign-off.

## 6. Cross-cutting acceptance
- **Cross-model review applies to everything:** research, plans and code. The Phase 1 exchange counts as
  a record: Opus reviewed GPT's research, and GPT reviewed Opus's research, decisions and plan.
- **Evidence before support claims:** no claim of Safari, hardware, signing or notarization support
  without real evidence logged in VALIDATION.md.
- **Accessible, complete UI:**
  - dialogs are keyboard-operable, with a focus trap and screen-reader labels;
  - light and dark themes;
  - copy for every error code and every detection state.

## 7. Risks
| Risk | Mitigation |
|---|---|
| Safari blocks loopback HTTP | SP-1a stub early; S1/S2 candidates; explicit unsupported state if neither proven |
| Users deny the browser permission | detect `denied` and show per-browser help; enterprise policy docs |
| TWAIN driver crashes | x86 worker process isolation, restart, job-level error |
| NAPS2 licence graph changes | pinned versions + CI licence gate |
| macOS notarization/.NET hardened runtime | SP-4a dry run early; SP-4b with owner credentials |
| Owner code shows heavy DWT coupling | compat facade scoped from real calls; migration guide |

## Sign-off
- Opus: approved (2026-10-31), including GPT's three clarifications (independent M0a fixture,
  bearer-replay semantics, redacted debug logs).
- GPT: approved (2026-10-31), with the clarified M0a fixture independence, bearer-replay test and
  debug-log redaction above; D-003 approval covers the candidate/safety rules only, not passed spikes.
