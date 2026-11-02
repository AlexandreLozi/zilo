using System.Diagnostics;
using System.Runtime.InteropServices;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class LinuxConsentReviewTests
{
    public static bool HasSetfacl => OperatingSystem.IsLinux() && RuntimeInformation.ProcessArchitecture == Architecture.X64 && File.Exists("/usr/bin/setfacl");
    public static bool HasSharedMemoryDirectory => OperatingSystem.IsLinux() && RuntimeInformation.ProcessArchitecture == Architecture.X64 && Directory.Exists("/dev/shm");

    [Fact(SkipUnless = nameof(HasSetfacl), Skip = "setfacl unavailable (or unsupported platform): real named/default POSIX ACL evidence not run")]
    public async Task Real_named_and_default_POSIX_ACLs_are_rejected_or_masked()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException();
        using var fixture = new PrivateFixture();
        var root = Path.Combine(fixture.Path, "zilo");
        Directory.CreateDirectory(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        await SetAcl("u:65534:rwx", root);
        Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(root));
        // chmod changes the effective ACL mask; no production automatic chmod is allowed.
        File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        await SetAcl("d:u::rwx,d:u:65534:rwx,d:g::---,d:m::rwx,d:o::---", root);
        await using var session = new ConsentSession(LinuxConsentDirectory.Open(root));
        Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(TestContext.Current.CancellationToken)).Health);
        foreach (var name in new[] { "consent.lock", "consent.json", "session.fence" })
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(root, name)));
    }

    private static async Task SetAcl(string acl, string path)
    {
        var info = new ProcessStartInfo("/usr/bin/setfacl") { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true };
        info.ArgumentList.Add("-m"); info.ArgumentList.Add(acl); info.ArgumentList.Add(path);
        using var child = Process.Start(info)!;
        var stderr = child.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        var stdout = child.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        await child.WaitForExitAsync(TestContext.Current.CancellationToken).WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        Assert.Equal(0, child.ExitCode);
        Assert.Empty(await stderr);
        _ = await stdout;
    }

    [Fact(SkipUnless = nameof(HasSharedMemoryDirectory), Skip = "No /dev/shm on supported Linux x64: real tmpfs evidence unavailable")]
    public async Task Real_tmpfs_descriptor_is_allowed_but_explicitly_volatile()
    {
        var root = Path.Combine("/dev/shm", "t11p-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using var directory = LinuxConsentDirectory.Open(root);
            Assert.True(directory.IsVolatile);
            await using var session = new ConsentSession(directory);
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(TestContext.Current.CancellationToken)).Health);
            await session.CompleteAsync(1, TestContext.Current.CancellationToken);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Theory]
    [InlineData(Architecture.Arm64)]
    [InlineData(Architecture.Arm)]
    [InlineData(Architecture.X86)]
    [InlineData(Architecture.S390x)]
    public void Non_x64_architecture_is_rejected_by_pre_syscall_guard(Architecture architecture)
    {
        var failure = Assert.Throws<PlatformNotSupportedException>(() => LinuxConsentDirectory.RequireSupportedPlatform(true, architecture));
        Assert.Contains("consent-linux-x64-only", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Only_linux_x64_reaches_native_adapter()
    {
        LinuxConsentDirectory.RequireSupportedPlatform(true, Architecture.X64);
        Assert.Throws<PlatformNotSupportedException>(() => LinuxConsentDirectory.RequireSupportedPlatform(false, Architecture.X64));
    }

    [Theory]
    [InlineData(0xEF53L, false)]
    [InlineData(0x58465342L, false)]
    [InlineData(0x9123683EL, false)]
    [InlineData(0xF2F52010L, false)]
    [InlineData(0x01021994L, true)]
    public void Only_explicit_local_filesystems_are_supported(long magic, bool volatileStore)
    {
        Assert.Equal(volatileStore, LinuxConsentDirectory.RequireFileSystem(magic));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(0x6969L)] // NFS
    [InlineData(0xFF534D42L)] // CIFS
    [InlineData(0x65735546L)] // FUSE
    [InlineData(0x2FC12FC1L)] // ZFS
    [InlineData(0x794C7630L)] // overlayfs: not on this deliberately narrow allowlist
    public void Unknown_network_and_other_ACL_models_fail_closed(long magic)
    {
        var failure = Assert.Throws<IOException>(() => LinuxConsentDirectory.RequireFileSystem(magic));
        Assert.Contains("consent-filesystem-unsupported", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Symlinked_home_style_ancestor_has_specific_unsupported_diagnostic()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new PrivateFixture();
        var real = Path.Combine(fixture.Path, "real-home");
        Directory.CreateDirectory(real);
        var link = Path.Combine(fixture.Path, "home");
        Directory.CreateSymbolicLink(link, real);
        var failure = Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(Path.Combine(link, "zilo")));
        Assert.Contains("consent-symlink-ancestor-unsupported", failure.Message, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(real, "zilo")));
    }

    [Fact]
    public void Group_writable_0775_ancestor_requires_maintenance_not_automatic_chmod()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var fixture = new PrivateFixture();
        var mode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
            UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;
        File.SetUnixFileMode(fixture.Path, mode);
        var failure = Assert.Throws<IOException>(() => LinuxConsentDirectory.Open(Path.Combine(fixture.Path, "zilo")));
        Assert.Contains("consent-ancestor-writable", failure.Message, StringComparison.Ordinal);
        Assert.Equal(mode, File.GetUnixFileMode(fixture.Path));
        Assert.False(Directory.Exists(Path.Combine(fixture.Path, "zilo")));
    }

    private sealed class PrivateFixture : IDisposable
    {
        internal string Path { get; } = Directory.CreateTempSubdirectory("t11p-review-").FullName;
        public void Dispose() => Directory.Delete(Path, true);
    }
}
