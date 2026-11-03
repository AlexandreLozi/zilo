using System.Threading.Channels;
using Xunit;
using Zilo.Security;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class NativeConsentPublicationTests
{
    private const string Origin = "https://example.test";
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(10);

    [Theory]
    [InlineData(ConsentDecision.Granted, "none", "granted")]
    [InlineData(ConsentDecision.Denied, "denied", "denied")]
    [InlineData(ConsentDecision.Blocked, "blocked", "blocked")]
    public async Task Current_native_result_uses_public_null_barrier_path_and_durable_ordering(
        ConsentDecision decision, string beforeAck, string afterAck)
    {
        var prompt = new Prompt();
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(nativeConsent: prompt, persistence: disk);
        disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.RequestAsync(Origin, TestContext.Current.CancellationToken);
        var resolution = store.NativePromptResolution!;
        (await prompt.NextAsync()).Decision.SetResult(decision);
        var write = await disk.NextAsync();
        try
        {
            Assert.Equal(beforeAck, (await store.GetAsync(Origin, TestContext.Current.CancellationToken)).State);
            Assert.False(store.IsGranted(Origin));
            Assert.False(resolution.IsCompleted);
            Assert.False(disk.UnderMonitor);
        }
        finally { write.Acknowledge(); }
        await resolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal(afterAck, (await store.GetAsync(Origin, TestContext.Current.CancellationToken)).State);
        Assert.Equal(afterAck, disk.Last!.Records.Single().State);
    }

    [Theory]
    [InlineData(ConsentDecision.Granted)]
    [InlineData(ConsentDecision.Denied)]
    [InlineData(ConsentDecision.Blocked)]
    [InlineData(ConsentDecision.Pending)]
    [InlineData((ConsentDecision)99)]
    public async Task Old_native_completion_cannot_overwrite_newer_block(ConsentDecision decision)
    {
        var prompt = new Prompt();
        var barrier = new Barrier();
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(null, null, prompt, disk, barrier.WaitAsync);
        barrier.Store = store; disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.RequestAsync(Origin, TestContext.Current.CancellationToken);
        var oldResolution = store.NativePromptResolution!;
        (await prompt.NextAsync()).Decision.SetResult(decision);
        await barrier.Entered.Task.WaitAsync(Limit, TestContext.Current.CancellationToken);
        try
        {
            await store.BlockAsync(Origin, TestContext.Current.CancellationToken);
            var writes = disk.Writes;
            barrier.Release.TrySetResult();
            await oldResolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
            Assert.Equal("blocked", (await store.GetAsync(Origin, TestContext.Current.CancellationToken)).State);
            Assert.Equal(writes, disk.Writes);
            Assert.Equal("blocked", disk.Last!.Records.Single().State);
            Assert.False(store.IsGranted(Origin));
            Assert.False(disk.UnderMonitor);
        }
        finally { barrier.Release.TrySetResult(); }
    }

    [Theory]
    [InlineData(ConsentDecision.Granted)]
    [InlineData(ConsentDecision.Denied)]
    [InlineData(ConsentDecision.Blocked)]
    [InlineData(ConsentDecision.Pending)]
    [InlineData((ConsentDecision)99)]
    public async Task Old_native_completion_cannot_change_replacement_prompt(ConsentDecision decision)
    {
        var prompt = new Prompt();
        var barrier = new Barrier();
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(null, null, prompt, disk, barrier.WaitAsync);
        barrier.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.RequestAsync(Origin, TestContext.Current.CancellationToken);
        var oldResolution = store.NativePromptResolution!;
        (await prompt.NextAsync()).Decision.SetResult(decision);
        await barrier.Entered.Task.WaitAsync(Limit, TestContext.Current.CancellationToken);
        await store.RemoveAsync(Origin, TestContext.Current.CancellationToken);
        Assert.Equal(202, (await store.RequestAsync(Origin, TestContext.Current.CancellationToken)).HttpStatus);
        var newer = await prompt.NextAsync();
        var newResolution = store.NativePromptResolution!;
        var writes = disk.Writes;
        try
        {
            barrier.Release.TrySetResult();
            await oldResolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
            Assert.Equal("pending", (await store.GetAsync(Origin, TestContext.Current.CancellationToken)).State);
            Assert.False(newer.Cancellation.IsCancellationRequested);
            Assert.Equal(writes, disk.Writes);
        }
        finally
        {
            barrier.Release.TrySetResult();
            newer.Decision.TrySetResult(ConsentDecision.Pending);
            await newResolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
        }
    }

    [Theory]
    [InlineData(ConsentDecision.Granted)]
    [InlineData(ConsentDecision.Denied)]
    [InlineData(ConsentDecision.Blocked)]
    public async Task Old_native_completion_after_stop_cannot_apply_or_reserve(ConsentDecision decision)
    {
        var prompt = new Prompt();
        var barrier = new Barrier();
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(null, null, prompt, disk, barrier.WaitAsync);
        barrier.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.RequestAsync(Origin, TestContext.Current.CancellationToken);
        var oldResolution = store.NativePromptResolution!;
        (await prompt.NextAsync()).Decision.SetResult(decision);
        await barrier.Entered.Task.WaitAsync(Limit, TestContext.Current.CancellationToken);
        var revocations = 0;
        store.OriginRemoved += _ => revocations++;
        await store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken);
        barrier.Release.TrySetResult();
        await oldResolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Stopped, store.PersistenceCoordinator.Health);
        Assert.Equal(0, revocations);
        Assert.Equal(0, disk.Writes);
        Assert.False(store.IsGranted(Origin));
    }

    [Theory]
    [InlineData(ConsentDecision.Granted)]
    [InlineData(ConsentDecision.Denied)]
    [InlineData(ConsentDecision.Blocked)]
    public async Task Native_deadline_is_rechecked_at_the_decision_transaction(ConsentDecision decision)
    {
        var prompt = new Prompt();
        var barrier = new Barrier();
        var clock = new Clock();
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(null, clock, prompt, disk, barrier.WaitAsync);
        barrier.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.RequestAsync(Origin, TestContext.Current.CancellationToken);
        var resolution = store.NativePromptResolution!;
        (await prompt.NextAsync()).Decision.SetResult(decision);
        await barrier.Entered.Task.WaitAsync(Limit, TestContext.Current.CancellationToken);
        clock.UtcNow = clock.UtcNow.AddMinutes(3);
        barrier.Release.TrySetResult();
        await resolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal("none", (await store.GetAsync(Origin, TestContext.Current.CancellationToken)).State);
        Assert.Equal(0, disk.Writes);
        Assert.False(store.IsGranted(Origin));
    }

    private sealed class Barrier
    {
        private int _calls;
        internal ConsentStore? Store;
        internal TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal Task WaitAsync()
        {
            Assert.False(Monitor.IsEntered(Store!.AuthorizationGate));
            if (Interlocked.Increment(ref _calls) != 1) return Task.CompletedTask;
            Entered.TrySetResult();
            return Release.Task.WaitAsync(Limit, TestContext.Current.CancellationToken);
        }
    }

    private sealed class Clock : IClock
    {
        public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.UtcNow;
    }

    private sealed record Pending(TaskCompletionSource<ConsentDecision> Decision, CancellationToken Cancellation);
    private sealed class Prompt : INativeConsentPrompt
    {
        private readonly Channel<Pending> _requests = Channel.CreateUnbounded<Pending>();
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            var decision = new TaskCompletionSource<ConsentDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
            _requests.Writer.TryWrite(new(decision, cancellationToken));
            return new(decision.Task);
        }
        internal async Task<Pending> NextAsync() => await _requests.Reader.ReadAsync(TestContext.Current.CancellationToken)
            .AsTask().WaitAsync(Limit, TestContext.Current.CancellationToken);
    }
}
