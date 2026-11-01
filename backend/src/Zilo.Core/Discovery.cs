using System.Collections.Immutable;

namespace Zilo.Core;

/// <summary>One route returned by discovery. Response enum values remain open strings.</summary>
public sealed record Device(
    string Id,
    string Name,
    string Driver,
    string Connection,
    string? Manufacturer = null,
    string? Model = null,
    bool Busy = false);

/// <summary>The discovery state that accompanied a cached or refreshed device list.</summary>
public sealed record Discovery
{
    public Discovery(string state, DateTimeOffset? lastCompletedAt, IEnumerable<string>? incompleteDrivers = null)
    {
        State = state ?? throw new ArgumentNullException(nameof(state));
        LastCompletedAt = lastCompletedAt;
        IncompleteDrivers = ImmutableArray.CreateRange(incompleteDrivers ?? Array.Empty<string>());
    }

    public string State { get; }
    public DateTimeOffset? LastCompletedAt { get; }
    public ImmutableArray<string> IncompleteDrivers { get; }
}

/// <summary>An immutable snapshot. Implementations may return this cached value without probing hardware.</summary>
public sealed record DeviceList
{
    public DeviceList(IEnumerable<Device> devices, Discovery discovery)
    {
        Devices = ImmutableArray.CreateRange(devices ?? throw new ArgumentNullException(nameof(devices)));
        Discovery = discovery ?? throw new ArgumentNullException(nameof(discovery));
    }

    public ImmutableArray<Device> Devices { get; }
    public Discovery Discovery { get; }
}
