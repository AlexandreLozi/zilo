using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Xunit;
using Zilo.Agent;

namespace Zilo.Agent.Tests;

internal sealed class HttpTestAgent(WebApplication app, HttpClient client) : IAsyncDisposable
{
    public const string Origin = "https://matrix.test";
    public WebApplication App { get; } = app;
    public HttpClient Client { get; } = client;
    public static async Task<HttpTestAgent> Start(AgentOptions? options = null)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
        var app = AgentHost.Build(builder, options ?? new AgentOptions { BakedOrigins = [Origin] });
        await app.StartAsync(TestContext.Current.CancellationToken);
        return new(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) });
    }

    public async Task<HttpResponseMessage> Send(HttpMethod method, string path, HttpContent? content = null, string? origin = Origin, string? token = null)
    {
        using var request = new HttpRequestMessage(method, path) { Content = content };
        if (origin is not null) request.Headers.Add("Origin", origin);
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await Client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    public async Task<string> Raw(string headers, string path = "/zilo/v1/hello", string method = "GET")
    {
        using var connection = new TcpClient();
        var token = TestContext.Current.CancellationToken;
        await connection.ConnectAsync(IPAddress.Loopback, Client.BaseAddress!.Port, token);
        await using var stream = connection.GetStream();
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"{method} {path} HTTP/1.1\r\n{headers}\r\nConnection: close\r\n\r\n"), token);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return await reader.ReadToEndAsync(token).WaitAsync(TimeSpan.FromSeconds(3), token);
    }

    public async ValueTask DisposeAsync()
    { Client.Dispose(); await App.StopAsync(TestContext.Current.CancellationToken); await App.DisposeAsync(); }
}
