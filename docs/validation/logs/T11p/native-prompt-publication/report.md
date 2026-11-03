# T11p native prompt publication — bounded fix, full authorization UNACCEPTED

Later bounded correction: `../metadata-retention/report.md` addresses retained metadata and records
that the liaison externally pushed this historical baseline as WIP. New metadata work remains LOCAL
HOLD-PUSH; clean-marker completion and full independent review still block authorization acceptance.

- Starting checkpoint: clean LOCAL `612fc0b33989bb478cfb9bdcb52423083e0ec6c7`.
- Exact tested source/test commit: `eda265ea6dda50f9d64084f3d1cc755e317137af`.
- This report/log commit is evidence only; **LOCAL COMMIT / HOLD-PUSH**.
- Task `task_31f38055b290`, dispatch `ctx_e9e5719b6852`.
- Scope: ResolvePromptAsync identity/deadline/lifecycle validation and mutation reservation atomicity.
  Prior lifecycle and cancellation corrections remain intact; no metadata/drain-budget correction here.

## Reproduction and fix

Previously the resolver validated prompt id/GUID/cancellation reference/active identity/deadline under
the authorization gate, detached that identity, released the gate and then unconditionally called the
public asynchronous mutation path. A newer Block/Remove/replacement prompt could intervene, so the old
completion could grant, deny, block or clear the new state. Stop prevented grant authority but did not
prevent stale restrictive-result revocation callbacks. A deadline could also expire in that gap.

The correction captures prompt id/GUID/cancellation reference and coordinator lifecycle epoch when
creating the prompt. After native completion, under **one short authorization-monitor transaction**:

1. Validate exact current prompt id, GUID, cancellation reference, active GUID and pending state, plus
   Ready health and the captured lifecycle epoch when persistence is bound.
2. Recheck the deadline against current time; an expired current prompt becomes none, never a persisted
   denial. A stale completion makes no change to a newer prompt or desired record.
3. Detach the matched prompt cancellation reference, then apply/reserve the matching decision through
   the same small locked mutation helper used by GrantAsync/DenyAsync/BlockAsync/RemoveAsync.

The lock is released before observing persistence/completion or disposing the prompt cancellation
source. That source is disposed in an outer finally, including stale/exception paths. The test barrier
also executes/awaits outside the gate. In the matched native path the shared helper sees the already
detached cancellation reference, so it does not start prompt cancellation/disposal under the monitor.
Existing synchronous in-memory token revocation notification is preserved, not replaced with new hooks.
Grant remains non-authoritative until durable acknowledgement; Denied/Blocked change current memory
before their persistence wait. Unknown/Pending native completion only clears its own matched prompt.

Production changes are confined to `Consent.cs` and one read-only internal lifecycle-epoch accessor in
`ConsentPersistenceCoordinator.cs`; the accessor is consumed under the existing authorization gate.
No coordinator architecture, recovery, Agent composition, dependency or public API was introduced.

## Deterministic verification affordance

Coordinator approval: `msg_96387983bdbf`, following plan disclosure `msg_2f9005407df8`.
An internal constructor accepts an immutable per-instance optional pre-commit barrier; the unchanged
public constructor always injects null. There is no public setter, static/global hook, runtime setting
or diagnostic endpoint. Friend tests can observe the latest native-resolution Task (one bounded slot,
not task history), await it with the test token and see resolution faults rather than swallow them.

For baseline RED, the barrier was inserted **after the original validation/detachment and before the
unlocked mutation**, without correcting that split. Tests awaited that barrier, committed a newer
restriction/replacement prompt/Stop or advanced a controlled clock, then released the old completion.
For the fix, the barrier precedes the fresh complete identity/deadline/epoch validation and reservation
transaction. It is not inside or between pieces of that transaction. Each test barrier asserts that
the real authorization monitor is not held and bounds its wait with the test cancellation token.

To check that this placement was not creating false confidence, the parent temporarily restored the
old validate-unlock-publish split on top of the refactored code: **the same 15 behavioral failures
returned**. The mutation was then removed; production-source SHA256 values matched their pre-mutation
values (`restoration.log`). The final three positive cases use the public null-barrier path, proving
that normal native Grant/Denied/Blocked completion preserves pre/post-ack ordering without the hook.
The barrier itself is not claimed to be the production path or proof of arbitrary scheduling.

## Tests and evidence

New `NativeConsentPublicationTests` covers:

- Older Granted/Denied/Blocked/Pending/unknown completion after a newer saved Block: block/state and
  persisted record remain intact; no extra stale write.
- The same five older decisions after Remove and a replacement prompt: the new prompt remains pending,
  uncanceled and unmodified; no stale write. This directly forces the Remove/new-prompt interleaving.
- Older Granted/Denied/Blocked completion after Stop: no stale revocation event, write or authority.
- Current Granted/Denied/Blocked completion whose deadline expires at the barrier: none, no write/grant.
- Public-constructor/null-barrier Granted/Denied/Blocked completion with a paused write: no grant before
  acknowledgement; restrictions visible immediately; matching durable snapshot after acknowledgement.

The original 16 forced cases produced **15 failures / 1 pass** before correction. The already-green
case is Granted after Stop, protected by fix1; it is not called new RED proof. The Block-after-Block
case catches the extra stale durable write even though its state label remains blocked. No stress
test, pre-existing unforced test, compile failure, weakened assertion or skip is used as race proof.

Pinned SDK `/tmp/opencode/zilo-sdk/sdk/dotnet`: **10.0.403**, with
`DOTNET_ROOT=/tmp/opencode/zilo-sdk/sdk`. All invocations used Release, `--no-restore`,
`-p:UseSharedCompilation=false -nodeReuse:false` and held
`flock --close /tmp/opencode/zilo-real-port-tests.lock`; targeted timeout 90 seconds, suite 180 seconds.

```text
flock --close /tmp/opencode/zilo-real-port-tests.lock timeout <90s-or-180s> \
  /tmp/opencode/zilo-sdk/sdk/dotnet test <project-or-solution> \
  -c Release --no-restore -p:UseSharedCompilation=false -nodeReuse:false [--filter '<filter>']
```

| Artifact | Observed result |
| --- | --- |
| `red-native-prompt.log` | Baseline split plus approved barrier, `FullyQualifiedName~NativeConsentPublicationTests`: **1 passed / 15 failed / 0 skipped**, exit 1 |
| `after-targeted.log` | First corrected native + DurableConsent + AtomicConsent set: **53 passed / 0 failed / 0 skipped**, exit 0 |
| `mutant-split.log` | Temporarily restored split, original 16 native cases: **1 passed / 15 failed / 0 skipped**, exit 1 |
| `restoration.log` | Final production source matches pre-mutation source hashes; mutation not retained |
| `final-targeted.log` | Restored fix plus three positive null-barrier cases: **56 passed / 0 failed / 0 skipped**, exit 0 |
| `final-backend.log` | One final-code `backend/Zilo.slnx` pass on exact source/test checkpoint: **357 passed / 0 failed / 47 skipped**, exit 0 |

Targeted project: `backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj`; combined filter:
`FullyQualifiedName~NativeConsentPublicationTests|FullyQualifiedName~DurableConsentTests|FullyQualifiedName~AtomicConsentTests`.
The full backend breakdown is Agent **316 passed / 47 skipped**, Core **7 passed**, Virtual **28 passed**,
Scaffold **6 passed**. Existing skips are platform/environment cases (including Windows/Mac native and
unavailable Linux ACL tooling), not newly skipped failures or native acceptance. No compiler warning/error
diagnostics were printed. The full suite was run once, only after the final targeted set was green.

## Authorship / validation

Parent is sole source/test/report author and validation owner, independently inspected every hunk and
reconciled approved native-sequencing requirements. Actual current GPT-6.1 Sol HIGH footer was
coordinator-confirmed before code (`msg_920640d22d05`, `msg_34b0d8406ff0`). The no-helper preference was
not fully met: higher-priority workflow required one bounded read-only lane, reused without a writer:

| Lane | Session | Configured versus actual evidence | Scope / status |
| --- | --- | --- | --- |
| Parent | dispatched terminal | System `openai/gpt-6.1-sol`; actual HIGH coordinator-confirmed | Sole author of the two source files, new NativeConsentPublicationTests, report and generated logs; bounded slice completed |
| Explorer | `ses_e5fc6d92dffeV4Q5ji26z5duxw` | Local active preset `openai/gpt-6.1-sol` / high; historical session self-report `openai/gpt-5.6-luna`; **actual helper model/effort/runtime unverified** | Approved docs-only native prompt invariant recon; completed, **no edited files** |

No helper writer/additional helper ran. Local configuration remains skip-worktree/uncommitted; no
verified helper-runtime model is inferred from configuration or historical self-report.

Working/staged `git diff --check` passed. Source diff checks against accepted native baseline
`99766593f46705812dc8ca9f1ea8438b89181a3c` are empty for Core, API, Agent/startup, native storage
adapters, Windows lock helper, workflows and central build/package inputs. No push, CI, owner Windows
host execution or main-worktree write occurred. Native fixtures and these controlled tests do not
establish native crash, power-loss or real OS shutdown proof.

## Still held

**Full authorization WIP remains UNACCEPTED and unwired, not full coordinator PASS.** Retained metadata
bounds and Stop clean-marker completion budget/concurrency/cancellation remain separate next defects;
Dispose may still wait for blocked work. Agent composition, recovery/quarantine, actual OS lifecycle,
platform carry-forwards and the coordinated exact-head gate remain outstanding. Independent
**Claude HIGH whole-coordinator review is still required after all corrections** before acceptance.
