using System.Text.RegularExpressions;

namespace Zilo.VirtualPages;

/// <summary>Colour mode; wire names follow the T10 draft vocabulary (<c>color</c>, <c>gray</c>, <c>bw</c>).</summary>
public enum ColorMode { Color, Gray, Bw }

/// <summary>Paper size IDs supported by the prototype.</summary>
public enum PaperSize { A4, Letter, Legal, A5 }

/// <summary>Scan source; wire names follow the T10 draft vocabulary (<c>flatbed</c>, <c>feeder</c>, <c>duplex</c>).</summary>
public enum ScanSource { Flatbed, Feeder, Duplex }

/// <summary>Side of the sheet. Only duplex jobs produce back sides.</summary>
public enum Side { Front, Back }

/// <summary>
/// Scan settings for one job. <see cref="Job"/> is the job identifier that is written into the
/// banner and the QR payload; it is restricted to <c>[A-Za-z0-9._-]{1,40}</c> so that it needs no
/// JSON escaping and every character has a glyph.
/// </summary>
public sealed partial record PageSettings(
    int Dpi,
    ColorMode Mode,
    PaperSize Paper,
    ScanSource Source,
    string Job = "job")
{
    public const int MinDpi = 75;
    public const int MaxDpi = 600;

    public void Validate()
    {
        if (Dpi is < MinDpi or > MaxDpi)
            throw new ArgumentOutOfRangeException(nameof(Dpi), Dpi, $"DPI must be {MinDpi}..{MaxDpi}.");
        if (!Enum.IsDefined(Mode)) throw new ArgumentOutOfRangeException(nameof(Mode));
        if (!Enum.IsDefined(Paper)) throw new ArgumentOutOfRangeException(nameof(Paper));
        if (!Enum.IsDefined(Source)) throw new ArgumentOutOfRangeException(nameof(Source));
        if (Job is null || !JobPattern().IsMatch(Job))
            throw new ArgumentException("Job must match [A-Za-z0-9._-]{1,40}.", nameof(Job));
    }

    // \z, not $: in .NET, $ also matches before a final '\n', which would let "job\n" through
    // and break the QR JSON (review r1 M1).
    [GeneratedRegex(@"\A[A-Za-z0-9._-]{1,40}\z", RegexOptions.CultureInvariant)]
    private static partial Regex JobPattern();
}

public static class Wire
{
    public static string Name(this ColorMode m) => m switch
    {
        ColorMode.Color => "color",
        ColorMode.Gray => "gray",
        ColorMode.Bw => "bw",
        _ => throw new ArgumentOutOfRangeException(nameof(m)),
    };

    public static string Name(this PaperSize p) => p switch
    {
        PaperSize.A4 => "A4",
        PaperSize.Letter => "Letter",
        PaperSize.Legal => "Legal",
        PaperSize.A5 => "A5",
        _ => throw new ArgumentOutOfRangeException(nameof(p)),
    };

    public static string Name(this ScanSource s) => s switch
    {
        ScanSource.Flatbed => "flatbed",
        ScanSource.Feeder => "feeder",
        ScanSource.Duplex => "duplex",
        _ => throw new ArgumentOutOfRangeException(nameof(s)),
    };

    public static string Name(this Side s) => s switch
    {
        Side.Front => "front",
        Side.Back => "back",
        _ => throw new ArgumentOutOfRangeException(nameof(s)),
    };

    /// <summary>Paper size in tenths of a millimetre (exact for all four sizes).</summary>
    public static (int WidthTenthMm, int HeightTenthMm) Dimensions(this PaperSize p) => p switch
    {
        PaperSize.A4 => (2100, 2970),
        PaperSize.Letter => (2159, 2794),
        PaperSize.Legal => (2159, 3556),
        PaperSize.A5 => (1480, 2100),
        _ => throw new ArgumentOutOfRangeException(nameof(p)),
    };
}

/// <summary>One image in a job's order.</summary>
public readonly record struct PageRef(int PageIndex, Side Side);

public static class JobPlan
{
    /// <summary>
    /// The images a job of <paramref name="count"/> images produces, in order. Page indices are
    /// 1-based. Duplex alternates front/back (page 1 front, page 2 back of the same sheet, ...).
    /// The generator sets no limit; the caller decides the count (any non-negative int, including
    /// <see cref="int.MaxValue"/>).
    /// </summary>
    public static IEnumerable<PageRef> Pages(ScanSource source, int count)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(count);
        for (var i = 1; i <= count; i++)
        {
            yield return new PageRef(i, source == ScanSource.Duplex && i % 2 == 0 ? Side.Back : Side.Front);
            // Stop before i++ so that count == int.MaxValue cannot wrap to int.MinValue (review r1 M2).
            if (i == count) yield break;
        }
    }
}
