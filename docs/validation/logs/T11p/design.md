# T11p Task 0 — proposed exact seam; implementation NOT authorized

## Joint implementation authorization and additional acceptance conditions

Coordinator `msg_3ddcbb31abd1`, backed by Opus `msg_e46ec0affb68`, authorizes implementation
of the exact `bcd027a` design including section9's handle-based Windows primitive, after safe
integration onto main on a new branch. Historical proposal/approval-pending language below records
Task0 sequencing; it is not a claim that implementation or hosted evidence already exists.

1. Production OS/session-ending and installer-upgrade stop must use bounded clean drain. Prove
   Unix SIGTERM launchd/systemd stop and distinguish configured TimeoutStopSec from actual events;
   prove Windows shutdown/logoff lifecycle where available. Hosted three-OS graceful stop must
   produce CLEAN and preserve grants on reopen, while forced kill retains DIRTY. Simulated hook
   tests do not count as actual OS/session events. WM_ENDSESSION tray wiring belongs to T44, not
   this backend change; ask before packaging/lifecycle-path additions. Pending evidence is not PASS.
2. When all four quarantine slots are occupied return local diagnostic code
   `consent-quarantine-full` with actionable trusted remediation: stop the agent, privately archive
   an existing slot without changing ownership/ACLs, then retry confirmed local recovery. Never
   delete evidence automatically or hide this as an unexplained permanently failing reset.
3. T05 copy must distinguish confirmed UNCLEAN recovery (saved blocks retained, grants dropped,
   unsaved intent not recoverable) from CORRUPT full reset (all saved permissions/blocks reset).
   T44 owns trusted action wiring; no idle CLEAN optimization, new HTTP/reset UI or browser input.

Base: `9668b8121fb05cc07aed1fff7af7547ee06ee7b9`; plan and D-013/addendum read in full
from `7d034e7`. Also read CLAUDE, BRIEF, T10, current Consent/Tokens/Agent composition,
AtomicConsent/SecurityInvariant tests, closure report and T24 handoff.
Actual GPT HIGH footer confirmed by coordinator in `msg_f3bdaaec4cfa` and blocking ask reply.
Sole writer, no helpers; this checkpoint changes documentation only. Validation owner is the
author for behavioral evidence, independent Claude HIGH for review, coordinator/Opus for acceptance.

## 1. Recommendation and approval boundaries

Use one bounded asynchronous snapshot writer and an unconditional durable active-session fence.
Every unclean session remains unavailable for non-baked prompts and minting until confirmed local
reset; do not silently discard grants or blocks. This is the originally approved fallback, not an
implementation of the subsequently proposed automatic unclean reconciliation.

Alternatives: a per-mutation intent journal adds format, replay and crash-ordering complexity;
a `no unresolved intent` bit alone is unsafe (counterexample below). Neither is silently adopted.
No extra persisted DenialStreak, prompt history, tokens, families, credentials or document data.
No dependency, HTTP route, SDK surface, tray UI, Core/Virtual/scaffold/packaging/config change.

**Blocking decisions:** (A) blanket dirty-session fail-closed fallback is BE-approved; automatic
unclean recovery remains unapproved; (B) jointly approve exact schema/bounds/seam below, including
`denied` plus cooldown timestamps as state/timestamp metadata; (C) resolve Windows durable namespace
commit proposal in section9 before implementing or claiming a cross-platform durable store. These are not waived by
writing this proposal. No production or test implementation precedes coordinator approval.

### Recovery refinement cannot be inferred from absent intent

Follow-ups `msg_999336e6d406` and `msg_466e18211dc0` require considering permanent-block intent.
Consider durable snapshot generation 7 containing a grant, with an active fence saying no unresolved
restrictive operation. Execution A crashes without a mutation. Execution B immediately blocks in
memory, both the new intent write and snapshot write fail, and then is killed. Both leave identical
disk bytes. Allowing prompts in A necessarily allows prompts in B and loses the user's block.
Even if both failed writes return explicit not-saved, there remains a crash between memory denial
and the first attempted durable intent write. A readback of the old snapshot cannot prove absence.

The unconditional fence distinguishes neither execution and safely denies both. It is established
before any non-baked authority or prompt is usable and is never cleared by individual writes.
This deliberately means an innocent unclean exit also requires explicit recovery. We do not claim
the new `unclean/no-unresolved-intent recovers without reset` test passes under this fallback.
A different protocol must specify its crash window and acknowledgement semantics, not simply add
an intent bit or assume failed writes did not represent a user decision.

## 2. Exact public/internal seam (proposed signatures)

Replace the synchronous `IConsentPersistence.Load/Save` production seam, not wrap disk I/O in it.
All types below live in Security/Persistence unless an existing ConsentStore method is named.

```csharp
public enum ConsentStorageHealth { Starting, Ready, Unavailable, Stopping, Stopped }
public enum ConsentMutationOutcome { Durable, Superseded, FenceCovered, NotSaved, Rejected }
public sealed record StoredConsent(string Origin, string State, bool Baked,
    DateTimeOffset UpdatedAt, DateTimeOffset? CooldownUntil, DateTimeOffset? LastDenied);
public sealed record ConsentSnapshot(long Generation, IReadOnlyList<StoredConsent> Records);
public sealed record ConsentOpenResult(ConsentStorageHealth Health, ConsentSnapshot? Snapshot,
    bool DurableActiveFence, string? DiagnosticCode);
public sealed record ConsentMutationResult(ConsentMutationOutcome Outcome, long Generation);
public sealed record ConsentResetConfirmation(bool UserConfirmedSavedBlocksWillBeReset);
public sealed record ConsentResetResult(bool Succeeded, string? DiagnosticCode);

public interface IConsentPersistence : IAsyncDisposable
{
    ValueTask<ConsentOpenResult> OpenSessionAsync(CancellationToken cancellationToken = default);
    ValueTask WriteSnapshotAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default);
    ValueTask CompleteSessionAsync(long durableGeneration, CancellationToken cancellationToken = default);
    ValueTask<ConsentOpenResult> ResetAsync(ConsentResetConfirmation confirmation,
        CancellationToken cancellationToken = default);
}

internal sealed class ConsentPersistenceCoordinator : IAsyncDisposable
{
    internal ValueTask InitializeAsync(CancellationToken cancellationToken = default);
    // Called only under the shared authorization monitor; memory operations only.
    internal ConsentReservation ReserveLocked(string origin, ConsentDecision? decision,
        bool managed, DateTimeOffset now);
    // Null decision means Remove; carries global + per-origin volatile sequence and completion.
    internal ValueTask<ConsentMutationResult> ObserveAsync(ConsentReservation reservation,
        CancellationToken cancellationToken = default);
    internal ValueTask StopAsync(CancellationToken cancellationToken = default);
    internal ValueTask<ConsentResetResult> ResetAsync(ConsentResetConfirmation confirmation,
        CancellationToken cancellationToken = default);
    public ValueTask DisposeAsync();
}

// New ConsentStore methods; same gate as TokenService, no disk work in getters.
public ValueTask<ConsentMutationResult> GrantAsync(string origin, bool managed = false,
    CancellationToken cancellationToken = default);
public ValueTask<ConsentMutationResult> DenyAsync(string origin, CancellationToken cancellationToken = default);
public ValueTask<ConsentMutationResult> BlockAsync(string origin, CancellationToken cancellationToken = default);
public ValueTask<ConsentMutationResult> RemoveAsync(string origin, CancellationToken cancellationToken = default);
```

`ConsentReservation` is internal volatile data: accepted flag, requested global generation,
per-origin mutation sequence and asynchronous-continuation completion source. Not serialized.
`ReserveLocked` does not start native calls, obtain a disk lock, serialize, or await. Completion
sources always use `RunContinuationsAsynchronously`. No callbacks are invoked under the monitor
except the existing tightly scoped synchronous OriginRemoved→TokenService.RevokeOrigin binding.

Keep synchronous Grant/Deny/Block/Remove only for explicitly in-memory ConsentStore instances.
On a persistence-bound store each throws InvalidOperationException before making any mutation;
no `.Result`/GetAwaiter bridge and no production unpersisted grant bypass. Convert affected
persistence-bound tests/callers to async. In-memory defaults preserve existing pure test helpers.
Persisted production AgentHost cannot opt into the in-memory mode through an HTTP/browser input.

AgentOptions adds `IConsentPersistence? ConsentPersistence` solely as a trusted composition seam;
null means construct the real platform store, not disable persistence. Tests inject an explicit
memory implementation of the async seam or an isolated real directory. AgentHost registers a
hosted consent lifecycle service before accepting requests; initial state denies non-baked prompts,
IsGranted and minting. StartAsync opens/validates/fences before publishing Ready under the gate.
Unavailable storage still permits separately validated baked policy; it never trusts StoredConsent.Baked.
Shutdown first disables mutations/authorization under the gate, then drains outside it. Existing
backend grace is not repurposed as permission to clear an incomplete consent fence.

## 3. Serialized schema, validation and bounds

`consent.json`, UTF-8 without BOM, compact JSON, property names case sensitive:

```json
{"version":1,"generation":7,"records":[{"origin":"https://clinic.example","state":"blocked","baked":false,"updatedAt":"2026-11-02T12:00:00.0000000+00:00","cooldownUntil":null,"lastDenied":null}]}
```

Envelope fields are exactly version, generation, records. Record fields are exactly those shown.
States: `granted`, `blocked`, `denied`; `none` is represented by absence, `pending` is never stored.
Denied records retain lastDenied/cooldownUntil timestamps but **not** DenialStreak. After restart
the volatile streak starts at zero; saved unexpired cooldown still applies. Expired denial records
may be dropped only through the normal durable snapshot writer. No eviction of grants or blocks.
This explicit interpretation of D-013 state/timestamps requires approval before use.

Origins must already equal the existing OriginPolicy exact HTTPS serialized eligible identity;
reject noncanonical spelling, invalid/opaque/loopback origins, duplicate origins and embedded NUL.
Do not canonicalize untrusted disk origins into a new identity. Baked flags are descriptive only:
loaded granted+true cannot become managed or allowed without current OriginPolicy.IsBaked validation.
No persisted baked flag overrides removal/block policy or current installer policy.

- Snapshot maximum **4,194,304 bytes**, checked before reading/deserializing and while encoding.
- Maximum **4,096 records**, origin maximum **2,048 UTF-8 bytes**, JSON depth maximum **8**.
- Positive signed Int64 generation; initial empty snapshot generation **1**; checked increments,
  exhaustion fails unavailable rather than wrap. No per-origin generation on disk.
- All timestamps UTC, representable DateTimeOffset; denied cooldown is >= lastDenied and at most
  24 hours later. Other states have null denial timestamps. Reject duplicate/unknown properties,
  invalid combinations, unsupported version, invalid UTF-8 and trailing material.
- Single writer, at most **64 outstanding operation reservations** (including active operation),
  no Task.Run per mutation, no unbounded queue of snapshot copies or waiting disk calls.
- The queue stores bounded intents/completions, not 64 full snapshots. At most one materialized
  snapshot plus one encoding buffer and one durable-file buffer; O(record limit + queue limit).
- Queue/record/byte admission failure rejects a grant without authority; restrictive operations
  still deny immediately, set sticky Unavailable and return FenceCovered only with durable fence
  proof, otherwise NotSaved. Never silently forget an existing block to admit another origin.
- Existing volatile defaults remain: 3/hour/origin, 10/hour globally, one native prompt, poll
  bookkeeping 256 origins and 2/second; denial history 24h. Persistence must not make unknown
  reads allocate new retained entries. Any configured larger prompt bounds remain finite.
- Fixed bounded diagnostics enum-like codes, no origin/path/token/file-content dumps; at most one
  lifecycle warning plus one transition warning per health epoch (no repeated request logs).
- Fixed files: `consent.json`, `consent.lock`, `session.fence`, one private `consent.tmp` and
  one private `fence.tmp`. The permanent fence contains exactly UTF-8
  `zilo-consent-session-v1\n` (dirty,24 bytes) or `zilo-consent-clean-v1\n` (clean,22 bytes);
  no caller strings, intent fields or origin data. Every transition atomically replaces this file.
  Reset uses at most **4 private quarantine directories**, each at most **4 MiB snapshot +24-byte fence**;
  if all four exist, fail reset and ask for trusted maintenance; do not auto-delete evidence.
  Corrupt oversized source is not read/copied: secure rename may quarantine it only if the slot
  quarantine byte limit permits; otherwise reset fails without touching it.

## 4. Authority and write sequences

There is one monitor, ConsentStore.AuthorizationGate, shared with TokenService and logical response
selection. Disk callbacks and native cancellation callbacks never execute while it is held.
The coordinator owns a latest-desired bounded record map and a volatile per-origin sequence.
Only its writer touches persistence; initialization/reset/shutdown are mutually exclusive epochs.

Grant: under the gate validate health/admission and reserve a generation/sequence; cancel any old
prompt without waiting for callback completion. Retain previous authority (or deny if not granted).
Outside the gate the single writer copies current desired records under a short gate section,
serializes/writes/flushes/replaces outside it, then re-enters and commits grants only when epoch,
origin sequence and desired state still match the acknowledged snapshot. Failure cannot promote
authority. Superseded grants return Superseded and never acquire an authorization instant.

Deny/Block/Remove: under the gate immediately change authority, invalidate pending grants, cancel
the prompt and synchronously revoke all bound token families via OriginRemoved. Reserve the new
desired record/removal; persist outside. Return Durable only on snapshot acknowledgement, or
FenceCovered when the already-durable unconditional active fence guarantees restart denial.
Otherwise return explicit NotSaved and do not claim saved/complete. Sticky failure disables all
non-baked prompts/minting and keeps that fence even if a later write succeeds.

At most one native write/replace is active. A newer restrictive reservation can arrive during an
older grant write: the old bytes may reach disk first but cannot authorize memory; a newer durable
snapshot is never overwritten by an older generation. The still-dirty fence protects a crash
before the restrictive snapshot. Skip/coalesce queued obsolete work only if every completion is
reported accurately against the snapshot actually acknowledged; do not label a stale grant Durable.

Native resolution: keep the existing prompt GUID/id/cancellation identity/expiry checks, then call
the same reservation path. Never apply Granted to memory before the durable acknowledgement.
Denied/Blocked native outcomes use immediate restrictive path. Timeout/closed prompt returns none,
does not become persisted denial, and never revives a superseded prompt.

`IsGranted`, GetAsync/GetResultAsync and response-time checks consult only the hydrated in-memory
map plus health under the shared gate; remove every lazy synchronous Load/Save call in Consent.cs.
Preserve logical commit in AgentPipeline: re-evaluate origin before token and select bytes/headers
under the same monitor;403 removed origin without CORS,401 revoked family with CORS while allowed.
No serialization, await, fsync, file/native lock or HTTP write enters that section.

## 5. Open, ownership, locking and platform primitives

All platform operations are behind an internal handle-owning adapter under Persistence; no external
package or scanner native code. Framework ACL/SID reference assemblies are present in pinned
.NET10.0.14; that is availability evidence, not execution proof. Do not substitute path-only
GetAttributes checks for race-safe open and actual-handle validation.

Roots: Windows current-user LOCALAPPDATA/Zilo; macOS ~/Library/Application Support/Zilo;
Linux absolute XDG_STATE_HOME/zilo, otherwise ~/.local/state/zilo. Reject invalid roots and
relative home paths. Do not chmod/chown unrelated existing ancestors. Newly created ancestors
owned by this initialization get private permissions, and existing insecure store root is rejected.

POSIX: walk components using `openat` with O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC, anchoring all subsequent
names to the retained validated directory descriptor. Use mkdirat(0700), openat(O_CREAT|O_EXCL|
O_NOFOLLOW|O_CLOEXEC,0600), fstat ownership/mode/type/link-count checks on actual descriptors.
Linux may use fd-based statx(AT_EMPTY_PATH) to avoid nonportable struct-stat assumptions; macOS
must use its actual ABI, not Linux layouts. Effective UID must own store dirs/files; directories
exact0700, regular files exact0600, regular file link count1. On macOS reject nonempty extended
ACLs using acl_get_fd/acl_get_entry;0700 alone is not asserted to prove absent ACL grants.
Linux POSIX ACL grants are constrained by the exact0700/0600 mask; any unproven ACL case fails closed.
Acquire flock(LOCK_EX|LOCK_NB) on validated consent.lock and retain its descriptor for the whole
session. A second owner fails unavailable, never deletes/recreates the existing lock file.
Create/flush snapshot temp, fsync(temp), renameat(temp,consent.json), fsync(root directory).
On macOS request fcntl(F_FULLFSYNC) for file persistence; failure is unavailable, not a silently
weaker hardware claim. Revalidate target/root identities around mutation; never follow a stale
temp/fence symlink or unlink an unverified entry. Ancestor replacement cannot redirect openat.

Windows: open every component with CreateFileW(FILE_FLAG_BACKUP_SEMANTICS|
FILE_FLAG_OPEN_REPARSE_POINT), reject reparse attributes on the actual handle, and retain directory
handles without FILE_SHARE_DELETE so validated path ancestry cannot be renamed while in use.
Reject UNC/device/alternate-stream roots, foreign current-user owner, absent/null DACL and broad
inherited allow ACEs. Query owner/DACL from actual handles via GetSecurityInfo; current token SID,
LocalSystem and BuiltinAdministrators are the only permitted allow principals. Create private files
and dirs with an explicit protected DACL, not inherited-then-tightened access. Verify the resulting
handle owner/DACL/type and volume/file identity. Reject unknown/object/callback ACEs rather than
guess their effective rights. Retain exclusive lock handle (share mode0) through clean completion;
never grant delete sharing on ancestry. Temp uses CREATE_NEW and validated protected security attrs.

**Windows primitive research (section9):** FlushFileBuffers(temp) proves a requested file flush, but a
path File.Move/ReplaceFile plus post-check does not by itself prove race-safe durable namespace
commit. Candidate MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH) with pinned ancestry must be checked
against its actual same-volume guarantees; WRITE_THROUGH copy/delete documentation is not a proof
of persisted directory-entry replacement. Handle-relative NtCreateFile/FileRenameInformationEx
requires correct structure/semantics and a supported flush ordering, not an invented directory
FlushFileBuffers guarantee. Section9 proposes a documented WRITE_THROUGH handle-rename/file-flush
path without directory flush or unlink; BE accepts it as a bounded ordered-flush/process-crash path,
pending joint implementation approval. Do not implement a weaker path and call it durable.
Hosted Windows path/ACL/crash evidence is required after implementation.

Session lock acquisition is nonblocking. File operations run on one owned worker (potentially
blocking native syscalls, never the authorization thread); no timeout abandons ownership and
launches another writer. External shutdown waits at most **5 seconds**; if work is still pending,
retain fence and handles until actual completion/process exit and report incomplete shutdown.
No unbounded thread-per-request workaround for stalled filesystem operations.

## 6. Fence, clean shutdown and failure table

Open under lifetime store lock: validate root/metadata/fence/temp identities and privacy. A fresh
store means both snapshot and marker are absent and neither temp nor quarantine evidence exists;
the retained consent.lock is not interrupted-state evidence. Never infer fresh from missing snapshot
alone. For a genuinely new store durably create **dirty marker first**, then empty version1/generation1
snapshot; only then publish Ready. An interruption after either temp creation, marker replacement,
file flush or snapshot replacement leaves dirty marker/temp evidence and cannot auto-resume prompts.

For existing stores require both valid snapshot and exact marker, and no unexplained temp. Clean
marker permits startup, not authority yet: atomically replace it with dirty using the same ordered
flush/rename primitive, then install hydrated state and Ready under the authorization monitor.
Any prior dirty marker is unresolved: Unavailable; no grants, prompts, non-baked minting or automatic
metadata reset. Missing/unknown/corrupt marker with an existing snapshot is unavailable, never clean.
Failed marker creation/replacement/flush leaves unavailable; no stored grant is usable in that
interval. Stale consent.tmp/fence.tmp is never promoted/deleted merely because its name is expected.
An explicit confirmed recovery may preserve a validated snapshot's restrictive state as section7
describes; the normal startup path never performs that recovery without confirmation.

Shutdown: under gate set Stopping, invalidate prompt/grant epochs and reject new reservations;
outside gate cancel prompt work, drain every accepted mutation, require no sticky failure and exact
durable-generation acknowledgement. Only then atomically replace dirty marker with the exact clean
marker and complete its ordered file/namespace flush; finally release lock/handles. Cancellation,
failure or unknown completion leaves dirty state, or an uncertain marker transition that is never
reported successful. No grant acknowledgement or best-effort Dispose is permitted to mark clean.
Once stopped no late continuation can publish Ready or authority. The marker is never cleared by
unlink, and no directory FlushFileBuffers is assumed on Windows. POSIX retains directory fsync.

| Failure/crash point | Current-process behavior | Reopen behavior |
|---|---|---|
| Missing new store, before initialization finishes | No non-baked authority/prompt | Initialize only if no interrupted-state evidence; otherwise unavailable |
| Invalid/oversize/foreign/symlink snapshot | Unavailable, baked policy independent | Same; no automatic discard |
| Fence creation/flush fails | Never publish Ready | No grants until safe initialization/recovery |
| Kill after fence durable, before grant hydration | No grant was published | Dirty → no prompt/no mint |
| Grant temp/write/flush/replace fails | No promotion, sticky unavailable | Dirty → no prompt/no mint |
| Block memory deny, failed persist, kill | Deny immediately; FenceCovered iff proven fence | Dirty → **no prompt/no mint**, including old grant snapshot |
| Restrictive write before memory completion / late old grant | Already denied, sequence guard rejects stale grant | Dirty → no prompt/no mint |
| Write durable, kill before memory commit | No pre-ack promotion | Dirty → no prompt/no mint |
| Clean drain/clean-marker replacement succeeds | Stopped, no late commits | Valid saved grants/blocks load after new dirty marker |
| Shutdown cancellation or pending/faulted write | Do not clear fence | Unavailable |

The guarantee is ordered requested durable writes plus tested process-crash behavior. Simulated
flush failure and subprocess kill are not proof of sudden power-loss behavior on arbitrary disks.

## 7. Cancellation and trusted local reset protocol

Cancellation before admission has no effect; after a restrictive reservation denial is irrevocable
by caller cancellation. An observer may stop waiting, but the one owned write is still observed.
Cancelling an admitted grant invalidates its sequence before any late memory promotion; an already
physically written grant must be followed by durable removal before the fence may become clean.
If cancellation races an already committed grant, return the actual completion rather than pretend
it was undone. Do not pass arbitrary request cancellation through to half-completed atomic replaces.
Lifecycle cancellation never means the disk operation or owned file lock disappeared.

Reset is called only by trusted in-process native composition (T44 later), with explicit confirmation
that **saved blocks may be reset** when damaged metadata cannot safely reconstruct them (T05 owns
final warning copy). `UserConfirmedSavedBlocksWillBeReset=false` returns refused without any filesystem
mutation or enabling prompts. No HTTP endpoint, SDK method, environment reset switch or UI.

Two confirmed recovery branches share the same seam and sequence:
- **Unclean, otherwise validated snapshot:** quarantine the prior evidence, reconstruct saved
  `blocked` records (and still-applicable denied cooldown timestamps), and **drop every saved grant**.
  An unsaved restrictive intent cannot be recovered from these bytes: trusted warning copy must
  distinguish **durable saved blocks retained** from **unsaved decisions not recoverable**. This is
  a user-confirmed recovery decision, never inferred consistency or automatic re-prompt. Saved
  blocks are not needlessly erased. T05 supplies final copy and T44 wires the trusted action.
- **Corrupt/unreadable metadata in an otherwise trusted private path:** only where files can be
  safely quarantined, preserve the damaged evidence then start empty; saved blocks cannot be claimed
  recovered. An unreadable file that cannot be safely preserved makes reset fail. Do not treat
  foreign ownership, broad ACLs, symlink/reparse paths or unverifiable identity as resettable damage.

With true: deny non-baked authority and advance/reset epoch under gate; cancel prompts outside gate;
retain exclusive store lock; drain writer or fail unavailable. Revalidate root and candidate handles.
Create a private quarantine directory using the first free fixed slot0..3. Durably establish an
dirty marker before moving any metadata. Rename only the validated regular private
snapshot into quarantine via anchored operations; duplicate validated fence evidence into a private
quarantine file, **never remove the active root marker**. Preserve privacy and flush quarantine/root.
Never follow/move a symlink or copy attacker target bytes. Keep the active root fence throughout
reset, durably replace the snapshot with the selected restrictive-only or empty state, and verify
that dirty-marker durability remains established. Only then publish the selected Ready state.
A kill at any reset checkpoint leaves dirty marker or interrupted-initialization evidence, so
reopen cannot silently start prompts.
The fresh active fence remains dirty until the subsequent clean shutdown, including after reset.

Interrupted or failed quarantine/new snapshot/fence operation leaves no authorization, no prompts,
and no automatic follow-up reset. A reset may recover corrupt-but-private data; it never silently
repairs foreign-owned/insecure/reparse roots or modifies unrelated parents. A user/administrator
must remediate untrusted path ownership separately. Quarantine is evidence, never an alternate source
of authority; stale candidates are not merged. No reset success until every required flush succeeded.

## 8. Evidence plan and gates (no tests run/changed at Task 0)

After exact approval only: write behavioral failing tests for restart grant/block and corrupt/missing
distinction first; record real assertion failures (not compile errors), implement narrow store units,
then controlled barrier/race tests and integration. Existing AtomicConsent gated synchronous fake is
replaced by an async controlled writer test; ordinary synchronous no-store tests remain conformance.

Required barriers: native write/flush/lock stalled while another thread acquires the authorization
monitor, reads consent and commits unrelated authorization; grant ack versus newer Block/Remove;
prompt result versus timeout/cancel/reset epoch; startup fence before publication; all mutation queue
bounds and full-record admission without block eviction. No sleep-based proof of ordering.

Crash subprocess: real temporary private directory and controlled crash checkpoints after temp open,
partial write, file flush, replace, directory flush, fence creation/flush, before memory commit,
failed Block/Revoke persistence then kill/reopen, and every reset boundary. Test all reopen states
and preserve403/noCORS versus401/CORS logical response regression evidence. A real HTTP restart
fixture must use production persistence composition, not an in-memory authority bypass.
Explicit negative test: each synchronous Grant/Deny/Block/Remove helper on a production persistence-
bound ConsentStore throws before changing state, opening a prompt, minting a token or scheduling a
write; only the async durable path can produce a non-baked production grant. No test-only route or
constructor overload may disable persistence in a production AgentHost.

OS tests: absolute/relative XDG fallback, exact-origin identity, POSIX owner/mode/hardlink/symlink/ACL
and ancestor/target replacement, retained lifetime lock plus process exit, Windows owner/SID/DACL/
reparse/null/inherited-ACL attacks and post-replace privacy. Skip only genuinely platform-inapplicable
cases; inability to exercise a required target primitive remains pending, not cross-OS PASS.

Final after writer reconciles: pinned `/tmp/opencode/t12-proto-r2/sdk/dotnet` locked solution restore,
Release build/test, bounded self-test, unchanged API contract check, diffcheck. Commit/push coherent
milestones with actual red/green logs. Existing ci-backend only; ask before workflow changes. Hosted
Windows/macOS/Linux on exact resulting code SHA, one bounded run, no owner SAC execution or D-012
star reuse. Report <=100 lines with exact tested SHA/run IDs and unresolved gates. Combined Claude
HIGH, Opus queue and exact-resulting-SHA star CI remain external; no full T11 PASS or merge.

## 9. Bounded official-Microsoft research update (Task 0 only)

Coordinator authorized max10min research after checkpoint `fb0fd1a`; no code/test/native execution.
Retrieved 2026-11-02; the sources below are Microsoft API documentation, not community Q&A.

| Source | Documented guarantee and relevant limit |
|---|---|
| [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) | OPEN_REPARSE_POINT opens the link itself; it is not an all-ancestor nofollow promise. Pin/check components individually. WRITE_THROUGH requests NTFS metadata flushes, explicitly including rename changes resulting from the request. Hardware write-through support is not universal. |
| [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle) + [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) | Operates on the actual source handle; FileRenameInfo replaces existing destination when requested, and RootDirectory can anchor a relative target. This supplies a single rename request without a copy/delete fallback; these pages do not constitute a formal crash/power-loss atomicity guarantee for every filesystem. |
| [File caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching) | Metadata is always cached; flush the file or open WRITE_THROUGH to store metadata changes. NO_BUFFERING alone is not a metadata-flush guarantee. |
| [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) | Flushes buffered information on the specified file handle with GENERIC_WRITE; volume-wide flush requires administrator privileges. No assumed directory-flush guarantee and no privilege escalation. |
| [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw) | WRITE_THROUGH says the operation waits until actually moved on disk; its explicit flush explanation is copy/delete. COPY_ALLOWED permits a non-rename fallback. Do not use COPY_ALLOWED or infer more than documented. |
| [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew) | REPLACEFILE_WRITE_THROUGH is **unsupported**. ACL merge-ignore flags may fail to preserve ACLs; partial-failure cases can leave changed names. Not the proposed primitive. |
| [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo) | Reads owner/DACL from a handle with READ_CONTROL, but explicitly does not handle concurrent security-descriptor changes. Handle anchoring is necessary, not magic ACL-change synchronization. Any query/change uncertainty fails closed; no claim against excluded same-user malware/admin capability. |

**Recommendation for approval:** use retained CreateFileW handles with OPEN_REPARSE_POINT,
WRITE_THROUGH, explicit protected security attributes and DELETE|GENERIC_WRITE|READ_CONTROL as
needed; pin/validate ancestry and keep source handle open. Write private temp → FlushFileBuffers →
SetFileInformationByHandle(FileRenameInfo, ReplaceIfExists=true, RootDirectory=validated root,
simple fixed destination) → FlushFileBuffers on the still-open renamed source handle → verify its
identity/ACL. Target local NTFS only until another filesystem is positively evidenced; unsupported
filesystem/operation is unavailable, never a silent copy/delete fallback. No NO_BUFFERING sector
alignment complexity, unsupported ReplaceFile WRITE_THROUGH, volume flush or admin requirement.
Directory handle access/share flags must permit the internal target relative open; hosted tests
must catch self-conflicting handles, not paper over them with FILE_SHARE_DELETE on ancestry.

**Reconciled fence refinement, joint approval required:** replace the Windows unlink-based fence clear
with a permanent `session.fence` containing exactly either `zilo-consent-session-v1\n` (dirty,
24 bytes) or `zilo-consent-clean-v1\n` (clean,22 bytes). Replace that file through the same flushed
handle-rename helper, never clear it by delete. Unknown/missing marker in an existing store is
unavailable. Startup replaces clean with dirty before publishing stored grants; clean shutdown
replaces dirty with clean only after draining all writes. Reset preserves dirty throughout and
quarantines a validated copy. Initialization writes dirty before empty snapshot; any interruption
leaves fail-closed evidence. This is two fixed marker values, no intent journal or extra user data.
Sections3/6/7 now use the same marker representation on POSIX for one shared state machine,
retaining POSIX directory fsync. This documentation reconciliation is not implementation approval.

This meets the coordinator's clarified *ordered flush requests + single namespace operation +
process-crash evidence* target as a proposed implementation path, not an observed Windows result.
Native structure layout/access/share compatibility, actual ACL preservation, atomic reader and
kill/reopen behavior still require hosted Windows tests on the resulting SHA. No claim of formal
hardware-power-loss proof, no new filesystem support promise, and **implementation remains paused**.
