using System.Runtime.InteropServices;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class MacConsentGuardTests
{
    [Theory]
    [InlineData(Architecture.X64)]
    [InlineData(Architecture.Arm64)]
    public void Darwin_64_bit_ABIs_are_the_only_candidates(Architecture architecture)
    {
        MacConsentDirectory.RequirePlatform(true, architecture);
        Assert.Throws<PlatformNotSupportedException>(() => MacConsentDirectory.RequirePlatform(false, architecture));
    }

    [Theory]
    [InlineData(Architecture.X86)]
    [InlineData(Architecture.Arm)]
    [InlineData(Architecture.S390x)]
    public void Other_ABIs_fail_before_native_entry(Architecture architecture) =>
        Assert.Throws<PlatformNotSupportedException>(() => MacConsentDirectory.RequirePlatform(true, architecture));

    [Theory]
    [InlineData("apfs")]
    [InlineData("hfs")]
    public void Local_APFS_and_HFS_require_ownership_and_writable_mount(string type)
    {
        MacConsentDirectory.RequireFileSystem(type, 0x1000);
        Assert.Throws<IOException>(() => MacConsentDirectory.RequireFileSystem(type, 0));
        Assert.Throws<IOException>(() => MacConsentDirectory.RequireFileSystem(type, 0x201000));
        Assert.Throws<IOException>(() => MacConsentDirectory.RequireFileSystem(type, 0x1001));
    }

    [Theory]
    [InlineData("smbfs")]
    [InlineData("nfs")]
    [InlineData("afpfs")]
    [InlineData("webdav")]
    [InlineData("msdos")]
    [InlineData("exfat")]
    [InlineData("unknown")]
    public void Other_filesystems_do_not_inherit_Darwin_private_storage_guarantees(string type) =>
        Assert.Throws<IOException>(() => MacConsentDirectory.RequireFileSystem(type, 0x1000));

    [Fact]
    public void Failed_required_fullflush_never_silently_falls_back()
    {
        MacConsentDirectory.RequireFullFlushSuccess(0);
        var failure = Assert.Throws<IOException>(() => MacConsentDirectory.RequireFullFlushSuccess(-1));
        Assert.Contains("consent-fullflush-unsupported-or-failed", failure.Message, StringComparison.Ordinal);
    }
}
