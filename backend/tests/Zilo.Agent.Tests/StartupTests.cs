using System.Diagnostics;
using Xunit;

namespace Zilo.Agent.Tests;

public sealed class StartupTests
{
    [Fact]
    public async Task Startup_exits_successfully_with_a_deterministic_scaffold_notice()
    {
        // A missing notice, a crash, stderr output, or a long-running service must fail.
        var first = await RunAgentAsync();
        var second = await RunAgentAsync();

        Assert.Equal(0, first.ExitCode);
        Assert.Equal(0, second.ExitCode);
        Assert.Empty(first.Stderr);
        Assert.Empty(second.Stderr);
        Assert.Equal("Zilo.Agent scaffold: scanning is not implemented." + Environment.NewLine, first.Stdout);
        Assert.Equal(first.Stdout, second.Stdout);
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunAgentAsync()
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "agent", "Zilo.Agent.dll"));

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Could not start the built agent.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var stderr = process.StandardError.ReadToEndAsync(timeout.Token);

        try
        {
            await process.WaitForExitAsync(timeout.Token);
            return (process.ExitCode, await stdout, await stderr);
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
    }
}
