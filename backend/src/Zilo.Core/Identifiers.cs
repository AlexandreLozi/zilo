using System.Text.RegularExpressions;

namespace Zilo.Core;

/// <summary>An opaque T10 job identity. The agent, not a backend, owns its lifetime.</summary>
public sealed record JobId
{
    private static readonly Regex Format = new("\\A[A-Za-z0-9_-]{16,64}\\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public JobId(string value)
    {
        if (!IsValid(value))
        {
            throw new ArgumentException("A JobId must contain 16 to 64 URL-safe characters.", nameof(value));
        }

        Value = value;
    }

    public string Value { get; }

    public static JobId Parse(string value) => new(value);

    public static bool TryParse(string? value, out JobId? jobId)
    {
        if (value is not null && IsValid(value))
        {
            jobId = new JobId(value);
            return true;
        }

        jobId = null;
        return false;
    }

    public override string ToString() => Value;

    private static bool IsValid(string? value) => value is not null && Format.IsMatch(value);
}

/// <summary>The opaque stable route identifier of one device/driver path.</summary>
public sealed record RouteId
{
    private static readonly Regex Format = new("\\A[A-Za-z0-9._~-]{1,128}\\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public RouteId(string value)
    {
        if (value is null || !Format.IsMatch(value))
        {
            throw new ArgumentException("A route ID must contain 1 to 128 URL-safe characters.", nameof(value));
        }

        Value = value;
    }

    public string Value { get; }

    public override string ToString() => Value;
}
