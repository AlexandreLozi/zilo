using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Xunit;
using Zilo.Agent;
using Zilo.Security;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class ContinuationHttpTests
{
    private const string Origin = "https://example.test";

    [Fact]
    public async Task Renewal_HTTP_obeys_early_replay_grace_and_family_deadline_rules()
    {
        var clock = new Clock();
        await using var host = await Host.Start(new AgentLimits { TokenTtlSeconds = 300, FamilyMaxSeconds = 3600 }, clock);
        using var issuedResponse = await host.Send("{}");
        using var issued = JsonDocument.Parse(await issuedResponse.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var first = issued.RootElement.GetProperty("token").GetString()!;
        using var early = await host.Protected("/zilo/v1/auth/token/renew", first, HttpMethod.Post);
        Assert.Equal(HttpStatusCode.TooManyRequests, early.StatusCode);
        Assert.NotNull(early.Headers.RetryAfter);
        clock.UtcNow = issued.RootElement.GetProperty("renewAfter").GetDateTimeOffset();
        using var renewedResponse = await host.Protected("/zilo/v1/auth/token/renew", first, HttpMethod.Post);
        Assert.Equal(HttpStatusCode.OK, renewedResponse.StatusCode);
        using var renewed = JsonDocument.Parse(await renewedResponse.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(issued.RootElement.GetProperty("familyId").GetString(), renewed.RootElement.GetProperty("familyId").GetString());
        var successor = renewed.RootElement.GetProperty("token").GetString()!;
        using var replay = await host.Protected("/zilo/v1/auth/token/renew", first, HttpMethod.Post);
        Assert.Equal(HttpStatusCode.Conflict, replay.StatusCode);
        using var grace = await host.Protected("/zilo/v1/devices", first);
        Assert.Equal(HttpStatusCode.OK, grace.StatusCode);
        clock.UtcNow = clock.UtcNow.AddSeconds(60);
        using var obsolete = await host.Protected("/zilo/v1/devices", first);
        Assert.Equal(HttpStatusCode.Unauthorized, obsolete.StatusCode);
        Assert.Contains("invalid_token", obsolete.Headers.WwwAuthenticate.ToString());
        using var current = await host.Protected("/zilo/v1/devices", successor);
        Assert.Equal(HttpStatusCode.OK, current.StatusCode);
        clock.UtcNow = issued.RootElement.GetProperty("familyExpiresAt").GetDateTimeOffset();
        using var ended = await host.Protected("/zilo/v1/devices", successor);
        Assert.Equal(HttpStatusCode.Unauthorized, ended.StatusCode);
    }

    [Fact]
    public async Task Final_token_is_not_renewed_but_stays_valid_until_its_deadline()
    {
        var clock = new Clock();
        await using var host = await Host.Start(new AgentLimits { FamilyMaxSeconds = 3600 }, clock);
        using var response = await host.Send("{}");
        using var issued = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var token = issued.RootElement.GetProperty("token").GetString()!;
        Assert.Equal(issued.RootElement.GetProperty("expiresAt").GetString(), issued.RootElement.GetProperty("familyExpiresAt").GetString());
        using var renewal = await host.Protected("/zilo/v1/auth/token/renew", token, HttpMethod.Post);
        Assert.Equal(HttpStatusCode.Conflict, renewal.StatusCode);
        clock.UtcNow = issued.RootElement.GetProperty("expiresAt").GetDateTimeOffset().AddTicks(-1);
        using var valid = await host.Protected("/zilo/v1/devices", token);
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        clock.UtcNow = clock.UtcNow.AddTicks(1);
        using var expired = await host.Protected("/zilo/v1/devices", token);
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"sdk\":false}")]
    [InlineData("{\"sdk\":{\"name\":42}}")]
    public async Task Token_request_matches_T10_optional_diagnostics_schema(string body)
    {
        await using var host = await Host.Start();
        using var response = await host.Send(body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Token_issue_rate_is_checked_before_content_type_or_body()
    {
        await using var host = await Host.Start(new AgentLimits { TokenIssuesPerOriginPerHour = 1 });
        using var first = await host.Send("{}");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        using var second = await host.Send("malformed", "text/plain");
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        Assert.NotNull(second.Headers.RetryAfter);
    }

    [Fact]
    public async Task Unknown_fields_are_ignored_and_CORS_never_allows_credentials()
    {
        await using var host = await Host.Start();
        using var response = await host.Send("{\"future\":[1,2,3],\"sdk\":{\"name\":\"sdk\",\"future\":true}}");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(Origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
        Assert.False(response.Headers.Contains("Access-Control-Allow-Private-Network"));
    }

    private sealed class Host(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public static async Task<Host> Start(AgentLimits? limits = null, IClock? clock = null)
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
            var app = AgentHost.Build(builder, new AgentOptions { BakedOrigins = [Origin], Limits = limits ?? new(), Clock = clock ?? new SystemClock() });
            await app.StartAsync(TestContext.Current.CancellationToken);
            return new(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) });
        }
        public async Task<HttpResponseMessage> Send(string body, string contentType = "application/json")
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/auth/token") { Content = new StringContent(body, Encoding.UTF8, contentType) };
            request.Headers.Add("Origin", Origin);
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }
        public async Task<HttpResponseMessage> Protected(string path, string token, HttpMethod? method = null)
        {
            using var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
            request.Headers.Add("Origin", Origin);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }
        public async ValueTask DisposeAsync()
        { client.Dispose(); await app.StopAsync(TestContext.Current.CancellationToken); await app.DisposeAsync(); }
    }

    private sealed class Clock : IClock
    { public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.Parse("2026-01-01T00:00:00Z"); }
}
