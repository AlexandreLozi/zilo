using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Zilo.Agent;
using Zilo.Core;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class CapabilityHttpTests
{
    [Fact]
    public async Task Unknown_resolution_kind_and_unknown_response_values_are_retained_with_safe_fallback_default()
    {
        var backend = new Backend
        {
            Caps = new("device", [new SourceCaps("future-source", new ResolutionCaps("future-resolution", [17, 29], 3, 999, 7),
                ["future-color"], [new PageSize("future-page", 210, 297)], new SizeMm(210, 297), false, null, new SourceDefaults(300, "future-color", "future-page"))])
        };
        var (app, client) = await Start(backend);
        await using var lifetime = app;
        using var http = client;
        using var response = await Caps(client);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var source = body.RootElement.GetProperty("sources")[0];
        Assert.Equal("future-source", source.GetProperty("source").GetString());
        Assert.Equal("future-resolution", source.GetProperty("resolutions").GetProperty("kind").GetString());
        Assert.Equal(17, source.GetProperty("resolutions").GetProperty("values")[0].GetInt32());
        Assert.Equal(7, source.GetProperty("resolutions").GetProperty("step").GetInt32());
        Assert.Equal(300, source.GetProperty("defaults").GetProperty("resolution").GetInt32());
        Assert.Equal("future-color", source.GetProperty("defaults").GetProperty("colorMode").GetString());
        Assert.Equal("future-page", source.GetProperty("defaults").GetProperty("pageSize").GetString());
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData(double.NaN, 300, false)]
    [InlineData(double.PositiveInfinity, 300, false)]
    [InlineData(double.MaxValue, 300, false)]
    [InlineData(-1, 300, false)]
    [InlineData(210, int.MaxValue, false)]
    [InlineData(210, 0, false)]
    [InlineData(210, 300, true)]
    public async Task Extreme_caps_or_unsupported_opaque_default_return_safe_contract_problem(double width, int dpi, bool invalidPages)
    {
        var backend = new Backend
        {
            Caps = new("device", [new SourceCaps("flatbed", ResolutionCaps.Unknown("future"), ["gray"], [], new SizeMm(width, 297), false,
                invalidPages ? -1 : null, new SourceDefaults(dpi, "gray", "max"))])
        };
        var (app, client) = await Start(backend);
        await using var lifetime = app;
        using var http = client;
        using var response = await Caps(client);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
        var raw = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        using var problem = JsonDocument.Parse(raw);
        Assert.Equal("unknown", problem.RootElement.GetProperty("code").GetString());
        Assert.DoesNotContain("NaN", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("Infinity", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("sources", raw, StringComparison.Ordinal);
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData("not-found", 404, false)]
    [InlineData("device-busy", 409, true)]
    [InlineData("timeout", 504, true)]
    [InlineData("permission", 403, false)]
    [InlineData("disconnected", 503, true)]
    [InlineData("unknown", 500, false)]
    public async Task Typed_failure_HTTP_mapping_preserves_safe_code_and_retryability(string code, int status, bool retryable)
    {
        var backend = new Backend { Error = new ScanError(code, "safe", retryable) };
        var (app, client) = await Start(backend);
        await using var lifetime = app;
        using var http = client;
        using var response = await Caps(client);
        Assert.Equal(status, (int)response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(code, problem.RootElement.GetProperty("code").GetString());
        Assert.Equal(retryable, problem.RootElement.GetProperty("retryable").GetBoolean());
        Assert.Equal("https://example.test", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Driver_defaults_are_completed_with_supported_bounded_values(bool range)
    {
        var backend = new Backend
        {
            Caps = new DeviceCaps("device", [new SourceCaps("flatbed", range ? ResolutionCaps.Range(100, 1000, 200) : ResolutionCaps.List([200, 400, 1600]),
                ["gray"], [], new SizeMm(210, 297), false, null, new SourceDefaults(1600, "color", "missing"))])
        };
        var (app, client) = await Start(backend);
        await using var lifetime = app;
        using var http = client;
        using var response = await Caps(client);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var caps = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var source = caps.RootElement.GetProperty("sources")[0];
        Assert.Equal(range ? 300 : 400, source.GetProperty("defaults").GetProperty("resolution").GetInt32());
        Assert.Equal("gray", source.GetProperty("defaults").GetProperty("colorMode").GetString());
        Assert.Equal("max", source.GetProperty("defaults").GetProperty("pageSize").GetString());
        Assert.Equal("max", source.GetProperty("pageSizes")[0].GetProperty("id").GetString());
        await app.StopAsync(TestContext.Current.CancellationToken);
    }

    private static async Task<(WebApplication, HttpClient)> Start(Backend backend)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
        var app = AgentHost.Build(builder, new AgentOptions { BakedOrigins = ["https://example.test"], DiscoveryBackends = [new("test", backend)] });
        await app.StartAsync(TestContext.Current.CancellationToken);
        await app.Services.GetRequiredService<DiscoveryService>().RefreshAsync(TestContext.Current.CancellationToken);
        var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
        using var request = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/auth/token");
        request.Headers.Add("Origin", "https://example.test");
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        using var token = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token.RootElement.GetProperty("token").GetString());
        client.DefaultRequestHeaders.Add("Origin", "https://example.test");
        return (app, client);
    }

    private static Task<HttpResponseMessage> Caps(HttpClient client) => client.GetAsync("/zilo/v1/devices/device/caps", TestContext.Current.CancellationToken);

    private sealed class Backend : IScanBackend
    {
        public ScanError? Error { get; init; }
        public DeviceCaps? Caps { get; init; }
        public ValueTask<DeviceList> ListDevicesAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(new DeviceList([new Device("device", "Device", "test", "usb")], new Discovery("idle", null)));
        public ValueTask<DeviceList> RefreshDevicesAsync(CancellationToken cancellationToken = default) => ListDevicesAsync(cancellationToken);
        public ValueTask<DeviceCaps> GetDeviceCapsAsync(string deviceId, CancellationToken cancellationToken = default)
            => Error is null ? ValueTask.FromResult(Caps!) : throw new ScanFailureException(Error, 0);
        public IAsyncEnumerable<Page> AcquireAsync(ScanRequest request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
