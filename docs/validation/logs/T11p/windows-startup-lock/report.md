# T11p Windows startup lock — bounded availability checkpoint

Base: `65be8ce55e3f385509279c8f93ea93ec08149477`.
Production/full-suite checkpoint: `5ce022c0f3180de3712997f16307e70391645d09`.
Final code/test checkpoint: `6adfcd5006fe97c11c40ff3d7627942154d45d47`.
The following evidence-only commit changes no tested code. LOCAL COMMIT / HOLDPUSH.

The coordinator independently confirmed actual GPT HIGH before authoring. Read current main
AGENTS, BRIEF, OD-15/16/17, execution resume board and D-013 (including addendum 3 at main
`2a45c58`), plus `f83a6ec:docs/reviews/T11p-windows-native-run3.md`; no main rebase or write.
Scope is the joint Opus proposal / GPT approval `msg_f532f87f1179`, now recorded in addendum 3.

## Product change and unchanged boundaries

Only adapter startup `OpenLock` waits on native **ERROR_SHARING_VIOLATION (32)**. It uses
`TimeProvider.System` monotonic timestamps, a **2-second total policy budget**, fixed **50 ms**
backoff capped to the remaining budget, and an independent **41-attempt maximum**. The deadline
is checked after sleep, before revalidation, again after revalidation/before acquisition, and
before the existing-file open following CREATE_NEW's file-exists result. Attempts count logical
lock-acquisition attempts (CREATE_NEW, and OPEN_EXISTING if already present), not every native
call. Native syscalls and scheduler latency are not themselves hard-time-bounded; a call admitted
inside the budget can return later. No post-deadline retry is intentionally admitted.

Every attempt revalidates the pinned chain and private root. A successful nofollow, share-0
candidate pins the lock's identity against delete/rename; its owner, strict protected private ACL,
disk type, volume, non-reparse state and single link are checked before ownership transfer,
followed by another chain/root validation. A currently held share-0 file cannot be inspected
through a second handle: security is checked on the exclusive candidate, never bypassed to
obtain availability. Validation failure disposes that candidate and does not retry. Failed raw
CreateFileW calls return INVALID_HANDLE_VALUE, not an owned handle; all temporary validation
handles retain their existing using/disposal paths. Open's outer unwind still releases its pins.

All non-32 acquisition errors, especially **5/access denied**, fail immediately with no pause.
Security/identity validation exceptions also fail immediately, even if their diagnostic happens
to contain a native code. No lock deletion, force-unlock, descriptor repair, authority exposure,
write retry, or interrupted-temp suppression was added. The wait runs during private storage
startup, not inside an authorization monitor. Existing synchronous Open has no cancellation
parameter; no cancellation API or seam redesign was introduced.

Flushes, retained-handle full-path rename, ACL/NTFS checks, lifetime exclusivity and recovery
semantics remain unchanged. No auth/Agent wiring, lifecycle or recovery expansion, dependency,
helper executable, workflow, main write, push, or hosted dispatch. Production files are identical
between `5ce022c` and `6adfcd5`; follow-ups only correct Windows-native assertions to accept
exhaustion of either bound (a sub-millisecond final sleep can exhaust attempts just before the
time deadline) and the preserved file-exists diagnostic if the deadline expires between the two
native acquisition calls. That diagnostic is accepted only after at least two attempts and
elapsed time of at least 2 seconds; 5/access denied and other errors remain forbidden outcomes.

## Evidence matrix (Linux, SDK 10.0.403)

| Evidence | Exact code state | Result | Boundary |
| --- | --- | --- | --- |
| Policy red, stub retained immediate failure | pre-implementation working tree | 5 expected failures, 8 passes | Actual assertions failed for missing wait/backoff/attempt guard; not native proof |
| Initial WindowsConsent targeted | pre-checkpoint implementation | 57 passed, 33 skipped, 0 failed | Pure guards/policy/ABI execute; native Windows explicitly skipped |
| Locked restore | `5ce022c0f3180de3712997f16307e70391645d09` | PASS | No dependency changes |
| Release full-solution build | same `5ce022c` | PASS, 0 warnings / 0 errors | Linux compile, including authored Windows tests |
| Full backend suite, **one invocation** | same `5ce022c` | **306 passed, 47 skipped, 0 failed** | Agent 265/47; Virtual 28/0; Core 7/0; Scaffold 6/0 |
| Final rebuilt WindowsConsent targeted | `6adfcd5006fe97c11c40ff3d7627942154d45d47` | **57 passed, 33 skipped, 0 failed** | Native-only assertion follow-ups compiled; no native execution |

Full-suite evidence is reused for the native-only assertion follow-up, not falsely attributed
as a second exact-head full-suite execution. Product code, all executed Linux test bodies and
the other projects are unchanged. Full-suite skips: Windows-native 33, Darwin-native 12,
Windows-only managed guard 1, Linux setfacl-dependent 1. Web inputs are unchanged; pnpm/web CI
was not rerun and no whole-workspace/web pass is claimed.

The 13 explicitly named policy simulations inject only monotonic clock and delay. They cover
32/backoff followed by success, non-32 immediate failure (including 5), total-budget exhaustion,
a frozen-clock/no-op-delay attempt guard, remaining-delay clamp, slow-attempt budget consumption,
and oversleep prohibiting a new attempt. Their clock throws if wall time is requested. These
exercise the actual production policy, **not Windows CreateFile/security behavior**.

The five intended red failures were the continuous-sharing budget, short-backoff-then-success,
oversleep, final-delay clamp and frozen-clock attempt-guard cases. An earlier stub build exposed
an unread-parameter warning treated as an error; that was corrected before the recorded red run.
One preliminary invocation timed out waiting for the shared lock, not running tests: the compiler
server retained an inherited flock FD. Pinned `dotnet build-server shutdown` released it;
subsequent commands used `flock --close` and `UseSharedCompilation=false`, with no source/config
change for that execution issue.

The final combined local validation used the shared
`flock --close /tmp/opencode/zilo-real-port-tests.lock` for locked restore, Release build, and
full `dotnet test backend/Zilo.slnx -c Release --no-build --no-restore`, exactly once.
Adjacent logs are sanitized to replace checkout/home/SDK paths; numeric operation diagnostics
contain no private paths, origins, SIDs or raw security descriptors. `git diff --check` passed.

## Authored native acceptance, still pending

- A clean store's external share-0 lock handle is released after a fixture-controlled 200 ms;
  **one product Open** must succeed after more than one acquisition attempt. The fixture sleep
  controls the holder, not a harness reopen loop or a pre-open accommodation.
- An external handle remains open throughout one product Open; it must fail closed after error-32
  retries within the policy/attempt bounds (or preserve file-exists at the between-call deadline),
  leave snapshot bytes and temp absence unchanged, retain the lock
  file, and unwind directory pins. The live-other-agent case asserts the same bounded failure.
- The existing process-kill case still performs one immediate strict product Open, without
  harness retry or sleep, and preserves old-snapshot/dirty-temp and unavailable-session checks.
- Success/failure diagnostics report logical attempt count and lock/total elapsed milliseconds.

None ran natively here, and no unsigned code ran on the owner's Windows SAC host (OD-6).
Run 3's holder identity remains **unproven**: descendant and scanner are hypotheses, not a cause
established by this fix. This change addresses bounded startup availability, not diagnosis.

Next: independent narrow Claude review, then **one coordinator-authorized combined Backend
push/run** on the reviewed head. Full T11p/T14 remains held; Windows/native and broader OS
acceptance are not claimed. Write-time no-retry availability before M6, recovery/auth integration,
and the existing Linux carry-forwards remain open.
