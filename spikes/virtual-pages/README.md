# T12-proto: virtual page generator (D-007 layer 1 prototype)

A standalone .NET 10 prototype of the page generator behind the Zilo Virtual Scanner. It is not
wired into the agent. T12 will integrate it against the T10 contract after GPT review (OD-2:
Claude-authored during the GPT outage).

```sh
dotnet test spikes/virtual-pages                                    # 146 tests, Linux only (OD-6)
dotnet run --project spikes/virtual-pages/src/Zilo.VirtualPages -- samples <dir>   # PNG + decoded QR JSON
dotnet run --project spikes/virtual-pages/src/Zilo.VirtualPages -- golden          # golden-hash table
dotnet run --project spikes/virtual-pages/src/Zilo.VirtualPages -- variants        # failure-variant catalogue
```

The SDK is the pinned root `global.json` (10.0.403, `rollForward: disable`, VSTest runner). Run
log: [`docs/validation/logs/T12-proto/linux.log`](../../docs/validation/logs/T12-proto/linux.log).

## API

```csharp
byte[] PageGenerator.Generate(PageSettings settings, int pageIndex, Side side, uint seed);   // PNG
record PageSettings(int Dpi, ColorMode Mode, PaperSize Paper, ScanSource Source, string Job = "job");
IEnumerable<PageRef> JobPlan.Pages(ScanSource source, int count);   // job order; no page limit
string PageGenerator.QrPayload(...);  PageLayout PageGenerator.Layout(...);
IReadOnlyList<FailureVariant> VirtualDevices.Catalogue;  VirtualDevices.Create(kind, n);
```

- `Dpi` 75–600; `Mode` `color`/`gray`/`bw`; `Paper` `A4`/`Letter`/`Legal`/`A5`; `Source`
  `flatbed`/`feeder`/`duplex` (T10 draft vocabulary).
- `Job` is part of the settings because the QR must carry it. It is limited to
  `[A-Za-z0-9._-]{1,40}`, so it needs no JSON escaping and every character has a glyph.
- `pageIndex` is 1-based in job order. `Side.Back` is only valid with `duplex`. `JobPlan`
  alternates front/back for duplex (page 2 is the back of sheet 1).
- The generator sets no page limit. The caller passes the count.

## What a page carries

See `samples/`. Every element is placed in tenths of a millimetre and converted to pixels with
exact integer rounding (`round(tenths × dpi / 254)`), so geometry follows the true DPI.

| Element | Detail |
|---|---|
| Settings banner | Black bar with job, DPI, mode, paper, source, page, side and seed. |
| Page number and side | Large page number with `FRONT`, or `BACK` inverted on a black bar. |
| QR code | Top right, ECC level M, byte mode, 4-module quiet zone, module ≥ 2 px (0.6 mm nominal). Payload, fixed key order, no whitespace: `{"job":"…","page":1,"side":"front","dpi":100,"mode":"color","paper":"A4","seed":42}` |
| Grey target | 11 steps from 255 to 0 (`round(255 × (10−i)/10)`), each 10 mm. |
| Colour target | R, G, B, C, M, Y, K, W patches, each 10 mm. |
| Seeded pattern | 5 mm cells, colour and inner-mark quadrant from SplitMix64 over (seed, page, side). Defined in mm, so the pattern is the same at every DPI. |
| Rulers | Horizontal mm ruler (1 mm ticks, labels every 10 mm), horizontal inch ruler (1/8″ ticks, labels every inch) and a vertical mm ruler in the left margin. Tick k's leading edge is at `origin + round(k × dpi / 25.4)` (or `round(k × dpi / 8)` for inches). Tick width is 0.2 mm (≥ 1 px). |
| PNG metadata | `pHYs` = round(dpi / 0.0254) px/m. No `tIME`/`tEXt`, so the bytes depend only on the inputs. |

Output formats: `color` is 8-bit RGB. `gray` is 8-bit greyscale with integer Rec.601 luma
`(299R + 587G + 114B + 500) / 1000`. `bw` is 1-bit greyscale with a 4×4 Bayer ordered dither of
that luma, so the grey target and pattern stay readable. Pure black and white, including the QR,
the text and the rulers, are never dithered.

## Determinism (byte-identical on every OS)

- **No system fonts.** `BitmapFont.cs` is an original 5×7 bitmap font drawn for this project
  (A–Z, 0–9 and a few symbols), scaled by integer factors.
- **No floating point** in layout, drawing, colour conversion or dithering.
- **No runtime zlib.** `Deflate.cs` is a managed zlib/deflate encoder: one fixed-Huffman block
  with greedy LZ77 and bounded hash chains. The runtime's native zlib-ng can produce different
  compressed bytes across OS, CPU and .NET versions, so it is used only to *inflate* in tests.
  CRC-32 and Adler-32 are our own.
- **Private PRNG** (SplitMix64), not `System.Random`, whose algorithm is not a stable contract.
- **QR matrix:** ZXing.Net's `Encoder` is pure managed code. It is deterministic for a fixed
  package version, and the version is pinned exactly (`[0.16.11]`) and locked.
- `InvariantGlobalization` and invariant-culture formatting everywhere.

Evidence: golden SHA-256 for 59 inputs (every mode × paper × source at 75 dpi, duplex back pages,
and a DPI sweep up to 600). Debug and Release builds produce the same bytes. Eight parallel
generations are identical. Only Linux is exercised (OD-6). Cross-OS identity is by construction
and should be confirmed by hosted macOS/Windows CI before anyone relies on it.

## Tests (`tests/Zilo.VirtualPages.Tests`, xUnit v3, 146 cases)

- **Golden hashes:** `golden-hashes.json` covers exactly `GoldenMatrix.Cases()`.
- **QR from pixels:** the PNG is decoded with our own reader, then the luminance goes to the ZXing
  QR reader. The JSON must equal the expected payload, with key order and every field checked,
  across 75/150/300/600 dpi, all modes and papers, duplex backs, a 5-page duplex job order and a
  large seed.
- **Ruler spacing:** the 1 mm, 1/8″ and vertical tick edges are located in decoded pixels at
  9 DPIs and 4 papers. Each tick must be within ±0.5 px of `k × dpi / 25.4`, and whole inches
  exactly `dpi` px apart. The page size and `pHYs` are also checked.
- **Determinism:** repeat and parallel runs, and every input changes the output.
- **Samples:** the committed PNGs are regenerated byte for byte, and each committed `.qr.json`
  equals what the committed PNG's pixels decode to.
- **Codec:** our deflate inflates back with the runtime's `ZLibStream`. PNG round trip in every mode.
- **Validation and failure variants** (below).

To change the rendering on purpose, regenerate `golden-hashes.json` and `samples/` with the
commands above. The diff of the hash file is the review artefact.

## Failure variants (data only)

`FailureVariants.cs` and `samples/failure-variants.json` define one virtual device per variant,
in the shape T10 R-D3 expects ("variants are separate virtual devices; names and IDs defined in
T12"). Error codes are the T10 §11 codes.

| Device ID | Kind | Error code | Parameter | Meaning |
|---|---|---|---|---|
| `virtual` | none | — | — | Healthy device. |
| `virtual-feeder-empty` | feeder-empty | `feeder-empty` | `afterPages: 0` | Fails before any page. |
| `virtual-feeder-3` | feeder-empty | — | `afterPages: 3` | Completes normally after 3 pages (T10: running out after ≥ 1 page is not an error). |
| `virtual-paper-jam` | paper-jam | `paper-jam` | `atPage: 2` | Page 1 delivered, then the job fails; pages kept. |
| `virtual-cover-open` | cover-open | `cover-open` | — | Fails before the first page. |
| `virtual-timeout` | timeout | `timeout` | `atPage: 2` | Page 1 delivered, then no response. |
| `virtual-disconnect` | disconnect | `disconnected` | `atPage: 2` | Page 1 delivered, then the device disappears. |
| `virtual-slow` | slow | — | `delayMs: 1500` | Every page delayed. |

`VirtualDevices.Create(kind, n)` builds other parameterisations, for example
`virtual-paper-jam-5`.

## Dependencies and licences (D-002 default-deny)

Resolved graph from the committed `packages.lock.json` files. Licences were read from each
package's nuspec `<license type="expression">`.

| Package | Version | Scope | Licence |
|---|---|---|---|
| ZXing.Net | 0.16.11 | generator (QR encode) + tests (QR decode) | Apache-2.0 |
| Microsoft.NET.Test.Sdk | 18.11.0 | tests | MIT |
| Microsoft.CodeCoverage | 18.11.0 | tests (transitive) | MIT |
| Microsoft.TestPlatform.ObjectModel | 18.11.0 | tests (transitive) | MIT |
| Microsoft.TestPlatform.TestHost | 18.11.0 | tests (transitive) | MIT |
| Microsoft.Bcl.AsyncInterfaces | 6.0.0 | tests (transitive) | MIT |
| Microsoft.Win32.Registry | 5.0.0 | tests (transitive) | MIT |
| System.Security.AccessControl | 6.0.1 | tests (transitive) | MIT |
| xunit.v3.mtp-off | 4.0.2 | tests | Apache-2.0 |
| xunit.v3.core.mtp-off, .assert, .common, .extensibility.core, .runner.common, .runner.inproc.console | 4.0.2 | tests (transitive) | Apache-2.0 |
| xunit.analyzers | 2.2.0 | tests (transitive) | Apache-2.0 |
| xunit.runner.visualstudio | 4.0.1 | tests | Apache-2.0 |

The generator's only runtime dependency is ZXing.Net, which has no transitive packages on
net9.0+. No ImageSharp, no Six Labors packages, no System.Drawing, no GPL. QRCoder (MIT) was
rejected because on net6.0+ it pulls `System.Drawing.Common`. All assets (font, layout, pattern)
are original. SplitMix64 is a public-domain algorithm, implemented here.

## Notes for T12 (keep / change)

**Keep**
- The `Generate(settings, pageIndex, side, seed)` shape, integer tenth-mm layout, managed
  deflate/PNG, bitmap font and SplitMix64. Together they give byte-identity without native code.
- The QR payload schema and key order. Tests and the T33 eSCL fixture can assert order and
  settings from pixels alone.
- The golden-hash workflow (`golden` command → reviewed diff) and the variant catalogue IDs.

**Change or decide**
- **Settings mapping:** map T10 `POST /jobs` effective settings onto `PageSettings`. Custom page
  sizes (`customPageSizeMm`) are not supported yet. Add them as tenth-mm dimensions.
- **Job ID:** T10 job IDs must fit `[A-Za-z0-9._-]{1,40}`, or T12 must pass a short alias.
- **Variant semantics:** this is data only. T12 implements the job-state behaviour (T10 R-J1:
  pages kept, `feeder-empty` only with zero pages, and `timeout` against `pageTimeoutSeconds`).
  The catalogue's `delayMs` and `atPage` defaults are arbitrary.
- **Licence gate:** run T02's default-deny tool on this graph when it lands. Move the spike's
  package versions into central management when the generator moves under `backend/`.
- **Performance:** a 600 dpi A4 colour page is a ~100 MB raster, and the managed deflate is
  single-threaded. Per-page time was not measured. All 59 golden pages, including 600 dpi gray
  A4 and 600 dpi bw Letter, generate in about 2.4 s wall clock (`golden` command, Release,
  WSL2). That is fine for tests. For `slow`/stress, either
  cache pages or compress rows in parallel independent blocks. Parallel blocks change the bytes,
  so regenerate the golden hashes.
- **Other formats:** T12/T20 export (PDF/TIFF/JPEG) is out of scope here. Per D-007, compare
  decoded pixels and QR content there, not raw bytes.
- **Cross-OS:** add this test project to the hosted Linux/macOS/Windows CI matrix to confirm the
  golden hashes off Linux. Do not run it natively on the owner's Windows host (OD-6).
