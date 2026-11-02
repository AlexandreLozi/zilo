# Terminal handles and Run IDs (masters, liaison)

| Role | Model | Handle |
|---|---|---|
| Opus master (overall orchestrator, front end/design) | Claude Opus 5.5, high | term_1a99c21d-2936-4e31-81eb-2fc395c6b03f |
| GPT master (back end orchestrator) | GPT Sol 6.1 (opencode; variant shown as medium, reasoningEffort=high set in opencode.json) | term_2042e70c-3067-493e-b66f-a46f4c5268bd |
| Owner liaison (owner's single contact; see OWNER-DIRECTIVES.md) | Claude Opus 5.5 | term_692bba74-0afa-4e5f-bca6-11aae0dfdadc |

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
