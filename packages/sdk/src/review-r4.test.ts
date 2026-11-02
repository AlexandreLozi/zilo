import { afterEach, expect, it, vi } from 'vitest';
import { MemoryCredentialStore } from './credentials.js';
import { setup } from './test-support/harness.js';
import { PAGE_ORIGIN } from './test-support/mock-agent.js';

afterEach(() => vi.useRealTimers());

for (const end of ['deadline', 'dispose'] as const) {
  it(`does not start restart-pruning writes after ${end}`, async () => {
    vi.useFakeTimers();
    const store = new MemoryCredentialStore();
    const h = setup({ store, recheckCapMs: 2_000 });
    await h.client.connect();
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
    const writes = vi.spyOn(store, 'write');
    const connect = h.client.connect();
    await vi.advanceTimersByTimeAsync(100);
    expect(held).toBe(true);
    if (end === 'deadline') await vi.advanceTimersByTimeAsync(1_900);
    else h.client.dispose();
    await connect;
    const before = writes.mock.calls.length;
    unlock();
    await vi.advanceTimersByTimeAsync(0);
    h.client.dispose();
    expect(writes.mock.calls.length).toBe(before);
  });
}
