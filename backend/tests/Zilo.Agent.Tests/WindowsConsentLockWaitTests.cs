using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

// These deterministic policy simulations are not native Windows lock/security evidence.
public sealed class WindowsConsentLockWaitTests
{
    [Fact]
    public void Simulation_sharing_failure_allows_short_fixed_backoff_then_success()
    {
        var clock = new SimulatedClock();
        var delays = new List<TimeSpan>();
        var wait = Create(clock, delays);
        Assert.True(wait.TryBeginAttempt());
        Assert.True(wait.WaitAfterFailure(32));
        Assert.True(wait.TryBeginAttempt());
        Assert.True(wait.WaitAfterFailure(32));
        Assert.True(wait.TryBeginAttempt()); // The simulated third open succeeds.
        Assert.Equal(3, wait.Attempts);
        Assert.Equal(new[] { TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(50) }, delays);
        Assert.Equal(TimeSpan.FromMilliseconds(100), wait.Elapsed);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(5)]
    [InlineData(80)]
    [InlineData(183)]
    [InlineData(995)]
    public void Simulation_non_sharing_errors_fail_immediately_without_delay(int error)
    {
        var clock = new SimulatedClock();
        var delays = new List<TimeSpan>();
        var wait = Create(clock, delays);
        Assert.True(wait.TryBeginAttempt());
        Assert.False(wait.WaitAfterFailure(error));
        Assert.Equal(1, wait.Attempts);
        Assert.Empty(delays);
        Assert.Equal(TimeSpan.Zero, wait.Elapsed);
    }

    [Fact]
    public void Simulation_continuous_sharing_failure_exhausts_monotonic_total_budget()
    {
        var clock = new SimulatedClock();
        var delays = new List<TimeSpan>();
        var wait = Create(clock, delays);
        while (wait.TryBeginAttempt())
            if (!wait.WaitAfterFailure(32)) break;
        Assert.Equal(TimeSpan.FromSeconds(2), wait.Elapsed);
        Assert.Equal(40, wait.Attempts);
        Assert.Equal(40, delays.Count);
        Assert.All(delays, delay => Assert.Equal(TimeSpan.FromMilliseconds(50), delay));
        Assert.False(wait.TryBeginAttempt());
        Assert.False(wait.WaitAfterFailure(32));
    }

    [Fact]
    public void Simulation_attempt_guard_bounds_even_a_frozen_clock_and_noop_delay()
    {
        var delays = new List<TimeSpan>();
        var wait = new WindowsConsentLockWait(new SimulatedClock(), delays.Add);
        while (wait.TryBeginAttempt())
            if (!wait.WaitAfterFailure(32)) break;
        Assert.Equal(41, wait.Attempts);
        Assert.Equal(40, delays.Count);
        Assert.False(wait.TryBeginAttempt());
    }

    [Fact]
    public void Simulation_last_delay_is_capped_by_remaining_budget()
    {
        var clock = new SimulatedClock();
        var delays = new List<TimeSpan>();
        var wait = Create(clock, delays);
        Assert.True(wait.TryBeginAttempt());
        clock.Advance(TimeSpan.FromMilliseconds(1975)); // Includes time spent validating/opening.
        Assert.True(wait.WaitAfterFailure(32));
        Assert.Equal(TimeSpan.FromMilliseconds(25), Assert.Single(delays));
        Assert.False(wait.TryBeginAttempt());
    }

    [Fact]
    public void Simulation_slow_attempt_consumes_budget_without_extra_delay_or_attempt()
    {
        var clock = new SimulatedClock();
        var delays = new List<TimeSpan>();
        var wait = Create(clock, delays);
        Assert.True(wait.TryBeginAttempt());
        clock.Advance(TimeSpan.FromSeconds(2));
        Assert.False(wait.WaitAfterFailure(32));
        Assert.False(wait.TryBeginAttempt());
        Assert.Empty(delays);
    }

    [Fact]
    public void Simulation_oversleep_does_not_admit_a_post_budget_attempt()
    {
        var clock = new SimulatedClock();
        var wait = new WindowsConsentLockWait(clock, _ => clock.Advance(TimeSpan.FromSeconds(3)));
        Assert.True(wait.TryBeginAttempt());
        Assert.True(wait.WaitAfterFailure(32));
        Assert.False(wait.TryBeginAttempt());
        Assert.Equal(1, wait.Attempts);
    }

    private static WindowsConsentLockWait Create(SimulatedClock clock, List<TimeSpan> delays) =>
        new(clock, delay => { delays.Add(delay); clock.Advance(delay); });

    private sealed class SimulatedClock : TimeProvider
    {
        private long _timestamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => _timestamp;
        internal void Advance(TimeSpan elapsed) => _timestamp += elapsed.Ticks;
        public override DateTimeOffset GetUtcNow() => throw new InvalidOperationException("wall-clock-use-forbidden");
    }
}
