using System.Collections.Immutable;
using Zilo.Core;
using Microsoft.Extensions.Hosting;

namespace Zilo.Agent;

public sealed class DiscoveryService : IHostedService, IAsyncDisposable
{
    private readonly IReadOnlyList<DiscoveryBackendRegistration> _backends;
    private readonly TimeSpan _timeout;
    private readonly object _gate = new();
    private DeviceList _cached = new(Array.Empty<Device>(), new Discovery("idle", null));
    private Task<DeviceList>? _refresh;
    private readonly Dictionary<string, DiscoveryBackendRegistration> _owners = new(StringComparer.Ordinal);
    private readonly Dictionary<DiscoveryBackendRegistration, Task<DeviceList>> _probes = new();
    private readonly HashSet<Task> _capsCalls = new();
    private readonly CancellationTokenSource _stopping = new();
    private Task? _background;
    private Task? _shutdown;
    private bool _disposed;

    public DiscoveryService(IEnumerable<DiscoveryBackendRegistration>? backends, TimeSpan? timeout = null)
    {
        _backends = (backends ?? Array.Empty<DiscoveryBackendRegistration>()).ToArray();
        _timeout = timeout ?? TimeSpan.FromSeconds(15);
        if (_timeout <= TimeSpan.Zero || _timeout.TotalMilliseconds > uint.MaxValue - 1)
            throw new ArgumentOutOfRangeException(nameof(timeout));
    }

    public DeviceList List() { lock (_gate) return _cached; }

    public ValueTask<DeviceList> ListAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(List());

    public Task<DeviceList> RefreshAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_refresh is null || _refresh.IsCompleted)
            {
                var source = new TaskCompletionSource<DeviceList>(TaskCreationOptions.RunContinuationsAsynchronously);
                var task = source.Task;
                _refresh = task;
                _ = RefreshCoreAsync(source);
                return AwaitRefreshAsync(task, cancellationToken);
            }
            return AwaitRefreshAsync(_refresh, cancellationToken);
        }
    }

    public async ValueTask<DeviceCaps?> GetCapsAsync(string deviceId, CancellationToken cancellationToken = default)
    {
        DiscoveryBackendRegistration? owner;
        Task<DeviceCaps> call;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _owners.TryGetValue(deviceId, out owner);
            if (owner is null) return null;
            call = Task.Run(async () => await owner.Backend.GetDeviceCapsAsync(deviceId, cancellationToken).ConfigureAwait(false), CancellationToken.None);
            _capsCalls.Add(call);
        }
        try { return await call.ConfigureAwait(false); }
        finally { lock (_gate) _capsCalls.Remove(call); }
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        lock (_gate) _background ??= RunBackgroundAsync();
        return Task.CompletedTask;
    }

    private async Task RunBackgroundAsync()
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
            do { await RefreshAsync(_stopping.Token).ConfigureAwait(false); }
            while (await timer.WaitForNextTickAsync(_stopping.Token).ConfigureAwait(false));
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested) { }
        catch (ObjectDisposedException) when (_disposed) { }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _stopping.CancelAsync().ConfigureAwait(false);
        if (_background is not null) await _background.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    public ValueTask DisposeAsync()
    {
        lock (_gate)
        {
            if (_disposed) return ValueTask.CompletedTask;
            _disposed = true;
            // A driver that ignores cancellation still owns its resources. Host shutdown
            // is bounded; this retained task observes late faults and releases only after
            // all owned calls finish. Permanently hung native work needs process isolation.
            _shutdown = ReleaseBackendsAsync(_probes.Values.Cast<Task>().Concat(_capsCalls).ToArray());
        }
        return ValueTask.CompletedTask;
    }

    public Task ShutdownCompletion { get { lock (_gate) return _shutdown ?? Task.CompletedTask; } }

    private async Task ReleaseBackendsAsync(Task[] calls)
    {
        await _stopping.CancelAsync().ConfigureAwait(false);
        await ObserveAsync(Task.WhenAll(calls)).ConfigureAwait(false);
        foreach (var registration in _backends.DistinctBy(x => x.Backend, ReferenceEqualityComparer.Instance))
        {
            try { await registration.Backend.DisposeAsync().ConfigureAwait(false); }
            catch { /* Observe release failures without exposing backend diagnostics. */ }
        }
        _stopping.Dispose();
    }

    private async Task RefreshCoreAsync(TaskCompletionSource<DeviceList> completion)
    {
        try
        {
            if (_backends.Count == 0)
            {
                var empty = new DeviceList(Array.Empty<Device>(), new Discovery("idle", DateTimeOffset.UtcNow));
                lock (_gate) _cached = empty;
                completion.TrySetResult(empty); return;
            }
            var results = await Task.WhenAll(_backends.Select(RefreshOneAsync)).ConfigureAwait(false);
            var devices = results.SelectMany(x => x.Devices).ToArray();
            var incomplete = results.SelectMany(x => x.Incomplete).ToArray();
            var snapshot = new DeviceList(devices, new Discovery("idle", DateTimeOffset.UtcNow, incomplete));
            lock (_gate) { _cached = snapshot; _owners.Clear(); foreach (var result in results) foreach (var device in result.Devices) { var owner = _backends.FirstOrDefault(x => x.Name == device.Driver); if (owner is not null) _owners[device.Id] = owner; } }
            completion.TrySetResult(snapshot);
        }
        catch (Exception error) { completion.TrySetException(error); }
        finally { lock (_gate) { if (ReferenceEquals(_refresh, completion.Task)) _refresh = null; } }
    }

    private async Task<RefreshResult> RefreshOneAsync(DiscoveryBackendRegistration registration)
    {
        try
        {
            Task<DeviceList> probe;
            lock (_gate)
            {
                // Never start another driver call while a timed-out call still owns
                // its resources. A late snapshot is observed but never published.
                if (_probes.TryGetValue(registration, out probe!) && !probe.IsCompleted)
                    return Incomplete(registration);
                probe = Task.Run(async () =>
                {
                    using var timeout = new CancellationTokenSource(_timeout);
                    return await registration.Backend.RefreshDevicesAsync(timeout.Token).ConfigureAwait(false);
                });
                _probes[registration] = probe;
                _ = ObserveAsync(probe);
            }
            var value = await probe.WaitAsync(_timeout).ConfigureAwait(false);
            return new(value, value.Discovery.IncompleteDrivers);
        }
        catch (OperationCanceledException) { return new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name)); }
        catch { return new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name)); }
    }

    private RefreshResult Incomplete(DiscoveryBackendRegistration registration)
        => new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name));

    private static async Task ObserveAsync(Task task)
    {
        try { await task.ConfigureAwait(false); }
        catch { /* Backend failure is represented by incompleteDrivers, never logged raw. */ }
    }

    private static async Task<DeviceList> AwaitRefreshAsync(Task<DeviceList> task, CancellationToken cancellationToken)
        => await task.WaitAsync(cancellationToken).ConfigureAwait(false);

    private sealed record RefreshResult(DeviceList Snapshot, ImmutableArray<string> Incomplete)
    {
        public ImmutableArray<Device> Devices => Snapshot.Devices;
    }
}

public static class CapabilityValidator
{
    public static void Validate(DeviceCaps caps)
    {
        if (string.IsNullOrWhiteSpace(caps.DeviceId) || caps.Sources.IsDefaultOrEmpty) throw new InvalidDataException("invalid capability snapshot");
        if (caps.Limits is { } limits && (limits.MaxPagesPerJob is <= 0 || limits.MaxPixelsPerPage is <= 0 || limits.MaxResolutionDpi is <= 0)) throw new InvalidDataException("invalid capability snapshot");
        foreach (var source in caps.Sources)
        {
            if (string.IsNullOrWhiteSpace(source.Source) || source.ColorModes.IsDefaultOrEmpty || source.PageSizes.IsDefaultOrEmpty) throw new InvalidDataException("invalid capability snapshot");
            if (!double.IsFinite(source.MaxAreaMm.WidthMm) || !double.IsFinite(source.MaxAreaMm.HeightMm) || source.MaxAreaMm.WidthMm <= 0 || source.MaxAreaMm.HeightMm <= 0 || source.Defaults.Resolution <= 0) throw new InvalidDataException("invalid capability snapshot");
            if (!source.ColorModes.Contains(source.Defaults.ColorMode) || !source.PageSizes.Any(size => size.Id == source.Defaults.PageSize)) throw new InvalidDataException("invalid capability snapshot");
            if (caps.Limits?.MaxResolutionDpi is { } maxResolution && source.Defaults.Resolution > maxResolution) throw new InvalidDataException("invalid capability snapshot");
            foreach (var size in source.PageSizes) if (string.IsNullOrWhiteSpace(size.Id) || !double.IsFinite(size.WidthMm) || !double.IsFinite(size.HeightMm) || size.WidthMm <= 0 || size.HeightMm <= 0 || size.WidthMm > source.MaxAreaMm.WidthMm || size.HeightMm > source.MaxAreaMm.HeightMm) throw new InvalidDataException("invalid capability snapshot");
            if (source.Resolutions.Kind == "list" && (source.Resolutions.Values.IsDefaultOrEmpty || source.Resolutions.Values.Any(value => value <= 0))) throw new InvalidDataException("invalid capability snapshot");
            if (source.Resolutions.Kind == "range" && (source.Resolutions.Min is null || source.Resolutions.Max is null || source.Resolutions.Step is null || source.Resolutions.Min <= 0 || source.Resolutions.Max < source.Resolutions.Min || source.Resolutions.Step <= 0)) throw new InvalidDataException("invalid capability snapshot");
            if (source.Resolutions.Kind == "list" && !source.Resolutions.Values.Contains(source.Defaults.Resolution)) throw new InvalidDataException("invalid capability snapshot");
            if (source.Resolutions.Kind == "range" && (source.Defaults.Resolution < source.Resolutions.Min || source.Defaults.Resolution > source.Resolutions.Max || ((long)source.Defaults.Resolution - source.Resolutions.Min) % source.Resolutions.Step != 0)) throw new InvalidDataException("invalid capability snapshot");
        }
    }
}
