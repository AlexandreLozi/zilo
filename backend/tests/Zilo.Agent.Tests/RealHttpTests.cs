using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Xunit;

namespace Zilo.Agent.Tests;

[Collection("Agent process")]
public sealed class RealHttpTests
{
    [Fact]
    public async Task All_three_contract_ports_occupied_fails_without_an_arbitrary_listener()
    {
        using var first = new TcpListener(IPAddress.Loopback, 47841);
        using var second = new TcpListener(IPAddress.Loopback, 47842);
        using var third = new TcpListener(IPAddress.Loopback, 47843);
        first.Start(); second.Start(); third.Start();
        var start = new ProcessStartInfo { FileName = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet", UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "agent", "Zilo.Agent.dll"));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start agent");
        var stdout = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        try
        {
            await process.WaitForExitAsync(TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
            Assert.NotEqual(0, process.ExitCode);
            Assert.DoesNotContain("Now listening", await stdout);
            _ = await stderr;
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(TestContext.Current.CancellationToken);
        }
    }

    [Fact]
    public async Task Real_loopback_http_exposes_public_hello_and_enforces_host_first()
    {
        var start = new ProcessStartInfo
        {
            FileName = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "agent", "Zilo.Agent.dll"));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start agent");
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        stop.CancelAfter(TimeSpan.FromSeconds(10));
        using var client = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:47841") };
        try
        {
            HttpResponseMessage? hello = null;
            while (hello is null)
            {
                stop.Token.ThrowIfCancellationRequested();
                try { hello = await client.GetAsync("/zilo/v1/hello", stop.Token); }
                catch (HttpRequestException) { await Task.Delay(50, stop.Token); }
            }
            Assert.Equal(HttpStatusCode.OK, hello.StatusCode);
            using var json = JsonDocument.Parse(await hello.Content.ReadAsStringAsync(stop.Token));
            Assert.Equal("zilo", json.RootElement.GetProperty("product").GetString());
            Assert.Equal("public", json.RootElement.GetProperty("scope").GetString());
            Assert.False(json.RootElement.TryGetProperty("instanceId", out _));

            using var absentConsent = await client.GetAsync("/zilo/v1/auth/consent", stop.Token);
            Assert.Equal(HttpStatusCode.Forbidden, absentConsent.StatusCode);
            Assert.False(absentConsent.Headers.Contains("Access-Control-Allow-Origin"));
            using var absentPreflight = new HttpRequestMessage(HttpMethod.Options, "/zilo/v1/hello");
            absentPreflight.Headers.Add("Access-Control-Request-Method", "GET");
            using var preflight = await client.SendAsync(absentPreflight, stop.Token);
            Assert.Equal(HttpStatusCode.Forbidden, preflight.StatusCode);
            Assert.Empty(await preflight.Content.ReadAsByteArrayAsync(stop.Token));
            using var eligibleConsent = new HttpRequestMessage(HttpMethod.Get, "/zilo/v1/auth/consent");
            eligibleConsent.Headers.Add("Origin", "https://example.test");
            using var eligible = await client.SendAsync(eligibleConsent, stop.Token);
            Assert.Equal(HttpStatusCode.OK, eligible.StatusCode);
            Assert.Contains("Access-Control-Allow-Origin", eligible.Headers.Select(x => x.Key));

            using var badHost = new HttpRequestMessage(HttpMethod.Get, "/zilo/v1/hello");
            badHost.Headers.Host = "evil:47841";
            using var denied = await client.SendAsync(badHost, stop.Token);
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.False(denied.Headers.Contains("Access-Control-Allow-Origin"));
        }
        finally
        {
            // Close the client's pooled connections first: a graceful client close makes the agent
            // side the responder, so no server socket on 47841 outlives the process kill.
            client.Dispose();
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(TestContext.Current.CancellationToken);
        }
    }

    [Fact]
    public async Task Occupied_primary_port_uses_only_ordered_fallback()
    {
        using var occupied = new TcpListener(IPAddress.Loopback, 47841); occupied.Start();
        var start = new ProcessStartInfo { FileName = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet", UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "agent", "Zilo.Agent.dll"));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start agent");
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken); stop.CancelAfter(TimeSpan.FromSeconds(10));
        using var client = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:47842") };
        try
        {
            HttpResponseMessage? response = null;
            while (response is null) { stop.Token.ThrowIfCancellationRequested(); try { response = await client.GetAsync("/zilo/v1/hello", stop.Token); } catch (HttpRequestException) { await Task.Delay(50, stop.Token); } }
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        finally
        {
            // Same ordering as Real_loopback_http: close the client's pooled connection first so the
            // killed agent cannot leave a server socket on a contract port behind.
            client.Dispose();
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(TestContext.Current.CancellationToken);
        }
    }
}

[Collection("Agent process")]
public sealed class RealAuthHttpTests
{
    [Fact]
    public async Task Baked_origin_can_issue_and_read_full_hello()
    {
        var start = new ProcessStartInfo { FileName = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet", UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        start.Environment["ZILO_BAKED_ORIGINS"] = "https://example.test";
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "agent", "Zilo.Agent.dll"));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start agent");
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken); stop.CancelAfter(TimeSpan.FromSeconds(10));
        using var client = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:47841") };
        try
        {
            HttpResponseMessage response;
            do { try { using var request = new HttpRequestMessage(HttpMethod.Post, "/zilo/v1/auth/token"); request.Headers.Add("Origin", "https://example.test"); response = await client.SendAsync(request, stop.Token); } catch (HttpRequestException) { await Task.Delay(50, stop.Token); response = null!; } } while (response is null);
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            using var tokenJson = JsonDocument.Parse(await response.Content.ReadAsStringAsync(stop.Token));
            var token = tokenJson.RootElement.GetProperty("token").GetString()!;
            using var hello = new HttpRequestMessage(HttpMethod.Get, "/zilo/v1/hello"); hello.Headers.Add("Origin", "https://example.test"); hello.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            using var full = await client.SendAsync(hello, stop.Token);
            Assert.Equal(HttpStatusCode.OK, full.StatusCode);
            using var json = JsonDocument.Parse(await full.Content.ReadAsStringAsync(stop.Token));
            Assert.Equal("full", json.RootElement.GetProperty("scope").GetString());
            Assert.Contains("auth.token", json.RootElement.GetProperty("capabilities").EnumerateArray().Select(x => x.GetString()));
        }
        finally
        {
            // Same ordering as Real_loopback_http: close the client's pooled connection first so the
            // killed agent cannot leave a server socket on a contract port behind.
            client.Dispose();
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(TestContext.Current.CancellationToken);
        }
    }
}
