using Xunit;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class AtomicConsentTests
{
    private const string Origin = "https://example.test";

    [Fact]
    public async Task Expired_prompt_history_does_not_retain_rotating_removed_origins_forever()
    {
        var clock = new Clock();
        var consent = new ConsentStore(clock: clock);
        for (var index = 0; index < 50; index++)
        {
            clock.UtcNow = clock.UtcNow.AddHours(25);
            var origin = $"https://site-{index}.test";
            Assert.Equal(202, (await consent.RequestAsync(origin, TestContext.Current.CancellationToken)).HttpStatus);
            consent.Remove(origin);
        }
        var entries = (System.Collections.IDictionary)typeof(ConsentStore).GetField("_entries", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(consent)!;
        Assert.InRange(entries.Count, 0, 1);
    }

    [Fact]
    public async Task Unknown_consent_polling_is_rate_limited_without_creating_authorization_state()
    {
        var consent = new ConsentStore();
        Assert.Equal(200, (await consent.GetResultAsync(Origin, TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Equal(200, (await consent.GetResultAsync(Origin, TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Equal(429, (await consent.GetResultAsync(Origin, TestContext.Current.CancellationToken)).HttpStatus);
        Assert.False(consent.IsGranted(Origin));
    }

    [Fact]
    public async Task Native_cancellation_callbacks_do_not_run_under_authorization_monitor()
    {
        ConsentStore? consent = null;
        var callbackFinished = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var prompt = new CallbackPrompt(() =>
        {
            var read = Task.Run(() => consent!.IsGranted(Origin), TestContext.Current.CancellationToken);
            callbackFinished.TrySetResult(read.Wait(TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken));
        });
        consent = new ConsentStore(nativeConsent: prompt);
        await consent.RequestAsync(Origin, TestContext.Current.CancellationToken);
        consent.Remove(Origin);
        Assert.True(await callbackFinished.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Removal_or_block_cannot_leave_an_issued_or_renewed_credential(bool block)
    {
        var persistence = new GatedPersistence();
        var consent = new ConsentStore(persistence: persistence);
        var clock = new Clock();
        var tokens = new TokenService(clock: clock, consent: consent);
        consent.OriginRemoved += origin => tokens.RevokeOrigin(origin);
        consent.Grant(Origin);
        var first = tokens.Issue(Origin).Token!;
        clock.UtcNow = first.RenewAfter;
        persistence.Gate = true;
        var removal = Task.Run(() => { if (block) consent.Block(Origin); else consent.Remove(Origin); }, TestContext.Current.CancellationToken);
        await persistence.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        var issue = Task.Run(() => tokens.Issue(Origin), TestContext.Current.CancellationToken);
        var renew = Task.Run(() => tokens.Renew(first.Token, Origin), TestContext.Current.CancellationToken);
        persistence.Release.Set();
        await removal;
        var issued = await issue;
        var renewed = await renew;
        Assert.Null(issued.Token);
        Assert.Null(renewed.Token);
        consent.Grant(Origin);
        Assert.Equal("token-revoked", tokens.Validate(first.Token, Origin).Code);
        Assert.NotNull(tokens.Issue(Origin).Token);
    }

    private sealed class Clock : IClock
    {
        public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
    }

    private sealed class CallbackPrompt(Action callback) : INativeConsentPrompt
    {
        public ValueTask<ConsentDecision> RequestAsync(string origin, CancellationToken cancellationToken = default)
        {
            cancellationToken.Register(callback);
            return new(new TaskCompletionSource<ConsentDecision>(TaskCreationOptions.RunContinuationsAsynchronously).Task);
        }
    }

    private sealed class GatedPersistence : IConsentPersistence
    {
        public bool Gate { get; set; }
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ManualResetEventSlim Release { get; } = new();
        public ConsentPersistenceRecord? Load(string origin) => null;
        public void Save(string origin, ConsentPersistenceRecord record)
        {
            if (!Gate) return;
            Entered.TrySetResult();
            if (!Release.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException();
        }
    }
}
