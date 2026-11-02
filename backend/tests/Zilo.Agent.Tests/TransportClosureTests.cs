using System.Net;
using System.Text.Json;
using Xunit;
using Zilo.Agent;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class TransportClosureTests
{
    [Theory]
    [InlineData("bad host")]
    [InlineData("[invalid]")]
    public async Task Malformed_Host_is_Kestrel_transport_rejection_not_application_problem(string authority)
    {
        await using var host = await HttpTestAgent.Start();
        var result = await host.Raw($"Host: {authority}");
        Assert.StartsWith("HTTP/1.1 400", result, StringComparison.Ordinal);
        Assert.DoesNotContain("Zilo-Request-Id:", result, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Access-Control-Allow-Origin:", result, StringComparison.OrdinalIgnoreCase);
    }
    [Theory]
    [InlineData("https://localhost.")]
    [InlineData("http://app.localhost.")]
    [InlineData("https://[::ffff:127.0.0.1]")]
    [InlineData("https://[::ffff:0.0.0.0]")]
    public async Task Root_qualified_and_mapped_loopback_get_only_dev_diagnostics(string origin)
    {
        foreach (var dev in new[] { false, true })
        {
            await using var host = await HttpTestAgent.Start(new AgentOptions { DevMode = dev, BakedOrigins = [origin] });
            using var consent = await host.Send(HttpMethod.Get, "/zilo/v1/auth/consent", origin: origin);
            Assert.Equal(dev ? HttpStatusCode.OK : HttpStatusCode.Forbidden, consent.StatusCode);
            Assert.Equal(dev, consent.Headers.Contains("Access-Control-Allow-Origin"));
            using var protectedResponse = await host.Send(HttpMethod.Get, "/zilo/v1/devices", origin: origin, token: "invalid");
            Assert.Equal(HttpStatusCode.Forbidden, protectedResponse.StatusCode);
            Assert.False(protectedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        }
    }

    [Theory]
    [InlineData("null")]
    [InlineData("https://localhost..")]
    [InlineData("https://.localhost")]
    [InlineData("https://matrix.test/path")]
    [InlineData("https://matrix.test, https://evil.test")]
    public async Task Malformed_Origin_is_an_application_denial_without_CORS(string origin)
    {
        await using var host = await HttpTestAgent.Start();
        var result = await host.Raw($"Host: localhost:{host.Client.BaseAddress!.Port}\r\nOrigin: {origin}");
        Assert.StartsWith("HTTP/1.1 403", result, StringComparison.Ordinal);
        Assert.Contains("unauthorized-origin", result, StringComparison.Ordinal);
        Assert.Contains("Zilo-Request-Id:", result, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Access-Control-Allow-Origin:", result, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Duplicate_Host_is_framework_rejection_but_duplicate_Origin_is_application_denial()
    {
        await using var host = await HttpTestAgent.Start();
        var authority = $"localhost:{host.Client.BaseAddress!.Port}";
        var hostResult = await host.Raw($"Host: {authority}\r\nHost: {authority}");
        Assert.StartsWith("HTTP/1.1 400", hostResult, StringComparison.Ordinal);
        Assert.DoesNotContain("Zilo-Request-Id:", hostResult, StringComparison.OrdinalIgnoreCase);
        var originResult = await host.Raw($"Host: {authority}\r\nOrigin: {HttpTestAgent.Origin}\r\nOrigin: https://evil.test");
        Assert.StartsWith("HTTP/1.1 403", originResult, StringComparison.Ordinal);
        Assert.Contains("Zilo-Request-Id:", originResult, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Access-Control-Allow-Origin:", originResult, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("localhost.")]
    [InlineData("[::ffff:127.0.0.1]")]
    [InlineData("evil.test")]
    public async Task Valid_but_unlisted_Host_is_application_403_on_OPTIONS_too(string hostname)
    {
        await using var host = await HttpTestAgent.Start();
        var response = await host.Raw($"Host: {hostname}:{host.Client.BaseAddress!.Port}\r\nOrigin: {HttpTestAgent.Origin}\r\nAccess-Control-Request-Method: GET", method: "OPTIONS");
        Assert.StartsWith("HTTP/1.1 403", response, StringComparison.Ordinal);
        Assert.Contains("host-denied", response, StringComparison.Ordinal);
        Assert.DoesNotContain("Access-Control-Allow-Origin:", response, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OPTIONS_unknown_path_is_bodyless_and_wrong_method_has_Allow_before_auth()
    {
        await using var host = await HttpTestAgent.Start();
        var preflight = await host.Raw($"Host: localhost:{host.Client.BaseAddress!.Port}\r\nOrigin: {HttpTestAgent.Origin}\r\nAccess-Control-Request-Method: GET", "/zilo/v1/devices", "OPTIONS");
        Assert.StartsWith("HTTP/1.1 204", preflight, StringComparison.Ordinal);
        Assert.Contains("Access-Control-Allow-Methods: GET, POST, DELETE", preflight, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Access-Control-Allow-Headers: Authorization, Content-Type, Last-Event-ID, If-None-Match", preflight, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Access-Control-Max-Age: 600", preflight, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Access-Control-Allow-Credentials:", preflight, StringComparison.OrdinalIgnoreCase);
        using var unknown = await host.Send(HttpMethod.Options, "/zilo/v1/no-such-route");
        Assert.Equal(HttpStatusCode.Forbidden, unknown.StatusCode);
        Assert.Empty(await unknown.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        using var wrong = await host.Send(HttpMethod.Put, "/zilo/v1/devices");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, wrong.StatusCode);
        Assert.Contains("GET", wrong.Content.Headers.Allow);
        Assert.Equal(HttpTestAgent.Origin, wrong.Headers.GetValues("Access-Control-Allow-Origin").Single());
        using var absent = await host.Send(HttpMethod.Get, "/zilo/v1/auth/consent", origin: null);
        Assert.Equal(HttpStatusCode.Forbidden, absent.StatusCode);
        Assert.False(absent.Headers.Contains("Access-Control-Allow-Origin"));
        using var hello = await host.Send(HttpMethod.Get, "/zilo/v1/hello");
        using var body = JsonDocument.Parse(await hello.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("public", body.RootElement.GetProperty("scope").GetString());
        Assert.False(body.RootElement.TryGetProperty("instanceId", out _));
    }
}
