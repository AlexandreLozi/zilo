# T12-proto — standalone virtual page-generator prototype (BE lane; Claude-authored; GPT reviews on resume)

**Target:** `spikes/virtual-pages/`, a standalone .NET 10 console prototype (pinned SDK from root
`global.json`) of the D-007 layer-1 page generator. It is **not** wired into the agent; T12 will do
that against the T10 contract after review.

**Read first:**
- DECISIONS D-002 (licensing, default-deny) and D-007 (virtual scanner);
- `docs/planning/EXECUTION.md` (the T12 row);
- the T10 draft contract for the vocabulary only:
  `git show t10-contract:api/CONTRACT.md` (devices/caps/pages sections; unreviewed).

**Change:**
- A deterministic generator `Generate(settings, pageIndex, side, seed) → image bytes`.
  - Settings: DPI (75–600), colour mode (color, gray, bw), paper size (A4, Letter, Legal, A5), and
    source (flatbed, feeder, duplex). The generator itself sets no limit on pages per job; the
    caller passes the count.
  - Each page carries:
    - a large page number and side (front/back);
    - a settings banner;
    - a ruler in mm and inches at the true DPI;
    - a colour/grey target;
    - a seeded pattern;
    - a **QR code** with JSON `{job, page, side, dpi, mode, paper, seed}` so tests can assert order and
      settings from pixels.
  - **Byte-identical** output for the same inputs on every OS: no system fonts. Embed a small
    original bitmap font or draw glyphs as vectors.
- Output PNG (bw/gray/rgb). Use only permissively licensed dependencies that pass the D-002
  default-deny gate: MIT, Apache-2.0 or BSD, for example a managed QR encoder. **No ImageSharp, no
  Six Labors Split-licensed packages, no GPL.** A fully managed implementation (hand-written PNG
  encoder over `System.IO.Compression`) is welcome.
- Failure-variant descriptors: `feeder-empty` after N pages, `paper-jam` at page k, `cover-open`,
  `timeout`, `disconnect` at page k, and a `slow` delay. These are data only, for T12 to consume.
- Tests (xUnit):
  - golden hashes per settings combination;
  - decoding the QR from the PNG gives the expected JSON;
  - ruler pixel spacing matches the DPI;
  - determinism across runs.
  - Linux only. Never run binaries natively on Windows (OD-6).
- `spikes/virtual-pages/README.md`: design, licences of every dependency, and what T12 should keep or
  change.

**Constraints:**
- Only original assets.
- Do not touch `backend/**`, root `Directory.*.props` or locks.
- If the root central package management interferes, give the spike its own `Directory.Packages.props`
  under `spikes/virtual-pages/`.

**Allowed files:** `spikes/virtual-pages/**`, `docs/validation/logs/T12-proto/**`.

**Observable acceptance:**
- `dotnet test spikes/virtual-pages` passes on Linux with the pinned SDK (installed task-private as in
  `docs/validation/T04b.md`).
- Sample PNGs are committed (small, ≤ 150 dpi) together with their decoded QR JSON.
- A licence list is in the README.
