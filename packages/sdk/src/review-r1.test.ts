import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZiloClient } from './client.js';
import { MemoryCredentialStore } from './credentials.js';
import { setup } from './test-support/harness.js';
import { PAGE_ORIGIN } from './test-support/mock-agent.js';

afterEach(() => vi.useRealTimers());

describe('T13 r1 regression evidence', () => {
  it('recovers a restarted agent when the next call first needs renewal', async () => {
    let now = Date.parse('2026-11-01T12:00:00Z');
    const h = setup({ now: () => now });
    await h.client.connect();
    const job = await h.client.createJob({
      deviceId: 'virtual-0',
      settings: { source: 'flatbed' },
    });
    now += 46 * 60_000;
    h.agent.restart();
    await expect(h.client.getJob(job.id)).rejects.toMatchObject({ code: 'agent-restarted' });
  });

  it('keeps credentials for jobs tracked by another client sharing the store', async () => {
    const store = new MemoryCredentialStore();
    const h = setup({ store });
    h.agent.limits = { ...h.agent.limits, familyMaxSeconds: 3600 };
    await h.client.connect();
    const job = await h.client.createJob({
      deviceId: 'virtual-0',
      settings: { source: 'flatbed' },
    });
    const family = h.client.trackedJobs.find((j) => j.id === job.id)?.familyId;
    const other = new ZiloClient({
      origin: PAGE_ORIGIN,
      store,
      fetch: h.agent.fetch,
      isSafari: false,
    });
    await other.connect();
    await other.createJob({ deviceId: 'virtual-0', settings: { source: 'flatbed' } });
    expect((await store.read(PAGE_ORIGIN))?.families).toHaveProperty(family as string);
  });

  it('issues only one replacement family for one new scan with a final token', async () => {
    const h = setup();
    h.agent.limits = { ...h.agent.limits, familyMaxSeconds: 3600 };
    await h.client.connect();
    const before = h.agent.ops('issueToken');
    await h.client.createJob({ deviceId: 'virtual-0', settings: { source: 'flatbed' } });
    expect(h.agent.ops('issueToken') - before).toBe(1);
  });

  it('stops detection polling when disconnected during consent', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'pending' });
    expect((await h.client.connect()).state).toBe('awaiting-consent');
    await h.client.disconnect();
    h.agent.pollScript = ['granted'];
    await vi.advanceTimersByTimeAsync(2000);
    h.client.detection.cancel();
    expect(h.agent.ops('getConsent')).toBe(0);
    expect(h.agent.ops('issueToken')).toBe(0);
  });

  it('does not reset the overall recheck cap after each auth transport failure', async () => {
    vi.useFakeTimers();
    const h = setup({ recheckIntervalMs: 1000, recheckCapMs: 2000 });
    h.intercept = (url) =>
      url.endsWith('/auth/consent') ? Promise.reject(new TypeError('Failed to fetch')) : undefined;
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(5000);
    const state = h.client.detection.snapshot.state;
    h.client.detection.cancel();
    expect(state).toBe('unreachable-stopped');
  });
});
