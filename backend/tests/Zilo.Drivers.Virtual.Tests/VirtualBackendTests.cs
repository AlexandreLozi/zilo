using System.Diagnostics;
using System.Text.Json;
using Zilo.Core;
using Zilo.Drivers.Virtual;
using Xunit;
using ZXing;
using ZXing.Common;
using ZXing.QrCode;

namespace Zilo.Drivers.Virtual.Tests;

public sealed class VirtualBackendTests
{
    private readonly ITestOutputHelper _output;

    public VirtualBackendTests(ITestOutputHelper output) => _output = output;

    [Fact]
    public async Task Lists_healthy_and_stable_failure_routes()
    {
        await using var backend = new VirtualScanBackend();
        var devices = await backend.ListDevicesAsync(TestContext.Current.CancellationToken);

        Assert.Equal("virtual", devices.Devices[0].Id);
        Assert.Equal("Zilo Virtual Scanner", devices.Devices[0].Name);
        Assert.Contains(devices.Devices, d => d.Id == "virtual-paper-jam");
        Assert.Contains(devices.Devices, d => d.Id == "virtual-disconnect");
    }

    [Fact]
    public async Task Produces_zero_based_pages_with_a_real_png()
    {
        await using var backend = new VirtualScanBackend();
        var request = new ScanRequest(
            JobId.Parse("job-virtual-0001"), "virtual",
            new EffectiveSettings("feeder", 75, "gray", "A5", new SizeMm(148, 210), 2),
            new AcquisitionLimits(4, 10_000_000, 20_000_000));

        var pages = new List<Page>();
        await foreach (var page in backend.AcquireAsync(request, TestContext.Current.CancellationToken)) pages.Add(page);

        Assert.Equal(2, pages.Count);
        Assert.Equal([0, 1], pages.Select(p => p.Index));
        Assert.All(pages, p => Assert.Equal("image/png", p.ContentType));
        Assert.All(pages, p => Assert.Equal([0x89, 0x50, 0x4e, 0x47], p.Bytes[..4]));

        var decoded = PngTestDecoder.Decode(pages[0].Bytes.AsSpan());
        Assert.Equal(8, decoded.Depth);
        Assert.Equal(0, decoded.Type);
        var source = new RGBLuminanceSource(decoded.Luma, decoded.Width, decoded.Height,
            RGBLuminanceSource.BitmapFormat.Gray8);
        var qr = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)),
            new Dictionary<DecodeHintType, object> { [DecodeHintType.TRY_HARDER] = true });
        Assert.Contains("\"job\":\"job-virtual-0001\"", qr.Text);
        Assert.Contains("\"page\":0", qr.Text);
        var second = PngTestDecoder.Decode(pages[1].Bytes.AsSpan());
        var secondQr = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(
            new RGBLuminanceSource(second.Luma, second.Width, second.Height,
                RGBLuminanceSource.BitmapFormat.Gray8))),
            new Dictionary<DecodeHintType, object> { [DecodeHintType.TRY_HARDER] = true });
        Assert.Contains("\"page\":1", secondQr.Text);
    }

    [Fact]
    public async Task Failure_after_one_page_keeps_that_page_and_is_typed()
    {
        await using var backend = new VirtualScanBackend(VirtualDevices.Create(FailureKind.PaperJam, 2));
        var request = Request("virtual-paper-jam-2", "feeder", "color", 3);
        var pages = new List<Page>();
        var error = await Assert.ThrowsAsync<ScanFailureException>(async () =>
        {
            await foreach (var page in backend.AcquireAsync(request, TestContext.Current.CancellationToken))
                pages.Add(page);
        });

        Assert.Single(pages);
        Assert.Equal(1, error.PagesKept);
        Assert.Equal("paper-jam", error.Error.Code);
        var decodedBeforeDispose = PngTestDecoder.Decode(pages[0].Bytes.AsSpan()).Rgb;
        await backend.DisposeAsync();
        Assert.Equal(decodedBeforeDispose, PngTestDecoder.Decode(pages[0].Bytes.AsSpan()).Rgb);
    }

    [Theory]
    [InlineData(FailureKind.PaperJam, "paper-jam")]
    [InlineData(FailureKind.Timeout, "timeout")]
    [InlineData(FailureKind.Disconnect, "disconnected")]
    public async Task All_page_failures_report_code_and_pages_kept(FailureKind kind, string code)
    {
        var variant = VirtualDevices.Create(kind, 2);
        await using var backend = new VirtualScanBackend(variant);
        var pages = new List<Page>();
        var error = await Assert.ThrowsAsync<ScanFailureException>(async () =>
        {
            await foreach (var page in backend.AcquireAsync(Request(variant.DeviceId, "feeder", "gray", 3),
                TestContext.Current.CancellationToken)) pages.Add(page);
        });
        Assert.Single(pages);
        Assert.Equal(code, error.Error.Code);
        Assert.Equal(1, error.PagesKept);
    }

    [Fact]
    public async Task Cover_open_and_empty_feeder_fail_before_a_page()
    {
        foreach (var variant in new[] { VirtualDevices.Create(FailureKind.CoverOpen), VirtualDevices.Create(FailureKind.FeederEmpty) })
        {
            await using var backend = new VirtualScanBackend(variant);
            var error = await Assert.ThrowsAsync<ScanFailureException>(async () =>
            {
                await foreach (var _ in backend.AcquireAsync(Request(variant.DeviceId, "feeder", "gray", null),
                    TestContext.Current.CancellationToken)) { }
            });
            Assert.Equal(0, error.PagesKept);
            Assert.Contains(error.Error.Code, new[] { "cover-open", "feeder-empty" });
        }
    }

    [Fact]
    public async Task Null_completion_count_hits_safety_bound_on_next_move()
    {
        await using var backend = new VirtualScanBackend();
        var request = Request("virtual", "feeder", "gray", null, maxPagesLimit: 2);
        await using var enumerator = backend.AcquireAsync(request, TestContext.Current.CancellationToken)
            .GetAsyncEnumerator(TestContext.Current.CancellationToken);
        Assert.True(await enumerator.MoveNextAsync());
        Assert.True(await enumerator.MoveNextAsync());
        var error = await Assert.ThrowsAsync<ScanFailureException>(async () => await enumerator.MoveNextAsync());
        Assert.Equal("limits-exceeded", error.Error.Code);
        Assert.Equal(2, error.PagesKept);
    }

    [Fact]
    public async Task Flatbed_is_naturally_one_page_and_duplex_is_zero_based()
    {
        await using var backend = new VirtualScanBackend();
        var flatbed = new List<Page>();
        await foreach (var page in backend.AcquireAsync(Request("virtual", "flatbed", "gray", null),
            TestContext.Current.CancellationToken)) flatbed.Add(page);
        Assert.Single(flatbed);

        var duplex = new List<Page>();
        await foreach (var page in backend.AcquireAsync(Request("virtual", "duplex", "gray", 2),
            TestContext.Current.CancellationToken)) duplex.Add(page);
        Assert.Equal([0, 1], duplex.Select(p => p.Index));
        Assert.Equal([0, 0], duplex.Select(p => p.Sheet));
        Assert.Equal(["front", "back"], duplex.Select(p => p.Side));
    }

    [Fact]
    public async Task Capabilities_and_settings_fail_with_distinct_codes()
    {
        await using var backend = new VirtualScanBackend();
        var caps = await backend.GetDeviceCapsAsync("virtual", TestContext.Current.CancellationToken);
        Assert.Equal(["flatbed", "feeder", "duplex"], caps.Sources.Select(s => s.Source));
        Assert.Equal(1, caps.Sources[0].MaxPages);
        Assert.Equal("A4", caps.Sources[1].Defaults.PageSize);

        foreach (var pair in new[]
        {
            (new EffectiveSettings("feeder", 300, "sepia", "A4", new SizeMm(210, 297), 1), "unsupported-capability"),
            (new EffectiveSettings("feeder", 601, "gray", "A4", new SizeMm(210, 297), 1), "invalid-settings"),
            (new EffectiveSettings("feeder", 300, "gray", "unknown", new SizeMm(210, 297), 1), "invalid-settings"),
            (new EffectiveSettings("feeder", 300, "gray", "A4", new SizeMm(1000, 1000), 1), "invalid-settings"),
        })
        {
            var error = await Assert.ThrowsAsync<ScanFailureException>(async () =>
            {
                await foreach (var _ in backend.AcquireAsync(new ScanRequest(JobId.Parse("job-virtual-0001"), "virtual",
                    pair.Item1, new AcquisitionLimits(2, 10_000_000, 20_000_000)), TestContext.Current.CancellationToken)) { }
            });
            Assert.Equal(pair.Item2, error.Error.Code);
        }
    }

    [Fact]
    public void Invalid_fixture_parameters_are_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => VirtualDevices.Create(FailureKind.PaperJam, 0));
        Assert.Throws<ArgumentException>(() => new FailureVariant("bad/id", "bad", FailureKind.None, null));
        Assert.Throws<ArgumentException>(() => new FailureVariant("é", "bad", FailureKind.None, null));
        Assert.Throws<ArgumentException>(() => new FailureVariant(new string('r', 129), "bad", FailureKind.None, null));
        Assert.Throws<ArgumentException>(() => new FailureVariant("bad", "bad", FailureKind.PaperJam, null, AtPage: 2));
    }

    [Fact]
    public async Task Large_zero_stream_compression_observes_cancellation_after_lz77_jumps()
    {
        var data = new byte[128 * 1024 * 1024];
        using var cancellation = new CancellationTokenSource();
        using var started = new ManualResetEventSlim();
        var compression = Task.Run(() =>
        {
            started.Set();
            return Deflate.ZlibCompress(data, cancellation.Token);
        });
        started.Wait(TestContext.Current.CancellationToken);
        cancellation.CancelAfter(10);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await compression.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("color", 8, 2)]
    [InlineData("gray", 8, 0)]
    [InlineData("bw", 1, 0)]
    public async Task Encoded_mode_is_truthful_and_repeated_pixels_match(string mode, int depth, int type)
    {
        await using var backend = new VirtualScanBackend();
        var request = Request("virtual", "flatbed", mode, 1);
        var first = await First(backend, request);
        var second = await First(backend, request);
        var decoded = PngTestDecoder.Decode(first.Bytes.AsSpan());
        Assert.Equal(depth, decoded.Depth);
        Assert.Equal(type, decoded.Type);
        if (mode == "color")
            Assert.Contains(decoded.Rgb.Chunk(3), pixel => pixel[0] != pixel[1] || pixel[1] != pixel[2]);
        else if (mode == "bw")
            Assert.All(decoded.Rgb, value => Assert.Contains(value, new byte[] { 0, 255 }));
        Assert.Equal(decoded.Rgb, PngTestDecoder.Decode(second.Bytes.AsSpan()).Rgb);
    }

    [Fact]
    public async Task Maximum_length_job_id_survives_decoded_qr()
    {
        await using var backend = new VirtualScanBackend();
        var job = new string('Z', 64);
        var request = new ScanRequest(JobId.Parse(job), "virtual",
            new EffectiveSettings("flatbed", 75, "gray", "A5", new SizeMm(148, 210), 1),
            new AcquisitionLimits(2, 10_000_000, 20_000_000));
        var page = await First(backend, request);
        var decoded = PngTestDecoder.Decode(page.Bytes.AsSpan());
        var qr = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(
            new RGBLuminanceSource(decoded.Luma, decoded.Width, decoded.Height,
                RGBLuminanceSource.BitmapFormat.Gray8))),
            new Dictionary<DecodeHintType, object> { [DecodeHintType.TRY_HARDER] = true });
        Assert.Contains($"\"job\":\"{job}\"", qr.Text);
        Assert.Contains("\"page\":0", qr.Text);
    }

    [Fact]
    public async Task Cancellation_before_move_and_disposal_after_yield_are_safe()
    {
        await using var backend = new VirtualScanBackend();
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var request = Request("virtual", "feeder", "gray", 2);
        await using var enumerator = backend.AcquireAsync(request, cancelled.Token).GetAsyncEnumerator(cancelled.Token);
        await Assert.ThrowsAsync<OperationCanceledException>(async () => await enumerator.MoveNextAsync());

        await using var retainedEnumerator = backend.AcquireAsync(request, TestContext.Current.CancellationToken)
            .GetAsyncEnumerator(TestContext.Current.CancellationToken);
        Assert.True(await retainedEnumerator.MoveNextAsync());
        var retained = retainedEnumerator.Current.Bytes.ToArray();
        await backend.DisposeAsync();
        Assert.Equal(retained, retainedEnumerator.Current.Bytes);
        await Assert.ThrowsAsync<OperationCanceledException>(async () => await retainedEnumerator.MoveNextAsync());
    }

    [Fact]
    public async Task Controlled_timer_cancellation_disposes_timer()
    {
        var clock = new ControlledTimeProvider();
        await using var backend = new VirtualScanBackend(clock,
            [VirtualDevices.Create(FailureKind.Slow, 1500)]);
        using var cancellation = new CancellationTokenSource();
        var move = backend.AcquireAsync(Request("virtual-slow-1500", "feeder", "gray", 1), cancellation.Token)
            .GetAsyncEnumerator(cancellation.Token).MoveNextAsync().AsTask();
        var timer = await clock.TimerCreated.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await move.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        await timer.Disposed.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Disposal_is_shared_and_waits_for_pending_slow_acquisition()
    {
        var clock = new ControlledTimeProvider();
        await using var backend = new VirtualScanBackend(clock,
            [VirtualDevices.Create(FailureKind.Slow, 1500)]);
        var enumerator = backend.AcquireAsync(Request("virtual-slow-1500", "feeder", "gray", 1), TestContext.Current.CancellationToken)
            .GetAsyncEnumerator(TestContext.Current.CancellationToken);
        var move = enumerator.MoveNextAsync().AsTask();
        var timer = await clock.TimerCreated.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        var dispose1 = backend.DisposeAsync().AsTask();
        var dispose2 = backend.DisposeAsync().AsTask();
        await Task.WhenAll(dispose1, dispose2).WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await move.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        await timer.Disposed.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await enumerator.DisposeAsync();
    }

    [Fact]
    public async Task Duplex_qr_json_is_structured_and_correct_for_every_mode()
    {
        foreach (var mode in new[] { "color", "gray", "bw" })
        {
            await using var backend = new VirtualScanBackend();
            var request = Request("virtual", "duplex", mode, 2);
            var pages = new List<Page>();
            await foreach (var page in backend.AcquireAsync(request, TestContext.Current.CancellationToken)) pages.Add(page);
            foreach (var (page, index) in pages.Select((p, i) => (p, i)))
            {
                using var json = DecodeQrJson(page);
                Assert.Equal("job-virtual-0001", json.RootElement.GetProperty("job").GetString());
                Assert.Equal(index, json.RootElement.GetProperty("page").GetInt32());
                Assert.Equal(index == 0 ? "front" : "back", json.RootElement.GetProperty("side").GetString());
                Assert.Equal(75, json.RootElement.GetProperty("dpi").GetInt32());
                Assert.Equal(mode, json.RootElement.GetProperty("mode").GetString());
                Assert.Equal("A5", json.RootElement.GetProperty("paper").GetString());
            }
        }
    }

    [Fact]
    public async Task Ruler_spacing_and_targets_are_decoded_pixels()
    {
        var settings = new PageSettings(75, ColorMode.Color, PaperSize.A5, ScanSource.Flatbed, "job-virtual-0001");
        var layout = PageGenerator.Layout(settings, 0, Side.Front, 42);
        var png = PageGenerator.Generate(settings, 0, Side.Front, 42, TestContext.Current.CancellationToken);
        var decoded = PngTestDecoder.Decode(png);
        byte Pixel(int x, int y) => decoded.Rgb[(y * decoded.Width + x) * 3];
        var y = layout.MmRulerBaselineY + layout.Px(40);
        var x0 = layout.MmRulerOriginX + layout.MmToPx(0);
        var x10 = layout.MmRulerOriginX + layout.MmToPx(10);
        var x20 = layout.MmRulerOriginX + layout.MmToPx(20);
        Assert.Equal(layout.MmToPx(10) - layout.MmToPx(0), x10 - x0);
        Assert.Equal(layout.MmToPx(20) - layout.MmToPx(10), x20 - x10);
        Assert.Equal((byte)0, Pixel(x0, y));
        Assert.Equal((byte)0, Pixel(x10, y));
        Assert.Equal((byte)0, Pixel(x20, y));
        Assert.Equal((byte)255, Pixel(x0 + layout.TickThicknessPx + 1, y));
        var colorX = layout.ColorTarget.X + layout.Px(50);
        var colorY = layout.ColorTarget.Y + layout.ColorTarget.H / 2;
        var colorOffset = (colorY * decoded.Width + colorX) * 3;
        Assert.Equal([255, 0, 0], decoded.Rgb.AsSpan(colorOffset, 3).ToArray());
        Assert.Equal((byte)76, decoded.Luma[colorY * decoded.Width + colorX]);
        var bw = PngTestDecoder.Decode(PageGenerator.Generate(
            new PageSettings(75, ColorMode.Bw, PaperSize.A5, ScanSource.Flatbed, "job-virtual-0001"), 0, Side.Front, 42,
            TestContext.Current.CancellationToken));
        Assert.Contains(bw.Rgb, value => value is 0 or 255);
    }

    [Fact]
    public async Task Refresh_and_concurrent_list_return_the_same_cached_snapshot_and_defaults_are_members()
    {
        await using var backend = new VirtualScanBackend();
        var first = await backend.ListDevicesAsync(TestContext.Current.CancellationToken);
        var refresh = await backend.RefreshDevicesAsync(TestContext.Current.CancellationToken);
        var concurrent = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ =>
            backend.ListDevicesAsync(TestContext.Current.CancellationToken).AsTask()));
        Assert.Same(first, refresh);
        Assert.All(concurrent, snapshot => Assert.Same(first, snapshot));
        var caps = await backend.GetDeviceCapsAsync("virtual", TestContext.Current.CancellationToken);
        Assert.All(caps.Sources, source =>
        {
            Assert.Contains(source.Defaults.Resolution, source.Resolutions.Values);
            Assert.Contains(source.Defaults.ColorMode, source.ColorModes);
            Assert.Contains(source.Defaults.PageSize, source.PageSizes.Select(p => p.Id));
        });
    }

    [Fact]
    public async Task MaximumLegal600RawObservation()
    {
        await using var backend = new VirtualScanBackend();
        var request = new ScanRequest(JobId.Parse("job-virtual-0001"), "virtual",
            new EffectiveSettings("flatbed", 600, "color", "Legal", new SizeMm(215.9, 355.6), 1),
            new AcquisitionLimits(1, 100_000_000, 512L * 1024 * 1024));
        var stopwatch = Stopwatch.StartNew();
        var before = GC.GetTotalAllocatedBytes(true);
        var page = await First(backend, request);
        stopwatch.Stop();
        var allocated = GC.GetTotalAllocatedBytes(true) - before;
        var peak = Process.GetCurrentProcess().PeakWorkingSet64;
        Assert.Equal(5100, page.WidthPx);
        Assert.Equal(8400, page.HeightPx);
        Assert.NotEmpty(page.Bytes);
        _output.WriteLine($"Legal600 elapsedMs={stopwatch.Elapsed.TotalMilliseconds:F1} allocatedBytes={allocated} peakWorkingSet64={peak} encodedBytes={page.Bytes.Length}");
    }

    [Fact]
    public async Task Int_max_request_is_lazy_and_guards_fail_before_image_allocation()
    {
        await using var backend = new VirtualScanBackend();
        var huge = new ScanRequest(JobId.Parse("job-virtual-0001"), "virtual",
            new EffectiveSettings("feeder", 75, "gray", "A5", new SizeMm(148, 210), int.MaxValue),
            new AcquisitionLimits(int.MaxValue, 10_000_000, 20_000_000));
        await using var e = backend.AcquireAsync(huge, TestContext.Current.CancellationToken)
            .GetAsyncEnumerator(TestContext.Current.CancellationToken);
        Assert.True(await e.MoveNextAsync());

        foreach (var limits in new[]
        {
            new AcquisitionLimits(1, 1, 20_000_000),
            new AcquisitionLimits(1, 10_000_000, 1),
        })
        {
            var request = huge with { Limits = limits, Settings = huge.Settings with { MaxPages = 1 } };
            var error = await Assert.ThrowsAsync<ScanFailureException>(async () =>
            {
                await foreach (var _ in backend.AcquireAsync(request, TestContext.Current.CancellationToken)) { }
            });
            Assert.Equal("limits-exceeded", error.Error.Code);
        }
    }

    [Fact]
    public async Task Slow_fixture_uses_injected_timer_without_real_sleep()
    {
        await using var backend = new VirtualScanBackend(new ImmediateTimeProvider(),
            [VirtualDevices.Create(FailureKind.Slow, 1500)]);
        var page = await First(backend, Request("virtual-slow-1500", "flatbed", "gray", 1));
        Assert.Equal(0, page.Index);
    }

    [Fact]
    public async Task Concurrent_acquisitions_have_identical_decoded_pixels()
    {
        await using var backend = new VirtualScanBackend();
        var request = Request("virtual", "flatbed", "gray", 1);
        var pages = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => First(backend, request)));
        var baseline = PngTestDecoder.Decode(pages[0].Bytes.AsSpan()).Luma;
        Assert.All(pages.Skip(1), page => Assert.Equal(baseline,
            PngTestDecoder.Decode(page.Bytes.AsSpan()).Luma));
    }

    [Fact]
    public async Task First_acquisition_has_one_based_visible_labels_and_zero_based_metadata()
    {
        await using var backend = new VirtualScanBackend();
        var page = await First(backend, Request("virtual", "flatbed", "gray", 1));

        Assert.Equal(0, page.Index);
        Assert.Equal(0, page.Sheet);
        using var json = DecodeQrJson(page);
        Assert.Equal(0, json.RootElement.GetProperty("page").GetInt32());
        var seed = json.RootElement.GetProperty("seed").GetUInt32();

        var decoded = PngTestDecoder.Decode(page.Bytes.AsSpan());
        var settings = new PageSettings(75, ColorMode.Gray, PaperSize.A5, ScanSource.Flatbed,
            "job-virtual-0001");
        var layout = PageGenerator.Layout(settings, 0, Side.Front, seed);

        var one = new[] { "..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###." };
        var pageNumberScale = Math.Max(1, Math.Min(layout.PageNumber.H / 7,
            layout.PageNumber.W / one[0].Length));
        AssertScaledGlyph(decoded.Rgb, decoded.Width, layout.PageNumber.X, layout.PageNumber.Y,
            pageNumberScale, one, foreground: 0, background: 255);

        var prefix = "75 DPI  gray  A5  flatbed  ";
        var line2 = $"{prefix}P1 FRONT  SEED {seed}";
        var pad = layout.Px(15);
        var lineHeight = (layout.Banner.H - 3 * pad) / 2;
        var available = layout.Banner.W - 2 * pad;
        var bannerScale = Math.Max(1, Math.Min(lineHeight / 7,
            available / (line2.Length * 6 - 1)));
        var bannerX = layout.Banner.X + pad + prefix.Length * 6 * bannerScale;
        var bannerY = layout.Banner.Y + 2 * pad + lineHeight;
        var p = new[] { "####.", "#...#", "#...#", "####.", "#....", "#....", "#...." };
        AssertScaledGlyph(decoded.Rgb, decoded.Width, bannerX, bannerY, bannerScale, p,
            foreground: 255, background: 0);
        AssertScaledGlyph(decoded.Rgb, decoded.Width, bannerX + 6 * bannerScale, bannerY,
            bannerScale, one, foreground: 255, background: 0);
    }

    [Fact]
    public async Task Feeder_three_completes_normally_after_three_zero_based_pages()
    {
        await using var backend = new VirtualScanBackend();
        var pages = new List<Page>();
        await foreach (var page in backend.AcquireAsync(
            Request("virtual-feeder-3", "feeder", "gray", null, maxPagesLimit: 5),
            TestContext.Current.CancellationToken))
            pages.Add(page);

        Assert.Equal(3, pages.Count);
        Assert.Equal([0, 1, 2], pages.Select(page => page.Index));
    }

    private static void AssertScaledGlyph(byte[] rgb, int width, int x, int y, int scale,
        string[] glyph, byte foreground, byte background)
    {
        for (var row = 0; row < 7; row++)
        for (var column = 0; column < 6; column++)
        for (var dy = 0; dy < scale; dy++)
        for (var dx = 0; dx < scale; dx++)
        {
            var expected = column < 5 && glyph[row][column] == '#' ? foreground : background;
            var offset = ((y + row * scale + dy) * width + x + column * scale + dx) * 3;
            Assert.Equal(expected, rgb[offset]);
            Assert.Equal(expected, rgb[offset + 1]);
            Assert.Equal(expected, rgb[offset + 2]);
        }
    }

    private sealed class ImmediateTimeProvider : TimeProvider
    {
        public override ITimer CreateTimer(TimerCallback callback, object? state,
            TimeSpan dueTime, TimeSpan period)
        {
            if (dueTime != Timeout.InfiniteTimeSpan)
                ThreadPool.QueueUserWorkItem(_ => callback(state));
            return new NoopTimer();
        }

        private sealed class NoopTimer : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => true;
            public void Dispose() { }
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private static JsonDocument DecodeQrJson(Page page)
    {
        var decoded = PngTestDecoder.Decode(page.Bytes.AsSpan());
        var source = new RGBLuminanceSource(decoded.Luma, decoded.Width, decoded.Height,
            RGBLuminanceSource.BitmapFormat.Gray8);
        var result = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)),
            new Dictionary<DecodeHintType, object> { [DecodeHintType.TRY_HARDER] = true });
        return JsonDocument.Parse(result.Text);
    }

    private sealed class ControlledTimeProvider : TimeProvider
    {
        public TaskCompletionSource<ControlledTimer> TimerCreated { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override ITimer CreateTimer(TimerCallback callback, object? state,
            TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ControlledTimer(callback, state);
            TimerCreated.TrySetResult(timer);
            return timer;
        }

        internal sealed class ControlledTimer(TimerCallback callback, object? state) : ITimer
        {
            private readonly TimerCallback _callback = callback;
            private readonly object? _state = state;
            public TaskCompletionSource Disposed { get; } =
                new(TaskCreationOptions.RunContinuationsAsynchronously);

            public bool Change(TimeSpan dueTime, TimeSpan period) => true;
            public void Fire() => _callback(_state);
            public void Dispose() => Disposed.TrySetResult();
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }

    private static async Task<Page> First(VirtualScanBackend backend, ScanRequest request)
    {
        await using var e = backend.AcquireAsync(request, TestContext.Current.CancellationToken)
            .GetAsyncEnumerator(TestContext.Current.CancellationToken);
        Assert.True(await e.MoveNextAsync());
        return e.Current;
    }

    private static ScanRequest Request(string device, string source, string mode, int? maxPages, int? maxPagesLimit = null) => new(
        JobId.Parse("job-virtual-0001"), device,
        new EffectiveSettings(source, 75, mode, "A5", new SizeMm(148, 210), maxPages),
        new AcquisitionLimits(maxPagesLimit ?? 4, 10_000_000, 20_000_000));
}
