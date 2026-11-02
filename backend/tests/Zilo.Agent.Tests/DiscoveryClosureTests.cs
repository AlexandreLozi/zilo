using Xunit;
using Zilo.Agent;
using Zilo.Core;

namespace Zilo.Agent.Tests;

public sealed class DiscoveryClosureTests
{
    [Fact]
    public async Task Shutdown_grace_is_fake_time_bounded_even_when_cancellation_callback_stalls()
    {
        var backend = new ControlledBackend { StallRefresh = true, BlockCancellation = true };
        var time = new ManualTime();
        var grace = TimeSpan.FromSeconds(2);
        var discovery = new DiscoveryService([new("test", backend), new("alias", backend)], timeProvider: time, shutdownGrace: grace);
        await discovery.StartAsync(TestContext.Current.CancellationToken);
        await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        var stopping = discovery.StopAsync(TestContext.Current.CancellationToken);
        await backend.CancellationStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        await time.WaitForTimer(grace, TestContext.Current.CancellationToken);
        time.Advance(grace);
        await stopping;
        Assert.Equal(1, backend.RefreshCalls);
        Assert.Equal(1, discovery.RetainedCallCount);
        Assert.Equal(0, backend.DisposeCalls);
        backend.ReleaseCancellation.SetResult();
        backend.Refresh.SetResult(Devices());
        await discovery.DisposeAsync();
        await discovery.ShutdownCompletion.WaitAsync(TestContext.Current.CancellationToken);
        Assert.Equal(1, backend.DisposeCalls);
    }

    [Fact]
    public async Task Hung_caps_wait_is_bounded_without_releasing_its_owned_slot()
    {
        var backend = new ControlledBackend();
        var time = new ManualTime();
        var timeout = TimeSpan.FromSeconds(15);
        await using var discovery = new DiscoveryService([new("test", backend)], timeout, time);
        await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        var pending = discovery.GetCapsAsync("device", TestContext.Current.CancellationToken).AsTask();
        await backend.CapsStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        await time.WaitForTimer(timeout, TestContext.Current.CancellationToken);
        time.Advance(timeout);
        var error = await Assert.ThrowsAsync<ScanFailureException>(() => pending);
        Assert.Equal("timeout", error.Error.Code);
        await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        Assert.Equal(1, backend.RefreshCalls);
        for (var i = 0; i < 10; i++)
            Assert.Equal("device-busy", (await Assert.ThrowsAsync<ScanFailureException>(() => discovery.GetCapsAsync("device", TestContext.Current.CancellationToken).AsTask())).Error.Code);
        Assert.Equal(1, backend.CapsCalls);
        Assert.Equal(1, discovery.RetainedCallCount);
        backend.Caps.SetResult(Caps());
    }

    [Fact]
    public async Task Hung_probe_prevents_caps_from_bypassing_backend_admission()
    {
        var backend = new ControlledBackend();
        var time = new ManualTime();
        var timeout = TimeSpan.FromSeconds(15);
        await using var discovery = new DiscoveryService([new("test", backend)], timeout, time);
        await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        backend.StallRefresh = true;
        var pending = discovery.RefreshAsync(TestContext.Current.CancellationToken);
        await time.WaitForTimer(timeout, TestContext.Current.CancellationToken);
        time.Advance(timeout);
        var result = await pending;
        Assert.Contains("test", result.Discovery.IncompleteDrivers);
        var caps = discovery.GetCapsAsync("device", TestContext.Current.CancellationToken).AsTask();
        if (!caps.IsCompleted) backend.Caps.SetResult(Caps());
        var failure = await Assert.ThrowsAsync<ScanFailureException>(() => caps);
        Assert.Equal("device-busy", failure.Error.Code);
        Assert.Equal(0, backend.CapsCalls);
        backend.Refresh.SetResult(Devices());
    }

    [Fact]
    public async Task Refresh_coalesces_and_cancelling_one_caller_does_not_cancel_the_other()
    {
        var backend = new ControlledBackend { StallRefresh = true };
        await using var discovery = new DiscoveryService([new("test", backend)]);
        using var caller = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var first = discovery.RefreshAsync(caller.Token);
        var second = discovery.RefreshAsync(TestContext.Current.CancellationToken);
        await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        await caller.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        Assert.False(second.IsCompleted);
        backend.Refresh.SetResult(Devices());
        Assert.Single((await second).Devices);
        Assert.Equal(1, backend.RefreshCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Late_success_or_fault_cannot_overwrite_a_newer_committed_cache(bool fault)
    {
        var backend = new ControlledBackend { StallRefresh = true };
        var time = new ManualTime();
        await using var discovery = new DiscoveryService([new("test", backend)], TimeSpan.FromSeconds(15), time);
        var first = discovery.RefreshAsync(TestContext.Current.CancellationToken);
        await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        await time.WaitForTimer(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        time.Advance(TimeSpan.FromSeconds(15));
        await first;
        time.Advance(TimeSpan.FromSeconds(1));
        var newer = await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        if (fault) backend.Refresh.SetException(new InvalidOperationException("private-backend-secret"));
        else backend.Refresh.SetResult(Devices("late"));
        // The shutdown ownership barrier observes the exact retained task's completion.
        await discovery.DisposeAsync();
        await discovery.ShutdownCompletion.WaitAsync(TestContext.Current.CancellationToken);
        Assert.Same(newer, discovery.List());
        Assert.Empty(discovery.List().Devices);
        Assert.Equal(1, backend.DisposeCalls);
    }

    [Fact]
    public async Task Startup_and_thirty_second_periodic_refresh_clear_stale_routes_with_injected_time()
    {
        var backend = new ControlledBackend { StallRefresh = true };
        var time = new ManualTime();
        var discovery = new DiscoveryService([new("test", backend)], timeProvider: time);
        await discovery.StartAsync(TestContext.Current.CancellationToken);
        await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        var startup = discovery.RefreshAsync(TestContext.Current.CancellationToken);
        backend.Refresh.SetResult(Devices());
        await startup;
        Assert.Single(discovery.List().Devices);
        backend.Refresh = new(TaskCreationOptions.RunContinuationsAsynchronously);
        backend.RefreshStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        time.Advance(TimeSpan.FromSeconds(30));
        await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        var periodic = discovery.RefreshAsync(TestContext.Current.CancellationToken);
        backend.Refresh.SetResult(new([], new Discovery("idle", null)));
        await periodic;
        Assert.Empty(discovery.List().Devices);
        Assert.Null(await discovery.GetCapsAsync("device", TestContext.Current.CancellationToken));
        await discovery.StopAsync(TestContext.Current.CancellationToken);
        await discovery.DisposeAsync();
        await discovery.ShutdownCompletion.WaitAsync(TestContext.Current.CancellationToken);
        Assert.Equal(1, backend.DisposeCalls);
        Assert.Equal(2, backend.RefreshCalls);
    }

    internal static DeviceList Devices(string id = "device") => new([new Device(id, "Device", "test", "usb")], new Discovery("idle", null));
    internal static DeviceCaps Caps() => new("device", [new SourceCaps("flatbed", ResolutionCaps.List([300]), ["gray"], [new PageSize("a4", 210, 297)], new SizeMm(210, 297), false, null, new SourceDefaults(300, "gray", "a4"))]);

    internal sealed class ControlledBackend : IScanBackend
    {
        public bool StallRefresh { get; set; }
        public bool BlockCancellation { get; set; }
        public int RefreshCalls;
        public int CapsCalls;
        public int DisposeCalls;
        public DeviceList Snapshot { get; set; } = Devices();
        public TaskCompletionSource<DeviceList> Refresh { get; set; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<DeviceCaps> Caps { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource CapsStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource RefreshStarted { get; set; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource CancellationStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ReleaseCancellation { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref RefreshCalls);
            if (BlockCancellation) cancellationToken.Register(() => { CancellationStarted.TrySetResult(); ReleaseCancellation.Task.GetAwaiter().GetResult(); });
            RefreshStarted.TrySetResult();
            return StallRefresh ? new(Refresh.Task) : ValueTask.FromResult(Snapshot);
        }
        public ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId, CancellationToken cancellationToken = default)
        { Interlocked.Increment(ref CapsCalls); CapsStarted.TrySetResult(); return new(Caps.Task); }
        public ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<Page> AcquireAsync(ScanRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask DisposeAsync() { Interlocked.Increment(ref DisposeCalls); return ValueTask.CompletedTask; }
    }
}
