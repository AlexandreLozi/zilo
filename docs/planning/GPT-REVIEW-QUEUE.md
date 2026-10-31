# GPT review queue for resume (prepared by Opus, 2026-10-31)

Order and suggested efforts follow OD-3 and the liaison's request. Every item is Claude-authored, so
a GPT (opencode) reviewer is mandatory.

**Mechanics** (EXECUTION §2.3):
- One reviewer Task per item.
- The review branch is `<task>-review-r1`, based on the author head below.
- The reviewer writes only `docs/reviews/<task>-r1.md` plus new failing tests, then sends
  `worker_done` with a verdict of `pass` or `changes`.
- For an effort other than the workspace default (`medium`), set the effort per OD-3: pre-create the
  worktree, make a local `opencode.json` edit, run `git update-index --skip-worktree opencode.json`,
  then check `launch.effective`.
- Who dispatches: the FE-lane items (T04a, T05, T01) go in the Opus Run `zilo-fe`. The BE-lane items
  (T10, T03, T12-proto) go in the GPT Run `zilo-be`, or the GPT master asks Opus to dispatch them.

| # | Item | Author head (branch) | Review spec | Effort | Notes |
|---|---|---|---|---|---|
| 1 | **T10 contract ★** + the SP-1a interim note it depends on | `5410735` (`t10-contract`); interim `8cbc264` (`t01-transport-spike`) | `docs/tasks/T10.md` + DISCUSSION "[Opus] Master input on T10" | high | Both masters must approve in the review record. It also decides D-004a, which needs GPT approval. |
| 2 | **T01 SP-1a** full spike | `b4e14e1` (`t01-transport-spike`) | `docs/tasks/T01.md` | high | Recommends S2 for Safari. Real Safari is pending. Windows rows were observed before OD-6. |
| 3 | **T04a** web scaffold | `1842f4e` (`t04a-web-scaffold`) | `docs/tasks/T04a-review.md` | medium | The earlier reviewer `ctx_6f602d7fa893` was abandoned during the outage. Re-dispatch the ready Task `task_cc19d0403fad` or create a new one. |
| 4 | **T05** design spec | `d667952` (`t05-design-spec`) | `docs/tasks/T05.md` | medium | The copy hand-offs from T10 are applied in T05's fix round. |
| 5 | **T03** SP-4a packaging | see EXECUTION §4a | `docs/tasks/T03.md` | medium | In progress (Claude, dispatched during the gap). |
| 6 | **T12-proto** page generator | `0afb9c4` (`t12-proto-pages`) | `docs/tasks/T12-proto.md` | medium | In progress (Claude, dispatched during the gap). |

**Also waiting for the GPT master:** approvals of D-004a and D-010b, an acknowledgement of D-011
(OD-6), and the T02 finish plus its Claude review (GPT lane).
