using Xunit;
using Zilo.Core;

namespace Zilo.Core.Tests;

public sealed class ScanBackendContractTests
{
    [Fact]
    public void Identifiers_use_the_T10_bounds_and_page_indices_are_zero_based()
    {
        var job = JobId.Parse("0123456789abcdef");
        Assert.Equal(16, job.Value.Length);
        Assert.Throws<ArgumentException>(() => JobId.Parse("too-short"));
        Assert.Throws<ArgumentException>(() => JobId.Parse(new string('a', 65)));
        Assert.Throws<ArgumentException>(() => JobId.Parse("0123456789abcde!"));
        Assert.Throws<ArgumentException>(() => JobId.Parse("0123456789abcdef\n"));
        Assert.Throws<ArgumentException>(() => new RouteId(new string('r', 129)));
        Assert.Throws<ArgumentException>(() => new RouteId("bad/id"));
        Assert.Throws<ArgumentException>(() => new RouteId("route-1\n"));
        Assert.Throws<ArgumentOutOfRangeException>(() => new AcquisitionLimits(0, 1, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => new AcquisitionLimits(1, -1, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Page(-1, 0, "front", 1, 1, new PageResolution(300, 300), "gray", "e", DateTimeOffset.UnixEpoch, new byte[0]));
        Assert.Throws<ArgumentOutOfRangeException>(() => new Page(0, 0, "front", 0, 1, new PageResolution(300, 300), "gray", "e", DateTimeOffset.UnixEpoch, new byte[0]));
        Assert.Throws<ArgumentOutOfRangeException>(() => new PageResolution(0, 300));

        var sourceBytes = new byte[] { 1, 2, 3 };
        var page = new Page(
            Index: 0, Sheet: 0, Side: "front", WidthPx: 10, HeightPx: 20,
            Resolution: new PageResolution(300, 300), ColorMode: "color",
            ETag: "etag", CreatedAt: DateTimeOffset.UnixEpoch,
            Bytes: sourceBytes);
        sourceBytes[0] = 99;
        var adjustments = new List<Adjustment> { new("resolution", 301, 300, "coerced") };
        var transported = new Page(0, 0, "front", 1, 1, new PageResolution(300, 300), "gray", "e", DateTimeOffset.UnixEpoch, new byte[] { 7 }, new EffectiveSettings("flatbed", 300, "gray", "a4", new SizeMm(210, 297), 1), adjustments);
        adjustments.Clear();

        Assert.Equal(0, page.Index);
        Assert.Equal(0, page.Sheet);
        Assert.Equal("front", page.Side);
        Assert.Equal("image/png", page.ContentType);
        Assert.Equal(new byte[] { 1, 2, 3 }, page.Bytes.ToArray());
        Assert.NotNull(transported.AppliedSettings);
        Assert.Single(transported.Adjustments);
    }

    [Fact]
    public void Capabilities_preserve_open_response_values_and_settings_are_not_coerced()
    {
        var modes = new List<string> { "color", "future-color" };
        var source = new SourceCaps(
            "feeder",
            new ResolutionCaps("future-resolution-kind"),
            modes,
            new[] { new PageSize("a4", 210, 297) },
            new SizeMm(210, 297), CustomPageSize: false,
            MaxPages: 50,
            new SourceDefaults(300, "future-color", "a4"));
        modes[0] = "mutated-after-construction";
        var settings = new ScanSettings("feeder", Resolution: 301, ColorMode: "future-color", PageSize: "a4");

        Assert.Equal("future-resolution-kind", source.Resolutions.Kind);
        Assert.Contains("color", source.ColorModes);
        Assert.Contains("future-color", source.ColorModes);
        Assert.Equal(301, settings.Resolution);
        Assert.Equal("future-color", settings.ColorMode);
    }

    [Fact]
    public void Effective_settings_adjustments_and_errors_are_stable_wire_shapes()
    {
        var effective = new EffectiveSettings("feeder", 300, "gray", "a4", new SizeMm(210, 297), null);
        var adjustment = new Adjustment("resolution", 301, 300, "coerced");
        var error = new ScanError("future-driver-error", "driver reported a future error", Retryable: false, ErrorId: "err-1");

        Assert.Equal(300, effective.Resolution);
        Assert.Equal(301, adjustment.Requested!.Value.GetInt32());
        Assert.Equal("coerced", adjustment.Reason);
        Assert.Equal("future-driver-error", error.Code);
        Assert.Equal("err-1", error.ErrorId);
        Assert.Throws<ArgumentException>(() => new Adjustment("x", true, null, "bad"));
    }

    [Fact]
    public async Task Fake_backend_stream_is_lazy_bounded_cancellable_and_keeps_pages_after_typed_failure()
    {
        await using var backend = new FakeBackend();
        var request = new ScanRequest(
            JobId.Parse(new string('j', 64)), "route-1",
            new EffectiveSettings("duplex", 300, "gray", "a4", new SizeMm(210, 297), 4),
            new AcquisitionLimits(4, 100_000, 1_000_000));

        var retained = new List<Page>();
        var failure = await Assert.ThrowsAsync<ScanFailureException>(async () =>
        {
            await foreach (var page in backend.AcquireAsync(request, TestContext.Current.CancellationToken))
            {
                retained.Add(page);
            }
        });

        Assert.Equal("paper-jam", failure.Error.Code);
        Assert.Equal(2, failure.PagesKept);
        Assert.Equal(new byte[] { 0 }, retained[0].Bytes.ToArray());
        Assert.Equal(new byte[] { 1 }, retained[1].Bytes.ToArray());
        Assert.Equal(2, backend.PagesProduced);
        Assert.Equal(1, backend.MaxPagesInFlight);
        Assert.True(backend.StreamDisposed);
        Assert.Equal(0, retained[0].Sheet);
        Assert.Equal(0, retained[1].Sheet);
        Assert.Equal("front", retained[0].Side);
        Assert.Equal("back", retained[1].Side);
        await backend.DisposeAsync();
        Assert.True(backend.BackendDisposed);
        Assert.Equal(new byte[] { 0 }, retained[0].Bytes.ToArray());
    }

    [Fact]
    public async Task Cancellation_is_not_reported_as_a_scanner_failure_and_disposal_releases_stream()
    {
        await using var backend = new FakeBackend();
        using var cancellation = new CancellationTokenSource();
        var request = new ScanRequest(JobId.Parse("0123456789abcdef"), "route-1", new EffectiveSettings("flatbed", 300, "gray", "a4", new SizeMm(210, 297), 2), new AcquisitionLimits(2, 100, 100));
        var retained = new List<Page>();

        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await foreach (var page in backend.AcquireAsync(request, cancellation.Token))
            {
                retained.Add(page);
                cancellation.Cancel();
            }
        });

        Assert.Single(retained);
        Assert.True(backend.StreamDisposed);
        Assert.Equal(1, backend.PagesProduced);
    }

    [Fact]
    public async Task Stream_is_lazy_and_early_break_disposes_without_advancing()
    {
        await using var backend = new FakeBackend();
        var request = new ScanRequest(JobId.Parse("0123456789abcdef"), "route-1", new EffectiveSettings("flatbed", 300, "gray", "a4", new SizeMm(210, 297), 3), new AcquisitionLimits(3, 100, 100));
        await using var enumerator = backend.AcquireAsync(request, TestContext.Current.CancellationToken).GetAsyncEnumerator(TestContext.Current.CancellationToken);
        Assert.Equal(0, backend.PagesProduced);
        Assert.True(await enumerator.MoveNextAsync());
        Assert.Equal(1, backend.PagesProduced);
        Assert.True(backend.StreamDisposed == false);
        await enumerator.DisposeAsync();
        Assert.True(backend.StreamDisposed);
        Assert.Equal(1, backend.PagesProduced);
    }

    [Fact]
    public async Task Pre_cancel_and_pending_move_next_cancel_are_distinct_from_failure()
    {
        await using var backend = new FakeBackend { WaitForFirstPage = true };
        var request = new ScanRequest(JobId.Parse("0123456789abcdef"), "route-1", new EffectiveSettings("flatbed", 300, "gray", "a4", new SizeMm(210, 297), 1), new AcquisitionLimits(1, 100, 100));
        using var pre = new CancellationTokenSource();
        pre.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await foreach (var _ in backend.AcquireAsync(request, pre.Token)) { }
        });
        Assert.Equal(0, backend.PagesProduced);

        using var pending = new CancellationTokenSource();
        await using var enumerator = backend.AcquireAsync(request, pending.Token).GetAsyncEnumerator(pending.Token);
        var move = enumerator.MoveNextAsync().AsTask();
        pending.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await move);
        Assert.Equal(0, backend.PagesProduced);
    }

    private sealed class FakeBackend : IScanBackend
    {
        public int PagesProduced { get; private set; }
        public int MaxPagesInFlight { get; private set; }
        public bool StreamDisposed { get; private set; }
        public bool BackendDisposed { get; private set; }
        public bool WaitForFirstPage { get; init; }
        public TaskCompletionSource<bool> Gate { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new DeviceList(
                new[] { new Device("route-1", "Fake", "virtual", "virtual") },
                new Discovery("idle", DateTimeOffset.UnixEpoch, Array.Empty<string>())));

        public ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default) => ListDevicesAsync(cancellationToken);

        public ValueTask<DeviceCaps> GetDeviceCapsAsync(string routeId, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new DeviceCaps(routeId, Array.Empty<SourceCaps>()));

        public async IAsyncEnumerable<Page> AcquireAsync(
            ScanRequest request,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            try
            {
                var count = Math.Min(request.Limits.MaxPages, request.Settings.MaxPages ?? request.Limits.MaxPages);
                for (var index = 0; index < count; index++)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (WaitForFirstPage && index == 0)
                    {
                        await Gate.Task.WaitAsync(cancellationToken);
                    }
                    if (index == 2)
                    {
                        throw new ScanFailureException(new ScanError("paper-jam", "jam", Retryable: true), PagesProduced);
                    }

                    PagesProduced++;
                    MaxPagesInFlight = 1;
                    yield return new Page(index, index / 2, index % 2 == 0 ? "front" : "back", 1, 1, new PageResolution(300, 300), "gray", $"e{index}", DateTimeOffset.UnixEpoch, new[] { (byte)index });
                }
            }
            finally
            {
                StreamDisposed = true;
            }
        }

        public ValueTask DisposeAsync()
        {
            BackendDisposed = true;
            return ValueTask.CompletedTask;
        }
    }
}
