using Xunit;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class AtomicConsentTests
{
    private const string Origin = "https://example.test";

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
