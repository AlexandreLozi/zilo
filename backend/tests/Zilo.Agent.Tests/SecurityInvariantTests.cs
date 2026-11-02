using System.Reflection;
using Xunit;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class SecurityInvariantTests
{
    [Fact]
    public async Task Unknown_reads_do_not_evict_pending_denied_or_blocked_state()
    {
        var clock = new FakeClock(DateTimeOffset.UnixEpoch);
        var prompt = new GatePrompt();
        var store = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 30), clock, prompt);
        await store.RequestAsync("https://pending.example", TestContext.Current.CancellationToken);
        store.Deny("https://denied.example");
        store.Block("https://blocked.example");
        for (var i = 0; i < 400; i++)
            _ = await store.GetAsync($"https://unknown-{i}.example", TestContext.Current.CancellationToken);

        Assert.Equal("pending", (await store.GetAsync("https://pending.example", TestContext.Current.CancellationToken)).State);
        Assert.Equal("denied", (await store.GetAsync("https://denied.example", TestContext.Current.CancellationToken)).State);
        Assert.Equal("blocked", (await store.GetAsync("https://blocked.example", TestContext.Current.CancellationToken)).State);
    }

    [Fact]
    public async Task Refused_rotating_posts_and_three_polls_do_not_allocate_authorization_state()
    {
        var clock = new FakeClock(DateTimeOffset.UnixEpoch);
        var prompt = new GatePrompt();
        var store = new ConsentStore(new ConsentOptions(), clock, prompt);
        await store.RequestAsync("https://owner.example", TestContext.Current.CancellationToken);
        for (var i = 0; i < 1000; i++)
        {
            var origin = $"https://rotating-{i}.example";
            var refused = await store.RequestAsync(origin, TestContext.Current.CancellationToken);
            Assert.Equal("rate-limited", refused.ProblemCode);
            _ = await store.GetResultAsync(origin, TestContext.Current.CancellationToken);
            _ = await store.GetResultAsync(origin, TestContext.Current.CancellationToken);
            _ = await store.GetResultAsync(origin, TestContext.Current.CancellationToken);
        }
        Assert.Equal("pending", (await store.GetAsync("https://owner.example", TestContext.Current.CancellationToken)).State);
    }

    [Fact]
    public async Task Removing_a_prompt_cancels_native_wait_and_stale_completion_cannot_grant()
    {
        var clock = new FakeClock(DateTimeOffset.UnixEpoch);
        var prompt = new GatePrompt();
        var store = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 5), clock, prompt);
        await store.RequestAsync("https://stale.example", TestContext.Current.CancellationToken);
        await prompt.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        store.Remove("https://stale.example");
        prompt.Complete(ConsentDecision.Granted);
        await prompt.Finished.Task.WaitAsync(TestContext.Current.CancellationToken);

        Assert.Equal("none", (await store.GetAsync("https://stale.example", TestContext.Current.CancellationToken)).State);
        Assert.True(prompt.CancellationRequested);
    }

    [Fact]
    public async Task Prompt_timeout_cancels_native_callback_and_releases_global_slot()
    {
        var clock = new FakeClock(DateTimeOffset.UnixEpoch);
        var prompt = new GatePrompt();
        var store = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 5), clock, prompt);
        await store.RequestAsync("https://timeout.example", TestContext.Current.CancellationToken);
        await prompt.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        clock.UtcNow = clock.UtcNow.AddSeconds(6);
        Assert.Equal("none", (await store.GetAsync("https://timeout.example", TestContext.Current.CancellationToken)).State);
        await prompt.Finished.Task.WaitAsync(TestContext.Current.CancellationToken);
        var next = await store.RequestAsync("https://next.example", TestContext.Current.CancellationToken);
        Assert.Equal("pending", next.Status.State);
        Assert.True(prompt.CancellationRequested);
    }

    [Fact]
    public async Task Synchronous_grant_cannot_be_overwritten_by_cancelled_prompt()
    {
        var prompt = new GatePrompt();
        var store = new ConsentStore(nativeConsent: prompt);
        await store.RequestAsync("https://grant.example", TestContext.Current.CancellationToken);
        await prompt.Started.Task.WaitAsync(TestContext.Current.CancellationToken);
        store.Grant("https://grant.example");
        prompt.Complete(ConsentDecision.Denied);
        await prompt.Finished.Task.WaitAsync(TestContext.Current.CancellationToken);
        Assert.Equal("granted", (await store.GetAsync("https://grant.example", TestContext.Current.CancellationToken)).State);
    }

    [Fact]
    public void Revoked_history_is_bounded_and_cross_origin_revocation_is_not_revealed()
    {
        var clock = new FakeClock(DateTimeOffset.UnixEpoch);
        var service = new TokenService(new TokenLimits(TokenTtlSeconds: 300, FamilyMaxSeconds: 3600, MaxRetainedAuthRecords: 1024), clock);
        var issued = new List<IssuedToken>();
        for (var i = 0; i < 1030; i++)
        {
            var token = service.Issue($"https://{i}.example").Token!;
            issued.Add(token);
            Assert.True(service.Revoke(token.Token, token.Origin));
        }

        Assert.Equal("token-invalid", service.Validate(issued[0].Token, issued[0].Origin).Code);
        Assert.Equal("token-revoked", service.Validate(issued[^1].Token, issued[^1].Origin).Code);
        Assert.Equal("token-invalid", service.Validate(issued[^1].Token, "https://other.example").Code);
    }

    [Fact]
    public void Token_deadline_and_fractional_renewal_are_exactly_bounded()
    {
        var now = DateTimeOffset.UnixEpoch.AddTicks(7);
        var clock = new FakeClock(now);
        var service = new TokenService(new TokenLimits(TokenTtlSeconds: 3600, FamilyMaxSeconds: 3601), clock);
        var issued = service.Issue("https://fractional.example").Token!;
        Assert.Equal(now.AddSeconds(3601), issued.FamilyExpiresAt);
        Assert.Equal(now.AddSeconds(3600), issued.ExpiresAt);
        Assert.Equal(now.AddTicks((issued.ExpiresAt - now).Ticks * 3 / 4), issued.RenewAfter);
    }

    private sealed class FakeClock(DateTimeOffset initial) : IClock
    {
        public DateTimeOffset UtcNow { get; set; } = initial;
    }

    private sealed class GatePrompt : INativeConsentPrompt
    {
        private TaskCompletionSource<ConsentDecision> _completion = NewCompletion();
        public TaskCompletionSource<bool> Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool> Finished { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool CancellationRequested { get; private set; }
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult(true);
            cancellationToken.Register(() => CancellationRequested = true);
            return new(WaitAsync(cancellationToken));
        }
        private async Task<ConsentDecision> WaitAsync(CancellationToken token) { try { return await _completion.Task.WaitAsync(token); } finally { Finished.TrySetResult(true); } }
        public void Complete(ConsentDecision decision) => _completion.TrySetResult(decision);
        private static TaskCompletionSource<ConsentDecision> NewCompletion() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
