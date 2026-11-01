# T12-proto — independent GPT re-review r2

**Verdict: pass**, bounded to the standalone prototype at exact author HEAD
`574aa2c25167eb7e1794267f226f3d70546842ea` (2026-11-01).
No new blocking finding or failing regression was identified. This is not production T12,
backend/API approval, cross-platform certification, or physical-scanner evidence.

## Scope and authority

Read `CLAUDE.md`, `docs/context/BRIEF.md`, `docs/tasks/T12-proto.md`,
`docs/reviews/T12-proto-r1.md`, D-007, and main's
`docs/tasks/T12-proto-fix-r1.md` and owner directives OD-3/6/7. Main was
`0bf58e25c0898d4385a298c1f0e764b1618022d4` when read.
Reviewed the complete six-file delta `dd9a1eb..574aa2c` and affected settings,
rendering/encoding, verification, test, and device-descriptor invariants. No full-repository
audit, helpers, hosted reruns, browser, or native Windows execution was used.
Validation owner: GPT coordinator; author fixes/integration owner: Opus.

Requested effort was **medium**. Local `opencode.json` specifies
`reasoningEffort: medium` and build variant `medium`, but orchestrator variant `high`.
Read-only `orca-ide orchestration worker-show --dispatch ctx_f5c436f16f0e --json`
returned `launch.effective.model: null` and `launch.effective.effort: null`.
Consequently medium is configured/requested, **not independently confirmed as the effective
provider effort**; no configuration was edited to hide that uncertainty.

## Every r1 finding reconciled

| r1 finding | Fix and independently observed evidence | Resolution |
|---|---|---|
| M1: trailing LF accepted, invalid QR JSON | `Settings.cs:39-46` now uses strict `\A…\z`. `PageGenerator.cs:29-34` validates before direct payload interpolation. The fixed finite ASCII alphabet excludes JSON metacharacters/control characters. The explicit LF rejection test passes, as do five invalid-ID cases and the 16-candidate accepted-or-rejected theory, including CRLF, embedded controls, quotes, backslash, Unicode, empty and 41-character IDs. Accepted cases decode the actual generated PNG QR and parse JSON with the original job ID. | Closed |
| M2: `int.MaxValue` iterator wraps | `Settings.cs:108-112` yields the final page, then exits **before** increment; zero yields none, negative counts reject on enumeration, and all nonnegative int counts remain lazy without an arbitrary page cap. The original maximum-count reflection regression passes, plus counts 0/1/2/5 and negative-count coverage. | Closed |
| L3: verifier accepts missing IEND | `PngDecoder.cs:41-79` bounds chunk slices, requires IHDR first, IDAT presence and final IEND with no trailing bytes; `:84-96` checks row/buffer arithmetic and translates short image data. The original removed-IEND test and eight corruption cases pass. Reader and README now explicitly limit it to trusted generator verification, not untrusted PNG ingestion. | Closed for the requested verifier scope |

The author changed an existing r1 fact into the 16-candidate theory. This is justified:
the old test deliberately called `Validate()` expecting the previously accepted LF case;
after correct rejection it would fail before reaching its QR assertion. The separate LF
rejection regression remains, so the property was not simply removed. The maximum-count
test remains white-box/compiler-iterator dependent: it advances the private counter near
the end rather than actually producing two billion pages; source inspection independently
confirms the exit placement.

## Rendering/security/scope checklist

- **Hostile/huge settings:** `Generate` validates settings, positive page index, enum side,
  and duplex/back compatibility before allocating a raster. DPI is 75–600, paper/mode/source
  are closed enums, and the anchored bounded job-ID pattern cannot accept an arbitrarily
  long string. No arbitrary paper dimensions enter this boundary. The largest supported
  page remains Legal 600 DPI, 5100 × 8400 pixels, with a 128,520,000-byte RGB raster before
  additional encoder buffers. This is a finite per-page bound, **not** a measured memory
  budget, concurrency limit, aggregate job limit, deadline, or cancellation guarantee.
  Huge rejected inputs and maximum-size allocation were assessed from the validation path,
  not stress-tested in this bounded re-review. Caller-side resource policy remains required.
- **Determinism and normalized content:** all 59 golden cases, sample regeneration, repeated
  and eight-way parallel generation pass in the full suite. Existing QR tests decode pixels
  and assert JSON keys/values (job/page/side/DPI/mode/paper/seed), including a five-image duplex
  order. Ruler tests measure actual decoded pixel edges at nine DPIs. The delta changes no
  drawing, font, PRNG, encoder, golden hash, or sample bytes; `git diff dd9a1eb..574aa2c --
  spikes/virtual-pages/samples spikes/virtual-pages/tests/Zilo.VirtualPages.Tests/golden-hashes.json`
  was empty. Thus r1's independent strict sample checks remain applicable without rerunning
  them. Byte goldens are prototype evidence; D-007 production acceptance must compare
  normalized pixels/PDF content and QR/settings, not encoded bytes alone.
- **Truthful modes:** `PngEncoder.cs:20-25,35-50` still emits RGB8 for color, grayscale8 for
  gray, and grayscale1 with fixed Bayer dithering for bw. Passing pixel round trips assert
  RGB identity, luma conversion, and binary black/white with exact pure black/white preservation;
  QR decoding spans all modes/papers at 75/150/300 DPI plus selected other cases including 600.
  Not an exhaustive Cartesian sweep of every integer DPI or every maximum-length metadata case.
- **Device variants:** catalogue/parameter/JSON tests pass for healthy, feeder-empty, paper-jam,
  cover-open, timeout, disconnected, and slow descriptors; zero-page feeder exhaustion is the
  error case. These are unchanged data, not implemented scanner/job failures, sleeps, listeners,
  API endpoints, or evidence of production recovery behavior.
- **Isolation/dependencies:** the six changed files are three prototype source files, its README,
  its existing r1 test file, and the Linux acceptance log. No backend/public model, NAPS2
  integration, new dependency/lock, root configuration, or production T12 was introduced.
  README now explicitly makes T10 authoritative rather than forcing T10 IDs into this regex.
  R1's dependency/license findings remain unchanged; a fresh locked NuGet restore succeeded.
- **Verifier limitation:** checked sizes and CRC checks do not make this a complete PNG validator
  or memory-safe untrusted-input service. For example it does not enforce every legal chunk/header
  combination or an explicit decompressed-pixel budget. That residual limitation is consistent
  with the explicitly narrowed trusted-verifier role; do not export it as an upload boundary.
- **Cross-OS/hardware:** Linux-only evidence. README correctly marks cross-OS identity unverified.
  No workflow was run or unrelated hosted result reused; Windows/macOS prototype runtime
  identity remains pending. Nothing here exercises NAPS2, eSCL, TWAIN/WIA/ICA/SANE, a physical
  scanner, an installer, signing, or SAC. OD-6/7 respected; review-only report is not pushed.

## Actual commands and results

The old r1 `/tmp/opencode/zilo-t02-dotnet/sdk/dotnet` no longer existed: initial `--info`
and restore attempts exited 127, **not** a test failure (the suite never started).
After a single timed-out SDK search, no repeated broad search was made. Downloaded the
official Linux SDK archive into `/tmp/opencode/t12-proto-r2/`, checked SHA-512 against
`https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json`, and extracted
task-private. Archive URL:
`https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-linux-x64.tar.gz`.
Verified SHA-512:
`b7b3d8461cf98b07d2552ce9199702fa3ad010ac2671a5f8cd5136f7534e50f6855ba7bbb02b11494563f1d04156276a31cda1103b900e5eecd0d9473dc7b9c5`.

From the repository root, with no tracked implementation/test/config edits:

```sh
export DOTNET_ROOT=/tmp/opencode/t12-proto-r2/sdk
export DOTNET_CLI_HOME=/tmp/opencode/t12-proto-r2/home
export NUGET_PACKAGES=/tmp/opencode/t12-proto-r2/nuget
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
"$DOTNET_ROOT/dotnet" --info
"$DOTNET_ROOT/dotnet" restore spikes/virtual-pages --locked-mode
"$DOTNET_ROOT/dotnet" test spikes/virtual-pages
"$DOTNET_ROOT/dotnet" test spikes/virtual-pages -c Release --no-restore \
  --filter 'FullyQualifiedName~ReviewR1RegressionTests'
git diff --check
```

| Command/evidence | Actual result |
|---|---|
| SDK info | Linux x64 / Ubuntu 24.04, SDK 10.0.403, MSBuild 18.9.15, runtime 10.0.14; repository pin honored |
| Fresh-cache locked restore | Exit 0; both prototype projects restored |
| Exact requested full suite, **once** | Exit 0; **183 passed, 0 failed, 0 skipped** (Debug, reported 8 s) |
| Targeted r1 regressions, Release | Exit 0; **37 passed, 0 failed, 0 skipped** (reported 168 ms) |
| Whitespace check | Exit 0 |

The existing author log records parent code commit `42ec1c6`; the independent runs above
are at exact requested `574aa2c` and avoid treating that older log as exact-HEAD evidence.
Scratch outputs are `/tmp/opencode/t12-proto-r2/{sdk-info,restore,full,regressions}.log`,
not durable portable artifacts. This committed report is the durable review record.
No new failing tests were warranted; no existing tests or implementation were edited by this
reviewer, and only this report is committed. Production integration, cross-OS identity and
physical-scanner validation remain separate gates, not unresolved r1 blockers.
