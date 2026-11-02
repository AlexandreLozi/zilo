using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.CompilerServices;
using Zilo.Core;

namespace Zilo.Drivers.Virtual;

/// <summary>
/// Deterministic, in-process scanner used by the agent and by integration tests. It deliberately
/// owns no jobs or storage: one enumerator is one bounded acquisition.
/// </summary>
public sealed class VirtualScanBackend : IScanBackend
{
    public const string DriverName = "virtual";
    public const string ConnectionName = "test-pages";

    private const long HardPixelLimit = 100_000_000;
    private const long HardByteLimit = 512L * 1024 * 1024;
    private const long HardInFlightBytes = 768L * 1024 * 1024;
    private static readonly int[] SupportedDpis = [75, 150, 300, 600];
    private static readonly ImmutableArray<PageSize> SupportedPaper =
    [
        new("A4", 210, 297), new("Letter", 215.9, 279.4),
        new("Legal", 215.9, 355.6), new("A5", 148, 210),
    ];

    private readonly TimeProvider _timeProvider;
    private readonly ImmutableArray<FailureVariant> _variants;
    private readonly ConcurrentDictionary<Guid, ActiveAcquisition> _active = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly DeviceList _devices;
    private readonly object _lifecycleGate = new();
    private Task? _disposeTask;
    private int _disposed;

    public VirtualScanBackend(TimeProvider? timeProvider = null,
        IEnumerable<FailureVariant>? variants = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _variants = (variants ?? VirtualDevices.Catalogue).ToImmutableArray();
        if (_variants.IsDefaultOrEmpty) throw new ArgumentException("At least one virtual route is required.", nameof(variants));
        if (_variants.Any(v => v is null)) throw new ArgumentException("Routes cannot be null.", nameof(variants));
        if (_variants.Select(v => v.DeviceId).Distinct(StringComparer.Ordinal).Count() != _variants.Length)
            throw new ArgumentException("Virtual route IDs must be unique.", nameof(variants));

        _devices = new DeviceList(
            _variants.Select(v => new Device(v.DeviceId, v.DeviceName, DriverName, ConnectionName,
                "Zilo", "Virtual Scanner")),
            new Discovery("complete", _timeProvider.GetUtcNow()));
    }

    public VirtualScanBackend(FailureVariant variant, TimeProvider? timeProvider = null)
        : this(timeProvider, [variant]) { }

    public ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(_devices);
    }

    public ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        cancellationToken.ThrowIfCancellationRequested();
        // Virtual discovery is local and immutable; refresh has no probe to perform.
        return ValueTask.FromResult(_devices);
    }

    public ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(deviceId);
        ThrowIfDisposed();
        cancellationToken.ThrowIfCancellationRequested();
        var variant = FindVariant(deviceId);
        if (variant is null) throw Failure("not-found", "The virtual scanner route was not found.", false, 0,
            $"{deviceId}:not-found");
        return ValueTask.FromResult(BuildCaps(variant.DeviceId));
    }

    public async IAsyncEnumerable<Page> AcquireAsync(ScanRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ThrowIfDisposed();

        using var operationCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, _lifetime.Token);
        var token = operationCancellation.Token;
        var active = new ActiveAcquisition();
        var id = Guid.NewGuid();
        lock (_lifecycleGate)
        {
            if (Volatile.Read(ref _disposed) != 0) throw new ObjectDisposedException(nameof(VirtualScanBackend));
            _active[id] = active;
        }
        var kept = 0;
        try
        {
            token.ThrowIfCancellationRequested();
            var variant = FindVariant(request.DeviceId);
            if (variant is null)
                throw Failure("not-found", "The virtual scanner route was not found.", false, 0,
                    $"{request.DeviceId}:not-found");

            ValidateRequest(request, variant);
            var settings = ToPageSettings(request);
            var feederCount = variant.Kind == FailureKind.FeederEmpty ? variant.AfterPages : null;

            if (variant.Kind == FailureKind.CoverOpen)
                throw Failure("cover-open", "The virtual scanner cover is open.", true, 0,
                    $"{variant.DeviceId}:cover-open");

            while (true)
            {
                if (!BeginWork(active))
                {
                    token.ThrowIfCancellationRequested();
                    throw new ObjectDisposedException(nameof(VirtualScanBackend));
                }
                token.ThrowIfCancellationRequested();
                if (request.Settings.MaxPages is int completionCount && kept >= completionCount)
                    yield break;
                if (request.Settings.Source == "flatbed" && kept >= 1)
                    yield break;
                if (feederCount is int available && kept >= available)
                {
                    if (available == 0)
                        throw Failure("feeder-empty", "The virtual feeder is empty.", true, kept,
                            $"{variant.DeviceId}:feeder-empty");
                    yield break;
                }
                if (kept >= request.Limits.MaxPages)
                    throw Failure("limits-exceeded", "The acquisition page safety limit was reached.", false,
                        kept, $"{variant.DeviceId}:limits-exceeded");

                var pageNumber = checked(kept + 1);
                var failure = FailureForPage(variant, pageNumber, kept);
                if (failure is not null) throw failure;

                if (variant.Kind == FailureKind.Slow && variant.DelayMs is > 0)
                    await Task.Delay(TimeSpan.FromMilliseconds(variant.DelayMs.Value), _timeProvider, token);

                token.ThrowIfCancellationRequested();
                var side = request.Settings.Source == "duplex" && (kept & 1) == 1
                    ? Side.Back : Side.Front;
                var seed = Seed(request.JobId.Value, kept, side, request.Settings);
                var layout = PageGenerator.Layout(settings, kept, side, seed);
                EnsurePageFits(layout.WidthPx, layout.HeightPx, settings.Mode, request.Limits, kept);
                var pageBytes = PageGenerator.Generate(settings, kept, side, seed, token);
                token.ThrowIfCancellationRequested();
                var page = new Page(
                    kept,
                    request.Settings.Source == "duplex" ? kept / 2 : kept,
                    side == Side.Front ? "front" : "back",
                    layout.WidthPx, layout.HeightPx,
                    new PageResolution(request.Settings.Resolution, request.Settings.Resolution),
                    request.Settings.ColorMode,
                    Convert.ToHexString(SHA256.HashData(pageBytes)),
                    _timeProvider.GetUtcNow(), pageBytes, ContentType: "image/png");
                kept++;
                // The iterator is now suspended at a consumer-owned page. Backend disposal need
                // not wait for a consumer to ask for another page; the retained Page is immutable.
                active.EndWork();
                yield return page;
            }
        }
        finally
        {
            lock (_lifecycleGate) _active.TryRemove(id, out _);
            active.EndWork();
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_lifecycleGate)
        {
            if (_disposeTask is not null) return new ValueTask(_disposeTask);
            Volatile.Write(ref _disposed, 1);
            _lifetime.Cancel();
            ActiveAcquisition[] operations;
            lock (_lifecycleGate) operations = _active.Values.ToArray();
            _disposeTask = FinishDisposeAsync(operations);
            return new ValueTask(_disposeTask);
        }
    }

    private async Task FinishDisposeAsync(ActiveAcquisition[] operations)
    {
        var waits = operations.Select(a => a.Completion).ToArray();
        if (waits.Length != 0) await Task.WhenAll(waits);
        _lifetime.Dispose();
    }

    private FailureVariant? FindVariant(string deviceId) =>
        _variants.FirstOrDefault(v => string.Equals(v.DeviceId, deviceId, StringComparison.Ordinal));

    private bool BeginWork(ActiveAcquisition active)
    {
        lock (_lifecycleGate)
        {
            if (Volatile.Read(ref _disposed) != 0) return false;
            active.BeginWork();
            return true;
        }
    }

    private static DeviceCaps BuildCaps(string deviceId)
    {
        var papers = SupportedPaper;
        var sources = new[]
        {
            new SourceCaps("flatbed", ResolutionCaps.List(SupportedDpis), ["color", "gray", "bw"], papers,
                new SizeMm(215.9, 355.6), false, 1, new SourceDefaults(300, "color", "A4")),
            new SourceCaps("feeder", ResolutionCaps.List(SupportedDpis), ["color", "gray", "bw"], papers,
                new SizeMm(215.9, 355.6), false, null, new SourceDefaults(300, "color", "A4")),
            new SourceCaps("duplex", ResolutionCaps.List(SupportedDpis), ["color", "gray", "bw"], papers,
                new SizeMm(215.9, 355.6), false, null, new SourceDefaults(300, "color", "A4")),
        };
        return new DeviceCaps(deviceId, sources, new DeviceLimits(null, HardPixelLimit, 600));
    }

    private static void ValidateRequest(ScanRequest request, FailureVariant variant)
    {
        var s = request.Settings;
        if (string.IsNullOrWhiteSpace(s.Source)) throw Invalid("Source is required.");
        if (s.Source is not ("flatbed" or "feeder" or "duplex"))
            throw Unsupported("The selected source is not supported.");
        if (s.Resolution <= 0 || s.Resolution > 600)
            throw Invalid("The requested resolution is outside the virtual scanner limit.");
        if (!SupportedDpis.Contains(s.Resolution)) throw Unsupported("The requested resolution is not supported.");
        if (s.ColorMode is not ("color" or "gray" or "bw"))
            throw Unsupported("The requested color mode is not supported.");
        var paper = SupportedPaper.FirstOrDefault(p => p.Id == s.PageSize);
        if (paper is null) throw Invalid("The requested page size is unknown.");
        if (!double.IsFinite(s.PageSizeMm.WidthMm) || !double.IsFinite(s.PageSizeMm.HeightMm) ||
            s.PageSizeMm.WidthMm <= 0 || s.PageSizeMm.HeightMm <= 0)
            throw Invalid("The requested page dimensions are invalid.");
        if (s.PageSizeMm.WidthMm > 215.9 || s.PageSizeMm.HeightMm > 355.6)
            throw Invalid("The requested page dimensions exceed the scanner limit.");
        if (Math.Abs(s.PageSizeMm.WidthMm - paper.WidthMm) > 0.001 ||
            Math.Abs(s.PageSizeMm.HeightMm - paper.HeightMm) > 0.001)
            throw Invalid("The requested dimensions do not match the selected page size.");
        if (s.MaxPages is <= 0) throw Invalid("MaxPages must be positive when supplied.");
        if (s.Source == "flatbed" && s.MaxPages is > 1)
            throw Unsupported("The flatbed source supports one page per acquisition.");
        if (s.MaxPages is int requested && requested > request.Limits.MaxPages)
            throw Failure("limits-exceeded", "The requested page count exceeds the acquisition limit.", false, 0,
                $"{variant.DeviceId}:limits-exceeded");
    }

    private static PageSettings ToPageSettings(ScanRequest request) => new(
        request.Settings.Resolution,
        request.Settings.ColorMode switch { "color" => ColorMode.Color, "gray" => ColorMode.Gray, _ => ColorMode.Bw },
        request.Settings.PageSize switch { "A4" => PaperSize.A4, "Letter" => PaperSize.Letter,
            "Legal" => PaperSize.Legal, _ => PaperSize.A5 },
        request.Settings.Source switch { "flatbed" => ScanSource.Flatbed, "feeder" => ScanSource.Feeder,
            _ => ScanSource.Duplex }, request.JobId.Value);

    private static ScanFailureException? FailureForPage(FailureVariant variant, int pageNumber, int kept)
    {
        if (variant.AtPage != pageNumber) return null;
        var code = variant.Kind switch
        {
            FailureKind.PaperJam => "paper-jam",
            FailureKind.Timeout => "timeout",
            FailureKind.Disconnect => "disconnected",
            _ => null,
        };
        return code is null ? null : Failure(code, $"The virtual scanner reported {code}.", true, kept,
            $"{variant.DeviceId}:{code}:{pageNumber}");
    }

    private static void EnsurePageFits(int width, int height, ColorMode mode,
        AcquisitionLimits limits, int pagesKept)
    {
        var pixels = checked((long)width * height);
        if (pixels > limits.MaxPixelsPerPage || pixels > HardPixelLimit)
            throw Failure("limits-exceeded", "The page exceeds the pixel safety limit.", false, pagesKept,
                "virtual:pixel-limit");
        var rowBytes = mode switch
        {
            ColorMode.Bw => checked(((long)width + 7) / 8),
            ColorMode.Gray => width,
            ColorMode.Color => checked((long)width * 3),
            _ => throw new ArgumentOutOfRangeException(nameof(mode)),
        };
        var rawBytes = checked((rowBytes + 1) * height);
        // A fixed-Huffman stream can expand an incompressible row by at most one eighth,
        // plus framing. This bound is checked before Raster/raw/PNG allocations are made.
        var compressedUpperBound = checked(rawBytes + ((rawBytes + 7) / 8) + 1024);
        var pngUpperBound = checked(8 + 25 + 21 + 12 + compressedUpperBound);
        if (pngUpperBound > limits.MaxBytesPerPage || pngUpperBound > HardByteLimit)
            throw Failure("limits-exceeded", "The page exceeds the byte safety limit.", false, pagesKept,
                "virtual:byte-limit");
        // Raster, filtered rows, compressed output and the immutable Page copy can coexist.
        var inFlight = checked(pixels * 3 + rawBytes + pngUpperBound * 2);
        if (inFlight > HardInFlightBytes)
            throw Failure("limits-exceeded", "The page exceeds the in-flight memory limit.", false, pagesKept,
                "virtual:memory-limit");
    }

    private static uint Seed(string job, int page, Side side, EffectiveSettings settings)
    {
        var text = string.Create(System.Globalization.CultureInfo.InvariantCulture,
            $"{job}|{page}|{side.Name()}|{settings.Resolution}|{settings.ColorMode}|{settings.PageSize}");
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(text));
        return BinaryPrimitives.ReadUInt32LittleEndian(hash);
    }

    private static ScanFailureException Invalid(string message) =>
        Failure("invalid-settings", message, false, 0, "virtual:invalid-settings");

    private static ScanFailureException Unsupported(string message) =>
        Failure("unsupported-capability", message, false, 0, "virtual:unsupported-capability");

    private static ScanFailureException Failure(string code, string message, bool retryable, int pages, string id) =>
        new(new ScanError(code, message, retryable, id), pages);

    private void ThrowIfDisposed()
    {
        if (Volatile.Read(ref _disposed) != 0) throw new ObjectDisposedException(nameof(VirtualScanBackend));
    }

    private sealed class ActiveAcquisition
    {
        private readonly object _gate = new();
        private TaskCompletionSource _completion = CompletedSource();

        public Task Completion { get { lock (_gate) return _completion.Task; } }

        public void BeginWork() { lock (_gate) _completion = PendingSource(); }
        public void EndWork() { lock (_gate) _completion.TrySetResult(); }

        private static TaskCompletionSource CompletedSource()
        {
            var source = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            source.SetResult();
            return source;
        }
        private static TaskCompletionSource PendingSource() =>
            new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}

/// <summary>Agent wiring can depend on this small factory without knowing the implementation type.</summary>
public static class VirtualBackendFactory
{
    public static IScanBackend Create(TimeProvider? timeProvider = null,
        IEnumerable<FailureVariant>? variants = null) => new VirtualScanBackend(timeProvider, variants);
}
