using System.Globalization;
using System.Net;
using System.Net.Sockets;

namespace Zilo.Security;

public enum OriginClass { Absent, Ineligible, DevEligible, Eligible, Allowed }

public sealed record OriginEvaluation(string? Origin, OriginClass Class, bool IsMalformed = false);

public sealed class OriginPolicy
{
    private readonly bool _devMode;
    private readonly HashSet<string> _baked;

    public OriginPolicy(bool devMode, IEnumerable<string>? bakedOrigins)
    {
        _devMode = devMode;
        _baked = new(StringComparer.Ordinal);
        foreach (var origin in bakedOrigins ?? Array.Empty<string>())
        {
            var parsed = Parse(origin);
            if (parsed is not null && IsEligibleHost(parsed.Value.Host) && parsed.Value.Scheme == "https")
                _baked.Add(parsed.Value.Serialized);
        }
    }

    public IReadOnlySet<string> BakedOrigins => _baked;

    public OriginEvaluation Evaluate(string? value, Func<string, bool>? isGranted = null)
    {
        if (string.IsNullOrEmpty(value)) return new(null, OriginClass.Absent);
        var parsed = Parse(value);
        if (parsed is null) return new(value, OriginClass.Ineligible, true);
        if (IsLoopback(parsed.Value.Host))
            return new(parsed.Value.Serialized, _devMode && (parsed.Value.Scheme is "http" or "https")
                ? OriginClass.DevEligible : OriginClass.Ineligible);
        if (parsed.Value.Scheme != "https") return new(parsed.Value.Serialized, OriginClass.Ineligible);
        if (isGranted?.Invoke(parsed.Value.Serialized) == true || _baked.Contains(parsed.Value.Serialized))
            return new(parsed.Value.Serialized, OriginClass.Allowed);
        return new(parsed.Value.Serialized, OriginClass.Eligible);
    }

    public bool IsBaked(string origin) => _baked.Contains(origin);

    public static bool IsEligibleHost(string host) => !IsLoopback(host) && !HasMalformedLabels(host);

    private static bool IsLoopback(string host)
    {
        var classificationHost = host.EndsWith('.') && !host.EndsWith("..", StringComparison.Ordinal)
            ? host[..^1] : host;
        if (HasMalformedLabels(host)) return false;
        if (classificationHost.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
            classificationHost.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (!IPAddress.TryParse(classificationHost, out var ip)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
            return ip.Equals(IPAddress.Any) || ip.GetAddressBytes()[0] == 127;
        if (ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.IPv6Loopback)) return true;
        return ip.IsIPv4MappedToIPv6 && IsLoopback(ip.MapToIPv4().ToString());
    }

    private static bool HasMalformedLabels(string host)
    {
        if (IPAddress.TryParse(host, out _)) return false;
        return host.StartsWith('.') || host.Contains("..", StringComparison.Ordinal) ||
            host.EndsWith("..", StringComparison.Ordinal);
    }

    private static ParsedOrigin? Parse(string value)
    {
        if (value.Contains('\r') || value.Contains('\n') || value != value.Trim()) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.UserInfo.Length != 0 ||
            uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) ||
            string.IsNullOrEmpty(uri.Host) || HasMalformedLabels(uri.DnsSafeHost)) return null;
        var host = uri.DnsSafeHost;
        if (IPAddress.TryParse(host, out var ip))
            host = ip.AddressFamily == AddressFamily.InterNetworkV6 ? $"[{ip}]" : ip.ToString();
        else
            host = new IdnMapping().GetAscii(host).ToLowerInvariant();
        var scheme = uri.Scheme.ToLowerInvariant();
        if (scheme is not ("http" or "https")) return null;
        var port = uri.IsDefaultPort ? "" : $":{uri.Port}";
        return new ParsedOrigin($"{scheme}://{host}{port}", host.Trim('[', ']'), scheme);
    }

    private readonly record struct ParsedOrigin(string Serialized, string Host, string Scheme);
}
