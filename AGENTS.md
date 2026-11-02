# Zilo: instructions for every agent

This is the single source of agent instructions for this repo (OD-12). Claude reads it through
`CLAUDE.md`; OpenCode and Codex read it directly. Read `docs/context/BRIEF.md` first: it holds the
owner's requirements and working model, which are binding. Owner directives in
`docs/planning/OWNER-DIRECTIVES.md` (OD-1 onward) are binding too and override older text.

## Collaboration protocol (masters and workers)

- **Decisions:** `docs/planning/DECISIONS.md`. Each entry has an ID, the decision, rationale,
  alternatives, `Approved-by: Opus` and `Approved-by: GPT`. A decision without both approvals is
  not in force.
- **Discussion log:** `docs/planning/DISCUSSION.md`. Append-only; prefix each entry with `[Opus]`
  or `[GPT]`.
- **Plan:** `docs/planning/PLAN.md`.
- **Execution strategy and status tables:** `docs/planning/EXECUTION.md`.
- **Validation:** `docs/planning/VALIDATION.md`.
- **Owner questions:** `docs/planning/OWNER-QUESTIONS.md`. Never ask the owner directly; the owner
  talks only to the liaison terminal.
- **Handles and Run IDs:** `docs/planning/HANDLES.md`.
  - Message a peer: `orca-ide terminal send --terminal <handle> --text "<msg>" --enter --json`.
  - Read a peer: `orca-ide terminal read --terminal <handle> --screen --json`.
  - Keep messages short and point to files for long content.
- **Orca CLI:** use `orca-ide`, never bare `orca`. Load the guides with
  `orca-ide skills get orca-cli` and `orca-ide skills get orchestration`.

## Workers, models and effort

- **Model families and roles (OD-11):**
  - **DeepSeek V4.1 Flash Free (OpenCode):** routine and medium authoring.
  - **GPT-6.1 Sol (OpenCode):** back-end orchestration, ★ back-end authoring, and reviews of
    DeepSeek and Claude work.
  - **Claude Opus 5.5:** the Opus master, ★ front-end and design-critical authoring, and reviews
    of GPT work.
- **Cross-family review is mandatory.** The reviewer always comes from a different model family
  than the author.
- **Claude workers:** `orca-ide orchestration worker-start ... --agent claude --model claude-opus-5-5 --effort <level>`.
  After launch, check that the footer says "auto mode on".
- **OpenCode workers (GPT and DeepSeek):** Orca refuses `--model` and `--effort` for OpenCode. Set
  the model and variant per worktree (`opencode.json` core keys plus the active Slim preset, both
  `skip-worktree`), as described in OD-3. For high effort, also cycle Ctrl+X then V. Verify the
  TUI footer before relying on it.
- **Effort is chosen per task** (OD-3). Compact or hand off any session over about 250k tokens.

## Git and CI

- **Branches:** one per task (`t<NN>-<slug>`). Commit often and push your task branch.
- **Merging:** only the Opus master merges to `main` (the merge queue), after the cross-family
  review passes and hosted CI is green, or under D-012 evidence reuse.
- **Pruning:** only the Opus master deletes local worktrees and branches.
- **CI:** hosted CI runs on the private repo `AlexandreLozi/zilo` (OD-7). Actions minutes are
  billed (macOS 10×), so avoid redundant runs.
- **Never run unsigned binaries natively on the Windows host** (Smart App Control, OD-6). Use
  hosted CI instead.
- **Browser tests run headless** (Playwright headless or the Orca browser). No visible windows on
  the owner's screen.
- **Usage limits:** near a limit, checkpoint: commit, push, record state in EXECUTION.md, then
  idle. Never wait-loop.
