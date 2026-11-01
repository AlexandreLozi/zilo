# T12-proto — independent GPT review r1

**Verdict: changes.** Author source: `0afb9c446cacc52024bfe8c0be34537648f4ec89`.
Reviewed 2026-10-31 by GPT-6.1 Sol (medium); validation owner: GPT master;
author fixes and merge queue: Opus. Latest-main directives/decisions/plan were read using
`git show main:<path>` with main at `35019a383bc634be98d516c631bebb5940c00d2e`.
Scope: standalone `spikes/virtual-pages/**` and author evidence
`docs/validation/logs/T12-proto/linux.log`, not backend integration or T10 approval.
At completion, re-read OD-7 from main `dc1e2a47aaa5508926d00c1cab349e6baa9031cb`:
the private origin is approved and applicable hosted evidence supersedes local-only gates.
No existing workflow references `virtual-pages`/T12, so unrelated hosted backend successes
cannot establish this prototype's cross-OS identity; no redundant hosted runs were dispatched.
One bounded read-only helper examined codec/provenance and finished before completion;
the reviewer independently checked and selected the findings below.

## Findings

1. **Medium — accepted job IDs can produce non-JSON QR payloads.**
   `Settings.cs:39-44` uses `$`, which in .NET also matches immediately before a final LF.
   Therefore `Job = "job\n"` passes validation, violating the documented character restriction.
   `PageGenerator.cs:25-27` then interpolates the literal LF into a JSON string without escaping.
   Actual PNG generation succeeds, actual-pixel QR decoding preserves that LF, and
   `JsonDocument.Parse` fails with `0x0A is invalid within a JSON string` at byte position 11.
   This directly breaks the acceptance requirement for recoverable JSON metadata, not just a
   cosmetic banner rule. Require strict whole-string validation (or correct serialization plus
   an explicitly revised ID policy). New regressions `Job_id_with_trailing_newline_must_be_rejected`
   and `Every_accepted_job_id_must_survive_pixel_QR_decode_as_valid_JSON` both fail on the source SHA.

2. **Medium — the no-page-limit iterator overflows and never finishes at its maximum count.**
   `Settings.cs:102-106`: with `count = int.MaxValue`, incrementing `i` after the final page wraps
   to `int.MinValue`, which still satisfies `i <= count`; enumeration continues into negative
   page indices and cycles rather than completing. Consumers counting/materializing it can hang
   or exhaust resources; consumers generating its next page instead receive an invalid index.
   Preserve lazy arbitrary-count behavior but make termination overflow-safe; do not solve this
   by introducing an arbitrary prototype page cap. The new maximum-count regression fails
   (`Assert.False`, actual `True`). It advances the compiler-generated loop counter by reflection
   after the first yield to exercise the terminal transition without iterating two billion pages;
   that white-box test is intentionally tied to the current C# iterator implementation.

3. **Low — verification reader accepts a structurally truncated PNG.**
   `PngDecoder.cs:35-61` does not require IEND. Remove the final 12-byte IEND chunk from a valid
   generated image: decoding still succeeds. New regression
   `Verification_decoder_must_reject_missing_required_IEND` fails because no exception is thrown.
   This does **not** show that the generator emits bad PNGs, nor is there a live upload endpoint.
   It means the reader is not a complete PNG validity oracle. Require the structural terminator
   if retaining that role, or explicitly narrow it to trusted verification input and use an
   independent strict validator for output acceptance. Also inspect `:37-40,46-50,66-74` before
   any reuse on arbitrary data: chunk lengths and dimensions are not bounded before slicing,
   unchecked row-size arithmetic and allocation. Do not promote this reader into production
   image ingestion without schema checks, checked sizes and explicit pixel/byte limits.

All source paths above are under `spikes/virtual-pages/src/Zilo.VirtualPages/`.
Findings 1–2 require changes before approval; finding 3 is a bounded tooling-quality issue.
No generator, existing tests, project configuration, locks, README or root files were edited.
The four new tests intentionally remain red for the author to fix.

## Actual Linux validation

Reused the existing task-private Linux SDK at `/tmp/opencode/zilo-t02-dotnet/sdk`, **not** a
Windows executable or a global installation. `dotnet --info` reported SDK **10.0.403**,
MSBuild **18.9.15**, runtime **10.0.14**, Ubuntu 24.04 / linux-x64; the repository SDK pin
disables roll-forward. Official release metadata was fetched from
`https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json` and identifies
the Linux archive at `https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.403/dotnet-sdk-10.0.403-linux-x64.tar.gz`
with SHA-512 `b7b3d8461cf98b07d2552ce9199702fa3ad010ac2671a5f8cd5136f7534e50f6855ba7bbb02b11494563f1d04156276a31cda1103b900e5eecd0d9473dc7b9c5`.
This review did not download/re-hash that SDK archive; it verified the executing SDK version.

Environment and reproducible commands (from repository root):

```sh
export DOTNET_ROOT=/tmp/opencode/zilo-t02-dotnet/sdk
export DOTNET_CLI_HOME=/tmp/opencode/t12-proto-r1/home
export NUGET_PACKAGES=/tmp/opencode/t12-proto-r1/nuget
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
"$DOTNET_ROOT/dotnet" --info
"$DOTNET_ROOT/dotnet" restore spikes/virtual-pages/VirtualPages.slnx --locked-mode
"$DOTNET_ROOT/dotnet" test spikes/virtual-pages/VirtualPages.slnx -c Release --no-restore
"$DOTNET_ROOT/dotnet" test spikes/virtual-pages/VirtualPages.slnx -c Debug --no-restore \
  --filter 'FullyQualifiedName!~ReviewR1RegressionTests'
"$DOTNET_ROOT/dotnet" test spikes/virtual-pages/VirtualPages.slnx -c Release --no-restore \
  --filter 'FullyQualifiedName~ReviewR1RegressionTests'
```

| Run | Actual result |
|---|---|
| Fresh-cache locked restore, author source | exit 0, both projects restored |
| Release baseline before adding review tests | exit 0, **146 passed**, 0 failed |
| Debug author tests after addition, filtered as above | exit 0, **146 passed**, 0 failed |
| Release new regressions only | exit 1, **4 failed**, 0 passed |
| Final complete Release suite | exit 1, **146 passed / 4 failed / 150 total**, no skips |

Transient command output is in `/tmp/opencode/t12-proto-r1/{restore,baseline,regressions,full}.log`.
The committed report and regression file are the durable evidence; no claim that scratch logs
are portable or permanent. The existing author log names earlier SHA `8346132`, so it is not
on its own validation of HEAD; the above runs supply independent HEAD evidence.

## Acceptance checks and limitations

- **Settings / pixels / order:** existing tests really decode generated PNG pixels, not sidecar
  metadata. Passing coverage includes all modes/papers at 75/150/300 DPI, selected 600 DPI,
  flatbed/feeder/duplex and back sides, seed 4,000,000,000, and five-page duplex order.
  The 59-case golden matrix spans every mode/paper/source at 75 DPI and selected sweeps to 600;
  it is not the exhaustive Cartesian product of all integer DPIs. The accepted-LF edge exposes
  a missing validation class despite the otherwise useful tests.
- **Physical geometry:** pixel-edge ruler tests pass for horizontal mm, eighth-inch and vertical
  mm at nine DPIs, with rounding tolerances and exact full-inch spacing. Paper dimensions and
  pixels-per-metre metadata are exercised. Validated settings bound pages to at most Legal at
  600 DPI (5100 × 8400 pixels); RGB raster alone is 128,520,000 bytes, before raw rows and output.
  No arbitrary custom dimensions enter `Generate`. Aggregate pages, concurrency, memory,
  deadlines and cancellation remain the future caller's responsibility, not proof of a bounded
  production scanner. Unvalidated public layout/reader utilities must not be treated as that boundary.
- **Original assets / font:** glyphs are inline 5×7 bitmap data, rendering is integer-based;
  no system-font or external image/font loading was found. Font originality is author-attested
  in source/README, not independently provable authorship merely from inspecting bitmaps.
- **PNG:** independently checked all six committed samples with Python stdlib `struct` and
  `zlib`, not the C# reader: signature; chunk order IHDR/pHYs/IDAT/IEND; every CRC32; allowed
  `(depth,type)` pairs `(8,2)`, `(8,0)`, `(1,0)`; compression/filter/interlace header fields zero;
  full zlib decompression including Adler checksum and EOF; exact row byte counts; filter 0
  on every row. All six pass. Their sizes are 827×1169 (two RGB), 874×1240 (bw), 638×1050
  (two RGB), 1275×1650 (gray). Existing tests additionally verify pixels/luma/dither and
  DEFLATE round trips including empty/noisy inputs. No emitted PNG/CRC/DEFLATE defect found.
- **Failure variants:** descriptors only, with no listener, driver implementation, sleeping or
  job server. Catalogue/parameter tests pass. Do not interpret that as production failure-state
  validation or approval of the draft T10 error semantics.
- **Licenses / pins / provenance:** fresh NuGet restore succeeded in locked mode. Independently
  read all 17 unique restored package nuspecs: Microsoft/System packages MIT, xUnit packages
  Apache-2.0, ZXing.Net 0.16.11 Apache-2.0, matching README. NuGet extraction metadata for every
  locked resolved dependency matches the lock `contentHash` and names
  `https://api.nuget.org/v3/index.json` as source. An initial ad-hoc comparison of raw signed
  nupkg archive SHA-512 to lock content hashes did not match; that is not an established integrity
  defect and is not substituted for NuGet's successful locked restore/metadata verification.
  No forbidden ImageSharp/SixLabors/GPL/System.Drawing dependency appeared. This is prototype
  graph review, not installer license notices/source-offer/legal clearance or the future T02 gate.
- **Isolation:** branch diff from main is confined to the spike plus its evidence log. Local
  `Directory.Build.props` isolates build defaults; direct dependency ranges are exact and both
  lock files exist. No backend, central root package configuration or production API was changed
  by the author branch or this review. Local skip-worktree `opencode.json` was neither edited
  nor staged.

## Pending gates / T12 handoff cautions

- **Cross-OS identity is pending, not passed.** Debug/Release Linux goldens and parallel-repeat
  tests support Linux determinism only. The custom fixed-Huffman DEFLATE implementation avoids
  native zlib compression differences; runtime zlib is used for verification decompression only.
  Integer layout, a private PRNG, invariant formatting and pinned managed ZXing make the design
  plausible, but do not prove behavior across OS/architectures/.NET runtimes or future upgrades.
  README's "by construction" wording must not become a verified support claim. Run the same
  golden/pixel tests on hosted Windows and macOS (and revalidate runtime/package changes).
  No native Windows or macOS run was attempted; Windows host runtime stays pending under OD-6.
- **T10 remains a dependency, not an output of this spike.** README `:141-153` says to keep the
  QR schema/catalogue IDs and that T10 job IDs "must fit" the prototype regex. These are only
  prototype choices: T12 must adapt to the jointly reviewed contract (including numbering,
  job IDs/alias mapping, sources, error codes and timeout semantics), never force T10 to match
  this generator. No backend contract or state machine is frozen or approved by this review.
- Future arbitrary/custom dimensions need checked pixel/byte budgets before allocation;
  aggregate job bounds must be explicit even though this standalone generator has no page cap.
  Do not export the permissive PNG verification reader as a security boundary.
- OD-4/OD-6 respected: headless command-line work only; no visible browser, unsigned native
  Windows binary/testhost/installer execution, SAC/policy/trust edits, merge, rebase or push.
  GPT master should validate author fixes and the final queue SHA; Opus owns fixes and integration.
