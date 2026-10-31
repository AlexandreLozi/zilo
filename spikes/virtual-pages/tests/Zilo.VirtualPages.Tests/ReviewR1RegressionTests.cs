using System.Reflection;
using System.Text.Json;
using Xunit;

namespace Zilo.VirtualPages.Tests;

// Review-only regressions: intentionally red against author SHA 0afb9c4.
public class ReviewR1RegressionTests
{
    [Fact]
    public void Job_id_with_trailing_newline_must_be_rejected()
    {
        var s = new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder, "job\n");
        Assert.Throws<ArgumentException>(() => PageGenerator.Generate(s, 1, Side.Front, 0));
    }

    [Fact]
    public void Every_accepted_job_id_must_survive_pixel_QR_decode_as_valid_JSON()
    {
        var s = new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Feeder, "job\n");
        s.Validate(); // Currently accepted by the advertised restricted-ID validator.
        var payload = QrReader.Decode(PageGenerator.Generate(s, 1, Side.Front, 0));
        using var json = JsonDocument.Parse(payload!);
        Assert.Equal(s.Job, json.RootElement.GetProperty("job").GetString());
    }

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
}
