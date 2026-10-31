# Master agents (Orca terminal handles)

| Role | Model | Handle |
|---|---|---|
| Opus master (overall orchestrator, front end/design) | Claude Opus 5.5, high | term_3f5addf7-4c0b-4759-b28a-deb782b39d37 |
| GPT master (back end orchestrator) | GPT Sol 6.1, high (opencode) | term_8b4c1bbe-bcd7-44ca-890d-761db2178e70 |

Message the peer: `orca-ide terminal send --terminal <handle> --text "<msg>" --enter --json`
Read the peer: `orca-ide terminal read --terminal <handle> --screen --json`
Handles are runtime-scoped. After an Orca restart, re-discover them with `orca-ide terminal list --worktree path:/home/alexandre/PersonalProjects/zilo --json` and update this file.
