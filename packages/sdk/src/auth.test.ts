import { describe, expect, it } from 'vitest';
import { isFinal } from './auth.js';
import { MemoryCredentialStore, type OriginCredentials } from './credentials.js';
import { ZiloAccessRevokedError, ZiloTransportError } from './errors.js';
import { setup } from './test-support/harness.js';
import { PAGE_ORIGIN } from './test-support/mock-agent.js';

const MIN = 60_000;

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = Date.parse('2026-11-01T12:00:00Z');
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

async function stored(store: MemoryCredentialStore): Promise<OriginCredentials> {
  const rec = await store.read(PAGE_ORIGIN);
  if (rec === undefined) throw new Error('no credentials stored');
  return rec;
}

function currentOf(rec: OriginCredentials): { familyId: string; token: string } {
  const cur = rec.current === undefined ? undefined : rec.families[rec.current];
  if (cur === undefined) throw new Error('no current family');
  return cur;
}

describe('token rotation (R-A11, R-A15)', () => {
  it('renews from renewAfter, keeps the family, and the old token has a grace', async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const h = setup({ now: c.now, store });
    await h.client.connect();
    const before = currentOf(await stored(store));

    c.advance(30 * MIN);
    await h.client.listDevices();
    expect(h.agent.ops('renewToken')).toBe(0);

    c.advance(16 * MIN); // past renewAfter = 45 min
    await h.client.listDevices();
    expect(h.agent.ops('renewToken')).toBe(1);
    const after = currentOf(await stored(store));
    expect(after.familyId).toBe(before.familyId);
    expect(after.token).not.toBe(before.token);
    expect(h.agent.ops('issueToken')).toBe(1);
    // The successor is used; the predecessor stays valid only during its grace.
    expect(h.agent.log.at(-1)?.token).toBe(after.token);
    const res = await h.agent.fetch('http://127.0.0.1:48100/zilo/v1/devices', {
      headers: { Authorization: `Bearer ${before.token}` },
    });
    expect(res.status).toBe(200);
    c.advance(2 * MIN);
    const late = await h.agent.fetch('http://127.0.0.1:48100/zilo/v1/devices', {
      headers: { Authorization: `Bearer ${before.token}` },
    });
    expect(late.status).toBe(401);
  });

  it('keeps the stored token on a 409 (concurrent renewal) or an early 429', async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const h = setup({ now: c.now, store });
    await h.client.connect();
    const before = currentOf(await stored(store));
    c.advance(46 * MIN);
    h.agent.inject.set('renewToken', [
      { status: 409, code: 'invalid-state' },
      { status: 429, code: 'rate-limited', retryAfterSeconds: 10 },
    ]);
    await h.client.listDevices();
    await h.client.listDevices();
    expect(currentOf(await stored(store)).token).toBe(before.token);
    await h.client.listDevices();
    expect(currentOf(await stored(store)).token).not.toBe(before.token);
  });

  it('rolls over to a new family for a new scan only when the current token is final', async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const h = setup({ now: c.now, store });
    h.agent.limits = { ...h.agent.limits, familyMaxSeconds: 7200 };
    await h.client.connect();
    const f1 = currentOf(await stored(store)).familyId;
    const j1 = await h.client.createJob({ deviceId: 'virtual-0', settings: { source: 'flatbed' } });

    c.advance(46 * MIN);
    await h.client.listDevices(); // renewal 1, expires at +106 min
    c.advance(46 * MIN);
    await h.client.listDevices(); // renewal 2, capped at the family deadline: final
    const cur = (await stored(store)).families[f1];
    expect(cur !== undefined && isFinal(cur)).toBe(true);

    await h.client.listDevices(); // not a new scan: the final token is still used
    expect(h.agent.ops('issueToken')).toBe(1);
    const renewals = h.agent.ops('renewToken');

    const j2 = await h.client.createJob({ deviceId: 'virtual-0', settings: { source: 'flatbed' } });
    expect(h.agent.ops('issueToken')).toBe(2);
    expect(h.agent.ops('renewToken')).toBe(renewals); // a final token is never renewed
    const rec = await stored(store);
    expect(rec.current).not.toBe(f1);
    expect(Object.keys(rec.families)).toContain(f1); // J1's family is kept
    const tracked = h.client.trackedJobs;
    expect(tracked.find((j) => j.id === j1.id)?.familyId).toBe(f1);
    expect(tracked.find((j) => j.id === j2.id)?.familyId).toBe(rec.current);

    // Per-job family selection: J1 is read with F1's credential.
    await h.client.getJob(j1.id);
    expect(h.agent.log.at(-1)?.token).toBe(rec.families[f1]?.token);
  });

  it('drops a family without tracked jobs when a new family starts', async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const h = setup({ now: c.now, store, consent: 'granted' });
    await h.client.connect();
    h.agent.restart(); // every token unknown now
    await h.client.listDevices();
    expect(Object.keys((await stored(store)).families)).toHaveLength(1);
  });
});

describe('401 recovery (R-A10)', () => {
  it("retries once with another tab's token for the same family", async () => {
    const c = clock();
    const store = new MemoryCredentialStore();
    const h = setup({ now: c.now, store });
    await h.client.connect();
    const first = currentOf(await stored(store));
    // Another tab renewed the family; this tab's request still carried the old token.
    c.advance(46 * MIN);
    const renewed = (await (
      await h.agent.fetch('http://127.0.0.1:48100/zilo/v1/auth/token/renew', {
        method: 'POST',
        headers: { Authorization: `Bearer ${first.token}` },
      })
    ).json()) as { token: string };
    c.advance(-46 * MIN);
    const rec = await stored(store);
    h.agent.inject.set('listDevices', [{ status: 401, code: 'token-invalid' }]);
    // Simulate the other tab writing its successor to shared storage after this request left.
    let wrote = false;
    const read = store.read.bind(store);
    store.read = async (origin) => {
      const value = await read(origin);
      if (!wrote && h.agent.ops('listDevices') === 1 && value !== undefined) {
        wrote = true;
        const fam = value.families[first.familyId];
        if (fam !== undefined) {
          fam.token = renewed.token;
          await store.write(origin, value);
        }
      }
      return value;
    };
    expect(rec.current).toBe(first.familyId);
    await h.client.listDevices();
    expect(h.agent.ops('listDevices')).toBe(2);
    expect(h.agent.log.at(-1)?.token).toBe(renewed.token);
    expect(h.agent.ops('issueToken')).toBe(1);
  });

  it('acquires a token for the current family and retries once otherwise', async () => {
    const h = setup();
    await h.client.connect();
    h.agent.inject.set('listDevices', [{ status: 401, code: 'token-invalid' }]);
    const list = await h.client.listDevices();
    expect(list.devices).toHaveLength(2);
    expect(h.agent.ops('issueToken')).toBe(2);
    expect(h.agent.ops('listDevices')).toBe(2);
  });

  it('does not loop: a second 401 surfaces', async () => {
    const h = setup();
    await h.client.connect();
    h.agent.inject.set('listDevices', [
      { status: 401, code: 'token-invalid' },
      { status: 401, code: 'token-invalid' },
    ]);
    await expect(h.client.listDevices()).rejects.toMatchObject({ code: 'token-invalid' });
    expect(h.agent.ops('listDevices')).toBe(2);
  });
});

describe('revocation and removal (R-A12, R-A13)', () => {
  it('maps 401 token-revoked to access revoked, drops the family and shows token-revoked', async () => {
    const store = new MemoryCredentialStore();
    const h = setup({ store });
    await h.client.connect();
    h.agent.revokeAll();
    const err = await h.client.listDevices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloAccessRevokedError);
    expect((err as ZiloAccessRevokedError).code).toBe('token-revoked');
    expect(h.client.detection.snapshot.state).toBe('token-revoked');
    expect((await stored(store)).current).toBeUndefined();
    // Connect again from token-revoked starts a new family.
    expect((await h.client.connect()).state).toBe('ready');
  });

  it('recognises a removed site from a TypeError, hello and consent none', async () => {
    const h = setup();
    await h.client.connect();
    h.agent.removeSite();
    await expect(h.client.listDevices()).rejects.toBeInstanceOf(ZiloAccessRevokedError);
    expect(h.client.detection.snapshot.state).toBe('token-revoked');
    expect(h.agent.ops('getConsent')).toBe(1);
  });

  it('treats a TypeError with no hello answer as transport (agent stopped)', async () => {
    const h = setup();
    await h.client.connect();
    h.agent.up = false;
    await expect(h.client.listDevices()).rejects.toBeInstanceOf(ZiloTransportError);
    expect(h.client.detection.snapshot.state).toBe('unreachable-or-blocked');
    h.client.detection.cancel();
  });

  it('disconnect revokes the current family (DELETE /auth/token)', async () => {
    const store = new MemoryCredentialStore();
    const h = setup({ store });
    await h.client.connect();
    await h.client.disconnect();
    expect(h.agent.ops('revokeToken')).toBe(1);
    expect((await stored(store)).current).toBeUndefined();
    await h.client.listDevices();
    expect(h.agent.ops('issueToken')).toBe(2);
  });
});

describe('MemoryCredentialStore', () => {
  it('keeps origins apart and copies values in and out', async () => {
    const s = new MemoryCredentialStore();
    const value: OriginCredentials = {
      current: 'f',
      families: {
        f: { familyId: 'f', token: 't', expiresAt: 'x', renewAfter: 'x', familyExpiresAt: 'x' },
      },
    };
    await s.write('https://a.test', value);
    value.current = 'mutated';
    expect((await s.read('https://a.test'))?.current).toBe('f');
    expect(await s.read('https://b.test')).toBeUndefined();
    await s.write('https://a.test', undefined);
    expect(await s.read('https://a.test')).toBeUndefined();
  });

  it('serialises work under the per-origin lock, even after a failure', async () => {
    const s = new MemoryCredentialStore();
    const order: string[] = [];
    const slow = s.withLock('o', async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('a-end');
      throw new Error('a failed');
    });
    const fast = s.withLock('o', () => {
      order.push('b');
      return Promise.resolve('b');
    });
    await expect(slow).rejects.toThrow('a failed');
    await expect(fast).resolves.toBe('b');
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
});
