using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
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

    [Fact]
    public void OpenAt_is_noncreating_three_argument_native_call()
    {
        var native = typeof(MacConsentDirectory).GetNestedType("Native", BindingFlags.NonPublic)!;
        var openAt = native.GetMethod("openat", BindingFlags.Static | BindingFlags.NonPublic)!;
        Assert.Equal(3, openAt.GetParameters().Length);
        Assert.Equal(new[] { typeof(int), typeof(string), typeof(int) },
            openAt.GetParameters().Select(parameter => parameter.ParameterType).ToArray());

        var source = FindSource();
        Assert.DoesNotContain("const int Create", source, StringComparison.Ordinal);
        Assert.DoesNotContain("const int Exclusive", source, StringComparison.Ordinal);
        Assert.DoesNotContain("O_CREAT", source, StringComparison.Ordinal);
        Assert.DoesNotContain("O_EXCL", source, StringComparison.Ordinal);
        var normalized = Regex.Replace(source, @"Fd\([^()]*\)", "fd");
        foreach (Match call in Regex.Matches(normalized, @"Native\.openat\s*\([^)]*\)"))
        {
            Assert.DoesNotMatch(@"(?<![0-9a-fA-F])0x200(?![0-9a-fA-F])", call.Value);
            Assert.DoesNotMatch(@"(?<![0-9a-fA-F])0x800(?![0-9a-fA-F])", call.Value);
            Assert.DoesNotMatch(@"\b(Create|Exclusive)\b", call.Value);
        }
        Assert.DoesNotMatch(@"Native\.openat\s*\([^)]*,[^)]*,[^)]*,", normalized);
    }

    [Fact(SkipUnless = nameof(UnixHost), Skip = "Managed Unix create options are not used on Windows")]
    public void New_file_creation_options_are_exclusive_private_and_read_write()
    {
        var options = MacConsentDirectory.CreateNewFileOptions();

        Assert.Equal(FileMode.CreateNew, options.Mode);
        Assert.Equal(FileAccess.ReadWrite, options.Access);
        Assert.Equal(FileShare.ReadWrite, options.Share);
        Assert.Equal((UnixFileMode?)(UnixFileMode.UserRead | UnixFileMode.UserWrite), options.UnixCreateMode);
    }

    public static bool WindowsHost => OperatingSystem.IsWindows();
    public static bool UnixHost => !OperatingSystem.IsWindows();

    [Fact(SkipUnless = nameof(WindowsHost), Skip = "UnixCreateMode is intentionally unavailable on Windows")]
    public void New_file_creation_options_reject_windows()
    {
        Assert.Throws<PlatformNotSupportedException>(() => MacConsentDirectory.CreateNewFileOptions());
    }

    [Fact]
    public void Managed_create_new_is_private_empty_and_exclusive_on_unix()
    {
        if (OperatingSystem.IsWindows()) return;

        var directory = Directory.CreateTempSubdirectory("mac-consent-guard-");
        var path = Path.Combine(directory.FullName, "new-file");
        try
        {
            using (var file = new FileStream(path, MacConsentDirectory.CreateNewFileOptions()))
            {
                Assert.Equal(0, file.Length);
                file.Write("original"u8);
                file.Flush(true);
            }

            var mode = File.GetUnixFileMode(path);
            var userBits = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            Assert.Equal(UnixFileMode.None, mode & (UnixFileMode)0x3f);
            Assert.Equal(UnixFileMode.None, mode & ~userBits);
            var contents = File.ReadAllBytes(path);

            var duplicate = Assert.Throws<IOException>(() =>
                new FileStream(path, MacConsentDirectory.CreateNewFileOptions()));
            Assert.Equal(17u, (uint)duplicate.HResult & 0xffffu);
            Assert.Equal(mode, File.GetUnixFileMode(path));
            Assert.Equal(contents, File.ReadAllBytes(path));
        }
        finally
        {
            Directory.Delete(directory.FullName, true);
        }
    }

    private static string FindSource()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var source = Path.Combine(directory.FullName, "src", "Zilo.Security", "Persistence", "MacConsentDirectory.cs");
            if (File.Exists(source)) return File.ReadAllText(source);
            directory = directory.Parent!;
        }
        throw new FileNotFoundException("MacConsentDirectory source was not found for the native ABI regression guard.");
    }
}
