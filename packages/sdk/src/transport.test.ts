import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROBLEM_CODES,
  ZiloAbortError,
  ZiloProblemError,
  ZiloProtocolError,
  ZiloTimeoutError,
  ZiloTransportError,
  isProblem,
  type ProblemCode,
} from './errors.js';
import { createLogger, redactValue } from './log.js';
import { MockAgent } from './test-support/mock-agent.js';
import { schema } from './test-support/schema.js';
import { HttpTransport, parseRetryAfter } from './transport.js';

const get = { op: 'listDevices', method: 'GET', path: '/zilo/v1/devices' } as const;

function agent(): MockAgent {
  const a = new MockAgent(48100);
  a.consent = 'granted';
  return a;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HttpTransport', () => {
  it('calls the IP literal with the loopback address-space hint and no cookies or cache', async () => {
    const seen: { url: string; init: RequestInit & { targetAddressSpace?: string } }[] = [];
    const t = new HttpTransport(48100, {
      fetch: (url, init) => {
        seen.push({ url, init });
        return Promise.resolve(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
      },
    });
    const res = await t.request({ ...get, token: 'secret-token-value' });
    expect(res.body).toEqual({ ok: true });
    expect(seen[0]?.url).toBe('http://127.0.0.1:48100/zilo/v1/devices');
    expect(seen[0]?.url).not.toContain('secret');
    expect(seen[0]?.init.targetAddressSpace).toBe('loopback');
    expect(seen[0]?.init.credentials).toBe('omit');
    expect(seen[0]?.init.cache).toBe('no-store');
    expect(new Headers(seen[0]?.init.headers).get('Authorization')).toBe('Bearer secret-token-value');
  });

  it('sends JSON bodies with a JSON content type', async () => {
    let body: unknown;
    let type: string | null = null;
    const t = new HttpTransport(1, {
      fetch: (_u, init) => {
        body = init.body;
        type = new Headers(init.headers).get('Content-Type');
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    const res = await t.request({ op: 'x', method: 'POST', path: '/p', body: { a: 1 } });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(body).toBe('{"a":1}');
    expect(type).toBe('application/json');
  });

  const known = (schema('ErrorCodeKnown') as { enum: ProblemCode[] }).enum;
  it.each(known)('maps the contract problem %s to a typed error', async (code) => {
    const a = agent();
    const status = PROBLEM_CODES[code].status[0];
    a.inject.set('listDevices', [{ status, code, retryable: PROBLEM_CODES[code].retryable }]);
    const err = await new HttpTransport(48100, { fetch: a.fetch }).request(get).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloProblemError);
    expect(isProblem(err, code)).toBe(true);
    const p = err as ZiloProblemError;
    expect(p.status).toBe(status);
    expect(p.wireCode).toBe(code);
    expect(p.retryable).toBe(PROBLEM_CODES[code].retryable);
    expect(p.requestId).toMatch(/^req-/);
  });

  it('maps an unknown problem code to unknown, keeping retryable and the wire code (R-V4)', async () => {
    const a = agent();
    a.inject.set('listDevices', [{ status: 418, code: 'teapot-overheated', retryable: false }]);
    const err = (await new HttpTransport(48100, { fetch: a.fetch }).request(get).catch((e: unknown) => e)) as ZiloProblemError;
    expect(err.code).toBe('unknown');
    expect(err.wireCode).toBe('teapot-overheated');
    expect(err.retryable).toBe(false);
  });

  it('reads Retry-After and retryAfterSeconds', async () => {
    const a = agent();
    a.inject.set('listDevices', [{ status: 429, code: 'rate-limited', retryAfterSeconds: 7 }]);
    const err = (await new HttpTransport(48100, { fetch: a.fetch }).request(get).catch((e: unknown) => e)) as ZiloProblemError;
    expect(err.retryAfterSeconds).toBe(7);
    expect(parseRetryAfter(' 12 ')).toBe(12);
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT')).toBeUndefined();
  });

  it('keeps blocked on consent-denied', async () => {
    const a = agent();
    a.inject.set('listDevices', [{ status: 403, code: 'consent-denied', retryable: false, extra: { blocked: true } }]);
    const err = (await new HttpTransport(48100, { fetch: a.fetch }).request(get).catch((e: unknown) => e)) as ZiloProblemError;
    expect(err.blocked).toBe(true);
  });

  it('turns an error without a problem body into a protocol error', async () => {
    const t = new HttpTransport(1, { fetch: () => Promise.resolve(new Response(null, { status: 403 })) });
    const err = await t.request(get).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloProtocolError);
    expect((err as ZiloProtocolError).status).toBe(403);
  });

  it('rejects non-JSON success bodies', async () => {
    const t = new HttpTransport(1, { fetch: () => Promise.resolve(new Response('<html>', { headers: { 'Content-Type': 'text/html' } })) });
    await expect(t.request(get)).rejects.toBeInstanceOf(ZiloProtocolError);
  });

  it('maps a refused connection or a response without CORS (TypeError) to a transport error', async () => {
    const a = agent();
    a.up = false;
    await expect(new HttpTransport(48100, { fetch: a.fetch }).request(get)).rejects.toBeInstanceOf(ZiloTransportError);
  });

  it('bounds every request with a timeout', async () => {
    vi.useFakeTimers();
    const a = agent();
    a.delayMs = 60_000;
    const p = new HttpTransport(48100, { fetch: a.fetch, timeoutMs: 250 }).request(get).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(250);
    const err = await p;
    expect(err).toBeInstanceOf(ZiloTimeoutError);
    expect((err as ZiloTimeoutError).timeoutMs).toBe(250);
  });

  it('honours a per-request timeout over the default', async () => {
    vi.useFakeTimers();
    const a = agent();
    a.delayMs = 5_000;
    const p = new HttpTransport(48100, { fetch: a.fetch, timeoutMs: 60_000 }).request({ ...get, timeoutMs: 100 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toBeInstanceOf(ZiloTimeoutError);
  });

  it('aborts on the caller signal, before or during the request', async () => {
    const a = agent();
    a.delayMs = 10_000;
    const t = new HttpTransport(48100, { fetch: a.fetch });
    const pre = new AbortController();
    pre.abort();
    await expect(t.request({ ...get, signal: pre.signal })).rejects.toBeInstanceOf(ZiloAbortError);
    const mid = new AbortController();
    const p = t.request({ ...get, signal: mid.signal });
    mid.abort();
    await expect(p).rejects.toBeInstanceOf(ZiloAbortError);
  });
});

describe('redacted debug logging', () => {
  it('logs safe metadata only: never the token, the body or the path', async () => {
    const a = agent();
    const lines: string[] = [];
    const t = new HttpTransport(48100, { fetch: a.fetch, logger: (e, f) => lines.push(JSON.stringify([e, f])) });
    a.inject.set('listDevices', [{ status: 401, code: 'token-invalid' }]);
    const token = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
    await t.request({ ...get, token }).catch(() => undefined);
    await t.request({ op: 'createJob', method: 'POST', path: '/zilo/v1/jobs', token, body: { secret: 'document' } }).catch(() => undefined);
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).toContain('token-invalid');
    expect(all).not.toContain(token);
    expect(all).not.toContain('document');
    expect(all).not.toContain('/zilo/v1');
  });

  it('redacts secret-like and long values, and survives a throwing sink', () => {
    expect(redactValue('A'.repeat(43))).toBe('[redacted]');
    expect(redactValue('short')).toBe('short');
    expect(String(redactValue('a b '.repeat(40))).length).toBeLessThanOrEqual(65);
    const log = createLogger(() => {
      throw new Error('sink broke');
    });
    expect(() => {
      log('x', { a: 1 });
    }).not.toThrow();
  });
});
