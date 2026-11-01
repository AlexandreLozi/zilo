# Zilo execution strategy

**Status:** DRAFT v2 by [Opus], 2026-10-31. Phase 2. Reconciled with GPT's EXECUTION v1 review, all
seven points. Implements PLAN.md v2. Both masters sign off at the bottom.

## 1. Orca mechanics

- **Two Runs, one inbox each.** Orca `check` consumes a Run's FIFO inbox, so two masters sharing one
  Run would steal each other's deliveries.
  - The Opus master runs **`zilo-fe`**: front end, design, SDK, demo, E2E, plus overall tracking and
    the merge queue.
  - The GPT master runs **`zilo-be`**: agent, drivers, virtual scanner, packaging, security.
  - Run IDs are recorded in `docs/planning/AGENTS.md`.
- **Overall tracking:** the Opus master reads both Runs (`worker-list --run <id>`) and owns the merge
  queue (§2.4).
  - Each lane edits only its own status table (§4a FE, §4b BE). That keeps edits append-safe.
  - Results go to VALIDATION.md as evidenced, failed or pending.
- **Worktrees:** one isolated Orca worktree per dispatch, on branch `t<NN>-<slug>`. It is created
  from the **latest committed `main` after the task's dependencies have merged**.
- **Claude workers:**
  `worker-start --task <id> --worktree new-top-level --name t<NN>-<slug> --agent claude --model claude-opus-5-5 --effort high`.
  Effort is chosen per task under OD-3, which supersedes the earlier blanket high/xhigh rule; ★ tasks default to `high`.
- **GPT workers:** `--agent opencode` in a new worktree, without `--model`. Orca refuses an OpenCode
  model override when creating a new worktree, and the committed `opencode.json` pins
  `openai/gpt-6.1-sol`, reasoning `high`. The dispatching master still checks `launch.effective` in
  every receipt. If the effective model is wrong, the dispatch is stopped and relaunched in an
  existing worktree with an explicit `--model`.
- **Every dispatch spec carries:**
  - Target, Change, Constraints, Ownership and Observable acceptance (the Orca contract);
  - the in-force decision IDs it implements, with links to the relevant PLAN and CONTRACT sections;
  - an **allowed file set** (globs). Writes outside it are a review failure.
- **Escalation:** workers `ask` their own master. The master answers alone if the question falls
  within an in-force decision; otherwise it goes to DISCUSSION.md and both masters decide.

## 2. Author, review, fix and merge cycle

1. **Author** works on the task branch and commits often. It runs the observable acceptance and sends
   `worker_done` with the outcome. The lane master validates the report.
2. **Settlement decision**, made immediately and before the ack. The lane master either:
   - **retains** the author terminal (`worker-retain`) with the next owner recorded as "fix dispatch
     for T<NN> after review", or
   - **releases** it (`worker-release`); a later fix gets a fresh author dispatch.

   A settled worker is never left without a retain, release or reuse decision.
3. **Review:** the lane master dispatches a **reviewer of the other model family** in its own Run, on
   the same branch, as a new Task.
   - The reviewer's allowed files are its review report (`docs/reviews/T<NN>-r<k>.md`) plus **new
     failing test files only**. It commits those and sends `worker_done` before any author fix
     starts, so there are never simultaneous writes.
   - Pairing: Claude-authored work gets a GPT (opencode) reviewer; GPT-authored work gets a Claude
     reviewer. No exceptions, including docs.
   - The review spec is bounded: the diff, the stated acceptance, the in-force decisions it must
     honour, a checklist (correctness, security, tests, scope), and a verdict of `pass` or `changes`
     with numbered findings.
4. **Fix:** a **new Dispatch** (new Task: "T<NN> fix r<k>") goes to the retained author terminal
   (`worker-start --task <fix> --terminal <handle>`) or to a fresh author. Settled task and dispatch IDs
   are never reused. The review → fix cycle repeats until the verdict is `pass`. After 3 rounds, both
   masters are escalated.
5. **Merge queue (serialized):** the Opus master owns the critical section on `main`. One merge at a
   time, in queue order.
   - Either lane enqueues a branch by sending its master's message to the Opus master. The message
     carries the branch, head SHA, review report path with verdict `pass`, and CI run link.
   - The Opus master rebases onto `main` and verifies the **resulting tree**: CI is green on the
     rebased SHA. Until a hosted remote exists, D-010 applies: local Linux plus native-Windows
     CI-equivalent runs, with macOS and hosted CI pending. If the rebase needed conflict resolution that changed code, the changed hunks go
     back for re-review by the same reviewer family.
   - The Opus master then fast-forwards `main` and records the merge in VALIDATION.md (task, author
     model, reviewer model, review report, CI link).
   - **Merge slot:** the Opus master may grant the GPT master a bounded merge slot (one named branch,
     announced by terminal message, released by message after the push). The same verification rules
     apply.
6. **Shared files:**
   - Shared test files (for example the scaffold guard tests in `backend/tests/**`) have exactly one
     owning task at a time, handed over in DAG order: T04b, then T11 (empty-type guard), then T06
     (no-NAPS2 guard). T12 adds its own test files and does not edit those.
   - `api/openapi.yaml` and `api/CONTRACT.md` change only through tasks that name them. Those tasks
     need both masters' approval in the review record.
   - Each CI workflow file has exactly one owning task: `ci-web.yml` (T04a), `ci-backend.yml` (T04b),
     `spike-naps2.yml` (T02), `spike-transport.yml` (T01), `packaging-dryrun.yml` (T03).
   - Production `global.json`, `Directory.Packages.props` and the NuGet lock files belong to T04b, and
     afterwards to BE lane tasks only. `pnpm-lock.yaml` belongs to T04a, and afterwards to FE lane tasks
     only.
7. **Planning docs** are committed to `main` by the editing master in small commits. The Phase 1 docs
   are already on `main` (b5526f4).

## 3. Task DAG

**Legend:**
- **Lane:** FE = Opus master, BE = GPT master.
- **Author / reviewer:** C = Claude worker, G = GPT worker. The reviewer is always the other family.
- **Deps** means *merged on `main`*.
- ★ marks high-risk tasks: effort `high` by default (OD-3; `xhigh` only with a written reason); GPT reviewers get a security-focused checklist.
- **Files** lists the allowed write set.

### Wave 0 — five tasks start at once; T03 follows T04b
| ID | Task | Lane | A | R | Deps | Files | Observable acceptance |
|---|---|---|---|---|---|---|---|
| T01 | r1 changes (4 medium, 3 failing tests @b6c3aec); fix r1 running ctx_f5308be39c1d (claude medium); reviewer ctx_06fe211b88a3 retained for r2 | t01-transport-spike | | ctx_06fe211b88a3 | changes | |
| T02 | **SP-2a** NAPS2 spike, isolated: own `spikes/naps2/` project, own `global.json` and locks there, NAPS2.Sdk 1.6.0 on net10 with locked restore per RID, package and native payload inventory, default-deny licence gate tool, device-list against an independent eSCL/SANE fixture (not T12; an empty physical list is not a failure) | BE | G | C | — | `spikes/naps2/**`, `tools/license-gate/**`, `.github/workflows/spike-naps2.yml`, `docs/spikes/SP-2a.md` | Inventory per RID in `SP-2a.md`; gate fails on a seeded disallowed package in CI and passes on the real graph |
| T04a | Web scaffold: pnpm workspace `packages/{sdk,ui,dwt-compat}`, `apps/demo` (Vite + TS), TS strict, Vitest, Playwright config, lint and format | FE | C | G | — | `package.json`, `pnpm-*.yaml`, `packages/**`, `apps/**`, `tsconfig*`, lint configs, `.github/workflows/ci-web.yml` | `pnpm -r build test lint` green in `ci-web` |
| T04b | merged 9e43bf7 (by Opus queue, during GPT outage; see VALIDATION.md) | BE | G | C | — | `backend/**`, `global.json`, `Directory.*.props`, `.github/workflows/ci-backend.yml` | `dotnet test` green in `ci-backend` on Windows, macOS and Linux runners, in locked mode |
| T05 | UX and visual design spec: Scan dialog; Install, Permission-help (per browser), Update and Safari-state dialogs; tray consent prompt and revocation UI; tokens; copy per error code and detection state; a11y spec | FE | C | G | — | `docs/design/**`, `design/prototypes/**` (static HTML, no build integration) | Spec with annotated static prototypes; copy table covering every D-008 state and every contract error code (finalized after T10) |
| T04b-V (Claude, OD-2) | done, evidence merged with T04b (released) | t04b-v-claude on q/t04b@7284a3b | task_aece2a6c9536 / ctx_1c7e1d2ebf1e (claude medium) | n/a (evidence) | | |
| T10 ★ (Claude author, OD-2) | r1 changes (13 findings, report @1a1db73); fix r1 running ctx_b7e7205f9487 (claude high) | t10-contract | task_97bc56f01fe2 | GPT r1 (released) | changes | |
| T03 (Claude author, gap) | authored @c00f066 (retained); Linux pass, Win/mac pending | t03-packaging-dryrun | task_ff5edf368285 / ctx_87244e823ed3 (claude medium) | queued for GPT | | |
| T12-proto (Claude author, gap) | authored @0afb9c4, 146/146 Linux (retained) | t12-proto-pages | task_8756662f2e58 / ctx_3535b9f466da (claude medium) | queued for GPT | | |
| T03 | **SP-4a** unsigned packaging dry runs (MSI or MSIX, `.pkg`, `.deb`/`.rpm`) of the T04b hello agent; signing smoke with **test keys only** | BE | G | C | T04b | `packaging/**`, `.github/workflows/packaging-dryrun.yml`, `docs/spikes/SP-4a.md` | Artifacts built on 3 OS runners; install/uninstall smoke on Linux and Windows runners; test-key signature verifies |
| T06 | Reconcile T02's verified NAPS2 graph into production packages and locks; retires T04b's no-NAPS2 scaffold guard. **Blocked** until the joint ICA/worker/image-backend strategy is in force | BE | G | C | T02, T04b, joint strategy | `Directory.Packages.props`, locks, `backend/src/Zilo.Drivers.Naps2/*.csproj`, `.github/workflows/ci-backend.yml` (ownership transferred from merged T04b) | `ci-backend` locked restore green; licence gate wired into `ci-backend` |

### Wave 1 — M1 contract + skeletons
| ID | Task | Lane | A | R | Deps | Observable acceptance |
|---|---|---|---|---|---|---|
| T10 ★ | Full contract `api/openapi.yaml` + `api/CONTRACT.md` (PLAN §4). Uses T01 findings only as a **reviewed handoff note** (`docs/spikes/SP-1a-interim.md`, reviewed by G), never an unmerged branch | BE | G | C | T04b, T01-interim note | Both masters approve in the review record; schema lint passes; TS types generated in a scratch dir compile |
| T11a | Separately reviewed neutral Core/device/caps/acquisition interface slice; retires obsolete empty-type guards, preserves no-NAPS2 | BE | G | C | T10, T04b | Pure Core/boundary tests and exact downstream interface handoff; no HTTP/auth/packages |
| T11 ★ | Agent skeleton: `hello`, `devices`, `caps`; Host/Origin checks; headless consent hook; tokens; resource bounds, hosted contract check and bounded packaging self-test seam | BE | G | C | T10, T04b, T11a | Contract/security HTTP tests; consume frozen Core; ci-contract and packaging smoke cannot hang |
| T12 | Virtual driver (D-007 layer 1) against T10 and merged T11a Core/IScanBackend; can run parallel to remaining T11 | BE | G | C | T10, T04b, T11a | Golden decoded pixels/QR and failure tests; frozen Core, no concurrent Agent wiring edits |
| T13 | SDK core: D-008 detection state machine, permission query, HTTP transport, typed errors, devices/caps, unknown-field tolerance with redacted debug logs | FE | C | G | T04a, T10 | Unit tests against an OpenAPI-generated mock server |
| T14 | Demo app device list, integrated with the real agent | FE | C | G | T13, T11, T12 | Linux CI job starts the agent and the demo lists "Zilo Virtual Scanner" over real HTTP (M1 exit) |
| T15 | UI foundation: Web Components base, tokens, dialog primitive (focus trap, ARIA), themes, React wrapper | FE | C | G | T04a, T05 | Component catalog page; axe checks pass in Playwright; **host-modal fixture**: the dialog works inside a Radix Dialog with no host hacks (nested focus trap and return, pointer-events, portal and z-index, Escape and outside-click ownership). Added in T15 fix r1 (PLAN §1, owner inventory) |

### Wave 2 — M2 virtual end-to-end
| ID | Task | Lane | A | R | Deps | Observable acceptance |
|---|---|---|---|---|---|---|
| T20 ★ | Agent jobs: state machine, SSE with `seq`/replay, pages, export (PDF, TIFF, JPEG, PNG) with retry, cancel, dispose, TTL, user-private temp | BE | G | C | T11, T12 | Contract tests for every job endpoint and transition; export golden tests; temp-permission tests on Linux and Windows |
| T21 | SDK jobs/events/pages/export. **Two gates:** (a) unit tests on the mock; (b) a real-agent integration test, enabled only once T20 has merged | FE | C | G | T13 (a), T20 (b) | (a) mock suite green; (b) integration suite green in `ci-web` against the agent |
| T22 | Scan dialog v1 (device list with driver badges, settings bound to caps, live thumbnails, rotate/reorder/delete, export) | FE | C | G | T15, T21a, T05 | Component tests + axe; thumbnail strip with drag reorder and keyboard control, current-page selection and themeable colours (the owner's P0 viewer); a Radix host-modal fixture |
| T24 ★ | Security suite: hostile origin, bad Host, replayed pairing challenges, expired and revoked tokens (valid bearer reuse allowed), cross-origin job access, GET safety, resource bounds | BE | G | C | T20 | Suite in `ci-backend`; each case shown failing against a deliberately weakened build, then passing |
| T25-BE ★ | Safari path, agent side, per the SP-1a result. **S2:** bridge capability minting bound to the verified app-origin handshake and pairing, plus session lifecycle and bridge page serving with CSP and no framing. **S1:** trust tooling, rotation, uninstall. **Neither:** an explicit capability flag | BE | G | C | T01, T20 | Hostile-opener, forged-origin, wrong-nonce and stale-session tests (S2); unrelated-hostname, rotation and uninstall tests (S1) |
| T25-FE ★ | Safari path, SDK and UI side: S2 relay (typed ops, bounded binary, exact `targetOrigin`, COOP, popup-blocker and closure handling) or the explicit Safari-unsupported state | FE | C | G | T21a, T25-BE | Playwright WebKit tests of handshake failures and the unsupported state |
| T23 | **SP-3** E2E: Chromium and Firefox scan 3 pages duplex to PDF, with order asserted from the QR codes. WebKit runs **the production path chosen in T25**: S2 success if implemented, otherwise the explicit unsupported state as a **negative test**, never counted as a WebKit or Safari pass. Test page on a non-loopback HTTPS origin | FE | C | G | T20, T21b, T22, T14, T25-FE | Green in CI on Linux and Windows (M2 exit for Chromium and Firefox); WebKit result recorded honestly in VALIDATION.md |

### Wave 3 — M3 real drivers (BE), parallel with Wave 4 FE work
| ID | Task | A | R | Deps | Observable acceptance |
|---|---|---|---|---|---|
| T30 | NAPS2 WIA + TWAIN with the x86 worker, caps mapping, effective settings | G | C | T20, T06 | Windows runner: driver unit tests with NAPS2 fakes; x86 worker starts, recovers from a killed worker, and cancels; the TWAIN WG sample source fixture (if its licence clears) completes one scan; hardware rows pending |
| T31 | NAPS2 ICA driver | G | C | T20, T06 | macOS runner: builds and enumerates without crashing (empty list OK); caps-mapping unit tests; hardware rows pending |
| T32 | NAPS2 SANE (+sane-airscan) and eSCL drivers | G | C | T20, T06 | Linux runner: SANE `test` backend scan of 2 pages through Zilo; eSCL against the T33 device |
| T33 | Virtual eSCL device (D-007 layer 2) | G | C | T12, T06 | Independent eSCL client validates the fixture's capabilities and 3-page duplex sequence; combined Zilo-driver/PDF-order integration is gated on both T32 and T33 code, never a circular prerequisite to merge either fixture or driver |
| T34 | Owner hardware checklist + real-Safari script (FE lane). **Split (Q19):** T34a drafts the weekday checklist early (SP-1b Safari on the S2 prototype from T01, plus the first USB/Wi-Fi rows on the owner's Intel x64 PCs and the Mac tester); T34b completes it after T23 | C | G | T34a: T01, T05; T34b: T23 | Checklist covers each driver route, the WSD routes, Safari, and install/update flows, with pass/fail fields |

### Wave 4 — M4 install and lifecycle
| ID | Task | Lane | A | R | Deps | Observable acceptance |
|---|---|---|---|---|---|---|
| T40 | Windows installer, autostart, `zilo://` | BE | G | C | T03, T30 | Windows runner: install, start at logon (scheduled-task check), `zilo://start` registration, upgrade over the previous build, clean uninstall (no files, keys or tokens left) |
| T41 | macOS `.pkg`, login item, URL scheme, hardened runtime | BE | G | C | T03, T31 | macOS runner: install, `SMAppService` status, URL scheme registered, uninstall script clean; test-key signature verifies; notarization pending (M6) |
| T42 | Linux `.deb`/`.rpm`, `systemd --user`, XDG handler | BE | G | C | T03, T32 | Container installs on Ubuntu LTS and Fedora: dependencies resolve, the user unit starts, `xdg-mime` query, purge is clean |
| T43 ★ | Signed `latest.json` + updater | BE | G | C | T11 | Tests: tampered manifest rejected, hash mismatch rejected, downgrade rejected, interrupted update rolls back, success path updates atomically (test keys) |
| T44 | Tray/menu-bar shells: consent prompt, revocation, status, logs (to the T05 design) | BE | G | C | T11, T05 | Per-OS UI automation or a scripted harness shows prompt → allow/deny → token issued/denied, and revocation invalidates tokens |
| T45 | Install, Permission-help, Update and Safari-state dialogs; bounded polling; `zilo://start` | FE | C | G | T22, T43, T25-FE | Playwright: each D-008 state renders the right dialog; polling stops on dismiss and navigation; a11y passes; the Install and Permission dialogs work inside a Radix host modal with no hacks (owner inventory: DWT's install dialog breaks theirs) |
| T46 | Download page consuming `latest.json`; Zilo self-hosts the installers (the owner's app uses Dynamsoft's demo CDN today) | FE | C | G | T43 | Picks OS/arch correctly in the browser matrix; rejects a manifest with a bad signature (SDK verification) |

### Wave 5 — M5 compat + hardening
| ID | Task | Lane | A | R | Deps | Observable acceptance |
|---|---|---|---|---|---|---|
| T50 | `@zilo/dwt-compat`. P0 = the owner's call inventory (`docs/context/dwt-integration-inventory.md`, incl. built-in viewer + `createThumbnailViewer`); P1 = the common public API. Owner unblocked 2026-11-01 | FE | C | G | T21b, T22 (viewer) | Contract tests replaying each owner call sequence; 20 consecutive `Load`/`Unload` cycles are idempotent with no leak and stay within the §8 detection budget |
| T51 | Diagnostics endpoint + support bundle | BE | G | C | T20 | Test asserts no page data, tokens or file paths outside the allowlist appear in the bundle |
| T52-C ★ | Threat-model review, Claude-authored, independent | joint | C | — | T24, T25-*, T43 | `docs/reviews/T52-claude.md` |
| T52-G ★ | Threat-model review, GPT-authored, independent (does not read T52-C before finishing) | joint | G | — | T24, T25-*, T43 | `docs/reviews/T52-gpt.md` |
| T52-R | Reconciliation gate: both masters merge the findings into fix tasks; each fix is reviewed by the other family as usual | joint | masters | — | T52-C, T52-G | `docs/reviews/T52-reconciled.md` signed by both masters |
| T53 | Licence/NOTICE inventory for the final installers; legal review package | BE | G | C | T40–T42 | Gate green on every installer; NOTICE complete; package ready for counsel |

### M6 release readiness (owner-assisted; pending ≠ pass)
SP-1b real Safari 26, the hardware matrix (weekday owner checklist T34a/T34b), legal sign-off
on third-party licences. Tester builds are unsigned or test-key signed (Q20). Windows on ARM rows
stay gated, with no device available (Q19). Tracked in VALIDATION.md.

### M7 open-source release (owner Q17/Q18; gated on an owner-approved functional app)
T54: the masters present an MIT / Apache-2.0 / MPL-LGPL comparison and the owner chooses. Then
CONTRIBUTING, SECURITY.md, DCO, and the clean public export, reviewed by both masters and approved
by the owner. Until M7 there is **no Zilo LICENSE file** anywhere in the repo, and the repo stays
private. Third-party licence texts under evidence/notice paths are fine.
SP-4b moves here (D-011 rev 2):
- SignPath Foundation free signing for Windows, after the repo is public and a first release
  exists. Fallbacks: Azure eligibility re-check, or an OV certificate.
- Apple Developer ID plus notarization (owner, US$99/year).
- GPG signing for Linux.
Also here: the owner's real-app test pass through dwt-compat (Q21).

## 3a. OD-8 / OD-9 amendments to the DAG (v3 rev 3.1; both masters approved 2026-11-01)
These amendments override the rows in §3 where they conflict.

**Front end:**
- **T14:** the demo is **React + TS (Vite)**. It consumes the Web Components through the React
  wrapper.
- **T15:** the **React (TSX) wrapper is first-class**, with typed props and events plus tests. An
  Angular/Vue wrapper is a later task (T55, not v1).
- **T23:**
  - WebKit must pass the production Safari path (S2, or better). The unsupported state may only be
    an interim negative test.
  - Add the §8 budget checks for detection, time to first page and throughput, plus the
    sleep/resume reconnect test.

**Safari path:**
- **T25-BE and T25-FE are release-blocking (OD-8).** Real-Safari evidence (SP-1b) is an M6 gate
  that can never be waived.

**Back end:**
- **T20:** add the §8 budgets (first page, throughput, memory, export), the 500-page soak, and
  zero leaked temp files on every path.
- **T24:** add the agent kill and recovery tests and the revoke-mid-stream test.
- **T30–T33:**
  - add x86-worker crash recovery (T30), unplug/jam/feeder-empty typed errors (all four), and
    retention of pages acquired before a failure;
  - arm64 builds for every OS.
- **T40–T42:** each OS gets both a **per-user** and an **admin/machine-wide** install mode (OD-9),
  with upgrade and uninstall tests for both.

**Compat:**
- **T50:** `dwt-compat` covers the **common public DWT API**, clean-room, prioritized by
  OWNER-QUESTIONS.md. It is no longer blocked on the owner's code: work starts after T21 with
  public-docs-only API names, and the owner's answers re-rank it.

**New tasks:**
- **T54 (FE lane, docs/tooling), open-source hygiene. It is in M7 and gated on an
  owner-approved functional app (Q17/Q18). No LICENSE file is added before then.**
  - an MIT / Apache-2.0 / MPL-LGPL comparison (masters present it, the owner decides);
  - CONTRIBUTING, SECURITY.md, DCO;
  - a scripted clean public export that excludes CLAUDE.md, `.claude/`, `opencode.json`,
    `.opencode/`, `docs/planning`, `docs/tasks` and `docs/reviews`, keeps the product docs, and
    starts the public repo from a fresh history.
  - Reviewed by GPT. Deps: T53.
- **T56 is split to break the dependency cycle:**
  - **T56a (joint, Wave 1, no deps), harness only:** dependency-free timing and memory helpers
    (a TS package for Vitest/Playwright and a .NET test helper, with no production references),
    the §8 measurement rules, a JSON result schema and a budget comparator. T11, T13, T20 and T23
    each own their own budget checks and use T56a. Until T56a merges, they record raw numbers
    without gating.
  - **T56b (joint), integration:** hosted-CI soak and recovery jobs, plus calibration of the §8
    numbers for both masters to re-sign. Deps: T20, T21, T56a. Keep macOS minutes low (OD-7).

## 4a. FE lane status (Opus edits; refreshed 2026-11-01 ~12:30 -03)
Dispatches lost in the restart are bookkeeping only and are never reused.
| ID | State | Branch | Author dispatch | Reviewer dispatch | Verdict | Merged SHA |
|---|---|---|---|---|---|---|
| T04a | **merged** (r2 Node pass, r3 format-scope pass; D-012 reuse of ci-web 41319600327; main backstop ci-web 41320055013) | — | fix r1 ctx_cd74bcad8bc0, fix r2 ctx_e53b3cb5f39b | r2 ctx_1d112881a0b7, r3 ctx_15fbb7f49d56 (GPT) | pass | 4639340 |
| T05 | **merged** (r2 pass; rebased checks: 190 states, 0 axe violations) | — | fix r1 ctx_11403c9933fe | r2 ctx_e5c59cb532bb (GPT) | pass | f22eb2e |
| T01 | fix r2 DONE @83df7dd; hosted spike-transport 41320440243 green. **MERGED 4a2a7dc** (GPT r3 PASS b26f06d; D-012 reuse of 41320440243; the main push reruns spike-transport) | t01-transport-spike | fix r2 ctx_18d2b7435bfb (settled) | r2 ctx_48f38cafb0c0 | r3 queued | |
| T10 ★ (Claude author) | **MERGED 79d6ec3** (r4 PASS e939912; both masters approved the exact f3ba120 contract; exact-SHA check.sh 60/60 + 3/3 on 79d6ec3). Follow-ups: joint triage of the 9 T13 ambiguities, then T10.1 if needed (incl. stale status markers); hosted ci-contract job | t10-contract | fix r2 ctx_0a8ee3069c14, fix r3 ctx_062ede7e79cc | GPT (BE run) | pending r4 | |
| T03 (Claude author) | **merged**; exact-SHA main runs green | — | fix r2 ctx_b6c1ba2bdb7e | GPT r3 (BE) | pass | f38e3ea |
| T12-proto (Claude author) | **merged**; Linux 183/183 rebased; cross-OS pending | — | — | GPT r2 (BE) | pass | 32051c6 |
| T15 | AUTHORED @5814593 (draft PR #2; ci-web 41326742758 green on exact head: catalog 174/174 + demo 3/3 on Chromium/Firefox/WebKit, unit ui 25 / react 6 / catalog 3 / demo 1, licence gate 161). Scope within spec + approved demo swap. Settled and released. GPT r1 **changes** (55f6300: P1 disabled-fieldset focus, P2 display:contents, P2 React prop order, P2 initial onOpen, plus the required host-modal fixture). **Fix r1 running** ctx_7f4d48090166 (Claude high, auto mode verified; spec docs/tasks/T15-fix-r1.md) | t15-ui-foundation | task spec docs/tasks/T15.md / ctx_23881374964a | GPT (after author) | | |
| T13 | AUTHORED @4aad2e6 (sdk 100 tests, workspace 113; lint/typecheck/test/build green on Node 24; api/** = f3ba120, lockfile = main; 9 contract ambiguities listed in docs/validation/logs/T13/run.md as T10 follow-up candidates). Settled and released. Merged main 0a15155 (T10) at **a6de031**: sdk 100/100, typecheck green. GPT r1 **changes** (d294335: 2 P1 renewal recovery / shared-family prune, 3 P2 double rollover / teardown / detection cap). Triage of the 9 agreed (items 3-7 go into the fix). Fix r1 **DONE @0a9b8e1** (sdk 128/128 incl. the 5 r1 proofs unchanged and a 20-cycle dispose test; new states auth-unavailable and sdk-too-old need T05 copy). GPT r2 **changes** (db8ef93: 1 P2, the overall deadline must bound consent polling and post-await work). **Fix r2 running** ctx_3c9eed1d0e89 (Claude medium, narrow, auto mode verified) | t13-sdk-core | docs/tasks/T13.md / ctx_812c4ec6d10b | GPT (after the T10 merge) | | |
| T02 (GPT) | Claude r1 changes (8895977); GPT fix r1 5bc5a05; Claude r2 in BE run | AlexandreLozi/t02-fix-r1 | GPT | r1 ctx_5c6b3170b2f8; r2 BE ctx_b125dedba577 | r2 pending | |

**Queued FE filler (GPT-independent, low budget):** T34a weekday owner checklist draft (Claude low/medium), to be dispatched in an idle slot after the Wave 1 reviews are covered.

**USAGE STOP (2026-11-01, liaison).** No new dispatches. Mid-flight in zilo-fe (post-reset, GPT-independent): T15 ctx_23881374964a, T13 ctx_812c4ec6d10b. Main backstop ci-web 41320496824 green (covers T04a). Resume order after the reset:
1. GPT T10 r4 (high) of f3ba120, BE run.
2. The T10 merge (Opus queue), after both masters approve the contract.
3. Wave 1 (T11/T12/T13/T15/T56a) by dependency order.
4. T01: process its worker_done, then a GPT r3.

Main backstop ci-web 41320055013 on 675f59d: check its result on resume.
Wave 1 (T11, T12, T13, T15, T56a) starts once T10 merges. T04a and T05 are already on main.

## 4b. BE lane status (GPT edits)
| ID | State | Branch | Author dispatch | Reviewer dispatch | Verdict | Merged SHA |
|---|---|---|---|---|---|---|
| T02 | **MERGED f362669** (Claude r3 PASS; D-012 reuse of SP-2a 41342861320; the main push runs native-smoke as the backstop). Worktrees pruned; a dirty CRLF working copy was archived to origin archive/t02-review-r2-worktree | AlexandreLozi/t02-fix-r2; report AlexandreLozi/t02-review-r3 @6da5e85 | task_d50682e94353 / ctx_2bf847522ded succeeded/released | task_1d519a375dab / ctx_fc5201da97b3 PASS/released | reviewer66gate+28spike; all5RIDs rawdeny1, original+unlicensed firstparty preserved; upstream72files unchanged; negative mutations reject. T06/shipping blocked | |
| T02-L | author settled; terminal released; integration handed to T02 | t02-license-gate | ctx_8d851f7ca858 | combined T02 Claude review | author reports 65 tests pass; review pending | |
| T04b | merged under D-010a; old terminal cleanup release_unknown | t04b-backend-scaffold | ctx_317f6a3478f7 | ctx_da98e443e5ce | Claude code PASS; Windows runtime blocked-by-host-SAC; macOS/hosted CI pending | 9e43bf7 |
| T04b-V | abandoned/superseded by Claude evidence; old resource released | t04b-native-validation | ctx_59467948111b | masters reviewed replacement evidence | no resumed Windows runtime execution (OD-6) | |
| T10 | **MERGED** by Opus, both masters approved exact f3ba120; r4 PASS e939912 | archived origin; locals pruned by Opus | Claude fix r3 ctx_062ede7e79cc done | task_98de4952c49d / ctx_30230df02424 succeeded/released | exact-merged-SHA79d6ec3 acceptance60/60+regression3/3; no runtime/support clearance | 79d6ec3 |
| T11a | Core-first author done/pushed @cf58cd7; handed to Opus for Claude medium review | AlexandreLozi/t11a-core-contracts base87267de | task_83a7b402c4a6 / ctx_3842e9b1a8b9 succeeded/released | Opus to dispatch Claude medium (msg_76c312c6941f) | locked restore/Release build/14 tests; no HTTP/auth/packages; exact handoff docs/tasks/T11-interface.md. T11/T12 wait review+merge | |
| T11 | queued high; **depends on merged T11a**, parallel with T12 afterward | docs/tasks/T11.md | GPT high planned | Claude high planned | frozen Core; hosted ci-contract + bounded packaging seam | |
| T12 | queued medium; **depends on merged T11a**, not full T11 | docs/tasks/T12.md | GPT medium planned | Claude medium planned | prototype merged; no Agent/Core concurrent edits | |
| T03 | r3 PASS @dc19861; merged by Opus; exact-SHA main CI gap closed | archived on origin; locals pruned by Opus | Claude fix r2 @26f5ab5 | task_f3300d311cb8 / ctx_d21e2a135b45 (released) | main f38e3ea packaging41316990218 +backend41316990194 success; signing/macOS runtime pending | f38e3ea |
| T12-proto | r2 PASS @fc72aa9; merged by Opus | t12-proto-pages; AlexandreLozi/t12-proto-review-r2 | Claude fix r1 @574aa2c | task_b312bc4653ca / ctx_f5c436f16f0e (settled; release retained/user_takeover) | rebased Linux Debug/Release 183/183 reported by Opus; prototype only; cross-OS pending | 32051c6 |
| T06 | blocked on joint ICA/worker/image strategy and T11 guard retirement | | | | shipping graph blocked | |

**BE USAGE STOP — 2026-11-01 15:15 UTC (owner liaison).** No new dispatches/reviews/sub-steps;
stop/checkpoint instructions sent to both live BE workers. Both settled usage-paused/incomplete
and their terminals were released; T10 r4 has no verdict. T02 fix r2 checkpoint is unchanged from
the reviewed base (known attribute-only dirty evidence paths).
Both exact checkpoint branch heads are pushed to origin. No polling or wait loops while stopped.
After reset authorization: **T10 r4 high → both-master contract approval + Opus T10 merge → Wave 1
(T11/T12/T13/T15/T56a) in dependency order**. T02 fix r2/Claude r3 and T01 follow at lower priority.
No contract approval, shipping graph clearance, or T06 unblock is implied by a usage checkpoint.

**RESUME authorized by liaison (2026-11-01; GPT acted 19:12 UTC):** T10 r4 high first;
exact contract joint approval/Opus merge; post-merge T13 ambiguity triage; GPT reviews T01,
T15, T13 in FE with Opus; T02 fix r2; BE T11 high and T12 medium by merged dependencies.
T02 fix r2 must also remove the premature first-party MIT LICENSE per owner M7 deferral,
without inventing a licence or weakening third-party default-deny/evidence hashes.

## 5. Concurrency bounds
- **Per lane at once:** at most 4 live authors, 2 live reviewers, and 1 fix dispatch per task.
- **Overall cap:** 10 live workers. When a lane is at its cap, new dispatches queue.
- **Dispatch timing:** a task is dispatched only when its dependencies have merged. For T21 and T23,
  the per-gate dependencies apply.
- **Stalls:** if a worker has no heartbeat after 3 empty waits, follow the Orca recovery reference.
  Absence alone never authorizes stop, abandon or retry.

## Sign-off
- **v3 rev 3.1 amendment (§3a, OD-8/OD-9):** Opus approved (2026-11-01); GPT approved (2026-11-01), including T56a/T56b split and task-owned checks; numerical budget gates await calibration and joint re-signature.
- Opus: approved (2026-10-31)
- GPT: approved (2026-10-31), including explicit T06 workflow ownership transfer and non-circular T32/T33 integration gate above
