using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Zilo.Security.Persistence;

internal enum MacConsentWriteStage { FileFsync, FileFullSync, BeforeRename, DirectoryFsync, DirectoryFullSync }

internal sealed class MacConsentDirectory : IPrivateConsentDirectory
{
    // Apple xnu bsd/sys/{fcntl,stat,mount}.h and Libc include/sys/acl.h; NOT Linux constants.
    private const int NoFollow = 0x100, DirectoryFlag = 0x100000, CloseOnExec = 0x1000000, NonBlock = 4;
    private const int ReadWrite = 2, AtNoFollow = 0x20, FullSync = 51;
    private const string LibSystem = "/usr/lib/libSystem.B.dylib";
    private readonly object _io = new();
    private readonly List<(string Name, SafeFileHandle Handle)> _chain = new();
    private readonly Action<MacConsentWriteStage>? _checkpoint;
    private readonly uint _uid;
    private string _rootPath = null!;
    private SafeFileHandle? _lock;
    private FileStream? _lockStream;
    private bool _disposed, _faulted;
    private SafeFileHandle Root => _chain[^1].Handle;
    internal bool IsVolatile => false; // Only ownership-enforcing local APFS/HFS are candidates.

    private MacConsentDirectory(Action<MacConsentWriteStage>? checkpoint)
    { _uid = Native.geteuid(); _checkpoint = checkpoint; }

    internal static void RequirePlatform(bool macOS, Architecture architecture)
    {
        if (!macOS || architecture is not (Architecture.X64 or Architecture.Arm64))
            throw new PlatformNotSupportedException("consent-darwin-x64-arm64-only");
    }
    internal static void RequireFileSystem(string type, uint flags)
    {
        // MNT_LOCAL required; MNT_RDONLY and MNT_IGNORE_OWNERSHIP forbidden (Darwin mount.h).
        if (type is not ("apfs" or "hfs") || (flags & 0x1000) == 0 || (flags & 0x200001) != 0)
            throw new IOException("consent-darwin-filesystem-unsupported: use ownership-enforcing writable local APFS/HFS; do not reset permissions");
    }
    internal static void RequireFullFlushSuccess(int result)
    {
        if (result != 0) throw new IOException("consent-fullflush-unsupported-or-failed: required Darwin full flush unavailable; no fsync-only fallback");
    }

    internal static string ResolveRoot(string home)
    {
        if (!Path.IsPathFullyQualified(home) || home.Contains('\0')) throw Error();
        return Path.Combine(home, "Library", "Application Support", "Zilo");
    }

    internal static MacConsentDirectory Open(string path, Action<MacConsentWriteStage>? checkpoint = null)
    {
        RequirePlatform(OperatingSystem.IsMacOS(), RuntimeInformation.ProcessArchitecture); // BEFORE any native entry
        if (!Path.IsPathFullyQualified(path) || path.Contains('\0')) throw Error();
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Any(part => part is "." or "..")) throw Error();
        var store = new MacConsentDirectory(checkpoint) { _rootPath = path };
        try
        {
            store._chain.Add(("/", Handle(Native.openat(-2, "/", DirectoryFlag | NoFollow | CloseOnExec)))); // AT_FDCWD=-2
            CheckAncestor(Info(store.Root), store._uid);
            foreach (var part in parts)
            {
                var parent = store.Root;
                var fd = Native.openat(Fd(parent), part, DirectoryFlag | NoFollow | CloseOnExec);
                if (fd < 0 && Marshal.GetLastPInvokeError() == 2)
                {
                    if (Native.mkdirat(Fd(parent), part, 0x1c0) != 0 && Marshal.GetLastPInvokeError() != 17) throw Error();
                    Sync(parent, false);
                    fd = Native.openat(Fd(parent), part, DirectoryFlag | NoFollow | CloseOnExec);
                }
                if (fd < 0 && Named(parent, part) is { } failed && (failed.Mode & 0xf000) == 0xa000)
                    throw new IOException("consent-symlink-ancestor-unsupported: use real directory ancestors or trusted maintenance; no automatic link resolution");
                var handle = Handle(fd);
                store._chain.Add((part, handle));
                CheckAncestor(Info(handle), store._uid);
            }
            store.ValidateChain();
            CheckPrivate(store.Root, store._uid, true);
            if (StatFs(Fd(store.Root), out var fs) != 0) throw Error();
            RequireFileSystem(fs.TypeName, fs.Flags);
            store.OpenLock();
            if (Native.flock(Fd(store._lock!), 2 | 4) != 0) throw Error();
            Sync(store._lock!, true);
            Sync(store.Root, true);
            store.Validate();
            return store;
        }
        catch { store.DisposeAsync().GetAwaiter().GetResult(); throw; }
    }

    // Synchronous native IO belongs on the single owned persistence worker, never the auth monitor.
    public ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken)
    {
        lock (_io)
        {
            RequireUsable(); cancellationToken.ThrowIfCancellationRequested();
            try
            {
                Validate();
                var interrupted = Named(Root, "consent.tmp") is not null || Named(Root, "fence.tmp") is not null;
                for (var i = 0; i < 4; i++) interrupted |= Named(Root, $"quarantine-{i}") is not null;
                var snapshot = Read("consent.json", ConsentSnapshotCodec.MaxBytes);
                var fence = Read("session.fence", 24);
                Validate();
                return ValueTask.FromResult(new ConsentDirectoryContents(snapshot, fence, interrupted));
            }
            catch { _faulted = true; throw; }
        }
    }

    public ValueTask ReplaceAsync(string name, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken)
    {
        lock (_io)
        {
            RequireUsable(); cancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (name is not ("consent.json" or "session.fence") || contents.Length > ConsentSnapshotCodec.MaxBytes) throw Error();
                var bytes = contents.ToArray();
                if (name == "consent.json") _ = ConsentSnapshotCodec.Decode(bytes);
                else if (!bytes.AsSpan().SequenceEqual("zilo-consent-session-v1\n"u8) && !bytes.AsSpan().SequenceEqual("zilo-consent-clean-v1\n"u8)) throw Error();
                Validate(); ValidateTarget(name);
                var temp = name == "consent.json" ? "consent.tmp" : "fence.tmp";
                ValidateChain();
                CheckPrivate(Root, _uid, true);
                using var fileStream = new FileStream(Path.Combine(_rootPath, temp), CreateNewFileOptions());
                var file = fileStream.SafeFileHandle;
                ValidateChain();
                CheckPrivate(Root, _uid, true);
                // Only our exclusively created, still-empty file may have its mode normalized.
                if (Info(file).Size != 0) throw Error();
                if (Native.fchmod(Fd(file), 0x180) != 0) throw Error();
                CheckPrivate(file, _uid, false);
                ValidateNamed(temp, file);
                ValidateChain();
                RandomAccess.Write(file, bytes, 0);
                _checkpoint?.Invoke(MacConsentWriteStage.FileFsync); Sync(file, false);
                _checkpoint?.Invoke(MacConsentWriteStage.FileFullSync); RequireFullFlushSuccess(Native.fcntl(Fd(file), FullSync));
                _checkpoint?.Invoke(MacConsentWriteStage.BeforeRename);
                Validate(); ValidateNamed(temp, file); ValidateTarget(name);
                if (Native.renameat(Fd(Root), temp, Fd(Root), name) != 0) throw Error();
                ValidateNamed(name, file);
                _checkpoint?.Invoke(MacConsentWriteStage.DirectoryFsync); Sync(Root, false);
                _checkpoint?.Invoke(MacConsentWriteStage.DirectoryFullSync); RequireFullFlushSuccess(Native.fcntl(Fd(Root), FullSync));
                Validate(); ValidateNamed(name, file);
                return ValueTask.CompletedTask;
            }
            catch { _faulted = true; throw; } // preserve dirty/temp evidence, including ENOTSUP
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_io)
        {
            if (_disposed) return ValueTask.CompletedTask;
            _disposed = true;
            if (_lockStream is not null) _lockStream.Dispose();
            else _lock?.Dispose();
            for (var i = _chain.Count - 1; i >= 0; i--) _chain[i].Handle.Dispose();
            return ValueTask.CompletedTask;
        }
    }

    private byte[]? Read(string name, int limit)
    {
        var fd = Native.openat(Fd(Root), name, NoFollow | CloseOnExec | NonBlock);
        if (fd < 0 && Marshal.GetLastPInvokeError() == 2) return null;
        using var file = Handle(fd);
        CheckPrivate(file, _uid, false); ValidateNamed(name, file);
        var size = Info(file).Size;
        if (size < 0 || size > limit) throw Error();
        var bytes = new byte[(int)size]; var offset = 0;
        while (offset < bytes.Length)
        {
            var count = RandomAccess.Read(file, bytes.AsSpan(offset), offset);
            if (count == 0) throw Error();
            offset += count;
        }
        Span<byte> extra = stackalloc byte[1];
        if (RandomAccess.Read(file, extra, offset) != 0 || Info(file).Size != size) throw Error();
        ValidateNamed(name, file); return bytes;
    }
    private void Validate()
    {
        ValidateChain();
        CheckPrivate(Root, _uid, true); ValidateNamed("consent.lock", _lock);
    }
    private void ValidateChain()
    {
        for (var i = 0; i < _chain.Count; i++)
        {
            var (name, handle) = _chain[i]; var current = Info(handle);
            CheckAncestor(current, _uid);
            if (i > 0 && !Same(current, Named(_chain[i - 1].Handle, name) ?? throw Error())) throw Error();
        }
    }
    private void ValidateTarget(string name)
    {
        var info = Named(Root, name);
        if (info is null) return;
        using var handle = Handle(Native.openat(Fd(Root), name, NoFollow | CloseOnExec | NonBlock));
        CheckPrivate(handle, _uid, false); ValidateNamed(name, handle);
        if (!Same(info.Value, Info(handle))) throw Error();
    }
    private void ValidateNamed(string name, SafeFileHandle? file)
    {
        if (file is null) throw Error();
        CheckPrivate(file, _uid, false);
        if (!Same(Info(file), Named(Root, name) ?? throw Error())) throw Error();
    }
    private void OpenLock()
    {
        ValidateChain();
        CheckPrivate(Root, _uid, true);
        FileStream? created = null;
        try
        {
            created = new FileStream(Path.Combine(_rootPath, "consent.lock"), CreateNewFileOptions());
        }
        catch (IOException exception) when (((uint)exception.HResult & 0xffffu) == 17u)
        {
            // Only an exclusive-create EEXIST permits the anchored, noncreating path.
        }

        if (created is not null)
        {
            _lockStream = created;
            _lock = created.SafeFileHandle;
            ValidateChain();
            CheckPrivate(Root, _uid, true);
            if (Info(_lock).Size != 0) throw Error();
            if (Native.fchmod(Fd(_lock!), 0x180) != 0) throw Error();
            CheckPrivate(_lock!, _uid, false);
            ValidateNamed("consent.lock", _lock);
            ValidateChain();
            CheckPrivate(Root, _uid, true);
            return;
        }

        _lock = Handle(Native.openat(Fd(Root), "consent.lock", ReadWrite | NoFollow | CloseOnExec | NonBlock));
        CheckPrivate(_lock!, _uid, false);
        ValidateNamed("consent.lock", _lock);
        ValidateChain();
        CheckPrivate(Root, _uid, true);
    }
    private void RequireUsable() { if (_disposed || _faulted) throw Error(); }
    private static void CheckPrivate(SafeFileHandle handle, uint uid, bool directory)
    {
        var info = Info(handle);
        if (info.Uid != uid || info.Mode != (directory ? 0x41c0 : 0x8180) || (!directory && info.Links != 1)) throw Error();
        RejectExtendedAcl(handle);
    }
    private static void RejectExtendedAcl(SafeFileHandle handle)
    {
        var acl = Native.acl_get_fd_np(Fd(handle), 0x100); // ACL_TYPE_EXTENDED
        if (acl == 0)
        {
            // Darwin Libc filesec_get_property(FILESEC_ACL): ENOENT means absent ACL on this fd.
            if (Marshal.GetLastPInvokeError() == 2) return;
            throw Error();
        }
        try
        {
            if (Native.acl_valid(acl) != 0) throw Error();
            var result = Native.acl_get_entry(acl, 0, out _); // ACL_FIRST_ENTRY=0
            // Darwin returns0 for an ENTRY, -1/EINVAL for end of a valid empty ACL (not Linux1/0).
            if (result != -1 || Marshal.GetLastPInvokeError() != 22)
                throw new IOException("consent-extended-acl-unsupported: trusted maintenance required; mode bits alone do not prove privacy");
        }
        finally { if (Native.acl_free(acl) != 0) throw Error(); }
    }
    private static void CheckAncestor(Stat info, uint uid)
    {
        if ((info.Mode & 0xf000) != 0x4000 || (info.Uid != 0 && info.Uid != uid)) throw Error();
        if ((info.Mode & 0x12) != 0 && !(info.Uid == 0 && (info.Mode & 0x200) != 0))
            throw new IOException("consent-ancestor-writable: trusted maintenance required; no automatic chmod");
    }
    private static Stat Info(SafeFileHandle handle) { if (StatFd(Fd(handle), out var info) != 0) throw Error(); return info; }
    private static Stat? Named(SafeFileHandle parent, string name)
    {
        if (StatAt(Fd(parent), name, out var info, AtNoFollow) == 0) return info;
        if (Marshal.GetLastPInvokeError() == 2) return null;
        throw Error();
    }
    private static bool Same(Stat a, Stat b) => a.Device == b.Device && a.Inode == b.Inode;
    private static void Sync(SafeFileHandle file, bool full)
    { if (Native.fsync(Fd(file)) != 0) throw Error(); if (full) RequireFullFlushSuccess(Native.fcntl(Fd(file), FullSync)); }
    // _io covers every published descriptor use AND Dispose; Open exclusively owns unpublished fds.
    private static int Fd(SafeFileHandle handle) => checked((int)handle.DangerousGetHandle());
    private static SafeFileHandle Handle(int fd) => fd < 0 ? throw Error() : new((nint)fd, true);
    private static IOException Error() => new("consent-darwin-private-storage-unavailable");
    internal static FileStreamOptions CreateNewFileOptions()
    {
        if (OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("consent-managed-unix-create-mode");
        return new FileStreamOptions
        {
            Mode = FileMode.CreateNew,
            Access = FileAccess.ReadWrite,
            Share = FileShare.ReadWrite,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
        };
    }

    // __DARWIN_STRUCT_STAT64 (144bytes) and STATFS64 (2168bytes), same layout on Darwin x64/arm64.
    [StructLayout(LayoutKind.Explicit, Size = 144)]
    private struct Stat
    {
        [FieldOffset(0)] internal int Device;
        [FieldOffset(4)] internal ushort Mode;
        [FieldOffset(6)] internal ushort Links;
        [FieldOffset(8)] internal ulong Inode;
        [FieldOffset(16)] internal uint Uid;
        [FieldOffset(96)] internal long Size;
    }
    [StructLayout(LayoutKind.Explicit, Size = 2168, CharSet = CharSet.Ansi)]
    private struct FileSystemStat
    {
        [FieldOffset(64)] internal uint Flags;
        [FieldOffset(72), MarshalAs(UnmanagedType.ByValTStr, SizeConst = 16)] internal string TypeName;
    }
    // sys/cdefs.h __DARWIN_INODE64: x64 suffix "$INODE64", arm64 unsuffixed native64.
    private static int StatFd(int fd, out Stat info) => RuntimeInformation.ProcessArchitecture == Architecture.X64 ? Native.stat_x64(fd, out info) : Native.stat_arm64(fd, out info);
    private static int StatAt(int fd, string name, out Stat info, int flags) => RuntimeInformation.ProcessArchitecture == Architecture.X64 ? Native.statat_x64(fd, name, out info, flags) : Native.statat_arm64(fd, name, out info, flags);
    private static int StatFs(int fd, out FileSystemStat info) => RuntimeInformation.ProcessArchitecture == Architecture.X64 ? Native.statfs_x64(fd, out info) : Native.statfs_arm64(fd, out info);
    private static class Native
    {
        [DllImport(LibSystem, SetLastError = true)] internal static extern int openat(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int flags);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int mkdirat(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, uint mode);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int renameat(int oldFd, [MarshalAs(UnmanagedType.LPUTF8Str)] string oldName, int newFd, [MarshalAs(UnmanagedType.LPUTF8Str)] string newName);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int fsync(int fd);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int fchmod(int fd, uint mode);
        // F_FULLFSYNC has no variadic argument; do not pass a fixed third arg as Darwin arm64 varargs.
        [DllImport(LibSystem, SetLastError = true)] internal static extern int fcntl(int fd, int command);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int flock(int fd, int operation);
        [DllImport(LibSystem)] internal static extern uint geteuid();
        [DllImport(LibSystem, EntryPoint = "fstat$INODE64", SetLastError = true)] internal static extern int stat_x64(int fd, out Stat info);
        [DllImport(LibSystem, EntryPoint = "fstat", SetLastError = true)] internal static extern int stat_arm64(int fd, out Stat info);
        [DllImport(LibSystem, EntryPoint = "fstatat$INODE64", SetLastError = true)] internal static extern int statat_x64(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, out Stat info, int flags);
        [DllImport(LibSystem, EntryPoint = "fstatat", SetLastError = true)] internal static extern int statat_arm64(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, out Stat info, int flags);
        [DllImport(LibSystem, EntryPoint = "fstatfs$INODE64", SetLastError = true)] internal static extern int statfs_x64(int fd, out FileSystemStat info);
        [DllImport(LibSystem, EntryPoint = "fstatfs", SetLastError = true)] internal static extern int statfs_arm64(int fd, out FileSystemStat info);
        [DllImport(LibSystem, SetLastError = true)] internal static extern nint acl_get_fd_np(int fd, int type);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int acl_valid(nint acl);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int acl_get_entry(nint acl, int entry, out nint result);
        [DllImport(LibSystem, SetLastError = true)] internal static extern int acl_free(nint acl);
    }
}
