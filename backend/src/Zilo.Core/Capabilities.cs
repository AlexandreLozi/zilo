using System.Collections.Immutable;

namespace Zilo.Core;

/// <summary>Open response resolution capability. Unknown kinds are retained and are not guessed.</summary>
public sealed record ResolutionCaps
{
    public ResolutionCaps(string Kind, IEnumerable<int>? Values = null, int? Min = null, int? Max = null, int? Step = null)
    {
        this.Kind = Kind ?? throw new ArgumentNullException(nameof(Kind));
        this.Values = ImmutableArray.CreateRange(Values ?? Array.Empty<int>());
        this.Min = Min;
        this.Max = Max;
        this.Step = Step;
    }

    public string Kind { get; }
    public ImmutableArray<int> Values { get; }
    public int? Min { get; }
    public int? Max { get; }
    public int? Step { get; }

    public static ResolutionCaps List(IEnumerable<int> values) => new("list", values);
    public static ResolutionCaps Range(int min, int max, int step) => new("range", null, min, max, step);
    public static ResolutionCaps Unknown(string kind) => new(kind);
}

public sealed record PageSize(string Id, double WidthMm, double HeightMm);

public sealed record SizeMm(double WidthMm, double HeightMm);

public sealed record SourceDefaults(int Resolution, string ColorMode, string PageSize);

/// <summary>Capabilities for one source. Source and all enum-like values are open response strings.</summary>
public sealed record SourceCaps
{
    public SourceCaps(
        string Source,
        ResolutionCaps Resolutions,
        IEnumerable<string> ColorModes,
        IEnumerable<PageSize> PageSizes,
        SizeMm MaxAreaMm,
        bool CustomPageSize,
        int? MaxPages,
        SourceDefaults Defaults)
    {
        this.Source = Source ?? throw new ArgumentNullException(nameof(Source));
        this.Resolutions = Resolutions ?? throw new ArgumentNullException(nameof(Resolutions));
        this.ColorModes = ImmutableArray.CreateRange(ColorModes ?? throw new ArgumentNullException(nameof(ColorModes)));
        this.PageSizes = ImmutableArray.CreateRange(PageSizes ?? throw new ArgumentNullException(nameof(PageSizes)));
        this.MaxAreaMm = MaxAreaMm ?? throw new ArgumentNullException(nameof(MaxAreaMm));
        this.CustomPageSize = CustomPageSize;
        this.MaxPages = MaxPages;
        this.Defaults = Defaults ?? throw new ArgumentNullException(nameof(Defaults));
    }

    public string Source { get; }
    public ResolutionCaps Resolutions { get; }
    public ImmutableArray<string> ColorModes { get; }
    public ImmutableArray<PageSize> PageSizes { get; }
    public SizeMm MaxAreaMm { get; }
    public bool CustomPageSize { get; }
    public int? MaxPages { get; }
    public SourceDefaults Defaults { get; }
}

public sealed record DeviceLimits(int? MaxPagesPerJob = null, long? MaxPixelsPerPage = null, int? MaxResolutionDpi = null);

public sealed record DeviceCaps
{
    public DeviceCaps(string DeviceId, IEnumerable<SourceCaps> Sources, DeviceLimits? Limits = null)
    {
        this.DeviceId = DeviceId ?? throw new ArgumentNullException(nameof(DeviceId));
        this.Sources = ImmutableArray.CreateRange(Sources ?? throw new ArgumentNullException(nameof(Sources)));
        this.Limits = Limits;
    }

    public string DeviceId { get; }
    public ImmutableArray<SourceCaps> Sources { get; }
    public DeviceLimits? Limits { get; }
}
