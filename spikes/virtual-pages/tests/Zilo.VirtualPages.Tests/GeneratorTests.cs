using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Xunit;

namespace Zilo.VirtualPages.Tests;

public class GoldenTests
{
    private static readonly Dictionary<string, string> Golden =
        JsonSerializer.Deserialize<Dictionary<string, string>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "golden-hashes.json")))!;

    public static TheoryData<string> CaseNames()
    {
        var d = new TheoryData<string>();
        foreach (var c in GoldenMatrix.Cases()) d.Add(c.Name);
        return d;
    }

    [Fact]
    public void Golden_file_covers_exactly_the_matrix()
    {
        var names = GoldenMatrix.Cases().Select(c => c.Name).ToList();
        Assert.Equal(names.Count, names.Distinct().Count());
        Assert.Equal(names.Order(StringComparer.Ordinal), Golden.Keys.Order(StringComparer.Ordinal));
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Png_bytes_match_golden_hash(string name)
    {
        var c = GoldenMatrix.Cases().Single(x => x.Name == name);
        Assert.Equal(Golden[name], c.Sha256());
    }
}

public class QrTests
{
    public static TheoryData<int, ColorMode, PaperSize, ScanSource, int, Side> Cases()
    {
        var d = new TheoryData<int, ColorMode, PaperSize, ScanSource, int, Side>();
        foreach (var dpi in new[] { 75, 150, 300 })
        foreach (var mode in Enum.GetValues<ColorMode>())
        foreach (var paper in Enum.GetValues<PaperSize>())
            d.Add(dpi, mode, paper, ScanSource.Feeder, 1, Side.Front);
        d.Add(100, ColorMode.Color, PaperSize.A4, ScanSource.Duplex, 2, Side.Back);
        d.Add(100, ColorMode.Bw, PaperSize.Letter, ScanSource.Duplex, 12345, Side.Back);
        d.Add(600, ColorMode.Bw, PaperSize.A5, ScanSource.Flatbed, 1, Side.Front);
        return d;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Qr_decoded_from_png_pixels_carries_job_page_and_settings(
        int dpi, ColorMode mode, PaperSize paper, ScanSource source, int page, Side side)
    {
        var s = new PageSettings(dpi, mode, paper, source, "Job_42.x-y");
        const uint seed = 4000000000;
        var text = QrReader.Decode(PageGenerator.Generate(s, page, side, seed));

        Assert.Equal(PageGenerator.QrPayload(s, page, side, seed), text);
        using var doc = JsonDocument.Parse(text!);
        var r = doc.RootElement;
        Assert.Equal(["job", "page", "side", "dpi", "mode", "paper", "seed"], r.EnumerateObject().Select(p => p.Name));
        Assert.Equal("Job_42.x-y", r.GetProperty("job").GetString());
        Assert.Equal(page, r.GetProperty("page").GetInt32());
        Assert.Equal(side.Name(), r.GetProperty("side").GetString());
        Assert.Equal(dpi, r.GetProperty("dpi").GetInt32());
        Assert.Equal(mode.Name(), r.GetProperty("mode").GetString());
        Assert.Equal(paper.Name(), r.GetProperty("paper").GetString());
        Assert.Equal(seed, r.GetProperty("seed").GetUInt32());
    }

    [Fact]
    public void Job_order_is_recoverable_from_pixels()
    {
        var s = new PageSettings(75, ColorMode.Gray, PaperSize.A4, ScanSource.Duplex, "order");
        var decoded = JobPlan.Pages(s.Source, 5)
            .Select(p => JsonDocument.Parse(QrReader.Decode(PageGenerator.Generate(s, p.PageIndex, p.Side, 9))!).RootElement)
            .Select(e => (e.GetProperty("page").GetInt32(), e.GetProperty("side").GetString()))
            .ToList();
        Assert.Equal([(1, "front"), (2, "back"), (3, "front"), (4, "back"), (5, "front")], decoded);
    }
}

public class SampleTests
{
    private static string SampleDir => Path.Combine(AppContext.BaseDirectory, "samples");

    public static TheoryData<string> SampleNames()
    {
        var d = new TheoryData<string>();
        foreach (var c in GoldenMatrix.Samples()) d.Add(c.Name);
        return d;
    }

    [Theory]
    [MemberData(nameof(SampleNames))]
    public void Committed_sample_is_current_and_its_qr_json_is_what_the_pixels_decode_to(string name)
    {
        var c = GoldenMatrix.Samples().Single(x => x.Name == name);
        Assert.True(c.Settings.Dpi <= 150);
        var committed = File.ReadAllBytes(Path.Combine(SampleDir, name + ".png"));
        Assert.Equal(c.Generate(), committed);
        var json = File.ReadAllText(Path.Combine(SampleDir, name + ".qr.json")).TrimEnd('\n');
        Assert.Equal(json, QrReader.Decode(committed));
        Assert.Equal(PageGenerator.QrPayload(c.Settings, c.PageIndex, c.Side, c.Seed), json);
    }

    [Fact]
    public void Committed_failure_variants_json_is_current()
    {
        Assert.Equal(VirtualDevices.CatalogueJson(), File.ReadAllText(Path.Combine(SampleDir, "failure-variants.json")));
    }
}

public class RulerTests
{
    public static TheoryData<int, PaperSize> Dpis()
    {
        var d = new TheoryData<int, PaperSize>();
        foreach (var dpi in new[] { 75, 96, 100, 150, 200, 240, 300, 400, 600 }) d.Add(dpi, PaperSize.A4);
        d.Add(75, PaperSize.A5);
        d.Add(300, PaperSize.Letter);
        d.Add(150, PaperSize.Legal);
        return d;
    }

    private static bool Dark(DecodedPng p, int x, int y) => p.Raster[x, y].Luma < 128;

    private static List<int> RisingEdgesInRow(DecodedPng p, int y, int fromX, int toX)
    {
        var e = new List<int>();
        for (var x = Math.Max(1, fromX); x < Math.Min(p.Width, toX); x++)
            if (Dark(p, x, y) && !Dark(p, x - 1, y)) e.Add(x);
        return e;
    }

    private static List<int> RisingEdgesInColumn(DecodedPng p, int x, int fromY, int toY)
    {
        var e = new List<int>();
        for (var y = Math.Max(1, fromY); y < Math.Min(p.Height, toY); y++)
            if (Dark(p, x, y) && !Dark(p, x, y - 1)) e.Add(y);
        return e;
    }

    [Theory]
    [MemberData(nameof(Dpis))]
    public void Ruler_ticks_in_pixels_match_the_true_dpi(int dpi, PaperSize paper)
    {
        var s = new PageSettings(dpi, ColorMode.Gray, paper, ScanSource.Flatbed);
        var png = PngDecoder.Decode(PageGenerator.Generate(s, 1, Side.Front, 1));
        var l = PageGenerator.Layout(s, 1, Side.Front, 1);
        var t = l.TickThicknessPx;

        Assert.Equal(l.WidthPx, png.Width);
        Assert.Equal(Math.Round(dpi / 0.0254), png.PixelsPerMetre!.Value, 0);

        // Horizontal mm ruler: every 1 mm tick, measured from pixels.
        var y = l.MmRulerBaselineY + t + (l.Px(20) - t) / 2;
        var mm = RisingEdgesInRow(png, y, l.MmRulerOriginX - 2, png.Width);
        Assert.Equal(l.MmRulerLengthMm + 1, mm.Count);
        for (var k = 0; k < mm.Count; k++)
            Assert.InRange(mm[k] - mm[0] - k * dpi / 25.4, -0.5, 0.5);
        Assert.InRange((mm[100] - mm[0]) / (100 / 25.4), dpi - 0.26, dpi + 0.26);

        // Horizontal inch ruler: every 1/8 inch; whole inches are exactly dpi pixels apart.
        var yi = l.InchRulerBaselineY - 1 - (l.Px(15) - t - 1) / 2;
        var inch = RisingEdgesInRow(png, yi, l.InchRulerOriginX - 2, png.Width);
        Assert.Equal(l.InchRulerLengthEighths + 1, inch.Count);
        for (var k = 0; k < inch.Count; k++)
            Assert.InRange(inch[k] - inch[0] - k * dpi / 8.0, -0.5, 0.5);
        for (var k = 8; k < inch.Count; k += 8) Assert.Equal(dpi * (k / 8), inch[k] - inch[0]);

        // Vertical mm ruler in the left margin.
        var xv = l.VRulerBaselineX - 1 - (l.Px(20) - t - 1) / 2;
        var v = RisingEdgesInColumn(png, xv, l.VRulerOriginY - 2, png.Height);
        Assert.Equal(l.VRulerLengthMm + 1, v.Count);
        for (var k = 0; k < v.Count; k++)
            Assert.InRange(v[k] - v[0] - k * dpi / 25.4, -0.5, 0.5);
    }

    [Theory]
    [InlineData(PaperSize.A4, 75, 620, 877)]
    [InlineData(PaperSize.A4, 300, 2480, 3508)]
    [InlineData(PaperSize.Letter, 600, 5100, 6600)]
    [InlineData(PaperSize.Legal, 100, 850, 1400)]
    [InlineData(PaperSize.A5, 150, 874, 1240)]
    public void Page_dimensions_follow_paper_and_dpi(PaperSize paper, int dpi, int w, int h)
    {
        var l = PageGenerator.Layout(new PageSettings(dpi, ColorMode.Bw, paper, ScanSource.Feeder), 1, Side.Front, 0);
        Assert.Equal((w, h), (l.WidthPx, l.HeightPx));
    }
}

public class DeterminismTests
{
    [Fact]
    public void Same_inputs_give_identical_bytes_across_runs_and_threads()
    {
        var s = new PageSettings(150, ColorMode.Color, PaperSize.Letter, ScanSource.Duplex, "det");
        var first = PageGenerator.Generate(s, 4, Side.Back, 77);
        var parallel = new byte[8][];
        Parallel.For(0, parallel.Length, i => parallel[i] = PageGenerator.Generate(s, 4, Side.Back, 77));
        foreach (var p in parallel) Assert.Equal(first, p);
        Assert.Equal(first, PageGenerator.Generate(s with { }, 4, Side.Back, 77));
    }

    [Fact]
    public void Each_input_changes_the_output()
    {
        var s = new PageSettings(75, ColorMode.Color, PaperSize.A4, ScanSource.Duplex, "j");
        var baseHash = Hash(PageGenerator.Generate(s, 1, Side.Front, 1));
        var variants = new[]
        {
            PageGenerator.Generate(s, 1, Side.Front, 2),
            PageGenerator.Generate(s, 2, Side.Front, 1),
            PageGenerator.Generate(s, 1, Side.Back, 1),
            PageGenerator.Generate(s with { Job = "k" }, 1, Side.Front, 1),
            PageGenerator.Generate(s with { Dpi = 76 }, 1, Side.Front, 1),
            PageGenerator.Generate(s with { Mode = ColorMode.Gray }, 1, Side.Front, 1),
            PageGenerator.Generate(s with { Paper = PaperSize.Letter }, 1, Side.Front, 1),
            PageGenerator.Generate(s with { Source = ScanSource.Feeder }, 1, Side.Front, 1),
        }.Select(Hash).ToList();
        Assert.DoesNotContain(baseHash, variants);
        Assert.Equal(variants.Count, variants.Distinct().Count());
    }

    private static string Hash(byte[] b) => Convert.ToHexString(SHA256.HashData(b));
}

public class EncodingTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(1000)]
    [InlineData(300000)]
    public void Deflate_output_inflates_back_with_the_runtime_zlib(int size)
    {
        var rng = new Random(size);
        var data = new byte[size];
        for (var i = 0; i < size; i++) data[i] = (byte)(i % 3000 < 1500 ? rng.Next(4) : 255); // runs + noise
        var z = Deflate.ZlibCompress(data);
        using var ms = new MemoryStream(z);
        using var zs = new ZLibStream(ms, CompressionMode.Decompress);
        using var outMs = new MemoryStream();
        zs.CopyTo(outMs);
        Assert.Equal(data, outMs.ToArray());
    }

    [Theory]
    [InlineData(ColorMode.Color, 8, 2)]
    [InlineData(ColorMode.Gray, 8, 0)]
    [InlineData(ColorMode.Bw, 1, 0)]
    public void Png_round_trips_pixels_in_each_mode(ColorMode mode, int depth, int type)
    {
        var s = new PageSettings(75, mode, PaperSize.A5, ScanSource.Feeder);
        var raster = PageGenerator.Render(s, 1, Side.Front, 3, out _);
        var png = PngDecoder.Decode(PngEncoder.Encode(raster, mode, 75));
        Assert.Equal((depth, type), (png.BitDepth, png.ColorType));
        for (var y = 0; y < raster.Height; y += 3)
        for (var x = 0; x < raster.Width; x += 3)
        {
            var src = raster[x, y];
            var got = png.Raster[x, y];
            switch (mode)
            {
                case ColorMode.Color: Assert.Equal(src, got); break;
                case ColorMode.Gray: Assert.Equal(Rgb.Gray(src.Luma), got); break;
                default:
                    Assert.True(got == Rgb.White || got == Rgb.Black);
                    if (src.Luma is 0 or 255) Assert.Equal(Rgb.Gray(src.Luma), got);
                    break;
            }
        }
    }
}

public class SettingsTests
{
    [Theory]
    [InlineData(74)]
    [InlineData(601)]
    public void Dpi_outside_75_to_600_is_rejected(int dpi) =>
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PageGenerator.Generate(new PageSettings(dpi, ColorMode.Bw, PaperSize.A4, ScanSource.Feeder), 1, Side.Front, 0));

    [Theory]
    [InlineData("")]
    [InlineData("has space")]
    [InlineData("quote\"")]
    [InlineData("01234567890123456789012345678901234567890")]
    public void Unsafe_job_ids_are_rejected(string job) =>
        Assert.Throws<ArgumentException>(() =>
            PageGenerator.Generate(new PageSettings(75, ColorMode.Bw, PaperSize.A4, ScanSource.Feeder, job), 1, Side.Front, 0));

    [Fact]
    public void Back_side_requires_duplex_and_page_index_is_one_based()
    {
        var s = new PageSettings(75, ColorMode.Bw, PaperSize.A4, ScanSource.Feeder);
        Assert.Throws<ArgumentException>(() => PageGenerator.Generate(s, 1, Side.Back, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => PageGenerator.Generate(s, 0, Side.Front, 0));
    }

    [Fact]
    public void Job_plan_has_no_built_in_page_limit_and_alternates_sides_for_duplex()
    {
        Assert.Equal(1000, JobPlan.Pages(ScanSource.Feeder, 1000).Count());
        Assert.All(JobPlan.Pages(ScanSource.Flatbed, 3), p => Assert.Equal(Side.Front, p.Side));
        Assert.Equal([Side.Front, Side.Back, Side.Front], JobPlan.Pages(ScanSource.Duplex, 3).Select(p => p.Side));
    }
}

public class FailureVariantTests
{
    private static readonly string[] T10ErrorCodes = ["feeder-empty", "paper-jam", "cover-open", "timeout", "disconnected"];

    [Fact]
    public void Catalogue_has_one_device_per_variant_with_unique_ids_and_t10_error_codes()
    {
        var c = VirtualDevices.Catalogue;
        Assert.Equal(c.Count, c.Select(v => v.DeviceId).Distinct().Count());
        Assert.All(c, v => Assert.StartsWith(VirtualDevices.BaseName, v.DeviceName));
        Assert.All(c.Where(v => v.ErrorCode is not null), v => Assert.Contains(v.ErrorCode, T10ErrorCodes));
        foreach (var kind in Enum.GetValues<FailureKind>()) Assert.Contains(c, v => v.Kind == kind);
        Assert.All(c.Where(v => v.Kind is FailureKind.PaperJam or FailureKind.Timeout or FailureKind.Disconnect),
            v => Assert.True(v.AtPage >= 1));
    }

    [Fact]
    public void Feeder_empty_is_an_error_only_when_no_page_was_fed()
    {
        Assert.Equal("feeder-empty", VirtualDevices.Create(FailureKind.FeederEmpty, 0).ErrorCode);
        Assert.Null(VirtualDevices.Create(FailureKind.FeederEmpty, 4).ErrorCode);
        Assert.Equal(4, VirtualDevices.Create(FailureKind.FeederEmpty, 4).AfterPages);
    }

    [Fact]
    public void Custom_variants_validate_parameters()
    {
        Assert.Equal(5, VirtualDevices.Create(FailureKind.PaperJam, 5).AtPage);
        Assert.Equal(250, VirtualDevices.Create(FailureKind.Slow, 250).DelayMs);
        Assert.Throws<ArgumentOutOfRangeException>(() => VirtualDevices.Create(FailureKind.Disconnect, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => VirtualDevices.Create(FailureKind.Timeout, -1));
    }

    [Fact]
    public void Catalogue_round_trips_through_json()
    {
        var back = JsonSerializer.Deserialize<List<FailureVariant>>(VirtualDevices.CatalogueJson(), VirtualDevices.JsonOptions)!;
        Assert.Equal(VirtualDevices.Catalogue, back);
    }
}
