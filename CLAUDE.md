# Zilo

Read `docs/context/BRIEF.md` first. It holds the owner's requirements and the working model, which are binding.

## Collaboration protocol (both masters and all workers)
- Decisions: `docs/planning/DECISIONS.md`. Each entry has ID, decision, rationale, alternatives, `Approved-by: Opus` and `Approved-by: GPT`. A decision without both approvals is not in force.
- Discussion log: `docs/planning/DISCUSSION.md` (append-only, prefix each entry with `[Opus]` or `[GPT]`).
- Plan: `docs/planning/PLAN.md`. Execution strategy: `docs/planning/EXECUTION.md`. Validation: `docs/planning/VALIDATION.md`.
- Masters message each other via Orca: `orca-ide terminal send --terminal <peer-handle> --text "<msg>" --enter --json` (peer handles in `docs/planning/AGENTS.md`). Keep messages short and point to files for long content. Read the peer screen with `orca-ide terminal read --terminal <peer-handle> --screen --json`.
- Orca CLI: use `orca-ide` (never bare `orca`). Run `orca-ide skills get orca-cli` and `orca-ide skills get orchestration` to load the guides.
- Workers: launch with `orca-ide orchestration worker-start` (or `orca-ide worktree create --agent ...` for isolated checkouts). Claude workers: `--agent claude --model claude-opus-5-5`. GPT workers: `--agent opencode --model openai/gpt-6.1-sol`.
- Cross-model review: Claude-authored work is reviewed by a GPT agent, and GPT-authored work by a Claude agent.
- Commit often on feature branches; merge to `main` only after cross-model review passes.
