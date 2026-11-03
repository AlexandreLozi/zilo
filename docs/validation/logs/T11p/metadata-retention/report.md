# T11p retained metadata — bounded correction, authorization still UNACCEPTED

- Starting clean checkpoint: `d8e038aeeb2845f7a79a65c0453be383aa7f5fcd`.
- Exact tested source/test commit: `efd6913ecebe6f52985de68ac10018ef7d8218fd`.
- This report/log commit is evidence only; **new work LOCAL COMMIT / HOLD-PUSH**.
- Task `task_9c39f7a8fa23`, dispatch `ctx_c24b0acd848b`.
- Publication provenance correction: coordinator `msg_f2c80d484c49` reports the liaison externally
  pushed baseline d8e038a during the pause. It remains unwired/unreviewed authorization WIP, **not
  accepted**. Earlier LOCAL-only statements describe their historical checkpoints; they do not assert
  that baseline is still unpublished. This worker did not push, fetch/rebase or invoke hosted CI, and
  no automatic baseline CI is substituted for evidence/review of this metadata correction.

## Requirements and jointly approved bounds

Read approved `design.md:152-189`, `201-226`, `338-346`, and `docs/tasks/T11p.md:75-91`:
4096 snapshot records; 64 outstanding reservations **including active writes**; no grant/block eviction;
no unknown-read authority entries; preserved prompt budgets and denial cooldown/history. Expired saved
denials may only be removed through normal durable writes, not by silently evicting their memory record.

Plan sent before production edits in `msg_7a565b608495`. GPT approval `msg_828851c9b5c2` and Opus
coapproval `msg_0a4acaf1b545` were relayed in `msg_3547a222fe56` before implementation. The caps are
derived internal bounds for persistence-bound composition, not new API/status contracts or a D-013
amendment:

| Retained structure | Bound and reason |
| --- | --- |
| Desired persisted records | **4096**; admission checks before a new record; oversized Open rejected before hydration |
| Owned reservations, pending plus in-flight | **64**; one bounded set replaces the old counter; pending and active batch are subsets |
| Pending reservations | **64**, a subset of owned; no per-origin history is hidden in another unbounded map |
| ConsentStore entries | **4160 = 4096 + 64**; saved authority plus finite volatile/admitted headroom; checked before a new entry |
| Origin sequences | **8320 = 4096 + 4160 + 64**, conservative union of desired/live-entry/owned-origin sets; explicit admission guard before inserting |
| Existing poll bookkeeping | **256** origins, with existing 2/sec behavior; unknown reads allocate no authority entry |
| Existing prompt queues/history | Default 3/hour/origin, 10/hour/global, one active prompt, 24h denial history; configured larger finite limits remain finite and are not reset to admit another origin |

The 8320 union bound deliberately overcounts overlapping origins. A real Store state at that cap is not
claimed reachable: saved origins normally already have entries and active origins overlap those sets.
Tests exercise the production pure admission guard at 8319/8320/8321 without fabricating such a state
or labeling that seam evidence an authority-state reproduction. These are cardinality proofs, not a
heap-byte, latency, throughput or wall-clock benchmark claim. Unbound legacy composition is unchanged.

## Reproduced defects and correction

Before production changes, five deterministic cases failed:

- 8330 unknown-origin Removes retained **8330 empty Store entries and 8330 sequence tombstones**.
- At the 4096-record limit, 512 rejected grants retained **4608 Store entries**, rather than 4096.
- Holding one write and filling 64 reservations, 2048 rejected grants left **2112 entries**, not 64.
- 4096 saved policies plus 64 recent closed prompts admitted a 4161st entry instead of rejecting it.
- Delayed old grant acknowledgement/cancellation plus a newer Block and rejected-origin churn left
  **1087 empty entries** after the final Remove, preventing pruning/reuse assertions from completing.

A later focused RED also showed that an Open provider returning 4097 records published Ready; the
coordinator now checks cardinality before populating desired state or hydrating entries. The provider
fixture is deliberately oversized; this is defense at the coordinator boundary, not a native-file claim.

Implementation is confined to `Consent.cs` and `ConsentPersistenceCoordinator.cs`:

- Bound mode admits new entries only after checking capacity and accepted persistence reservation.
  Failed grants create no empty entry; unknown Remove allocates no Store entry. Invalid bound prompt
  origins use existing consent-denied handling before allocation; no HTTP pipeline/status contract changed.
- Existing restrictive state changes still occur immediately. If new restrictive intent cannot fit,
  sticky Unavailable plus the existing durable fence denies non-baked authority, without allocating a
  new entry or evicting saved restrictions. Grant overflow rejects only that grant, preserving existing
  granted authority, saved blocks/denials and pending prompt identity/cancellation.
- The bounded owned-reservation set tracks queued **and in-flight** work. Completion removes ownership;
  failure cleanup completes owned work, including a batch no longer in the pending list.
- Empty entries are pruned only without a live cancellation reference, recent hourly prompt records,
  recent 24h denial history, desired record or owned reservation. Bound-mode generic cleanup no longer
  silently removes saved denials. Granted/blocked/denied/pending entries are not evicted for capacity.
- Sequence pruning requires **no desired record, no live Store entry and no owned reservation**. An
  unfinished grant/cancel callback is represented by ownership. After completion, a late callback
  returns on Completed before reading a pruned sequence.
- Every new reservation and successful cancellation compensation uses the existing globally monotonic
  generation as its origin sequence. Pruning/reuse cannot reset it to one. Generation exhaustion stays
  fail-closed; compensation capacity failure cannot restore desired grant authority or clear the fence.

The new cross-object callbacks are fixed internal in-memory entry-presence/pruning functions, not I/O,
native callbacks or configurable hooks. No await, persistence call or blocking durability wait was added
under the authorization monitor. Prior Stop/Dispose publication, cancellation compensation and atomic
native prompt validation/reservation remain covered. Stop clean-marker completion budgeting is not fixed.

## Evidence and test limits

New `ConsentMetadataRetentionTests` includes real Store entry boundaries 4159/4160/rejected4161,
the separate pure sequence guard boundaries above, protected saved grant/block/denial plus pending-prompt
capacity behavior, 8330-origin removal churn, 24 canceled-grant/removal cycles with no residual metadata,
and explicit owned/pending counts at 64 total / 63 queued while one write is held. Unknown reads and
invalid/rejected mutations cannot increase authority entries; poll metadata remains at most 256.

The delayed-ack case holds an old grant, reserves a newer Block, fills the remaining owned slots with
unknown Removes, floods rejected grants and synchronously forces the old cancellation callback. After
drain and Remove, sequences/entries are zero; a reused origin gets a strictly larger generation and an
old completed callback cannot erase the new saved Block. Pending-prompt preservation is independently
forced at full Store capacity. No unforced stress outcome is called a race reproduction.

One initial new prompt-budget assertion was a test setup error: repeated requests were still inside
the pre-existing 120-second pending/coalescing window, so they correctly returned 202 without creating
new prompts. The controlled clock now advances 3 minutes between actual retries (still within one hour),
and the fourth actual prompt remains rejected. No production timing behavior or budget was weakened.
The original capacity RED occurs before that assertion and remains valid. No existing test was removed,
weakened or skipped to obtain green results.

Pinned SDK `/tmp/opencode/zilo-sdk/sdk/dotnet`: **10.0.403**, with
`DOTNET_ROOT=/tmp/opencode/zilo-sdk/sdk`. All runs held
`flock --close /tmp/opencode/zilo-real-port-tests.lock`, used Release, `--no-restore`,
`-p:UseSharedCompilation=false -nodeReuse:false`; targeted watchdog 90s, final suite 180s.

```text
flock --close /tmp/opencode/zilo-real-port-tests.lock timeout <90s-or-180s> \
  /tmp/opencode/zilo-sdk/sdk/dotnet test <project-or-solution> \
  -c Release --no-restore -p:UseSharedCompilation=false -nodeReuse:false [--filter '<filter>']
```

| Artifact | Observed result |
| --- | --- |
| `red-metadata.log` | Baseline production, five new retention cases: **0 passed / 5 failed**, exit 1; authentic count/capacity failures |
| `first-targeted.log` | Initial correction plus old race sets: **60 passed / 1 failed**, exit 1; new test's coalescing-window setup issue described above |
| `after-targeted.log` | Corrected test schedule, added boundary/capacity/cancel-churn coverage: **67 passed / 0 failed / 0 skipped**, exit 0 |
| `red-open-bound.log` | Additional 4097-record Open case before its cardinality check: **0 passed / 1 failed**, exit 1; Ready instead of Unavailable |
| `final-targeted.log` | Exact final source/test: **68 passed / 0 failed / 0 skipped**, exit 0 |
| `final-backend.log` | One exact final-code `backend/Zilo.slnx` pass: **369 passed / 0 failed / 47 skipped**, exit 0 |

Targeted project: `backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj`. The initial five-case filter
is `FullyQualifiedName~ConsentMetadataRetentionTests`; combined runs OR that substring with
`NativeConsentPublicationTests`, `DurableConsentTests`, `AtomicConsentTests`. The focused Open RED uses
`FullyQualifiedName~Oversized_open_snapshot_is_rejected`.
Final backend breakdown: Agent **328 passed / 47 skipped**, Core **7 passed**, Virtual **28 passed**,
Scaffold **6 passed**. Existing platform/environment skips include Windows/Mac native and unavailable
Linux ACL tooling; no native proof is inferred. Compilation printed no compiler warnings/errors. The
full suite ran once, after all final targeted tests were green; fixture count/ack evidence is not
native crash, power-loss or real OS shutdown proof.

## Authorship / validation ownership

Parent is sole source/test/report author and validation owner and inspected every hunk. Actual current
GPT-6.1 Sol HIGH was coordinator-confirmed before code (`msg_649ccaeac195`, `msg_1d6756859919`). The
requested no-helper preference was not fully met because the higher-priority workflow required one
bounded read-only lane; no helper writer or additional helper ran:

| Lane | Session | Configured versus actual evidence | Scope/status |
| --- | --- | --- | --- |
| Parent | dispatched terminal | System `openai/gpt-6.1-sol`; actual HIGH coordinator-confirmed | Sole author of two source files, new ConsentMetadataRetentionTests, report and generated logs; bounded slice completed |
| Explorer | `ses_e5fc6d92dffeV4Q5ji26z5duxw` | Local preset `openai/gpt-6.1-sol` / high; historical session self-report `openai/gpt-5.6-luna`; **actual helper runtime/model/effort unverified** | Reused approved-doc bounded-metadata requirement recon; completed, **no edited files** |

Configuration stays local skip-worktree/uncommitted; no helper runtime is inferred from configuration.
Working/staged `git diff --check` passed; diffs against accepted native baseline
`99766593f46705812dc8ca9f1ea8438b89181a3c` are empty for Core, API, Agent/startup, native storage
adapters, Windows lock helper, workflows and central build/package inputs. No worker push, hosted CI,
owner Windows-host execution or main-worktree write occurred.

## Availability trade-off and outstanding hold

A distinct-origin flood while hourly prompt/24h denial history is protected can fill bounded headroom:
new grants/prompts then reject, while unrepresentable restrictive intent fences non-baked authority.
It never grants authority, evicts blocks/denials or clears history to make room. Saved denials are not
silently dropped even after expiry; removing them remains a normal durable-write action. This finite
capacity/availability trade-off is explicit, alongside the separate pre-M6 native write-no-retry
availability carry-forward; neither is an unbounded-state escape or a new recovery mechanism.

**Full authorization remains UNACCEPTED and unwired, not full coordinator PASS.** Stop clean-marker
completion budget/concurrency/cancellation is the next separate defect; Dispose can still wait for
blocked work. Agent composition, recovery/quarantine, actual OS lifecycle, platform carry-forwards and
the coordinated exact-head gate remain open. Independent **Claude HIGH whole-coordinator review is
required after all corrections**, before acceptance.
