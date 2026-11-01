using System.Reflection;
using System.Text.Json;
using Xunit;

namespace Zilo.VirtualPages.Tests;

// Review r1 regressions (red against author SHA 0afb9c4) plus fix r1 coverage.
public class ReviewR1RegressionTests
{
    [Fact]
    public void Job_id_with_trailing_newline_must_be_rejected()
    {
        var s = new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder, "job\n");
        Assert.Throws<ArgumentException>(() => PageGenerator.Generate(s, 1, Side.Front, 0));
    }

    // Fix r1: the original fact called Validate() on "job\n" and expected it to pass. Strict
    // validation now rejects it, so the property is stated over candidates: an ID is either
    // rejected, or its page carries a pixel-decoded QR payload that parses as JSON with the same ID.
    [Theory]
    [InlineData("job")]
    [InlineData("A-z_0.9")]
    [InlineData("0123456789012345678901234567890123456789")]
    [InlineData("job\n")]
    [InlineData("job\r\n")]
    [InlineData("\njob")]
    [InlineData("jo\nb")]
    [InlineData("job\r")]
    [InlineData("job\0")]
    [InlineData("job\t")]
    [InlineData("jo\"b")]
    [InlineData("jo\\b")]
    [InlineData("job ")]
    [InlineData("jöb")]
    [InlineData("")]
    [InlineData("01234567890123456789012345678901234567890")]
    public void Every_accepted_job_id_must_survive_pixel_QR_decode_as_valid_JSON(string job)
    {
        var s = new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder, job);
        try
        {
            s.Validate();
        }
        catch (ArgumentException)
        {
            Assert.Throws<ArgumentException>(() => PageGenerator.QrPayload(s, 1, Side.Front, 0));
            Assert.Throws<ArgumentException>(() => PageGenerator.Generate(s, 1, Side.Front, 0));
            return;
        }
        var payload = QrReader.Decode(PageGenerator.Generate(s, 1, Side.Front, 0));
        using var json = JsonDocument.Parse(payload!);
        Assert.Equal(s.Job, json.RootElement.GetProperty("job").GetString());
    }

    [Theory]
    [InlineData("job\n")]
    [InlineData("job\r\n")]
    [InlineData("\njob")]
    [InlineData("")]
    [InlineData("01234567890123456789012345678901234567890")]
    public void Job_id_outside_the_charset_is_rejected(string job) =>
        Assert.Throws<ArgumentException>(
            () => new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder, job).Validate());

    [Fact]
    public void Maximum_int_page_count_must_terminate_after_its_last_page()
    {
        using var pages = JobPlan.Pages(ScanSource.Duplex, int.MaxValue).GetEnumerator();
        Assert.True(pages.MoveNext());
        // Advance the compiler-generated loop counter instead of enumerating 2^31 pages.
        // This is deliberately a white-box boundary regression, not a production API.
        var counter = Assert.Single(pages.GetType().GetFields(BindingFlags.Instance |
            BindingFlags.NonPublic | BindingFlags.Public), f => f.Name.StartsWith("<i>"));
        counter.SetValue(pages, int.MaxValue - 1);
        Assert.True(pages.MoveNext());
        Assert.Equal(int.MaxValue, pages.Current.PageIndex);
        Assert.False(pages.MoveNext());
    }

    [Fact]
    public void Verification_decoder_must_reject_missing_required_IEND()
    {
        var s = new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder);
        var valid = PageGenerator.Generate(s, 1, Side.Front, 0);
        Assert.Throws<InvalidDataException>(() => PngDecoder.Decode(valid.AsSpan(0, valid.Length - 12)));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(5, 5)]
    public void Small_page_counts_yield_exactly_count_pages(int count, int expected) =>
        Assert.Equal(expected, JobPlan.Pages(ScanSource.Duplex, count).Count());

    [Fact]
    public void Negative_page_count_is_rejected() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => JobPlan.Pages(ScanSource.Feeder, -1).ToList());

    public static TheoryData<string> Corruptions() =>
        ["drop-iend", "truncate-mid-idat", "truncate-header", "flip-idat-byte", "flip-ihdr-byte",
         "trailing-bytes", "drop-ihdr", "only-signature"];

    [Theory]
    [MemberData(nameof(Corruptions))]
    public void Verification_decoder_detects_corrupted_generator_output(string kind)
    {
        var s = new PageSettings(75, ColorMode.Gray, PaperSize.A5, ScanSource.Feeder);
        var png = PageGenerator.Generate(s, 1, Side.Front, 7);
        PngDecoder.Decode(png); // the untouched output decodes
        var bad = (byte[])png.Clone();
        bad = kind switch
        {
            "drop-iend" => png[..^12],
            "truncate-mid-idat" => png[..(png.Length / 2)],
            "truncate-header" => png[..(png.Length - 12 + 5)],
            "flip-idat-byte" => Flip(bad, png.Length / 2),
            "flip-ihdr-byte" => Flip(bad, 8 + 8 + 2),
            "trailing-bytes" => [.. png, 0, 0, 0, 0],
            "drop-ihdr" => [.. png[..8], .. png[(8 + 25)..]],
            "only-signature" => png[..8],
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        Assert.Throws<InvalidDataException>(() => PngDecoder.Decode(bad));
    }

    private static byte[] Flip(byte[] b, int i)
    {
        b[i] ^= 0x40;
        return b;
    }
}
