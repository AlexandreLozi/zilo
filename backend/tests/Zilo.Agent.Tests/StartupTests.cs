using System.Diagnostics;
using Xunit;

namespace Zilo.Agent.Tests;

public sealed class StartupTests
{
    [Fact]
    public async Task Self_test_exits_successfully_without_starting_a_listener()
    {
        // A missing notice, a crash, stderr output, or a long-running service must fail.
        var first = await RunAgentAsync("--self-test");
        var second = await RunAgentAsync("--self-test");

        Assert.Equal(0, first.ExitCode);
        Assert.Equal(0, second.ExitCode);
        Assert.Empty(first.Stderr);
        Assert.Empty(second.Stderr);
        Assert.Equal("Zilo.Agent self-test: PASS" + Environment.NewLine, first.Stdout);
        Assert.Equal(first.Stdout, second.Stdout);
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunAgentAsync(string argument)
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
        startInfo.ArgumentList.Add(argument);

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
