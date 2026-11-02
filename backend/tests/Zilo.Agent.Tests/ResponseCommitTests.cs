using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Xunit;
using Zilo.Agent;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class ResponseCommitTests
{
    private const string Origin = "https://commit.test";

    [Theory]
    [InlineData("GET", "/zilo/v1/devices")]
    [InlineData("POST", "/zilo/v1/devices/refresh")]
    [InlineData("GET", "/zilo/v1/devices/missing/caps")]
    [InlineData("POST", "/zilo/v1/auth/token/renew")]
    public async Task Logical_commit_holds_mutation_monitor_but_network_write_does_not(string method, string path)
    {
        var consent = new ConsentStore();
        consent.Grant(Origin);
        var tokens = new TokenService(consent: consent);
        consent.OriginRemoved += origin => tokens.RevokeOrigin(origin);
        var token = tokens.Issue(Origin).Token!.Token;
        var gate = typeof(ConsentStore).GetProperty("AuthorizationGate", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(consent)!;
        var feature = new CommitFeature(gate);
        var context = new DefaultHttpContext();
        context.Features.Set<IHttpResponseFeature>(feature);
        var body = new GatedWriteStream();
        context.Response.Body = body;
        context.Connection.LocalPort = 47841;
        context.Request.Host = new HostString("localhost", 47841);
        context.Request.Method = method;
        context.Request.Path = path;
        context.Request.Headers.Origin = Origin;
        context.Request.Headers.Authorization = "Bearer " + token;
        context.Request.ContentLength = 0;
        await using var discovery = new DiscoveryService([]);
        var pipeline = new AgentPipeline(_ => Task.CompletedTask, new(), new OriginPolicy(false, []), consent, tokens, discovery);
        var pending = pipeline.InvokeAsync(context);
        await body.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        Assert.True(feature.CommitUnderMonitor);
        // A committed response can finish later. Revocation must not wait for IO.
        await Task.Run(() => consent.Remove(Origin), TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken);
        body.Release.SetResult();
        await pending;
        Assert.Equal(Origin, context.Response.Headers.AccessControlAllowOrigin.ToString());
        Assert.DoesNotContain("unauthorized-origin", Encoding.UTF8.GetString(body.ToArray()), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("GET", "/zilo/v1/devices", false)]
    [InlineData("POST", "/zilo/v1/devices/refresh", false)]
    [InlineData("GET", "/zilo/v1/devices/missing/caps", false)]
    [InlineData("GET", "/zilo/v1/devices", true)]
    [InlineData("POST", "/zilo/v1/devices/refresh", true)]
    [InlineData("GET", "/zilo/v1/devices/missing/caps", true)]
    public async Task Removal_or_family_revocation_before_commit_selects_contract_denial(string method, string path, bool familyOnly)
    {
        var consent = new ConsentStore(); consent.Grant(Origin);
        var tokens = new TokenService(consent: consent);
        consent.OriginRemoved += origin => tokens.RevokeOrigin(origin);
        var token = tokens.Issue(Origin).Token!.Token;
        var input = new GatedReadStream();
        var context = new DefaultHttpContext();
        context.Connection.LocalPort = 47841;
        context.Request.Host = new HostString("localhost", 47841);
        context.Request.Method = method; context.Request.Path = path;
        context.Request.Headers.Origin = Origin;
        context.Request.Headers.Authorization = "Bearer " + token;
        context.Request.Body = input;
        context.Response.Body = new MemoryStream();
        await using var discovery = new DiscoveryService([]);
        var pipeline = new AgentPipeline(_ => Task.CompletedTask, new(), new OriginPolicy(false, []), consent, tokens, discovery);
        var pending = pipeline.InvokeAsync(context);
        await input.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        if (familyOnly) tokens.Revoke(token, Origin); else consent.Remove(Origin);
        input.Release.SetResult();
        await pending;
        Assert.Equal(familyOnly ? 401 : 403, context.Response.StatusCode);
        Assert.Equal(familyOnly, context.Response.Headers.ContainsKey("Access-Control-Allow-Origin"));
        Assert.Equal(familyOnly, context.Response.Headers.ContainsKey("WWW-Authenticate"));
        var text = Encoding.UTF8.GetString(((MemoryStream)context.Response.Body).ToArray());
        Assert.Contains(familyOnly ? "token-revoked" : "unauthorized-origin", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\"devices\"", text, StringComparison.Ordinal);
    }

    private sealed class CommitFeature(object gate) : IHttpResponseFeature
    {
        private int _status = 200;
        public string? ReasonPhrase { get; set; }
        public IHeaderDictionary Headers { get; set; } = new HeaderDictionary();
        public Stream Body { get; set; } = Stream.Null;
        public bool HasStarted => false;
        public void OnStarting(Func<object, Task> callback, object state) { }
        public void OnCompleted(Func<object, Task> callback, object state) { }
        public bool CommitUnderMonitor { get; private set; }
        public int StatusCode
        {
            get => _status;
            set { CommitUnderMonitor = Monitor.IsEntered(gate); _status = value; }
        }
    }

    private sealed class GatedWriteStream : MemoryStream
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        { Started.SetResult(); await Release.Task.WaitAsync(cancellationToken); await base.WriteAsync(buffer, cancellationToken); }
    }

    private sealed class GatedReadStream : MemoryStream
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        { Started.SetResult(); await Release.Task.WaitAsync(cancellationToken); return 0; }
    }
}
