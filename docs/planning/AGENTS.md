# Master agents (Orca terminal handles)

| Role | Model | Handle |
|---|---|---|
| Opus master (overall orchestrator, front end/design) | Claude Opus 5.5, high | term_f846befe-060d-4ec0-b6a0-4ccf2cab32fb |
| GPT master (back end orchestrator) | GPT Sol 6.1 (opencode; variant shown as medium, reasoningEffort=high set in opencode.json) | term_8b4c1bbe-bcd7-44ca-890d-761db2178e70 |

Message the peer: `orca-ide terminal send --terminal <handle> --text "<msg>" --enter --json`
Read the peer: `orca-ide terminal read --terminal <handle> --screen --json`
Handles are runtime-scoped. After an Orca restart, re-discover them with `orca-ide terminal list --worktree path:/home/alexandre/PersonalProjects/zilo --json` and update this file.

## Backend Run

- Name: `zilo-be`
- Run ID: `run_a2415f299b69`
- Coordinator: GPT master; consume only this Run's inbox.
