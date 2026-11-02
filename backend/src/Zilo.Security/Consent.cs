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

public interface IConsentPersistence
{
    ConsentPersistenceRecord? Load(string exactOrigin);
    void Save(string exactOrigin, ConsentPersistenceRecord record);
}

public sealed record ConsentPersistenceRecord(string State, bool Managed, int DenialStreak, DateTimeOffset CooldownUntil, DateTimeOffset LastDenied = default);

public sealed class ConsentStore
{
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
    // One monitor for consent mutations and the bound TokenService. Lock order is
    // authorization monitor only; callers must never await while holding it.
    internal object AuthorizationGate => _gate;

    public ConsentStore(ConsentOptions? options = null, IClock? clock = null, INativeConsentPrompt? nativeConsent = null, IConsentPersistence? persistence = null)
    {
        _options = options ?? new();
        if (_options.PromptTimeoutSeconds is <= 0 or > 4_294_966 || _options.PerOriginPromptsPerHour <= 0 ||
            _options.GlobalPromptsPerHour <= 0 || _options.DenialCooldownSeconds is <= 0 or > 86400)
            throw new ArgumentOutOfRangeException(nameof(options));
        _clock = clock ?? new SystemClock();
        _nativeConsent = nativeConsent;
        _persistence = persistence;
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
            if (!_entries.TryGetValue(origin, out var entry))
            {
                var saved = _persistence?.Load(origin);
                return saved is null ? false : saved.State == "granted";
            }
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

    public async ValueTask<ConsentResult> RequestAsync(string origin, CancellationToken cancellationToken = default)
    {
        Entry entry;
        long promptId = 0;
        lock (_gate)
        {
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
                if (existingForOrigin.State == "denied" && existingForOrigin.CooldownUntil > now) return new(StatusReadOnly(origin), 403, (int)Math.Ceiling((existingForOrigin.CooldownUntil - now).TotalSeconds), "consent-denied");
                if (existingForOrigin.PendingUntil > now) return new(StatusReadOnly(origin), 202);
                if (existingForOrigin.Prompts.Count >= _options.PerOriginPromptsPerHour) return new(StatusReadOnly(origin), 429, 3600, "rate-limited");
            }
            entry = existingForOrigin ?? GetOrCreate(origin);
            entry.State = "pending";
            promptId = ++entry.PromptId;
            entry.PromptGuid = Guid.NewGuid();
            _activePrompt = entry.PromptGuid;
            entry.PromptCancellation = new CancellationTokenSource(TimeSpan.FromSeconds(_options.PromptTimeoutSeconds));
            entry.PendingUntil = now.AddSeconds(_options.PromptTimeoutSeconds);
            entry.Prompts.Enqueue(now);
            _globalPrompts.Enqueue(now);
        }

        if (_nativeConsent is not null) _ = ResolvePromptAsync(origin, promptId, entry.PromptGuid, entry.PromptCancellation!);
        return new(new ConsentStatus(origin, "pending", PollAfterSeconds: 2, PromptExpiresAt: entry.PendingUntil), 202);
    }

    public void Grant(string origin, bool managed = false)
    {
        lock (_gate) { var e = GetOrCreate(origin); CancelPrompt(e); e.State = "granted"; e.Managed = managed; e.PendingUntil = DateTimeOffset.MinValue; e.PromptId++; e.DenialStreak = 0; Save(origin, e); }
    }

    public void Deny(string origin)
    {
        lock (_gate) { var e = GetOrCreate(origin); CancelPrompt(e); ApplyDecision(e, ConsentDecision.Denied, _clock.UtcNow); OriginRemoved?.Invoke(origin); Save(origin, e); }
    }

    public void Block(string origin)
    {
        lock (_gate) { var e = GetOrCreate(origin); CancelPrompt(e); ApplyDecision(e, ConsentDecision.Blocked, _clock.UtcNow); OriginRemoved?.Invoke(origin); Save(origin, e); }
    }

    public void Remove(string origin)
    {
        lock (_gate)
        {
            var e = GetOrCreate(origin); CancelPrompt(e); if (_activePrompt == e.PromptGuid) _activePrompt = null; e.State = "none"; e.Managed = false; e.PendingUntil = DateTimeOffset.MinValue; e.CooldownUntil = DateTimeOffset.MinValue; e.PromptId++; e.DenialStreak = 0; OriginRemoved?.Invoke(origin); Save(origin, e);
        }
    }

    private Entry GetOrCreate(string origin)
    {
        if (_entries.TryGetValue(origin, out var e)) { e.LastTouched = _clock.UtcNow; return e; }
        if (_persistence?.Load(origin) is { } saved)
            e = new Entry { State = saved.State, Managed = saved.Managed, DenialStreak = saved.DenialStreak, CooldownUntil = saved.CooldownUntil, LastDenied = saved.LastDenied };
        else e = new Entry();
        foreach (var stale in _entries.Where(x => x.Value.State == "denied" && _clock.UtcNow - x.Value.LastDenied >= TimeSpan.FromHours(24)).Select(x => x.Key).ToArray()) _entries.Remove(stale);
        e.LastTouched = _clock.UtcNow; _entries[origin] = e; return e;
    }

    private void Save(string origin, Entry entry) => _persistence?.Save(origin, new(entry.State, entry.Managed, entry.DenialStreak, entry.CooldownUntil, entry.LastDenied));

    private ConsentStatus StatusReadOnly(string origin)
    {
        if (_entries.TryGetValue(origin, out var entry)) return StatusForEntry(origin, entry);
        var saved = _persistence?.Load(origin);
        return saved is null ? new(origin, "none") : new(origin, saved.State, saved.Managed, RetryAfterSeconds: saved.State == "denied" ? Math.Max(0, (int)Math.Ceiling((saved.CooldownUntil - _clock.UtcNow).TotalSeconds)) : null, Blocked: saved.State == "blocked");
    }

    private ConsentStatus StatusLocked(string origin)
    {
        var e = GetOrCreate(origin); Expire(e, _clock.UtcNow);
        return StatusForEntry(origin, e);
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

    private void ApplyDecision(Entry e, ConsentDecision decision, DateTimeOffset now)
    {
        e.PendingUntil = DateTimeOffset.MinValue;
        if (decision == ConsentDecision.Granted) { e.State = "granted"; e.Managed = false; e.DenialStreak = 0; return; }
        if (decision == ConsentDecision.Blocked) { e.State = "blocked"; return; }
        if (decision == ConsentDecision.Denied)
        {
            e.DenialStreak = Math.Min(e.DenialStreak + 1, 9);
            var seconds = Math.Min(86400L, (long)_options.DenialCooldownSeconds * (1 << (e.DenialStreak - 1)));
            e.CooldownUntil = now.AddSeconds(seconds); e.LastDenied = now; e.State = "denied";
        }
    }

    private async Task ResolvePromptAsync(string origin, long promptId, Guid promptGuid, CancellationTokenSource cancellation)
    {
        ConsentDecision decision;
        try { decision = await _nativeConsent!.RequestAsync(origin, cancellation.Token).AsTask().WaitAsync(cancellation.Token).ConfigureAwait(false); }
        catch { lock (_gate) { if (_entries.TryGetValue(origin, out var timedOut) && timedOut.PromptId == promptId && timedOut.PromptGuid == promptGuid && ReferenceEquals(timedOut.PromptCancellation, cancellation) && timedOut.State == "pending") { timedOut.State = "none"; if (_activePrompt == promptGuid) _activePrompt = null; timedOut.PromptCancellation?.Dispose(); timedOut.PromptCancellation = null; } } return; }
        lock (_gate)
        {
            if (!_entries.TryGetValue(origin, out var entry) || entry.PromptId != promptId || entry.PromptGuid != promptGuid || _activePrompt != promptGuid || !ReferenceEquals(entry.PromptCancellation, cancellation) || entry.State != "pending" || entry.PendingUntil <= _clock.UtcNow) return;
            ApplyDecision(entry, decision, _clock.UtcNow); Save(origin, entry); _activePrompt = null; entry.PromptCancellation?.Dispose(); entry.PromptCancellation = null;
        }
    }

    private void CancelPrompt(Entry entry)
    {
        if (entry.PromptCancellation is { } cancellation) _ = CancelAndDisposeAsync(cancellation);
        entry.PromptCancellation = null;
        if (_activePrompt == entry.PromptGuid) _activePrompt = null;
    }

    private static async Task CancelAndDisposeAsync(CancellationTokenSource cancellation)
    {
        // CancelAsync dispatches registered native callbacks off the monitor-owning
        // thread. Observe callback faults and dispose only after they have returned.
        try { await cancellation.CancelAsync().ConfigureAwait(false); }
        catch { /* A native cancellation callback must not break revocation. */ }
        finally { cancellation.Dispose(); }
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
        if (e.State == "pending" && e.PendingUntil <= now)
        {
            e.State = "none";
            if (_activePrompt == e.PromptGuid) _activePrompt = null;
            CancelPrompt(e);
        }
        if (e.State == "denied" && e.CooldownUntil <= now) e.State = "none";
        if (e.LastDenied != DateTimeOffset.MinValue && now - e.LastDenied >= TimeSpan.FromHours(24)) e.DenialStreak = 0;
    }

    private void Trim(DateTimeOffset now)
    {
        while (_globalPrompts.Count > 0 && now - _globalPrompts.Peek() >= TimeSpan.FromHours(1)) _globalPrompts.Dequeue();
        foreach (var e in _entries.Values)
        {
            Expire(e, now);
            while (e.Prompts.Count > 0 && now - e.Prompts.Peek() >= TimeSpan.FromHours(1)) e.Prompts.Dequeue();
        }
        foreach (var origin in _entries.Where(pair => pair.Value.State == "none" && pair.Value.Prompts.Count == 0 && pair.Value.DenialStreak == 0).Select(pair => pair.Key).ToArray())
            _entries.Remove(origin);
    }

    private sealed class Entry
    {
        public string State { get; set; } = "none";
        public bool Managed { get; set; }
        public DateTimeOffset PendingUntil { get; set; }
        public DateTimeOffset CooldownUntil { get; set; }
        public int DenialStreak { get; set; }
        public Queue<DateTimeOffset> Prompts { get; } = new();
        public DateTimeOffset LastTouched { get; set; }
        public long PromptId { get; set; }
        public DateTimeOffset LastDenied { get; set; }
        public Guid PromptGuid { get; set; }
        public CancellationTokenSource? PromptCancellation { get; set; }
    }
}
