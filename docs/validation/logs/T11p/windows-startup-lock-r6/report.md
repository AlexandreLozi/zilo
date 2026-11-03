# T11p Windows startup lock — r5 P2/P3 correction

Review baseline: `7f3027ecda26d983b2d4d428def765d23d9f6242`.
Claude r5: `87b4607:docs/reviews/T11p-windows-r5.md` (CHANGES, no security finding).
Exact final production/test checkpoint: `940a9966bd2c2a1742427424d66538cd9efd2c3e`.
The subsequent evidence-only commit changes no production or test source. LOCAL COMMIT / HOLDPUSH.
The coordinator independently confirmed this terminal's actual GPT HIGH before the correction.

## Bounded correction

- **P2:** remove the deadline check between CREATE_NEW's expected file-exists result and
  OPEN_EXISTING. They are **one admitted logical attempt**, not separate retries. The actual
  existing-file lock result now determines success or failure; file-exists cannot substitute for
  a held-lock failure merely because the clock crossed the deadline between the calls.
- Preserve the monotonic 2-second budget, 50 ms fixed/capped backoff, 41-attempt guard, checks
  after delay/before revalidation and after revalidation/before attempt admission, and all
  candidate security/identity validation and disposal. An already-admitted attempt may finish
  after the deadline; there is **no hard native-syscall or scheduler-latency guarantee**.
- Restore the held-lock fixture gate to **exactly `:32`**. Neither `:80` nor `:183` is accepted.
  The existing single-Open external-held-lock and live-agent fixtures are the native regression
  gates for the file-exists/open-existing path. No new injection seam or helper is introduced;
  this slice does not claim a simulated native deadline-crossing reproduction.
- **P3:** raise the brief-holder fixture duration from 200 to **600 ms**, retaining the strict
  single product Open, at-least-two-attempt assertion and elapsed diagnostics. This gives cold
  chain validation more headroom, **not a universal host-speed guarantee**. The fixture controls
  its holder duration; no harness reopen loop or process-kill pre-open sleep is added.
- Align the previous report's product/fixture description and label its old matrix as historical.

No write retry, security/ACL/NTFS/flush/rename/recovery change, authority/Agent integration,
lock deletion/force-unlock/repair, dependency, executable helper, workflow or main write.
Every non-32 acquisition failure still fails immediately; no security failure is retried.
The process-kill test, interrupted-temp checks and all 13 Linux policy simulations are unchanged.

## Exact-head local evidence

All commands below completed successfully on exact final code
`940a9966bd2c2a1742427424d66538cd9efd2c3e`. Pinned SDK: **10.0.403**. One serialized command
sequence held `flock --close /tmp/opencode/zilo-real-port-tests.lock`, used
`UseSharedCompilation=false` for restore/build/targeted compilation, and disabled node reuse.

| Check | Result |
| --- | --- |
| Full-solution locked restore | PASS |
| Rebuilt WindowsConsent targeted tests | **57 passed, 33 explicitly skipped, 0 failed** |
| Full-solution Release build, no restore | PASS, **0 warnings / 0 errors** |
| Full backend suite, no build/restore, **one invocation** | **306 passed, 47 skipped, 0 failed** |

Full suite by project: Agent **265 passed / 47 skipped**, Virtual **28 passed**, Core **7 passed**,
Scaffold **6 passed**. Skips: Windows-native 33, Darwin-native 12, Windows-only managed guard 1,
Linux setfacl-dependent 1. The tightened native assertions compiled but did not execute here;
neither native red/green evidence nor a native fix is claimed. All 13 unchanged deterministic
policy simulations executed as part of the targeted/full runs.

Commands: `dotnet restore backend/Zilo.slnx --locked-mode`, targeted
`dotnet test backend/tests/Zilo.Agent.Tests/Zilo.Agent.Tests.csproj -c Release --no-restore
--filter FullyQualifiedName~WindowsConsent`, `dotnet build backend/Zilo.slnx -c Release
--no-restore`, then `dotnet test backend/Zilo.slnx -c Release --no-build --no-restore`.
Adjacent restore/targeted/build/suite logs replace checkout, home and SDK paths with placeholders.
No previous-head full-suite evidence is substituted for this final-code run; only the later
evidence-only commit reuses it. Web inputs are unchanged; no pnpm/web pass is claimed.

## Remaining gates

No native Windows code ran locally or on the owner's SAC host. Linux policy/ABI/guard execution
is not native lock/security proof. The brief-holder, held-past-bound (exact 32), live-agent and
strict kill-reopen tests still require hosted Windows execution; a descendant/scanner cause
remains unproven. Independent narrow Claude r6 must review this correction before **one
coordinator-authorized combined 4-OS Backend push/run**. Full T11p/T14, the pre-M6 write no-retry
availability item and existing recovery/integration carry-forwards remain held.
