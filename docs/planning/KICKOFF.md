# Kickoff: master agents

You are one of the two **master agents** for Zilo. Read `CLAUDE.md` and `docs/context/BRIEF.md`
now. Your peer master's terminal handle is in `docs/planning/AGENTS.md`.

- **Opus master** (Claude Opus 5.5, high effort): overall execution orchestrator. Owns design, UX,
  the front end, the JS/TS browser SDK, the download/install dialog UX, and the demo/test web app.
- **GPT master** (GPT Sol 6.1, high effort, opencode): owns the back end. That means the local
  service, OS scanner backends (TWAIN/WIA on Windows, ICA on macOS, SANE on Linux, eSCL/AirScan
  and WSD for network devices), the virtual test scanner, installers, signing, auto-update and
  security. GPT orchestrates the back-end workers.

## Phase 1: Plan (both masters, jointly)
1. Each master researches independently first: current docs, the NAPS2.Sdk license and
   capabilities, naps2-webscan, Dynamsoft's API surface and its virtual scanner, browser Local
   Network Access / Private Network Access rules for 127.0.0.1 in Chrome, Edge, Firefox and Safari,
   localhost TLS versus plain HTTP, custom URL protocol handlers for "launch the service", TWAIN
   32/64-bit, macOS notarization, and Linux packaging. Write your findings to
   `docs/planning/research-<opus|gpt>.md`.
2. Exchange and debate in `docs/planning/DISCUSSION.md`, and ping each other by terminal send when
   you have written something the other must read.
3. Decide the key architecture questions together. Record each one in `DECISIONS.md` with both
   approvals:
   - native per OS or shared core (for example .NET + NAPS2.Sdk, Rust, Go, or a hybrid with native
     shims)
   - browser transport (HTTP or WS on localhost, TLS strategy, pairing and auth, origin allowlist)
   - API shape (REST and events), plus whether to offer a Dynamsoft-compatible adapter
   - virtual test scanner design
   - installer and detection/download flow per OS
   - licensing compliance
   - repo layout, languages, testing and CI (including cross-OS CI runners)
4. Write `PLAN.md`: scope, architecture, components, API contract, milestones and acceptance
   criteria. Both masters sign it off at the bottom.

## Phase 2: Execution strategy
Write `EXECUTION.md`: the work breakdown as a task DAG, which worker (model and effort) owns each
task, branch and worktree strategy, cross-model review pairing for every task, and integration
order. Both masters sign it off.

## Phase 3: Execution
The Opus master runs the Orca orchestration Run (`orca-ide orchestration run-create`) and starts
front-end and design workers. The GPT master starts and supervises the back-end workers, as a
nested coordinator or via the Opus master's Run. Agree on the mechanics in Phase 2. Workers use
isolated Orca worktrees. Claude workers: `--agent claude --model claude-opus-5-5`. GPT workers:
`--agent opencode --model openai/gpt-6.1-sol`.

## Phase 4: Validation
Every task is reviewed and validated by the other model family. Cover unit tests, integration
tests against the virtual scanner, E2E browser tests (Playwright across Chromium, Firefox and
WebKit), and cross-OS CI builds. Track results in `VALIDATION.md`. Real-hardware testing needs the
owner, so produce a short hardware test checklist for them.

## Rules
- Fully autonomous: do not wait for the owner. If you need the owner's app integration code
  (the Dynamsoft calls the app makes), note it under "Owner questions" at the top of
  `DISCUSSION.md`, update the Orca workspace comment (`orca-ide worktree set --worktree active
  --comment "..." --json`), and continue with everything that does not depend on it.
- Never make a unilateral architecture decision. If you disagree, argue with evidence. If you are
  still deadlocked after two rounds, pick the option that is easier to reverse and record why.
- Keep the Orca workspace comment updated at each phase transition.
