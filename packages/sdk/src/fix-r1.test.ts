// T13 fix r1: auth recovery around renewal, safe shared-family pruning, one rollover per scan,
// client disposal (the owner's Load/Unload), the run deadline, and the agreed triage items.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZiloClient } from './client.js';
import { MemoryCredentialStore } from './credentials.js';
import { decodeCaps, isResolutionList, isResolutionRange, resolutionChoice } from './decode.js';
import {
  ZiloAccessRevokedError,
  ZiloAgentRestartedError,
  ZiloDisposedError,
  isProblem,
} from './errors.js';
import { queryLoopbackPermissionDetail } from './permission.js';
import { permissions, setup } from './test-support/harness.js';
import { MockAgent, PAGE_ORIGIN, fixtures } from './test-support/mock-agent.js';
import type { SourceCaps } from './types.js';

const MIN = 60_000;
const scan = { deviceId: 'virtual-0', settings: { source: 'flatbed' as const } };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = Date.parse('2026-11-01T12:00:00Z');
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Counts `abort` listeners added to and removed from any EventTarget (AbortSignal included). */
function abortListeners(): { live: () => number } {
  // Pass-through spies: the real methods still run.
  const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
  const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener');
  const count = (calls: unknown[][]): number => calls.filter((c) => c[0] === 'abort').length;
  return { live: () => count(add.mock.calls) - count(remove.mock.calls) };
}

function newAgent(consent = 'granted'): MockAgent {
  const agent = new MockAgent(48100);
  agent.consent = consent;
  agent.devices = [fixtures.virtualDevice];
  agent.caps.set('virtual-0', fixtures.virtualCaps);
  return agent;
}

function clientOn(agent: MockAgent, store: MemoryCredentialStore): ZiloClient {
  return new ZiloClient({
    origin: PAGE_ORIGIN,
    store,
    fetch: agent.fetch,
    permissions: permissions('granted'),
    isSafari: false,
  });
}

describe('renewal runs inside the recovery path (r1 P1 #1)', () => {
  it('reconnects after an agent restart when the held token first needs renewal', async () => {
    const c = clock();
    const h = setup({ now: c.now });
    await h.client.connect();
    c.advance(46 * MIN);
    h.agent.restart();
    const snap = await h.client.connect();
    expect(snap.state).toBe('ready');
    expect(snap.hello && 'instanceId' in snap.hello && snap.hello.instanceId).toBe(
      h.agent.instanceId,
    );
    expect(h.agent.ops('issueToken')).toBe(2);
  });

  it('recovers a non-job call whose renewal gets 401, and reports the restart', async () => {
    const c = clock();
    const h = setup({ now: c.now });
    await h.client.connect();
    const job = await h.client.createJob(scan);
    const lost: string[] = [];
    h.client.onJobsLost((jobs) => lost.push(...jobs.map((j) => j.id)));
    c.advance(46 * MIN);
    h.agent.restart();
    const list = await h.client.listDevices();
    expect(list.devices).toHaveLength(2);
    expect(lost).toEqual([job.id]);
    await expect(h.client.getJob(job.id)).rejects.toBeInstanceOf(ZiloAgentRestartedError);
  });

  it('maps a renewal answered token-revoked to access revoked and drops the family', async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const h = setup({ now: c.now, store });
    await h.client.connect();
    c.advance(46 * MIN);
    h.agent.revokeAll();
    const err = await h.client.listDevices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloAccessRevokedError);
    expect(h.client.detection.snapshot.state).toBe('token-revoked');
    expect((await store.read(PAGE_ORIGIN))?.families).toEqual({});
  });

  it('applies the removal check (R-A13) when renewal fails with a TypeError', async () => {
    const c = clock();
    const h = setup({ now: c.now });
    await h.client.connect();
    c.advance(46 * MIN);
    h.agent.removeSite(); // protected endpoints now answer without CORS: a TypeError
    const err = await h.client.listDevices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloAccessRevokedError);
    expect(h.agent.ops('renewToken')).toBe(1);
    expect(h.agent.ops('getConsent')).toBe(1);
  });
});

describe('shared-store pruning (r1 P1 #2)', () => {
  it('drops only families that provably ended, never a live one of another client', async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const agent = newAgent();
    agent.now = c.now;
    agent.limits = { ...agent.limits, familyMaxSeconds: 3600 };
    const a = new ZiloClient({
      origin: PAGE_ORIGIN,
      store,
      fetch: agent.fetch,
      permissions: permissions('granted'),
      isSafari: false,
      now: c.now,
    });
    await a.connect();
    const ended = (await store.read(PAGE_ORIGIN))?.current;
    await a.createJob(scan); // final token: a new family; the first one stays (still live)
    const live = (await store.read(PAGE_ORIGIN))?.current;
    expect(Object.keys((await store.read(PAGE_ORIGIN))?.families ?? {})).toEqual(
      expect.arrayContaining([ended, live]),
    );
    c.advance(61 * MIN); // both families passed their deadline
    await a.listDevices(); // the next issuance prunes what provably ended
    const rec = await store.read(PAGE_ORIGIN);
    expect(Object.keys(rec?.families ?? {})).toEqual([rec?.current]);
    expect(rec?.current).not.toBe(live);
  });
});

describe('one rollover per new scan (r1 P2 #3)', () => {
  it('keeps the selected family through the request and records its instance once', async () => {
    const h = setup();
    h.agent.limits = { ...h.agent.limits, familyMaxSeconds: 3600 };
    await h.client.connect();
    const issued = h.agent.ops('issueToken');
    const hellos = h.agent.ops('getHello');
    const job = await h.client.createJob(scan);
    expect(h.agent.ops('issueToken') - issued).toBe(1);
    expect(h.agent.ops('getHello') - hellos).toBe(1); // the new family's instance recording
    const created = h.agent.log.filter((l) => l.op === 'createJob').at(-1);
    const tracked = h.client.trackedJobs.find((j) => j.id === job.id);
    expect(h.agent.jobs.get(job.id)?.familyId).toBe(tracked?.familyId);
    expect(created?.token).toBeDefined();
  });
});

describe('disposal lifecycle (r1 P2 #4, the owner Load/Unload)', () => {
  it('20 create/dispose cycles leak no timers or listeners and keep no stale state', async () => {
    vi.useFakeTimers();
    const listeners = abortListeners();
    const agent = newAgent();
    const store = new MemoryCredentialStore();
    let previous: ZiloClient | undefined;
    let previousCalls = 0;
    let calls = 0;
    for (let i = 0; i < 20; i++) {
      const client = clientOn(agent, store);
      expect(client.trackedJobs).toHaveLength(0);
      client.onState(() => {
        calls++;
      });
      client.onJobsLost(() => {
        throw new Error('no job may be reported lost');
      });
      expect((await client.connect()).state).toBe('ready');
      const job = await client.createJob(scan);
      expect((await client.getJob(job.id)).id).toBe(job.id);
      if (i % 2 === 0) await client.disposeJob(job.id);

      client.dispose();
      client.dispose(); // idempotent
      expect(client.disposed).toBe(true);
      expect(client.trackedJobs).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(listeners.live()).toBe(0);
      await expect(client.connect()).rejects.toBeInstanceOf(ZiloDisposedError);
      await expect(client.listDevices()).rejects.toBeInstanceOf(ZiloDisposedError);
      await expect(client.getJob(job.id)).rejects.toBeInstanceOf(ZiloDisposedError);

      // The previous instance stays silent while this one works.
      if (previous !== undefined) expect(calls - previousCalls).toBe(2); // checking, ready
      previousCalls = calls;
      previous = client;
    }
    // One family, reused across every Load through the shared store; one consent request.
    expect(agent.ops('issueToken')).toBe(1);
    expect(agent.ops('requestConsent')).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(previousCalls);
  });

  it('20 cycles closed during pending consent: no polling and no token after a later grant', async () => {
    vi.useFakeTimers();
    const listeners = abortListeners();
    const agent = newAgent('none');
    for (let i = 0; i < 20; i++) {
      const client = clientOn(agent, new MemoryCredentialStore());
      expect((await client.connect()).state).toBe('awaiting-consent');
      client.dispose();
      expect(vi.getTimerCount()).toBe(0);
      expect(listeners.live()).toBe(0);
    }
    agent.pollScript = ['granted'];
    agent.consent = 'granted';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(agent.ops('getConsent')).toBe(0);
    expect(agent.ops('issueToken')).toBe(0);
    expect(agent.ops('requestConsent')).toBe(20); // one per user gesture; the agent coalesces
  });

  it('never stores a token whose issuance answers after dispose', async () => {
    const agent = newAgent();
    const store = new MemoryCredentialStore();
    const box: { client?: ZiloClient } = {};
    const client = new ZiloClient({
      origin: PAGE_ORIGIN,
      store,
      fetch: async (url, init) => {
        const res = await agent.fetch(url, init);
        if (url.endsWith('/auth/token')) box.client?.dispose(); // Unload while the answer arrives
        return res;
      },
      permissions: permissions('granted'),
      isSafari: false,
    });
    box.client = client;
    const states: string[] = [];
    client.onState((s) => states.push(s.state));
    await client.connect();
    expect(agent.ops('issueToken')).toBe(1); // the agent minted it, the instance dropped it
    expect(await store.read(PAGE_ORIGIN)).toBeUndefined();
    expect(states).toEqual(['checking']);
  });

  it('disconnect stops detection and revokes, and the instance stays usable', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none' });
    expect((await h.client.connect()).state).toBe('awaiting-consent');
    await h.client.disconnect();
    expect(h.client.detection.snapshot.state).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    h.agent.pollScript = ['granted'];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.agent.ops('getConsent')).toBe(0);
  });
});

describe('overall detection deadline (r1 P2 #5)', () => {
  it('keeps the deadline when the consent poll fails over and over', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckIntervalMs: 1000, recheckCapMs: 4000 });
    await h.client.connect();
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    h.intercept = (url, init) =>
      url.endsWith('/auth/consent') && (init.method ?? 'GET') === 'GET'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : undefined;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('one consent request per user gesture (triage #3)', () => {
  it('a re-probe in the same run reads the state with GET instead of asking again', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none' });
    // The POST reaches the agent (the prompt opens) but its answer is lost.
    h.intercept = (url, init) => {
      if (!url.endsWith('/auth/consent') || init.method !== 'POST') return undefined;
      return h.agent.fetch(url, init).then(() => Promise.reject(new TypeError('Failed to fetch')));
    };
    expect((await h.client.connect()).state).toBe('unreachable-or-blocked');
    h.agent.pollScript = ['pending', 'granted'];
    await vi.advanceTimersByTimeAsync(2_000); // re-probe: GET answers pending
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('ready');
    expect(h.agent.ops('requestConsent')).toBe(1);
  });

  it('the install flow sends the request once the agent appears, within the deadline', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckCapMs: 10_000 });
    h.agent.up = false;
    expect((await h.client.connect()).state).toBe('unreachable-or-blocked');
    h.agent.up = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    expect(h.agent.ops('requestConsent')).toBe(1);
    h.client.detection.cancel();
  });

  it('stops at the deadline without ever sending a consent request', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckCapMs: 6_000 });
    h.agent.up = false;
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    h.agent.up = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.agent.log).toHaveLength(0);
  });
});

describe('typed causes instead of mislabelled states (triage #4, #5)', () => {
  it('keeps limits-exceeded from token issuance as its own cause, not rate-limited', async () => {
    const h = setup();
    h.agent.inject.set('issueToken', [
      { status: 429, code: 'limits-exceeded', extra: { limit: { name: 'maxFamiliesPerOrigin' } } },
    ]);
    const snap = await h.client.connect();
    expect(snap.state).toBe('auth-unavailable');
    expect(snap.cause?.kind).toBe('limits-exceeded');
    const error = snap.cause?.kind === 'limits-exceeded' ? snap.cause.error : undefined;
    expect(isProblem(error, 'limits-exceeded')).toBe(true);
    expect(error?.problem.limit).toEqual({ name: 'maxFamiliesPerOrigin' });
    // Try again is a new user action.
    expect((await h.client.connect()).state).toBe('ready');
  });

  it('keeps an unknown consent answer to POST /auth/consent without minting a token', async () => {
    const h = setup({ consent: 'none' });
    h.intercept = (url, init) =>
      url.endsWith('/auth/consent') && init.method === 'POST'
        ? Promise.resolve(
            new Response(JSON.stringify({ origin: PAGE_ORIGIN, state: 'quarantined' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : undefined;
    const snap = await h.client.connect();
    expect(snap.state).toBe('auth-unavailable');
    expect(snap.cause).toEqual({ kind: 'consent-state-unknown', consentState: 'quarantined' });
    expect(h.agent.ops('issueToken')).toBe(0);
  });

  it('reports an SDK that is too old as sdk-too-old, never as an agent update', async () => {
    const h = setup();
    h.agent.protocol = { min: '2.0', max: '2.3' };
    const snap = await h.client.connect();
    expect(snap.state).toBe('sdk-too-old');
    expect(snap.fit).toEqual({ fits: false, reason: 'sdk-too-old' });
    expect(h.agent.ops('requestConsent')).toBe(0);
  });
});

describe('resolution guards (triage #6)', () => {
  const base = fixtures.virtualCaps.sources[0];

  it('narrows only well-formed known kinds and never casts other payloads', () => {
    expect(isResolutionList({ kind: 'list', values: [100, 200] })).toBe(true);
    expect(isResolutionList({ kind: 'list', values: [] })).toBe(false);
    expect(isResolutionList({ kind: 'list', values: [0] })).toBe(false);
    expect(isResolutionList({ kind: 'list', values: [1.5] })).toBe(false);
    expect(isResolutionList({ kind: 'list' })).toBe(false);
    expect(isResolutionRange({ kind: 'range', min: 100, max: 600, step: 100 })).toBe(true);
    expect(isResolutionRange({ kind: 'range', min: 0, max: 600, step: 100 })).toBe(false);
    expect(isResolutionRange({ kind: 'range', min: 100, max: 600 })).toBe(false);
    expect(isResolutionRange({ kind: 'list', values: [1] })).toBe(false);
    expect(isResolutionRange(null)).toBe(false);
  });

  it('gives the default-only fallback for a malformed known kind that skipped decoding', () => {
    const src = {
      ...base,
      resolutions: { kind: 'list', values: 'all' },
    } as unknown as SourceCaps;
    expect(resolutionChoice(src)).toEqual({
      kind: 'unsupported',
      wireKind: 'list',
      defaultResolution: 300,
    });
  });

  it('rejects a range below the schema minimum', () => {
    const caps = {
      deviceId: 'd',
      sources: [{ ...base, resolutions: { kind: 'range', min: 0, max: 600, step: 100 } }],
    };
    expect(() => decodeCaps(caps)).toThrow(/min, max, step/);
  });
});

describe('permission query (triage #7)', () => {
  it('an unsupported query is unknown, never denied', async () => {
    const none = await queryLoopbackPermissionDetail({
      query: () => Promise.reject(new TypeError('unsupported')),
    });
    expect(none).toEqual({ state: 'unknown', name: undefined, verified: false });
    const odd = await queryLoopbackPermissionDetail(permissions('weird'));
    expect(odd).toEqual({ state: 'unknown', name: 'loopback-network', verified: true });
  });

  it('does not treat the legacy name as proof: a fallback denied still probes', async () => {
    const h = setup({
      permissions: {
        query: ({ name }) =>
          name === 'loopback-network'
            ? Promise.reject(new TypeError('unsupported'))
            : Promise.resolve({ state: 'denied' }),
      },
    });
    const snap = await h.client.connect();
    expect(snap.state).toBe('ready');
    expect(snap.permission).toBe('unknown');
    expect(snap.permissionHint).toEqual({ name: 'local-network-access', state: 'denied' });
  });

  it('stops at denied only on a loopback-network answer', async () => {
    const h = setup({ permissions: permissions('denied') });
    expect((await h.client.connect()).state).toBe('denied');
    expect(h.agent.log).toHaveLength(0);
  });
});
