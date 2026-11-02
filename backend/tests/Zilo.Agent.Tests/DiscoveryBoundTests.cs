using Xunit;
using Zilo.Agent;
using Zilo.Core;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class DiscoveryBoundTests
{
    [Fact]
    public async Task Host_disposes_each_backend_once_after_owned_work_finishes()
    {
        var backend = new Backend();
        var builder = Microsoft.AspNetCore.Builder.WebApplication.CreateBuilder();
        var app = AgentHost.Build(builder, new AgentOptions { DiscoveryBackends = [new("test", backend)] });
        await app.StartAsync(TestContext.Current.CancellationToken);
        await app.StopAsync(TestContext.Current.CancellationToken);
        backend.Release.TrySetResult(new DeviceList([], new Discovery("idle", null)));
        await app.DisposeAsync();
        var winner = await Task.WhenAny(backend.Disposed.Task, Task.Delay(TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken));
        Assert.Same(backend.Disposed.Task, winner);
        Assert.Equal(1, backend.DisposeCalls);
    }

    [Fact]
    public async Task Ignored_cancellation_is_bounded_and_late_result_cannot_overwrite_cache()
    {
        var backend = new Backend();
        var discovery = new DiscoveryService([new("test", backend)], TimeSpan.FromMilliseconds(25));
        var refresh = discovery.RefreshAsync(TestContext.Current.CancellationToken);
        var winner = await Task.WhenAny(refresh, Task.Delay(TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken));
        backend.Release.TrySetResult(new DeviceList([new Device("late", "Late", "test", "usb")], new Discovery("idle", null)));
        Assert.Same(refresh, winner);
        var result = await refresh;
        Assert.Contains("test", result.Discovery.IncompleteDrivers);
        Assert.Empty(discovery.List().Devices);
    }

    [Fact]
    public async Task Vanished_route_does_not_keep_a_backend_owner()
    {
        var backend = new Backend();
        backend.Release.SetResult(new DeviceList([new Device("route", "Device", "test", "usb")], new Discovery("idle", null)));
        var discovery = new DiscoveryService([new("test", backend)]);
        await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        backend.Empty = true;
        await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        Assert.Null(await discovery.GetCapsAsync("route", TestContext.Current.CancellationToken));
        Assert.Equal(0, backend.CapsCalls);
    }

    private sealed class Backend : IScanBackend
    {
        public TaskCompletionSource<DeviceList> Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Empty { get; set; }
        public int CapsCalls { get; private set; }
        public int DisposeCalls { get; private set; }
        public TaskCompletionSource Disposed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default) => Empty
            ? ValueTask.FromResult(new DeviceList([], new Discovery("idle", null))) : new(Release.Task);
        public ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId, CancellationToken cancellationToken = default)
        { CapsCalls++; throw new InvalidOperationException("stale owner invoked"); }
        public IAsyncEnumerable<Page> AcquireAsync(ScanRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask DisposeAsync() { DisposeCalls++; Disposed.TrySetResult(); return ValueTask.CompletedTask; }
    }
}
