// T13 fix r4: restart cleanup (the R-R3 family drop after an instance change) is a credential write
// and honours the run signal and disposal like every other write. A drop skipped because its run
// ended is not lost: the next live run's full `hello` performs it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClient } from './auth.js';
import { MemoryCredentialStore, type FamilyCredential } from './credentials.js';
import { ZiloAbortError, ZiloDisposedError } from './errors.js';
import { setup } from './test-support/harness.js';
import { PAGE_ORIGIN } from './test-support/mock-agent.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const FAR = '2099-01-01T00:00:00Z';

function family(familyId: string): FamilyCredential {
  return {
    familyId,
    token: `tok-${familyId}`,
    expiresAt: FAR,
    renewAfter: FAR,
    familyExpiresAt: FAR,
  };
}

/** Takes the lock and resolves, once it is held, with the function that releases it. */
async function holdLock(store: MemoryCredentialStore): Promise<() => void> {
  let unlock!: () => void;
  const acquired = new Promise<void>((started) => {
    void store.withLock(
      PAGE_ORIGIN,
      () =>
        new Promise<void>((resolve) => {
          unlock = resolve;
          started();
        }),
    );
  });
  await acquired;
  return unlock;
}

async function familyIds(store: MemoryCredentialStore): Promise<string[]> {
  const rec = await store.read(PAGE_ORIGIN);
  return Object.keys(rec?.families ?? {}).sort();
}

describe('restart cleanup after an aborted run (r4 finding 1)', () => {
  it('defers the skipped family drop to the next live run instead of losing it', async () => {
    vi.useFakeTimers();
    const store = new MemoryCredentialStore();
    const h = setup({ store, recheckCapMs: 2_000 });
    await h.client.connect();
    expect(h.client.detection.snapshot.state).toBe('ready');
    // A family of the old process that this client never read: only the restart drop removes it.
    const rec = await store.read(PAGE_ORIGIN);
    if (rec === undefined) throw new Error('no credentials stored');
    rec.families.orphan = family('orphan');
    await store.write(PAGE_ORIGIN, rec);

    h.agent.restart();
    let unlock!: () => void;
    let held = false;
    h.intercept = (url, init) => {
      if (
        !held &&
        url.endsWith('/hello') &&
        new Headers(init.headers).has('Authorization') &&
        h.agent.ops('issueToken') === 2
      ) {
        held = true;
        void store.withLock(PAGE_ORIGIN, () => new Promise<void>((resolve) => (unlock = resolve)));
      }
      return undefined;
    };
    const first = h.client.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(held).toBe(true);
    await vi.advanceTimersByTimeAsync(1_900); // the run's deadline
    await first;
    unlock();
    await vi.advanceTimersByTimeAsync(0);
    // The aborted run's drop never started: the orphan is still stored.
    expect(await familyIds(store)).toContain('orphan');

    const second = h.client.connect();
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(h.client.detection.snapshot.state).toBe('ready');
    const ids = await familyIds(store);
    expect(ids).not.toContain('orphan');
    expect(ids).toHaveLength(1);
    h.client.dispose();
  });
});

describe('every credential drop is guarded (r4 audit)', () => {
  function auth(store: MemoryCredentialStore, closed: () => boolean = () => false): AuthClient {
    return new AuthClient({
      origin: PAGE_ORIGIN,
      store,
      transport: () => {
        throw new Error('no transport in this test');
      },
      now: () => Date.parse('2026-11-01T12:00:00Z'),
      closed,
    });
  }

  async function seeded(): Promise<MemoryCredentialStore> {
    const store = new MemoryCredentialStore();
    await store.write(PAGE_ORIGIN, {
      current: 'a',
      families: { a: family('a'), b: family('b') },
    });
    return store;
  }

  const drops = {
    dropAllExcept: (a: AuthClient, s?: AbortSignal) => a.dropAllExcept('a', s),
    dropFamily: (a: AuthClient, s?: AbortSignal) => a.dropFamily('b', s),
    recoverInvalid: (a: AuthClient, s?: AbortSignal) => a.recoverInvalid('b', 'tok-b', s),
  };

  for (const [name, run] of Object.entries(drops)) {
    it(`${name}: no write after dispose, before or inside the lock`, async () => {
      const store = await seeded();
      let closed = true;
      const writes = vi.spyOn(store, 'write');
      await expect(run(auth(store, () => closed))).rejects.toBeInstanceOf(ZiloDisposedError);
      // Disposed while queued behind another holder of the lock.
      closed = false;
      const unlock = await holdLock(store);
      const queued = run(auth(store, () => closed));
      closed = true;
      unlock();
      await expect(queued).rejects.toBeInstanceOf(ZiloDisposedError);
      expect(writes).not.toHaveBeenCalled();
      expect(await familyIds(store)).toEqual(['a', 'b']);
    });

    it(`${name}: no write after the signal aborts, before or while waiting for the lock`, async () => {
      const store = await seeded();
      const writes = vi.spyOn(store, 'write');
      const pre = new AbortController();
      pre.abort();
      await expect(run(auth(store), pre.signal)).rejects.toBeInstanceOf(ZiloAbortError);
      let unlock!: () => void;
      void store.withLock(PAGE_ORIGIN, () => new Promise<void>((resolve) => (unlock = resolve)));
      const ctl = new AbortController();
      const queued = run(auth(store), ctl.signal);
      ctl.abort();
      await expect(queued).rejects.toBeInstanceOf(ZiloAbortError);
      unlock();
      await Promise.resolve();
      await store.withLock(PAGE_ORIGIN, () => Promise.resolve());
      expect(writes).not.toHaveBeenCalled();
      expect(await familyIds(store)).toEqual(['a', 'b']);
    });
  }
});
