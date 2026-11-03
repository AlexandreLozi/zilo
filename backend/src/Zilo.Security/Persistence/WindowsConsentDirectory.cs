using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Zilo.Security.Persistence;

#pragma warning disable CA1416

internal enum WindowsConsentWriteStage { BeforeFlush, BeforeRename, BeforeFinalFlush }

internal sealed class WindowsConsentDirectory : IPrivateConsentDirectory
{
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint Delete = 0x00010000;
    private const uint ReadControl = 0x00020000;
    private const uint FileReadAttributes = 0x00000080;
    private const uint Synchronize = 0x00100000;
    private const uint ShareRead = 0x00000001;
    private const uint ShareWrite = 0x00000002;
    private const uint ShareDelete = 0x00000004;
    private const uint CreateNew = 1;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x80;
    private const uint FileFlagWriteThrough = 0x80000000;
    private const uint FileFlagOpenReparsePoint = 0x00200000;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint FileAttributeDirectory = 0x10;
    private const uint FileAttributeReparsePoint = 0x400;
    private const uint DriveFixed = 3;
    private const uint FileTypeDisk = 1;
    private const uint FileReadOnlyVolume = 0x00080000;
    private const uint FilePersistentAcls = 0x00000008;
    private const int ErrorFileExists = 80;
    private const int ErrorAlreadyExists = 183;
    private const int ErrorFileNotFound = 2;
    private const int ErrorPathNotFound = 3;
    private const int FileRenameInfo = 3;
    private const int FileObject = 1;
    private const uint OwnerSecurityInformation = 0x00000001;
    private const uint DaclSecurityInformation = 0x00000004;
    private const ushort ProtectedDacl = 0x1000;
    private const byte AccessAllowedAceType = 0;
    private const int AclSizeInfoClass = 2;

    private readonly object _io = new();
    private readonly List<(string Path, SafeFileHandle Handle)> _chain = new();
    private readonly HashSet<string> _privateDirectoryPaths = new(StringComparer.OrdinalIgnoreCase);
    private readonly Action<WindowsConsentWriteStage>? _checkpoint;
    private readonly SecurityIdentifier _userSid;
    private readonly SecurityIdentifier _systemSid = new(WellKnownSidType.LocalSystemSid, null);
    private readonly SecurityIdentifier _administratorsSid = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private uint _volumeSerial;
    private string _rootPath = null!;
    private SafeFileHandle _lock = null!;
    private bool _disposed;
    private bool _faulted;

    private SafeFileHandle Root => _chain[^1].Handle;
    internal bool IsVolatile => false;

    private WindowsConsentDirectory(Action<WindowsConsentWriteStage>? checkpoint)
    {
        _checkpoint = checkpoint;
        using var identity = WindowsIdentity.GetCurrent();
        _userSid = identity.User ?? throw Error();
    }

    internal static void RequireSupportedPlatform(bool isWindows, Architecture architecture)
    {
        if (!isWindows || architecture is not (Architecture.X64 or Architecture.Arm64))
            throw new PlatformNotSupportedException("consent-windows-x64-arm64-only");
    }

    internal static uint DirectoryAccess(bool privateDirectory, bool writableRoot) => writableRoot
        ? GenericRead | GenericWrite | ReadControl
        : FileReadAttributes | Synchronize | (privateDirectory ? ReadControl : 0);

    internal static void RequireAceSidBounds(int aceLength, int sidLength)
    {
        if (aceLength < 8 || sidLength is < 8 or > 68 || sidLength > aceLength - 8) throw Error();
    }

    internal static string ResolveRoot(string localAppData)
    {
        ValidateCanonicalPath(localAppData);
        return localAppData + "\\Zilo";
    }

    internal static WindowsConsentDirectory Open(string path, Action<WindowsConsentWriteStage>? checkpoint = null)
    {
        // This guard is deliberately the first operation: no Windows API or Windows identity is
        // touched until the process is Windows x64/arm64.
        RequireSupportedPlatform(OperatingSystem.IsWindows(), RuntimeInformation.ProcessArchitecture);
        ValidateCanonicalPath(path);
        var store = new WindowsConsentDirectory(checkpoint) { _rootPath = path };
        try
        {
            var parts = Components(path);
            var driveRoot = path[..3];
            var driveHandle = store.OpenDirectory(driveRoot, privateDirectory: false, writableRoot: false);
            store._chain.Add((driveRoot, driveHandle));
            store.CheckDirectory(driveHandle, requirePrivate: false);
            store.RequireLocalNtfs(driveHandle, driveRoot);

            var current = driveRoot.TrimEnd('\\');
            for (var i = 0; i < parts.Count; i++)
            {
                var childPath = current + "\\" + parts[i];
                var final = i == parts.Count - 1;
                var created = false;
                var handle = store.TryOpenDirectory(childPath, privateDirectory: final, writableRoot: final, out var error);
                if (handle is null && (error == ErrorFileNotFound || error == ErrorPathNotFound))
                {
                    created = CreatePrivateDirectory(childPath, store._userSid);
                    handle = store.OpenDirectory(childPath, privateDirectory: created || final, writableRoot: final);
                }
                else if (handle is null)
                {
                    throw NativeError(error);
                }

                store._chain.Add((childPath, handle));
                store.CheckDirectory(handle, created || final);
                if (created) store.CheckPrivate(handle, true);
                if (!SameVolume(store._volumeSerial, FileInfo(handle).VolumeSerialNumber)) throw Error();
                if (created) store._privateDirectoryPaths.Add(childPath);
                current = childPath;
            }

            store.ValidateChain();
            store.CheckPrivate(store.Root, true);
            store.OpenLock();
            store.Validate();
            return store;
        }
        catch
        {
            store.DisposeAsync().GetAwaiter().GetResult();
            throw;
        }
    }

    public ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken)
    {
        lock (_io)
        {
            RequireUsable();
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                Validate();
                var interrupted = HasEntry("consent.tmp") || HasEntry("fence.tmp");
                for (var i = 0; i < 4; i++) interrupted |= HasEntry($"quarantine-{i}");
                var snapshot = Read("consent.json", ConsentSnapshotCodec.MaxBytes);
                var fence = Read("session.fence", 24);
                Validate();
                return ValueTask.FromResult(new ConsentDirectoryContents(snapshot, fence, interrupted));
            }
            catch
            {
                _faulted = true;
                throw;
            }
        }
    }

    public ValueTask ReplaceAsync(string name, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken)
    {
        lock (_io)
        {
            RequireUsable();
            // Cancellation is an admission check only. Once a temp is created, the native sequence
            // is owned to completion and is never abandoned by caller cancellation.
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (name is not ("consent.json" or "session.fence") || contents.Length > ConsentSnapshotCodec.MaxBytes)
                    throw Error();
                var bytes = contents.ToArray();
                if (name == "consent.json") _ = ConsentSnapshotCodec.Decode(bytes);
                else if (!bytes.AsSpan().SequenceEqual("zilo-consent-session-v1\n"u8) &&
                         !bytes.AsSpan().SequenceEqual("zilo-consent-clean-v1\n"u8)) throw Error();

                Validate();
                ValidateTarget(name);
                var tempName = name == "consent.json" ? "consent.tmp" : "fence.tmp";
                ValidateFixedName(tempName);
                using var temp = CreatePrivateFile(tempName, CreateNew, FileFlagWriteThrough);
                CheckPrivate(temp, false);
                ValidateNamed(tempName, temp);
                RandomAccess.Write(temp, bytes, 0);
                _checkpoint?.Invoke(WindowsConsentWriteStage.BeforeFlush);
                if (!Native.FlushFileBuffers(temp)) throw NativeError(Marshal.GetLastPInvokeError());
                _checkpoint?.Invoke(WindowsConsentWriteStage.BeforeRename);
                Validate();
                ValidateNamed(tempName, temp);
                ValidateTarget(name);
                var rename = BuildRenameInformation(Root.DangerousGetHandle(), name);
                if (!Native.SetFileInformationByHandle(temp, FileRenameInfo, rename, checked((uint)rename.Length)))
                    throw NativeError(Marshal.GetLastPInvokeError());
                _checkpoint?.Invoke(WindowsConsentWriteStage.BeforeFinalFlush);
                if (!Native.FlushFileBuffers(temp)) throw NativeError(Marshal.GetLastPInvokeError());
                ValidateNamed(name, temp);
                Validate();
                return ValueTask.CompletedTask;
            }
            catch
            {
                _faulted = true;
                throw;
            }
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_io)
        {
            if (_disposed) return ValueTask.CompletedTask;
            _disposed = true;
            _lock?.Dispose();
            for (var i = _chain.Count - 1; i >= 0; i--) _chain[i].Handle.Dispose();
            return ValueTask.CompletedTask;
        }
    }

    internal static byte[] BuildRenameInformation(nint rootDirectory, string name)
    {
        ValidateRenameTarget(name);
        var nameBytes = System.Text.Encoding.Unicode.GetBytes(name);
        var result = new byte[20 + nameBytes.Length];
        result[0] = 1; // ReplaceIfExists = TRUE; the union is a DWORD at 0, padded to RootDirectory at 8.
        BitConverter.GetBytes(rootDirectory.ToInt64()).CopyTo(result, 8);
        BitConverter.GetBytes(nameBytes.Length).CopyTo(result, 16);
        nameBytes.CopyTo(result, 20);
        return result;
    }

    private static List<string> Components(string path)
    {
        var remainder = path[3..];
        return remainder.Split('\\', StringSplitOptions.RemoveEmptyEntries).ToList();
    }

    private static void ValidateCanonicalPath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length < 3 || path.Contains('\0') ||
            !((path[0] is >= 'A' and <= 'Z') || (path[0] is >= 'a' and <= 'z')) ||
            path[1] != ':' || path[2] != '\\' || path.EndsWith('\\')) throw Error();
        if (path.StartsWith("\\\\", StringComparison.Ordinal) || path.Contains('/')) throw Error();
        for (var i = 2; i < path.Length; i++)
        {
            var ch = path[i];
            if (ch == ':' || ch is '<' or '>' or '"' or '|' or '?' or '*' || char.IsControl(ch)) throw Error();
        }
        foreach (var component in path[3..].Split('\\'))
        {
            if (component.Length == 0 || component is "." or ".." || component.EndsWith(' ') || component.EndsWith('.')) throw Error();
            var stem = component.Split('.', 2)[0];
            if (stem.Equals("CON", StringComparison.OrdinalIgnoreCase) || stem.Equals("PRN", StringComparison.OrdinalIgnoreCase) ||
                stem.Equals("AUX", StringComparison.OrdinalIgnoreCase) || stem.Equals("NUL", StringComparison.OrdinalIgnoreCase) ||
                (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase) ||
                                      stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)) && stem[3] is >= '1' and <= '9'))
                throw Error();
        }
    }

    private static void ValidateFixedName(string name)
    {
        if (name is not ("consent.json" or "session.fence" or "consent.lock" or "consent.tmp" or "fence.tmp") &&
            !(name.StartsWith("quarantine-", StringComparison.Ordinal) && name.Length == 12 && name[^1] is >= '0' and <= '3'))
            throw Error();
    }

    private static void ValidateRenameTarget(string name)
    {
        if (name is not ("consent.json" or "session.fence")) throw Error();
    }

    private void RequireLocalNtfs(SafeFileHandle handle, string driveRoot)
    {
        if (Native.GetDriveTypeW(driveRoot) != DriveFixed) throw Error();
        var fs = new System.Text.StringBuilder(16);
        if (!Native.GetVolumeInformationByHandleW(handle, null, 0, out var serial, out _, out var flags,
                fs, (uint)fs.Capacity)) throw NativeError(Marshal.GetLastPInvokeError());
        if (!fs.ToString().Equals("NTFS", StringComparison.OrdinalIgnoreCase) ||
            (flags & (FileReadOnlyVolume | FilePersistentAcls)) != FilePersistentAcls) throw Error();
        _volumeSerial = serial;
    }

    private void OpenLock()
    {
        ValidateChain();
        CheckPrivate(Root, true);
        var created = TryCreateFile("consent.lock", CreateNew, 0, share: 0, out var error);
        if (created is null)
        {
            if (error is not (ErrorFileExists or ErrorAlreadyExists)) throw NativeError(error);
            _lock = OpenChild("consent.lock", GenericRead | GenericWrite | Delete | ReadControl, share: 0,
                FileFlagOpenReparsePoint, out error) ?? throw NativeError(error);
        }
        else _lock = created;
        CheckPrivate(_lock, false);
        ValidateLock();
    }

    private SafeFileHandle CreatePrivateFile(string name, uint disposition, uint extraFlags)
    {
        var result = TryCreateFile(name, disposition, extraFlags, ShareRead, out var error);
        return result ?? throw NativeError(error);
    }

    private SafeFileHandle? TryCreateFile(string name, uint disposition, uint extraFlags, uint share, out int error)
    {
        ValidateFixedName(name);
        using var descriptor = PrivateSecurityDescriptor(_userSid);
        var attributes = new SecurityAttributes { Length = 24, SecurityDescriptor = descriptor, InheritHandle = 0 };
        var raw = Native.CreateFileW(ChildPath(name), GenericRead | GenericWrite | Delete | ReadControl,
            share, ref attributes, disposition, FileAttributeNormal | extraFlags | FileFlagOpenReparsePoint, nint.Zero);
        if (raw == Native.InvalidHandle)
        {
            error = Marshal.GetLastPInvokeError();
            return null;
        }
        error = 0;
        return new SafeFileHandle(raw, ownsHandle: true);
    }

    private static bool CreatePrivateDirectory(string path, SecurityIdentifier user)
    {
        using var descriptor = PrivateSecurityDescriptor(user);
        var attributes = new SecurityAttributes { Length = 24, SecurityDescriptor = descriptor, InheritHandle = 0 };
        if (!Native.CreateDirectoryW(path, ref attributes))
        {
            var error = Marshal.GetLastPInvokeError();
            if (error != ErrorAlreadyExists) throw NativeError(error);
            return false;
        }
        return true;
    }

    private SafeFileHandle OpenDirectory(string path, bool privateDirectory, bool writableRoot) =>
        TryOpenDirectory(path, privateDirectory, writableRoot, out var error) ?? throw NativeError(error);

    private SafeFileHandle? TryOpenDirectory(string path, bool privateDirectory, bool writableRoot, out int error)
    {
        var desired = DirectoryAccess(privateDirectory, writableRoot);
        var raw = Native.CreateFileW(path, desired, ShareRead | ShareWrite,
            nint.Zero, OpenExisting, FileFlagBackupSemantics | FileFlagOpenReparsePoint, nint.Zero);
        if (raw == Native.InvalidHandle)
        {
            error = Marshal.GetLastPInvokeError();
            return null;
        }
        error = 0;
        return new SafeFileHandle(raw, ownsHandle: true);
    }

    private SafeFileHandle? OpenChild(string name, uint desired, uint share, uint flags, out int error)
    {
        ValidateFixedName(name);
        var raw = Native.CreateFileW(ChildPath(name), desired, share, nint.Zero, OpenExisting,
            flags | FileFlagOpenReparsePoint, nint.Zero);
        if (raw == Native.InvalidHandle)
        {
            error = Marshal.GetLastPInvokeError();
            return null;
        }
        error = 0;
        return new SafeFileHandle(raw, ownsHandle: true);
    }

    private byte[]? Read(string name, int limit)
    {
        using var file = OpenChild(name, GenericRead | ReadControl, ShareRead, 0, out var error);
        if (file is null && error == ErrorFileNotFound) return null;
        if (file is null) throw NativeError(error);
        var before = FileInfo(file);
        CheckPrivate(file, false);
        ValidateNamed(name, file);
        var size = ((ulong)before.FileSizeHigh << 32) | before.FileSizeLow;
        if (size > (ulong)limit) throw Error();
        var bytes = new byte[(int)size];
        var offset = 0;
        while (offset < bytes.Length)
        {
            var read = RandomAccess.Read(file, bytes.AsSpan(offset), offset);
            if (read == 0) throw Error();
            offset += read;
        }
        Span<byte> extra = stackalloc byte[1];
        if (RandomAccess.Read(file, extra, offset) != 0) throw Error();
        var after = FileInfo(file);
        if (!Same(before, after) || (((ulong)after.FileSizeHigh << 32) | after.FileSizeLow) != size) throw Error();
        ValidateNamed(name, file);
        return bytes;
    }

    private bool HasEntry(string name)
    {
        using var entry = OpenChild(name, FileReadAttributes | ReadControl, ShareRead | ShareWrite, FileFlagBackupSemantics, out var error);
        if (entry is null && error == ErrorFileNotFound) return false;
        if (entry is null) throw NativeError(error);
        var info = FileInfo(entry);
        if ((info.FileAttributes & FileAttributeReparsePoint) != 0) throw Error();
        return true;
    }

    private void Validate()
    {
        ValidateChain();
        CheckPrivate(Root, true);
        ValidateLock();
    }

    private void ValidateChain()
    {
        for (var i = 0; i < _chain.Count; i++)
        {
            var current = FileInfo(_chain[i].Handle);
            var privateDirectory = i == _chain.Count - 1 || _privateDirectoryPaths.Contains(_chain[i].Path);
            CheckDirectory(_chain[i].Handle, privateDirectory);
            if (!SameVolume(_volumeSerial, current.VolumeSerialNumber)) throw Error();
            using var fresh = OpenDirectory(_chain[i].Path, privateDirectory, writableRoot: i == _chain.Count - 1);
            if (privateDirectory) CheckPrivate(fresh, true);
            if (!Same(current, FileInfo(fresh))) throw Error();
        }
    }

    private void ValidateLock()
    {
        CheckPrivate(_lock, false);
        if (!SameVolume(_volumeSerial, FileInfo(_lock).VolumeSerialNumber)) throw Error();
    }

    private void ValidateTarget(string name)
    {
        using var target = OpenChild(name, GenericRead | ReadControl, ShareRead | ShareWrite, 0, out var error);
        if (target is null && error == ErrorFileNotFound) return;
        if (target is null) throw NativeError(error);
        CheckPrivate(target, false);
        if (!SameVolume(_volumeSerial, FileInfo(target).VolumeSerialNumber)) throw Error();
    }

    private void ValidateNamed(string name, SafeFileHandle expected)
    {
        var expectedInfo = FileInfo(expected);
        CheckPrivate(expected, false);
        using var actual = OpenChild(name, ReadControl | FileReadAttributes, ShareRead | ShareWrite | ShareDelete, 0, out var error);
        if (actual is null) throw NativeError(error);
        var actualInfo = FileInfo(actual);
        CheckPrivate(actual, false);
        if (!Same(expectedInfo, actualInfo)) throw Error();
    }

    private void CheckDirectory(SafeFileHandle handle, bool requirePrivate)
    {
        var info = FileInfo(handle);
        if (Native.GetFileType(handle) != FileTypeDisk || (info.FileAttributes & FileAttributeDirectory) == 0 ||
            (info.FileAttributes & FileAttributeReparsePoint) != 0) throw Error();
        if (requirePrivate) CheckPrivate(handle, true);
    }

    private void CheckPrivate(SafeFileHandle handle, bool directory)
    {
        var info = FileInfo(handle);
        if (Native.GetFileType(handle) != FileTypeDisk || (info.FileAttributes & FileAttributeReparsePoint) != 0 ||
            (directory != ((info.FileAttributes & FileAttributeDirectory) != 0)) ||
            (!directory && info.NumberOfLinks != 1) || !SameVolume(_volumeSerial, info.VolumeSerialNumber)) throw Error();
        CheckSecurity(handle, directory);
    }

    private void CheckSecurity(SafeFileHandle handle, bool directory)
    {
        var result = Native.GetSecurityInfo(handle.DangerousGetHandle(), FileObject,
            OwnerSecurityInformation | DaclSecurityInformation, out var owner, out _, out var dacl, out _, out var descriptor);
        if (result != 0 || descriptor == nint.Zero) throw NativeError((int)result);
        try
        {
            var descriptorLength = Native.GetSecurityDescriptorLength(descriptor);
            if (descriptorLength == 0 || descriptorLength > 4 * 1024 * 1024 ||
                !Native.GetSecurityDescriptorOwner(descriptor, out var ownerSid, out _) || ownerSid == nint.Zero ||
                !Native.IsValidSid(ownerSid) ||
                !SidEquals(ownerSid, _userSid) || !Native.GetSecurityDescriptorDacl(descriptor, out var present, out dacl, out _) ||
                !present || dacl == nint.Zero || !Native.GetSecurityDescriptorControl(descriptor, out var control, out _) ||
                (control & ProtectedDacl) == 0 || !Native.IsValidAcl(dacl)) throw Error();
            if (!Native.GetAclInformation(dacl, out var size, Marshal.SizeOf<AclSizeInformation>(), AclSizeInfoClass)) throw Error();
            if (size.AceCount > 4096 || size.AclBytesInUse == 0 || size.AclBytesInUse > descriptorLength) throw Error();
            var sawUser = false;
            for (uint i = 0; i < size.AceCount; i++)
            {
                if (!Native.GetAce(dacl, i, out var ace) || ace == nint.Zero) throw Error();
                var aceOffset = ace.ToInt64() - dacl.ToInt64();
                var aceLength = (ushort)Marshal.ReadInt16(ace, 2);
                if (aceOffset < 0 || aceLength < 16 || (ulong)aceOffset + aceLength > size.AclBytesInUse) throw Error();
                var header = Marshal.ReadByte(ace, 0);
                var flags = Marshal.ReadByte(ace, 1);
                if (header != AccessAllowedAceType || flags != 0) throw Error();
                var sidPointer = IntPtr.Add(ace, 8);
                if (!Native.IsValidSid(sidPointer)) throw Error();
                var sidLength = checked((int)Native.GetLengthSid(sidPointer));
                RequireAceSidBounds(aceLength, sidLength);
                var sid = SidAt(sidPointer);
                if (!sid.Equals(_userSid) && !sid.Equals(_systemSid) && !sid.Equals(_administratorsSid)) throw Error();
                sawUser |= sid.Equals(_userSid);
            }
            if (!sawUser) throw Error();
        }
        finally
        {
            if (descriptor != nint.Zero) Native.LocalFree(descriptor);
        }
    }

    private static bool SidEquals(nint pointer, SecurityIdentifier expected) => SidAt(pointer).Equals(expected);

    private static SecurityIdentifier SidAt(nint pointer)
    {
        if (!Native.IsValidSid(pointer)) throw Error();
        var length = checked((int)Native.GetLengthSid(pointer));
        if (length is < 8 or > 68) throw Error();
        var bytes = new byte[length];
        Marshal.Copy(pointer, bytes, 0, length);
        return new SecurityIdentifier(bytes, 0);
    }

    private static SafeLocalHandle PrivateSecurityDescriptor(SecurityIdentifier user)
    {
        var sddl = $"O:{user.Value}D:P(A;;FA;;;{user.Value})(A;;FA;;;SY)(A;;FA;;;BA)";
        if (!Native.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out var descriptor, out _))
            throw NativeError(Marshal.GetLastPInvokeError());
        return new SafeLocalHandle(descriptor);
    }

    private static ByHandleFileInformation FileInfo(SafeFileHandle handle)
    {
        if (!Native.GetFileInformationByHandle(handle, out var info)) throw NativeError(Marshal.GetLastPInvokeError());
        return info;
    }

    private static bool SameVolume(uint left, uint right) => left == right;
    private static bool Same(ByHandleFileInformation left, ByHandleFileInformation right) =>
        left.VolumeSerialNumber == right.VolumeSerialNumber && left.FileIndexHigh == right.FileIndexHigh &&
        left.FileIndexLow == right.FileIndexLow;

    private string ChildPath(string name) => _rootPath + "\\" + name;
    private void RequireUsable() { if (_disposed || _faulted) throw Error(); }
    private static IOException Error() => new("consent-windows-private-storage-unavailable");
    private static IOException NativeError(int error) => new($"consent-windows-private-storage-unavailable:{error}");

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct SecurityAttributes
    {
        [FieldOffset(0)] internal int Length;
        [FieldOffset(8)] internal nint SecurityDescriptor;
        [FieldOffset(16)] internal int InheritHandle;
    }

    [StructLayout(LayoutKind.Explicit, Size = 52)]
    private struct ByHandleFileInformation
    {
        [FieldOffset(0)] internal uint FileAttributes;
        [FieldOffset(28)] internal uint VolumeSerialNumber;
        [FieldOffset(32)] internal uint FileSizeHigh;
        [FieldOffset(36)] internal uint FileSizeLow;
        [FieldOffset(40)] internal uint NumberOfLinks;
        [FieldOffset(44)] internal uint FileIndexHigh;
        [FieldOffset(48)] internal uint FileIndexLow;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AclSizeInformation
    {
        internal uint AceCount;
        internal uint AclBytesInUse;
        internal uint AclBytesFree;
    }

    private sealed class SafeLocalHandle : SafeHandle
    {
        internal SafeLocalHandle(nint value) : base(nint.Zero, true) => SetHandle(value);
        public override bool IsInvalid => handle == nint.Zero || handle == new nint(-1);
        protected override bool ReleaseHandle() => Native.LocalFree(handle) == nint.Zero;
        internal nint Value => handle;
        public static implicit operator nint(SafeLocalHandle value) => value.Value;
    }

    private static class Native
    {
        internal static readonly nint InvalidHandle = new(-1);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern nint CreateFileW(string path, uint desiredAccess, uint shareMode, nint securityAttributes,
            uint creationDisposition, uint flagsAndAttributes, nint templateFile);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern nint CreateFileW(string path, uint desiredAccess, uint shareMode, ref SecurityAttributes securityAttributes,
            uint creationDisposition, uint flagsAndAttributes, nint templateFile);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreateDirectoryW(string path, ref SecurityAttributes securityAttributes);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetFileInformationByHandle(SafeFileHandle file, out ByHandleFileInformation info);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint GetFileType(SafeFileHandle file);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetVolumeInformationByHandleW(SafeFileHandle file, System.Text.StringBuilder? volumeName,
            uint volumeNameSize, out uint volumeSerialNumber, out uint maximumComponentLength, out uint fileSystemFlags,
            System.Text.StringBuilder fileSystemName, uint fileSystemNameSize);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        internal static extern uint GetDriveTypeW(string rootPathName);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool FlushFileBuffers(SafeFileHandle file);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetFileInformationByHandle(SafeFileHandle file, int fileInformationClass,
            byte[] fileInformation, uint bufferSize);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern uint GetSecurityInfo(nint handle, int objectType, uint securityInfo, out nint owner,
            out nint group, out nint dacl, out nint sacl, out nint descriptor);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetSecurityDescriptorOwner(nint descriptor, out nint owner, out int defaulted);
        [DllImport("advapi32.dll")]
        internal static extern uint GetSecurityDescriptorLength(nint descriptor);
        [DllImport("advapi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsValidSid(nint sid);
        [DllImport("advapi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsValidAcl(nint acl);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetSecurityDescriptorDacl(nint descriptor, out bool present, out nint dacl, out int defaulted);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetSecurityDescriptorControl(nint descriptor, out ushort control, out uint revision);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetAclInformation(nint acl, out AclSizeInformation information, int length, int informationClass);
        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetAce(nint acl, uint index, out nint ace);
        [DllImport("advapi32.dll")]
        internal static extern uint GetLengthSid(nint sid);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string stringSecurityDescriptor,
            uint stringSDRevision, out nint securityDescriptor, out uint securityDescriptorSize);
        [DllImport("kernel32.dll")]
        internal static extern nint LocalFree(nint memory);
    }
}
