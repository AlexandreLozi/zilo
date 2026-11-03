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
    public void Native_abi_layouts_are_explicit_and_rename_info_uses_full_dos_path_and_null_root()
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

        var root = @"C:\Löcal 🧪 State\Zilo";
        var target = root + "\\consent.json";
        var targetBytes = new System.Text.UnicodeEncoding(false, false, true).GetBytes(target);
        var info = WindowsConsentDirectory.BuildRenameInformation(root, "consent.json");
        Assert.Equal(1, info[0]);
        Assert.Equal(new byte[7], info[1..8]);
        Assert.Equal(nint.Zero, (nint)BitConverter.ToInt64(info, 8));
        Assert.Equal(targetBytes.Length, BitConverter.ToInt32(info, 16));
        Assert.Equal(targetBytes, info[20..^2]);
        Assert.Equal(new byte[] { 0, 0 }, info[^2..]);
        Assert.Equal(20 + targetBytes.Length + 2, info.Length);
        Assert.Equal((ushort)'C', BitConverter.ToUInt16(info, 20));
        Assert.Equal((ushort)':', BitConverter.ToUInt16(info, 22));
    }

    [Theory]
    [InlineData("relative")]
    [InlineData(@"\\server\share\Local")]
    [InlineData(@"\\?\C:\Local")]
    [InlineData(@"C:\Local\..\State")]
    [InlineData("C:\\Local\0State")]
    public void Rename_info_rejects_noncanonical_or_unpaired_root(string root)
    {
        Assert.Throws<IOException>(() => WindowsConsentDirectory.BuildRenameInformation(root, "consent.json"));
    }

    [Fact]
    public void Rename_info_rejects_unpaired_utf16_without_replacement()
    {
        foreach (var surrogate in new[] { '\uD800', '\uDC00' })
            Assert.Throws<IOException>(() => WindowsConsentDirectory.BuildRenameInformation(
                "C:\\Local" + surrogate + "State", "consent.json"));
    }

    [Theory]
    [InlineData("consent.lock")]
    [InlineData("consent.tmp")]
    [InlineData("../consent.json")]
    [InlineData(@"C:\Local\consent.json")]
    [InlineData("consent.json:stream")]
    public void Rename_info_rejects_non_fixed_target_names(string name)
    {
        Assert.Throws<IOException>(() => WindowsConsentDirectory.BuildRenameInformation(@"C:\Local\State\Zilo", name));
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
            AssertReady(await session.OpenAsync(Token));
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
        AssertReady(result);
        Assert.Equal("granted", Assert.Single(result.Snapshot!.Records).State);
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_fresh_directory_direct_fence_replace_roundtrips_bytes()
    {
        using var fixture = new Fixture();
        var token = TestContext.Current.CancellationToken;
        await using var directory = WindowsConsentDirectory.Open(fixture.Store);

        var fresh = await directory.ReadAsync(token);
        Assert.Null(fresh.Snapshot);
        Assert.Null(fresh.Fence);
        Assert.False(fresh.InterruptedArtifacts);

        var dirtyMarker = System.Text.Encoding.UTF8.GetBytes("zilo-consent-session-v1\n");
        await directory.ReplaceAsync("session.fence", dirtyMarker, token);
        var readback = await directory.ReadAsync(token);
        Assert.Equal(dirtyMarker, readback.Fence);
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
            AssertReady(await session.OpenAsync(Token));
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
            AssertReady(await session.OpenAsync(Token));
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
            AssertReady(await session.OpenAsync(Token));
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
            AssertReady(await session.OpenAsync(Token));
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
            AssertReady(await session.OpenAsync(Token));
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

    [Theory(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Native_foreign_administrators_owner_is_rejected_without_repair(bool mutateRoot)
    {
        using var fixture = new Fixture();
        await CreateCleanStore(fixture);
        var user = CurrentUserSid();
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        Assert.NotEqual(user, administrators);

        if (mutateRoot)
        {
            var root = new DirectoryInfo(fixture.Store);
            try
            {
                SetOwner(root, administrators);
                Assert.Equal(administrators, root.GetAccessControl().GetOwner(typeof(SecurityIdentifier)));
                Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(fixture.Store));
                Assert.Equal(administrators, root.GetAccessControl().GetOwner(typeof(SecurityIdentifier)));
            }
            finally
            {
                SetOwner(root, user);
            }
        }
        else
        {
            var snapshot = new FileInfo(Path.Combine(fixture.Store, "consent.json"));
            try
            {
                SetOwner(snapshot, administrators);
                Assert.Equal(administrators, snapshot.GetAccessControl().GetOwner(typeof(SecurityIdentifier)));
                try
                {
                    await using var directory = WindowsConsentDirectory.Open(fixture.Store);
                    await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(Token).AsTask());
                    await using var session = new ConsentSession(directory);
                    Assert.Equal(ConsentStorageHealth.Unavailable, (await session.OpenAsync(Token)).Health);
                }
                finally
                {
                    Assert.Equal(administrators, snapshot.GetAccessControl().GetOwner(typeof(SecurityIdentifier)));
                }
            }
            finally
            {
                SetOwner(snapshot, user);
            }
        }
    }

    [Theory(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    [InlineData("inherited", true)]
    [InlineData("inherited", false)]
    [InlineData("deny", true)]
    [InlineData("deny", false)]
    [InlineData("everyone", true)]
    [InlineData("everyone", false)]
    [InlineData("callback", true)]
    [InlineData("callback", false)]
    public async Task Native_foreign_ace_kind_is_rejected_without_repair(string kind, bool mutateRoot)
    {
        using var fixture = new Fixture();
        await CreateCleanStore(fixture);
        var user = CurrentUserSid();
        var path = mutateRoot ? fixture.Store : Path.Combine(fixture.Store, "consent.json");
        var beforeMutation = ReadSecurityDescriptor(path, mutateRoot);
        try
        {
            AddRawAce(path, mutateRoot, BuildFixtureAce(kind, user));
            var fixtureDescriptor = ReadSecurityDescriptor(path, mutateRoot);
            AssertFixtureAce(fixtureDescriptor, kind, user);

            if (mutateRoot)
            {
                Assert.Throws<IOException>(() => WindowsConsentDirectory.Open(fixture.Store));
            }
            else
            {
                await using var directory = WindowsConsentDirectory.Open(fixture.Store);
                await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(Token).AsTask());
                await using var session = new ConsentSession(directory);
                Assert.Equal(ConsentStorageHealth.Unavailable, (await session.OpenAsync(Token)).Health);
            }

            Assert.Equal(fixtureDescriptor, ReadSecurityDescriptor(path, mutateRoot));
        }
        finally
        {
            SetSecurityDescriptor(path, mutateRoot, beforeMutation);
        }
    }

    [Fact(SkipUnless = nameof(WindowsHost), Skip = NativeSkip)]
    public async Task Native_external_target_handle_causes_sticky_sharing_failure_without_retry()
    {
        using var fixture = new Fixture();
        await CreateCleanStore(fixture);
        var snapshotPath = Path.Combine(fixture.Store, "consent.json");
        var trace = new List<WindowsConsentWriteStage>();
        byte[] oldBytes;

        await using (var directory = WindowsConsentDirectory.Open(fixture.Store, trace.Add))
        {
            await using var session = new ConsentSession(directory);
            var opened = await session.OpenAsync(Token);
            AssertReady(opened);
            oldBytes = await File.ReadAllBytesAsync(snapshotPath, Token);

            using (var blocker = new FileStream(snapshotPath, FileMode.Open, FileAccess.Read,
                       FileShare.Read | FileShare.Write))
            {
                trace.Clear();
                var error = await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(2), Token).AsTask());
                Assert.True(error.Message.EndsWith(":32", StringComparison.Ordinal) ||
                            error.Message.EndsWith(":5", StringComparison.Ordinal), error.Message);
                Assert.Contains(WindowsConsentWriteStage.BeforeRename, trace);
                Assert.DoesNotContain(WindowsConsentWriteStage.BeforeFinalFlush, trace);
                Assert.True(File.Exists(Path.Combine(fixture.Store, "consent.tmp")));
                Assert.Equal(oldBytes, await File.ReadAllBytesAsync(snapshotPath, Token));
                await Assert.ThrowsAsync<InvalidOperationException>(() => session.CompleteAsync(1, Token).AsTask());
            }

            await Assert.ThrowsAsync<IOException>(() => directory.ReadAsync(Token).AsTask());
            await Assert.ThrowsAsync<IOException>(() => directory.ReplaceAsync(
                "consent.json", ConsentSnapshotCodec.Encode(Snapshot(3)), Token).AsTask());
        }

        Assert.True(File.Exists(Path.Combine(fixture.Store, "consent.tmp")));
        Assert.Equal(oldBytes, await File.ReadAllBytesAsync(snapshotPath, Token));
        await using var reopenedDirectory = WindowsConsentDirectory.Open(fixture.Store);
        var reopenedContents = await reopenedDirectory.ReadAsync(Token);
        Assert.True(reopenedContents.InterruptedArtifacts);
        Assert.Equal(oldBytes, reopenedContents.Snapshot);
        var reopened = new ConsentSession(reopenedDirectory);
        await using (reopened)
        {
            var result = await reopened.OpenAsync(Token);
            Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
            Assert.Equal("consent-interrupted-state", result.DiagnosticCode);
        }
        Assert.Equal(oldBytes, await File.ReadAllBytesAsync(snapshotPath, Token));
    }

    private static CancellationToken Token => TestContext.Current.CancellationToken;
    private static ConsentSnapshot Snapshot(long generation) => new(generation,
        new[] { new StoredConsent("https://windows.example", "granted", false, DateTimeOffset.UnixEpoch, null, null) });

    private static void AssertReady(ConsentOpenResult result) =>
        Assert.True(result.Health == ConsentStorageHealth.Ready,
            $"Expected Ready, got {result.Health}; DiagnosticCode={result.DiagnosticCode ?? "<null>"}");

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

    private static async Task CreateCleanStore(Fixture fixture)
    {
        await using var session = new ConsentSession(WindowsConsentDirectory.Open(fixture.Store));
        AssertReady(await session.OpenAsync(Token));
        await session.CompleteAsync(1, Token);
    }

    private static SecurityIdentifier CurrentUserSid()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return identity.User ?? throw new InvalidOperationException("missing-current-user");
    }

    private static void SetOwner(DirectoryInfo target, SecurityIdentifier owner)
    {
        var security = target.GetAccessControl();
        security.SetOwner(owner);
        target.SetAccessControl(security);
    }

    private static void SetOwner(FileInfo target, SecurityIdentifier owner)
    {
        var security = target.GetAccessControl();
        security.SetOwner(owner);
        target.SetAccessControl(security);
    }

    private static GenericAce BuildFixtureAce(string kind, SecurityIdentifier user) => kind switch
    {
        "inherited" => new CommonAce(AceFlags.Inherited, AceQualifier.AccessAllowed, 0x80, user, false, null),
        "deny" => new CommonAce(AceFlags.None, AceQualifier.AccessDenied, 0x10, user, false, null),
        "everyone" => new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x80,
            new SecurityIdentifier(WellKnownSidType.WorldSid, null), false, null),
        "callback" => new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x80, user, true, null),
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };

    private static void AddRawAce(string path, bool directory, GenericAce ace)
    {
        var descriptor = new RawSecurityDescriptor(ReadSecurityDescriptor(path, directory), 0);
        Assert.True(descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected));
        Assert.NotNull(descriptor.DiscretionaryAcl);
        var existing = descriptor.DiscretionaryAcl!;
        var updatedAcl = new RawAcl(existing.Revision, existing.BinaryLength + ace.BinaryLength);
        for (var i = 0; i < existing.Count; i++) updatedAcl.InsertAce(i, existing[i]);
        updatedAcl.InsertAce(ace is CommonAce { AceType: AceType.AccessDenied } ? 0 : existing.Count, ace);
        var updated = new RawSecurityDescriptor(descriptor.ControlFlags, descriptor.Owner, descriptor.Group,
            descriptor.SystemAcl, updatedAcl);
        var bytes = new byte[updated.BinaryLength];
        updated.GetBinaryForm(bytes, 0);
        SetSecurityDescriptor(path, directory, bytes);
    }

    private static void AssertFixtureAce(byte[] descriptorBytes, string kind, SecurityIdentifier user)
    {
        var descriptor = new RawSecurityDescriptor(descriptorBytes, 0);
        Assert.True(descriptor.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected));
        Assert.Equal(user, descriptor.Owner);
        var ace = Assert.Single(descriptor.DiscretionaryAcl!.Cast<GenericAce>(), candidate =>
            candidate is CommonAce common && kind switch
            {
                "inherited" => common.AceType == AceType.AccessAllowed && common.AceFlags == AceFlags.Inherited &&
                    common.AceQualifier == AceQualifier.AccessAllowed && common.AccessMask == 0x80 &&
                    !common.IsCallback && common.SecurityIdentifier == user,
                "deny" => common.AceType == AceType.AccessDenied && common.AceFlags == AceFlags.None &&
                    common.AceQualifier == AceQualifier.AccessDenied && common.AccessMask == 0x10 &&
                    !common.IsCallback && common.SecurityIdentifier == user,
                "everyone" => common.AceType == AceType.AccessAllowed && common.AceFlags == AceFlags.None &&
                    common.AceQualifier == AceQualifier.AccessAllowed && common.AccessMask == 0x80 &&
                    !common.IsCallback && common.SecurityIdentifier == new SecurityIdentifier(WellKnownSidType.WorldSid, null),
                "callback" => common.AceType == AceType.AccessAllowedCallback && common.AceFlags == AceFlags.None &&
                    common.AceQualifier == AceQualifier.AccessAllowed && common.AccessMask == 0x80 &&
                    common.IsCallback && common.SecurityIdentifier == user,
                _ => false
            });
        Assert.NotNull(ace);
    }

    private static byte[] ReadSecurityDescriptor(string path, bool directory) =>
        directory ? new DirectoryInfo(path).GetAccessControl().GetSecurityDescriptorBinaryForm() :
        new FileInfo(path).GetAccessControl().GetSecurityDescriptorBinaryForm();

    private static void SetSecurityDescriptor(string path, bool directory, byte[] descriptor)
    {
        if (directory)
        {
            var security = new DirectoryInfo(path).GetAccessControl();
            security.SetSecurityDescriptorBinaryForm(descriptor);
            new DirectoryInfo(path).SetAccessControl(security);
        }
        else
        {
            var security = new FileInfo(path).GetAccessControl();
            security.SetSecurityDescriptorBinaryForm(descriptor);
            new FileInfo(path).SetAccessControl(security);
        }
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
