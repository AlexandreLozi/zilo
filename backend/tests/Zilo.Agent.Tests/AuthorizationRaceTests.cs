using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Zilo.Agent;
using Zilo.Core;
using Zilo.Security;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class AuthorizationRaceTests
{
    private const string Origin = "https://example.test";

    [Fact]
    public async Task Revocation_during_stalled_refresh_denies_without_releasing_discovery_result()
    {
        var backend = new StalledBackend(stallRefresh: true);
        await using var agent = await StartAsync(backend);
        await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);

        var token = await IssueTokenAsync(agent.Client);
        using var refresh = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/devices/refresh")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        };
        refresh.Headers.Add("Origin", Origin);
        refresh.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var refreshTask = agent.Client.SendAsync(refresh, TestContext.Current.CancellationToken);

        await backend.RefreshCallStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        using var revoke = new HttpRequestMessage(HttpMethod.Delete, "/zilo/v1/auth/token");
        revoke.Headers.Add("Origin", Origin);
        revoke.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var revoked = await agent.Client.SendAsync(revoke, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, revoked.StatusCode);

        backend.ReleaseRefresh.TrySetResult(true);
        using var result = await refreshTask;
        Assert.Equal(HttpStatusCode.Unauthorized, result.StatusCode);
        Assert.Equal(Origin, result.Headers.GetValues("Access-Control-Allow-Origin").Single());
        using var problem = JsonDocument.Parse(await result.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("token-revoked", problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Revocation_during_stalled_caps_lookup_denies_before_caps_are_written()
    {
        var backend = new StalledBackend(stallCaps: true);
        await using var agent = await StartAsync(backend);
        await backend.RefreshCompleted.Task.WaitAsync(TestContext.Current.CancellationToken);

        var token = await IssueTokenAsync(agent.Client);
        using var caps = new HttpRequestMessage(HttpMethod.Get, "/zilo/v1/devices/device/caps");
        caps.Headers.Add("Origin", Origin);
        caps.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var capsTask = agent.Client.SendAsync(caps, TestContext.Current.CancellationToken);

        await backend.CapsCallStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        using var revoke = new HttpRequestMessage(HttpMethod.Delete, "/zilo/v1/auth/token");
        revoke.Headers.Add("Origin", Origin);
        revoke.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var revoked = await agent.Client.SendAsync(revoke, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, revoked.StatusCode);

        backend.ReleaseCaps.TrySetResult(true);
        using var result = await capsTask;
        Assert.Equal(HttpStatusCode.Unauthorized, result.StatusCode);
        Assert.Equal(Origin, result.Headers.GetValues("Access-Control-Allow-Origin").Single());
        using var problem = JsonDocument.Parse(await result.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("token-revoked", problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Removing_origin_while_protected_body_is_read_returns_forbidden_without_cors()
    {
        await using var agent = await StartAsync(new StalledBackend(), bakedOrigin: false);
        agent.App.Services.GetRequiredService<ConsentStore>().Grant(Origin);
        var token = await IssueTokenAsync(agent.Client);
        using var body = new GatedJsonContent();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/devices/refresh") { Content = body };
        request.Headers.Add("Origin", Origin);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var responseTask = agent.Client.SendAsync(request, TestContext.Current.CancellationToken);

        await body.FirstByteWritten.Task.WaitAsync(TestContext.Current.CancellationToken);
        agent.App.Services.GetRequiredService<ConsentStore>().Remove(Origin);
        body.Release.TrySetResult(true);

        using var response = await responseTask;
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("unauthorized-origin", problem.RootElement.GetProperty("code").GetString());
    }

    private static async Task<string> IssueTokenAsync(HttpClient client)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/auth/token");
        request.Headers.Add("Origin", Origin);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        return json.RootElement.GetProperty("token").GetString()!;
    }

    private static async Task<RunningAgent> StartAsync(StalledBackend backend, bool bakedOrigin = true)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
        var app = AgentHost.Build(builder, new AgentOptions
        {
            BakedOrigins = bakedOrigin ? [Origin] : [],
            DiscoveryBackends = [new DiscoveryBackendRegistration("test", backend)]
        });
        await app.StartAsync(TestContext.Current.CancellationToken);
        var address = app.Urls.Single();
        return new RunningAgent(app, new HttpClient { BaseAddress = new Uri(address) });
    }

    private sealed class RunningAgent(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public WebApplication App { get; } = app;
        public HttpClient Client { get; } = client;

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await App.StopAsync();
            await App.DisposeAsync();
        }
    }

    private sealed class StalledBackend(bool stallRefresh = false, bool stallCaps = false) : IScanBackend
    {
        private readonly bool _stallRefresh = stallRefresh;
        private readonly bool _stallCaps = stallCaps;
        private readonly DeviceList _devices = new([new Device("device", "Test device", "test", "usb")], new Discovery("idle", DateTimeOffset.UtcNow));
        private readonly DeviceCaps _caps = new("device", [new SourceCaps("flatbed", ResolutionCaps.List([300]), ["gray"], [new PageSize("a4", 210, 297)], new SizeMm(210, 297), false, null, new SourceDefaults(300, "gray", "a4"))]);
        public TaskCompletionSource<bool> RefreshStarted { get; } = NewSignal();
        public TaskCompletionSource<bool> RefreshCallStarted { get; } = NewSignal();
        public TaskCompletionSource<bool> RefreshCompleted { get; } = NewSignal();
        public TaskCompletionSource<bool> ReleaseRefresh { get; } = NewSignal();
        public TaskCompletionSource<bool> CapsCallStarted { get; } = NewSignal();
        public TaskCompletionSource<bool> ReleaseCaps { get; } = NewSignal();

        public ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(_devices);

        public async ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default)
        {
            RefreshStarted.TrySetResult(true);
            RefreshCallStarted.TrySetResult(true);
            try
            {
                if (_stallRefresh) await ReleaseRefresh.Task.WaitAsync(cancellationToken);
                return _devices;
            }
            finally { RefreshCompleted.TrySetResult(true); }
        }

        public async ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId, CancellationToken cancellationToken = default)
        {
            CapsCallStarted.TrySetResult(true);
            if (_stallCaps) await ReleaseCaps.Task.WaitAsync(cancellationToken);
            return _caps;
        }

        public async IAsyncEnumerable<Page> AcquireAsync(ScanRequest request, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield break;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private static TaskCompletionSource<bool> NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    private sealed class GatedJsonContent : HttpContent
    {
        public TaskCompletionSource<bool> FirstByteWritten { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool> Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            await stream.WriteAsync(new byte[] { (byte)'{' });
            await stream.FlushAsync();
            FirstByteWritten.TrySetResult(true);
            await Release.Task;
            await stream.WriteAsync(new byte[] { (byte)'}' });
        }

        protected override bool TryComputeLength(out long length)
        {
            length = 2;
            return true;
        }
    }
}
