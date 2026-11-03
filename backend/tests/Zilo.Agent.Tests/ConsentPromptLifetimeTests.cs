using System.Reflection;
using Xunit;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class ConsentPromptLifetimeTests
{
    // Removing ResolvePrompt's independent Dispose must keep the real source alive until
    // the cancellation owner has observed all callbacks, not merely IsCancellationRequested.
    [Theory]
    [InlineData("remove", "none")]
    [InlineData("grant", "granted")]
    [InlineData("deny", "denied")]
    [InlineData("block", "blocked")]
    [InlineData("expire", "none")]
    public async Task Resolution_cannot_dispose_source_while_native_cancellation_is_running(string mutation, string state)
    {
        var clock = new Clock();
        using var prompt = new BlockedCallbackPrompt();
        var store = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 30), clock, prompt);
        const string origin = "https://old.example";
        await store.RequestAsync(origin, TestContext.Current.CancellationToken);
        var resolution = store.NativePromptResolution!;
        var source = Source(prompt.Token);
        var retirement = Retirement(store);
        try
        {
            switch (mutation)
            {
                case "remove": store.Remove(origin); break;
                case "grant": store.Grant(origin); break;
                case "deny": store.Deny(origin); break;
                case "block": store.Block(origin); break;
                case "expire":
                    clock.UtcNow = clock.UtcNow.AddSeconds(31);
                    _ = await store.GetAsync(origin, TestContext.Current.CancellationToken);
                    break;
            }
            await prompt.CallbackEntered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            await resolution.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            Assert.True(source.IsCancellationRequested);
            Assert.Null(Record.Exception(() => _ = source.Token));
            Assert.False(retirement.IsCompleted);
            Assert.Equal(state, (await store.GetAsync(origin, TestContext.Current.CancellationToken)).State);

            // The old lifetime must never cancel or retire a newer prompt's owner.
            await store.RequestAsync("https://next.example", TestContext.Current.CancellationToken);
            await store.NativePromptResolution!.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            Assert.True(store.IsGranted("https://next.example"));
            prompt.Complete(ConsentDecision.Granted);
        }
        finally
        {
            prompt.ReleaseCallback.Set();
            await prompt.NativeCancelled.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        }
        await retirement.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Throws<ObjectDisposedException>(() => _ = source.Token);
        Assert.Equal(1, prompt.NativeCancellationCalls);
        Assert.Equal(state, (await store.GetAsync(origin, TestContext.Current.CancellationToken)).State);
        Assert.True(store.IsGranted("https://next.example"));
    }

    [Fact]
    public async Task Deadline_uses_same_owner_and_keeps_source_alive_until_callbacks_finish()
    {
        var time = new ManualTime();
        using var prompt = new BlockedCallbackPrompt();
        var store = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 30), null, prompt, null, null,
            promptTimeProvider: time);
        await store.RequestAsync("https://old.example", TestContext.Current.CancellationToken);
        var resolution = store.NativePromptResolution!;
        var source = Source(prompt.Token);
        var retirement = Retirement(store);
        try
        {
            time.Advance(TimeSpan.FromSeconds(29));
            Assert.False(prompt.Token.IsCancellationRequested);
            Assert.False(resolution.IsCompleted);
            time.Advance(TimeSpan.FromSeconds(1));
            await prompt.CallbackEntered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            await resolution.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            Assert.False(retirement.IsCompleted);
            Assert.Null(Record.Exception(() => _ = source.Token));
            Assert.False(store.IsGranted("https://old.example"));
        }
        finally { prompt.ReleaseCallback.Set(); }
        await retirement.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await prompt.NativeCancelled.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Equal(1, prompt.NativeCancellationCalls);
        Assert.Throws<ObjectDisposedException>(() => _ = source.Token);
        Assert.Equal("none", (await store.GetAsync("https://old.example", TestContext.Current.CancellationToken)).State);
    }

    [Fact]
    public async Task Natural_native_completion_retires_source_and_cannot_be_cancelled_by_late_deadline()
    {
        var time = new ManualTime();
        using var prompt = new BlockedCallbackPrompt();
        var store = new ConsentStore(null, null, prompt, null, null, promptTimeProvider: time);
        await store.RequestAsync("https://old.example", TestContext.Current.CancellationToken);
        var source = Source(prompt.Token);
        var retirement = Retirement(store);
        prompt.Complete(ConsentDecision.Granted);
        await store.NativePromptResolution!.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await retirement.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Throws<ObjectDisposedException>(() => _ = source.Token);
        time.Advance(TimeSpan.FromSeconds(121));
        Assert.False(prompt.CallbackEntered.Task.IsCompleted);
        Assert.Equal(0, prompt.NativeCancellationCalls);
        Assert.True(store.IsGranted("https://old.example"));
    }

    [Fact]
    public async Task Prompt_without_native_resolver_retires_on_deadline()
    {
        var time = new ManualTime();
        var clock = new Clock();
        var store = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 30), clock, null, null, null,
            promptTimeProvider: time);
        await store.RequestAsync("https://old.example", TestContext.Current.CancellationToken);
        var retirement = Retirement(store);
        time.Advance(TimeSpan.FromSeconds(29));
        Assert.False(retirement.IsCompleted);
        clock.UtcNow = clock.UtcNow.AddSeconds(30);
        time.Advance(TimeSpan.FromSeconds(1));
        await retirement.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Equal("none", (await store.GetAsync("https://old.example", TestContext.Current.CancellationToken)).State);
    }

    [Fact]
    public async Task Cancellation_before_native_registration_keeps_source_until_resolver_finishes()
    {
        using var prompt = new RegistrationBarrierPrompt();
        var store = new ConsentStore(nativeConsent: prompt);
        var request = Task.Run(async () => await store.RequestAsync("https://old.example", TestContext.Current.CancellationToken),
            TestContext.Current.CancellationToken);
        try
        {
            await prompt.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            store.Remove("https://old.example");
            var retirement = Retirement(store);
            Assert.False(retirement.IsCompleted);
            Assert.Null(Record.Exception(() => _ = Source(prompt.Token).Token));
        }
        finally { prompt.Release.Set(); }
        await request.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await store.NativePromptResolution!.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await Retirement(store).WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        await prompt.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Equal("none", (await store.GetAsync("https://old.example", TestContext.Current.CancellationToken)).State);
        Assert.False(store.IsGranted("https://old.example"));
    }

    [Fact]
    public async Task Repeated_cancellation_and_throwing_callback_still_retire_exact_owner()
    {
        var owner = new ConsentStore.PromptCancellationOwner(true, TimeSpan.FromSeconds(30), new ManualTime());
        var source = Source(owner.Token);
        var calls = 0;
        owner.Token.Register(() => { Interlocked.Increment(ref calls); throw new InvalidOperationException("native callback fault"); });
        owner.RequestCancellation();
        owner.RequestCancellation();
        owner.FinishResolution();
        await owner.Retirement.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        owner.RequestCancellation();
        owner.FinishResolution();
        Assert.Equal(1, calls);
        Assert.Throws<ObjectDisposedException>(() => _ = source.Token);
    }

    private static Task Retirement(ConsentStore store) => store.NativePromptRetirement!;

    private static CancellationTokenSource Source(CancellationToken token) =>
        (CancellationTokenSource)typeof(CancellationToken).GetField("_source", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(token)!;

    private sealed class Clock : IClock
    {
        public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.UnixEpoch;
    }

    private sealed class RegistrationBarrierPrompt : INativeConsentPrompt, IDisposable
    {
        public CancellationToken Token { get; private set; }
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ManualResetEventSlim Release { get; } = new();
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            Token = cancellationToken;
            Entered.TrySetResult();
            if (!Release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("native registration release");
            cancellationToken.Register(() => Cancelled.TrySetResult());
            return ValueTask.FromResult(ConsentDecision.Granted);
        }
        public void Dispose() => Release.Dispose();
    }

    private sealed class BlockedCallbackPrompt : INativeConsentPrompt, IDisposable
    {
        private readonly TaskCompletionSource<ConsentDecision> _decision = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CancellationToken Token { get; private set; }
        public int NativeCancellationCalls;
        public TaskCompletionSource CallbackEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource NativeCancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ManualResetEventSlim ReleaseCallback { get; } = new();

        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            if (exactOrigin == "https://next.example") return ValueTask.FromResult(ConsentDecision.Granted);
            Token = cancellationToken;
            cancellationToken.Register(() =>
            {
                Interlocked.Increment(ref NativeCancellationCalls);
                NativeCancelled.TrySetResult();
            });
            cancellationToken.Register(() =>
            {
                CallbackEntered.TrySetResult();
                if (!ReleaseCallback.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("callback release");
            });
            return new(_decision.Task.WaitAsync(cancellationToken));
        }

        public void Complete(ConsentDecision decision) => _decision.TrySetResult(decision);
        public void Dispose() => ReleaseCallback.Dispose();
    }
}
