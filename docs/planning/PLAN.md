# Zilo plan

**Status:** v3 rev 3.1 approved by both masters (2026-11-01; OD-8/OD-9 amendment). v2 was signed off by both masters. Built on decisions D-001 to D-009, so it changes if
they do. Nothing here is in force until both masters sign off at the bottom.

## 1. Scope

**Product goal (OD-9):** an open-source alternative to Dynamic Web TWAIN for anyone, with the
owner's app as the first integrator.

**v1 (must):** replace the Dynamsoft service and JS SDK on Windows, macOS and Linux, on x64 and
arm64:
- **Detection:** detect the agent, and offer start, download, update and permission help.
- **Devices:**
  - list local and network scanners plus the Zilo Virtual Scanner;
  - **wide compatibility** (OD-9): TWAIN x86/x64, WIA, ICA, SANE, eSCL/AirScan, and WSD where a
    verified route exists.
- **Scanning:** DPI, colour mode, paper size, flatbed, ADF, duplex and multi-page.
- **Output:** return images or a PDF to the web app.
- **Browsers:**
  - Chrome, Edge and Firefox on all three OSes;
  - **Safari on macOS is required and release-blocking (OD-8).** The T25 path (S1 or S2) is
    selected under D-003 from evidence only: SP-1a recommends S2, and real-Safari evidence (SP-1b)
    is still pending. This amendment does not select it.
  - The "Safari unsupported" state is an interim test state only.
- **Front end (OD-8):**
  - framework-agnostic TS SDK core and Web Components UI;
  - **React (TSX) as the first-class wrapper and reference integration**;
  - a **React + TS (Vite)** demo.
- **Installs:** per-user and admin (machine-wide) installs (OD-9).
- **`@zilo/dwt-compat`:** a clean-room facade over the **commonly used public DWT API** (OD-9),
  prioritized by the owner's answers in OWNER-QUESTIONS.md.
  - **Owner integration facts (2026-11-01, `docs/context/dwt-integration-inventory.md`):**
    - **P0 is the owner's exact call surface.** That includes DWT's built-in viewer plus
      `Viewer.createThumbnailViewer`, with drag reorder, keyboard control and themeable colours.
      P1 is the wider common public API.
    - The owner's app calls `Load`/`Unload` on every dialog open, so detection plus `Load` must be
      fast and idempotent across repeated cycles, with no leak.
    - **Host-modal requirement:** Zilo dialogs and the viewer must work inside a host app's modal
      (Radix and similar) without hacks. That covers nested focus traps, `pointer-events`, portals
      and z-index. It applies to T15, T22 and T45, and each one gets a Radix host-modal test
      fixture.
    - The owner's app sends no COOP or COEP headers, so the S2 pop-up bridge needs no header change
      on the owner's side.
    - Scanning runs top-level, not in an iframe, so Local Network Access delegation doesn't apply.
    - The owner's CSP already allows loopback. The integration guide documents the explicit
      `http://127.0.0.1:<port>` needed if the CSP is tightened.
    - The app's installers come from Dynamsoft's demo CDN today. Zilo hosts its own (T46).
- **Budgets:** the performance budgets and reliability requirements in §8, enforced by tests.

**Later:** thin Angular and Vue wrappers.

**Out of v1:** OCR, PDF import, image editing beyond rotate, reorder and delete, mobile browsers, and
WSD on macOS.

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
| `packages/dwt-compat` | Opus | public-docs clean-room API after T21 (OD-9 overrides D-006's owner-code-only start); owner answers re-rank it |
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
- `dwt-compat` over the common public DWT API (clean-room), prioritized by the owner's answers.
- The §8 soak and recovery suites run green on hosted CI.
- Consent UI polish, diagnostics, resource bounds.
- Threat-model review, and a legal review of third-party licences (the NAPS2 graph and T53
  NOTICE).

**M6 — Release readiness (evidence gates, owner-assisted).** Each item stays pending until evidenced:
- real Safari 26 on macOS, run by the owner from a checklist or on a proven safaridriver lane (Playwright
  WebKit never substitutes);
- the hardware matrix;
- tester builds are unsigned or test-key signed (owner Q20); testers follow one-time
  instructions (a Windows VM, or a dedicated test PC whose owner has chosen Smart App Control off
  or evaluation mode; on macOS, "Open Anyway"). Production signing (SP-4b, D-011) moves to M7;
- a **weekday owner checklist** (T34a, drafted early): SP-1b real Safari plus the first hardware
  rows, run by the owner's Mac tester and on the owner's Intel x64 PCs with USB and Wi-Fi scanners
  (Q19);
- arm64: builds in CI, plus runtime evidence wherever a hosted arm64 runner or the Mac tester's
  machine provides it. **Windows on ARM real-device rows stay gated (pending)**: no device
  available (Q19);
- §8 budgets met on hosted runners, and on real hardware where the budget applies;
- legal sign-off on third-party licences.

**M7 — Open-source release (owner Q17/Q18, 2026-11-01).** M7 starts only after the owner has
approved a functional app. Zilo is the owner's personal project, and he holds the copyright.
- The masters present a short comparison of MIT, Apache-2.0 and MPL/LGPL, and the owner chooses.
- Until M7: there is no LICENSE file for Zilo and the repo stays private (OD-7). Third-party
  notices (T53) are still kept.
- **Repo hygiene first (T57, OD-13):** organize folders and files; archive or remove stale
  artifacts, using a manifest approved by both masters; a README and docs index; a check that no
  sensitive file is tracked. It comes after the functional app and before the clean public export.
- The open-source hygiene moved here from M5 (T54):
  - the licence file the owner chose;
  - CONTRIBUTING, SECURITY.md, DCO or CLA;
  - a scripted clean public export that excludes agent and planning paths;
  - the export reviewed by both masters and approved by the owner before anything goes public.
- **Signing (SP-4b, D-011 rev 2):**
  - Windows: apply to the **SignPath Foundation** free OSS program once the repo is public under an
    OSI licence and a first release exists. That release ships as a tester pre-release.
  - Fallbacks: re-check Azure Artifact Signing eligibility for Brazil, or buy a commercial OV
    certificate (owner decision).
  - macOS: Developer ID plus notarization through the Apple Developer Program (US$99/year, the
    one unavoidable cost; owner purchase).
  - Linux: GPG-signed packages.
  - The first build for clinic users is a signed one; D-011 applies to it.
- **Real-app test pass (Q21):** after the app works end to end, the owner runs Zilo in his app
  through `@zilo/dwt-compat`.

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
| Safari blocks loopback HTTP | SP-1a stub early; S1/S2 candidates, both prototyped. If neither is proven, the release is blocked (OD-8): "Safari unsupported" is an interim test state, never a shipped outcome |
| Users deny the browser permission | detect `denied` and show per-browser help; enterprise policy docs |
| TWAIN driver crashes | x86 worker process isolation, restart, job-level error |
| NAPS2 licence graph changes | pinned versions + CI licence gate |
| macOS notarization/.NET hardened runtime | SP-4a dry run early; SP-4b at M7 (Apple Developer Program, owner purchase) |
| Owner code shows heavy DWT coupling | compat facade scoped from real calls; migration guide |
| Safari S2 bridge fails on real Safari | S1 explicit local trust as fallback (D-003 rules); Safari is release-blocking (OD-8), so both are prototyped early |
| Open-source release leaks agent/planning material or private history | scripted clean export with a path denylist, reviewed by both masters (OD-9) |

## 8. Performance budgets and reliability (OD-9)

**Status.** These numbers are **proposed enforceable targets**. They are not measured support
claims. T56a calibrates them on hosted runners, and both masters re-sign any changed number before it
gates a merge.

**Reference environment.** GitHub-hosted runners (ubuntu-latest, windows-latest, macos-latest)
with the virtual scanner, unless a row says otherwise. Hardware numbers come from the owner's
checklist.

**Measurement rules (T56a implements them):**
- **Samples:** 2 warm-up observations are discarded, then **20 observations** are kept. Latency
  budgets gate on **p95 by nearest rank**, which is the 19th of 20 sorted values, so a single outlier
  cannot fail the build. A cold-start observation is a fresh process each time.
- **Virtual pacing:** the budget runs use an unpaced virtual ADF, so generation is as fast as
  possible and the agent pipeline is what is measured. A paced mode (fixed ppm) exists for UI and
  soak tests only.
- **Real-device throughput reference:** the same device, settings (dpi, colour, duplex, paper) and
  connection path, scanned with NAPS2 standalone or the vendor's own app. The device's rated ppm is
  informational only and is never the baseline.
- **Agent memory:** two separate measures.
  - *Peak per page:* the peak RSS during the job, minus the idle baseline taken just before it,
    divided by the number of pages in flight. Sampled at 10 Hz.
  - *After dispose:* run a forced full GC, wait 5 s, then sample at 1 Hz for 5 s. The managed heap
    (`GC.GetTotalMemory(true)`) must be back within baseline + 5 MB. RSS is allowed allocator
    retention, so it gates only on the soak growth rule below.
- **Browser memory:** Chromium only, through CDP `HeapProfiler.collectGarbage` followed by
  `Runtime.getHeapUsage`. The limit is B0 + 1.5 × (encoded bytes of retained page blobs) + decoded
  bitmaps (w × h × 4 for each rendered thumbnail or preview). B0 is the post-GC heap with the UI
  mounted and zero pages, so the limit holds at zero blobs.

| Budget | Target | Enforced by |
|---|---|---|
| Agent cold start (process start → `hello` 200) | p95 ≤ 1.5 s Linux/macOS, ≤ 2.5 s Windows | T11 perf test |
| SDK detection, agent running, permission granted | p95 ≤ 300 ms | T13/T23 |
| SDK `unreachable-or-blocked` verdict (no agent; user prompt time excluded) | ≤ 2 s | T13/T23 |
| Time to first page (`POST /jobs` → first `page` event), virtual, A4 300 dpi colour | p95 ≤ 1.0 s | T20 |
| ADF throughput, virtual, A4 300 dpi colour, thumbnails on | ≥ 60 pages/min | T20/T23 |
| ADF throughput, real device | ≥ 90% of the reference-path throughput (see the rules) | hardware checklist (T34) |
| Agent memory, peak per in-flight page (A4 300 dpi colour) | ≤ 40 MB; after dispose, managed heap ≤ baseline + 5 MB | T20 |
| Browser JS heap in the SDK/UI (post-GC) | ≤ B0 + 1.5× encoded blob bytes + decoded bitmaps (see the rules) | T21/T22 |
| Export of a 50-page PDF, A4 300 dpi | colour ≤ 10 s, B/W ≤ 3 s | T20 |

**Reliability (acceptance criteria in T20, T23, T24 and T30–T33):**
- **Soak:** 500 pages through the virtual ADF (paced mode), in 10 jobs. Zero temp files remain
  after dispose. Post-GC RSS, sampled after each job, grows by less than 10% between job 5 and
  job 10. That rule tolerates one-time allocator retention but catches a leak. No handle or thread
  growth.
- **Agent crash or kill mid-job:**
  - Pages and jobs are **ephemeral**. They die with the process, and v1 adds **no durable document
    or job storage**.
  - **Lost-session contract (an input to T10 r2 and the T20 contract tests):** `hello` carries an
    `instanceId` that is new for each process start. When the SDK reconnects and sees a different
    `instanceId`, it marks every job it holds from the old instance as `agent-restarted`, which is
    retryable. A job ID the new process doesn't know returns a typed not-found. So no job is ever
    silently lost, and the new process never claims anything about old-process jobs.
  - **Detection:** the SDK surfaces `agent-unavailable` within 2 s, but only during an active
    operation (an open event stream or an in-flight request). An idle SDK finds out on its next
    call.
  - **Relaunch within 5 s needs a supervisor. Login autostart alone does not relaunch.** The
    installer tasks own it: T42 uses the `systemd --user` unit with `Restart=on-failure`; T41 uses
    launchd `KeepAlive` with `SuccessfulExit=false`; T40 uses a scheduled task with
    restart-on-failure, or the T44 tray shell as the watchdog. T24 owns the kill-and-relaunch test.
- **x86 TWAIN worker crash or kill:** the job fails with a retryable error, and the next job
  succeeds without an agent restart.
- **Sleep and resume:** the event stream reconnects with `Last-Event-ID` and loses no events. This is
  simulated with network suspension in CI and checked on hardware with a real sleep.
- **Unplug, paper jam and feeder empty:** typed errors. Pages acquired before the failure stay
  retrievable.
- **No leaked temp files on any path:** cancel, error, revoke, TTL.

## Sign-off
- v2: signed by Opus and GPT (2026-10-31).
- **v3 rev 3.1 (OD-8/OD-9 amendment: scope, M5, M6, §8 budgets, risks):** Opus approved (2026-11-01); GPT approved (2026-11-01). Numeric budgets remain proposed until measured/calibrated and jointly re-signed; protocol changes still require the T10 contract gate.
