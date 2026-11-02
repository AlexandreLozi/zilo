using System.Diagnostics;
using System.Runtime.InteropServices;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class MacConsentDirectoryTests
{
    public static bool DarwinHost => OperatingSystem.IsMacOS() && RuntimeInformation.ProcessArchitecture is Architecture.X64 or Architecture.Arm64;
    private const string SkipReason = "Darwin-native evidence requires hosted macOS x64/arm64; local Linux cannot validate native calls";

    [Fact(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    public async Task Native_private_store_spaces_fullflush_order_and_clean_reopen()
    {
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException();
        using var fixture = new Fixture();
        var trace = new List<MacConsentWriteStage>();
        await using (var directory = MacConsentDirectory.Open(fixture.Store, trace.Add))
        {
            Assert.False(directory.IsVolatile);
            await using var session = new ConsentSession(directory);
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            trace.Clear();
            await session.WriteAsync(Snapshot(2), Token);
            Assert.Equal(Enum.GetValues<MacConsentWriteStage>(), trace);
            await session.CompleteAsync(2, Token);
            Assert.Equal((UnixFileMode)0x1c0, File.GetUnixFileMode(fixture.Store));
            foreach (var file in new[] { "consent.lock", "consent.json", "session.fence" })
                Assert.Equal((UnixFileMode)0x180, File.GetUnixFileMode(Path.Combine(fixture.Store, file)));
        }
        await using var reopened = new ConsentSession(MacConsentDirectory.Open(fixture.Store));
        var result = await reopened.OpenAsync(Token);
        Assert.Equal(ConsentStorageHealth.Ready, result.Health);
        Assert.Equal("granted", Assert.Single(result.Snapshot!.Records).State);
    }

    [Fact(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    public async Task Native_exclusive_lock_is_released_only_on_actual_dispose()
    {
        using var fixture = new Fixture();
        var first = MacConsentDirectory.Open(fixture.Store);
        try { Assert.Throws<IOException>(() => MacConsentDirectory.Open(fixture.Store)); }
        finally { await first.DisposeAsync(); }
        await using var next = MacConsentDirectory.Open(fixture.Store);
    }

    [Fact(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    public void Native_existing_permissive_lock_is_rejected_without_repair()
    {
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException();
        using var fixture = new Fixture();
        Directory.CreateDirectory(fixture.Store, (UnixFileMode)0x1c0);
        var lockPath = Path.Combine(fixture.Store, "consent.lock");
        File.WriteAllBytes(lockPath, Array.Empty<byte>());
        File.SetUnixFileMode(lockPath, (UnixFileMode)0x1a0);

        Assert.Throws<IOException>(() => MacConsentDirectory.Open(fixture.Store));
        Assert.Equal((UnixFileMode)0x1a0, File.GetUnixFileMode(lockPath));
    }

    [Theory(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    [InlineData("ancestor")]
    [InlineData("lock")]
    [InlineData("snapshot")]
    public async Task Native_symlinks_do_not_redirect_read_or_create(string target)
    {
        using var fixture = new Fixture();
        var victim = Path.Combine(fixture.Parent, "victim");
        await File.WriteAllTextAsync(victim, "untouched", Token);
        if (target == "ancestor")
        {
            var alias = Path.Combine(fixture.Parent, "alias");
            Directory.CreateSymbolicLink(alias, fixture.Parent);
            var error = Assert.Throws<IOException>(() => MacConsentDirectory.Open(Path.Combine(alias, "new-store")));
            Assert.Contains("consent-symlink-ancestor-unsupported", error.Message, StringComparison.Ordinal);
            Assert.False(Directory.Exists(Path.Combine(fixture.Parent, "new-store")));
        }
        else if (target == "lock")
        {
            Directory.CreateDirectory(fixture.Store);
            if (OperatingSystem.IsMacOS()) File.SetUnixFileMode(fixture.Store, (UnixFileMode)0x1c0);
            File.CreateSymbolicLink(Path.Combine(fixture.Store, "consent.lock"), victim);
            Assert.Throws<IOException>(() => MacConsentDirectory.Open(fixture.Store));
        }
        else
        {
            await using var directory = MacConsentDirectory.Open(fixture.Store);
            File.CreateSymbolicLink(Path.Combine(fixture.Store, "consent.json"), victim);
            await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(Token).AsTask());
        }
        Assert.Equal("untouched", await File.ReadAllTextAsync(victim, Token));
    }

    [Theory(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Native_extended_ACL_is_not_bounded_by_0700_or_0600(bool fileAcl)
    {
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException();
        using var fixture = new Fixture();
        if (!fileAcl)
        {
            Directory.CreateDirectory(fixture.Store, (UnixFileMode)0x1c0);
            await AddEveryoneReadAcl(fixture.Store);
            Assert.Equal((UnixFileMode)0x1c0, File.GetUnixFileMode(fixture.Store));
            Assert.Throws<IOException>(() => MacConsentDirectory.Open(fixture.Store));
        }
        else
        {
            await using var directory = MacConsentDirectory.Open(fixture.Store);
            await directory.ReplaceAsync("consent.json", ConsentSnapshotCodec.Encode(Snapshot(1)), Token);
            var path = Path.Combine(fixture.Store, "consent.json");
            await AddEveryoneReadAcl(path);
            Assert.Equal((UnixFileMode)0x180, File.GetUnixFileMode(path));
            await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(Token).AsTask());
        }
    }

    [Theory(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    [InlineData((int)MacConsentWriteStage.FileFullSync)]
    [InlineData((int)MacConsentWriteStage.DirectoryFullSync)]
    public async Task Injected_required_fullflush_failure_prevents_clean_reopen(int failure)
    {
        using var fixture = new Fixture(); var armed = false;
        await using (var session = new ConsentSession(MacConsentDirectory.Open(fixture.Store, stage =>
        { if (armed && (int)stage == failure) throw new IOException("simulated-fullflush-failure"); })))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            armed = true;
            await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2), Token).AsTask());
            await Assert.ThrowsAsync<InvalidOperationException>(() => session.CompleteAsync(1, Token).AsTask());
        }
        await using var reopened = new ConsentSession(MacConsentDirectory.Open(fixture.Store));
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopened.OpenAsync(Token)).Health);
    }

    [Fact(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    public async Task Native_root_swap_does_not_redirect_anchored_replace()
    {
        using var fixture = new Fixture(); var armed = false;
        await using var session = new ConsentSession(MacConsentDirectory.Open(fixture.Store, stage =>
        {
            if (!armed || stage != MacConsentWriteStage.BeforeRename) return;
            Directory.Move(fixture.Store, fixture.Store + "-moved");
            Directory.CreateDirectory(fixture.Store);
            if (OperatingSystem.IsMacOS()) File.SetUnixFileMode(fixture.Store, (UnixFileMode)0x1c0);
        }));
        await session.OpenAsync(Token); armed = true;
        await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2), Token).AsTask());
        Assert.Empty(Directory.EnumerateFileSystemEntries(fixture.Store));
    }

    [Fact(SkipUnless = nameof(DarwinHost), Skip = SkipReason)]
    public async Task Native_oversize_snapshot_is_rejected_before_read_allocation()
    {
        using var fixture = new Fixture();
        await using var directory = MacConsentDirectory.Open(fixture.Store);
        var path = Path.Combine(fixture.Store, "consent.json");
        using (var file = File.Create(path)) file.SetLength(4_194_305);
        if (OperatingSystem.IsMacOS()) File.SetUnixFileMode(path, (UnixFileMode)0x180);
        await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(Token).AsTask());
    }

    private static CancellationToken Token => TestContext.Current.CancellationToken;
    private static ConsentSnapshot Snapshot(long generation) => new(generation,
        new[] { new StoredConsent("https://darwin.example", "granted", false, DateTimeOffset.UnixEpoch, null, null) });
    private static async Task AddEveryoneReadAcl(string path)
    {
        var info = new ProcessStartInfo("/bin/chmod") { UseShellExecute = false };
        info.ArgumentList.Add("+a"); info.ArgumentList.Add("everyone allow read"); info.ArgumentList.Add(path);
        using var child = Process.Start(info)!;
        try { await child.WaitForExitAsync(Token).WaitAsync(TimeSpan.FromSeconds(5), Token); Assert.Equal(0, child.ExitCode); }
        finally { if (!child.HasExited) child.Kill(entireProcessTree: true); }
    }
    private sealed class Fixture : IDisposable
    {
        internal string Parent { get; }
        internal string Store => Path.Combine(Parent, "Application Support", "Zilo");
        internal Fixture()
        {
            var path = Directory.CreateTempSubdirectory("t11p-darwin-").FullName;
            var pointer = RealPath(path, 0); // fixture ONLY: /var and /tmp aliases cannot weaken production policy
            if (pointer == 0) throw new IOException("darwin-test-realpath-failed");
            try { Parent = Marshal.PtrToStringUTF8(pointer)!; }
            finally { Free(pointer); }
        }
        public void Dispose() => Directory.Delete(Parent, true);
        [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "realpath", SetLastError = true)] private static extern nint RealPath([MarshalAs(UnmanagedType.LPUTF8Str)] string path, nint buffer);
        [DllImport("/usr/lib/libSystem.B.dylib", EntryPoint = "free")] private static extern void Free(nint memory);
    }
}
