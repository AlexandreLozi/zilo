# Terminal handles and Run IDs (masters, liaison)

| Role | Model | Handle |
|---|---|---|
| Opus master (overall orchestrator, front end/design) | Claude Opus 5.5, high | term_4adb20f8-6a8a-431f-8637-e509bd21d47d |
| GPT master (back end orchestrator) | GPT Sol 6.1 (opencode; variant shown as medium, reasoningEffort=high set in opencode.json) | term_f50e1b0a-5dca-4520-90a1-ed67c819629d |
| Owner liaison (owner's single contact; see OWNER-DIRECTIVES.md) | Claude Opus 5.5 | term_9eb0634f-186a-4ecb-a9ca-bfb2bc70f7a3 |

Message the peer: `orca-ide terminal send --terminal <handle> --text "<msg>" --enter --json`
Read the peer: `orca-ide terminal read --terminal <handle> --screen --json`
Handles are runtime-scoped. After an Orca restart, re-discover them with `orca-ide terminal list --worktree path:/home/alexandre/PersonalProjects/zilo --json` and update this file.

## Backend Run

- Name: `zilo-be`
- Run ID: `run_a2415f299b69`
- Coordinator: GPT master; consume only this Run's inbox.

## Frontend Run

- Name: `zilo-fe`
- Run ID: `run_0e7be3212f99`
- Coordinator: Opus master (also owns the merge queue); consume only this Run's inbox.
