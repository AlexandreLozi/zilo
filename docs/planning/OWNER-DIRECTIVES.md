# Owner directives (in force; relayed by the owner-liaison terminal)

Source: the owner (Alexandre), 2026-10-31 13:10 -03, via the owner-liaison Claude terminal
(term_3e2987c0-f472-4f48-9eca-465441bc60b9). The owner ranks above both masters, so these apply
without DECISIONS.md double approval. The GPT master is briefed when it resumes.

## OD-1 GPT outage (from ~13:00 to ~17:25)
- OpenCode/GPT hit its usage limit. Every opencode terminal is stalled: the GPT master, T02, T04b-V
  and the T04a reviewer.
- Do **not** start or nudge any opencode worker until the liaison announces that GPT is back. That
  resume is scheduled for about 17:25.

## OD-2 Claude may take over GPT-lane work during the outage
- Claude workers may author BE-lane tasks while GPT is out. Cross-model review still holds: anything
  Claude authors is queued for a **GPT review after resume** and does not merge before it passes.
- Approved now:
  1. **T04b-V** (native Windows CI-equivalent evidence for T04b) goes to a Claude worker in
     `zilo-fe`. The work is evidence only, with no code. The GPT T04b-V dispatch
     (ctx_59467948111b) stays as it is, and the GPT master stops or abandons it on resume.
  2. **T10 contract** (★): a Claude author starts once T04b has merged, using the unreviewed
     SP-1a interim note, flagged as such. The GPT review on resume covers both the T01 interim note
     and T10.
- Leave T02 to GPT. Its worktree is dirty and the report is nearly done.

## OD-3 Effort and usage budget (revised 2026-10-31 ~14:10)
- **The orchestrators choose each worker's effort per task.** Not everything runs at medium:
  - Mechanical, evidence-only and docs work runs at `low` or `medium`.
  - Normal implementation and reviews run at `medium` or `high`.
  - Hard or ★ work (contract, security, jobs/SSE, Safari path, updater, threat models) runs at
    `high`.
  - `xhigh` is reserved for a rare case where the master writes down why.
  - Usage is limited for **both** Claude and GPT, so pick the lowest effort that does the task
    well.
- Claude workers take `worker-start ... --model claude-opus-5-5 --effort <level>`.
- OpenCode workers can't take `--effort` (Orca doesn't support it). The workspace default in
  opencode.json is `medium` for `build` and `high` for the master's `orchestrator` agent. To run a
  GPT worker at another effort:
  1. Pre-create the worktree.
  2. Set `provider.openai.models.gpt-6.1-sol.options.reasoningEffort` and `agent.build.variant` in
     that worktree's `opencode.json`. This is a local edit only: run
     `git update-index --skip-worktree opencode.json` and never commit it.
  3. Run `worker-start --worktree <that worktree> --agent opencode`.
  4. Check `launch.effective`.
- Claude workers that are blocked on BE/GPT work must be stopped, not left looping. A worker that
  has finished and is idle may stay up.
- Usage-limit recovery: a watchdog (`~/.local/share/zilo-watchdog/watchdog.sh`, log beside it)
  works without a model. When a terminal shows a usage-limit error, it sends "continue" to the
  stalled Claude terminals and a resume brief to the GPT master. It never resumes GPT workers
  directly; the GPT master decides which ones to resume.

## OD-4 Browser testing
- Use headless browsers only: Playwright headless, or the Orca embedded browser. No visible browser
  windows on the owner's screen. The Playwright CLI and other test tools may be added when needed.

## OD-6 Windows Smart App Control (SAC) on the owner's host
- **SAC is enforcing on the WSL host.** It blocks unsigned executables and DLLs that our builds
  produce (testhost loading Zilo DLLs, built exes, downloaded installers). The owner gets a
  "Smart App Control blocked part of this app" notification each time.
- **Agents must not run unsigned Zilo or third-party binaries natively on the Windows host.** That
  includes `dotnet test` or run on Windows, installers, and the NAPS2 worker. Windows *build* steps
  that invoke only Microsoft-signed tools are allowed. Stop at the first SAC block; do not retry.
- **Never try to bypass or disable SAC**, and never ask the owner to turn it off. Once SAC is
  turned off, it can only be turned back on by reinstalling Windows.
- Windows runtime evidence stays **pending** until hosted Windows CI (GitHub Actions) or a
  disposable Windows VM is available. A SAC block is recorded as `blocked-by-host-SAC`, never as a
  failure of the code, and never as a pass.
- **Product requirement, which this proves:** customer PCs with SAC on block unsigned Zilo the
  same way. Every shipped Windows PE file must carry an Authenticode signature from a reputable CA
  (for example Azure Trusted Signing or an OV/EV certificate) with a timestamp. That covers the
  agent exe, our DLLs, the bundled NAPS2 worker and any helper, not only the installer. Applies to
  SP-4b, T03, T40 and T53. Test keys cannot satisfy SAC: a test-signed build is expected to be
  blocked.

## OD-7 Hosted CI: private GitHub repo (2026-10-31 ~17:35)
- The owner approved a **private** repo, **https://github.com/AlexandreLozi/zilo** (remote
  `origin`). `main` and the active task branches (t10, t01, t04a, t05, t03, t12-proto) are pushed.
  The first runs are Backend CI on `main` (manual dispatch), spike-transport and packaging dry run.
- Hosted CI on the rebased SHA now **replaces** the D-010 local-only evidence wherever a workflow
  exists. Backfill the "hosted CI: pending" rows in VALIDATION.md. Windows and macOS runtime rows
  that were pending (including the OD-6 SAC blocks) are proven on hosted runners.
- Who pushes:
  - The Opus master pushes `main` after each merge.
  - Authors push their own task branch.
  - Do not push review-only branches unless they add tests.
- Never make the repo public, add collaborators, or change repo settings without the owner.
- **Actions minutes are billed on private repos** (Windows 2×, macOS 10×). Rules to keep the bill
  down:
  - Avoid duplicate pushes and reruns that aren't needed.
  - Keep `paths:` filters.
  - Run the macOS matrix only where a task needs it.
  - Cancel superseded runs (`concurrency: cancel-in-progress` is welcome).
- Secrets: none in the repo, ever. Signing test keys are generated during CI.

## OD-8 Safari required; front-end framework (2026-10-31 ~17:55)
- **Safari on macOS is required for v1.** The T25 Safari path, S2 bridge or better, is
  release-blocking. "Safari unsupported" can no longer be the shipped outcome; it is only an
  interim test state.
- **Framework:** the owner delegated this choice; React with TSX is the owner's default.
  Resolution:
  - The SDK core stays framework-agnostic TypeScript.
  - The UI stays framework-agnostic Web Components, so any app can use it (OD-9).
  - **React (TSX) is the first-class wrapper and the reference integration.**
  - The demo app is a **React + TS (Vite)** app.
  - Angular and Vue wrappers are later, thin, optional extras.
- Owner questions now live in `docs/planning/OWNER-QUESTIONS.md`.

## OD-9 Product goal: open source, wide compatibility, fast and reliable
- Zilo is meant to become an **open-source alternative to Dynamic Web TWAIN for anyone**, not only
  the owner's app. Consequences:
  - **Wide compatibility is a first-class requirement.** That means every driver route (TWAIN
    x86/x64, WIA, ICA, SANE, eSCL/AirScan, WSD where feasible), the browser matrix including
    Safari, Win/macOS/Linux on x64 and arm64, and both per-user and admin installs.
  - **`@zilo/dwt-compat` covers the commonly used public DWT API**, prioritized by the owner's
    answers (OWNER-QUESTIONS.md). It is clean-room: no Dynamsoft code, assets or docs are copied,
    and API names come only from public documentation.
  - **Performance budgets.** The masters add measurable budgets to PLAN.md, with tests that
    enforce them. At minimum:
    - agent cold start;
    - detection time in the SDK;
    - time to first page;
    - ADF throughput (pages per minute, virtual and real);
    - memory per page;
    - export time for an N-page PDF.
  - **Reliability.** Required:
    - crash and kill recovery of the agent and the x86 worker;
    - long soak runs (for example 500 pages through the virtual ADF);
    - reconnect after sleep and resume;
    - clean behaviour on unplug or paper jam;
    - no leaked temp files.

    Add these as acceptance criteria to the relevant tasks (T20, T23, T30–T33, T24).
  - **Open-source hygiene before the first public release:**
    - a licence choice (masters propose; owner decides);
    - CONTRIBUTING, a security policy, DCO or CLA, a NOTICE file from T53;
    - a **clean public history without the agent planning material**.

    Development stays in the private repo for now.
- **Agent files stay tracked in the private repo** (CLAUDE.md, .claude/settings.json,
  opencode.json, .opencode/, docs/planning, docs/tasks, docs/reviews):
  - Orca worktrees are created from committed `main`. If these files were gitignored, workers
    would start without instructions, permissions, model pins or task specs.
  - The public release is cut later as a clean export or filtered history. It excludes those paths
    and keeps the product docs (api/, docs/design, docs/spikes findings, user and contributor
    docs).
  - Per the owner's pc-setup default, `CLAUDE.md` stays the single source of truth. No duplicate
    AGENTS.md.

## OD-5 Reporting
- The owner talks only to the liaison terminal. Masters send owner-facing questions to the liaison,
  which relays them.
