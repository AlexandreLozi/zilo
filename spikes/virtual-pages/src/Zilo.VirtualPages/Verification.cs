using System.Globalization;
using System.Security.Cryptography;
using ZXing;
using ZXing.Common;
using ZXing.QrCode;

namespace Zilo.VirtualPages;

/// <summary>Reads the QR payload back from page pixels (ZXing.Net decoder, Apache-2.0).</summary>
public static class QrReader
{
    public static string? Decode(DecodedPng png)
    {
        var src = new RGBLuminanceSource(png.Luminance(), png.Width, png.Height, RGBLuminanceSource.BitmapFormat.Gray8);
        var hints = new Dictionary<DecodeHintType, object> { [DecodeHintType.TRY_HARDER] = true };
        return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(src)), hints)?.Text;
    }

    public static string? Decode(ReadOnlySpan<byte> png) => Decode(PngDecoder.Decode(png));
}

/// <summary>One generator input, with a stable name used for golden hashes and sample files.</summary>
public sealed record GoldenCase(PageSettings Settings, int PageIndex, Side Side, uint Seed)
{
    public string Name => string.Create(CultureInfo.InvariantCulture,
        $"{Settings.Paper.Name().ToLowerInvariant()}-{Settings.Mode.Name()}-{Settings.Dpi}dpi-{Settings.Source.Name()}-p{PageIndex}-{Side.Name()}-s{Seed}");

    public byte[] Generate() => PageGenerator.Generate(Settings, PageIndex, Side, Seed);

    public string Sha256() => Convert.ToHexStringLower(SHA256.HashData(Generate()));
}

public static class GoldenMatrix
{
    public const string Job = "golden";

    /// <summary>
    /// Every mode x paper x source at 75 dpi (duplex adds its back page), plus a DPI sweep
    /// 100..600 for gray A4 feeder and bw Letter flatbed, plus a second seed and page.
    /// </summary>
    public static IEnumerable<GoldenCase> Cases()
    {
        foreach (var mode in Enum.GetValues<ColorMode>())
        foreach (var paper in Enum.GetValues<PaperSize>())
        foreach (var source in Enum.GetValues<ScanSource>())
        {
            var s = new PageSettings(75, mode, paper, source, Job);
            yield return new GoldenCase(s, 1, Side.Front, 42);
            if (source == ScanSource.Duplex) yield return new GoldenCase(s, 2, Side.Back, 42);
        }
        foreach (var dpi in new[] { 100, 150, 200, 300, 600 })
        {
            yield return new GoldenCase(new PageSettings(dpi, ColorMode.Gray, PaperSize.A4, ScanSource.Feeder, Job), 1, Side.Front, 42);
            yield return new GoldenCase(new PageSettings(dpi, ColorMode.Bw, PaperSize.Letter, ScanSource.Flatbed, Job), 1, Side.Front, 42);
        }
        yield return new GoldenCase(new PageSettings(150, ColorMode.Color, PaperSize.A4, ScanSource.Feeder, Job), 7, Side.Front, 1234567);
    }

    /// <summary>Committed samples (all ≤ 150 dpi).</summary>
    public static IEnumerable<GoldenCase> Samples()
    {
        const string J = "sample-job";
        yield return new(new PageSettings(100, ColorMode.Color, PaperSize.A4, ScanSource.Feeder, J), 1, Side.Front, 42);
        yield return new(new PageSettings(100, ColorMode.Color, PaperSize.A4, ScanSource.Feeder, J), 2, Side.Front, 42);
        yield return new(new PageSettings(150, ColorMode.Gray, PaperSize.Letter, ScanSource.Flatbed, J), 1, Side.Front, 7);
        yield return new(new PageSettings(150, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder, J), 3, Side.Front, 7);
        yield return new(new PageSettings(75, ColorMode.Color, PaperSize.Legal, ScanSource.Duplex, J), 1, Side.Front, 99);
        yield return new(new PageSettings(75, ColorMode.Color, PaperSize.Legal, ScanSource.Duplex, J), 2, Side.Back, 99);
    }
}
