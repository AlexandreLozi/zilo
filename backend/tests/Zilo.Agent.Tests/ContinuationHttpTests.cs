using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Xunit;
using Zilo.Agent;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class ContinuationHttpTests
{
    private const string Origin = "https://example.test";

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
        public static async Task<Host> Start(AgentLimits? limits = null)
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
            var app = AgentHost.Build(builder, new AgentOptions { BakedOrigins = [Origin], Limits = limits ?? new() });
            await app.StartAsync(TestContext.Current.CancellationToken);
            return new(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) });
        }
        public async Task<HttpResponseMessage> Send(string body, string contentType = "application/json")
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/auth/token") { Content = new StringContent(body, Encoding.UTF8, contentType) };
            request.Headers.Add("Origin", Origin);
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }
        public async ValueTask DisposeAsync()
        { client.Dispose(); await app.StopAsync(TestContext.Current.CancellationToken); await app.DisposeAsync(); }
    }
}
