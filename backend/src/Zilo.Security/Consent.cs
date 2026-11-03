using Zilo.Security.Persistence;

namespace Zilo.Security;

public enum ConsentDecision { Pending, Granted, Denied, Blocked }

public interface INativeConsentPrompt
{
    ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default);
}

public sealed record ConsentOptions(
    int PromptTimeoutSeconds = 120,
    int PerOriginPromptsPerHour = 3,
    int GlobalPromptsPerHour = 10,
    int DenialCooldownSeconds = 600);

public sealed record ConsentStatus(string Origin, string State, bool? Managed = null,
    int? PollAfterSeconds = null, DateTimeOffset? PromptExpiresAt = null,
    int? RetryAfterSeconds = null, bool? Blocked = null);

public sealed record ConsentResult(ConsentStatus Status, int HttpStatus = 200, int? RetryAfterSeconds = null,
    string? ProblemCode = null);

public sealed class ConsentStore : IAsyncDisposable
{
    internal const int MaxEntries = ConsentPersistenceCoordinator.MaxRecords + ConsentPersistenceCoordinator.MaxReservations;
    public event Action<string>? OriginRemoved;
    private readonly ConsentOptions _options;
    private readonly IClock _clock;
    private readonly INativeConsentPrompt? _nativeConsent;
    private readonly IConsentPersistence? _persistence;
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _polls = new(StringComparer.Ordinal);
    private readonly Queue<DateTimeOffset> _globalPrompts = new();
    private Guid? _activePrompt;
    private readonly object _gate = new();
    private readonly ConsentPersistenceCoordinator? _coordinator;
    private readonly Func<Task>? _beforeNativeDecisionCommit;
    private readonly TimeProvider _promptTimeProvider;

    internal object AuthorizationGate => _gate;
    internal ConsentPersistenceCoordinator? PersistenceCoordinator => _coordinator;
    internal Task? NativePromptResolution { get; private set; }
    internal Task? NativePromptRetirement { get; private set; }

    public ConsentStore(ConsentOptions? options = null, IClock? clock = null,
        INativeConsentPrompt? nativeConsent = null, IConsentPersistence? persistence = null)
        : this(options, clock, nativeConsent, persistence, null) { }

    internal ConsentStore(ConsentOptions? options, IClock? clock, INativeConsentPrompt? nativeConsent,
        IConsentPersistence? persistence, Func<Task>? beforeNativeDecisionCommit,
        TimeProvider? shutdownTimeProvider = null, TimeProvider? promptTimeProvider = null)
    {
        _beforeNativeDecisionCommit = beforeNativeDecisionCommit;
        _promptTimeProvider = promptTimeProvider ?? TimeProvider.System;
        _options = options ?? new();
        if (_options.PromptTimeoutSeconds is <= 0 or > 4_294_966 || _options.PerOriginPromptsPerHour <= 0 ||
            _options.GlobalPromptsPerHour <= 0 || _options.DenialCooldownSeconds is <= 0 or > 86400)
            throw new ArgumentOutOfRangeException(nameof(options));
        _clock = clock ?? new SystemClock();
        _nativeConsent = nativeConsent;
        _persistence = persistence;
        if (persistence is not null)
            _coordinator = new ConsentPersistenceCoordinator(persistence, _gate, HydrateLocked,
                CurrentRecordLocked, _options.DenialCooldownSeconds, CommitLocked,
                origin => _entries.ContainsKey(origin), origin => PruneEntryLocked(origin, _clock.UtcNow),
                shutdownTimeProvider);
    }

    public ValueTask<ConsentStatus> GetAsync(string origin, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate) return ValueTask.FromResult(StatusReadOnly(origin));
    }

    public bool IsGranted(string origin)
    {
        lock (_gate)
        {
            if (_coordinator is not null && _coordinator.Health != ConsentStorageHealth.Ready) return false;
            if (!_entries.TryGetValue(origin, out var entry)) return false;
            Expire(entry, _clock.UtcNow);
            return entry.State == "granted";
        }
    }

    public ValueTask<ConsentResult> GetResultAsync(string origin, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var now = _clock.UtcNow;
            var existed = _polls.TryGetValue(origin, out var queue);
            if (!existed && _polls.Count >= 256)
            {
                var oldest = _polls.OrderBy(x => x.Value.Count == 0 ? DateTimeOffset.MinValue : x.Value.Peek()).First().Key;
                _polls.Remove(oldest);
            }
            var polls = existed ? queue! : (_polls[origin] = new());
            while (polls.Count > 0 && now - polls.Peek() >= TimeSpan.FromSeconds(1)) polls.Dequeue();
            if (polls.Count >= 2) return ValueTask.FromResult(new ConsentResult(StatusReadOnly(origin), 429, 1, "rate-limited"));
            polls.Enqueue(now);
            return ValueTask.FromResult(new ConsentResult(StatusReadOnly(origin)));
        }
    }

    public int? PollRetryAfter(string origin)
    {
        lock (_gate)
        {
            var now = _clock.UtcNow;
            return _polls.TryGetValue(origin, out var queue) && queue.Count(at => now - at < TimeSpan.FromSeconds(1)) >= 2 ? 1 : null;
        }
    }

    public int? PromptRetryAfter(string origin)
    {
        lock (_gate)
        {
            var now = _clock.UtcNow;
            ExpireActivePrompt(now);
            Trim(now);
            _entries.TryGetValue(origin, out var entry);
            if (_activePrompt is not null && (entry is null || entry.PromptGuid != _activePrompt)) return 1;
            if (_globalPrompts.Count >= _options.GlobalPromptsPerHour) return 3600;
            if (entry is not null && entry.State == "none" && entry.Prompts.Count >= _options.PerOriginPromptsPerHour) return 3600;
            return null;
        }
    }

    public async ValueTask<ConsentResult> RequestAsync(string origin, CancellationToken cancellationToken = default)
    {
        Entry entry;
        long promptId;
        Guid promptGuid;
        PromptCancellationOwner promptCancellation;
        long lifecycleEpoch;
        lock (_gate)
        {
            if (_coordinator is { Health: not ConsentStorageHealth.Ready })
                return new(StatusReadOnly(origin), 503, ProblemCode: "consent-storage-unavailable");
            if (_coordinator is not null && !_coordinator.IsCanonicalOrigin(origin))
                return new(new(origin, "none"), 403, ProblemCode: "consent-denied");
            var now = _clock.UtcNow;
            ExpireActivePrompt(now);
            Trim(now);
            _entries.TryGetValue(origin, out var existingForOrigin);
            if (_activePrompt is not null && (existingForOrigin is null || existingForOrigin.PromptGuid != _activePrompt))
                return new(StatusReadOnly(origin), 429, 1, "rate-limited");
            if (_globalPrompts.Count >= _options.GlobalPromptsPerHour)
                return new(StatusReadOnly(origin), 429, 3600, "rate-limited");
            if (existingForOrigin is not null)
            {
                Expire(existingForOrigin, now);
                if (existingForOrigin.State == "granted") return new(StatusReadOnly(origin));
                if (existingForOrigin.State == "blocked") return new(StatusReadOnly(origin), 403, ProblemCode: "consent-denied");
                if (existingForOrigin.State == "denied" && existingForOrigin.CooldownUntil > now)
                    return new(StatusReadOnly(origin), 403, (int)Math.Ceiling((existingForOrigin.CooldownUntil - now).TotalSeconds), "consent-denied");
                if (existingForOrigin.PendingUntil > now) return new(StatusReadOnly(origin), 202);
                if (existingForOrigin.Prompts.Count >= _options.PerOriginPromptsPerHour)
                    return new(StatusReadOnly(origin), 429, 3600, "rate-limited");
            }
            if (existingForOrigin is null && _coordinator is not null && !CanAddEntryLocked(now))
                return new(StatusReadOnly(origin), 429, 1, "rate-limited");
            entry = existingForOrigin ?? GetOrCreate(origin);
            entry.State = "pending";
            promptId = ++entry.PromptId;
            promptGuid = entry.PromptGuid = Guid.NewGuid();
            _activePrompt = entry.PromptGuid;
            promptCancellation = entry.PromptCancellation = new PromptCancellationOwner(
                _nativeConsent is not null, TimeSpan.FromSeconds(_options.PromptTimeoutSeconds), _promptTimeProvider);
            NativePromptRetirement = promptCancellation.Retirement;
            lifecycleEpoch = _coordinator?.CurrentLifecycleEpochLocked ?? 0;
            entry.PendingUntil = now.AddSeconds(_options.PromptTimeoutSeconds);
            entry.Prompts.Enqueue(now);
            _globalPrompts.Enqueue(now);
        }

        if (_nativeConsent is not null)
            NativePromptResolution = ResolvePromptAsync(origin, promptId, promptGuid, promptCancellation, lifecycleEpoch);
        return new(new ConsentStatus(origin, "pending", PollAfterSeconds: 2, PromptExpiresAt: entry.PendingUntil), 202);
    }

    public void Grant(string origin, bool managed = false)
    {
        lock (_gate)
        {
            RequireInMemory();
            var e = GetOrCreate(origin); CancelPrompt(e); e.State = "granted"; e.Managed = managed;
            e.PendingUntil = DateTimeOffset.MinValue; e.PromptId++; e.DenialStreak = 0;
        }
    }

    public void Deny(string origin)
    {
        lock (_gate)
        {
            RequireInMemory();
            var e = GetOrCreate(origin); CancelPrompt(e); ApplyDecision(e, ConsentDecision.Denied, _clock.UtcNow);
            OriginRemoved?.Invoke(origin);
        }
    }

    public void Block(string origin)
    {
        lock (_gate)
        {
            RequireInMemory();
            var e = GetOrCreate(origin); CancelPrompt(e); ApplyDecision(e, ConsentDecision.Blocked, _clock.UtcNow);
            OriginRemoved?.Invoke(origin);
        }
    }

    public void Remove(string origin)
    {
        lock (_gate)
        {
            RequireInMemory();
            var e = GetOrCreate(origin); CancelPrompt(e); ClearEntry(e);
            OriginRemoved?.Invoke(origin);
        }
    }

    public ValueTask<ConsentMutationResult> GrantAsync(string origin, bool managed = false,
        CancellationToken cancellationToken = default) => MutateAsync(origin, ConsentDecision.Granted, managed, cancellationToken);

    public ValueTask<ConsentMutationResult> DenyAsync(string origin, CancellationToken cancellationToken = default) =>
        MutateAsync(origin, ConsentDecision.Denied, false, cancellationToken);

    public ValueTask<ConsentMutationResult> BlockAsync(string origin, CancellationToken cancellationToken = default) =>
        MutateAsync(origin, ConsentDecision.Blocked, false, cancellationToken);

    public ValueTask<ConsentMutationResult> RemoveAsync(string origin, CancellationToken cancellationToken = default) =>
        MutateAsync(origin, null, false, cancellationToken);

    private async ValueTask<ConsentMutationResult> MutateAsync(string origin, ConsentDecision? decision, bool managed, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ConsentReservation? reservation;
        lock (_gate)
        {
            if (_coordinator is not null && !_coordinator.IsCanonicalOrigin(origin))
                return new(ConsentMutationOutcome.Rejected, 0);
            reservation = ApplyMutationLocked(origin, decision, managed, _clock.UtcNow);
        }
        return reservation is null ? new(ConsentMutationOutcome.Durable, 0)
            : await _coordinator!.ObserveAsync(reservation, cancellationToken).ConfigureAwait(false);
    }

    private ConsentReservation? ApplyMutationLocked(string origin, ConsentDecision? decision, bool managed, DateTimeOffset now)
    {
        if (_coordinator is null)
        {
            ApplyMemoryMutationLocked(GetOrCreate(origin), origin, decision, managed, now);
            return null;
        }
        // Rejected postseal intent must not mutate metadata or reuse the old dirty-fence proof.
        if (_coordinator.AdmissionSealedLocked)
            return _coordinator.ReserveLocked(origin, decision, managed, now);
        _entries.TryGetValue(origin, out var entry);
        if (entry is null)
        {
            if (decision is null)
            {
                OriginRemoved?.Invoke(origin);
                return _coordinator.ReserveLocked(origin, decision, managed, now);
            }
            if (!CanAddEntryLocked(now))
            {
                var rejected = _coordinator.RejectCapacityLocked(origin, decision, managed);
                if (decision is not ConsentDecision.Granted) OriginRemoved?.Invoke(origin);
                return rejected;
            }
            var admitted = _coordinator.ReserveLocked(origin, decision, managed, now);
            if (admitted.Accepted) ApplyMemoryMutationLocked(GetOrCreate(origin), origin, decision, managed, now);
            else if (decision is not ConsentDecision.Granted) OriginRemoved?.Invoke(origin);
            return admitted;
        }
        if (decision == ConsentDecision.Granted)
        {
            var admitted = _coordinator.ReserveLocked(origin, decision, managed, now);
            if (admitted.Accepted) ApplyMemoryMutationLocked(entry, origin, decision, managed, now);
            return admitted;
        }
        ApplyMemoryMutationLocked(entry, origin, decision, managed, now);
        return _coordinator.ReserveLocked(origin, decision, managed, now);
    }

    private void ApplyMemoryMutationLocked(Entry entry, string origin, ConsentDecision? decision, bool managed, DateTimeOffset now)
    {
        CancelPrompt(entry);
        if (_coordinator is not null && decision == ConsentDecision.Granted)
        {
            if (entry.State == "pending") entry.State = "none";
        }
        else if (decision is null) ClearEntry(entry);
        else ApplyDecision(entry, decision.Value, now, managed);
        if (decision is not ConsentDecision.Granted) OriginRemoved?.Invoke(origin);
    }

    private void RequireInMemory()
    {
        if (_persistence is not null) throw new InvalidOperationException("consent-persistence-bound-use-async-api");
    }

    private ConsentStatus StatusReadOnly(string origin)
    {
        if (_coordinator is not null && _coordinator.Health != ConsentStorageHealth.Ready)
            return new(origin, "none");
        return _entries.TryGetValue(origin, out var entry) ? StatusForEntry(origin, entry) : new(origin, "none");
    }

    private ConsentStatus StatusForEntry(string origin, Entry e)
    {
        Expire(e, _clock.UtcNow);
        return e.State switch
        {
            "pending" => new(origin, "pending", PollAfterSeconds: 2, PromptExpiresAt: e.PendingUntil),
            "granted" => new(origin, "granted", Managed: e.Managed),
            "denied" => new(origin, "denied", RetryAfterSeconds: Math.Max(0, (int)Math.Ceiling((e.CooldownUntil - _clock.UtcNow).TotalSeconds))),
            "blocked" => new(origin, "blocked", Blocked: true),
            _ => new(origin, "none")
        };
    }

    private Entry GetOrCreate(string origin)
    {
        if (_entries.TryGetValue(origin, out var e)) { e.LastTouched = _clock.UtcNow; return e; }
        if (_coordinator is null)
            foreach (var stale in _entries.Where(x => x.Value.State == "denied" && _clock.UtcNow - x.Value.LastDenied >= TimeSpan.FromHours(24)).Select(x => x.Key).ToArray()) _entries.Remove(stale);
        e = new Entry { LastTouched = _clock.UtcNow }; _entries[origin] = e; return e;
    }

    private bool CanAddEntryLocked(DateTimeOffset now)
    {
        if (_entries.Count < MaxEntries) return true;
        foreach (var origin in _entries.Keys.ToArray()) PruneEntryLocked(origin, now);
        return _entries.Count < MaxEntries;
    }

    private void PruneEntryLocked(string origin, DateTimeOffset now)
    {
        if (_coordinator is null || !_entries.TryGetValue(origin, out var entry)) return;
        while (entry.Prompts.Count > 0 && now - entry.Prompts.Peek() >= TimeSpan.FromHours(1)) entry.Prompts.Dequeue();
        if (entry.State != "none" || entry.PromptCancellation is not null || entry.Prompts.Count != 0 ||
            (entry.LastDenied != default && now - entry.LastDenied < TimeSpan.FromHours(24)) ||
            _coordinator.HasDesiredOrOwnedLocked(origin)) return;
        _entries.Remove(origin);
        _coordinator.PruneSequenceLocked(origin);
    }

    private StoredConsent? CurrentRecordLocked(string origin)
    {
        if (!_entries.TryGetValue(origin, out var e) || e.State == "none") return null;
        return new StoredConsent(origin, e.State, false, e.LastTouched == default ? _clock.UtcNow : e.LastTouched,
            e.State == "denied" ? e.CooldownUntil : null, e.State == "denied" ? e.LastDenied : null);
    }

    private void HydrateLocked(ConsentSnapshot snapshot)
    {
        _entries.Clear();
        foreach (var record in snapshot.Records)
        {
            var e = new Entry { State = record.State, Managed = false, LastTouched = record.UpdatedAt,
                CooldownUntil = record.CooldownUntil ?? DateTimeOffset.MinValue,
                LastDenied = record.LastDenied ?? DateTimeOffset.MinValue };
            _entries[record.Origin] = e;
        }
    }

    private bool CommitLocked(ConsentReservation reservation)
    {
        if (reservation.Decision != ConsentDecision.Granted) return true;
        if (reservation.OriginSequence != _coordinator!.CurrentOriginSequenceLocked(reservation.Origin)) return false;
        if (!_entries.TryGetValue(reservation.Origin, out var e))
        {
            if (_coordinator is not null && !CanAddEntryLocked(_clock.UtcNow)) return false;
            e = GetOrCreate(reservation.Origin);
        }
        e.State = "granted"; e.Managed = reservation.Managed; e.PendingUntil = DateTimeOffset.MinValue;
        e.DenialStreak = 0; e.LastTouched = _clock.UtcNow;
        return true;
    }

    private void ApplyDecision(Entry e, ConsentDecision decision, DateTimeOffset now, bool managed = false)
    {
        e.PendingUntil = DateTimeOffset.MinValue;
        if (decision == ConsentDecision.Granted) { e.State = "granted"; e.Managed = managed; e.DenialStreak = 0; return; }
        if (decision == ConsentDecision.Blocked) { e.State = "blocked"; e.Managed = false; return; }
        e.DenialStreak = Math.Min(e.DenialStreak + 1, 9);
        var seconds = Math.Min(86400L, (long)_options.DenialCooldownSeconds * (1 << (e.DenialStreak - 1)));
        e.CooldownUntil = now.AddSeconds(seconds); e.LastDenied = now; e.State = "denied"; e.Managed = false;
    }

    private static void ClearEntry(Entry e)
    {
        e.State = "none"; e.Managed = false; e.PendingUntil = DateTimeOffset.MinValue;
        e.CooldownUntil = DateTimeOffset.MinValue; e.PromptId++; e.DenialStreak = 0;
    }

    private async Task ResolvePromptAsync(string origin, long promptId, Guid promptGuid,
        PromptCancellationOwner cancellation, long lifecycleEpoch)
    {
        try
        {
            ConsentDecision decision;
            try { decision = await _nativeConsent!.RequestAsync(origin, cancellation.Token).AsTask().WaitAsync(cancellation.Token).ConfigureAwait(false); }
            catch
            {
                lock (_gate)
                {
                    if (TryGetCurrentPromptLocked(origin, promptId, promptGuid, cancellation, lifecycleEpoch, out var timedOut))
                    {
                        timedOut!.State = "none";
                        _activePrompt = null;
                        timedOut.PromptCancellation = null;
                    }
                }
                return;
            }

            if (_beforeNativeDecisionCommit is not null) await _beforeNativeDecisionCommit().ConfigureAwait(false);
            ConsentReservation? reservation = null;
            lock (_gate)
            {
                if (!TryGetCurrentPromptLocked(origin, promptId, promptGuid, cancellation, lifecycleEpoch, out var entry)) return;
                var now = _clock.UtcNow;
                _activePrompt = null;
                entry!.PromptCancellation = null;
                if (entry.PendingUntil <= now) { entry.State = "none"; return; }
                if (decision is ConsentDecision.Granted or ConsentDecision.Denied or ConsentDecision.Blocked)
                {
                    if (_coordinator is not null && !_coordinator.IsCanonicalOrigin(origin)) return;
                    reservation = ApplyMutationLocked(origin, decision, false, now);
                }
                else entry.State = "none";
            }
            if (reservation is not null) await _coordinator!.ObserveAsync(reservation).ConfigureAwait(false);
        }
        finally
        {
            lock (_gate)
            {
                if (_entries.TryGetValue(origin, out var entry) && ReferenceEquals(entry.PromptCancellation, cancellation))
                {
                    entry.PromptCancellation = null;
                    if (_activePrompt == promptGuid) _activePrompt = null;
                }
            }
            cancellation.FinishResolution();
        }
    }

    private bool TryGetCurrentPromptLocked(string origin, long promptId, Guid promptGuid,
        PromptCancellationOwner cancellation, long lifecycleEpoch, out Entry? entry)
    {
        return _entries.TryGetValue(origin, out entry) &&
            (_coordinator is null || (_coordinator.Health == ConsentStorageHealth.Ready &&
                _coordinator.CurrentLifecycleEpochLocked == lifecycleEpoch)) &&
            entry.PromptId == promptId && entry.PromptGuid == promptGuid && _activePrompt == promptGuid &&
            ReferenceEquals(entry.PromptCancellation, cancellation) && entry.State == "pending";
    }

    private void CancelPrompt(Entry entry)
    {
        // Reserve cancellation before releasing authorization; execution is always off-stack.
        entry.PromptCancellation?.RequestCancellation();
        entry.PromptCancellation = null;
        if (_activePrompt == entry.PromptGuid) _activePrompt = null;
    }

    private void ExpireActivePrompt(DateTimeOffset now)
    {
        if (_activePrompt is null) return;
        var owner = _entries.Values.FirstOrDefault(e => e.PromptGuid == _activePrompt.Value);
        if (owner is null) { _activePrompt = null; return; }
        Expire(owner, now);
    }

    private void Expire(Entry e, DateTimeOffset now)
    {
        if (e.State == "pending" && e.PendingUntil <= now) { e.State = "none"; if (_activePrompt == e.PromptGuid) _activePrompt = null; CancelPrompt(e); }
        if (e.State == "denied" && e.CooldownUntil <= now) e.State = "none";
        if (e.LastDenied != DateTimeOffset.MinValue && now - e.LastDenied >= TimeSpan.FromHours(24)) e.DenialStreak = 0;
    }

    private void Trim(DateTimeOffset now)
    {
        while (_globalPrompts.Count > 0 && now - _globalPrompts.Peek() >= TimeSpan.FromHours(1)) _globalPrompts.Dequeue();
        foreach (var e in _entries.Values) { Expire(e, now); while (e.Prompts.Count > 0 && now - e.Prompts.Peek() >= TimeSpan.FromHours(1)) e.Prompts.Dequeue(); }
        if (_coordinator is null)
            foreach (var origin in _entries.Where(pair => pair.Value.State == "none" && pair.Value.Prompts.Count == 0 && pair.Value.DenialStreak == 0).Select(pair => pair.Key).ToArray()) _entries.Remove(origin);
        else
            foreach (var origin in _entries.Keys.ToArray()) PruneEntryLocked(origin, now);
    }

    public async ValueTask DisposeAsync()
    {
        if (_coordinator is not null) await _coordinator.DisposeAsync().ConfigureAwait(false);
    }

    internal sealed class PromptCancellationOwner
    {
        private readonly object _gate = new();
        private readonly CancellationTokenSource _source = new();
        private readonly ITimer _timer;
        private readonly bool _hasResolver;
        private readonly TaskCompletionSource _retirement = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private bool _resolutionFinished;
        private bool _cancellationReserved;
        private bool _cancellationFinished;
        private bool _retired;

        internal CancellationToken Token { get; }
        internal Task Retirement => _retirement.Task;

        internal PromptCancellationOwner(bool hasResolver, TimeSpan timeout, TimeProvider timeProvider)
        {
            _hasResolver = hasResolver;
            _resolutionFinished = !hasResolver;
            Token = _source.Token;
            _timer = timeProvider.CreateTimer(static state => ((PromptCancellationOwner)state!).RequestCancellation(),
                this, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
            _timer.Change(timeout, Timeout.InfiniteTimeSpan);
        }

        internal void RequestCancellation()
        {
            lock (_gate)
            {
                if (_retired || _cancellationReserved) return;
                _cancellationReserved = true;
            }
            _ = Task.Run(CancelAsync);
        }

        internal void FinishResolution()
        {
            bool retire;
            lock (_gate)
            {
                _resolutionFinished = true;
                retire = TryRetireLocked();
            }
            if (retire) Retire();
        }

        private async Task CancelAsync()
        {
            try { await _source.CancelAsync().ConfigureAwait(false); }
            catch { } // Observe callback failures before allowing source disposal.
            finally
            {
                bool retire;
                lock (_gate)
                {
                    _cancellationFinished = true;
                    retire = TryRetireLocked();
                }
                if (retire) Retire();
            }
        }

        private bool TryRetireLocked()
        {
            // A prompt without a native resolver remains live until cancellation is requested.
            if (_retired || !_resolutionFinished ||
                (_cancellationReserved ? !_cancellationFinished : !_hasResolver)) return false;
            _retired = true;
            return true;
        }

        private void Retire()
        {
            _timer.Dispose();
            _source.Dispose();
            _retirement.TrySetResult();
        }
    }

    private sealed class Entry
    {
        public string State { get; set; } = "none"; public bool Managed { get; set; }
        public DateTimeOffset PendingUntil { get; set; } public DateTimeOffset CooldownUntil { get; set; }
        public int DenialStreak { get; set; } public Queue<DateTimeOffset> Prompts { get; } = new();
        public DateTimeOffset LastTouched { get; set; } public long PromptId { get; set; }
        public DateTimeOffset LastDenied { get; set; } public Guid PromptGuid { get; set; }
        public PromptCancellationOwner? PromptCancellation { get; set; }
    }
}
