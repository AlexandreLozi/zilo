using System.Threading.Channels;
using Zilo.Security;

namespace Zilo.Security.Persistence;

internal sealed class ConsentPersistenceCoordinator : IAsyncDisposable
{
    private const int MaxReservations = 64;
    private const int MaxRecords = 4096;
    private readonly IConsentPersistence _persistence;
    private readonly object _gate;
    private readonly Action<ConsentSnapshot> _hydrateLocked;
    private readonly Func<string, StoredConsent?> _currentLocked;
    private readonly int _denialCooldownSeconds;
    private readonly Func<ConsentReservation, bool> _commitLocked;
    private readonly Dictionary<string, StoredConsent> _desired = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _sequences = new(StringComparer.Ordinal);
    private readonly List<ConsentReservation> _pending = new();
    private readonly Channel<bool> _signals = Channel.CreateBounded<bool>(1);
    private Task? _worker;
    private bool _initialized, _disposed, _workerStopping;
    private int _active;
    private long _durableGeneration, _nextGeneration;
    private long _lifecycleEpoch;
    private ConsentStorageHealth _health = ConsentStorageHealth.Starting;
    private Exception? _failure;
    private bool _durableFence;

    internal ConsentPersistenceCoordinator(IConsentPersistence persistence, object gate,
        Action<ConsentSnapshot> hydrateLocked, Func<string, StoredConsent?> currentLocked,
        int denialCooldownSeconds, Func<ConsentReservation, bool> commitLocked)
    {
        _persistence = persistence; _gate = gate; _hydrateLocked = hydrateLocked; _currentLocked = currentLocked;
        _denialCooldownSeconds = denialCooldownSeconds; _commitLocked = commitLocked;
    }

    internal ConsentStorageHealth Health { get { lock (_gate) return _health; } }
    internal int OutstandingReservations { get { lock (_gate) return _active; } }
    internal long CurrentOriginSequenceLocked(string origin) => _sequences.TryGetValue(origin, out var value) ? value : 0;
    internal long CurrentLifecycleEpochLocked => _lifecycleEpoch;
    internal bool IsCanonicalOrigin(string origin) => CanonicalOrigin(origin);

    internal async ValueTask InitializeAsync(CancellationToken cancellationToken = default)
    {
        long epoch;
        lock (_gate)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(ConsentPersistenceCoordinator));
            if (_initialized || _workerStopping || _health != ConsentStorageHealth.Starting) return;
            _initialized = true;
            epoch = _lifecycleEpoch;
        }
        ConsentOpenResult opened;
        try { opened = await _persistence.OpenSessionAsync(cancellationToken).ConfigureAwait(false); }
        catch
        {
            lock (_gate)
            {
                if (epoch == _lifecycleEpoch && !_disposed && !_workerStopping && _health == ConsentStorageHealth.Starting)
                    _health = ConsentStorageHealth.Unavailable;
            }
            return;
        }
        lock (_gate)
        {
            if (epoch != _lifecycleEpoch || _disposed || _workerStopping || _health != ConsentStorageHealth.Starting) return;
            if (opened.Health != ConsentStorageHealth.Ready || opened.Snapshot is null || !opened.DurableActiveFence)
            { _health = ConsentStorageHealth.Unavailable; return; }
            _durableFence = true;
            _durableGeneration = opened.Snapshot.Generation; _nextGeneration = _durableGeneration;
            _desired.Clear();
            foreach (var record in opened.Snapshot.Records) _desired[record.Origin] = record;
            _hydrateLocked(opened.Snapshot);
            _health = ConsentStorageHealth.Ready;
            _worker = Task.Run(() => WorkerLoop(epoch));
        }
    }

    internal ConsentReservation ReserveLocked(string origin, ConsentDecision? decision, bool managed, DateTimeOffset now)
    {
        if (_health != ConsentStorageHealth.Ready || _workerStopping || _failure is not null)
            return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked());
        if (!CanonicalOrigin(origin))
            return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked());
        var existed = _desired.ContainsKey(origin);
        if (_active >= MaxReservations || (!existed && decision is not null && _desired.Count >= MaxRecords))
        {
            if (decision is not ConsentDecision.Granted) MarkUnavailableLocked();
            return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked());
        }
        if (_nextGeneration == long.MaxValue) { MarkUnavailableLocked(); return ConsentReservation.Rejected(origin, decision, managed, _durableGeneration, HasFenceLocked()); }
        var generation = ++_nextGeneration;
        var sequence = _sequences.TryGetValue(origin, out var old) ? checked(old + 1) : 1;
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
        _pending.Add(reservation); _active++;
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
            _sequences[reservation.Origin] = CurrentOriginSequenceLocked(reservation.Origin) + 1;
            _desired.Remove(reservation.Origin);
            if (_active < MaxReservations && _nextGeneration != long.MaxValue)
            {
                var compensation = new ConsentReservation(reservation.Origin, null, false, ++_nextGeneration,
                    _sequences[reservation.Origin], _lifecycleEpoch, null, true, new(TaskCreationOptions.RunContinuationsAsynchronously));
                _pending.Add(compensation); _active++; _signals.Writer.TryWrite(true);
            }
            else MarkUnavailableLocked();
        }
    }

    internal async ValueTask StopAsync(CancellationToken cancellationToken = default)
    {
        Task? worker;
        lock (_gate)
        {
            if (_disposed || _health == ConsentStorageHealth.Stopped) return;
            _lifecycleEpoch++;
            _health = ConsentStorageHealth.Stopping; _workerStopping = true;
            _signals.Writer.TryComplete(); worker = _worker;
        }
        if (worker is null)
        {
            lock (_gate) _health = ConsentStorageHealth.Unavailable;
            return;
        }
        if (worker is not null)
        {
            try { await worker.WaitAsync(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false); }
            catch { return; }
        }
        lock (_gate)
        {
            if (_failure is not null || _active != 0 || _durableGeneration != _nextGeneration) { _health = ConsentStorageHealth.Unavailable; return; }
        }
        try
        {
            await _persistence.CompleteSessionAsync(_durableGeneration, CancellationToken.None).ConfigureAwait(false);
            lock (_gate) _health = ConsentStorageHealth.Stopped;
        }
        catch { lock (_gate) _health = ConsentStorageHealth.Unavailable; }
    }

    internal ValueTask<ConsentResetResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ConsentResetResult(false, "consent-reset-unsupported"));
    }

    public async ValueTask DisposeAsync()
    {
        Task? worker;
        lock (_gate)
        {
            if (_disposed) return;
            _lifecycleEpoch++;
            _disposed = true; _workerStopping = true; _health = ConsentStorageHealth.Stopped;
            _signals.Writer.TryComplete(); worker = _worker;
        }
        if (worker is not null) { try { await worker.ConfigureAwait(false); } catch { } }
        await _persistence.DisposeAsync().ConfigureAwait(false);
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
                while (_pending.Count > 0)
                {
                    var pending = _pending[0];
                    _pending.RemoveAt(0);
                    CompleteLocked(pending, new(FailureOutcome(pending), _durableGeneration));
                }
            }
        }
    }

    private bool DesiredEquals(string origin, StoredConsent? record) =>
        (!_desired.TryGetValue(origin, out var current) && record is null) ||
        (_desired.TryGetValue(origin, out current) && record is not null && current == record);

    private void CompleteLocked(ConsentReservation reservation, ConsentMutationResult result)
    {
        if (reservation.Completed) return;
        reservation.Completed = true; _active = Math.Max(0, _active - 1); reservation.Completion.TrySetResult(result);
    }

    private ConsentMutationOutcome FailureOutcome(ConsentReservation reservation) =>
        reservation.Decision is not ConsentDecision.Granted && _durableFence
            ? ConsentMutationOutcome.FenceCovered : ConsentMutationOutcome.NotSaved;
    private bool HasFenceLocked() => _durableFence;
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
