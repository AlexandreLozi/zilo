using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Zilo.Security;

namespace Zilo.Agent;

public static class AgentHost
{
    public static WebApplication Build(WebApplicationBuilder builder, AgentOptions? options = null)
    {
        options ??= new AgentOptions();
        options.Limits.Validate();
        builder.Services.AddSingleton(options);
        var origins = new OriginPolicy(options.DevMode, options.BakedOrigins);
        builder.Services.AddSingleton(origins);
        var consent = new ConsentStore(new ConsentOptions(), options.Clock, options.NativeConsent);
        var tokenService = new TokenService(new TokenLimits(options.Limits.TokenTtlSeconds, options.Limits.TokenRenewGraceSeconds, options.Limits.FamilyMaxSeconds, options.Limits.MaxFamiliesPerOrigin, options.Limits.MaxFamiliesTotal, options.Limits.TokenIssuesPerOriginPerHour, options.Limits.MaxRetainedAuthRecords), options.Clock, consent, origins.IsBaked);
        builder.Services.AddSingleton(tokenService);
        consent.OriginRemoved += origin => tokenService.RevokeOrigin(origin);
        builder.Services.AddSingleton(consent);
        builder.Services.AddSingleton(_ => new DiscoveryService(options.DiscoveryBackends, TimeSpan.FromSeconds(options.Limits.DiscoveryTimeoutSeconds)));
        builder.Services.AddHostedService(sp => sp.GetRequiredService<DiscoveryService>());
        var app = builder.Build();
        app.UseMiddleware<AgentPipeline>();
        return app;
    }

    public static async Task<int> RunAsync(AgentOptions options, string[] args)
    {
        foreach (var port in new[] { options.Port }.Concat(options.FallbackPorts).Distinct())
        {
            try
            {
                var builder = WebApplication.CreateBuilder(args);
                builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, port));
                await using var app = Build(builder, options);
                await app.RunAsync($"http://127.0.0.1:{port}").ConfigureAwait(false);
                return 0;
            }
            catch (IOException) when (port != options.FallbackPorts.LastOrDefault()) { }
        }
        return 1;
    }
}

public static class AgentSelfTest
{
    public static int Run()
    {
        _ = new OriginPolicy(false, Array.Empty<string>());
        _ = new ConsentStore();
        _ = new TokenService();
        _ = new DiscoveryService(Array.Empty<DiscoveryBackendRegistration>()).List();
        return 0;
    }
}
