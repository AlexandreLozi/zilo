namespace Zilo.Agent.Tests;

// Deterministic clock/timers, no package and no scheduling-delay assertions.
internal sealed class ManualTime : TimeProvider
{
    private readonly object _gate = new();
    private readonly List<Timer> _timers = [];
    private readonly SemaphoreSlim _changed = new(0);
    private DateTimeOffset _now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
    public override DateTimeOffset GetUtcNow() { lock (_gate) return _now; }
    public override long GetTimestamp() => GetUtcNow().Ticks;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new Timer(this, callback, state);
        lock (_gate) _timers.Add(timer);
        timer.Change(dueTime, period);
        return timer;
    }

    public async Task WaitForTimer(TimeSpan dueTime, CancellationToken cancellationToken)
    {
        while (true)
        {
            lock (_gate) if (_timers.Any(timer => timer.Due == _now + dueTime)) return;
            await _changed.WaitAsync(cancellationToken);
        }
    }

    public void Advance(TimeSpan amount)
    {
        List<(TimerCallback Callback, object? State)> callbacks = [];
        lock (_gate)
        {
            _now += amount;
            foreach (var timer in _timers.ToArray())
            {
                if (timer.Due > _now) continue;
                callbacks.Add((timer.Callback, timer.State));
                timer.Due = timer.Period > TimeSpan.Zero ? _now + timer.Period : DateTimeOffset.MaxValue;
            }
        }
        foreach (var (callback, state) in callbacks) callback(state);
    }

    private sealed class Timer(ManualTime owner, TimerCallback callback, object? state) : ITimer
    {
        public TimerCallback Callback { get; } = callback;
        public object? State { get; } = state;
        public DateTimeOffset Due { get; set; } = DateTimeOffset.MaxValue;
        public TimeSpan Period { get; private set; }
        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            lock (owner._gate) { Due = dueTime == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : owner._now + dueTime; Period = period; }
            owner._changed.Release();
            return true;
        }
        public void Dispose() { lock (owner._gate) owner._timers.Remove(this); }
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
}
