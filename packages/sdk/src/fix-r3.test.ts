// T13 fix r3: one run model. Each detection run owns an AbortController, one deadline timer that
// aborts it at `since + cap`, and its identity. These tests hold every awaited step in turn and
// end the run while it is pending, by the deadline or by `dispose()`, then release the step late.
// All of them use fake timers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCredentialStore, type OriginCredentials } from './credentials.js';
import type { DetectionStateName } from './detection.js';
import { setup, type Harness } from './test-support/harness.js';
import { PAGE_ORIGIN } from './test-support/mock-agent.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const CAP = 6_000;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A fetch answer that never comes; it rejects (and removes its listener) when aborted. */
function hold(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal;
    const onAbort = (): void => {
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

function abortListeners(): { live: () => number } {
  const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
  const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
  const count = (calls: unknown[][]): number => calls.filter((c) => c[0] === 'abort').length;
  return { live: () => count(add.mock.calls) - count(remove.mock.calls) };
}

const bearer = (init: RequestInit): boolean =>
  new Headers(init.headers).get('Authorization') !== null;

/** A credential the mock agent never issued: authorizing with it would issue a new token. */
const foreignCredential: OriginCredentials = {
  current: 'family-x',
  families: {
    'family-x': {
      familyId: 'family-x',
      token: 'foreign-token',
      expiresAt: '2099-11-01T13:00:00.000Z',
      renewAfter: '2099-11-01T12:30:00.000Z',
      familyExpiresAt: '2099-11-01T14:00:00.000Z',
    },
  },
};

interface Held {
  h: Harness;
  store: MemoryCredentialStore;
  /** The `connect()` whose run is held, and when that run started. */
  connect: Promise<unknown>;
  since: number;
  /** The state the flow shows while the step is pending. */
  shows: DetectionStateName;
  /** Lets the held step finish late (no-op for a held request: it ends when aborted). */
  release: () => void;
  /** Requests the held step started (consent `POST`/`GET`, full `hello`). */
  started: () => number;
}

interface Step {
  name: string;
  /** Builds a run and advances until the step is pending, before the deadline. */
  arrange: () => Promise<Held>;
}

const steps: Step[] = [
  {
    name: 'the token read',
    arrange: async () => {
      const store = new MemoryCredentialStore();
      const read = deferred<OriginCredentials | undefined>();
      let reads = 0;
      store.read = () => (++reads === 1 ? read.promise : Promise.resolve(undefined));
      const h = setup({ store, consent: 'granted', recheckCapMs: CAP });
      const since = Date.now();
      const connect = h.client.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reads).toBe(1);
      return {
        h,
        store,
        connect,
        since,
        shows: 'checking',
        // A late "token held" answer would authorize with a token the agent does not know.
        release: () => {
          read.resolve(foreignCredential);
        },
        started: () => reads,
      };
    },
  },
  {
    name: 'authorize, waiting for the credential lock',
    arrange: async () => {
      const store = new MemoryCredentialStore();
      const h = setup({ store, consent: 'granted', recheckCapMs: CAP });
      const unlock = deferred<undefined>();
      void store.withLock(PAGE_ORIGIN, () => unlock.promise);
      const since = Date.now();
      const connect = h.client.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(h.agent.ops('requestConsent')).toBe(1); // granted: authorize waits for the lock
      return {
        h,
        store,
        connect,
        since,
        shows: 'checking',
        release: () => {
          unlock.resolve(undefined);
        },
        started: () => h.agent.ops('issueToken'),
      };
    },
  },
  {
    name: 'authorize, reading the full hello',
    arrange: async () => {
      const store = new MemoryCredentialStore();
      const h = setup({ store, consent: 'granted', recheckCapMs: CAP });
      expect((await h.client.connect()).state).toBe('ready');
      let fullHellos = 0;
      h.intercept = (url, init) => {
        if (!url.endsWith('/hello') || !bearer(init)) return undefined;
        fullHellos += 1;
        return hold(init);
      };
      const since = Date.now();
      const connect = h.client.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fullHellos).toBe(1);
      return {
        h,
        store,
        connect,
        since,
        shows: 'checking',
        release: () => undefined,
        started: () => 0,
      };
    },
  },
  {
    name: 'the consent POST',
    arrange: async () => {
      const store = new MemoryCredentialStore();
      const h = setup({ store, consent: 'none', recheckCapMs: CAP });
      let posts = 0;
      h.intercept = (url, init) => {
        if (!url.endsWith('/auth/consent') || init.method !== 'POST') return undefined;
        posts += 1;
        return hold(init);
      };
      const since = Date.now();
      const connect = h.client.connect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(posts).toBe(1);
      return {
        h,
        store,
        connect,
        since,
        shows: 'checking',
        release: () => {
          h.agent.consent = 'granted';
        },
        started: () => posts,
      };
    },
  },
  {
    name: 'a consent GET',
    arrange: async () => {
      const store = new MemoryCredentialStore();
      const h = setup({ store, consent: 'none', recheckCapMs: CAP });
      let gets = 0;
      h.intercept = (url, init) => {
        if (!url.endsWith('/auth/consent') || init.method !== 'GET') return undefined;
        gets += 1;
        return hold(init);
      };
      const since = Date.now();
      const connect = h.client.connect();
      expect(await connect).toMatchObject({ state: 'awaiting-consent' });
      await vi.advanceTimersByTimeAsync(2_500); // the first poll fires at 2 s and hangs
      expect(gets).toBe(1);
      return {
        h,
        store,
        connect,
        since,
        shows: 'awaiting-consent',
        release: () => {
          h.agent.consent = 'granted';
        },
        started: () => gets,
      };
    },
  },
  {
    name: 'the 429 backoff',
    arrange: async () => {
      const store = new MemoryCredentialStore();
      const h = setup({ store, consent: 'none', recheckCapMs: CAP });
      const since = Date.now();
      const connect = h.client.connect();
      expect(await connect).toMatchObject({ state: 'awaiting-consent' });
      // 2 s: 429 → wait to 5 s; 5 s: 429 → the next wait would end at 8 s, past the cap.
      h.agent.inject.set('getConsent', [
        { status: 429, code: 'rate-limited', retryAfterSeconds: 3 },
        { status: 429, code: 'rate-limited', retryAfterSeconds: 3 },
      ]);
      await vi.advanceTimersByTimeAsync(2_500);
      expect(h.agent.ops('getConsent')).toBe(1);
      return {
        h,
        store,
        connect,
        since,
        shows: 'awaiting-consent',
        release: () => {
          h.agent.consent = 'granted';
        },
        started: () => h.agent.ops('getConsent'),
      };
    },
  },
];

describe('T13 fix r3: the deadline aborts the step that is pending', () => {
  for (const step of steps) {
    it(`stops at the cap during ${step.name}, and the late result starts nothing`, async () => {
      vi.useFakeTimers();
      const held = await step.arrange();
      const { h } = held;
      const issued = h.agent.ops('issueToken');
      const posts = h.agent.ops('requestConsent');
      const stored = JSON.stringify(await held.store.read(PAGE_ORIGIN));

      // Up to one tick before the deadline the run is still live; at the deadline it stops.
      const deadline = held.since + CAP;
      await vi.advanceTimersByTimeAsync(deadline - 1 - Date.now());
      expect(h.client.detection.snapshot.state).toBe(held.shows);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
      expect(vi.getTimerCount()).toBe(0);

      const started = held.started();
      const requests = h.agent.log.length;
      held.release();
      await vi.advanceTimersByTimeAsync(20_000);
      await held.connect;

      expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
      expect(held.started()).toBe(started);
      expect(h.agent.log.length).toBe(requests);
      expect(h.agent.ops('issueToken')).toBe(issued);
      expect(h.agent.ops('requestConsent')).toBe(posts);
      expect(JSON.stringify(await held.store.read(PAGE_ORIGIN))).toBe(stored);
      expect(vi.getTimerCount()).toBe(0);
      h.client.dispose();
    });
  }
});

describe('T13 fix r3: dispose() aborts the step that is pending through the same path', () => {
  for (const step of steps) {
    it(`tears down during ${step.name}: no timer, no listener, nothing late`, async () => {
      vi.useFakeTimers();
      const listeners = abortListeners();
      const held = await step.arrange();
      const { h } = held;
      const notified: string[] = [];
      h.client.onState((s) => notified.push(s.state));
      const issued = h.agent.ops('issueToken');
      const stored = JSON.stringify(await held.store.read(PAGE_ORIGIN));

      h.client.dispose();
      await held.connect; // the pending start() settles instead of hanging
      // An aborted request clears its own timeout as its rejection settles: flush the pending
      // callbacks, without moving the clock, before counting.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(listeners.live()).toBe(0);

      const started = held.started();
      const requests = h.agent.log.length;
      held.release();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(notified).toEqual([]);
      expect(h.client.detection.snapshot.state).toBe('idle');
      expect(held.started()).toBe(started);
      expect(h.agent.log.length).toBe(requests);
      expect(h.agent.ops('issueToken')).toBe(issued);
      expect(JSON.stringify(await held.store.read(PAGE_ORIGIN))).toBe(stored);
      expect(vi.getTimerCount()).toBe(0);
      expect(listeners.live()).toBe(0);
    });
  }
});

describe('T13 fix r3: only the current run changes state', () => {
  it('A → B → C: late answers of A and B, and their deadlines, never touch C', async () => {
    vi.useFakeTimers();
    const store = new MemoryCredentialStore();
    const reads = [
      deferred<OriginCredentials | undefined>(),
      deferred<OriginCredentials | undefined>(),
    ];
    let n = 0;
    store.read = () => reads[n++]?.promise ?? Promise.resolve(undefined);
    const h = setup({ store, consent: 'none', recheckCapMs: 3_000 });
    const states: string[] = [];
    h.client.onState((s) => states.push(s.state));

    const a = h.client.connect(); // t = 0, deadline 3 s; its token read hangs
    await vi.advanceTimersByTimeAsync(1_000);
    const b = h.client.connect(); // t = 1 s, deadline 4 s; its token read hangs
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await h.client.connect()).state).toBe('awaiting-consent'); // C: t = 2 s, deadline 5 s
    expect(n).toBe(3);

    // B answers late but before its own deadline; then A's and B's deadlines pass.
    reads[1]?.resolve(foreignCredential);
    await vi.advanceTimersByTimeAsync(2_500); // t = 4.5 s
    reads[0]?.resolve(foreignCredential); // A answers after its deadline
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([a, b]);

    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    expect(h.agent.ops('issueToken')).toBe(0);
    expect(h.agent.ops('requestConsent')).toBe(1); // C's only
    expect(h.agent.log.filter((l) => l.token !== undefined)).toHaveLength(0);

    // C still stops at its own deadline, and only once.
    await vi.advanceTimersByTimeAsync(499);
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    expect(states.filter((s) => s === 'unreachable-stopped')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    h.client.dispose();
  });

  it('cancel() clears the run deadline, so it cannot stop the next run', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckCapMs: 3_000 });
    expect((await h.client.connect()).state).toBe('awaiting-consent');
    h.client.detection.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await h.client.connect()).state).toBe('awaiting-consent'); // deadline at 5 s
    await vi.advanceTimersByTimeAsync(2_999);
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    h.client.dispose();
  });

  it('a settled run keeps no deadline timer', async () => {
    vi.useFakeTimers();
    const h = setup({ recheckCapMs: 3_000 });
    expect((await h.client.connect()).state).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.client.detection.snapshot.state).toBe('ready');
    h.client.dispose();
  });
});

describe('T13 fix r3: the deadline is exclusive', () => {
  it('starts no re-probe at the deadline itself', async () => {
    vi.useFakeTimers();
    const h = setup({ recheckIntervalMs: 2_000, recheckCapMs: 6_000 });
    const probes: number[] = [];
    h.intercept = (url) => {
      if (url.endsWith('/hello')) {
        probes.push(Date.now());
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return undefined;
    };
    const since = Date.now();
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(h.client.detection.snapshot.state).toBe('unreachable-or-blocked');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    expect([...new Set(probes.map((t) => t - since))]).toEqual([0, 2_000, 4_000]); // rounds
    expect(vi.getTimerCount()).toBe(0);
    h.client.dispose();
  });

  it('ignores a consent answer that arrives exactly at the deadline', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckCapMs: 6_000 });
    expect((await h.client.connect()).state).toBe('awaiting-consent');
    h.agent.pollScript = ['granted'];
    // The 2 s poll's answer is held until exactly 6 s.
    h.intercept = (url, init) =>
      url.endsWith('/auth/consent') && init.method === 'GET'
        ? new Promise((resolve, reject) => {
            setTimeout(
              () => void h.agent.fetch(url, { method: 'GET' }).then(resolve, reject),
              4_000,
            );
          })
        : undefined;
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    expect(h.agent.ops('issueToken')).toBe(0);
    h.client.dispose();
  });
});
