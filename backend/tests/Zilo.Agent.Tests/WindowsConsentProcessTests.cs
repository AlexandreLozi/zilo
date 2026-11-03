using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

#pragma warning disable CA1416

public sealed class WindowsConsentProcessTests
{
    public static bool WindowsHost => OperatingSystem.IsWindows() &&
        RuntimeInformation.ProcessArchitecture is Architecture.X64 or Architecture.Arm64;

    private const string NativeSkip = "Windows-native evidence requires hosted Windows x64/arm64; local Linux only validates guards and ABI helpers";
    private const string ChildMarkerVariable = "ZILO_T11P_WINDOWS_PROCESS_CHILD";
    private const string ChildRootVariable = "ZILO_T11P_WINDOWS_PROCESS_ROOT";
    private const string ChildPipeVariable = "ZILO_T11P_WINDOWS_PROCESS_PIPE";

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_kill_before_rename_preserves_old_snapshot_and_dirty_evidence()
    {
        var token = TestContext.Current.CancellationToken;
        var marker = Environment.GetEnvironmentVariable(ChildMarkerVariable);
        if (marker is not null)
        {
            if (!WindowsHost) return;

            var root = Environment.GetEnvironmentVariable(ChildRootVariable)!;
            var childPipeName = Environment.GetEnvironmentVariable(ChildPipeVariable)!;
            var armed = false;
            await using var session = new ConsentSession(WindowsConsentDirectory.Open(root, stage =>
            {
                if (!armed || stage != WindowsConsentWriteStage.BeforeRename) return;
                using var signal = new NamedPipeClientStream(".", childPipeName, PipeDirection.Out, PipeOptions.Asynchronous);
                signal.Connect(10_000);
                signal.WriteByte(1);
                signal.Flush();
                using var never = new ManualResetEventSlim();
                never.Wait(token); // The parent must terminate this process; no clean shutdown is allowed.
            }));

            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(token)).Health);
            armed = true;
            await session.WriteAsync(Snapshot(3, "blocked"), token);
            Assert.Fail("Parent did not terminate the child at its requested checkpoint");
            return;
        }

        using var fixture = new Fixture();
        byte[] oldSnapshotBytes;
        await using (var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store)))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(token)).Health);
            await session.WriteAsync(Snapshot(2, "granted"), token);
            await session.CompleteAsync(2, token);
        }

        oldSnapshotBytes = await File.ReadAllBytesAsync(Path.Combine(fixture.Store, "consent.json"), token);
        var pipeName = "t11p-windows-" + Guid.NewGuid().ToString("N");
        await using var signal = new NamedPipeServerStream(
            pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        var info = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        info.ArgumentList.Add(typeof(WindowsConsentProcessTests).Assembly.Location);
        info.ArgumentList.Add("-method");
        info.ArgumentList.Add(typeof(WindowsConsentProcessTests).FullName + "." +
                              nameof(Native_kill_before_rename_preserves_old_snapshot_and_dirty_evidence));
        info.Environment[ChildMarkerVariable] = Guid.NewGuid().ToString("N");
        info.Environment[ChildRootVariable] = fixture.Store;
        info.Environment[ChildPipeVariable] = pipeName;

        using var process = Process.Start(info)!;
        var childOutput = process.StandardOutput.ReadToEndAsync(token);
        var childErrors = process.StandardError.ReadToEndAsync(token);
        try
        {
            await signal.WaitForConnectionAsync(token).WaitAsync(TimeSpan.FromSeconds(15), token);
            var ready = new byte[1];
            await signal.ReadExactlyAsync(ready, token).AsTask().WaitAsync(TimeSpan.FromSeconds(5), token);
            Assert.Equal(1, ready[0]);

            Assert.False(process.HasExited);
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(token).WaitAsync(TimeSpan.FromSeconds(10), token);
            Assert.True(process.HasExited);

            await using (var reopenedDirectory = WindowsConsentDirectory.Open(fixture.Store))
            {
                var contents = await reopenedDirectory.ReadAsync(token);
                Assert.Equal(oldSnapshotBytes, contents.Snapshot);
                Assert.True(contents.InterruptedArtifacts);
            }

            Assert.True(File.Exists(Path.Combine(fixture.Store, "consent.tmp")));
            await using var reopenedSession = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store));
            var result = await reopenedSession.OpenAsync(token);
            Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
            Assert.Null(result.Snapshot);
        }
        finally
        {
            if (!process.HasExited)
                await KillAndWaitAsync(process);
            _ = await DrainBoundedAsync(childOutput);
            _ = await DrainBoundedAsync(childErrors);
        }
    }

    private static ConsentSnapshot Snapshot(long generation, string state) => new(generation,
        new[] { new StoredConsent("https://windows-crash.example", state, false, DateTimeOffset.UnixEpoch, null, null) });

    private static async Task KillAndWaitAsync(Process process)
    {
        if (!process.HasExited)
        {
            process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
        }
        Assert.True(process.HasExited);
    }

    private static async Task<string?> DrainBoundedAsync(Task<string> output)
    {
        try { return await output.WaitAsync(TimeSpan.FromSeconds(5)); }
        catch (TimeoutException) { return null; }
        catch (OperationCanceledException) { return null; }
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _parent = Path.Combine(Path.GetTempPath(), "t11p-windows-process-" + Guid.NewGuid().ToString("N"));
        internal string Store => Path.Combine(_parent, "Local", "Zilo");

        internal Fixture() => Directory.CreateDirectory(Path.Combine(_parent, "Local"));

        public void Dispose()
        {
            if (Directory.Exists(_parent)) Directory.Delete(_parent, true);
        }
    }
}
