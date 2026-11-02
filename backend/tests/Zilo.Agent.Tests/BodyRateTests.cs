using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Zilo.Agent;
using Zilo.Security;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class BodyRateTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Consent_rate_limit_precedes_invalid_content_type_and_unread_body(bool post)
    {
        await using var host = await HttpTestAgent.Start(new AgentOptions { Clock = new FrozenClock() });
        var method = post ? HttpMethod.Post : HttpMethod.Get;
        if (post)
        {
            // Hold another origin's machine-wide prompt admission slot.
            using var prompt = await host.Send(HttpMethod.Post, "/zilo/v1/auth/consent", origin: "https://other.test");
            Assert.Equal(HttpStatusCode.Accepted, prompt.StatusCode);
        }
        else
        {
            using var first = await host.Send(method, "/zilo/v1/auth/consent");
            using var second = await host.Send(method, "/zilo/v1/auth/consent");
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        }
        using var response = await host.Send(method, "/zilo/v1/auth/consent", new StringContent("not-json", Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(1), response.Headers.RetryAfter!.Delta);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("rate-limited", body.RootElement.GetProperty("code").GetString());
        Assert.Equal(HttpTestAgent.Origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
        Assert.False(response.Headers.Contains("WWW-Authenticate"));
    }

    [Fact]
    public async Task Body_without_content_type_is_not_accepted_as_JSON()
    {
        await using var host = await HttpTestAgent.Start();
        using var response = await host.Send(HttpMethod.Post, "/zilo/v1/auth/token", new ByteArrayContent("{}"u8.ToArray()));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("invalid-request", problem.RootElement.GetProperty("code").GetString());
        Assert.False(problem.RootElement.TryGetProperty("token", out _));
    }

    [Fact]
    public async Task Unknown_length_HTTP_body_is_rejected_at_contract_limit_with_safe_headers()
    {
        await using var host = await HttpTestAgent.Start();
        using var response = await host.Send(HttpMethod.Post, "/zilo/v1/auth/token", new ChunkedContent(65_538));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.True(response.Headers.Contains("Zilo-Request-Id"));
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("limits-exceeded", body.RootElement.GetProperty("code").GetString());
        Assert.Equal("maxRequestBodyBytes", body.RootElement.GetProperty("limit").GetProperty("name").GetString());
        Assert.False(body.RootElement.TryGetProperty("token", out _));
    }

    [Fact]
    public async Task Unknown_length_reader_stops_at_limit_plus_one_not_unbounded_drain()
    {
        var body = new CountingStream();
        var context = Context(body);
        var consent = new ConsentStore();
        var tokens = new TokenService();
        await using var discovery = new DiscoveryService([]);
        var pipeline = new AgentPipeline(_ => Task.CompletedTask, new(), new OriginPolicy(false, [HttpTestAgent.Origin]), consent, tokens, discovery);
        await pipeline.InvokeAsync(context);
        Assert.Equal(413, context.Response.StatusCode);
        Assert.Equal(65_537, body.BytesRead);
    }

    [Fact]
    public async Task Slow_read_obeys_request_cancellation_without_issuing_or_leaking_a_token()
    {
        var body = new SlowStream();
        var context = Context(body);
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        context.RequestAborted = cancellation.Token;
        var tokens = new TokenService();
        await using var discovery = new DiscoveryService([]);
        var pipeline = new AgentPipeline(_ => Task.CompletedTask, new(), new OriginPolicy(false, [HttpTestAgent.Origin]), new(), tokens, discovery);
        var pending = pipeline.InvokeAsync(context);
        await body.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        Assert.Equal(0, context.Response.Body.Length);
        Assert.Null(tokens.IssueRetryAfter(HttpTestAgent.Origin));
        Assert.False(context.Response.Headers.ContainsKey("Access-Control-Allow-Origin"));
    }

    private static DefaultHttpContext Context(Stream body)
    {
        var context = new DefaultHttpContext();
        context.Connection.LocalPort = 47841;
        context.Request.Host = new HostString("localhost", 47841);
        context.Request.Path = "/zilo/v1/auth/token";
        context.Request.Method = "POST";
        context.Request.Headers.Origin = HttpTestAgent.Origin;
        context.Request.ContentType = "application/json";
        context.Request.Body = body;
        context.Response.Body = new MemoryStream();
        return context;
    }

    private sealed class CountingStream : MemoryStream
    {
        public int BytesRead { get; private set; }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { buffer.Span.Fill((byte)' '); BytesRead += buffer.Length; return ValueTask.FromResult(buffer.Length); }
    }

    private sealed class FrozenClock : IClock
    { public DateTimeOffset UtcNow => DateTimeOffset.Parse("2026-01-01T00:00:00Z"); }

    private sealed class SlowStream : MemoryStream
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _never = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { Started.SetResult(); await _never.Task.WaitAsync(cancellationToken); return 0; }
    }

    private sealed class ChunkedContent : HttpContent
    {
        private readonly int _length;
        public ChunkedContent(int length) { _length = length; Headers.ContentType = new("application/json"); }
        protected override bool TryComputeLength(out long result) { result = 0; return false; }
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => stream.WriteAsync(new byte[_length]).AsTask();
    }
}
