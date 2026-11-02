using System.Collections.Immutable;
using Zilo.Core;

namespace Zilo.Agent;

public sealed class DiscoveryService
{
    private readonly IReadOnlyList<DiscoveryBackendRegistration> _backends;
    private readonly TimeSpan _timeout;
    private readonly object _gate = new();
    private DeviceList _cached = new(Array.Empty<Device>(), new Discovery("idle", null));
    private Task<DeviceList>? _refresh;
    private readonly Dictionary<string, DiscoveryBackendRegistration> _owners = new(StringComparer.Ordinal);

    public DiscoveryService(IEnumerable<DiscoveryBackendRegistration>? backends, TimeSpan? timeout = null)
    { _backends = (backends ?? Array.Empty<DiscoveryBackendRegistration>()).ToArray(); _timeout = timeout ?? TimeSpan.FromSeconds(15); }

    public DeviceList List() { lock (_gate) return _cached; }

    public ValueTask<DeviceList> ListAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(List());

    public Task<DeviceList> RefreshAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            if (_refresh is null || _refresh.IsCompleted)
            {
                var source = new TaskCompletionSource<DeviceList>(TaskCreationOptions.RunContinuationsAsynchronously);
                _refresh = source.Task;
                _ = RefreshCoreAsync(source);
            }
            return AwaitRefreshAsync(_refresh, cancellationToken);
        }
    }

    public async ValueTask<DeviceCaps?> GetCapsAsync(string deviceId, CancellationToken cancellationToken = default)
    {
        DiscoveryBackendRegistration? owner;
        lock (_gate) _owners.TryGetValue(deviceId, out owner);
        if (owner is not null) return await owner.Backend.GetDeviceCapsAsync(deviceId, cancellationToken);
        return null;
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
            lock (_gate) { _cached = snapshot; foreach (var result in results) foreach (var device in result.Devices) { var owner = _backends.FirstOrDefault(x => x.Name == device.Driver); if (owner is not null) _owners[device.Id] = owner; } }
            completion.TrySetResult(snapshot);
        }
        catch (Exception error) { completion.TrySetException(error); }
        finally { lock (_gate) _refresh = null; }
    }

    private async Task<RefreshResult> RefreshOneAsync(DiscoveryBackendRegistration registration)
    {
        try
        {
            using var timeout = new CancellationTokenSource(_timeout);
            var value = await registration.Backend.RefreshDevicesAsync(timeout.Token).ConfigureAwait(false);
            return new(value, value.Discovery.IncompleteDrivers);
        }
        catch (OperationCanceledException) { return new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name)); }
        catch { return new(new DeviceList(List().Devices.Where(d => d.Driver == registration.Name), new Discovery("idle", null)), ImmutableArray.Create(registration.Name)); }
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
            if (source.MaxAreaMm.WidthMm <= 0 || source.MaxAreaMm.HeightMm <= 0 || source.Defaults.Resolution <= 0) throw new InvalidDataException("invalid capability snapshot");
            if (caps.Limits?.MaxResolutionDpi is { } maxResolution && source.Defaults.Resolution > maxResolution) throw new InvalidDataException("invalid capability snapshot");
            foreach (var size in source.PageSizes) if (string.IsNullOrWhiteSpace(size.Id) || size.WidthMm <= 0 || size.HeightMm <= 0 || size.WidthMm > source.MaxAreaMm.WidthMm || size.HeightMm > source.MaxAreaMm.HeightMm) throw new InvalidDataException("invalid capability snapshot");
            if (source.Resolutions.Kind == "list" && (source.Resolutions.Values.IsDefaultOrEmpty || source.Resolutions.Values.Any(value => value <= 0))) throw new InvalidDataException("invalid capability snapshot");
            if (source.Resolutions.Kind == "range" && (source.Resolutions.Min is null || source.Resolutions.Max is null || source.Resolutions.Step is null || source.Resolutions.Min <= 0 || source.Resolutions.Max < source.Resolutions.Min || source.Resolutions.Step <= 0)) throw new InvalidDataException("invalid capability snapshot");
        }
    }
}
