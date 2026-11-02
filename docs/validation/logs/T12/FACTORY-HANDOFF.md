# T12 factory handoff to T11

T11 owns Agent registration after this branch merges. T12 does not alter Agent,
Security, HTTP policy, API contracts, or production mutation endpoints.

```csharp
using Zilo.Core;
using Zilo.Drivers.Virtual;

IScanBackend backend = VirtualBackendFactory.Create();
// Equivalent: new VirtualScanBackend();
// Register as one process-lifetime IScanBackend instance, disposed by its owner.
```

Factory signature: `Create(TimeProvider? timeProvider = null,
IEnumerable<FailureVariant>? variants = null) -> IScanBackend`.
The public constructor has the same arguments; the focused fixture overload is
`VirtualScanBackend(FailureVariant variant, TimeProvider? timeProvider = null)`.
An injected clock/variant is construction-time test configuration, not an HTTP
operation or permission to expose runtime mutation.

## Routes and capabilities

- `virtual`: **Zilo Virtual Scanner**, healthy.
- `virtual-feeder-empty`: empty before page 0, typed `feeder-empty`.
- `virtual-feeder-3`: normal feeder exhaustion after three acquired sides.
- `virtual-paper-jam`: typed `paper-jam` after one emitted page.
- `virtual-cover-open`: typed `cover-open` before page 0.
- `virtual-timeout`: typed `timeout` after one emitted page.
- `virtual-disconnect`: typed `disconnected` after one emitted page.
- `virtual-slow`: 1500 ms per acquired page through injected `TimeProvider`.

All routes report driver `virtual`, connection `test-pages`; source-specific
caps are flatbed (one page), feeder and duplex. Each supports resolutions
75/150/300/600, color/gray/bw, A4/Letter/Legal/A5, no custom paper size, defaults
300/color/A4, maximum physical area 215.9 x 355.6 mm. No hardware is probed.
List and refresh share one immutable local discovery snapshot; no real probe
means there is no refresh wait to coalesce.

## Acquisition contract

T11/T20 supply `ScanRequest` with resolved `EffectiveSettings` and finite
positive `AcquisitionLimits`. MaxPages is acquired-image count, including both
duplex sides. API Page.Index/Sheet and QR page are 0-based; visible page labels
are 1-based. Duplex alternates front/back. Typed failures retain previously
yielded immutable Core pages; `PagesKept` counts yields, not persisted storage.
Cancellation uses `OperationCanceledException`, not a typed scanner error.
The caller disposes the enumerator; its yielded pages survive failure,
cancellation, enumerator disposal and backend disposal.

Images are PNG RGB8, grayscale8 or grayscale1 according to requested mode.
No refinement is performed: AppliedSettings stays null and adjustments empty.
Each move acquires at most one page and no producer queue is created. The
consumer supplies backpressure. Encoded byte and pixel bounds are checked
before raster allocation; internal finite raster/encoding bounds are separate
from T20's aggregate job storage/concurrency policy.

## Rebase/registration dependency warning

Preserve `ZXing.Net [0.16.11]` in central package policy and generated QR entries
in both `backend/src/Zilo.Agent/packages.lock.json` and
`backend/tests/Zilo.Scaffold.Tests/packages.lock.json`, then regenerate/recheck
locks when T11 changes its own project graph. Do not overwrite those locks with
pre-T12 snapshots. The managed-only package/license inventory is in
`DEPENDENCIES.md` and `dependency-audit.log` in this directory.

No Agent self-test of virtual acquisition exists on the frozen base; the current
Agent executable is a scaffold smoke check, not T12 registration or HTTP evidence.
Production jobs, SSE, storage, export and real scanners remain their owning tasks.
