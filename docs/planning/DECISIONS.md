# Decisions

A decision is in force only when it has **both** `Approved-by: Opus` and `Approved-by: GPT`.
Status values: **Proposed** (drafted, under debate), **In force** (both approvals), **Superseded**.
Approve by editing your line to `Approved-by: <you> (YYYY-MM-DD)`. Debate goes in `DISCUSSION.md`,
not here. Drafted by [Opus] on 2026-10-31 from `research-opus.md` and `research-gpt.md`.

---

## D-001 Shared .NET core on NAPS2.Sdk behind a Zilo-owned interface
- **Status:** In force
- **Decision:** One cross-platform local agent on **.NET 10 LTS** (the published NAPS2.Sdk 1.6.0 nupkg
  ships a real `net10.0` asset, GPT-verified). No .NET 8 production fallback: .NET 8 reaches end of
  support in November 2026. .NET 8 is allowed only as a throwaway investigation target. Pin an **exact**
  NAPS2.Sdk version (1.6.0) and an exact .NET SDK (`global.json`), and enforce restore with lock files
  (`packages.lock.json`, `RestoreLockedMode` in CI). Drivers: WIA and TWAIN on Windows (x86
  `NAPS2.Sdk.Worker.Win32` for 32-bit TWAIN sources), ImageCaptureCore on macOS, SANE on Linux, eSCL
  on all three. NAPS2 types never cross the Zilo backend interface (`IScanBackend`: devices, caps, jobs,
  pages, cancel, errors), so a driver can later be replaced by a native shim. Native code only in thin
  per-OS shells: tray/menu-bar agent UI, autostart, URL handler, installers.
- **Gated by SP-2, not assumed:** the platform imaging backends (Gdi, Mac, Gtk); how ICA is consumed
  (the 1.6.0 package has no separately named macOS asset, which does not prove ICA is unsupported); and
  the TWAIN worker on Windows x64 and arm64.
- **Rationale:** NAPS2 already solves 32/64-bit TWAIN bridging, WIA 2.0, ICA, SANE and eSCL. A Rust or Go
  core would re-implement all of it with no measured benefit (both masters' research).
- **Alternatives:** native per OS (3x the code and API surface); a Rust/Go core with FFI (re-implements
  the TWAIN/WIA/ICA bindings); a hybrid with native shims only where NAPS2 fails (kept open through the
  interface).
- **WSD:** not a NAPS2 backend. Claimed only per verified route: Windows via WIA, Linux via
  `sane-airscan`, each needing a device test. Not promised on macOS.
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-002 Licensing guardrails
- **Status:** In force
- **Decision:**
  - Ship the NAPS2 LGPL assemblies as separate, replaceable DLLs: no single-file merge, no IL-merge, no
    trimming of LGPL assemblies.
  - Include licence texts, a NOTICE inventory and a source offer for the exact NAPS2 version.
  - Never copy code from the GPL NAPS2 application. No exception can clear that.
  - Pin `SixLabors.Fonts` to an Apache-2.0 version (1.0.1 today) as a resolved, lock-file-enforced
    version, not a bare nuspec range. Do not use `NAPS2.Images.ImageSharp`.
  - **Licence gate in CI: default-deny.** Every resolved package and native payload must carry a licence
    on an allowlist (MIT, Apache-2.0, BSD, LGPL-2.1+ as dynamically loaded assemblies, etc.). Unknown,
    restricted, GPL/AGPL or Six Labors Split-licensed items fail the build unless they have a reviewed,
    **version-specific exception** recorded in `docs/legal/exceptions.md` with its redistribution
    obligations. Example: SANE components under GPL-with-linking-exception, or not redistributed at all
    because we use the system `libsane`.
  - Clean-room: no Dynamsoft code, binaries, reverse-engineered protocol, assets or trademarked UI.
- **Rationale:** verified 1.6.0 metadata (both masters). The Split License requires a commercial licence
  above $1M revenue.
- **Alternatives:** a commercial Six Labors licence, kept open if the pinned permissive version proves
  incompatible or insecure in rendering/export tests; the ImageSharp backend everywhere (licence risk).
- **Gates:** full restore plus per-RID native payload inventory (SP-2); rendering/export tests on the
  pinned Fonts version; legal review of the final installer inventory before first external release.
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-003 Browser transport and TLS
- **Status:** In force for the default candidate, mandatory safety properties and common ground
  only. Production transport compatibility and either Safari S1/S2 selection remain gated on SP-1.
- **Decision (default candidate, reversible):**
  - **Transport:** HTTP on `127.0.0.1`, using the IP literal. Fixed port plus 2 fallbacks.
  - **Browsers:** primary for Chromium and Firefox on every OS. Calls use
    `fetch(..., {targetAddressSpace:'loopback'})`.
  - **Events:** server-sent events read through fetch streaming. No WebSocket.
  - **HTTPS:** a listener is kept only as a tested fallback.
- **Safari is required by the brief.** It cannot be dropped without an owner scope change. SP-1
  evaluates two candidates; **neither is approved yet**:
  - **S2 — popup bridge.** A top-level window at `http://127.0.0.1:<port>/bridge` relays for the app.
    Mandatory properties:
    - The bridge is a separate authorization boundary. The agent never blanket-trusts loopback or
      no-Origin requests, and never accepts a caller-claimed `appOrigin` as proof.
    - A dedicated bridge capability is minted server-side only after a verified handshake bound to the
      app origin, its pairing (D-004) and a fresh session.
    - App and popup both check the exact `event.source`, origin (bridge origin includes the port),
      nonce and message schema. They re-handshake on reload or reconnect, and stale sessions are
      rejected.
    - Only typed operations are relayed (list devices, start job, events, get page, export, cancel), never
      arbitrary URLs, headers or paths.
    - Binary transfer is bounded: Blobs/ArrayBuffers with request and session IDs and backpressure. The
      app creates its own object URLs. No public page URLs and no credentials in URLs.
    - The bridge page uses an exact `targetOrigin`, local-only scripts, restrictive CSP, no framing
      (`frame-ancestors 'none'`) and `no-store` on sensitive responses. No document or credential
      logging.
    - Failures are explicit and detectable: COOP, iframe, popup blocker, navigation or closure. We never
      require the owner to weaken cross-origin isolation silently.
  - **S1 — explicit, user-approved per-install local trust.**
    - Root name constraints are **not assumed** to be honoured. The effective trust scope must be proven
      per supported trust store, or S1 is rejected.
    - Exact-leaf trust (a single self-signed leaf for `127.0.0.1`) is to be investigated as an
      alternative.
    - It must pass negative tests for unrelated hostnames, plus rotation and uninstall tests.
    - No shared key or root, ever.
  - **If neither is proven:** the SDK has an explicit "Safari not yet supported on this machine" state
    with guidance, never a silent failure.
- **In force on approval (common ground):** the public app must be HTTPS; no shared private key or
  shared root, ever; **no silent CA installation** as a product rule on every OS; probing only during
  an active user interaction (or when the permission is already `granted`).
- **Deadlock rule:** if still unresolved after two rounds, take the option that is easier to reverse.
  HTTP-primary leaves no trust-store state on users' machines.
- Approved-by: Opus (2026-10-31, for the default candidate and common ground; S1/S2 pending SP-1)
- Approved-by: GPT (2026-10-31, for the default candidate, mandatory safety properties and common ground; S1/S2 pending SP-1)

## D-004 Pairing, auth and origin policy
- **Status:** In force
- **Decision:**
  - **Network surface:**
    - The listener is bound to loopback only.
    - Reject requests whose `Host` is not `127.0.0.1:<port>`, `[::1]:<port>` or `localhost:<port>`
      (DNS rebinding).
    - Exact `Origin` allowlist, with CORS reflecting only allowed origins. No state-changing GETs.
  - **Who may connect:**
    - Origins come from installer-baked config for the deploying company, or from a native consent
      prompt in the agent the first time an unknown origin calls.
    - Consent prompts are rate-limited per origin, and a denial is remembered for a cool-down.
    - **Installer allowlisting only skips the consent prompt. It does not skip request
      authentication:** baked origins still receive and present tokens.
  - **Credentials:**
    - The agent issues scoped, random, per-origin bearer tokens with an expiry and revocation from the
      tray UI. They travel in the `Authorization` header, never in URLs.
    - **Jobs and pages are owned by the issuing origin and token.** Cross-origin job or page access is
      rejected.
    - The S2 bridge is never an unprivileged endpoint that can mint public-origin tokens (D-003).
  - **Retention:**
    - Pages are kept after export, so callers can retry, do partial exports and export more than once.
    - Pages are deleted on explicit `DELETE` (dispose), on cancel when the caller asks, or at a bounded
      TTL. Delete-on-export is an opt-in request flag.
    - Temp files are user-private (0700 directory or per-user ACL).
    - Resources are bounded: pages, pixels, bytes, duration and concurrency.
  - **Threat model:** hostile websites are in scope. Local malware running as the user is out of scope.
- **Browser-side asymmetric pairing:** not adopted. It adds no demonstrated value in this threat model
  (agreed by both masters, 2026-10-31). Signing stays for update manifests (D-008).
- **Consent binds the public app origin.** Under S2, consent, tokens and job ownership belong to the
  verified opener origin, never to the bridge's `http://127.0.0.1` origin.
- **Alternatives:** origin check only (no revocation); a pairing code the user types (more friction).
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-005 API contract: Zilo-native REST + events, versioned
- **Status:** In force
- **Decision:** `/zilo/v1/` REST: `hello` (product, version, protocol, os, arch, capabilities),
  `devices`, `devices/{id}/caps`, `jobs` (POST creates a scan job), `jobs/{id}/events` (SSE: progress,
  page, error, done), `jobs/{id}/pages/{n}` (image bytes, optional `maxWidth` thumbnails),
  `jobs/{id}/export` (POST: pdf, tiff, jpeg, png), `DELETE jobs/{id}`. Errors are RFC 9457 problem+json
  with stable codes. Responses report the *effective* settings a device applied. The contract lives as
  OpenAPI in `api/openapi.yaml`, is co-owned (GPT server, Opus SDK), and is contract-tested from both
  sides. The TS SDK (`@zilo/sdk`) returns `Blob`/`File`; the app uploads.
- **Alternatives:** eSCL as the browser API (too low-level, no auth); WebSocket RPC (see D-003).
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-006 Dynamsoft compatibility adapter
- **Status:** In force
- **Decision:** Build the clean Zilo SDK first. `@zilo/dwt-compat` (a `Dynamsoft.DWT`-shaped facade
  over `@zilo/sdk`) is scoped only from the owner's actual call inventory and written from public docs
  only, with contract tests against the owner's usage. Until the code arrives, no adapter work beyond
  a stub package.
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-007 Virtual test scanner
- **Status:** In force
- **Decision:** (1) a `virtual` driver inside the agent on every OS, listed as "Zilo Virtual Scanner",
  generating deterministic original pages (page number, settings, seeded pattern, colour target, QR code
  carrying job/page metadata for assertions) with flatbed/ADF/duplex, N pages and failure injection
  (feeder-empty, paper-jam, cover-open, timeout, disconnect, slow) via device variants; the test-only
  control endpoint is compiled out of release builds; (2) the same generator behind `NAPS2.Escl.Server`
  as a virtual eSCL device for CI, exercising the real eSCL path; (3) on Windows CI only, the TWAIN WG
  sample data source as a non-redistributed fixture for the x86 TWAIN path (licence to verify). Tests
  compare normalized image/PDF content, not raw bytes.
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-008 Agent lifecycle, detection, download and update flow
- **Status:** In force
- **Decision:**
  - **Agent:** per-user, with tray/menu-bar UI. It starts at login: Windows Run key or scheduled task,
    macOS `SMAppService` login item, Linux `systemd --user`. `zilo://start` is registered per OS as a
    convenience only, never a security boundary, and carries no secrets.
  - **Detection (SDK), on an active user interaction only:**
    1. Query the `loopback-network` permission inside try/catch. The query API is not available in every
       browser; there the state is `unknown`.
    2. If the state is `denied`, show a per-browser help panel for allowing access.
    3. Probe `hello`. A positive answer identifies the agent; compare its version with the SDK.
    4. If the agent is older than the SDK requires, show the Update dialog.
    5. If nothing answers, the state is **`unreachable-or-blocked`** (never "absent"). Show the Install
       dialog: "Start Zilo" plus a download for the detected OS/arch, with a manual picker. Explain that a
       blocked permission or security software can also cause this.
    6. Re-probe `hello` every 2 s **only while that dialog is open**. Stop on dismissal, navigation or
       success, with an overall cap.
  - **Update availability is separate from detecting an old agent.** It comes only from a **signed**
    `latest.json` manifest that carries version, OS, arch, artifact URL, size, SHA-256 and signature. The
    agent and the SDK verify the signature and enforce anti-downgrade. Nothing downloads or runs an
    unverified artifact. Self-update verifies hash and signature, replaces atomically and recovers on
    failure.
- **Packaging (candidates, validated by gates rather than claimed):** Windows signed MSI or MSIX for
  x64 and arm64, with the x86 TWAIN worker; macOS universal, signed and notarized `.pkg`; Linux `.deb`
  and `.rpm` depending on SANE and `sane-airscan`, with AppImage optional. Signing and notarization
  depend on owner-operated credentials and stay pending until evidenced.
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

## D-009 Repository layout, languages, CI
- **Status:** In force
- **Decision:** Monorepo. `backend/` (.NET solution: `Zilo.Agent`, `Zilo.Core` interface, `Zilo.Drivers.Naps2`,
  `Zilo.Drivers.Virtual`, `Zilo.Security`, tests), `api/openapi.yaml`, `packages/` (pnpm workspace:
  `sdk`, `ui` as Web Components + React wrapper, `dwt-compat`), `apps/demo` (Vite + TS, also the E2E
  target), `packaging/{windows,macos,linux}`, `tests/{e2e,security}`, `docs/`. TypeScript strict,
  Vitest, Playwright (Chromium, Firefox, WebKit) against the virtual scanner. GitHub Actions matrix on
  `windows-latest`, `macos-latest` (arm64) + an x64 mac runner, `ubuntu-latest`: build, unit, contract,
  licence gate, E2E (Linux and Windows at minimum), packaging dry runs. Automation never counts as
  real-Safari, hardware, signing or notarization evidence.
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31)

---

## D-010 Interim dev-integration evidence without a hosted remote
- **Status:** In force (2026-10-31), dev-only.
- **Decision:** until the owner provides or approves a hosted repo with CI:
  - **Merge-queue evidence:** a cross-model review verdict of `pass`, plus local CI-equivalent runs of
    the owning workflow's steps on the **rebased SHA**:
    - Linux, natively in WSL;
    - Windows, natively on the WSL host through interop, in a Windows-side checkout of the SHA.
  - macOS runs and hosted CI stay **pending**, and are never counted as a pass.
  - Redacted logs are committed under `docs/validation/logs/<task>/<os>.log`. VALIDATION.md records
    each merge as `local-linux / local-windows / macos: pending / hosted: pending`.
  - Workflow files are still authored and checked locally (actionlint or a parse check), so they run
    unchanged once a remote exists. CI then re-runs on `main` and the rows are backfilled; a hosted
    failure on a merged SHA creates a fix task.
- **Scope:** development integration on the local `main` only. It is not release evidence, and it is
  not a waiver of any M6 gate.
- **Rationale:** there is no git remote. Creating a hosted repo publishes company code, so it is an
  owner question (DISCUSSION.md).
- **Alternatives:** create a private GitHub repo unilaterally (rejected: outward-facing); block all
  merges until a remote exists (stalls independent lanes).
- Approved-by: Opus (2026-10-31)
- Approved-by: GPT (2026-10-31, dev-only local Linux + native Windows CI-equivalent on the rebased SHA,
  redacted logs, macOS and hosted CI pending; recorded by Opus from GPT's terminal message and
  DISCUSSION entry)

## Spikes and gates (see PLAN.md section 5)
- **Feasibility (M0a, parallel):**
  - SP-1a (Opus): transport stub in Chromium, Firefox and Playwright WebKit, plus the S2 handshake
    prototype and S1 trust-scope experiments.
  - SP-2a (GPT): pinned NAPS2 1.6.0 net10 restore, per-RID inventory, licence gate, minimal
    device-list.
  - SP-4a (GPT): unsigned packaging dry runs.
- **Implementation:**
  - SP-3 (joint): virtual end-to-end, 3 pages duplex to PDF. This is the M2 exit criterion.
- **Release readiness** (pending ≠ pass; never blocks independent lanes):
  - SP-1b: real Safari 26 (owner checklist or a proven safaridriver lane).
  - SP-4b: signing and notarization with owner credentials.
  - Hardware matrix.
  - Legal review.
