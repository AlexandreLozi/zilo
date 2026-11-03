using System.Reflection;
using Xunit;
using Zilo.Security;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class ConsentMetadataRetentionTests
{
    private const string Origin = "https://example.test";
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(10);

    [Fact]
    public async Task Unknown_remove_churn_releases_empty_entries_and_sequence_tombstones()
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        for (var index = 0; index < 8330; index++)
            await store.RemoveAsync($"https://removed-{index}.test", TestContext.Current.CancellationToken);
        var entries = Count(store, "_entries");
        var sequences = Count(coordinator, "_sequences");
        Assert.True(entries == 0 && sequences == 0, $"Retained empty entries={entries}, sequences={sequences}");
        Assert.Equal(0, Count(coordinator, "_desired"));
        Assert.Equal(0, Count(coordinator, "_pending"));
        Assert.Equal(0, coordinator.OutstandingReservations);
        Assert.Empty(disk.Last!.Records);
    }

    [Fact]
    public async Task Full_record_rejection_and_unknown_reads_do_not_allocate_authority_entries()
    {
        var disk = new ControlledConsentPersistence { Initial = FullSnapshot(DateTimeOffset.UtcNow) };
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        for (var index = 0; index < 512; index++)
        {
            var origin = $"https://rejected-{index}.test";
            Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync(origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            await store.GetAsync(origin, TestContext.Current.CancellationToken);
            await store.GetResultAsync(origin, TestContext.Current.CancellationToken);
            store.PollRetryAfter(origin);
            Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync($"http://invalid-{index}.test", cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            Assert.Equal(403, (await store.RequestAsync($"http://invalid-{index}.test", TestContext.Current.CancellationToken)).HttpStatus);
        }
        Assert.Equal(4096, Count(store, "_entries"));
        Assert.Equal(4096, Count(coordinator, "_desired"));
        Assert.Equal(0, Count(coordinator, "_sequences"));
        Assert.InRange(Count(store, "_polls"), 0, 256);
        Assert.Equal("blocked", (await store.GetAsync("https://saved-0.test", TestContext.Current.CancellationToken)).State);
        Assert.Equal("denied", (await store.GetAsync("https://denied.test", TestContext.Current.CancellationToken)).State);
        Assert.Equal(0, disk.Writes);
    }

    [Fact]
    public async Task Queue_rejected_grants_do_not_leave_empty_entries_and_restriction_stays_fail_closed()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        var accepted = new List<Task<ConsentMutationResult>>
        {
            store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken).AsTask()
        };
        var old = await disk.NextAsync();
        int retained;
        try
        {
            for (var index = 1; index < 64; index++)
                accepted.Add(store.GrantAsync($"https://queued-{index}.test", cancellationToken: TestContext.Current.CancellationToken).AsTask());
            for (var index = 0; index < 2048; index++)
                Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync($"https://overflow-{index}.test", cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            retained = Count(store, "_entries");
            Assert.Equal(64, coordinator.OutstandingReservations);
            Assert.Equal(64, Count(coordinator, "_owned"));
            Assert.Equal(63, Count(coordinator, "_pending"));
            Assert.Equal(ConsentMutationOutcome.FenceCovered, (await store.BlockAsync(Origin, TestContext.Current.CancellationToken)).Outcome);
            Assert.Equal(ConsentStorageHealth.Unavailable, coordinator.Health);
            Assert.False(store.IsGranted(Origin));
        }
        finally { disk.Pause = false; old.Acknowledge(); }
        await Task.WhenAll(accepted).WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal(64, retained);
        Assert.Equal(0, coordinator.OutstandingReservations);
        Assert.Equal(0, Count(coordinator, "_owned"));
        Assert.InRange(Count(coordinator, "_sequences"), 0, 64);
    }

    [Fact]
    public async Task Volatile_prompt_history_has_finite_headroom_without_evicting_saved_policy()
    {
        var clock = new Clock();
        var disk = new ControlledConsentPersistence { Initial = FullSnapshot(clock.UtcNow) };
        await using var store = new ConsentStore(new ConsentOptions(GlobalPromptsPerHour: 1000), clock, new ClosedPrompt(), disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        for (var index = 0; index < 64; index++)
        {
            Assert.Equal(202, (await store.RequestAsync($"https://prompt-{index}.test", TestContext.Current.CancellationToken)).HttpStatus);
            await store.NativePromptResolution!.WaitAsync(Limit, TestContext.Current.CancellationToken);
            if (index == 62) Assert.Equal(4159, Count(store, "_entries"));
            if (index == 63) Assert.Equal(4160, Count(store, "_entries"));
        }
        Assert.Equal(429, (await store.RequestAsync("https://over-capacity.test", TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Equal(4160, Count(store, "_entries"));
        for (var index = 0; index < 2; index++)
        {
            clock.UtcNow = clock.UtcNow.AddMinutes(3); // Beyond the existing pending/coalescing window, still within one hour.
            Assert.Equal(202, (await store.RequestAsync("https://prompt-0.test", TestContext.Current.CancellationToken)).HttpStatus);
        }
        clock.UtcNow = clock.UtcNow.AddMinutes(3);
        Assert.Equal(429, (await store.RequestAsync("https://prompt-0.test", TestContext.Current.CancellationToken)).HttpStatus);
        clock.UtcNow = clock.UtcNow.AddHours(2);
        Assert.Equal(202, (await store.RequestAsync("https://fresh-prompt.test", TestContext.Current.CancellationToken)).HttpStatus);
        Assert.InRange(Count(store, "_entries"), 4096, 4097);
        Assert.Equal("blocked", (await store.GetAsync("https://saved-0.test", TestContext.Current.CancellationToken)).State);
        Assert.Equal("denied", (await store.GetAsync("https://denied.test", TestContext.Current.CancellationToken)).State);
        Assert.Equal(4096, Count(store.PersistenceCoordinator, "_desired"));
    }

    [Fact]
    public async Task Inflight_origin_survives_churn_then_prunes_without_sequence_ABA_or_stale_cancel()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        ConsentReservation oldGrant;
        lock (store.AuthorizationGate)
            oldGrant = coordinator.ReserveLocked(Origin, ConsentDecision.Granted, false, DateTimeOffset.UtcNow);
        var old = await disk.NextAsync();
        var block = store.BlockAsync(Origin, TestContext.Current.CancellationToken).AsTask();
        var removals = new List<Task<ConsentMutationResult>>();
        try
        {
            for (var index = 0; index < 62; index++)
                removals.Add(store.RemoveAsync($"https://empty-{index}.test", TestContext.Current.CancellationToken).AsTask());
            for (var index = 0; index < 1024; index++)
                Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync($"https://rejected-{index}.test", cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => coordinator.ObserveAsync(oldGrant, cancelled.Token).AsTask());
            Assert.True(coordinator.CurrentOriginSequenceLocked(Origin) > oldGrant.OriginSequence);
        }
        finally { disk.Pause = false; old.Acknowledge(); }
        await Task.WhenAll(removals.Append(block)).WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal("blocked", disk.Last!.Records.Single().State);
        await store.RemoveAsync(Origin, TestContext.Current.CancellationToken);
        Assert.Equal(0, Count(store, "_entries"));
        Assert.Equal(0, Count(coordinator, "_sequences"));
        ConsentReservation newer;
        lock (store.AuthorizationGate)
            newer = coordinator.ReserveLocked(Origin, ConsentDecision.Granted, false, DateTimeOffset.UtcNow);
        Assert.True(newer.OriginSequence > oldGrant.OriginSequence);
        await coordinator.ObserveAsync(newer, TestContext.Current.CancellationToken);
        await store.BlockAsync(Origin, TestContext.Current.CancellationToken);
        using var late = new CancellationTokenSource();
        late.Cancel();
        Assert.Equal(ConsentMutationOutcome.Superseded, (await coordinator.ObserveAsync(oldGrant, late.Token)).Outcome);
        Assert.Equal("blocked", (await store.GetAsync(Origin, TestContext.Current.CancellationToken)).State);
        Assert.Equal("blocked", disk.Last!.Records.Single().State);
        Assert.Equal(0, coordinator.OutstandingReservations);
        Assert.Equal(0, Count(coordinator, "_pending"));
        Assert.InRange(Count(coordinator, "_sequences"), 1, 8320);
    }

    [Theory]
    [InlineData(8319, true)]
    [InlineData(8320, false)]
    [InlineData(8321, false)]
    public void Conservative_sequence_cap_guard_rejects_only_new_origins(int count, bool expected)
    {
        // Pure production admission-guard boundary evidence, not a fabricated reachable Store state.
        Assert.Equal(expected, ConsentPersistenceCoordinator.HasSequenceCapacity(count, alreadyTracked: false));
        Assert.True(ConsentPersistenceCoordinator.HasSequenceCapacity(count, alreadyTracked: true));
    }

    [Fact]
    public async Task Store_cap_rejects_only_new_grant_preserves_pending_then_restrictive_overflow_fences()
    {
        var now = DateTimeOffset.UtcNow;
        var disk = new ControlledConsentPersistence
        {
            Initial = new(1, new[]
            {
                new StoredConsent("https://granted.test", "granted", false, now, null, null),
                new StoredConsent("https://blocked.test", "blocked", false, now, null, null),
                new StoredConsent("https://denied.test", "denied", false, now, now.AddHours(12), now)
            })
        };
        var prompt = new LastPendingPrompt();
        await using var store = new ConsentStore(new ConsentOptions(GlobalPromptsPerHour: 5000), nativeConsent: prompt, persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        for (var index = 0; index < 4156; index++)
            Assert.Equal(202, (await store.RequestAsync($"https://history-{index}.test", TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Equal(4159, Count(store, "_entries"));
        Assert.Equal(202, (await store.RequestAsync("https://pending.test", TestContext.Current.CancellationToken)).HttpStatus);
        var pendingResolution = store.NativePromptResolution!;
        try
        {
            Assert.Equal(4160, Count(store, "_entries"));
            Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync("https://over-cap.test", cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            Assert.Equal(4160, Count(store, "_entries"));
            Assert.Equal(ConsentStorageHealth.Ready, coordinator.Health);
            Assert.True(store.IsGranted("https://granted.test"));
            Assert.Equal("pending", (await store.GetAsync("https://pending.test", TestContext.Current.CancellationToken)).State);
            Assert.False(prompt.Cancellation.IsCancellationRequested);
            Assert.Equal("blocked", (await store.GetAsync("https://blocked.test", TestContext.Current.CancellationToken)).State);
            Assert.Equal("denied", (await store.GetAsync("https://denied.test", TestContext.Current.CancellationToken)).State);
            Assert.Equal(ConsentMutationOutcome.FenceCovered, (await store.BlockAsync("https://overflow-block.test", TestContext.Current.CancellationToken)).Outcome);
            Assert.Equal(ConsentStorageHealth.Unavailable, coordinator.Health);
            Assert.False(store.IsGranted("https://granted.test"));
            Assert.Equal(4160, Count(store, "_entries"));
            Assert.Equal(3, Count(coordinator, "_desired"));
            Assert.Equal(0, Count(coordinator, "_sequences"));
        }
        finally
        {
            prompt.Decision.TrySetResult(ConsentDecision.Pending);
            await pendingResolution.WaitAsync(Limit, TestContext.Current.CancellationToken);
        }
    }

    [Fact]
    public async Task Grant_cancellation_and_removal_churn_releases_all_owned_metadata()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        for (var index = 0; index < 24; index++)
        {
            var origin = $"https://cancelled-{index}.test";
            using var observer = new CancellationTokenSource();
            var grant = store.GrantAsync(origin, cancellationToken: observer.Token).AsTask();
            var old = await disk.NextAsync();
            observer.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => grant);
            old.Acknowledge();
            var compensation = await disk.NextAsync();
            Assert.Empty(compensation.Snapshot.Records);
            disk.Pause = false;
            compensation.Acknowledge();
            await store.RemoveAsync(origin, TestContext.Current.CancellationToken);
            Assert.Equal(0, Count(store, "_entries"));
            Assert.Equal(0, Count(coordinator, "_sequences"));
            Assert.Equal(0, Count(coordinator, "_desired"));
            Assert.Equal(0, Count(coordinator, "_pending"));
            Assert.Equal(0, Count(coordinator, "_owned"));
            Assert.False(store.IsGranted(origin));
            disk.Pause = true;
        }
    }

    [Fact]
    public async Task Generation_exhaustion_rejects_before_allocation_and_is_fail_closed()
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        typeof(ConsentPersistenceCoordinator).GetField("_nextGeneration", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(coordinator, long.MaxValue);
        Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        Assert.Equal(ConsentStorageHealth.Unavailable, coordinator.Health);
        Assert.Equal(0, Count(store, "_entries"));
        Assert.Equal(0, Count(coordinator, "_sequences"));
        Assert.Equal(0, coordinator.OutstandingReservations);
        Assert.Equal(0, disk.Writes);
        Assert.False(store.IsGranted(Origin));
    }

    [Fact]
    public async Task Oversized_open_snapshot_is_rejected_before_hydration_or_desired_allocation()
    {
        var now = DateTimeOffset.UtcNow;
        var disk = new ControlledConsentPersistence
        {
            Initial = new(1, Enumerable.Range(0, 4097)
                .Select(index => new StoredConsent($"https://oversized-{index}.test", "blocked", false, now, null, null)).ToArray())
        };
        await using var store = new ConsentStore(persistence: disk);
        var coordinator = store.PersistenceCoordinator!;
        await coordinator.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Unavailable, coordinator.Health);
        Assert.Equal(0, Count(store, "_entries"));
        Assert.Equal(0, Count(coordinator, "_desired"));
        Assert.Equal(0, Count(coordinator, "_sequences"));
        Assert.Equal(0, coordinator.OutstandingReservations);
    }

    private static ConsentSnapshot FullSnapshot(DateTimeOffset now) => new(1,
        Enumerable.Range(0, 4095).Select(index => new StoredConsent($"https://saved-{index}.test", "blocked", false, now, null, null))
            .Append(new StoredConsent("https://denied.test", "denied", false, now, now.AddHours(12), now)).ToArray());

    private static int Count(object owner, string field)
    {
        var value = owner.GetType().GetField(field, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(owner)!;
        return (int)value.GetType().GetProperty("Count")!.GetValue(value)!;
    }

    private sealed class Clock : IClock { public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.UtcNow; }
    private sealed class ClosedPrompt : INativeConsentPrompt
    {
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default) => new(ConsentDecision.Pending);
    }
    private sealed class LastPendingPrompt : INativeConsentPrompt
    {
        internal TaskCompletionSource<ConsentDecision> Decision { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal CancellationToken Cancellation;
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default)
        {
            if (exactOrigin != "https://pending.test") return new(ConsentDecision.Pending);
            Cancellation = cancellationToken;
            return new(Decision.Task);
        }
    }
}
