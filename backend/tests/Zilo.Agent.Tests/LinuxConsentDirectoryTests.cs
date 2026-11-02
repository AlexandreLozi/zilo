using System.Diagnostics;
using System.IO.Pipes;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class LinuxConsentDirectoryTests
{
    [Fact]
    public async Task Real_process_kill_at_write_checkpoints_keeps_dirty_fence_and_releases_lock()
    {
        if (!OperatingSystem.IsLinux()) return;
        var token = TestContext.Current.CancellationToken;
        var childStore = Environment.GetEnvironmentVariable("ZILO_LINUX_STORAGE_CHILD_ROOT");
        if (childStore is not null)
        {
            var stage = int.Parse(Environment.GetEnvironmentVariable("ZILO_LINUX_STORAGE_CHILD_STAGE")!, System.Globalization.CultureInfo.InvariantCulture);
            var armed = false;
            await using var session = new ConsentSession(LinuxConsentDirectory.Open(childStore, at =>
            {
                if (!armed || (int)at != stage) return;
                using var signal = new NamedPipeClientStream(".", Environment.GetEnvironmentVariable("ZILO_LINUX_STORAGE_CHILD_PIPE")!, PipeDirection.Out);
                signal.Connect(5000);
                signal.WriteByte(1);
                signal.Flush();
                using var never = new ManualResetEventSlim();
                never.Wait(token); // parent must kill the process; no clean shutdown or Dispose
            }));
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(token)).Health);
            await session.WriteAsync(Snapshot(2, "granted"), token);
            armed = true;
            await session.WriteAsync(Snapshot(3, "blocked"), token);
            Assert.Fail("Parent did not terminate the child at its requested checkpoint");
            return;
        }

        foreach (var stage in Enum.GetValues<LinuxConsentWriteStage>())
        {
            using var fixture = new Fixture();
            var pipeName = "t11p-" + Guid.NewGuid().ToString("N");
            await using var signal = new NamedPipeServerStream(pipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
            var info = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
            { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            info.ArgumentList.Add(typeof(LinuxConsentDirectoryTests).Assembly.Location);
            info.ArgumentList.Add("-method");
            info.ArgumentList.Add(typeof(LinuxConsentDirectoryTests).FullName + "." + nameof(Real_process_kill_at_write_checkpoints_keeps_dirty_fence_and_releases_lock));
            info.Environment["ZILO_LINUX_STORAGE_CHILD_ROOT"] = fixture.Store;
            info.Environment["ZILO_LINUX_STORAGE_CHILD_STAGE"] = ((int)stage).ToString(System.Globalization.CultureInfo.InvariantCulture);
            info.Environment["ZILO_LINUX_STORAGE_CHILD_PIPE"] = pipeName;
            using var process = Process.Start(info)!;
            var output = process.StandardOutput.ReadToEndAsync(token);
            var errors = process.StandardError.ReadToEndAsync(token);
            try
            {
                await signal.WaitForConnectionAsync(token).WaitAsync(TimeSpan.FromSeconds(10), token);
                var ready = new byte[1];
                await signal.ReadExactlyAsync(ready, token).AsTask().WaitAsync(TimeSpan.FromSeconds(5), token);
                Assert.Equal(1, ready[0]);
                Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(fixture.Store));
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(token).WaitAsync(TimeSpan.FromSeconds(5), token);
                Assert.True(process.HasExited);
                await using var reopened = new ConsentSession(LinuxConsentDirectory.Open(fixture.Store));
                var result = await reopened.OpenAsync(token);
                Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
                Assert.Null(result.Snapshot);
                Assert.Equal("zilo-consent-session-v1\n", await File.ReadAllTextAsync(Path.Combine(fixture.Store, "session.fence"), token));
            }
            finally
            {
                if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(token).WaitAsync(TimeSpan.FromSeconds(5), token); }
                _ = await output;
                _ = await errors;
            }
        }
    }

    [Theory]
    [InlineData("/custom/state", "/home/user", "/custom/state/zilo")]
    [InlineData("relative", "/home/user", "/home/user/.local/state/zilo")]
    [InlineData(null, "/home/user", "/home/user/.local/state/zilo")]
    public void Root_resolution_uses_only_absolute_XDG_or_absolute_home(string? xdg, string home, string expected)
    {
        if (!OperatingSystem.IsLinux()) return;
        Assert.Equal(expected, LinuxConsentDirectory.ResolveRoot(xdg, home));
        Assert.Throws<IOException>(() => LinuxConsentDirectory.ResolveRoot(null, "relative-home"));
    }

    [Fact]
    public void Foreign_owned_root_is_unavailable_without_maintenance()
    {
        if (!OperatingSystem.IsLinux()) return;
        // Real root-owned procfs; no chown/sudo/user-namespace dependency or owner-host mutation.
        Assert.Throws<IOException>(() => LinuxConsentDirectory.Open("/proc"));
    }

    [Theory]
    [InlineData("unsafe-mode")]
    [InlineData("oversize")]
    [InlineData("hardlink")]
    public async Task Unsafe_or_unbounded_real_snapshot_is_rejected(string fault)
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        await using var directory = LinuxConsentDirectory.Open(fixture.Store);
        var path = Path.Combine(fixture.Store, "consent.json");
        await File.WriteAllTextAsync(path, "{}", TestContext.Current.CancellationToken);
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        if (fault == "unsafe-mode") File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
        if (fault == "oversize") { using var stream = File.OpenWrite(path); stream.SetLength(4_194_305); }
        if (fault == "hardlink") Assert.Equal(0, Link(path, Path.Combine(fixture.Parent, "second-link")));
        await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(TestContext.Current.CancellationToken).AsTask());
    }

    [Theory]
    [InlineData("consent.tmp")]
    [InlineData("fence.tmp")]
    [InlineData("quarantine-0")]
    public async Task Interrupted_initialization_evidence_never_looks_fresh(string artifact)
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        await using var directory = LinuxConsentDirectory.Open(fixture.Store);
        await File.WriteAllTextAsync(Path.Combine(fixture.Store, artifact), "interrupted", TestContext.Current.CancellationToken);
        await using var session = new ConsentSession(directory);
        var result = await session.OpenAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
        Assert.False(File.Exists(Path.Combine(fixture.Store, "consent.json")));
    }

    [Theory]
    [InlineData("consent.json")]
    [InlineData("consent.tmp")]
    [InlineData("consent.lock")]
    public async Task Name_swap_before_rename_cannot_modify_symlink_victim(string swap)
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        var armed = false;
        var victim = Path.Combine(fixture.Parent, "victim");
        await File.WriteAllTextAsync(victim, "not-metadata", TestContext.Current.CancellationToken);
        await using var session = new ConsentSession(LinuxConsentDirectory.Open(fixture.Store, stage =>
        {
            if (!armed || stage != LinuxConsentWriteStage.BeforeRename) return;
            var path = Path.Combine(fixture.Store, swap);
            File.Delete(path);
            File.CreateSymbolicLink(path, victim);
        }));
        await session.OpenAsync(TestContext.Current.CancellationToken);
        armed = true;
        await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2, "granted"), TestContext.Current.CancellationToken).AsTask());
        Assert.Equal("not-metadata", await File.ReadAllTextAsync(victim, TestContext.Current.CancellationToken));
        Assert.Equal("zilo-consent-session-v1\n", await File.ReadAllTextAsync(Path.Combine(fixture.Store, "session.fence"), TestContext.Current.CancellationToken));
    }

    [System.Runtime.InteropServices.DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int Link([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPUTF8Str)] string oldPath,
        [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPUTF8Str)] string newPath);

    [Fact]
    public async Task Real_linux_store_is_private_and_roundtrips_clean_grants_and_blocks()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        await using (var directory = LinuxConsentDirectory.Open(fixture.Store))
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(fixture.Store));
            await using var session = new ConsentSession(directory);
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(TestContext.Current.CancellationToken)).Health);
            await session.WriteAsync(Snapshot(2, "granted", "blocked"), TestContext.Current.CancellationToken);
            await session.CompleteAsync(2, TestContext.Current.CancellationToken);
            foreach (var name in new[] { "consent.lock", "consent.json", "session.fence" })
                Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(fixture.Store, name)));
        }
        await using var reopened = new ConsentSession(LinuxConsentDirectory.Open(fixture.Store));
        var result = await reopened.OpenAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Ready, result.Health);
        Assert.Equal(new[] { "granted", "blocked" }, result.Snapshot!.Records.Select(x => x.State));
    }

    [Fact]
    public async Task Exclusive_lock_lasts_until_actual_disposal()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        var first = LinuxConsentDirectory.Open(fixture.Store);
        try { Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(fixture.Store)); }
        finally { await first.DisposeAsync(); }
        await using var next = LinuxConsentDirectory.Open(fixture.Store);
    }

    [Theory]
    [InlineData("root")]
    [InlineData("ancestor")]
    [InlineData("snapshot")]
    [InlineData("lock")]
    public async Task Symlinks_are_not_followed_at_any_store_boundary(string target)
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        Directory.CreateDirectory(fixture.Store, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var outside = Path.Combine(fixture.Parent, "outside");
        Directory.CreateDirectory(outside);
        if (target == "root") { Directory.Delete(fixture.Store); Directory.CreateSymbolicLink(fixture.Store, outside); }
        if (target == "ancestor")
        {
            var link = Path.Combine(fixture.Parent, "link");
            Directory.CreateSymbolicLink(link, outside);
            Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(Path.Combine(link, "store")));
            Assert.False(Directory.Exists(Path.Combine(outside, "store")));
            return;
        }
        if (target is "snapshot" or "lock")
            File.CreateSymbolicLink(Path.Combine(fixture.Store, target == "lock" ? "consent.lock" : "consent.json"), Path.Combine(outside, "victim"));
        if (target is "root" or "lock") Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(fixture.Store));
        else
        {
            await using var directory = LinuxConsentDirectory.Open(fixture.Store);
            await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(TestContext.Current.CancellationToken).AsTask());
        }
        Assert.Empty(Directory.EnumerateFileSystemEntries(outside));
    }

    [Fact]
    public void Unsafe_existing_root_is_rejected_not_chmod_repaired()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        Directory.CreateDirectory(fixture.Store, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        File.SetUnixFileMode(fixture.Store, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.OtherRead);
        Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(fixture.Store));
        Assert.True(File.GetUnixFileMode(fixture.Store).HasFlag(UnixFileMode.OtherRead));
    }

    [Theory]
    [InlineData((int)LinuxConsentWriteStage.BeforeFileFlush)]
    [InlineData((int)LinuxConsentWriteStage.BeforeRename)]
    [InlineData((int)LinuxConsentWriteStage.BeforeDirectoryFlush)]
    public async Task Injected_write_fault_leaves_real_store_unclean_on_reopen(int stage)
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        var armed = false;
        await using (var session = new ConsentSession(LinuxConsentDirectory.Open(fixture.Store, at => { if (armed && (int)at == stage) throw new IOException("injected-fault"); })))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(TestContext.Current.CancellationToken)).Health);
            await session.WriteAsync(Snapshot(2, "granted"), TestContext.Current.CancellationToken);
            armed = true;
            await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(3, "blocked"), TestContext.Current.CancellationToken).AsTask());
            await Assert.ThrowsAsync<InvalidOperationException>(() => session.CompleteAsync(2, TestContext.Current.CancellationToken).AsTask());
        }
        await using var reopen = new ConsentSession(LinuxConsentDirectory.Open(fixture.Store));
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopen.OpenAsync(TestContext.Current.CancellationToken)).Health);
    }

    [Fact]
    public async Task Root_replacement_cannot_redirect_anchored_write_to_attacker_directory()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new Fixture();
        var armed = false;
        var moved = fixture.Store + "-moved";
        await using var directory = LinuxConsentDirectory.Open(fixture.Store, stage =>
        {
            if (!armed || stage != LinuxConsentWriteStage.BeforeRename) return;
            Directory.Move(fixture.Store, moved);
            if (OperatingSystem.IsLinux()) Directory.CreateDirectory(fixture.Store, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        });
        await using var session = new ConsentSession(directory);
        await session.OpenAsync(TestContext.Current.CancellationToken);
        armed = true;
        await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2, "granted"), TestContext.Current.CancellationToken).AsTask());
        Assert.Empty(Directory.EnumerateFileSystemEntries(fixture.Store));
        Assert.Equal("zilo-consent-session-v1\n", await File.ReadAllTextAsync(Path.Combine(moved, "session.fence"), TestContext.Current.CancellationToken));
    }

    private static ConsentSnapshot Snapshot(long generation, params string[] states) => new(generation,
        states.Select((state, index) => new StoredConsent($"https://site{index}.example", state, false, DateTimeOffset.UnixEpoch, null, null)).ToArray());

    private sealed class Fixture : IDisposable
    {
        internal string Parent { get; } = Directory.CreateTempSubdirectory("t11p-linux-").FullName;
        internal string Store => Path.Combine(Parent, "zilo");
        public void Dispose() => Directory.Delete(Parent, true);
    }
}
