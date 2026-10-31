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

## OD-3 Effort and usage budget
- New **Claude** dispatches run at effort `medium`; ★ tasks run at `high`. `xhigh` is no longer
  the default.
- **GPT/OpenCode** defaults to `medium` (opencode.json, commit eb31440).
- Claude workers that are blocked on BE/GPT work must be stopped, not left looping. A worker that
  has finished and is idle may stay up.

## OD-4 Browser testing
- Use headless browsers only: Playwright headless, or the Orca embedded browser. No visible browser
  windows on the owner's screen. The Playwright CLI and other test tools may be added when needed.

## OD-5 Reporting
- The owner talks only to the liaison terminal. Masters send owner-facing questions to the liaison,
  which relays them.
