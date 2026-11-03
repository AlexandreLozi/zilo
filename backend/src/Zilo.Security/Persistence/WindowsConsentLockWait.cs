namespace Zilo.Security.Persistence;

// Startup-only policy; never used for writes or while holding the authorization monitor.
internal sealed class WindowsConsentLockWait(TimeProvider clock, Action<TimeSpan> delay)
{
    internal static readonly TimeSpan Budget = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan Backoff = TimeSpan.FromMilliseconds(50);
    private const int MaxAttempts = 41;
    private readonly long _started = clock.GetTimestamp();
    internal int Attempts { get; private set; }
    internal TimeSpan Elapsed => clock.GetElapsedTime(_started);

    internal bool TryBeginAttempt()
    {
        if (Attempts >= MaxAttempts || (Attempts != 0 && Elapsed >= Budget)) return false;
        Attempts++;
        return true;
    }

    internal bool WaitAfterFailure(int error)
    {
        if (error != 32 || Attempts >= MaxAttempts) return false;
        var remaining = Budget - Elapsed;
        if (remaining <= TimeSpan.Zero) return false;
        delay(remaining < Backoff ? remaining : Backoff);
        return true;
    }
}
