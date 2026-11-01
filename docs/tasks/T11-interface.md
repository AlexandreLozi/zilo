# T11a Core interface handoff

This is the neutral boundary consumed by T11 and T12. It contains immutable records and no HTTP,
authentication, token, job-store, scheduler, temporary-file, export, or vendor/platform types.

## Exact surface

Namespace: `Zilo.Core`.

```csharp
public interface IScanBackend : IAsyncDisposable
{
    ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default);
    ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default);
    ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId, CancellationToken cancellationToken = default);
    IAsyncEnumerable<Page> AcquireAsync(ScanRequest request, CancellationToken cancellationToken = default);
}

public sealed record ScanRequest(JobId JobId, string DeviceId, EffectiveSettings Settings, AcquisitionLimits Limits);

public sealed record AcquisitionLimits(int MaxPages, long MaxPixelsPerPage, long MaxBytesPerPage);
```

`JobId` enforces T10's `^[A-Za-z0-9_-]{16,64}$` bound. `RouteId` is available for code that wants to
make the device route's `^[A-Za-z0-9._~-]{1,128}$` bound explicit; `Device.Id` and `DeviceCaps.DeviceId`
remain strings so response/transport owners can preserve opaque values without parsing them.

The records are `Device`, `DeviceList`, `Discovery`, `ResolutionCaps`, `PageSize`, `SizeMm`,
`SourceDefaults`, `SourceCaps`, `DeviceLimits`, `DeviceCaps`, `ScanSettings`, `RequestedSettings`,
`EffectiveSettings`, `Adjustment`, `PageResolution`, `Page`, and `ScanError`. Collection properties are
`ImmutableArray<T>` and constructors copy incoming enumerables. `Page.Bytes` is an immutable copy of the
input bytes. Response enum/discriminator values (`Driver`, `Connection`, `Source`, color mode,
resolution kind, side, adjustment field/reason, and error code) are strings: unknown values survive
round-trips. Resolution kinds `list` and `range` have convenience factories, but `ResolutionCaps` does
not reject a future kind.

These constructors are not full wire validators: T11 validates outbound capability snapshots against
T10 (including nonempty collections and positive ranges/dimensions). Record equality on
`ImmutableArray<T>` members is backing-array equality, not structural sequence equality; compare
elements explicitly when checking whether equivalent snapshots changed.

`Page.Bytes` contains a complete encoded original image, not a borrowed vendor raster. The final
optional constructor parameter `string ContentType = "image/png"` identifies that encoding
(`image/png` for the virtual backend; real backends may supply `image/jpeg`). The property is get-only;
transcoding, thumbnails, wire ETags and export remain upper-layer responsibilities. The driver's
`ETag` is an opaque content identity hint, not a replacement for the HTTP owner's format-specific ETag.

`Adjustment` exposes cloned `JsonElement?` scalar values. Only string, number, and null are accepted;
arrays, objects, and booleans are rejected. `Page` copies both `Bytes` and `Adjustments` and may carry
`AppliedSettings` plus per-page adjustments, allowing a driver to report a refinement on each emitted
page without mutating the request.

`AppliedSettings == null` means unchanged from the latest effective snapshot (initially the request);
a non-null value is a complete replacement snapshot. Drivers may refine only `resolution`, `colorMode`,
`pageSize`, and `pageSizeMm`. `Source` and `MaxPages` remain identical to the request throughout the
stream, preserving R-J8 completion semantics. Every refinement must satisfy the selected `SourceCaps`
(including supported resolution/color mode and R-J5 page-size rules), `DeviceCaps.Limits`, and all
`AcquisitionLimits`; otherwise fail with a typed error rather than emit an invalid page or snapshot.
Before a first page exists, reject unsupported settings with a typed failure, not silent coercion;
an actual device-applied refinement is reported with that first page's snapshot.

`Adjustments` is the delta associated with that page (not cumulative), with reason `device-applied`.
For scalar `resolution`, `colorMode`, or changed `pageSize` IDs, the driver's `Requested` is the prior
effective value, not the user's original request (which the driver does not receive). T11 retains that
original request and rewrites each published adjustment's `requested` to the original field value,
or null when omitted, while retaining the reported effective value and reason.
`PageSizeMm` changes travel only in the full `AppliedSettings` snapshot: no object-valued adjustment
or new adjustment-field convention is introduced. A scalar `pageSize` adjustment accompanies an ID
change, not a dimensions-only change. The job owner accumulates deltas and publishes the updated
effective-setting state event before the page, including for dimensions-only refinements (R-J6).
Each page's actual `Resolution` and `ColorMode` are authoritative for that page; later snapshots never
reinterpret previously yielded pages.

## Shared typed failures

Every method uses `ScanFailureException` carrying safe `ScanError` data for backend/scanner failures,
not raw vendor exceptions. `PagesKept` is 0 outside acquisition and before the first yielded page;
within acquisition it counts previously yielded pages. Cancellation remains the standard
`OperationCanceledException` path, never translated to `ScanFailureException` (including refresh waits).
Argument/programming errors are not scanner failures. The following production codes use T10's
existing meanings; open response strings do not authorize inventing new codes.

| Method | Applicable typed failure codes / result |
|---|---|
| `ListDevicesAsync` | Cached result without probing; `unknown` for an otherwise unclassified backend failure. No per-device busy/disconnection/timeout failure. |
| `RefreshDevicesAsync` | Partial discovery result for driver timeouts (see below); `unknown` for a backend-wide failure that prevents returning a snapshot. No blanket `timeout` for discovery. |
| `GetDeviceCapsAsync` | `not-found` for an unknown/already vanished route; `device-busy` when held; `disconnected` if it disappears during access; `timeout` for an unresponsive device; `permission` for OS access denial; `unknown` otherwise. |
| `AcquireAsync` (including before page 0 and failures from `MoveNextAsync`/enumerator disposal) | `not-found`, `device-busy`, `disconnected`, `timeout`, `permission`, `unsupported-capability`, `invalid-settings`, `feeder-empty`, `paper-jam`, `cover-open`, `limits-exceeded`, or `unknown`, according to the cause. |
| `DisposeAsync` | `unknown` for an otherwise unclassified backend resource-release failure; `PagesKept` is 0, and yielded pages remain valid. |

For acquisition, an unknown route is `not-found`; loss of a device during access is `disconnected`.
`unsupported-capability` means the selected device/source does not support a setting (R-J5), whereas
`invalid-settings` means a well-formed but invalid value such as an unknown page-size ID, dimensions
beyond `MaxAreaMm`, or resolution above the configured limit. A runtime resource-bound breach is
`limits-exceeded`, not a capability mismatch. T11 owns malformed request rejection (`invalid-request`),
pre-job validation/coercion and HTTP mapping; a failure after job creation is a job failure, not a new
HTTP create response. Auth, job-state, export, and agent lifecycle errors remain upper-owner concerns.

## Lifetime, cancellation, and backpressure

`ListDevicesAsync` returns the latest immutable cache and performs no hardware probe. `RefreshDevicesAsync`
owns discovery refresh coalescing for a backend instance: concurrent callers await one bounded refresh
and receive equivalent immutable snapshots. The backend owns only this cache/coalescing and driver
resources; the caller owns request/job authorization, identity, and any policy around refresh frequency.
`GetDeviceCapsAsync` addresses one opaque route and does not create job state.

The refresh bound comes from construction-time configuration matching T10's
`limits.discoveryTimeoutSeconds`, not a new method parameter. A timed-out discovery driver keeps its
last-known devices and is recorded in `Discovery.IncompleteDrivers`; other drivers' results still
return normally. That timeout is incomplete discovery, not a blanket exception or caller cancellation.
Backends do not own Zilo job state: `Device.Busy` may reflect observed external driver contention (or
default false); T11 overlays active Zilo-job busy state on the returned immutable snapshot.

`AcquireAsync` receives already-resolved `EffectiveSettings`; the upper job owner validates closed
request enums/capabilities, applies defaults, and supplies mandatory positive `AcquisitionLimits`.
The backend must enforce all three finite limits and must fail before an over-limit allocation. The
Core boundary does not own source validation or job limits.

`Settings.MaxPages` is the completion count, including sides for duplex. Stop normally at that count
or at normal feeder exhaustion after at least one page. `Limits.MaxPages` is the safety bound:
when the completion count is null, reaching that bound yields the final allowed page then fails with
`limits-exceeded` on the next move, without acquiring another page (R-J8). No pages before feeder
exhaustion means `feeder-empty`. The owner supplies coherent validated settings/limits and retains
physical resource accounting until the driver has stopped. `PagesKept` counts previously yielded
pages, not persisted pages; only the job owner knows how many were stored successfully.

`ScanError` contains safe public code/message/retryability only, never document bytes, file paths,
credentials, or raw vendor exception messages. An optional driver error ID is diagnostic, not wire
error identity: the job owner assigns and persists T10's stable asynchronous error/request identity.

`AcquireAsync` is lazy. Each `MoveNextAsync` may acquire and yield at most one page; the consumer's
next `MoveNextAsync` is the backpressure signal. Implementations must not materialize all pages or
create an unbounded producer queue. Drivers must impose finite resource bounds (pixel/byte arithmetic,
maximum in-flight page buffers) and reject or fail before an allocation would exceed those bounds.
`ScanSettings` remains the upper-owner request record and is never accepted by `AcquireAsync`.

The consumer owns each yielded `Page` and may retain it after a subsequent failure, cancellation,
enumerator disposal, or `IScanBackend.DisposeAsync`. The implementation must not reuse, mutate, or
dispose the page bytes after yielding. The consumer must dispose the async enumerator (normal
`await foreach` does this), stop requesting pages when finished, and dispose the backend when its
process lifetime ends. Enumerator disposal is the driver's release point for per-acquisition resources;
backend disposal releases discovery/capability and driver resources. Cancellation is cooperative and
must be observed between pages and during blocking driver work; it does not delete already yielded
pages. A typed failure after N pages leaves those N pages available to the consumer.

For coalesced refresh, cancellation of one caller cancels only that caller's wait; the shared refresh
continues for other callers and updates the backend cache. If all waiters leave, the backend may cancel
the underlying probe. A backend disposal race is owned by the backend: disposal prevents new work,
cancels shared discovery/acquisition resources, awaits their release, and never invalidates already
yielded immutable pages; callers must not use the backend after `DisposeAsync` begins.

Implementations are thread-safe for concurrent list/capability calls and concurrent refresh callers.
An acquisition stream is independently cancellable and is not required to permit concurrent
`MoveNextAsync` calls from one enumerator. Backends may serialize physical access for a route, but that
policy is expressed as a typed error (`device-busy`) rather than hidden job ownership.

No Core type owns tokens, auth, HTTP, job lifecycle, storage, export, or a scheduler. T11 supplies those
owners; T12 supplies a production virtual implementation against this interface.
