import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectSafari } from './client.js';
import { TRANSITIONS, canTransition, type DetectionStateName } from './detection.js';
import { queryLoopbackPermission } from './permission.js';
import { setup, permissions } from './test-support/harness.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function trace(h: ReturnType<typeof setup>): DetectionStateName[] {
  const states: DetectionStateName[] = [];
  h.client.onState((s) => states.push(s.state));
  return states;
}

describe('transition table', () => {
  it('declares every state, targets only declared states, and makes idle reachable from all', () => {
    const states = Object.keys(TRANSITIONS) as DetectionStateName[];
    for (const from of states) {
      for (const to of TRANSITIONS[from]) expect(states).toContain(to);
      expect(canTransition(from, 'idle')).toBe(true);
    }
    expect(canTransition('consent-blocked', 'checking')).toBe(false);
    expect(canTransition('denied', 'ready')).toBe(false);
  });
});

describe('permission query (D-008 step 1)', () => {
  it('reads granted, denied and prompt, and falls back to unknown', async () => {
    expect(await queryLoopbackPermission(permissions('granted'))).toBe('granted');
    expect(await queryLoopbackPermission(permissions('denied'))).toBe('denied');
    expect(await queryLoopbackPermission(permissions('prompt'))).toBe('prompt');
    expect(await queryLoopbackPermission(permissions('throws'))).toBe('unknown');
    expect(await queryLoopbackPermission(permissions('weird'))).toBe('unknown');
    expect(await queryLoopbackPermission(undefined)).toBe('unknown');
  });

  it('tries the older Chromium name when loopback-network is unsupported', async () => {
    const asked: string[] = [];
    const state = await queryLoopbackPermission({
      query: ({ name }) => {
        asked.push(name);
        return name === 'loopback-network'
          ? Promise.reject(new TypeError('x'))
          : Promise.resolve({ state: 'prompt' });
      },
    });
    expect(asked).toEqual(['loopback-network', 'local-network-access']);
    expect(state).toBe('prompt');
  });
});

describe('detection flow', () => {
  it('goes checking -> ready for a granted origin, with the full hello', async () => {
    const h = setup();
    const states = trace(h);
    const snap = await h.client.connect();
    expect(states).toEqual(['checking', 'ready']);
    expect(snap.port).toBe(48100);
    expect(snap.hello?.scope).toBe('full');
  });

  it('never probes from an insecure origin', async () => {
    const h = setup({ origin: 'http://app.example.com' });
    expect((await h.client.connect()).state).toBe('insecure-origin');
    expect(h.agent.log).toHaveLength(0);
  });

  it('shows the interim Safari state instead of the Install dialog', async () => {
    const h = setup({ isSafari: true });
    expect((await h.client.connect()).state).toBe('safari-unsupported');
    expect(h.agent.log).toHaveLength(0);
    expect(
      detectSafari('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'),
    ).toBe(true);
    expect(detectSafari('Mozilla/5.0 AppleWebKit/537.36 Chrome/156.0 Safari/537.36')).toBe(false);
  });

  it('stops at denied without probing, and Try again re-queries', async () => {
    const h = setup({ permissions: permissions('denied') });
    expect((await h.client.connect()).state).toBe('denied');
    expect(h.agent.log).toHaveLength(0);
    expect((await h.client.connect()).state).toBe('denied');
  });

  it('shows permission-prompt while probing when the permission is prompt', async () => {
    const h = setup({ permissions: permissions('prompt') });
    const states = trace(h);
    await h.client.connect();
    expect(states).toEqual(['checking', 'permission-prompt', 'ready']);
  });

  it('continues with unknown permission state', async () => {
    const h = setup({ permissions: permissions('throws') });
    const snap = await h.client.connect();
    expect(snap.state).toBe('ready');
    expect(snap.permission).toBe('unknown');
  });

  it('is unreachable-or-blocked when nothing answers, re-probes every 2 s, then moves on', async () => {
    const h = setup();
    h.agent.up = false;
    const states = trace(h);
    expect((await h.client.connect()).state).toBe('unreachable-or-blocked');
    const probes = (): number => h.agent.log.length;
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.agent.log.length).toBe(0); // refused connections are not logged by the mock
    h.agent.up = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('ready');
    expect(states).toEqual(['checking', 'unreachable-or-blocked', 'ready']);
    const after = probes();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probes()).toBe(after); // no re-probe once ready
  });

  it('stops re-checking at the cap, and Check again restarts', async () => {
    const h = setup({ recheckCapMs: 10_000 });
    h.agent.up = false;
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(h.client.detection.snapshot.state).toBe('unreachable-stopped');
    h.agent.up = true;
    expect((await h.client.connect()).state).toBe('ready');
  });

  it('stops re-checking when the dialog is dismissed', async () => {
    const h = setup();
    h.agent.up = false;
    await h.client.connect();
    h.client.detection.cancel();
    expect(h.client.detection.snapshot.state).toBe('idle');
    h.agent.up = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.agent.log).toHaveLength(0);
  });

  it('never talks to a foreign service, and finds the agent on a fallback port', async () => {
    const h = setup({ ports: [48099, 48100, 48101] });
    h.agent.foreignPorts.add(48099);
    const snap = await h.client.connect();
    expect(snap.port).toBe(48100);
    expect(h.agent.log.filter((l) => l.port === 48099).every((l) => l.op === '?')).toBe(true);
    expect(h.agent.log.filter((l) => l.port === 48099)).toHaveLength(1);

    const only = setup({ ports: [48099] });
    only.agent.foreignPorts.add(48099);
    expect((await only.client.connect()).state).toBe('unreachable-or-blocked');
  });

  it('is outdated (pre-auth) when the protocol range or capabilities do not fit', async () => {
    const old = setup();
    old.agent.protocol = { min: '0.1', max: '0.9' };
    const snap = await old.client.connect();
    expect(snap.state).toBe('outdated');
    expect(snap.fit).toEqual({ fits: false, reason: 'agent-too-old' });
    expect(old.agent.ops('requestConsent')).toBe(0);

    const caps = setup();
    caps.agent.publicCapabilities = ['transport.http'];
    expect((await caps.client.connect()).fit).toEqual({
      fits: false,
      reason: 'missing-capabilities',
      missing: ['auth.consent', 'auth.token'],
    });
  });

  it('is outdated-authorized when the full hello is below the site minimum', async () => {
    const h = setup({ minAgentVersion: '1.3.0' });
    const snap = await h.client.connect();
    expect(snap.state).toBe('outdated-authorized');
    expect(snap.agentVersion).toBe('1.2.0');
    expect(snap.requiredVersion).toBe('1.3.0');
  });

  it('skips the consent request when a usable token is held', async () => {
    const h = setup();
    await h.client.connect();
    expect(h.agent.ops('requestConsent')).toBe(1);
    await h.client.connect();
    expect(h.agent.ops('requestConsent')).toBe(1);
    expect(h.agent.ops('issueToken')).toBe(1);
  });
});

describe('consent (R-A1 to R-A3)', () => {
  it('asks, waits, polls every pollAfterSeconds, then gets a token', async () => {
    const h = setup({ consent: 'none' });
    h.agent.pollScript = ['pending', 'granted'];
    const states = trace(h);
    expect((await h.client.connect()).state).toBe('awaiting-consent');
    expect(h.agent.ops('requestConsent')).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.agent.ops('getConsent')).toBe(1);
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('ready');
    expect(states).toEqual(['checking', 'awaiting-consent', 'ready']);
    expect(h.agent.ops('requestConsent')).toBe(1); // only the gesture call can prompt
  });

  it.each([
    ['denied', 'consent-denied'],
    ['blocked', 'consent-blocked'],
    ['none', 'consent-expired'],
    // Triage #4: an unknown state is not an expiry; it keeps its typed cause.
    ['some-future-state', 'auth-unavailable'],
  ] as const)('stops polling on %s -> %s', async (polled, expected) => {
    const h = setup({ consent: 'none' });
    h.agent.pollScript = [polled];
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(2_000);
    const snap = h.client.detection.snapshot;
    expect(snap.state).toBe(expected);
    if (polled === 'denied') expect(snap.retryAfterSeconds).toBe(600);
    if (polled === 'some-future-state') {
      expect(snap.cause).toEqual({
        kind: 'consent-state-unknown',
        consentState: 'some-future-state',
      });
    }
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.agent.ops('getConsent')).toBe(1);
    expect(h.agent.ops('issueToken')).toBe(0); // never a token on a non-granted state
  });

  it('keeps polling with back-off when the poll is rate-limited', async () => {
    const h = setup({ consent: 'none' });
    h.agent.inject.set('getConsent', [{ status: 429, code: 'rate-limited', retryAfterSeconds: 5 }]);
    h.agent.pollScript = ['granted'];
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('awaiting-consent');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.client.detection.snapshot.state).toBe('ready');
  });

  it('stops polling when the dialog is cancelled', async () => {
    const h = setup({ consent: 'none' });
    await h.client.connect();
    h.client.detection.cancel();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.agent.ops('getConsent')).toBe(0);
  });

  it('maps consent-request refusals to their states', async () => {
    const denied = setup({ consent: 'denied' });
    const d = await denied.client.connect();
    expect(d.state).toBe('consent-denied');
    expect(d.retryAfterSeconds).toBe(600);

    const blocked = setup({ consent: 'blocked' });
    expect((await blocked.client.connect()).state).toBe('consent-blocked');

    const limited = setup({ consent: 'none' });
    limited.agent.inject.set('requestConsent', [
      { status: 429, code: 'rate-limited', retryAfterSeconds: 30 },
    ]);
    const l = await limited.client.connect();
    expect(l.state).toBe('rate-limited');
    expect(l.retryAfterSeconds).toBe(30);

    const unauthorized = setup({ consent: 'none' });
    unauthorized.agent.inject.set('requestConsent', [{ status: 403, code: 'unauthorized-origin' }]);
    expect((await unauthorized.client.connect()).state).toBe('unauthorized-origin');
  });

  it('treats a 403 consent-pending from token issuance like a pending prompt', async () => {
    const h = setup({ consent: 'granted' });
    h.agent.inject.set('issueToken', [
      { status: 403, code: 'consent-pending', retryAfterSeconds: 2 },
    ]);
    expect((await h.client.connect()).state).toBe('awaiting-consent');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('ready');
  });

  it('lets Ask again send a new consent request from consent-expired', async () => {
    const h = setup({ consent: 'none' });
    h.agent.pollScript = ['none'];
    await h.client.connect();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.client.detection.snapshot.state).toBe('consent-expired');
    h.agent.promptOutcome = 'granted';
    expect((await h.client.connect()).state).toBe('ready');
    expect(h.agent.ops('requestConsent')).toBe(2);
  });
});
