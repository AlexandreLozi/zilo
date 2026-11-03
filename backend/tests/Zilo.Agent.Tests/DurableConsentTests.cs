using System.Threading.Channels;
using Xunit;
using Zilo.Security;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

// Controlled acknowledgements are coordination evidence, not native durability/crash proof.
public sealed class DurableConsentTests
{
    private const string Origin = "https://example.test";
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(10);

    [Fact]
    public async Task Starting_denies_without_lazy_disk_reads_and_requires_durable_fence()
    {
        var disk = new ControlledConsentPersistence { OpenFence = false };
        await using var store = new ConsentStore(persistence: disk);
        disk.Store = store;
        Assert.False(store.IsGranted(Origin));
        Assert.NotEqual(202, (await store.RequestAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Equal(0, disk.Opens);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.False(store.IsGranted(Origin));
        Assert.NotEqual(202, (await store.RequestAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
        Assert.NotEqual(ConsentStorageHealth.Ready, store.PersistenceCoordinator.Health);
        Assert.False(disk.UnderMonitor);
    }

    [Fact]
    public async Task Grant_has_no_authority_before_ack_and_disk_never_owns_authorization_monitor()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        var grant = store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken).AsTask();
        var write = await disk.NextAsync();
        try
        {
            Assert.False(store.IsGranted(Origin));
            Assert.False(grant.IsCompleted);
            Assert.False(disk.UnderMonitor);
            Assert.False(disk.AuthorityAtFirstWrite);
            await Task.Run(() => { lock (store.AuthorizationGate) Assert.False(store.IsGranted(Origin)); }, TestContext.Current.CancellationToken).WaitAsync(Limit, TestContext.Current.CancellationToken);
        }
        finally { write.Acknowledge(); }
        Assert.Equal(ConsentMutationOutcome.Durable, (await grant.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
        Assert.True(store.IsGranted(Origin));
    }

    [Theory]
    [InlineData("block")]
    [InlineData("remove")]
    [InlineData("deny")]
    public async Task Restriction_revokes_bound_tokens_before_its_ack(string action)
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentMutationOutcome.Durable, (await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        var tokens = new TokenService(consent: store);
        store.OriginRemoved += origin => tokens.RevokeOrigin(origin);
        var first = tokens.Issue(Origin).Token!;
        disk.Pause = true;
        var restricted = (action == "block" ? store.BlockAsync(Origin, cancellationToken: TestContext.Current.CancellationToken) : action == "remove" ? store.RemoveAsync(Origin, cancellationToken: TestContext.Current.CancellationToken) : store.DenyAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).AsTask();
        var write = await disk.NextAsync();
        try
        {
            Assert.False(store.IsGranted(Origin));
            Assert.Null(tokens.Issue(Origin).Token);
            Assert.Equal("token-revoked", tokens.Validate(first.Token, Origin).Code);
            Assert.False(restricted.IsCompleted);
            Assert.False(disk.UnderMonitor);
        }
        finally { write.Acknowledge(); }
        Assert.Equal(ConsentMutationOutcome.Durable, (await restricted.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
        disk.Pause = false;
        await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal("token-revoked", tokens.Validate(first.Token, Origin).Code);
        Assert.NotNull(tokens.Issue(Origin).Token);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Old_generation_grant_ack_cannot_regrant_after_newer_restriction(bool remove)
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        var grant = store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken).AsTask();
        var old = await disk.NextAsync();
        var revoke = (remove ? store.RemoveAsync(Origin, cancellationToken: TestContext.Current.CancellationToken) : store.BlockAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).AsTask();
        Assert.False(store.IsGranted(Origin));
        old.Acknowledge();
        var newer = await disk.NextAsync();
        try
        {
            Assert.True(newer.Snapshot.Generation > old.Snapshot.Generation);
            Assert.Equal(ConsentMutationOutcome.Superseded, (await grant.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
            Assert.False(store.IsGranted(Origin));
            Assert.False(revoke.IsCompleted);
        }
        finally { newer.Acknowledge(); }
        Assert.Equal(ConsentMutationOutcome.Durable, (await revoke.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(Origin));
        Assert.True(remove ? disk.Last!.Records.Count == 0 : disk.Last!.Records.Single().State == "blocked");
    }

    [Fact]
    public async Task Failed_restriction_is_sticky_unavailable_and_never_marks_session_clean()
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken);
        disk.FailWrites = true;
        Assert.Equal(ConsentMutationOutcome.FenceCovered, (await store.BlockAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(Origin));
        Assert.Equal(ConsentStorageHealth.Unavailable, store.PersistenceCoordinator.Health);
        Assert.NotEqual(202, (await store.RequestAsync("https://another.test", cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Null(new TokenService(consent: store).Issue(Origin).Token);
        var baked = new TokenService(consent: store, isBaked: origin => origin == "https://baked.test");
        Assert.NotNull(baked.Issue("https://baked.test").Token);
        disk.FailWrites = false;
        Assert.NotEqual(ConsentMutationOutcome.Durable, (await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        await store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(0, disk.Completes);
    }

    [Fact]
    public async Task Failed_grant_cannot_promote_and_pre_admission_cancellation_does_not_mutate()
    {
        var disk = new ControlledConsentPersistence { FailWrites = true };
        await using var store = new ConsentStore(persistence: disk);
        disk.Store = store;
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.GrantAsync(Origin, cancellationToken: cancelled.Token).AsTask());
        Assert.Equal(0, disk.Writes);
        Assert.NotEqual(ConsentMutationOutcome.Durable, (await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(Origin));
        Assert.Equal(ConsentStorageHealth.Unavailable, store.PersistenceCoordinator.Health);
    }

    [Fact]
    public async Task Bound_sync_helpers_throw_before_mutation_or_writes()
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.Throws<InvalidOperationException>(() => store.Grant(Origin));
        Assert.Throws<InvalidOperationException>(() => store.Deny(Origin));
        Assert.Throws<InvalidOperationException>(() => store.Block(Origin));
        Assert.Throws<InvalidOperationException>(() => store.Remove(Origin));
        Assert.False(store.IsGranted(Origin));
        Assert.Equal(0, disk.Writes);
    }

    [Fact]
    public async Task Loaded_baked_flag_is_descriptive_and_denial_cooldown_survives_without_streak()
    {
        var now = DateTimeOffset.UtcNow;
        var disk = new ControlledConsentPersistence
        {
            Initial = new(12, new[] {
                new StoredConsent(Origin, "granted", true, now, null, null),
                new StoredConsent("https://denied.test", "denied", false, now, now.AddMinutes(10), now)
            })
        };
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.True(store.IsGranted(Origin));
        Assert.False((await store.GetAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Managed);
        Assert.Equal(403, (await store.RequestAsync("https://denied.test", cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
        Assert.InRange((await store.GetAsync("https://denied.test", cancellationToken: TestContext.Current.CancellationToken)).RetryAfterSeconds!.Value, 1, 600);
    }

    [Fact]
    public async Task Queue_is_bounded_including_active_and_overflow_restriction_denies_immediately()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        var accepted = new List<Task<ConsentMutationResult>> { store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken).AsTask() };
        var active = await disk.NextAsync();
        for (var index = 1; index < 64; index++) accepted.Add(store.GrantAsync($"https://site-{index}.test", cancellationToken: TestContext.Current.CancellationToken).AsTask());
        Assert.InRange(store.PersistenceCoordinator.OutstandingReservations, 1, 64);
        Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync("https://overflow.test", cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        Assert.Equal(ConsentMutationOutcome.FenceCovered, (await store.BlockAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(Origin));
        Assert.Equal(ConsentStorageHealth.Unavailable, store.PersistenceCoordinator.Health);
        disk.Pause = false;
        active.Acknowledge();
        await Task.WhenAll(accepted).WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal(0, store.PersistenceCoordinator.OutstandingReservations);
        Assert.InRange(disk.MaxActive, 1, 1);
        Assert.True(disk.Writes <= 2, "Pending intents should coalesce, not retain full snapshot work per request.");
        await store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(0, disk.Completes);
    }

    [Fact]
    public async Task Restrictive_observer_cancellation_does_not_cancel_critical_write_or_clean_early()
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken);
        disk.Pause = true;
        using var observer = new CancellationTokenSource();
        var block = store.BlockAsync(Origin, observer.Token).AsTask();
        var write = await disk.NextAsync();
        observer.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => block);
        Assert.False(write.Cancellation.CanBeCanceled);
        Assert.False(store.IsGranted(Origin));
        var stopping = store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken).AsTask();
        Assert.False(stopping.IsCompleted);
        Assert.Equal(0, disk.Completes);
        write.Acknowledge();
        await stopping.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal("blocked", disk.Last!.Records.Single().State);
        Assert.Equal(1, disk.Completes);
        Assert.Equal(disk.Last.Generation, disk.CompletedGeneration);
    }

    [Fact]
    public async Task Cancelled_grant_requires_durable_compensation_before_clean_drain()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        using var observer = new CancellationTokenSource();
        var grant = store.GrantAsync(Origin, cancellationToken: observer.Token).AsTask();
        var write = await disk.NextAsync();
        observer.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => grant);
        Assert.False(store.IsGranted(Origin));
        write.Acknowledge();
        var compensation = await disk.NextAsync();
        Assert.Empty(compensation.Snapshot.Records);
        compensation.Acknowledge();
        await store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken).AsTask().WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.False(store.IsGranted(Origin));
        Assert.Empty(disk.Last!.Records);
        Assert.Equal(1, disk.Completes);
    }

    [Fact]
    public async Task Stop_fences_late_grant_commit_and_rejects_new_mutations()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        var grant = store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken).AsTask();
        var write = await disk.NextAsync();
        var stop = store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken).AsTask();
        Assert.False(store.IsGranted(Origin));
        Assert.False(stop.IsCompleted);
        Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync("https://other.test", cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        disk.Pause = false;
        write.Acknowledge();
        await stop.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal(ConsentMutationOutcome.Superseded, (await grant.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(Origin));
        Assert.NotEqual(202, (await store.RequestAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
    }

    [Fact]
    public async Task Cancelling_superseded_grant_must_not_erase_newer_block_from_snapshot()
    {
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        using var observer = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        var grant = store.GrantAsync(Origin, cancellationToken: observer.Token).AsTask();
        var old = await disk.NextAsync();
        var block = store.BlockAsync(Origin, TestContext.Current.CancellationToken).AsTask();
        observer.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => grant);
        old.Acknowledge();
        var next = await disk.NextAsync();
        try
        {
            Assert.Contains(next.Snapshot.Records, record => record.Origin == Origin && record.State == "blocked");
        }
        finally { next.Acknowledge(); }
        Assert.Equal(ConsentMutationOutcome.Durable, (await block.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
    }

    [Fact]
    public async Task Open_ack_after_stop_must_never_publish_ready_or_saved_authority()
    {
        var disk = new ControlledConsentPersistence
        {
            PauseOpen = true,
            Initial = new(8, new[] { new StoredConsent(Origin, "granted", false, DateTimeOffset.UnixEpoch, null, null) })
        };
        await using var store = new ConsentStore(persistence: disk);
        var opening = store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken).AsTask();
        await disk.OpenEntered.Task.WaitAsync(Limit, TestContext.Current.CancellationToken);
        await store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken);
        disk.ReleaseOpen();
        await opening.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.NotEqual(ConsentStorageHealth.Ready, store.PersistenceCoordinator.Health);
        Assert.False(store.IsGranted(Origin));
    }

    [Theory]
    [InlineData("https://EXAMPLE.test")]
    [InlineData("http://example.test")]
    [InlineData("https://example.test/")]
    [InlineData("https://127.0.0.1")]
    public async Task Noncanonical_or_ineligible_origin_never_gets_a_reservation(string origin)
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentMutationOutcome.Rejected, (await store.GrantAsync(origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(origin));
        Assert.Equal(0, disk.Writes);
    }

    [Fact]
    public async Task Unsupported_reset_does_not_fake_recovery()
    {
        var disk = new ControlledConsentPersistence();
        await using var store = new ConsentStore(persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        var result = await store.PersistenceCoordinator.ResetAsync(new(true), TestContext.Current.CancellationToken);
        Assert.False(result.Succeeded);
        Assert.Equal(0, disk.Resets);
    }

    [Fact]
    public async Task Native_grant_uses_same_ack_guard_and_loses_to_block()
    {
        var prompt = new ControlledPrompt();
        var disk = new ControlledConsentPersistence { Pause = true };
        await using var store = new ConsentStore(nativeConsent: prompt, persistence: disk);
        await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.Equal(202, (await store.RequestAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
        prompt.Decision.SetResult(ConsentDecision.Granted);
        var grant = await disk.NextAsync();
        Assert.False(store.IsGranted(Origin));
        var block = store.BlockAsync(Origin, cancellationToken: TestContext.Current.CancellationToken).AsTask();
        grant.Acknowledge();
        var restriction = await disk.NextAsync();
        Assert.False(store.IsGranted(Origin));
        restriction.Acknowledge();
        Assert.Equal(ConsentMutationOutcome.Durable, (await block.WaitAsync(Limit, TestContext.Current.CancellationToken)).Outcome);
        Assert.False(store.IsGranted(Origin));
    }

    [Fact]
    public async Task Failed_block_then_reopen_session_cannot_hydrate_older_durable_grant()
    {
        var directory = new MemoryDirectory();
        await using (var store = new ConsentStore(persistence: new SessionPersistence(directory)))
        {
            await store.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
            Assert.Equal(ConsentMutationOutcome.Durable, (await store.GrantAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            directory.FailSnapshot = true;
            Assert.Equal(ConsentMutationOutcome.FenceCovered, (await store.BlockAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).Outcome);
            Assert.False(store.IsGranted(Origin));
            await store.PersistenceCoordinator.StopAsync(TestContext.Current.CancellationToken);
            Assert.Equal("zilo-consent-session-v1\n", System.Text.Encoding.UTF8.GetString(directory.Fence!));
        }
        directory.FailSnapshot = false;
        await using var reopened = new ConsentStore(persistence: new SessionPersistence(directory));
        await reopened.PersistenceCoordinator!.InitializeAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Unavailable, reopened.PersistenceCoordinator.Health);
        Assert.False(reopened.IsGranted(Origin));
        Assert.NotEqual(202, (await reopened.RequestAsync(Origin, cancellationToken: TestContext.Current.CancellationToken)).HttpStatus);
        Assert.Null(new TokenService(consent: reopened).Issue(Origin).Token);
    }

    private sealed class ControlledPrompt : INativeConsentPrompt
    {
        internal TaskCompletionSource<ConsentDecision> Decision { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default) => new(Decision.Task);
    }

    private sealed class SessionPersistence(MemoryDirectory directory) : IConsentPersistence
    {
        private readonly ConsentSession _session = new(directory);
        public ValueTask<ConsentOpenResult> OpenSessionAsync(CancellationToken cancellationToken = default) => _session.OpenAsync(cancellationToken);
        public ValueTask WriteSnapshotAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default) => _session.WriteAsync(snapshot, cancellationToken);
        public ValueTask CompleteSessionAsync(long durableGeneration, CancellationToken cancellationToken = default) => _session.CompleteAsync(durableGeneration, cancellationToken);
        public ValueTask<ConsentOpenResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => _session.DisposeAsync();
    }

    private sealed class MemoryDirectory : IPrivateConsentDirectory
    {
        internal byte[]? Snapshot;
        internal byte[]? Fence;
        internal bool FailSnapshot;
        public ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken) => new(new ConsentDirectoryContents(Snapshot, Fence, false));
        public ValueTask ReplaceAsync(string name, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken)
        {
            if (name == "consent.json")
            {
                if (FailSnapshot) throw new IOException("controlled-snapshot-failure");
                Snapshot = contents.ToArray();
            }
            else if (name == "session.fence") Fence = contents.ToArray();
            else throw new InvalidOperationException();
            return ValueTask.CompletedTask;
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

internal sealed class ControlledConsentPersistence : IConsentPersistence
{
    private readonly Channel<PendingWrite> _pending = Channel.CreateUnbounded<PendingWrite>();
    private int _active;
    internal bool Pause { get; set; }
    internal bool PauseOpen { get; set; }
    internal TaskCompletionSource OpenEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _openAcknowledgement = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal bool FailWrites { get; set; }
    internal bool OpenFence { get; set; } = true;
    internal ConsentSnapshot Initial { get; set; } = new(1, Array.Empty<StoredConsent>());
    internal ConsentStore? Store { get; set; }
    internal ConsentSnapshot? Last { get; private set; }
    internal bool UnderMonitor { get; private set; }
    internal bool AuthorityAtFirstWrite { get; private set; }
    internal int Opens { get; private set; }
    internal int Writes { get; private set; }
    internal int Completes { get; private set; }
    internal int Resets { get; private set; }
    internal int MaxActive { get; private set; }
    internal long CompletedGeneration { get; private set; }
    public async ValueTask<ConsentOpenResult> OpenSessionAsync(CancellationToken cancellationToken = default)
    {
        ObserveMonitor();
        Opens++;
        OpenEntered.TrySetResult();
        if (PauseOpen) await _openAcknowledgement.Task;
        return new ConsentOpenResult(ConsentStorageHealth.Ready, Initial, OpenFence, null);
    }
    internal void ReleaseOpen() => _openAcknowledgement.TrySetResult();
    public async ValueTask WriteSnapshotAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ObserveMonitor();
        if (Writes++ == 0) AuthorityAtFirstWrite = Store?.IsGranted("https://example.test") ?? false;
        MaxActive = Math.Max(MaxActive, Interlocked.Increment(ref _active));
        try
        {
            if (Pause)
            {
                var pending = new PendingWrite(snapshot, cancellationToken);
                await _pending.Writer.WriteAsync(pending);
                await pending.Completion.Task;
            }
            if (FailWrites) throw new IOException("controlled-write-failure");
            Last = snapshot;
        }
        finally { Interlocked.Decrement(ref _active); }
    }
    public ValueTask CompleteSessionAsync(long durableGeneration, CancellationToken cancellationToken = default)
    {
        ObserveMonitor(); Completes++; CompletedGeneration = durableGeneration;
        return ValueTask.CompletedTask;
    }
    public ValueTask<ConsentOpenResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default)
    {
        Resets++;
        throw new NotSupportedException();
    }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    internal async Task<PendingWrite> NextAsync() => await _pending.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));
    private void ObserveMonitor() => UnderMonitor |= Store is not null && Monitor.IsEntered(Store.AuthorizationGate);
    internal sealed record PendingWrite(ConsentSnapshot Snapshot, CancellationToken Cancellation)
    {
        internal TaskCompletionSource Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal void Acknowledge() => Completion.TrySetResult();
    }
}
