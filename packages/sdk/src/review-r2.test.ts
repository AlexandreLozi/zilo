// Bounded T13 re-review proofs: every continuation must respect the original run deadline.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup } from './test-support/harness.js';

afterEach(() => vi.useRealTimers());

describe('T13 r2: the overall deadline applies to every continuation', () => {
  it('stops consent polling even when every retry is rate-limited', async () => {
    vi.useFakeTimers();
    const h = setup({ consent: 'none', recheckIntervalMs: 1000, recheckCapMs: 4000 });
    await h.client.connect();
    h.agent.inject.set(
      'getConsent',
      Array.from({ length: 10 }, () => ({
        status: 429,
        code: 'rate-limited',
        retryAfterSeconds: 2,
      })),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const state = h.client.detection.snapshot.state;
    const timers = vi.getTimerCount();
    h.client.dispose();
    expect(state).toBe('unreachable-stopped');
    expect(timers).toBe(0);
  });

  it('does not POST consent when a re-probe finishes after the overall deadline', async () => {
    vi.useFakeTimers();
    const h = setup({
      consent: 'none',
      ports: [48100],
      probeTimeoutMs: 5000,
      recheckIntervalMs: 1000,
      recheckCapMs: 2000,
    });
    h.agent.up = false;
    await h.client.connect();
    h.agent.up = true;
    h.intercept = (url, init) =>
      url.endsWith('/hello')
        ? new Promise((resolve, reject) => {
            setTimeout(() => void h.agent.fetch(url, init).then(resolve, reject), 2000);
          })
        : undefined;
    await vi.advanceTimersByTimeAsync(3500);
    const posts = h.agent.ops('requestConsent');
    h.client.dispose();
    expect(posts).toBe(0);
  });
});
