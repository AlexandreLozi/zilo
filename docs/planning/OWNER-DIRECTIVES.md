# Owner directives (in force; relayed by the owner-liaison terminal)

Source: the owner (Alexandre), 2026-10-31 13:10 -03, via the owner-liaison Claude terminal
(term_374c17c1-05b8-4a7d-96dc-2d2241eb77c1). The owner ranks above both masters, so these apply
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

## OD-5 Reporting
- The owner talks only to the liaison terminal. Masters send owner-facing questions to the liaison,
  which relays them.
