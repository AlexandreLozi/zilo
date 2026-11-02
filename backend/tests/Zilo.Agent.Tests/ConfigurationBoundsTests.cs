using Microsoft.AspNetCore.Builder;
using Xunit;
using Zilo.Agent;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class ConfigurationBoundsTests
{
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
