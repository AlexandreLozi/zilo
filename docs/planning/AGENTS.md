# Master agents (Orca terminal handles)

| Role | Model | Handle |
|---|---|---|
| Opus master (overall orchestrator, front end/design) | Claude Opus 5.5, high | term_006dd637-4cb8-471e-8edf-d2a39d212b81 |
| GPT master (back end orchestrator) | GPT Sol 6.1 (opencode; variant shown as medium, reasoningEffort=high set in opencode.json) | term_b26f83ad-35e1-4ba0-84bb-5c9bbcec4edd |
| Owner liaison (owner's single contact; see OWNER-DIRECTIVES.md) | Claude Opus 5.5 | term_3e2987c0-f472-4f48-9eca-465441bc60b9 |

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
