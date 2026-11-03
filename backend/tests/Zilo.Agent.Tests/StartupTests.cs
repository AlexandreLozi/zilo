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

        Assert.False(first.TimedOut, FormatFailure("first self-test", first));
        Assert.False(second.TimedOut, FormatFailure("second self-test", second));
        Assert.True(first.ExitCode == 0, FormatFailure("first self-test", first));
        Assert.True(second.ExitCode == 0, FormatFailure("second self-test", second));
        Assert.True(first.Stderr.Length == 0, FormatFailure("first self-test", first));
        Assert.True(second.Stderr.Length == 0, FormatFailure("second self-test", second));
        Assert.True(
            string.Equals("Zilo.Agent self-test: PASS" + Environment.NewLine, first.Stdout, StringComparison.Ordinal),
            FormatFailure("first self-test", first));
        Assert.True(string.Equals(first.Stdout, second.Stdout, StringComparison.Ordinal), FormatFailure("second self-test", second));
    }

    private static async Task<(int ExitCode, string Stdout, string Stderr, TimeSpan Elapsed, bool TimedOut)> RunAgentAsync(string argument)
    {
        var started = Stopwatch.StartNew();
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
        var cancellation = TestContext.Current.CancellationToken;
        var stdout = process.StandardOutput.ReadToEndAsync(cancellation);
        var stderr = process.StandardError.ReadToEndAsync(cancellation);
        var timedOut = false;

        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested && !cancellation.IsCancellationRequested)
        {
            timedOut = true;
        }
        finally
        {
            if (!process.HasExited)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (InvalidOperationException)
                {
                    // The process can exit between HasExited and Kill.
                }
            }

            try
            {
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(1), cancellation);
            }
            catch (TimeoutException)
            {
                // Keep timeout diagnostics bounded if a descendant retains a pipe.
            }
        }

        var stdoutText = await DrainOutputAsync(stdout, cancellation);
        var stderrText = await DrainOutputAsync(stderr, cancellation);

        return (process.HasExited ? process.ExitCode : -1, stdoutText, stderrText, started.Elapsed, timedOut);
    }

    private static async Task<string> DrainOutputAsync(Task<string> output, CancellationToken cancellation)
    {
        try
        {
            return await output.WaitAsync(TimeSpan.FromSeconds(1), cancellation);
        }
        catch (TimeoutException)
        {
            return "[output drain timed out]";
        }
    }

    private static string FormatFailure(
        string label,
        (int ExitCode, string Stdout, string Stderr, TimeSpan Elapsed, bool TimedOut) result)
    {
        return $"{label} failed after {result.Elapsed.TotalSeconds:F3}s (timed out: {result.TimedOut}, exit code: {result.ExitCode}). "
            + $"stdout: {Truncate(result.Stdout)} stderr: {Truncate(result.Stderr)}";
    }

    private static string Truncate(string value)
    {
        const int maximumLength = 4096;
        return value.Length <= maximumLength
            ? value
            : value[..maximumLength] + "...[truncated]";
    }
}
