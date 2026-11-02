using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Zilo.Agent;
using Zilo.Security;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class CooperativeHostTests
{
    private const string Origin = "https://cooperative.test";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Never_completing_probe_or_caps_has_bounded_real_HTTP_wait(bool caps)
    {
        var backend = new DiscoveryClosureTests.ControlledBackend { StallRefresh = !caps };
        var time = new ManualTime();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
        await using var app = AgentHost.Build(builder, new AgentOptions { BakedOrigins = [Origin], TimeProvider = time, DiscoveryBackends = [new("test", backend)] });
        await app.StartAsync(TestContext.Current.CancellationToken);
        var discovery = app.Services.GetRequiredService<DiscoveryService>();
        if (caps) await discovery.RefreshAsync(TestContext.Current.CancellationToken);
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
        var token = app.Services.GetRequiredService<TokenService>().Issue(Origin).Token!.Token;
        using var request = new HttpRequestMessage(caps ? HttpMethod.Get : HttpMethod.Post, caps ? "/zilo/v1/devices/device/caps" : "/zilo/v1/devices/refresh");
        request.Headers.Add("Origin", Origin);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var pending = client.SendAsync(request, TestContext.Current.CancellationToken);
        if (caps) await backend.CapsStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        else await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
        await time.WaitForTimer(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        time.Advance(TimeSpan.FromSeconds(15));
        using var response = await pending.WaitAsync(TimeSpan.FromSeconds(3), TestContext.Current.CancellationToken);
        Assert.Equal(caps ? HttpStatusCode.GatewayTimeout : HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Contains(caps ? "\"code\":\"timeout\"" : "\"incompleteDrivers\":[\"test\"]", body, StringComparison.Ordinal);
        Assert.Equal(1, discovery.RetainedCallCount);
        await app.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(0, backend.DisposeCalls);
        // Deliberately NEVER release the managed fake. Process exit is its final boundary.
    }

    [Fact]
    public async Task Never_completing_managed_backend_child_process_exits_with_redacted_diagnostic()
    {
        if (Environment.GetEnvironmentVariable("ZILO_T11_SHUTDOWN_CHILD") == "1")
        {
            var backend = new DiscoveryClosureTests.ControlledBackend { StallRefresh = true };
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
            var app = AgentHost.Build(builder, new AgentOptions { BackendShutdownGrace = TimeSpan.FromMilliseconds(250), DiscoveryBackends = [new("test", backend)] });
            await app.StartAsync(TestContext.Current.CancellationToken);
            await backend.RefreshStarted.Task.WaitAsync(TestContext.Current.CancellationToken);
            var discovery = app.Services.GetRequiredService<DiscoveryService>();
            var watch = Stopwatch.StartNew();
            await app.StopAsync(TestContext.Current.CancellationToken);
            await app.DisposeAsync();
            Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3));
            Assert.Equal(1, discovery.RetainedCallCount);
            Assert.False(discovery.ShutdownCompletion.IsCompleted);
            Assert.Equal(0, backend.DisposeCalls);
            Console.WriteLine("T11_SHUTDOWN_BOUNDARY_OK retained=1 graceMs=250 dispose=0");
            return;
        }

        var info = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        info.ArgumentList.Add(typeof(CooperativeHostTests).Assembly.Location);
        info.ArgumentList.Add("-method");
        info.ArgumentList.Add(typeof(CooperativeHostTests).FullName + "." + nameof(Never_completing_managed_backend_child_process_exits_with_redacted_diagnostic));
        info.Environment["ZILO_T11_SHUTDOWN_CHILD"] = "1";
        using var process = Process.Start(info)!;
        var stdout = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        try
        {
            await process.WaitForExitAsync(TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
            Assert.Equal(0, process.ExitCode);
            var output = await stdout;
            Assert.Contains("T11_SHUTDOWN_BOUNDARY_OK", output, StringComparison.Ordinal);
            Assert.Single(output.Split('\n'), line => line.Contains("Discovery shutdown retained 1 backend call(s); cooperative boundary", StringComparison.Ordinal));
            Assert.True(output.Length < 16_384);
            Assert.DoesNotContain("private-backend-secret", output, StringComparison.Ordinal);
            Assert.Empty(await stderr);
        }
        finally { if (!process.HasExited) process.Kill(entireProcessTree: true); }
    }
}
