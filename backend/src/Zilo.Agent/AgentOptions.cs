using System.Runtime.InteropServices;
using Zilo.Core;
using Zilo.Security;

namespace Zilo.Agent;

public sealed record AgentLimits
{
    public int MaxPagesPerJob { get; init; } = 500;
    public long MaxPixelsPerPage { get; init; } = 150_000_000;
    public int MaxResolutionDpi { get; init; } = 1200;
    public long MaxJobBytes { get; init; } = 2_147_483_648;
    public long MaxStoreBytes { get; init; } = 8_589_934_592;
    public long MaxExportBytes { get; init; } = 1_073_741_824;
    public int MaxJobDurationSeconds { get; init; } = 1800;
    public int PageTimeoutSeconds { get; init; } = 120;
    public int DiscoveryTimeoutSeconds { get; init; } = 15;
    public int MaxActiveJobsPerDevice { get; init; } = 1;
    public int MaxActiveJobsPerOrigin { get; init; } = 2;
    public int MaxJobsPerFamily { get; init; } = 8;
    public int MaxJobRecordsTotal { get; init; } = 256;
    public int MaxFamiliesPerOrigin { get; init; } = 16;
    public int MaxFamiliesTotal { get; init; } = 64;
    public int TokenIssuesPerOriginPerHour { get; init; } = 20;
    public int MaxRetainedAuthRecords { get; init; } = 1024;
    public int MaxEventStreamsPerJob { get; init; } = 4;
    public int MaxEventStreamsTotal { get; init; } = 64;
    public int MaxErrorEventsPerJob { get; init; } = 16;
    public int MaxConcurrentExportsPerFamily { get; init; } = 2;
    public int MaxConcurrentExportsTotal { get; init; } = 4;
    public int MaxRequestBodyBytes { get; init; } = 65_536;
    public int TokenTtlSeconds { get; init; } = 3600;
    public int TokenRenewGraceSeconds { get; init; } = 60;
    public int FamilyMaxSeconds { get; init; } = 86_400;
    public int RevocationCleanupSeconds { get; init; } = 60;
    public int JobIdleTtlSeconds { get; init; } = 3600;
    public int JobMaxTtlSeconds { get; init; } = 28_800;
    public int TombstoneSeconds { get; init; } = 300;
    public int SseHeartbeatSeconds { get; init; } = 15;

    public void Validate()
    {
        foreach (var property in typeof(AgentLimits).GetProperties())
        {
            var value = Convert.ToInt64(property.GetValue(this), System.Globalization.CultureInfo.InvariantCulture);
            if (property.Name != nameof(TokenRenewGraceSeconds) && value <= 0)
                throw new ArgumentOutOfRangeException(property.Name);
        }
        if (MaxPagesPerJob % 2 != 0 || MaxActiveJobsPerDevice != 1 || TokenTtlSeconds < 300 ||
            TokenRenewGraceSeconds is < 0 or > 300 || FamilyMaxSeconds < 3600 || RevocationCleanupSeconds > 600 ||
            DiscoveryTimeoutSeconds > 4_294_966)
            throw new ArgumentOutOfRangeException(nameof(AgentLimits));
    }
}

public sealed class AgentOptions
{
    public static AgentOptions FromEnvironment() => new()
    {
        DevMode = string.Equals(Environment.GetEnvironmentVariable("ZILO_DEV_MODE"), "1", StringComparison.Ordinal),
        BakedOrigins = (Environment.GetEnvironmentVariable("ZILO_BAKED_ORIGINS") ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    };
    public int Port { get; init; } = 47841;
    public int[] FallbackPorts { get; init; } = [47842, 47843];
    public bool DevMode { get; init; }
    public string Version { get; init; } = "0.1.0";
    public AgentLimits Limits { get; init; } = new();
    public IReadOnlyList<string> BakedOrigins { get; init; } = Array.Empty<string>();
    public INativeConsentPrompt? NativeConsent { get; init; }
    public IReadOnlyList<DiscoveryBackendRegistration> DiscoveryBackends { get; init; } = Array.Empty<DiscoveryBackendRegistration>();
    public IClock Clock { get; init; } = new SystemClock();

    public string InstanceId { get; } = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public string OperatingSystem => System.OperatingSystem.IsWindows() ? "windows" : System.OperatingSystem.IsMacOS() ? "macos" : "linux";
    public string Architecture => RuntimeInformation.ProcessArchitecture switch
    {
        System.Runtime.InteropServices.Architecture.Arm64 => "arm64", System.Runtime.InteropServices.Architecture.X86 => "x86", _ => "x64"
    };
}

public sealed record DiscoveryBackendRegistration(string Name, IScanBackend Backend);
