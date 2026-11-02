using System.Collections.Immutable;
using Zilo.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Zilo.Agent;

public sealed class DiscoveryService : IHostedService, IAsyncDisposable
{
    private readonly IReadOnlyList<DiscoveryBackendRegistration> _backends;
    private readonly TimeSpan _timeout;
    private readonly object _gate = new();
    private DeviceList _cached = new(Array.Empty<Device>(), new Discovery("idle", null));
    private Task<DeviceList>? _refresh;
    private readonly Dictionary<string, DiscoveryBackendRegistration> _owners = new(StringComparer.Ordinal);
    private readonly Dictionary<IScanBackend, Task> _calls = new(ReferenceEqualityComparer.Instance);
    private readonly TimeProvider _time;
    private readonly TimeSpan _shutdownGrace;
    private readonly ILogger<DiscoveryService>? _logger;
    private readonly CancellationTokenSource _stopping = new();
    private Task? _background;
    private Task? _shutdown;
    private bool _disposed;

    public DiscoveryService(IEnumerable<DiscoveryBackendRegistration>? backends, TimeSpan? timeout = null,
        TimeProvider? timeProvider = null, TimeSpan? shutdownGrace = null, ILogger<DiscoveryService>? logger = null)
    {
        _backends = (backends ?? Array.Empty<DiscoveryBackendRegistration>()).ToArray();
        _timeout = timeout ?? TimeSpan.FromSeconds(15);
        _time = timeProvider ?? TimeProvider.System;
        _shutdownGrace = shutdownGrace ?? TimeSpan.FromSeconds(2);
        _logger = logger;
        if (_timeout <= TimeSpan.Zero || _timeout.TotalMilliseconds > uint.MaxValue - 1)
            throw new ArgumentOutOfRangeException(nameof(timeout));
        if (_shutdownGrace <= TimeSpan.Zero || _shutdownGrace.TotalMilliseconds > uint.MaxValue - 1)
            throw new ArgumentOutOfRangeException(nameof(shutdownGrace));
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
            if (IsBusy(owner.Backend)) throw Failure("device-busy");
            call = StartCall(owner.Backend, token => owner.Backend.GetDeviceCapsAsync(deviceId, token));
        }
        try { return await call.WaitAsync(_timeout, _time, cancellationToken).ConfigureAwait(false); }
        catch (TimeoutException) { throw Failure("timeout"); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { throw Failure("timeout"); }
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
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30), _time);
            do { await RefreshAsync(_stopping.Token).ConfigureAwait(false); }
            while (await timer.WaitForNextTickAsync(_stopping.Token).ConfigureAwait(false));
        }
        catch (OperationCanceledException) when (_stopping.IsCancellationRequested) { }
        catch (ObjectDisposedException) when (_disposed) { }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        var cancellation = _stopping.CancelAsync();
        _ = ObserveAsync(cancellation);
        var shutdown = _background is null ? cancellation : Task.WhenAll(cancellation, _background);
        try { await shutdown.WaitAsync(_shutdownGrace, _time, cancellationToken).ConfigureAwait(false); }
        catch (TimeoutException) { }
        int retained;
        lock (_gate) retained = _calls.Values.Count(call => !call.IsCompleted);
        if (retained > 0) _logger?.LogWarning("Discovery shutdown retained {BackendCalls} backend call(s); cooperative boundary", retained);
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
            _shutdown = Task.Run(ReleaseBackendsAsync);
        }
        return ValueTask.CompletedTask;
    }

    public Task ShutdownCompletion { get { lock (_gate) return _shutdown ?? Task.CompletedTask; } }

    internal int RetainedCallCount { get { lock (_gate) return _calls.Values.Count(call => !call.IsCompleted); } }

    private async Task ReleaseBackendsAsync()
    {
        var cancellation = _stopping.CancelAsync();
        _ = ObserveAsync(cancellation);
        var releases = _backends.DistinctBy(x => x.Backend, ReferenceEqualityComparer.Instance)
            .Select(registration => ReleaseOneAsync(registration.Backend, _calls.GetValueOrDefault(registration.Backend))).ToArray();
        await Task.WhenAll(releases).ConfigureAwait(false);
        await ObserveAsync(cancellation).ConfigureAwait(false);
        if (_background is not null) await ObserveAsync(_background).ConfigureAwait(false);
        _stopping.Dispose();
    }

    private static async Task ReleaseOneAsync(IScanBackend backend, Task? call)
    {
        if (call is not null) await ObserveAsync(call).ConfigureAwait(false);
        try { await backend.DisposeAsync().ConfigureAwait(false); }
        catch { /* Redacted; a backend diagnostic may contain private device data. */ }
    }

    private async Task RefreshCoreAsync(TaskCompletionSource<DeviceList> completion)
    {
        try
        {
            if (_backends.Count == 0)
            {
                var empty = new DeviceList(Array.Empty<Device>(), new Discovery("idle", _time.GetUtcNow()));
                lock (_gate) { if (!_disposed) _cached = empty; }
                completion.TrySetResult(empty); return;
            }
            var results = await Task.WhenAll(_backends.Select(RefreshOneAsync)).ConfigureAwait(false);
            var devices = results.SelectMany(x => x.Devices).ToArray();
            var incomplete = results.SelectMany(x => x.Incomplete).ToArray();
            var snapshot = new DeviceList(devices, new Discovery("idle", _time.GetUtcNow(), incomplete));
            lock (_gate) { if (!_disposed) { _cached = snapshot; _owners.Clear(); foreach (var result in results) foreach (var device in result.Devices) { var owner = _backends.FirstOrDefault(x => x.Name == device.Driver); if (owner is not null) _owners[device.Id] = owner; } } }
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
                if (_disposed || IsBusy(registration.Backend))
                    return Incomplete(registration);
                probe = StartCall(registration.Backend, token => registration.Backend.RefreshDevicesAsync(token));
            }
            var value = await probe.WaitAsync(_timeout, _time, _stopping.Token).ConfigureAwait(false);
            return new(value, value.Discovery.IncompleteDrivers);
        }
        catch (OperationCanceledException) { return new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name)); }
        catch { return new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name)); }
    }

    private RefreshResult Incomplete(DiscoveryBackendRegistration registration)
        => new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name));

    private bool IsBusy(IScanBackend backend) => _calls.TryGetValue(backend, out var call) && !call.IsCompleted;

    // Called under _gate; only schedules work. All backend code and cancellation
    // callbacks run outside it. One retained slot per backend INSTANCE, across kinds.
    private Task<T> StartCall<T>(IScanBackend backend, Func<CancellationToken, ValueTask<T>> invoke)
    {
        var stopping = _stopping.Token;
        var call = Task.Run(async () =>
        {
            using var timeout = new CancellationTokenSource(_timeout, _time);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token, stopping);
            return await invoke(linked.Token).ConfigureAwait(false);
        });
        _calls[backend] = call;
        _ = ObserveAsync(call);
        return call;
    }

    private static ScanFailureException Failure(string code) => new(new ScanError(code, code, true), 0);

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
            if (!double.IsFinite(source.MaxAreaMm.WidthMm) || !double.IsFinite(source.MaxAreaMm.HeightMm) ||
                !double.IsFinite(source.MaxAreaMm.WidthMm * source.MaxAreaMm.HeightMm) || source.MaxAreaMm.WidthMm <= 0 ||
                source.MaxAreaMm.HeightMm <= 0 || source.Defaults.Resolution <= 0 || source.MaxPages is <= 0)
                throw new InvalidDataException("invalid capability snapshot");
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
