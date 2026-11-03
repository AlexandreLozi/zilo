using System.Collections;
using System.Reflection;
using Xunit;
using Zilo.Security;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

// Controlled I/O ordering/exclusion evidence, not native Windows lock or durability proof.
public sealed class ConsentShutdownTests
{
    private const string Origin = "https://example.test";
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(10);
    private static TaskCompletionSource Signal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static Task Wait(Task task) => task.WaitAsync(Limit, TestContext.Current.CancellationToken);
    private static int Count(object target, string field) => ((ICollection)target.GetType()
        .GetField(field, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(target)!).Count;

    [Fact]
    public async Task Concurrent_stop_callers_share_epoch_and_one_clean_operation()
    {
        var disk = new DrainPersistence { HoldClean = true };
        await using var store = new ConsentStore(persistence: disk);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var first = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.CleanEntered.Task);
        long epoch;
        lock (store.AuthorizationGate) epoch = owner.CurrentLifecycleEpochLocked;
        var second = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        try
        {
            lock (store.AuthorizationGate) Assert.Equal(epoch, owner.CurrentLifecycleEpochLocked);
            Assert.Equal(1, disk.Cleans);
            Assert.False(second.IsCompleted);
        }
        finally { disk.CleanRelease.TrySetResult(); }
        await Wait(Task.WhenAll(first, second));
    }

    [Fact]
    public async Task Cancelled_clean_observer_is_nonthrowing_unavailable_and_late_ack_is_not_success()
    {
        var disk = new DrainPersistence { HoldClean = true };
        await using var store = new ConsentStore(persistence: disk);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        using var cancellation = new CancellationTokenSource();
        var stop = owner.StopAsync(cancellation.Token).AsTask();
        await Wait(disk.CleanEntered.Task);
        cancellation.Cancel();
        try
        {
            await stop.WaitAsync(TimeSpan.FromMilliseconds(500), TestContext.Current.CancellationToken);
            Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
            Assert.False(disk.CleanCancellation.CanBeCanceled);
            Assert.Equal(0, disk.Disposals);
        }
        finally { disk.CleanRelease.TrySetResult(); }
        await Wait(stop);
        await store.DisposeAsync();
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.True(disk.PhysicalClean);
    }

    [Fact]
    public async Task Restriction_after_clean_reservation_has_no_fence_or_durable_claim_and_no_metadata_growth()
    {
        var disk = new DrainPersistence { HoldClean = true };
        await using var store = new ConsentStore(persistence: disk);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var stop = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.CleanEntered.Task);
        try
        {
            for (var index = 0; index < 100; index++)
                Assert.Equal(ConsentMutationOutcome.NotSaved,
                    (await store.BlockAsync($"https://postseal-{index}.test", TestContext.Current.CancellationToken)).Outcome);
            Assert.Equal(0, owner.OutstandingReservations);
            Assert.Equal(0, disk.Writes);
            Assert.Equal(0, Count(store, "_entries"));
            Assert.Equal(0, Count(owner, "_sequences"));
            Assert.False(store.IsGranted(Origin));
        }
        finally { disk.CleanRelease.TrySetResult(); }
        await Wait(stop);
    }

    [Fact]
    public async Task Dispose_joins_open_and_never_releases_before_late_open_or_issues_clean()
    {
        var disk = new DrainPersistence { HoldOpen = true };
        await using var store = new ConsentStore(persistence: disk);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        var opening = owner.InitializeAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.OpenEntered.Task);
        var disposing = store.DisposeAsync().AsTask();
        try
        {
            Assert.Equal(0, disk.Disposals);
            Assert.False(disposing.IsCompleted);
            Assert.True(disk.LockHeld);
        }
        finally { disk.OpenRelease.TrySetResult(); }
        await Wait(Task.WhenAll(opening, disposing));
        Assert.Equal(1, disk.Disposals);
        Assert.False(disk.OverlapOnRelease);
        Assert.Equal(0, disk.Cleans);
        Assert.NotEqual(ConsentStorageHealth.Ready, owner.Health);
    }

    private static ConsentStore TimedStore(DrainPersistence disk, ManualShutdownTime time)
    {
        var store = new ConsentStore(null, null, null, disk, null, shutdownTimeProvider: time);
        disk.Store = store;
        return store;
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Total_budget_expires_during_write_retaining_exclusion_until_late_ack_or_fault(bool fail)
    {
        var time = new ManualShutdownTime();
        var disk = new DrainPersistence { HoldWrite = true, FailWrite = fail };
        await using var store = TimedStore(disk, time);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var mutation = store.BlockAsync(Origin, TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.WriteEntered.Task);
        var stop = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        time.Advance(TimeSpan.FromSeconds(5));
        await Wait(stop);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.True(owner.ShutdownPending);
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.False(disk.WriteCancellation.CanBeCanceled);
        Assert.True(disk.LockHeld); // A second fixture owner is excluded, not native Windows proof.
        Assert.Equal(0, disk.Disposals);
        await store.DisposeAsync(); // Joins original expired budget, not another five seconds.
        Assert.True(disk.LockHeld);
        disk.WriteRelease.TrySetResult();
        var result = await mutation.WaitAsync(Limit, TestContext.Current.CancellationToken);
        Assert.Equal(fail ? ConsentMutationOutcome.FenceCovered : ConsentMutationOutcome.Superseded, result.Outcome);
        await Wait(disk.Released.Task);
        Assert.Equal(0, disk.Cleans);
        Assert.Equal(1, disk.Disposals);
        Assert.False(disk.OverlapOnRelease);
        Assert.False(disk.UnderMonitor);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Writer_and_marker_share_remaining_budget_and_late_marker_is_not_success(bool fail)
    {
        var time = new ManualShutdownTime();
        var disk = new DrainPersistence { HoldWrite = true, HoldClean = true, FailClean = fail };
        await using var store = TimedStore(disk, time);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var mutation = store.BlockAsync(Origin, TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.WriteEntered.Task);
        var stop = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        time.Advance(TimeSpan.FromSeconds(4));
        Assert.False(stop.IsCompleted);
        disk.WriteRelease.TrySetResult();
        await Wait(disk.CleanEntered.Task);
        Assert.Equal(disk.WrittenGeneration, disk.CleanGeneration);
        Assert.Equal("blocked", disk.LastSnapshot!.Records.Single().State);
        time.Advance(TimeSpan.FromSeconds(1));
        await Wait(stop);
        Assert.True(owner.ShutdownPending);
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.False(disk.CleanCancellation.CanBeCanceled);
        Assert.Equal(0, disk.Disposals);
        Assert.True(disk.LockHeld);
        disk.CleanRelease.TrySetResult();
        await Wait(disk.Released.Task);
        await Wait(mutation);
        Assert.Equal(!fail, disk.PhysicalClean);
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.Equal(1, disk.Cleans);
        Assert.Equal(1, disk.Disposals);
        Assert.False(disk.OverlapOnRelease);
        Assert.False(disk.UnderMonitor);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Dispose_before_marker_suppresses_clean_and_concurrent_callers_do_not_restart_epoch(bool disposeFirst)
    {
        var time = new ManualShutdownTime();
        var disk = new DrainPersistence { HoldWrite = true };
        await using var store = TimedStore(disk, time);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var mutation = store.BlockAsync(Origin, TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.WriteEntered.Task);
        var first = disposeFirst ? store.DisposeAsync().AsTask() : owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        long epoch;
        lock (store.AuthorizationGate) epoch = owner.CurrentLifecycleEpochLocked;
        var disposing = store.DisposeAsync().AsTask();
        var stop = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        lock (store.AuthorizationGate) Assert.Equal(epoch, owner.CurrentLifecycleEpochLocked);
        Assert.True(disk.LockHeld);
        Assert.Equal(0, disk.Disposals);
        disk.WriteRelease.TrySetResult();
        await Wait(Task.WhenAll(first, disposing, stop, mutation));
        Assert.Equal(0, disk.Cleans);
        Assert.Equal(1, disk.Disposals);
        Assert.False(disk.OverlapOnRelease);
        Assert.False(owner.CleanShutdownSucceeded);
    }

    [Fact]
    public async Task Dispose_during_issued_marker_joins_and_cannot_abort_or_release_early()
    {
        var disk = new DrainPersistence { HoldClean = true };
        await using var store = new ConsentStore(persistence: disk);
        using var cleanup = disk.UnblockOnExit();
        disk.Store = store;
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var stop = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.CleanEntered.Task);
        var disposing = store.DisposeAsync().AsTask();
        Assert.False(disposing.IsCompleted);
        Assert.Equal(0, disk.Disposals);
        Assert.True(disk.LockHeld);
        disk.CleanRelease.TrySetResult();
        await Wait(Task.WhenAll(stop, disposing));
        Assert.True(disk.PhysicalClean);
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.Equal(1, disk.Disposals);
        Assert.False(disk.OverlapOnRelease);
    }

    [Fact]
    public async Task Cancelled_joiner_abandons_all_pending_observers_but_not_critical_io()
    {
        var disk = new DrainPersistence { HoldClean = true };
        await using var store = new ConsentStore(persistence: disk);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var first = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.CleanEntered.Task);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await owner.StopAsync(cancelled.Token);
        await Wait(first);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.True(owner.ShutdownPending);
        Assert.Equal(1, disk.Cleans);
        Assert.Equal(0, disk.Disposals);
        disk.CleanRelease.TrySetResult();
        await Wait(disk.Released.Task);
    }

    [Fact]
    public async Task Timely_clean_success_is_not_retroactively_undone_by_late_observer_cancellation()
    {
        var time = new ManualShutdownTime();
        var disk = new DrainPersistence();
        await using var store = TimedStore(disk, time);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        await owner.StopAsync(TestContext.Current.CancellationToken);
        Assert.True(owner.CleanShutdownSucceeded);
        time.Advance(TimeSpan.FromSeconds(10));
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await owner.StopAsync(cancelled.Token);
        await store.DisposeAsync();
        Assert.True(owner.CleanShutdownSucceeded);
        Assert.Equal(ConsentStorageHealth.Stopped, owner.Health);
        Assert.Equal(1, disk.Cleans);
        Assert.Equal(1, disk.Disposals);
    }

    [Fact]
    public async Task Release_observation_uses_original_budget_without_undoing_known_timely_clean()
    {
        var time = new ManualShutdownTime();
        var disk = new DrainPersistence { HoldDispose = true };
        await using var store = TimedStore(disk, time);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        var stop = owner.StopAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.DisposeEntered.Task);
        Assert.True(owner.CleanShutdownSucceeded);
        Assert.True(owner.ShutdownPending);
        Assert.True(disk.LockHeld);
        time.Advance(TimeSpan.FromSeconds(5));
        await Wait(stop);
        await store.DisposeAsync();
        Assert.True(owner.CleanShutdownSucceeded);
        Assert.Equal(ConsentStorageHealth.Stopped, owner.Health);
        Assert.True(disk.LockHeld);
        disk.DisposeRelease.TrySetResult();
        await Wait(disk.Released.Task);
        Assert.Equal(1, disk.Disposals);
    }

    [Fact]
    public async Task Open_stall_consumes_total_dispose_budget_but_cannot_release_or_publish_late_ready()
    {
        var time = new ManualShutdownTime();
        var disk = new DrainPersistence { HoldOpen = true };
        await using var store = TimedStore(disk, time);
        using var cleanup = disk.UnblockOnExit();
        var owner = store.PersistenceCoordinator!;
        var opening = owner.InitializeAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(disk.OpenEntered.Task);
        var dispose = store.DisposeAsync().AsTask();
        time.Advance(TimeSpan.FromSeconds(5));
        await Wait(dispose);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.True(owner.ShutdownPending);
        Assert.True(disk.LockHeld);
        Assert.Equal(0, disk.Disposals);
        Assert.False(disk.OpenCancellation.CanBeCanceled);
        disk.OpenRelease.TrySetResult();
        await Wait(Task.WhenAll(opening, disk.Released.Task));
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.Equal(0, disk.Cleans);
        Assert.False(disk.OverlapOnRelease);
    }

    [Fact]
    public async Task Reserved_open_before_external_dispatch_prevents_release_before_late_open()
    {
        var time = new ManualShutdownTime();
        var gate = new object();
        var disk = new DrainPersistence { Gate = gate };
        var entered = Signal();
        var dispatch = Signal();
        await using var owner = new ConsentPersistenceCoordinator(disk, gate, _ => { }, _ => null,
            600, _ => true, _ => false, _ => { }, shutdownTimeProvider: time,
            beforeOpenDispatch: async () => { entered.TrySetResult(); await dispatch.Task; });
        using var cleanup = disk.UnblockOnExit();
        var opening = owner.InitializeAsync(TestContext.Current.CancellationToken).AsTask();
        await Wait(entered.Task);
        var disposing = owner.DisposeAsync().AsTask();
        try
        {
            time.Advance(TimeSpan.FromSeconds(5));
            await Wait(disposing);
            Assert.Equal(0, disk.Opens);
            Assert.Equal(0, disk.Disposals);
            Assert.True(disk.LockHeld);
            Assert.True(owner.ShutdownPending);
        }
        finally { dispatch.TrySetResult(); }
        await Wait(Task.WhenAll(opening, disk.Released.Task));
        Assert.Equal(1, disk.Opens);
        Assert.Equal(1, disk.Disposals);
        Assert.False(disk.AccessAfterRelease);
        Assert.False(disk.OverlapOnRelease);
        Assert.False(disk.UnderMonitor);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        Assert.Equal(0, disk.Cleans);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Failed_atomic_clean_has_only_actual_old_dirty_or_new_clean_bytes_and_no_success(bool afterReplace)
    {
        var directory = new AtomicMarkerDirectory { FailAfterReplace = afterReplace };
        var disk = new SessionPersistence(directory);
        await using var store = new ConsentStore(persistence: disk);
        var owner = store.PersistenceCoordinator!;
        await owner.InitializeAsync(TestContext.Current.CancellationToken);
        await owner.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(afterReplace ? "zilo-consent-clean-v1\n" : "zilo-consent-session-v1\n",
            System.Text.Encoding.UTF8.GetString(directory.Fence!));
        Assert.False(owner.CleanShutdownSucceeded);
        Assert.Equal(ConsentStorageHealth.Unavailable, owner.Health);
        await store.DisposeAsync();
        Assert.Equal(1, directory.CleanAttempts);
        Assert.Equal(1, directory.Disposals);
    }

    private sealed class SessionPersistence(AtomicMarkerDirectory directory) : IConsentPersistence
    {
        private readonly ConsentSession _session = new(directory);
        public ValueTask<ConsentOpenResult> OpenSessionAsync(CancellationToken cancellationToken = default) => _session.OpenAsync(cancellationToken);
        public ValueTask WriteSnapshotAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default) => _session.WriteAsync(snapshot, cancellationToken);
        public ValueTask CompleteSessionAsync(long durableGeneration, CancellationToken cancellationToken = default) => _session.CompleteAsync(durableGeneration, cancellationToken);
        public ValueTask<ConsentOpenResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => _session.DisposeAsync();
    }

    // Real ConsentSession, with failures at either side of the simulated atomic replacement.
    private sealed class AtomicMarkerDirectory : IPrivateConsentDirectory
    {
        internal byte[]? Fence;
        private byte[]? _snapshot;
        internal bool FailAfterReplace { get; set; }
        internal int CleanAttempts, Disposals;
        public ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken) => new(new ConsentDirectoryContents(_snapshot, Fence, false));
        public ValueTask ReplaceAsync(string name, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken)
        {
            var bytes = contents.ToArray();
            if (name == "consent.json") _snapshot = bytes;
            else
            {
                var clean = System.Text.Encoding.UTF8.GetString(bytes) == "zilo-consent-clean-v1\n";
                if (clean)
                {
                    CleanAttempts++;
                    if (FailAfterReplace) Fence = bytes;
                    throw new IOException("controlled-atomic-clean-failure");
                }
                Fence = bytes;
            }
            return ValueTask.CompletedTask;
        }
        public ValueTask DisposeAsync() { Disposals++; return ValueTask.CompletedTask; }
    }

    // A monotonic one-shot timer seam: no sleeps and no new fake-time dependency.
    internal sealed class ManualShutdownTime : TimeProvider
    {
        private readonly object _gate = new();
        private readonly List<ManualTimer> _timers = new();
        private long _ticks;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() { lock (_gate) return _ticks; }
        public override DateTimeOffset GetUtcNow() => throw new InvalidOperationException("wall-clock-shutdown-budget-forbidden");
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(this, callback, state);
            lock (_gate) { _timers.Add(timer); timer.Change(dueTime, period); }
            return timer;
        }
        internal void Advance(TimeSpan amount)
        {
            ManualTimer[] due;
            lock (_gate)
            {
                _ticks += amount.Ticks;
                due = _timers.Where(timer => timer.Due <= _ticks).ToArray();
                foreach (var timer in due) timer.Due = long.MaxValue;
            }
            foreach (var timer in due) timer.Fire();
        }
        private sealed class ManualTimer(ManualShutdownTime owner, TimerCallback callback, object? state) : ITimer
        {
            internal long Due = long.MaxValue;
            private bool _disposed;
            internal void Fire() { lock (owner._gate) { if (_disposed) return; } callback(state); }
            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                lock (owner._gate)
                {
                    if (_disposed) return false;
                    Due = dueTime == Timeout.InfiniteTimeSpan ? long.MaxValue : owner._ticks + dueTime.Ticks;
                    return true;
                }
            }
            public void Dispose() { lock (owner._gate) { _disposed = true; owner._timers.Remove(this); } }
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
    }

    internal sealed class DrainPersistence : IConsentPersistence
    {
        internal bool HoldOpen { get; set; }
        internal bool HoldWrite { get; set; }
        internal bool HoldClean { get; set; }
        internal bool HoldDispose { get; set; }
        internal bool FailWrite { get; set; }
        internal bool FailClean { get; set; }
        internal bool CleanBeforeFailure { get; set; }
        internal TaskCompletionSource OpenEntered { get; } = Signal();
        internal TaskCompletionSource OpenRelease { get; } = Signal();
        internal TaskCompletionSource WriteEntered { get; } = Signal();
        internal TaskCompletionSource WriteRelease { get; } = Signal();
        internal TaskCompletionSource CleanEntered { get; } = Signal();
        internal TaskCompletionSource CleanRelease { get; } = Signal();
        internal TaskCompletionSource DisposeEntered { get; } = Signal();
        internal TaskCompletionSource DisposeRelease { get; } = Signal();
        internal TaskCompletionSource Released { get; } = Signal();
        internal ConsentStore? Store { get; set; }
        internal object? Gate { get; set; }
        internal int Opens, Cleans, Writes, Disposals, Active;
        internal bool LockHeld = true, OverlapOnRelease, UnderMonitor, PhysicalClean, AccessAfterRelease;
        internal CancellationToken CleanCancellation, WriteCancellation, OpenCancellation;
        internal long WrittenGeneration, CleanGeneration;
        internal ConsentSnapshot? LastSnapshot;
        internal IDisposable UnblockOnExit() => new Cleanup(this);
        private sealed class Cleanup(DrainPersistence disk) : IDisposable
        {
            public void Dispose()
            {
                disk.OpenRelease.TrySetResult(); disk.WriteRelease.TrySetResult();
                disk.CleanRelease.TrySetResult(); disk.DisposeRelease.TrySetResult();
            }
        }
        private void ObserveMonitor()
        {
            var gate = Gate ?? Store?.AuthorizationGate;
            UnderMonitor |= gate is not null && Monitor.IsEntered(gate);
        }
        private void Enter() { ObserveMonitor(); AccessAfterRelease |= !LockHeld; Interlocked.Increment(ref Active); }
        public async ValueTask<ConsentOpenResult> OpenSessionAsync(CancellationToken cancellationToken = default)
        {
            Enter(); Interlocked.Increment(ref Opens); OpenCancellation = cancellationToken;
            try
            {
                OpenEntered.TrySetResult();
                if (HoldOpen) await OpenRelease.Task;
                return new(ConsentStorageHealth.Ready, new(1, Array.Empty<StoredConsent>()), true, null);
            }
            finally { Interlocked.Decrement(ref Active); }
        }
        public async ValueTask WriteSnapshotAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default)
        {
            Enter(); Interlocked.Increment(ref Writes); WriteCancellation = cancellationToken;
            try
            {
                WriteEntered.TrySetResult();
                if (HoldWrite) await WriteRelease.Task;
                if (FailWrite) throw new IOException("controlled-late-write");
                WrittenGeneration = snapshot.Generation;
                LastSnapshot = snapshot;
            }
            finally { Interlocked.Decrement(ref Active); }
        }
        public async ValueTask CompleteSessionAsync(long durableGeneration, CancellationToken cancellationToken = default)
        {
            Enter(); Interlocked.Increment(ref Cleans); CleanCancellation = cancellationToken; CleanGeneration = durableGeneration;
            try
            {
                CleanEntered.TrySetResult();
                if (HoldClean) await CleanRelease.Task;
                if (!FailClean || CleanBeforeFailure) PhysicalClean = true;
                if (FailClean) throw new IOException("controlled-late-clean");
            }
            finally { Interlocked.Decrement(ref Active); }
        }
        public ValueTask<ConsentOpenResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public async ValueTask DisposeAsync()
        {
            ObserveMonitor();
            Interlocked.Increment(ref Disposals);
            OverlapOnRelease |= Active != 0;
            DisposeEntered.TrySetResult();
            if (HoldDispose) await DisposeRelease.Task;
            LockHeld = false;
            Released.TrySetResult();
        }
    }
}
