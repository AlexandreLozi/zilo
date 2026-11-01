namespace Zilo.Core;

/// <summary>
/// Neutral scanner boundary. Implementations own only device discovery/capabilities and one bounded
/// acquisition stream; authentication, job ownership, scheduling, storage, export and HTTP stay above it.
/// </summary>
public interface IScanBackend : IAsyncDisposable
{
    /// <summary>Returns the latest immutable cached snapshot and does not require a hardware probe.</summary>
    ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default);

    /// <summary>Refreshes discovery. Concurrent refresh calls for one backend are coalesced by the backend.</summary>
    ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default);

    /// <summary>Gets capabilities for an opaque route ID.</summary>
    ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Lazily acquires pages in acquisition order. Each MoveNext produces at most one page, so a
    /// consumer controls backpressure; implementations must not materialize or queue an unbounded job.
    /// Cancellation must propagate OperationCanceledException, never ScanFailureException.
    /// </summary>
    IAsyncEnumerable<Page> AcquireAsync(ScanRequest request, CancellationToken cancellationToken = default);
}
