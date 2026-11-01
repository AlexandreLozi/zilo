using System.Collections.Immutable;
using System.Text.Json;

namespace Zilo.Core;

/// <summary>Closed request validation belongs to the job owner; this boundary preserves received values.</summary>
public sealed record ScanSettings(
    string Source,
    int? Resolution = null,
    string? ColorMode = null,
    string? PageSize = null,
    SizeMm? CustomPageSizeMm = null,
    int? MaxPages = null,
    bool Strict = false);

/// <summary>The settings received by a job owner, before defaults and driver adjustments.</summary>
public sealed record RequestedSettings(
    string Source,
    int? Resolution = null,
    string? ColorMode = null,
    string? PageSize = null,
    SizeMm? CustomPageSizeMm = null,
    int? MaxPages = null);

public sealed record EffectiveSettings(
    string Source,
    int Resolution,
    string ColorMode,
    string PageSize,
    SizeMm PageSizeMm,
    int? MaxPages);

/// <summary>A scalar setting change. Values are wire-compatible scalar values or null.</summary>
public sealed record Adjustment
{
    public Adjustment(string Field, object? Requested, object? Effective, string Reason)
    {
        this.Field = Field ?? throw new ArgumentNullException(nameof(Field));
        this.Requested = Scalar(Requested, nameof(Requested));
        this.Effective = Scalar(Effective, nameof(Effective));
        this.Reason = Reason ?? throw new ArgumentNullException(nameof(Reason));
    }

    public string Field { get; }
    public JsonElement? Requested { get; }
    public JsonElement? Effective { get; }
    public string Reason { get; }

    private static JsonElement? Scalar(object? value, string parameterName)
    {
        if (value is null) return null;
        if (value is JsonElement element)
        {
            if (element.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.Null))
                throw new ArgumentException("Adjustment values must be string, number, or null.", parameterName);
            return element.ValueKind == JsonValueKind.Null ? null : element.Clone();
        }
        if (value is bool || value is char || value is not (string or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal))
            throw new ArgumentException("Adjustment values must be string, number, or null.", parameterName);
        return JsonSerializer.SerializeToElement(value);
    }
}

public sealed record AcquisitionLimits
{
    public AcquisitionLimits(int MaxPages, long MaxPixelsPerPage, long MaxBytesPerPage)
    {
        if (MaxPages <= 0) throw new ArgumentOutOfRangeException(nameof(MaxPages));
        if (MaxPixelsPerPage <= 0) throw new ArgumentOutOfRangeException(nameof(MaxPixelsPerPage));
        if (MaxBytesPerPage <= 0) throw new ArgumentOutOfRangeException(nameof(MaxBytesPerPage));
        this.MaxPages = MaxPages;
        this.MaxPixelsPerPage = MaxPixelsPerPage;
        this.MaxBytesPerPage = MaxBytesPerPage;
    }
    public int MaxPages { get; }
    public long MaxPixelsPerPage { get; }
    public long MaxBytesPerPage { get; }
}

public sealed record ScanRequest(JobId JobId, string DeviceId, EffectiveSettings Settings, AcquisitionLimits Limits);

public sealed record PageResolution
{
    public PageResolution(int X, int Y)
    {
        if (X <= 0) throw new ArgumentOutOfRangeException(nameof(X));
        if (Y <= 0) throw new ArgumentOutOfRangeException(nameof(Y));
        this.X = X; this.Y = Y;
    }
    public int X { get; }
    public int Y { get; }
}

/// <summary>
/// Immutable page metadata and bytes. The constructor copies the supplied bytes; consumers may retain
/// this value after acquisition failure, cancellation, enumerator disposal, or backend disposal.
/// </summary>
public sealed record Page
{
    public Page(
        int Index,
        int Sheet,
        string Side,
        int WidthPx,
        int HeightPx,
        PageResolution Resolution,
        string ColorMode,
        string ETag,
        DateTimeOffset CreatedAt,
        IEnumerable<byte> Bytes,
        EffectiveSettings? AppliedSettings = null,
        IEnumerable<Adjustment>? Adjustments = null,
        string ContentType = "image/png")
    {
        if (Index < 0) throw new ArgumentOutOfRangeException(nameof(Index));
        if (Sheet < 0) throw new ArgumentOutOfRangeException(nameof(Sheet));
        if (WidthPx <= 0) throw new ArgumentOutOfRangeException(nameof(WidthPx));
        if (HeightPx <= 0) throw new ArgumentOutOfRangeException(nameof(HeightPx));
        this.Index = Index;
        this.Sheet = Sheet;
        this.Side = Side ?? throw new ArgumentNullException(nameof(Side));
        this.WidthPx = WidthPx;
        this.HeightPx = HeightPx;
        this.Resolution = Resolution ?? throw new ArgumentNullException(nameof(Resolution));
        this.ColorMode = ColorMode ?? throw new ArgumentNullException(nameof(ColorMode));
        this.ETag = ETag ?? throw new ArgumentNullException(nameof(ETag));
        this.CreatedAt = CreatedAt;
        this.Bytes = ImmutableArray.CreateRange(Bytes ?? throw new ArgumentNullException(nameof(Bytes)));
        this.AppliedSettings = AppliedSettings;
        this.Adjustments = ImmutableArray.CreateRange(Adjustments ?? Array.Empty<Adjustment>());
        this.ContentType = ContentType ?? throw new ArgumentNullException(nameof(ContentType));
    }

    public int Index { get; }
    public int Sheet { get; }
    public string Side { get; }
    public int WidthPx { get; }
    public int HeightPx { get; }
    public PageResolution Resolution { get; }
    public string ColorMode { get; }
    public string ETag { get; }
    public DateTimeOffset CreatedAt { get; }
    public ImmutableArray<byte> Bytes { get; }
    public EffectiveSettings? AppliedSettings { get; }
    public ImmutableArray<Adjustment> Adjustments { get; }
    public string ContentType { get; }
}

public sealed record ScanError(string Code, string Message, bool Retryable, string? ErrorId = null);

/// <summary>A scanner failure, distinct from OperationCanceledException.</summary>
public sealed class ScanFailureException : Exception
{
    public ScanFailureException(ScanError Error, int PagesKept, Exception? InnerException = null)
        : base(Error?.Message ?? throw new ArgumentNullException(nameof(Error)), InnerException)
    {
        if (PagesKept < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(PagesKept));
        }

        this.Error = Error;
        this.PagesKept = PagesKept;
    }

    public ScanError Error { get; }
    public int PagesKept { get; }
}
