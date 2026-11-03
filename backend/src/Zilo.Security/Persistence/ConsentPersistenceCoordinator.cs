using System.Threading.Channels;
using Zilo.Security;

namespace Zilo.Security.Persistence;

internal sealed class ConsentPersistenceCoordinator : IAsyncDisposable
{
    internal const int MaxReservations = 64;
    internal const int MaxRecords = 4096;
    internal const int MaxSequenceOrigins = MaxRecords + ConsentStore.MaxEntries + MaxReservations;
    private readonly IConsentPersistence _persistence;
    private readonly object _gate;
    private readonly Action<ConsentSnapshot> _hydrateLocked;
    private readonly Func<string, StoredConsent?> _currentLocked;
    private readonly int _denialCooldownSeconds;
    private readonly Func<ConsentReservation, bool> _commitLocked;
    private readonly Func<string, bool> _hasEntryLocked;
    private readonly Action<string> _pruneEntryLocked;
    private readonly Dictionary<string, StoredConsent> _desired = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _sequences = new(StringComparer.Ordinal);
    private readonly List<ConsentReservation> _pending = new();
    private readonly HashSet<ConsentReservation> _owned = new();
    private readonly Channel<bool> _signals = Channel.CreateBounded<bool>(1);
    private Task? _worker;
    private bool _initialized, _disposed, _workerStopping;
    private long _durableGeneration, _nextGeneration;
    private long _lifecycleEpoch;
    private ConsentStorageHealth _health = ConsentStorageHealth.Starting;
    private Exception? _failure;
    private bool _durableFence;
    private static readonly TimeSpan ShutdownBudget = TimeSpan.FromSeconds(5);
    private readonly TimeProvider _shutdownTimeProvider;
    private readonly Func<Task>? _beforeOpenDispatch;
    private TaskCompletionSource? _opening;
    private TaskCompletionSource? _shutdownOwner;
    private TaskCompletionSource? _shutdownDecision;
    private long _shutdownStarted;
    private bool _shutdownMayClean, _shutdownAbandoned, _cleanShutdownSucceeded;

    internal ConsentPersistenceCoordinator(IConsentPersistence persistence, object gate,
        Action<ConsentSnapshot> hydrateLocked, Func<string, StoredConsent?> currentLocked,
        int denialCooldownSeconds, Func<ConsentReservation, bool> commitLocked,
        Func<string, bool> hasEntryLocked, Action<string> pruneEntryLocked,
        TimeProvider? shutdownTimeProvider = null, Func<Task>? beforeOpenDispatch = null)
    {
        _persistence = persistence; _gate = gate; _hydrateLocked = hydrateLocked; _currentLocked = currentLocked;
        _denialCooldownSeconds = denialCooldownSeconds; _commitLocked = commitLocked;
        _hasEntryLocked = hasEntryLocked; _pruneEntryLocked = pruneEntryLocked;
        _shutdownTimeProvider = shutdownTimeProvider ?? TimeProvider.System;
        _beforeOpenDispatch = beforeOpenDispatch;
    }

    internal ConsentStorageHealth Health { get { lock (_gate) return _health; } }
    internal int OutstandingReservations { get { lock (_gate) return _owned.Count; } }
    internal bool ShutdownPending { get { lock (_gate) return _shutdownOwner is not null && !_shutdownOwner.Task.IsCompleted; } }
    internal bool CleanShutdownSucceeded { get { lock (_gate) return _cleanShutdownSucceeded; } }
    internal bool AdmissionSealedLocked => _workerStopping;
    internal long CurrentOriginSequenceLocked(string origin) => _sequences.TryGetValue(origin, out var value) ? value : 0;
    internal long CurrentLifecycleEpochLocked => _lifecycleEpoch;
    internal bool IsCanonicalOrigin(string origin) => CanonicalOrigin(origin);
    internal bool HasDesiredOrOwnedLocked(string origin) => _desired.ContainsKey(origin) || _owned.Any(x => x.Origin == origin);
    internal static bool HasSequenceCapacity(int count, bool alreadyTracked) => alreadyTracked || count < MaxSequenceOrigins;

    internal ConsentReservation RejectCapacityLocked(string origin, ConsentDecision? decision, bool managed)
    {
        if (!_workerStopping && decision is not ConsentDecision.Granted) MarkUnavailableLocked();
        return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked());
    }

    internal void PruneSequenceLocked(string origin)
    {
        if (!HasDesiredOrOwnedLocked(origin) && !_hasEntryLocked(origin)) _sequences.Remove(origin);
    }

    internal async ValueTask InitializeAsync(CancellationToken cancellationToken = default)
    {
        long epoch;
        TaskCompletionSource opening;
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(ConsentPersistenceCoordinator));
            if (_initialized || _workerStopping || _health != ConsentStorageHealth.Starting) return;
            _initialized = true;
            epoch = _lifecycleEpoch;
            // Reserve before external dispatch, including the testable reserve-to-dispatch gap.
            _opening = opening = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        try
        {
            if (_beforeOpenDispatch is not null) await _beforeOpenDispatch().ConfigureAwait(false);
            // Observer cancellation cannot abandon an admitted operation or release its writer lock.
            var opened = await _persistence.OpenSessionAsync(CancellationToken.None).ConfigureAwait(false);
            lock (_gate)
            {
                if (opened.Health != ConsentStorageHealth.Ready || opened.Snapshot is null || !opened.DurableActiveFence ||
                    opened.Snapshot.Records.Count > MaxRecords)
                { MarkUnavailableLocked(); return; }
                if (epoch != _lifecycleEpoch || _disposed || _workerStopping || _health != ConsentStorageHealth.Starting) return;
                _durableFence = true;
                _durableGeneration = opened.Snapshot.Generation; _nextGeneration = _durableGeneration;
                _desired.Clear();
                foreach (var record in opened.Snapshot.Records) _desired[record.Origin] = record;
                _hydrateLocked(opened.Snapshot);
                _health = ConsentStorageHealth.Ready;
                _worker = Task.Run(() => WorkerLoop(epoch));
            }
        }
        catch
        {
            lock (_gate) MarkUnavailableLocked();
        }
        finally { opening.TrySetResult(); }
    }

    internal ConsentReservation ReserveLocked(string origin, ConsentDecision? decision, bool managed, DateTimeOffset now)
    {
        if (_health != ConsentStorageHealth.Ready || _workerStopping || _failure is not null)
            return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked());
        if (!CanonicalOrigin(origin))
            return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked());
        var existed = _desired.ContainsKey(origin);
        if (_owned.Count >= MaxReservations || (!existed && decision is not null && _desired.Count >= MaxRecords) ||
            !HasSequenceCapacity(_sequences.Count, _sequences.ContainsKey(origin)))
            return RejectCapacityLocked(origin, decision, managed);
        if (_nextGeneration == long.MaxValue) { MarkUnavailableLocked(); return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked()); }
        var generation = ++_nextGeneration;
        // Global generations never reset when an origin's tombstone is pruned.
        var sequence = generation;
        _sequences[origin] = sequence;
        StoredConsent? record;
        if (decision == ConsentDecision.Granted)
            record = new StoredConsent(origin, "granted", false, now, null, null);
        else if (decision == ConsentDecision.Blocked)
            record = new StoredConsent(origin, "blocked", false, now, null, null);
        else if (decision == ConsentDecision.Denied)
        {
            var current = _currentLocked(origin);
            var lastDenied = current?.State == "denied" && current.LastDenied is { } prior ? prior : now;
            var cooldown = current?.State == "denied" && current.CooldownUntil is { } savedCooldown && savedCooldown > now
                ? savedCooldown : now.AddSeconds(_denialCooldownSeconds);
            record = new StoredConsent(origin, "denied", false, now, cooldown, lastDenied);
        }
        else record = null;
        if (record is null) _desired.Remove(origin); else _desired[origin] = record;
        var reservation = new ConsentReservation(origin, decision, managed, generation, sequence, _lifecycleEpoch, record, true,
            new(TaskCreationOptions.RunContinuationsAsynchronously));
        _pending.Add(reservation); _owned.Add(reservation);
        _signals.Writer.TryWrite(true);
        return reservation;
    }

    internal async ValueTask<ConsentMutationResult> ObserveAsync(ConsentReservation reservation, CancellationToken cancellationToken = default)
    {
        if (!reservation.Accepted) return reservation.RejectedResult;
        if (reservation.Decision == ConsentDecision.Granted && cancellationToken.CanBeCanceled)
        {
            var cancelled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            using var registration = cancellationToken.Register(static state =>
            {
                var pair = ((ConsentPersistenceCoordinator Coordinator, ConsentReservation Reservation,
                    TaskCompletionSource Cancelled, CancellationToken Cancellation))state!;
                pair.Coordinator.CancelGrant(pair.Reservation);
                // Publish observer cancellation only after the owned compensation/fail-closed decision.
                pair.Cancelled.TrySetCanceled(pair.Cancellation);
            }, (this, reservation, cancelled, cancellationToken));
            await Task.WhenAny(reservation.Completion.Task, cancelled.Task).ConfigureAwait(false);
            // A grant already committed under the gate reports its actual result, not a claimed rollback.
            if (!reservation.Completion.Task.IsCompleted) await cancelled.Task.ConfigureAwait(false);
            return await reservation.Completion.Task.ConfigureAwait(false);
        }
        return await reservation.Completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private void CancelGrant(ConsentReservation reservation)
    {
        lock (_gate)
        {
            if (reservation.Completed || !reservation.Accepted || reservation.Decision != ConsentDecision.Granted) return;
            if (reservation.OriginSequence != CurrentOriginSequenceLocked(reservation.Origin) ||
                !DesiredEquals(reservation.Origin, reservation.Record)) return;
            if (reservation.LifecycleEpoch != _lifecycleEpoch || _disposed || _workerStopping)
            {
                // The old epoch cannot reserve compensation; its uncertain grant must retain the fence.
                MarkUnavailableLocked();
                return;
            }
            _desired.Remove(reservation.Origin);
            if (_owned.Count < MaxReservations && _nextGeneration != long.MaxValue)
            {
                var generation = ++_nextGeneration;
                _sequences[reservation.Origin] = generation;
                var compensation = new ConsentReservation(reservation.Origin, null, false, generation,
                    generation, _lifecycleEpoch, null, true, new(TaskCreationOptions.RunContinuationsAsynchronously));
                _pending.Add(compensation); _owned.Add(compensation); _signals.Writer.TryWrite(true);
            }
            else MarkUnavailableLocked();
        }
    }

    internal async ValueTask StopAsync(CancellationToken cancellationToken = default)
    {
        TaskCompletionSource owner;
        Task decision;
        bool dispatch;
        lock (_gate)
        {
            owner = ReserveShutdownLocked(dispose: false, out dispatch);
            decision = _shutdownDecision!.Task;
        }
        using var registration = cancellationToken.Register(static state =>
            ((ConsentPersistenceCoordinator)state!).AbandonShutdown(), this);
        // Only the caller that reserved the slot dispatches; no external code runs under the gate.
        if (dispatch) _ = Task.Run(() => ShutdownOwnerAsync(owner));
        await ObserveShutdownAsync(decision, cancellationToken).ConfigureAwait(false);
    }

    private TaskCompletionSource ReserveShutdownLocked(bool dispose, out bool dispatch)
    {
        if (dispose) _disposed = true;
        dispatch = _shutdownOwner is null;
        if (!dispatch) return _shutdownOwner!;

        _shutdownStarted = _shutdownTimeProvider.GetTimestamp();
        _shutdownOwner = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _shutdownDecision = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _shutdownMayClean = !dispose && _initialized && _health == ConsentStorageHealth.Ready &&
            _durableFence && _failure is null;
        _lifecycleEpoch++;
        _workerStopping = true;
        // Sealing invalidates fence acknowledgements for rejected mutations, but admitted
        // restrictions retain the actual dirty-fence proof until marker ownership is reserved.
        _health = _failure is not null ? ConsentStorageHealth.Unavailable :
            dispose ? ConsentStorageHealth.Stopped : ConsentStorageHealth.Stopping;
        _signals.Writer.TryComplete();
        return _shutdownOwner;
    }

    private TimeSpan RemainingShutdownBudgetLocked() =>
        ShutdownBudget - _shutdownTimeProvider.GetElapsedTime(_shutdownStarted);

    private void AbandonShutdown()
    {
        lock (_gate) AbandonShutdownLocked();
    }

    private void AbandonShutdownLocked()
    {
        // A later canceled observer cannot fabricate rollback of an already known timely clean.
        if (_cleanShutdownSucceeded || _shutdownOwner!.Task.IsCompleted) return;
        _shutdownAbandoned = true;
        MarkUnavailableLocked();
        _shutdownDecision!.TrySetResult();
    }

    private async ValueTask ObserveShutdownAsync(Task completion, CancellationToken cancellationToken)
    {
        TimeSpan remaining;
        lock (_gate) remaining = RemainingShutdownBudgetLocked();
        try
        {
            if (completion.IsCompleted) { await completion.ConfigureAwait(false); return; }
            if (remaining <= TimeSpan.Zero) { AbandonShutdown(); return; }
            await completion.WaitAsync(remaining, _shutdownTimeProvider, cancellationToken).ConfigureAwait(false);
        }
        catch { AbandonShutdown(); }
    }

    private async Task ShutdownOwnerAsync(TaskCompletionSource owner)
    {
        try
        {
            Task? opening;
            lock (_gate) opening = _opening?.Task;
            if (opening is not null) await opening.ConfigureAwait(false);
            Task? worker;
            lock (_gate) worker = _worker;
            if (worker is not null) await worker.ConfigureAwait(false);

            bool issueClean;
            long generation;
            lock (_gate)
            {
                if (RemainingShutdownBudgetLocked() <= TimeSpan.Zero) AbandonShutdownLocked();
                // This transaction reserves potentially irreversible marker ownership. Dispose or
                // cancellation after this boundary cannot abort it, even before external dispatch.
                issueClean = _shutdownMayClean && !_disposed && !_shutdownAbandoned && _failure is null &&
                    _owned.Count == 0 && _durableGeneration == _nextGeneration &&
                    RemainingShutdownBudgetLocked() > TimeSpan.Zero;
                generation = _durableGeneration;
                if (issueClean) _durableFence = false;
                if (!issueClean)
                {
                    if (!_disposed) MarkUnavailableLocked();
                    _shutdownDecision!.TrySetResult();
                }
            }
            if (issueClean)
            {
                await _persistence.CompleteSessionAsync(generation, CancellationToken.None).ConfigureAwait(false);
                lock (_gate)
                {
                    if (!_disposed && !_shutdownAbandoned && _failure is null && RemainingShutdownBudgetLocked() > TimeSpan.Zero)
                    {
                        _cleanShutdownSucceeded = true;
                        _health = ConsentStorageHealth.Stopped;
                    }
                    else AbandonShutdownLocked();
                    _shutdownDecision!.TrySetResult();
                }
            }
        }
        catch
        {
            lock (_gate) MarkUnavailableLocked();
        }
        finally
        {
            lock (_gate) _shutdownDecision!.TrySetResult();
            // One retained owner observes all admitted I/O before exactly one release. A stalled
            // operation retains this continuation and persistence; no timeout can unlock/replace it.
            try { await _persistence.DisposeAsync().ConfigureAwait(false); }
            catch { lock (_gate) MarkUnavailableLocked(); }
            lock (_gate)
            {
                // Release itself shares the same deadline. Check here as well as in observers so
                // a late release cannot win a scheduling race with the timeout and publish Stopped.
                if (!_cleanShutdownSucceeded && RemainingShutdownBudgetLocked() <= TimeSpan.Zero)
                    AbandonShutdownLocked();
                if (!_shutdownAbandoned && _failure is null) _health = ConsentStorageHealth.Stopped;
                owner.TrySetResult();
            }
        }
    }

    internal ValueTask<ConsentResetResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ConsentResetResult(false, "consent-reset-unsupported"));
    }

    public async ValueTask DisposeAsync()
    {
        TaskCompletionSource owner;
        bool dispatch;
        lock (_gate)
        {
            owner = ReserveShutdownLocked(dispose: true, out dispatch);
        }
        if (dispatch) _ = Task.Run(() => ShutdownOwnerAsync(owner));
        // Join the original deadline, including release observation; never grant a fresh budget.
        await ObserveShutdownAsync(owner.Task, CancellationToken.None).ConfigureAwait(false);
    }

    private async Task WorkerLoop(long epoch)
    {
        try
        {
            await foreach (var _ in _signals.Reader.ReadAllAsync().ConfigureAwait(false))
            {
                List<ConsentReservation> batch;
                ConsentSnapshot snapshot;
                lock (_gate)
                {
                    if (_pending.Count == 0) continue;
                    batch = new List<ConsentReservation>(_pending); _pending.Clear();
                    var records = _desired.Values.OrderBy(x => x.Origin, StringComparer.Ordinal).ToArray();
                    snapshot = new ConsentSnapshot(batch.Max(x => x.Generation), records);
                }
                try
                {
                    await _persistence.WriteSnapshotAsync(snapshot, CancellationToken.None).ConfigureAwait(false);
                    lock (_gate)
                    {
                        _durableGeneration = snapshot.Generation;
                        // A durable write may finish draining after Stop, but cannot publish authority.
                        var canCommit = epoch == _lifecycleEpoch && !_disposed && !_workerStopping &&
                            _health == ConsentStorageHealth.Ready && _failure is null;
                        foreach (var reservation in batch)
                        {
                            var current = _sequences.TryGetValue(reservation.Origin, out var seq) ? seq : 0;
                            var same = current == reservation.OriginSequence && DesiredEquals(reservation.Origin, reservation.Record);
                            var outcome = canCommit && same && _commitLocked(reservation) ? ConsentMutationOutcome.Durable : ConsentMutationOutcome.Superseded;
                            CompleteLocked(reservation, new(outcome, snapshot.Generation));
                        }
                    }
                }
                catch
                {
                    lock (_gate)
                    {
                        MarkUnavailableLocked();
                        foreach (var reservation in batch)
                            CompleteLocked(reservation, new(FailureOutcome(reservation), _durableGeneration));
                        while (_pending.Count > 0)
                        {
                            var pending = _pending[0];
                            _pending.RemoveAt(0);
                            CompleteLocked(pending, new(FailureOutcome(pending), _durableGeneration));
                        }
                    }
                }
            }
        }
        catch
        {
            lock (_gate)
            {
                MarkUnavailableLocked();
                _pending.Clear();
                foreach (var reservation in _owned.ToArray())
                    CompleteLocked(reservation, new(FailureOutcome(reservation), _durableGeneration));
            }
        }
    }

    private bool DesiredEquals(string origin, StoredConsent? record) =>
        (!_desired.TryGetValue(origin, out var current) && record is null) ||
        (_desired.TryGetValue(origin, out current) && record is not null && current == record);

    private void CompleteLocked(ConsentReservation reservation, ConsentMutationResult result)
    {
        if (reservation.Completed) return;
        reservation.Completed = true;
        _owned.Remove(reservation);
        _pruneEntryLocked(reservation.Origin);
        PruneSequenceLocked(reservation.Origin);
        reservation.Completion.TrySetResult(result);
    }

    private ConsentMutationOutcome FailureOutcome(ConsentReservation reservation) =>
        reservation.Decision is not ConsentDecision.Granted && _durableFence
            ? ConsentMutationOutcome.FenceCovered : ConsentMutationOutcome.NotSaved;
    private bool HasFenceLocked() => !_workerStopping && _durableFence;
    private void MarkUnavailableLocked() { _failure ??= new IOException("consent-storage-unavailable"); _health = ConsentStorageHealth.Unavailable; }

    private static bool CanonicalOrigin(string origin)
    {
        var result = new OriginPolicy(false, Array.Empty<string>()).Evaluate(origin);
        return result.Class == OriginClass.Eligible && result.Origin == origin && !origin.Contains('\0') &&
            System.Text.Encoding.UTF8.GetByteCount(origin) <= ConsentSnapshotCodec.MaxOriginBytes;
    }
}

internal sealed class ConsentReservation
{
    internal string Origin { get; }
    internal ConsentDecision? Decision { get; }
    internal bool Managed { get; }
    internal long Generation { get; }
    internal long OriginSequence { get; }
    internal long LifecycleEpoch { get; }
    internal StoredConsent? Record { get; }
    internal bool Accepted { get; }
    internal TaskCompletionSource<ConsentMutationResult> Completion { get; }
    internal bool Completed { get; set; }
    internal ConsentMutationResult RejectedResult { get; }

    internal ConsentReservation(string origin, ConsentDecision? decision, bool managed, long generation,
        long originSequence, long lifecycleEpoch, StoredConsent? record, bool accepted, TaskCompletionSource<ConsentMutationResult> completion,
        ConsentMutationResult? rejected = null)
    {
        Origin = origin; Decision = decision; Managed = managed; Generation = generation; OriginSequence = originSequence;
        LifecycleEpoch = lifecycleEpoch;
        Record = record; Accepted = accepted; Completion = completion; RejectedResult = rejected ?? new(ConsentMutationOutcome.Rejected, generation);
    }

    internal static ConsentReservation Rejected(string origin, ConsentDecision? decision, bool managed, long generation, bool fence) =>
        new(origin, decision, managed, generation, 0, 0, null, false,
            new(TaskCreationOptions.RunContinuationsAsynchronously),
            new(decision is ConsentDecision.Granted
                ? ConsentMutationOutcome.Rejected
                : fence ? ConsentMutationOutcome.FenceCovered : ConsentMutationOutcome.NotSaved, generation));
}
