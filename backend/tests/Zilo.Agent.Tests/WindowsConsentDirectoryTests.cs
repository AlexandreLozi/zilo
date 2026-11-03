using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

#pragma warning disable CA1416

public sealed class WindowsConsentDirectoryTests
{
    public static bool WindowsHost => OperatingSystem.IsWindows() &&
        RuntimeInformation.ProcessArchitecture is Architecture.X64 or Architecture.Arm64;
    public static bool NonWindowsHost => !OperatingSystem.IsWindows();

    private const string NativeSkip = "Windows-native evidence requires hosted Windows x64/arm64; local Linux only validates guards and ABI helpers";

    [Fact]
    public void Guard_rejects_non_windows_and_non_64_bit_before_native_entry()
    {
        Assert.Throws<PlatformNotSupportedException>(() =>
            WindowsConsentDirectory.RequireSupportedPlatform(false, Architecture.X64));
        Assert.Throws<PlatformNotSupportedException>(() =>
            WindowsConsentDirectory.RequireSupportedPlatform(true, Architecture.X86));
        Assert.Throws<PlatformNotSupportedException>(() =>
            WindowsConsentDirectory.RequireSupportedPlatform(true, Architecture.Arm));
    }

    [Theory]
    [InlineData(@"C:\Users\alice\AppData\Local", @"C:\Users\alice\AppData\Local\Zilo")]
    [InlineData(@"D:\Local State", @"D:\Local State\Zilo")]
    public void Root_resolution_uses_the_current_users_local_appdata(string localAppData, string expected)
    {
        Assert.Equal(expected, WindowsConsentDirectory.ResolveRoot(localAppData));
    }

    [Theory]
    [InlineData(@"relative")]
    [InlineData(@"\\server\share\Local")]
    [InlineData(@"\\?\C:\Local")]
    [InlineData(@"\\.\C:\Local")]
    [InlineData(@"C:\Local\..\State")]
    [InlineData(@"C:\Local.\State")]
    [InlineData(@"C:\Local\State ")]
    [InlineData(@"C:\Local\State:stream")]
    [InlineData("C:\\Local\0State")]
    public void Root_resolution_rejects_noncanonical_or_unsafe_windows_paths(string path)
    {
        Assert.Throws<IOException>(() => WindowsConsentDirectory.ResolveRoot(path));
    }

    [Fact]
    public void Native_abi_layouts_are_explicit_and_rename_info_is_handle_relative()
    {
        var type = typeof(WindowsConsentDirectory);
        var securityAttributes = type.GetNestedType("SecurityAttributes", BindingFlags.NonPublic)!;
        var byHandle = type.GetNestedType("ByHandleFileInformation", BindingFlags.NonPublic)!;
        Assert.Equal(24, Marshal.SizeOf(securityAttributes));
        Assert.Equal(52, Marshal.SizeOf(byHandle));
        Assert.Equal(8, Marshal.OffsetOf(securityAttributes, "SecurityDescriptor").ToInt32());
        Assert.Equal(16, Marshal.OffsetOf(securityAttributes, "InheritHandle").ToInt32());
        Assert.Equal(28, Marshal.OffsetOf(byHandle, "VolumeSerialNumber").ToInt32());
        Assert.Equal(40, Marshal.OffsetOf(byHandle, "NumberOfLinks").ToInt32());
        Assert.Equal(44, Marshal.OffsetOf(byHandle, "FileIndexHigh").ToInt32());
        Assert.Equal(48, Marshal.OffsetOf(byHandle, "FileIndexLow").ToInt32());

        var info = WindowsConsentDirectory.BuildRenameInformation(unchecked((nint)0x1122334455667788), "consent.json");
        Assert.Equal(1, info[0]);
        Assert.Equal(unchecked((nint)0x1122334455667788), (nint)BitConverter.ToInt64(info, 8));
        Assert.Equal("consent.json".Length * 2, BitConverter.ToInt32(info, 16));
        Assert.Equal((ushort)'c', BitConverter.ToUInt16(info, 20));
        Assert.Throws<IOException>(() => WindowsConsentDirectory.BuildRenameInformation(nint.Zero, "consent.lock"));
    }

    [Fact]
    public void Supported_64_bit_architectures_are_accepted_and_other_architectures_rejected()
    {
        WindowsConsentDirectory.RequireSupportedPlatform(true, Architecture.X64);
        WindowsConsentDirectory.RequireSupportedPlatform(true, Architecture.Arm64);
        Assert.Throws<PlatformNotSupportedException>(() =>
            WindowsConsentDirectory.RequireSupportedPlatform(true, Architecture.S390x));
    }

    [Fact(SkipUnless = nameof(NonWindowsHost), Skip = "This verifies Open's pre-native non-Windows guard")]
    public void Open_rejects_non_windows_before_identity_or_native_entry()
    {
        Assert.Throws<PlatformNotSupportedException>(() =>
            WindowsConsentDirectory.Open(@"C:\Users\test\AppData\Local\Zilo"));
    }

    [Fact]
    public void Private_fixed_name_guard_accepts_lifetime_lock()
    {
        var guard = typeof(WindowsConsentDirectory).GetMethod("ValidateFixedName", BindingFlags.NonPublic | BindingFlags.Static)!;
        guard.Invoke(null, new object[] { "consent.lock" });
    }

    [Fact]
    public void Volume_information_import_uses_unicode_exact_abi()
    {
        var native = typeof(WindowsConsentDirectory).GetNestedType("Native", BindingFlags.NonPublic)!;
        var method = native.GetMethod("GetVolumeInformationByHandleW", BindingFlags.NonPublic | BindingFlags.Static)!;
        var import = method.GetCustomAttribute<DllImportAttribute>()!;
        Assert.Equal(CharSet.Unicode, import.CharSet);
        Assert.True(import.ExactSpelling);
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_private_store_roundtrips_and_retains_exclusive_lock()
    {
        using var fixture = new Fixture();
        var trace = new List<WindowsConsentWriteStage>();
        await using (var directory = WindowsConsentDirectory.Open(fixture.Store, trace.Add))
        {
            await using var session = new ConsentSession(directory);
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            trace.Clear();
            await session.WriteAsync(Snapshot(2), Token);
            // This is an authored checkpoint trace, not proof that the native flush completed.
            Assert.Equal(Enum.GetValues<WindowsConsentWriteStage>(), trace);
            await session.CompleteAsync(2, Token);
            AssertExactPrivateAcl(fixture.Store, directory: true);
            AssertExactPrivateAcl(Path.Combine(fixture.Store, "consent.lock"), directory: false);
            AssertExactPrivateAcl(Path.Combine(fixture.Store, "consent.json"), directory: false);
            AssertExactPrivateAcl(Path.Combine(fixture.Store, "session.fence"), directory: false);
        }

        await using var reopened = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store));
        var result = await reopened.OpenAsync(Token);
        Assert.Equal(ConsentStorageHealth.Ready, result.Health);
        Assert.Equal("granted", Assert.Single(result.Snapshot!.Records).State);
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_second_session_cannot_acquire_lock_until_disposal()
    {
        using var fixture = new Fixture();
        var first = WindowsConsentDirectory.Open(fixture.Store);
        try
        {
            Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(fixture.Store));
        }
        finally
        {
            await first.DisposeAsync();
        }
        await using var next = WindowsConsentDirectory.Open(fixture.Store);
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_root_is_owned_and_protected_and_cannot_be_renamed_while_pinned()
    {
        using var fixture = new Fixture();
        await using var directory = WindowsConsentDirectory.Open(fixture.Store);
        var acl = new DirectoryInfo(fixture.Store).GetAccessControl();
        using var identity = WindowsIdentity.GetCurrent();
        Assert.True(acl.AreAccessRulesProtected);
        Assert.Equal(identity.User, acl.GetOwner(typeof(SecurityIdentifier)));
        Assert.Throws<IOException>(() => Directory.Move(fixture.Store, fixture.Store + "-moved"));
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_oversize_snapshot_is_rejected_before_read_allocation()
    {
        using var fixture = new Fixture();
        await using (var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store)))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            await session.CompleteAsync(1, Token);
        }
        using (var stream = new FileStream(Path.Combine(fixture.Store, "consent.json"), FileMode.Open, FileAccess.Write, FileShare.ReadWrite))
            stream.SetLength(ConsentSnapshotCodec.MaxBytes + 1);
        await using var directory = WindowsConsentDirectory.Open(fixture.Store);
        await using var reopened = new ConsentSession(directory);
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopened.OpenAsync(Token)).Health);
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_unknown_dacl_principal_is_rejected_without_repair()
    {
        using var fixture = new Fixture();
        await using (var directory = WindowsConsentDirectory.Open(fixture.Store)) { }
        var directoryInfo = new DirectoryInfo(fixture.Store);
        var security = directoryInfo.GetAccessControl();
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null),
            FileSystemRights.Read, AccessControlType.Allow));
        directoryInfo.SetAccessControl(security);
        Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(fixture.Store));
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_reparse_snapshot_is_rejected_and_victim_is_untouched()
    {
        using var fixture = new Fixture();
        await using (var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store)))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            await session.CompleteAsync(1, Token);
        }
        var victim = Path.Combine(fixture.Parent, "victim");
        await File.WriteAllTextAsync(victim, "untouched", Token);
        File.Delete(Path.Combine(fixture.Store, "consent.json"));
        File.CreateSymbolicLink(Path.Combine(fixture.Store, "consent.json"), victim);
        await using var directory = WindowsConsentDirectory.Open(fixture.Store);
        await using var reopened = new ConsentSession(directory);
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopened.OpenAsync(Token)).Health);
        Assert.Equal("untouched", await File.ReadAllTextAsync(victim, Token));
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_flush_failure_leaves_dirty_temp_evidence_and_unclean_reopen()
    {
        using var fixture = new Fixture();
        var armed = false;
        await using (var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store, stage =>
        {
            if (armed && stage == WindowsConsentWriteStage.BeforeFlush) throw new IOException("simulated-flush-failure");
        })))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            armed = true;
            await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2), Token).AsTask());
        }
        Assert.True(File.Exists(Path.Combine(fixture.Store, "consent.tmp")));
        await using var reopened = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store));
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopened.OpenAsync(Token)).Health);
    }

    [Theory(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    [InlineData((int)WindowsConsentWriteStage.BeforeFlush)]
    [InlineData((int)WindowsConsentWriteStage.BeforeRename)]
    [InlineData((int)WindowsConsentWriteStage.BeforeFinalFlush)]
    public async Task Native_authored_checkpoint_faults_leave_session_unavailable_and_preserve_expected_evidence(int stageValue)
    {
        using var fixture = new Fixture();
        var stage = (WindowsConsentWriteStage)stageValue;
        var armed = false;
        await using (var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store, checkpoint =>
        {
            // This is an authored injection point, not evidence of a kernel-level flush failure.
            if (armed && checkpoint == stage) throw new IOException("simulated-checkpoint-failure");
        })))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            armed = true;
            await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2), Token).AsTask());
            await Assert.ThrowsAsync<InvalidOperationException>(() => session.CompleteAsync(1, Token).AsTask());
        }

        var temp = Path.Combine(fixture.Store, "consent.tmp");
        Assert.Equal(stage != WindowsConsentWriteStage.BeforeFinalFlush, File.Exists(temp));
        await using var reopened = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store));
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopened.OpenAsync(Token)).Health);
    }

    [Theory(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public async Task Native_null_or_unprotected_root_and_lock_dacls_are_rejected_without_repair(bool nullDacl, bool mutateRoot)
    {
        using var fixture = new Fixture();
        await using (var directory = WindowsConsentDirectory.Open(fixture.Store)) { }
        var root = new DirectoryInfo(fixture.Store);
        var lockFile = new FileInfo(Path.Combine(fixture.Store, "consent.lock"));
        var originalRoot = root.GetAccessControl();
        var originalLock = lockFile.GetAccessControl();
        try
        {
            if (mutateRoot) SetUnsafeDacl(root, nullDacl);
            else SetUnsafeDacl(lockFile, nullDacl);
            var mutated = mutateRoot ? (ObjectSecurity)root.GetAccessControl() : lockFile.GetAccessControl();
            var raw = new RawSecurityDescriptor(mutated.GetSecurityDescriptorBinaryForm(), 0);
            if (nullDacl) Assert.Null(raw.DiscretionaryAcl);
            else Assert.False(mutated.AreAccessRulesProtected);
            Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(fixture.Store));
        }
        finally
        {
            root.SetAccessControl(originalRoot);
            lockFile.SetAccessControl(originalLock);
        }
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_snapshot_hardlink_is_rejected_and_victim_bytes_remain_unchanged()
    {
        using var fixture = new Fixture();
        await using (var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store)))
        {
            Assert.Equal(ConsentStorageHealth.Ready, (await session.OpenAsync(Token)).Health);
            await session.CompleteAsync(1, Token);
        }
        var snapshot = Path.Combine(fixture.Store, "consent.json");
        var victim = Path.Combine(fixture.Parent, "victim.json");
        File.Move(snapshot, victim);
        var before = await File.ReadAllBytesAsync(victim, Token);
        Assert.True(CreateHardLinkW(snapshot, victim, nint.Zero), Marshal.GetLastPInvokeError().ToString());
        await using var directory = WindowsConsentDirectory.Open(fixture.Store);
        await using var reopened = new ConsentSession(directory);
        Assert.Equal(ConsentStorageHealth.Unavailable, (await reopened.OpenAsync(Token)).Health);
        Assert.Equal(before, await File.ReadAllBytesAsync(victim, Token));
    }

    [Theory(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    [InlineData(true)]
    [InlineData(false)]
    public void Native_directory_reparse_ancestors_are_rejected_without_creating_new_store(bool rootLink)
    {
        using var fixture = new Fixture();
        var target = Path.Combine(fixture.Parent, rootLink ? "root-target" : "ancestor-target");
        Directory.CreateDirectory(target);
        var sentinel = Path.Combine(target, "sentinel");
        File.WriteAllText(sentinel, "untouched");
        var link = Path.Combine(fixture.Parent, rootLink ? "root-link" : "ancestor-link");
        Directory.CreateSymbolicLink(link, target);
        var requested = rootLink ? link : Path.Combine(link, "new-store");
        try
        {
            Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(requested));
            Assert.False(Directory.Exists(Path.Combine(target, rootLink ? "Zilo" : "new-store")));
            Assert.Equal("untouched", File.ReadAllText(sentinel));
        }
        finally
        {
            if (Directory.Exists(link)) Directory.Delete(link);
        }
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_failed_open_unwinds_all_directory_handles()
    {
        using var fixture = new Fixture();
        var created = WindowsConsentDirectory.Open(fixture.Store);
        await created.DisposeAsync();
        var root = new DirectoryInfo(fixture.Store);
        var saved = root.GetAccessControl();
        try
        {
            var security = root.GetAccessControl();
            security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                FileSystemRights.Read, AccessControlType.Allow));
            root.SetAccessControl(security);
            Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(fixture.Store));
            var moved = fixture.Store + "-moved";
            Directory.Move(fixture.Store, moved);
            Directory.Move(moved, fixture.Store);
        }
        finally
        {
            root.SetAccessControl(saved);
        }
    }

    private static CancellationToken Token => TestContext.Current.CancellationToken;
    private static ConsentSnapshot Snapshot(long generation) => new(generation,
        new[] { new StoredConsent("https://windows.example", "granted", false, DateTimeOffset.UnixEpoch, null, null) });

    private static void SetUnsafeDacl(DirectoryInfo target, bool nullDacl)
    {
        var security = target.GetAccessControl();
        if (nullDacl)
        {
            using var identity = WindowsIdentity.GetCurrent();
            security.SetSecurityDescriptorSddlForm($"O:{identity.User!.Value}D:NO_ACCESS_CONTROL");
        }
        else security.SetAccessRuleProtection(false, preserveInheritance: true);
        target.SetAccessControl(security);
    }

    private static void SetUnsafeDacl(FileInfo target, bool nullDacl)
    {
        var security = target.GetAccessControl();
        if (nullDacl)
        {
            using var identity = WindowsIdentity.GetCurrent();
            security.SetSecurityDescriptorSddlForm($"O:{identity.User!.Value}D:NO_ACCESS_CONTROL");
        }
        else security.SetAccessRuleProtection(false, preserveInheritance: true);
        target.SetAccessControl(security);
    }

    private static void AssertExactPrivateAcl(string path, bool directory)
    {
        ObjectSecurity security = directory ? new DirectoryInfo(path).GetAccessControl() : new FileInfo(path).GetAccessControl();
        using var identity = WindowsIdentity.GetCurrent();
        var user = identity.User!;
        Assert.True(security.AreAccessRulesProtected);
        Assert.Equal(user, security.GetOwner(typeof(SecurityIdentifier)));
        var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            user.Value,
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null).Value,
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Value
        };
        var rules = (directory
                ? new DirectoryInfo(path).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier))
                : new FileInfo(path).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)))
            .Cast<FileSystemAccessRule>().ToArray();
        Assert.All(rules, rule => Assert.Equal(AccessControlType.Allow, rule.AccessControlType));
        var actual = rules.Select(rule => ((SecurityIdentifier)rule.IdentityReference).Value)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.Equal(expected.Count, actual.Count);
        Assert.True(expected.SetEquals(actual));
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _parent = Path.Combine(Path.GetTempPath(), "t11p-windows-" + Guid.NewGuid().ToString("N"));
        internal string Parent => _parent;
        internal string Store => Path.Combine(_parent, "Local", "Zilo");

        internal Fixture()
        {
            Directory.CreateDirectory(Path.Combine(_parent, "Local"));
        }

        public void Dispose()
        {
            if (Directory.Exists(_parent)) Directory.Delete(_parent, true);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string fileName, string existingFileName, nint securityAttributes);
}
