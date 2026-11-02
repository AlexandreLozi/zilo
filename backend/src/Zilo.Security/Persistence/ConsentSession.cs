namespace Zilo.Security.Persistence;

public enum ConsentStorageHealth { Starting, Ready, Unavailable, Stopping, Stopped }
public enum ConsentMutationOutcome { Durable, Superseded, FenceCovered, NotSaved, Rejected }
public sealed record ConsentOpenResult(ConsentStorageHealth Health, ConsentSnapshot? Snapshot,
    bool DurableActiveFence, string? DiagnosticCode);
public sealed record ConsentMutationResult(ConsentMutationOutcome Outcome, long Generation);
public sealed record ConsentResetConfirmation(bool UserConfirmedSavedBlocksWillBeReset);
public sealed record ConsentResetResult(bool Succeeded, string? DiagnosticCode);

public interface IConsentPersistence : IAsyncDisposable
{
    ValueTask<ConsentOpenResult> OpenSessionAsync(CancellationToken cancellationToken = default);
    ValueTask WriteSnapshotAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default);
    ValueTask CompleteSessionAsync(long durableGeneration, CancellationToken cancellationToken = default);
    ValueTask<ConsentOpenResult> ResetAsync(ConsentResetConfirmation confirmation, CancellationToken cancellationToken = default);
}

// Implementations must hold the verified private directory and lifetime writer lock.
// There is deliberately no path-based or unverified production implementation.
internal sealed record ConsentDirectoryContents(byte[]? Snapshot, byte[]? Fence, bool InterruptedArtifacts);
internal interface IPrivateConsentDirectory : IAsyncDisposable
{
    ValueTask<ConsentDirectoryContents> ReadAsync(CancellationToken cancellationToken);
    ValueTask ReplaceAsync(string name, ReadOnlyMemory<byte> contents, CancellationToken cancellationToken);
}

internal sealed class ConsentSession(IPrivateConsentDirectory directory) : IAsyncDisposable
{
    private static readonly byte[] Dirty = System.Text.Encoding.UTF8.GetBytes("zilo-consent-session-v1\n");
    private static readonly byte[] Clean = System.Text.Encoding.UTF8.GetBytes("zilo-consent-clean-v1\n");
    private readonly SemaphoreSlim _writer = new(1, 1);
    private ConsentStorageHealth _health = ConsentStorageHealth.Starting;
    private long _durableGeneration;
    private bool _durableFence;
    private bool _disposed;

    internal async ValueTask<ConsentOpenResult> OpenAsync(CancellationToken cancellationToken = default)
    {
        await _writer.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_disposed || _health != ConsentStorageHealth.Starting) throw new InvalidOperationException("consent-session-already-opened");
            try
            {
                var contents = await directory.ReadAsync(cancellationToken).ConfigureAwait(false);
                if (contents.InterruptedArtifacts) return Unavailable("consent-interrupted-state");
                ConsentSnapshot snapshot;
                var fresh = contents.Snapshot is null && contents.Fence is null;
                if (fresh) snapshot = new(1, Array.Empty<StoredConsent>());
                else
                {
                    if (contents.Snapshot is null || contents.Fence is null) return Unavailable("consent-metadata-missing");
                    if (!contents.Fence.AsSpan().SequenceEqual(Clean)) return Unavailable("consent-session-unclean");
                    snapshot = ConsentSnapshotCodec.Decode(contents.Snapshot);
                }
                // ReplaceAsync acknowledges only after the adapter's flush/namespace sequence.
                // No snapshot is returned before that acknowledgement, even on clean restarts.
                await directory.ReplaceAsync("session.fence", Dirty, cancellationToken).ConfigureAwait(false);
                _durableFence = true;
                if (fresh)
                    await directory.ReplaceAsync("consent.json", ConsentSnapshotCodec.Encode(snapshot), cancellationToken).ConfigureAwait(false);
                _durableGeneration = snapshot.Generation;
                _health = ConsentStorageHealth.Ready;
                return new(_health, snapshot, true, null);
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or OperationCanceledException)
            {
                return Unavailable("consent-storage-unavailable");
            }
        }
        finally { _writer.Release(); }
    }

    internal async ValueTask WriteAsync(ConsentSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        await _writer.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            RequireReady();
            if (snapshot.Generation <= _durableGeneration) throw new InvalidOperationException("consent-generation-stale");
            try
            {
                var bytes = ConsentSnapshotCodec.Encode(snapshot);
                await directory.ReplaceAsync("consent.json", bytes, cancellationToken).ConfigureAwait(false);
                _durableGeneration = snapshot.Generation;
            }
            catch
            {
                // Even an uncertain/partly completed write poisons clean shutdown for this session.
                _health = ConsentStorageHealth.Unavailable;
                throw;
            }
        }
        finally { _writer.Release(); }
    }

    internal async ValueTask CompleteAsync(long durableGeneration, CancellationToken cancellationToken = default)
    {
        await _writer.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            RequireReady();
            if (durableGeneration != _durableGeneration) throw new InvalidOperationException("consent-generation-unresolved");
            _health = ConsentStorageHealth.Stopping;
            try
            {
                await directory.ReplaceAsync("session.fence", Clean, cancellationToken).ConfigureAwait(false);
                _health = ConsentStorageHealth.Stopped;
                _durableFence = false;
            }
            catch { _health = ConsentStorageHealth.Unavailable; throw; }
        }
        finally { _writer.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        await _writer.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed) return;
            _disposed = true;
            _health = ConsentStorageHealth.Stopped;
            // Dispose releases ownership, NEVER promotes an unresolved marker to clean.
            await directory.DisposeAsync().ConfigureAwait(false);
        }
        finally { _writer.Release(); }
    }

    private ConsentOpenResult Unavailable(string code)
    {
        _health = ConsentStorageHealth.Unavailable;
        return new(_health, null, _durableFence, code);
    }

    private void RequireReady()
    {
        if (_disposed || _health != ConsentStorageHealth.Ready || !_durableFence)
            throw new InvalidOperationException("consent-session-not-ready");
    }
}
