// T13 r3 regression proofs for deadline ownership and stale detection runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCredentialStore, type OriginCredentials } from './credentials.js';
import { setup } from './test-support/harness.js';
import { PAGE_ORIGIN } from './test-support/mock-agent.js';

afterEach(() => vi.useRealTimers());

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const heldCredential: OriginCredentials = {
  current: 'family-1',
  families: {
    'family-1': {
      familyId: 'family-1',
      token: 'held-token',
      expiresAt: '2099-11-01T13:00:00.000Z',
      renewAfter: '2099-11-01T12:30:00.000Z',
      familyExpiresAt: '2099-11-01T14:00:00.000Z',
    },
  },
};

describe('T13 r3: every detection continuation belongs to its run deadline', () => {
  it('does not issue a token after an authorize credential lock outlives the cap', async () => {
    vi.useFakeTimers();
    const store = new MemoryCredentialStore();
    const h = setup({ store, now: () => Date.now(), recheckCapMs: 2_000 });
    h.agent.limits = { ...h.agent.limits, tokenTtlSeconds: 1, familyMaxSeconds: 30 };
    await h.client.connect();
    expect(h.agent.ops('issueToken')).toBe(1);

    const release = deferred<undefined>();
    const lock = store.withLock(PAGE_ORIGIN, () => release.promise);
    const reconnect = h.client.connect();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(h.agent.ops('issueToken')).toBe(1);

    release.resolve(undefined);
    await lock;
    await reconnect;

    // currentCredential resumes after the deadline, sees the short-lived token as expired, and
    // currently reaches POST /auth/token before authorized() performs its post-await guard.
    expect(h.agent.ops('issueToken')).toBe(1);
    h.client.dispose();
  });

  it('stops at an exact cap instead of polling and authorizing at the deadline', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckCapMs: 4_000 });
    let consentReads = 0;
    const consent = (state: 'pending' | 'granted', pollAfterSeconds?: number): Response =>
      new Response(
        JSON.stringify({
          origin: PAGE_ORIGIN,
          state,
          ...(pollAfterSeconds === undefined ? {} : { pollAfterSeconds }),
        }),
        {
          status: state === 'pending' ? 202 : 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    h.intercept = (url, init) => {
      if (!url.endsWith('/auth/consent')) return undefined;
      if (init.method === 'GET') consentReads += 1;
      return Promise.resolve(init.method === 'POST' ? consent('pending', 10) : consent('granted'));
    };

    expect((await h.client.connect()).state).toBe('awaiting-consent');
    h.agent.consent = 'granted';
    await vi.advanceTimersByTimeAsync(4_000);

    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    expect(consentReads).toBe(0);
    expect(h.agent.ops('issueToken')).toBe(0);
    h.client.dispose();
  });

  it('does not let an expired canceled run stop a newer awaiting-consent run', async () => {
    vi.useFakeTimers();
    const store = new MemoryCredentialStore();
    await store.write(PAGE_ORIGIN, heldCredential);
    const tokenRead = deferred<OriginCredentials | undefined>();
    let reads = 0;
    store.read = async () => {
      reads += 1;
      if (reads === 1) return tokenRead.promise;
      return undefined;
    };
    const h = setup({ store, consent: 'none', recheckCapMs: 2_000 });

    const first = h.client.connect();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await h.client.connect()).state).toBe('awaiting-consent');

    await vi.advanceTimersByTimeAsync(1_500);
    tokenRead.resolve(heldCredential);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    h.client.dispose();
    await first;
  });
});
