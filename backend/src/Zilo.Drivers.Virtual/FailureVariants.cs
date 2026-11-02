using System.Text.Json;
using System.Text.Json.Serialization;
using Zilo.Core;

namespace Zilo.Drivers.Virtual;

public enum FailureKind { None, FeederEmpty, PaperJam, CoverOpen, Timeout, Disconnect, Slow }

/// <summary>
/// A virtual-device failure variant. Data only: T12 decides how the driver acts on it.
/// <list type="bullet">
/// <item><c>FeederEmpty</c>: the feeder holds <see cref="AfterPages"/> pages. With 0 the job fails
///   with <c>feeder-empty</c> before any page; with N &gt; 0 the job completes normally after N
///   pages (T10 R-J1: running out after at least one page is not an error).</item>
/// <item><c>PaperJam</c> / <c>Timeout</c> / <c>Disconnect</c>: pages 1..k-1 are delivered, then the
///   job fails with <see cref="ErrorCode"/> at page <see cref="AtPage"/> = k; delivered pages are kept.</item>
/// <item><c>CoverOpen</c>: fails before the first page.</item>
/// <item><c>Slow</c>: every page is delayed by <see cref="DelayMs"/>; no error.</item>
/// </list>
/// </summary>
public sealed record FailureVariant
{
    public FailureVariant(string DeviceId, string DeviceName, FailureKind Kind, string? ErrorCode,
        int? AfterPages = null, int? AtPage = null, int? DelayMs = null)
    {
        _ = new RouteId(DeviceId);
        if (string.IsNullOrWhiteSpace(DeviceName)) throw new ArgumentException("DeviceName is required.", nameof(DeviceName));
        if (!Enum.IsDefined(Kind)) throw new ArgumentOutOfRangeException(nameof(Kind));
        if (AfterPages is < 0) throw new ArgumentOutOfRangeException(nameof(AfterPages));
        if (AtPage is < 1) throw new ArgumentOutOfRangeException(nameof(AtPage));
        if (DelayMs is < 0) throw new ArgumentOutOfRangeException(nameof(DelayMs));
        switch (Kind)
        {
            case FailureKind.None when ErrorCode is not null || AfterPages is not null || AtPage is not null || DelayMs is not null:
                throw new ArgumentException("A healthy route cannot carry failure parameters.", nameof(ErrorCode));
            case FailureKind.FeederEmpty when AfterPages is null || AtPage is not null || DelayMs is not null ||
                (AfterPages == 0 ? ErrorCode != "feeder-empty" : ErrorCode is not null):
                throw new ArgumentException("Feeder-empty routes require a coherent page count.", nameof(AfterPages));
            case FailureKind.PaperJam when AtPage is null || ErrorCode != "paper-jam" || AfterPages is not null || DelayMs is not null:
                throw new ArgumentException("Paper-jam routes require an at-page value.", nameof(AtPage));
            case FailureKind.CoverOpen when ErrorCode != "cover-open" || AfterPages is not null || AtPage is not null || DelayMs is not null:
                throw new ArgumentException("Cover-open routes have no page parameters.", nameof(ErrorCode));
            case FailureKind.Timeout when AtPage is null || ErrorCode != "timeout" || AfterPages is not null || DelayMs is not null:
                throw new ArgumentException("Timeout routes require an at-page value.", nameof(AtPage));
            case FailureKind.Disconnect when AtPage is null || ErrorCode != "disconnected" || AfterPages is not null || DelayMs is not null:
                throw new ArgumentException("Disconnect routes require an at-page value.", nameof(AtPage));
            case FailureKind.Slow when DelayMs is null || ErrorCode is not null || AfterPages is not null || AtPage is not null:
                throw new ArgumentException("Slow routes require a delay value.", nameof(DelayMs));
        }
        this.DeviceId = DeviceId; this.DeviceName = DeviceName; this.Kind = Kind; this.ErrorCode = ErrorCode;
        this.AfterPages = AfterPages; this.AtPage = AtPage; this.DelayMs = DelayMs;
    }
    public string DeviceId { get; }
    public string DeviceName { get; }
    public FailureKind Kind { get; }
    public string? ErrorCode { get; }
    public int? AfterPages { get; }
    public int? AtPage { get; }
    public int? DelayMs { get; }
}

public static class VirtualDevices
{
    public const string BaseName = "Zilo Virtual Scanner";

    /// <summary>The default catalogue: the healthy device plus one device per failure variant.</summary>
    public static IReadOnlyList<FailureVariant> Catalogue { get; } =
    [
        new("virtual", BaseName, FailureKind.None, null),
        new("virtual-feeder-empty", $"{BaseName} (feeder empty)", FailureKind.FeederEmpty, "feeder-empty", AfterPages: 0),
        new("virtual-feeder-3", $"{BaseName} (feeder holds 3 pages)", FailureKind.FeederEmpty, null, AfterPages: 3),
        new("virtual-paper-jam", $"{BaseName} (paper jam at page 2)", FailureKind.PaperJam, "paper-jam", AtPage: 2),
        new("virtual-cover-open", $"{BaseName} (cover open)", FailureKind.CoverOpen, "cover-open"),
        new("virtual-timeout", $"{BaseName} (timeout at page 2)", FailureKind.Timeout, "timeout", AtPage: 2),
        new("virtual-disconnect", $"{BaseName} (disconnect at page 2)", FailureKind.Disconnect, "disconnected", AtPage: 2),
        new("virtual-slow", $"{BaseName} (slow, 1500 ms per page)", FailureKind.Slow, null, DelayMs: 1500),
    ];

    /// <summary>Builds a variant with custom parameters, validating them.</summary>
    public static FailureVariant Create(FailureKind kind, int n = 0)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(n);
        return kind switch
        {
            FailureKind.None => Catalogue[0],
            FailureKind.FeederEmpty => new($"virtual-feeder-{n}", $"{BaseName} (feeder holds {n} pages)", kind, n == 0 ? "feeder-empty" : null, AfterPages: n),
            FailureKind.PaperJam => new($"virtual-paper-jam-{Pos(n)}", $"{BaseName} (paper jam at page {Pos(n)})", kind, "paper-jam", AtPage: Pos(n)),
            FailureKind.CoverOpen => Catalogue[4],
            FailureKind.Timeout => new($"virtual-timeout-{Pos(n)}", $"{BaseName} (timeout at page {Pos(n)})", kind, "timeout", AtPage: Pos(n)),
            FailureKind.Disconnect => new($"virtual-disconnect-{Pos(n)}", $"{BaseName} (disconnect at page {Pos(n)})", kind, "disconnected", AtPage: Pos(n)),
            FailureKind.Slow => new($"virtual-slow-{n}", $"{BaseName} (slow, {n} ms per page)", kind, null, DelayMs: n),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

        static int Pos(int k) => k >= 1 ? k : throw new ArgumentOutOfRangeException(nameof(n), "Page must be >= 1.");
    }

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.KebabCaseLower) },
    };

    public static string CatalogueJson() => JsonSerializer.Serialize(Catalogue, JsonOptions) + "\n";
}
