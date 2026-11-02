using Microsoft.AspNetCore.Builder;
using Xunit;
using Zilo.Agent;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class ConfigurationBoundsTests
{
    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    public void Every_positive_agent_limit_rejects_nonpositive_configuration(long value)
    {
        foreach (var property in typeof(AgentLimits).GetProperties().Where(p => p.Name != nameof(AgentLimits.TokenRenewGraceSeconds)))
        {
            var limits = new AgentLimits();
            property.SetValue(limits, Convert.ChangeType(value, property.PropertyType, System.Globalization.CultureInfo.InvariantCulture));
            Assert.Throws<ArgumentOutOfRangeException>(limits.Validate);
        }
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    public void All_security_counter_and_history_limits_reject_nonpositive_values(int value)
    {
        foreach (var limits in new[] {
            new TokenLimits(MaxFamiliesPerOrigin: value), new TokenLimits(MaxFamiliesTotal: value),
            new TokenLimits(TokenIssuesPerOriginPerHour: value), new TokenLimits(MaxRetainedAuthRecords: value) })
            Assert.Throws<ArgumentOutOfRangeException>(() => new TokenService(limits));
        foreach (var options in new[] { new ConsentOptions(PromptTimeoutSeconds: value), new ConsentOptions(PerOriginPromptsPerHour: value),
            new ConsentOptions(GlobalPromptsPerHour: value), new ConsentOptions(DenialCooldownSeconds: value) })
            Assert.Throws<ArgumentOutOfRangeException>(() => new ConsentStore(options));
    }

    [Fact]
    public void Supported_minimum_and_maximum_arithmetic_boundaries_are_constructible()
    {
        new AgentLimits { MaxRequestBodyBytes = int.MaxValue, DiscoveryTimeoutSeconds = 4_294_966,
            TokenTtlSeconds = int.MaxValue, FamilyMaxSeconds = int.MaxValue, TokenRenewGraceSeconds = 0 }.Validate();
        _ = new TokenService(new TokenLimits(TokenTtlSeconds: int.MaxValue, FamilyMaxSeconds: int.MaxValue,
            MaxFamiliesPerOrigin: int.MaxValue, MaxFamiliesTotal: int.MaxValue, TokenIssuesPerOriginPerHour: int.MaxValue, MaxRetainedAuthRecords: int.MaxValue));
        _ = new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 4_294_966, DenialCooldownSeconds: 86400));
        _ = new TokenService(new TokenLimits(TokenTtlSeconds: 300, TokenRenewGraceSeconds: 300, FamilyMaxSeconds: 3600));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(4_294_967_295d)]
    public void Shutdown_grace_rejects_nonpositive_or_timer_overflow(double milliseconds)
        => Assert.Throws<ArgumentOutOfRangeException>(() => new DiscoveryService([], shutdownGrace: TimeSpan.FromMilliseconds(milliseconds)));

    [Fact]
    public void Timer_overflow_is_rejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new DiscoveryService([], TimeSpan.FromMilliseconds(uint.MaxValue)));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ConsentStore(new ConsentOptions(PromptTimeoutSeconds: 4_294_967)));
        Assert.Throws<ArgumentOutOfRangeException>(() => new AgentLimits { DiscoveryTimeoutSeconds = 4_294_967 }.Validate());
    }
    [Theory]
    [InlineData(0, 60, 86400)]
    [InlineData(299, 60, 86400)]
    [InlineData(3600, -1, 86400)]
    [InlineData(3600, 301, 86400)]
    [InlineData(3600, 60, 0)]
    public void Unsafe_token_configuration_is_rejected_at_construction(int ttl, int grace, int family)
        => Assert.Throws<ArgumentOutOfRangeException>(() => new TokenService(new TokenLimits(ttl, grace, family)));

    [Fact]
    public void Unsafe_consent_arithmetic_is_rejected_at_construction()
        => Assert.Throws<ArgumentOutOfRangeException>(() => new ConsentStore(new ConsentOptions(DenialCooldownSeconds: int.MaxValue)));

    [Fact]
    public void Unsafe_agent_configuration_is_rejected_before_host_build()
        => Assert.Throws<ArgumentOutOfRangeException>(() => AgentHost.Build(WebApplication.CreateBuilder(), new AgentOptions { Limits = new AgentLimits { MaxRequestBodyBytes = 0 } }));

    [Fact]
    public void Nonpositive_discovery_timeout_is_rejected_at_construction()
        => Assert.Throws<ArgumentOutOfRangeException>(() => new DiscoveryService([], TimeSpan.Zero));
}
