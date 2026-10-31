# Zilo execution strategy

**Status:** DRAFT v1 by [Opus], 2026-10-31. Phase 2. It implements PLAN.md (v2), so it changes if
PLAN or DECISIONS do. Both masters sign it off at the bottom.

## 1. Orca mechanics

- **Two Runs, one inbox each.** Orca `check` consumes a Run's FIFO inbox, so two masters sharing one
  Run would steal each other's deliveries.
  - The Opus master creates Run **`zilo-fe`**: front end, design, SDK, demo, E2E, and overall tracking.
  - The GPT master creates Run **`zilo-be`**: agent, drivers, virtual scanner, packaging, security.
  - Each master records its Run ID in `docs/planning/AGENTS.md`.
- **Overall tracking is held by the Opus master**, who reads both Runs (`worker-list --run <id>`)
  and keeps the status table in section 4 current. The GPT master reports back-end status changes by
  terminal message, and edits section 4 rows itself.
- **Worktrees:** one isolated Orca worktree per task, on branch `t<NN>-<slug>` based on `main`.
- **Claude workers:**
  `worker-start --task <id> --worktree new-top-level --name t<NN>-<slug> --agent claude --model claude-opus-5-5 --effort high`.
  Use effort `xhigh` only for tasks marked ★ (security- or contract-critical).
- **GPT workers:** `--agent opencode` in a new worktree, **without `--model`**. Orca refuses an OpenCode
  model override when creating a new worktree, and the committed `opencode.json` already pins
  `openai/gpt-6.1-sol`, reasoning `high`. The GPT master checks `launch.effective` in each receipt.
- **Task specs** follow the Orca contract (Target, Change, Constraints, Ownership, Observable
  acceptance). Each spec cites the decision IDs it implements and links PLAN and CONTRACT sections.
- **Escalation:** a worker that hits an architecture question sends `ask` to its own master. The
  master answers alone if the question is inside an in-force decision; otherwise it goes to
  DISCUSSION.md and both masters decide.

## 2. Branches, review and integration

1. The **author** works on its task branch and commits often. It runs the task's tests, then sends
   `worker_done`.
2. The **lane master** — the master who dispatched the author — starts a **reviewer of the other
   model family** in its own Run, pointed at the same branch. The reviewer may comment and add failing
   tests but does not fix code. Pairing rule: Claude-authored work gets a GPT (opencode) reviewer, and
   GPT-authored work gets a Claude reviewer. No exceptions, including docs and plans.
3. **Fixes** go back to the author, reusing the author's terminal when it is still live. The review
   repeats until the reviewer reports pass.
4. **Merge:** the lane master rebases the branch on `main`, re-runs CI, and fast-forward merges only
   when CI is green and review has passed. Each merge is recorded in VALIDATION.md (task, reviewer
   model, CI run link).
5. **Shared-file rule:**
   - `api/openapi.yaml`, `api/CONTRACT.md` and `.github/workflows/*` change only through a task that
     names them, with both masters' approval in the review record.
   - `Directory.Packages.props` and the lock files belong to the GPT lane. `pnpm-lock.yaml` belongs to
     the Opus lane.
6. **Planning docs:** once both masters sign off, Phase 1 and Phase 2 docs are committed to `main`
   directly, as the owner did for the brief, so every worktree inherits them. That is fine because
   both masters reviewed them cross-model. Later edits to the planning docs go in through small
   commits by the editing master.

## 3. Task DAG

Legend:
- **Lane:** FE = Opus master, BE = GPT master.
- **Author:** C = Claude worker (claude-opus-5-5), G = GPT worker (gpt-6.1-sol).
- **Reviewer:** always the other model family.
- ★ marks high-risk tasks (Claude effort `xhigh`; GPT reviewers are told to focus on security).

### Wave 0 — M0a feasibility + scaffolding (all parallel)
| ID | Task | Lane | Author | Reviewer | Deps | Acceptance |
|---|---|---|---|---|---|---|
| T01 | **SP-1a** transport stub + browser harness: loopback HTTP stub with Host/Origin checks, HTTPS test page, Playwright runs in Chromium, Firefox and WebKit covering fetch with `targetAddressSpace`, fetch-stream SSE, permission states, and the S2 bridge handshake prototype; plus a real-Safari manual script | FE | C | G | — | Results matrix in `docs/spikes/SP-1a.md`, with evidence (logs and screenshots) per browser and the real-Safari rows marked pending |
| T02 | **SP-2a** NAPS2.Sdk 1.6.0 on net10: locked restore per RID (win-x64, win-arm64, osx-arm64, osx-x64, linux-x64), package and native payload inventory, default-deny licence gate script, minimal device-list against an independent eSCL/SANE fixture (not T12); an empty physical list is not a failure | BE | G | C | — | `docs/spikes/SP-2a.md`; licence gate runs in CI and fails on a seeded bad package |
| T03 | **SP-4a** unsigned packaging dry runs (MSI or MSIX, `.pkg`, `.deb`/`.rpm`) for a hello-world agent, in CI | BE | G | C | T04b | Artifacts built on 3 OS runners; install and uninstall smoke on Linux |
| T04a | Web scaffold: pnpm workspace `packages/{sdk,ui,dwt-compat}`, `apps/demo` (Vite + TS), TS strict, Vitest, Playwright config, lint and format, CI web job | FE | C | G | — | `pnpm -r build test` green in CI |
| T04b | Backend scaffold: `backend/` .NET 10 solution (`Zilo.Agent`, `Zilo.Core`, `Zilo.Drivers.Naps2`, `Zilo.Drivers.Virtual`, `Zilo.Security`, tests), `global.json`, central packages, locked restore, CI on 3 OSes | BE | G | C | — | `dotnet test` green on Windows, macOS and Linux CI |
| T05 | UX + visual design spec: Scan dialog, Install, Permission-help (per browser), Update, Safari-unsupported state, tray consent prompt, revocation UI; tokens; error copy for each code; a11y spec | FE | C | G | — | `docs/design/` spec with annotated mockups (HTML prototypes in `apps/demo/design/`), copy table |

### Wave 1 — M1 contract + skeletons
| ID | Task | Lane | Author | Reviewer | Deps | Acceptance |
|---|---|---|---|---|---|---|
| T10 ★ | Full contract `api/openapi.yaml` + `api/CONTRACT.md` (PLAN section 4) | BE | G | C | T01 (transport findings) | Both masters approve in the review record; schema lint passes; generated TS types compile |
| T11 ★ | Agent skeleton: `hello`, `devices`, `caps`; Host and Origin checks; consent hook (headless stub); tokens (issue, expire, revoke); bounded resources | BE | G | C | T04b, T10 | Contract tests pass; security unit tests for Host, Origin and token |
| T12 | Virtual driver (D-007 layer 1): deterministic pages with a QR metadata code, flatbed, ADF, duplex, failure variants; control endpoint compiled out of release | BE | G | C | T04b | Golden-image tests; failure-variant tests |
| T13 | SDK core: discovery state machine (D-008 states), permission query, HTTP transport, typed errors, devices and caps, unknown-field tolerance | FE | C | G | T04a, T10 | Unit tests against a mock server generated from OpenAPI |
| T14 | Demo app skeleton consuming the SDK; device list | FE | C | G | T04a, T13 | Lists "Zilo Virtual Scanner" against the T11+T12 agent on Linux CI (M1 exit) |
| T15 | UI foundation: Web Components base, design tokens, dialog primitive (focus trap, ARIA), themes, React wrapper | FE | C | G | T04a, T05 | Storybook-style catalog in the demo; axe checks pass |

### Wave 2 — M2 virtual end-to-end
| ID | Task | Lane | Author | Reviewer | Deps | Acceptance |
|---|---|---|---|---|---|---|
| T20 ★ | Agent jobs: state machine, SSE with `seq` and replay, pages, export (PDF, TIFF, JPEG, PNG) with retry, cancel, dispose, TTL, user-private temp | BE | G | C | T11, T12 | Contract tests; export golden tests |
| T21 | SDK jobs, events (reconnect), pages, export, Blob/File outputs | FE | C | G | T13, T10 | Unit tests against the mock server, then against the real agent |
| T22 | Scan dialog v1 (device list with driver badges, settings bound to caps, live thumbnails, rotate, reorder, delete, export) | FE | C | G | T15, T21, T05 | Component tests + a11y |
| T23 | **SP-3** E2E: Playwright on Chromium, Firefox and WebKit; demo scans 3 pages duplex and exports a PDF; asserts order from the QR codes | FE | C | G | T20, T22, T14 | Green on Linux and Windows CI (M2 exit) |
| T24 ★ | Security suite: hostile origin, bad Host, replayed pairing challenges, expired and revoked tokens (valid bearer reuse is allowed), cross-origin job access, GET safety, resource bounds | BE | G | C | T20 | Suite in CI; every case red-then-green proven |
| T25 ★ | Safari path, per the SP-1a result: S2 bridge (agent capability minting = BE; bridge page + SDK relay = FE) **or** S1 trust tooling **or** the explicit unsupported state | FE+BE | C+G | G+C | T01, T20, T21 | S2 hostile-opener, forged-origin, wrong-nonce and stale-session tests; COOP detection |

### Wave 3 — M3 real drivers (BE), parallel with Wave 4 FE work
| ID | Task | Lane | Author | Reviewer | Deps |
|---|---|---|---|---|---|
| T30 | NAPS2 WIA + TWAIN driver with the x86 worker, caps mapping, effective settings | BE | G | C | T20, T02 |
| T31 | NAPS2 ICA driver (macOS) | BE | G | C | T20, T02 |
| T32 | NAPS2 SANE (+sane-airscan) and eSCL drivers | BE | G | C | T20, T02 |
| T33 | Virtual eSCL device (D-007 layer 2) + CI exercising the eSCL path | BE | G | C | T12, T32 |
| T34 | Owner hardware checklist (TWAIN, WIA, ICA, SANE, eSCL, WSD routes; real-Safari script) | FE | C | G | T23 |

### Wave 4 — M4 install and lifecycle
| ID | Task | Lane | Author | Reviewer | Deps |
|---|---|---|---|---|---|
| T40 | Windows installer, autostart, `zilo://` | BE | G | C | T03, T30 |
| T41 | macOS `.pkg`, login item, URL scheme, hardened runtime | BE | G | C | T03, T31 |
| T42 | Linux `.deb`/`.rpm`, `systemd --user`, XDG handler | BE | G | C | T03, T32 |
| T43 ★ | Signed `latest.json`, updater (verify, anti-downgrade, atomic, recovery) | BE | G | C | T11 |
| T44 | Tray/menu-bar shells: consent prompt, revocation, status, logs (built to the T05 design) | BE | G | C | T11, T05 |
| T45 | SDK + UI: Install, Permission-help, Update and Safari-state dialogs; bounded polling; `zilo://start` | FE | C | G | T22, T43 |
| T46 | Download page consuming `latest.json` | FE | C | G | T43 |

### Wave 5 — M5 compat + hardening
| ID | Task | Lane | Author | Reviewer | Deps |
|---|---|---|---|---|---|
| T50 | `@zilo/dwt-compat` from the owner's call inventory (**blocked on owner**) | FE | C | G | T21, owner code |
| T51 | Diagnostics endpoint + support bundle (no document data) | BE | G | C | T20 |
| T52 ★ | Threat-model review of the whole system | joint | C and G independently | cross | T24, T25, T43 |
| T53 | Licence and NOTICE inventory for the final installers; legal review package | BE | G | C | T40–T42 |

### M6 release readiness (owner-assisted; pending ≠ pass)
SP-1b real Safari 26, SP-4b signing and notarization, the hardware matrix, legal sign-off. Tracked in
VALIDATION.md.

## 4. Status (kept current by both masters)
| ID | State | Branch | Author dispatch | Reviewer | Merged |
|---|---|---|---|---|---|
| T01 | not started | | | | |
| T02 | not started | | | | |
| T03 | not started | | | | |
| T04a | not started | | | | |
| T04b | not started | | | | |
| T05 | not started | | | | |

## 5. Concurrency and pacing
- At most **4 live workers per lane** at a time: 8 in total, plus reviewers.
- Wave 0 starts all 6 tasks at once.
- A task is dispatched when its dependencies are merged, not merely done.
- T10 may start from T01's interim findings: the transport choice affects only the Safari section of
  the contract.

## Sign-off
- Opus: pending (draft)
- GPT: pending
