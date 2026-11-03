# Owner directives (in force; relayed by the owner-liaison terminal)

Source: the owner (Alexandre), 2026-10-31 13:10 -03, via the owner-liaison Claude terminal
(term_692bba74-0afa-4e5f-bca6-11aae0dfdadc). The owner ranks above both masters, so these apply
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
  2. Set the effort in **both** config files. The proven recipe (GPT, a798748, exact steps in
     DISCUSSION.md):
     - **`opencode.json`:** the 3 core keys.
     - **`.opencode/oh-my-opencode-slim.json`:** the active Slim preset's variant. This preset
       overrides the core keys, which is why earlier dispatches ignored the setting.

     Mark both files `git update-index --skip-worktree` and never commit them.
  3. Start a **fresh** process: `worker-start --worktree <that worktree> --agent opencode`.
  4. Verify the receipt **and** the worker's TUI footer, for example "GPT-6.1 Sol OpenAI · high".
     - **Medium is proven:** the config recipe alone gives medium (T02 fix r1).
     - **High needs a per-session switch.** The config alone still showed medium. Send the
       variant-cycle key, **Ctrl+X then V** (`variant.cycle` in cli.json), with
       `orca-ide terminal send` until the footer reads `high`, then re-read the footer to confirm.
       Proven on T10 r3. Exact steps are in DISCUSSION.md.
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
- **Interpretation (owner liaison, 2026-11-01):** OD-7 allows the **D-012 bounded evidence reuse**. A green
  hosted run on the exact reviewed head stands in for a rebased-SHA rerun when:
  - the task is not star-marked;
  - the rebase had no conflicts;
  - every workflow input is byte-identical (`git diff --quiet` over the full D-012 input set);
  - VALIDATION.md labels it "evidence reuse".
  - **Backstop:** the path-filtered workflows run again on `main` after the push. A red post-merge
    run on `main` is an immediate P1 fix task and blocks the next merge in that lane.
  - Star tasks always rerun on the exact rebased SHA.
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
  - **Superseded by OD-12:** root `AGENTS.md` is now the single source of truth for this repo, and
    `CLAUDE.md` only imports it.

## OD-10 Browser support matrix (owner, 2026-11-02)
- **Chromium family:** Chrome, **Edge (explicitly required)**, plus Brave, Opera, Vivaldi and
  other Chromium browsers wherever their engine allows.
- **Firefox family:** Firefox plus derivatives (LibreWolf, Waterfox, ...).
- **Safari:** required (OD-8).
- **CI:** add **Microsoft Edge** to the Playwright matrix (the `msedge` channel on the Windows and
  Linux runners) from M2 (T23) onward. Other Chromium and Firefox derivatives get a documented
  manual smoke row in the owner checklist (T34), not CI.
- **Known caveats:**
  - Brave Shields and its localhost-access permission may need an explicit grant.
  - Tor Browser is out of scope: it blocks localhost by design.
  - Record each caveat with its UX in the Permission-help dialog (T45).

## OD-11 Third model family: DeepSeek for authoring, to spare Claude (owner, 2026-11-02)
- **Why:** Claude is near its weekly limit and the owner cannot reset it. GPT has just been
  reset. OpenCode offers `opencode/deepseek-v4.1-flash-free` (free).
- **Liaison test:** on a read-only review of `packages/sdk/src/detection.ts`, DeepSeek found a
  real, precise race in 33 seconds: `go({state:'checking'})` at line 362 notifies listeners before
  the deadline timer is armed. Headless `opencode run` hangs on tool use, so use only Orca TUI
  sessions.
- **Roles from now on:**
  - **DeepSeek (OpenCode, free): the default author** for routine and medium tasks in both lanes.
  - **GPT:** back-end orchestration, ★ back-end authoring, and **reviews of DeepSeek work**.
  - **Claude:** the Opus master (lean), ★ front-end and design-critical authoring, and reviews of
    GPT-authored work only. Claude does no routine authoring while near its weekly limit.
- **Cross-model rule:** the reviewer is always from a different family than the author.
  - DeepSeek work is reviewed by GPT, or by Claude for ★ tasks.
  - GPT work is reviewed by Claude, or by DeepSeek for non-★ tasks when Claude is constrained.
  - Claude work is reviewed by GPT.
  - No family ever reviews its own work.
- **Pilot first:** one bounded non-★ task authored by DeepSeek with a GPT review (suggestion: T14
  demo device list, or the next routine fix). Scale up if it passes review in at most 2 rounds.
  If DeepSeek's quality is insufficient, fall back to GPT authoring.
- **Dispatch:** Orca refuses `--model` for OpenCode, so use the OD-3 per-worktree recipe with
  `model` = `opencode/deepseek-v4.1-flash-free` (core keys and the active Slim preset,
  skip-worktree). **Verify that the TUI footer reads "DeepSeek V4.1 Flash Free".**
- **Data note:** free-tier models may retain prompts and code. Zilo is the owner's code, destined
  for open source, and the owner accepted this. Never paste secrets into any session.

## OD-12 AGENTS.md is the repo's agent instructions (owner, 2026-11-02)
- **Root `AGENTS.md`** is the canonical agent-instructions file for every agent: Claude, GPT and
  DeepSeek via OpenCode, and Codex. OpenCode and Codex read it natively.
- **`CLAUDE.md`** contains only `@AGENTS.md`, so Claude Code loads the same text. Never put content
  in `CLAUDE.md`.
- **The handles table** moved from `docs/planning/AGENTS.md` to **`docs/planning/HANDLES.md`**.
- This repo-level choice overrides the owner's global pc-setup default ("CLAUDE.md is the source
  of truth") for this repo only.

## OD-13 Repo hygiene task before the open-source release (owner, 2026-11-02)
- **Add a roadmap task:** organize folders and files, then remove or relocate stale artifacts:
  - planning and review clutter;
  - one-off resume briefs;
  - archived spikes;
  - scratch, worktree and branch leftovers.

  It also needs a consistent layout and naming, a README and docs index, and a check that nothing
  sensitive is tracked.
- **Timing:** schedule it before M7 (the open-source release), after a functional app exists, and
  before cutting the clean public export (OD-9). It is a normal task: author, cross-family review,
  merge.

## OD-5 Reporting
- The owner talks only to the liaison terminal. Masters send owner-facing questions to the liaison,
  which relays them.

## OD-14 Bun preference, no migration now (owner suggestion, 2026-11-02; liaison decision)
- **Owner:** prefers Bun where it is easy, because it is faster. This is a suggestion, not a
  requirement. Don't break or slow current work for it.
- **Decision: keep pnpm + Node 24 for the workspace.** Switching now would touch the lockfile, 16
  CI references and the licence gate, which is built on `pnpm licenses list` (Bun has no
  equivalent). The speed gain is dev-loop only: the shipped product is the browser SDK plus the
  .NET agent, so Bun changes nothing for users.
- **Allowed now:** Bun for standalone local scripts and one-off tooling that adds no second
  lockfile and no CI dependency.
- **Revisit** during the OD-13 hygiene task. Measure install and test time with pnpm against Bun,
  and switch only if the gain is real and the licence gate has a replacement.

## OD-15 Economy without losing quality; free CI minutes exhausted (owner, 2026-11-02 23:30)
- **Event:** the account's 2,000 free GitHub Actions minutes for the month are used up. Hosted CI
  is **unavailable** until the monthly reset, unless the owner buys minutes, which he may do for
  macOS or Linux evidence only when it is truly valuable. Ask through the liaison, with a concrete
  minute estimate.
- **Quality first.** Never lower a gate because CI is missing. A task whose acceptance needs hosted
  evidence (3-OS, macOS arm64, Windows native) **waits** in HELD-for-CI. Meanwhile, work continues
  on anything verifiable locally.
- **Local-first verification:** run the full local suite before every push: `dotnet test` and pnpm
  `ci` on WSL Linux, with headless Playwright. Record the local evidence in the task log.
- **Hosted CI only when it matters:**
  - merge gates for ★ tasks;
  - cross-OS evidence that can't be produced locally;
  - one combined run per task head, never per fix commit.
  Use workflow_dispatch and path filters, and **no macOS runs (10×)** unless macOS evidence is the
  gate. Batch the gates that wait for CI so a single run covers several tasks after the reset.
- **Economy in usage:** everyone has limits. The DeepSeek free tier comes first for routine work
  (OD-11), GPT reviews, and Claude stays lean. Restart large sessions fresh rather than resume them
  (over about 250k tokens).
- **Progress file:** any agent must be able to pick up from the docs alone. **EXECUTION.md §4a (top
  "resume points") is the canonical pickup board.** Each master updates it at every checkpoint: task,
  head SHA, state, next action, and what is waiting on CI. No knowledge may live only in a session.

## OD-16 Repo is public (owner, 2026-11-02 23:50)
- `AlexandreLozi/zilo` is **public** at the owner's request: the goal is open source anyway. GitHub
  Actions minutes are now free.
- **Supersedes:** OD-7's billing constraint and OD-9's "private until M7". M7 still owns the licence
  choice, the hygiene pass (OD-13) and the release.
- **Still binding:** OD-15 CI economy. Run locally first, use hosted CI only for gates, and make
  one combined run per task head. CI is optimized, never abused.
- **Before publishing:** the liaison scanned the full history and found no tokens, keys or
  credentials, no employer name, no `pull_request_target` workflows and no repo secrets. Until a
  LICENSE is added, the code is all-rights-reserved by default.
- **Public-repo hygiene from now on:**
  - Never commit secrets, owner or employer identifiers, or customer data.
  - Hold planning docs to the standard of a public project.
  - First-time-contributor PRs need approval before their workflows run (the GitHub default; keep it).
- **HELD-for-CI gates may now run.** Batch them as OD-15 says: Mac arm64 r2, Windows native and the
  3-OS gate in combined runs.

## OD-17 GLM free as an optional fourth family (owner idea, 2026-11-03; NOT active)
- **Status: on hold.** The owner floated this as an idea only. Don't dispatch GLM now. The CI audit
  below moves into the OD-13 hygiene task; CI is free while the repo is public. Use GLM only if
  free capacity becomes a real bottleneck.
- **Model:** `opencode/glm-5.3-flash-free` (Zhipu). It is free and joins as a fourth family, next to
  DeepSeek, GPT and Claude.
- **First task:** a CI workflow economy audit and fix (`.github/workflows/*`), covering:
  - `concurrency` with `cancel-in-progress` on every workflow;
  - path filters for every workflow, with docs-only pushes triggering nothing;
  - dependency caches (NuGet and pnpm);
  - an OS matrix that runs on gates and `workflow_dispatch`, not on every push;
  - no duplicate push and pull_request runs;
  - job timeouts.
- **Review:** a cross-family reviewer, GPT or Claude, per the usual rule.
- **Scope:** routine, low-risk work only (CI, docs, specs, small fixes). GLM may also give a
  second-opinion review of DeepSeek routine work. ★ work and its reviews stay with GPT or Claude.
- **Dispatch:** same OpenCode per-worktree recipe as OD-3 and OD-11, with the model set to
  `opencode/glm-5.3-flash-free`. Check the footer before relying on it.
