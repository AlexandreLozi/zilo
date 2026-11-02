using Xunit;
using Zilo.Agent;
using Zilo.Core;
using Zilo.Security;

namespace Zilo.Agent.Tests;

public sealed class ContractSmokeTests
{
    [Fact]
    public void Origin_policy_preserves_exact_origin_but_classifies_root_dot_loopback()
    {
        var policy = new OriginPolicy(devMode: true, bakedOrigins: Array.Empty<string>());

        var result = policy.Evaluate("https://app.localhost.:8443");

        Assert.Equal(OriginClass.DevEligible, result.Class);
        Assert.Equal("https://app.localhost.:8443", result.Origin);
    }

    [Fact]
    public async Task Consent_without_native_ui_never_auto_grants()
    {
        var store = new ConsentStore(new ConsentOptions(), new SystemClock(), nativeConsent: null);

        var status = await store.RequestAsync("https://example.test", TestContext.Current.CancellationToken);

        Assert.Equal("pending", status.Status.State);
        Assert.Equal("pending", (await store.GetAsync("https://example.test", TestContext.Current.CancellationToken)).State);
    }

    [Fact]
    public void Baked_https_origin_is_allowed()
    {
        var policy = new OriginPolicy(false, ["https://example.test"]);
        Assert.Equal(OriginClass.Allowed, policy.Evaluate("https://example.test").Class);
    }

    [Fact]
    public void Token_service_does_not_retain_raw_credentials()
    {
        Assert.DoesNotContain(typeof(TokenService).Assembly.GetTypes().SelectMany(t => t.GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)), f => f.Name.Contains("Raw", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Token_revoke_denies_the_family()
    {
        var service = new TokenService();
        var issued = service.Issue("https://example.test").Token!;
        Assert.True(service.Revoke(issued.Token, issued.Origin));
        Assert.Equal("token-revoked", service.Validate(issued.Token, issued.Origin).Code);
    }

    [Fact]
    public void Capability_validation_rejects_non_positive_resolution_values()
    {
        var caps = new DeviceCaps("device", [new SourceCaps("flatbed", ResolutionCaps.List([0]), ["gray"], [new PageSize("a4", 210, 297)], new SizeMm(210, 297), false, null, new SourceDefaults(300, "gray", "a4"))]);
        Assert.Throws<InvalidDataException>(() => CapabilityValidator.Validate(caps));
    }

    [Fact]
    public async Task Native_denial_is_a_problem_result_not_an_approval()
    {
        var store = new ConsentStore(nativeConsent: new DenyingPrompt());
        var result = await store.RequestAsync("https://example.test", TestContext.Current.CancellationToken);
        Assert.Equal("pending", result.Status.State);
        await Task.Delay(50, TestContext.Current.CancellationToken);
        var status = await store.GetAsync("https://example.test", TestContext.Current.CancellationToken);
        Assert.Equal("denied", status.State);
    }

    private sealed class DenyingPrompt : INativeConsentPrompt
    {
        public ValueTask<ConsentDecision> RequestAsync(string exactOrigin, CancellationToken cancellationToken = default) => ValueTask.FromResult(ConsentDecision.Denied);
    }
}
