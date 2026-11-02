using System.Text;
using Xunit;
using Zilo.Security.Persistence;

namespace Zilo.Agent.Tests;

public sealed class ConsentSessionTests
{
    private static readonly byte[] Dirty = Encoding.UTF8.GetBytes("zilo-consent-session-v1\n");
    private static readonly byte[] Clean = Encoding.UTF8.GetBytes("zilo-consent-clean-v1\n");

    [Fact]
    public async Task New_store_fences_before_empty_snapshot_and_never_cleans_on_dispose()
    {
        var disk = new ControlledDirectory();
        await using (var session = new ConsentSession(disk))
        {
            var opened = await session.OpenAsync(TestContext.Current.CancellationToken);
            Assert.Equal(ConsentStorageHealth.Ready, opened.Health);
            Assert.Equal(new[] { "session.fence", "consent.json" }, disk.Writes);
            Assert.Equal(Dirty, disk.Fence);
        }
        Assert.Equal(Dirty, disk.Fence);
    }

    [Fact]
    public async Task Clean_shutdown_preserves_grant_and_block_after_new_durable_fence()
    {
        var disk = new ControlledDirectory();
        await using (var session = new ConsentSession(disk))
        {
            await session.OpenAsync(TestContext.Current.CancellationToken);
            await session.WriteAsync(Snapshot(2, "granted", "blocked"), TestContext.Current.CancellationToken);
            await session.CompleteAsync(2, TestContext.Current.CancellationToken);
            Assert.Equal(Clean, disk.Fence);
        }
        await using var reopened = new ConsentSession(disk);
        var result = await reopened.OpenAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Ready, result.Health);
        Assert.Equal(new[] { "granted", "blocked" }, result.Snapshot!.Records.Select(r => r.State));
        Assert.Equal(Dirty, disk.Fence);
    }

    [Fact]
    public async Task Failed_block_persistence_then_dispose_reopen_is_unavailable_not_old_grant()
    {
        var disk = new ControlledDirectory();
        await using (var session = new ConsentSession(disk))
        {
            await session.OpenAsync(TestContext.Current.CancellationToken);
            await session.WriteAsync(Snapshot(2, "granted"), TestContext.Current.CancellationToken);
            disk.FailNextReplace = true;
            await Assert.ThrowsAsync<IOException>(() => session.WriteAsync(Snapshot(3, "blocked"), TestContext.Current.CancellationToken).AsTask());
            await Assert.ThrowsAsync<InvalidOperationException>(() => session.CompleteAsync(2, TestContext.Current.CancellationToken).AsTask());
        }
        await using var reopened = new ConsentSession(disk);
        var result = await reopened.OpenAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
        Assert.Null(result.Snapshot);
    }

    [Theory]
    [InlineData("dirty")]
    [InlineData("unknown")]
    [InlineData("missing")]
    [InlineData("corrupt")]
    [InlineData("temp")]
    public async Task Unresolved_metadata_never_becomes_empty_permissions(string fault)
    {
        var disk = new ControlledDirectory { Bytes = ConsentSnapshotCodec.Encode(Snapshot(1, "granted")), Fence = Clean };
        if (fault == "dirty") disk.Fence = Dirty;
        if (fault == "unknown") disk.Fence = Encoding.UTF8.GetBytes("clean");
        if (fault == "missing") disk.Fence = null;
        if (fault == "corrupt") disk.Bytes = Encoding.UTF8.GetBytes("broken");
        if (fault == "temp") disk.Interrupted = true;
        await using var session = new ConsentSession(disk);
        var result = await session.OpenAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
        Assert.Null(result.Snapshot);
        Assert.Empty(disk.Writes);
    }

    [Fact]
    public async Task Failed_boot_fence_cannot_publish_saved_grants()
    {
        var disk = new ControlledDirectory { Bytes = ConsentSnapshotCodec.Encode(Snapshot(1, "granted")), Fence = Clean, FailNextReplace = true };
        await using var session = new ConsentSession(disk);
        var result = await session.OpenAsync(TestContext.Current.CancellationToken);
        Assert.Equal(ConsentStorageHealth.Unavailable, result.Health);
        Assert.False(result.DurableActiveFence);
        Assert.Null(result.Snapshot);
    }

    private static ConsentSnapshot Snapshot(long generation, params string[] states) => new(generation,
        states.Select((state, i) => new StoredConsent($"https://site{i}.example", state, false,
            DateTimeOffset.UnixEpoch, null, null)).ToArray());

    // Simulated ordered/durable acknowledgements only: this is NOT OS/private-path/crash evidence.
    private sealed class ControlledDirectory : IPrivateConsentDirectory
    {
        internal byte[]? Bytes;
        internal byte[]? Fence;
        internal bool Interrupted;
        internal bool FailNextReplace;
        internal List<string> Writes { get; } = new();
        public ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken) => new(new ConsentDirectoryContents(Bytes, Fence, Interrupted));
        public ValueTask ReplaceAsync(string name, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken)
        {
            if (FailNextReplace) { FailNextReplace = false; throw new IOException("simulated-flush-fault"); }
            Writes.Add(name);
            if (name == "consent.json") Bytes = contents.ToArray();
            else if (name == "session.fence") Fence = contents.ToArray();
            else throw new InvalidOperationException();
            return ValueTask.CompletedTask;
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
