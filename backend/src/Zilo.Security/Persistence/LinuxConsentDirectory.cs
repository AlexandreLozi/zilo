using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Zilo.Security.Persistence;

internal enum LinuxConsentWriteStage { BeforeFileFlush, BeforeRename, BeforeDirectoryFlush }

internal sealed class LinuxConsentDirectory : IPrivateConsentDirectory
{
    private const int NoFollow = 0x20000, CloseOnExec = 0x80000, DirectoryFlag = 0x10000, NonBlock = 0x800;
    private const int Create = 0x40, Exclusive = 0x80, ReadWrite = 2;
    private const uint RequiredStats = 0x30f;
    private readonly object _io = new();
    private readonly List<(string Name, SafeFileHandle Handle)> _ancestors = new();
    private readonly uint _uid;
    private readonly Action<LinuxConsentWriteStage>? _fault;
    private SafeFileHandle _lock = null!;
    private bool _disposed, _faulted;
    private SafeFileHandle Root => _ancestors[^1].Handle;

    private LinuxConsentDirectory(Action<LinuxConsentWriteStage>? fault)
    { _uid = Native.geteuid(); _fault = fault; }

    internal static string ResolveRoot(string? xdgStateHome, string home)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("consent-linux-only");
        if (!string.IsNullOrEmpty(xdgStateHome) && Path.IsPathFullyQualified(xdgStateHome))
        {
            if (xdgStateHome.Contains('\0')) throw Error();
            return Path.Combine(xdgStateHome, "zilo");
        }
        if (string.IsNullOrEmpty(home) || !Path.IsPathFullyQualified(home) || home.Contains('\0')) throw Error();
        return Path.Combine(home, ".local", "state", "zilo");
    }

    internal static LinuxConsentDirectory Open(string absolutePath, Action<LinuxConsentWriteStage>? fault = null)
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("consent-linux-only");
        if (!Path.IsPathFullyQualified(absolutePath) || absolutePath.Contains('\0')) throw Error();
        var parts = absolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Any(x => x is "." or "..")) throw Error();
        var store = new LinuxConsentDirectory(fault);
        try
        {
            store._ancestors.Add(("/", Handle(Native.openat(-100, "/", DirectoryFlag | NoFollow | CloseOnExec, 0))));
            CheckAncestor(Info(store.Root), store._uid);
            foreach (var part in parts)
            {
                var parent = store.Root;
                var fd = Native.openat(Fd(parent), part, DirectoryFlag | NoFollow | CloseOnExec, 0);
                if (fd < 0 && Marshal.GetLastPInvokeError() == 2)
                {
                    if (Native.mkdirat(Fd(parent), part, 0x1c0) != 0 && Marshal.GetLastPInvokeError() != 17) throw Error();
                    Flush(parent);
                    fd = Native.openat(Fd(parent), part, DirectoryFlag | NoFollow | CloseOnExec, 0);
                }
                var handle = Handle(fd);
                store._ancestors.Add((part, handle));
                CheckAncestor(Info(handle), store._uid);
            }
            CheckPrivate(Info(store.Root), store._uid, true);
            store._lock = Handle(Native.openat(Fd(store.Root), "consent.lock", ReadWrite | Create | NoFollow | CloseOnExec | NonBlock, 0x180));
            CheckPrivate(Info(store._lock), store._uid, false);
            if (Native.flock(Fd(store._lock), 2 | 4) != 0) throw Error(); // LOCK_EX | LOCK_NB
            Flush(store._lock);
            Flush(store.Root);
            store.Validate();
            return store;
        }
        catch { store.DisposeAsync().GetAwaiter().GetResult(); throw; }
    }

    // Called only by the owned persistence worker, never from an authorization monitor.
    // Native syscalls are synchronous; no per-request Task.Run or abandoned lock ownership.
    public ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken)
    {
        lock (_io)
        {
            RequireUsable();
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                Validate();
                var interrupted = Exists("consent.tmp") || Exists("fence.tmp");
                for (var i = 0; i < 4; i++) interrupted |= Exists($"quarantine-{i}");
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
            RequireUsable();
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (name is not ("consent.json" or "session.fence") || contents.Length > ConsentSnapshotCodec.MaxBytes) throw Error();
                var bytes = contents.ToArray();
                if (name == "consent.json") _ = ConsentSnapshotCodec.Decode(bytes);
                else if (!bytes.AsSpan().SequenceEqual("zilo-consent-session-v1\n"u8) && !bytes.AsSpan().SequenceEqual("zilo-consent-clean-v1\n"u8)) throw Error();
                Validate();
                ValidateTarget(name);
                var temp = name == "consent.json" ? "consent.tmp" : "fence.tmp";
                using var file = Handle(Native.openat(Fd(Root), temp, ReadWrite | Create | Exclusive | NoFollow | CloseOnExec | NonBlock, 0x180));
                CheckPrivate(Info(file), _uid, false);
                RandomAccess.Write(file, bytes, 0);
                _fault?.Invoke(LinuxConsentWriteStage.BeforeFileFlush);
                Flush(file);
                _fault?.Invoke(LinuxConsentWriteStage.BeforeRename);
                Validate();
                ValidateNamed(temp, file);
                ValidateTarget(name);
                if (Native.renameat(Fd(Root), temp, Fd(Root), name) != 0) throw Error();
                ValidateNamed(name, file);
                _fault?.Invoke(LinuxConsentWriteStage.BeforeDirectoryFlush);
                Flush(Root);
                Validate();
                ValidateNamed(name, file);
                return ValueTask.CompletedTask;
            }
            catch { _faulted = true; throw; } // retain temp/dirty evidence; no best-effort unlink
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_io)
        {
            if (_disposed) return ValueTask.CompletedTask;
            _disposed = true;
            _lock?.Dispose(); // close releases flock; never unlink lock or clean the fence
            for (var i = _ancestors.Count - 1; i >= 0; i--) _ancestors[i].Handle.Dispose();
            return ValueTask.CompletedTask;
        }
    }

    private byte[]? Read(string name, int limit)
    {
        var fd = Native.openat(Fd(Root), name, NoFollow | CloseOnExec | NonBlock, 0);
        if (fd < 0 && Marshal.GetLastPInvokeError() == 2) return null;
        using var file = Handle(fd);
        var before = Info(file);
        CheckPrivate(before, _uid, false);
        ValidateNamed(name, file);
        if (before.Size > (ulong)limit) throw Error();
        var bytes = new byte[(int)before.Size];
        var offset = 0;
        while (offset < bytes.Length)
        {
            var read = RandomAccess.Read(file, bytes.AsSpan(offset), offset);
            if (read == 0) throw Error();
            offset += read;
        }
        Span<byte> extra = stackalloc byte[1];
        if (RandomAccess.Read(file, extra, offset) != 0 || Info(file).Size != before.Size) throw Error();
        ValidateNamed(name, file);
        return bytes;
    }

    private void Validate()
    {
        for (var i = 0; i < _ancestors.Count; i++)
        {
            var (name, handle) = _ancestors[i];
            var current = Info(handle);
            CheckAncestor(current, _uid);
            if (i > 0 && !Same(current, Named(_ancestors[i - 1].Handle, name) ?? throw Error())) throw Error();
        }
        CheckPrivate(Info(Root), _uid, true);
        ValidateNamed("consent.lock", _lock);
    }

    private void ValidateTarget(string name)
    {
        var existing = Named(Root, name);
        if (existing is { } info) CheckPrivate(info, _uid, false);
    }

    private void ValidateNamed(string name, SafeFileHandle handle)
    {
        var info = Info(handle);
        CheckPrivate(info, _uid, false);
        if (!Same(info, Named(Root, name) ?? throw Error())) throw Error();
    }

    private bool Exists(string name) => Named(Root, name) is not null;
    private void RequireUsable() { if (_disposed || _faulted) throw Error(); }

    private static void CheckPrivate(Stat info, uint uid, bool directory)
    {
        var expected = directory ? 0x4000 | 0x1c0 : 0x8000 | 0x180; // S_IFDIR|0700 / S_IFREG|0600
        if (info.Uid != uid || info.Mode != expected || (!directory && info.Links != 1)) throw Error();
    }

    private static void CheckAncestor(Stat info, uint uid)
    {
        if ((info.Mode & 0xf000) != 0x4000 || (info.Uid != uid && info.Uid != 0)) throw Error();
        // Writable shared ancestors require root ownership and sticky-bit protection (e.g. /tmp).
        if ((info.Mode & 0x12) != 0 && !(info.Uid == 0 && (info.Mode & 0x200) != 0)) throw Error();
    }

    private static bool Same(Stat a, Stat b) => a.Inode == b.Inode && a.DeviceMajor == b.DeviceMajor && a.DeviceMinor == b.DeviceMinor;
    private static Stat Info(SafeFileHandle file) => StatAt(Fd(file), "", 0x1000) ?? throw Error(); // AT_EMPTY_PATH
    private static Stat? Named(SafeFileHandle parent, string name) => StatAt(Fd(parent), name, 0x100); // AT_SYMLINK_NOFOLLOW
    private static Stat? StatAt(int fd, string name, int flags)
    {
        if (Native.statx(fd, name, flags, 0x7ff, out var info) != 0)
        {
            if (Marshal.GetLastPInvokeError() == 2) return null;
            throw Error();
        }
        if ((info.Mask & RequiredStats) != RequiredStats) throw Error();
        return info;
    }

    private static void Flush(SafeFileHandle handle) { if (Native.fsync(Fd(handle)) != 0) throw Error(); }
    private static int Fd(SafeFileHandle handle) => checked((int)handle.DangerousGetHandle());
    private static SafeFileHandle Handle(int fd) => fd < 0 ? throw Error() : new((nint)fd, ownsHandle: true);
    private static IOException Error() => new("consent-private-storage-unavailable");

    // Linux statx is a fixed 256-byte UAPI structure on supported Linux architectures;
    // never marshal glibc's architecture-specific struct stat as if it were portable.
    [StructLayout(LayoutKind.Explicit, Size = 256)]
    private struct Stat
    {
        [FieldOffset(0)] internal uint Mask;
        [FieldOffset(16)] internal uint Links;
        [FieldOffset(20)] internal uint Uid;
        [FieldOffset(28)] internal ushort Mode;
        [FieldOffset(32)] internal ulong Inode;
        [FieldOffset(40)] internal ulong Size;
        [FieldOffset(136)] internal uint DeviceMajor;
        [FieldOffset(140)] internal uint DeviceMinor;
    }

    private static class Native
    {
        [DllImport("libc", SetLastError = true)] internal static extern int openat(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int flags, uint mode);
        [DllImport("libc", SetLastError = true)] internal static extern int mkdirat(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, uint mode);
        [DllImport("libc", SetLastError = true)] internal static extern int statx(int fd, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, int flags, uint mask, out Stat info);
        [DllImport("libc", SetLastError = true)] internal static extern int renameat(int oldFd, [MarshalAs(UnmanagedType.LPUTF8Str)] string oldName, int newFd, [MarshalAs(UnmanagedType.LPUTF8Str)] string newName);
        [DllImport("libc", SetLastError = true)] internal static extern int flock(int fd, int operation);
        [DllImport("libc", SetLastError = true)] internal static extern int fsync(int fd);
        [DllImport("libc")] internal static extern uint geteuid();
    }
}
