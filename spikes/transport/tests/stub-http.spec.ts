// SP-1a: direct HTTP checks of the agent stub's rules (no browser). Browsers cannot forge Host or
// Origin, so these cases use raw requests with explicit headers.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { AGENT_PORT, APP_ORIGIN, APP_TOKENS, BRIDGE_ORIGIN, EVIL_ORIGIN, HTTP_CONTROL_ORIGIN, MAX_BLOB_BYTES } from '../config.ts';

interface Res { status: number; headers: http.IncomingHttpHeaders; body: string }

function req(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: AGENT_PORT, method, path,
      headers: { Host: `127.0.0.1:${AGENT_PORT}`, ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const title = (r: Res) => (JSON.parse(r.body) as { title: string }).title;
const nonce = () => randomBytes(16).toString('hex');
const mint = (n: string, opts: { origin?: string; appOrigin?: string; token?: string } = {}) =>
  req('POST', '/zilo/v1/bridge/session', {
    Origin: opts.origin ?? BRIDGE_ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.token ?? APP_TOKENS[APP_ORIGIN]}`,
  }, JSON.stringify({ appOrigin: opts.appOrigin ?? APP_ORIGIN, nonce: n }));

test.describe('agent stub rules', () => {
  test('Host allowlist is exact', async () => {
    for (const host of [`127.0.0.1:${AGENT_PORT}`, `localhost:${AGENT_PORT}`, `[::1]:${AGENT_PORT}`]) {
      expect((await req('GET', '/zilo/v1/hello', { Host: host })).status, host).toBe(200);
    }
    for (const host of ['127.0.0.1', `127.0.0.1:${AGENT_PORT + 1}`, `rebind.zilo.test:${AGENT_PORT}`, `app.zilo.test:${AGENT_PORT}`, `127.0.0.1.nip.io:${AGENT_PORT}`, `LOCALHOST:${AGENT_PORT}x`]) {
      const r = await req('GET', '/zilo/v1/hello', { Host: host });
      expect(r.status, host).toBe(403);
      expect(title(r)).toBe('host-denied');
    }
  });

  test('Origin allowlist is exact; CORS reflects only allowed origins, never *', async () => {
    const ok = await req('GET', '/zilo/v1/hello', { Origin: APP_ORIGIN });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(ok.headers.vary).toBe('Origin');
    for (const origin of [EVIL_ORIGIN, 'null', `${APP_ORIGIN}.evil.test`, APP_ORIGIN.replace('https', 'http'), `${APP_ORIGIN}/`]) {
      const r = await req('GET', '/zilo/v1/hello', { Origin: origin });
      expect(r.status, origin).toBe(403);
      expect(r.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    const pre = await req('OPTIONS', '/zilo/v1/events', { Origin: APP_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(pre.headers['access-control-allow-private-network']).toBeUndefined();
    const badPre = await req('OPTIONS', '/zilo/v1/events', { Origin: EVIL_ORIGIN, 'Access-Control-Request-Method': 'GET' });
    expect(badPre.status).toBe(403);
    expect(badPre.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('bearer required on everything except hello; tokens are bound to their origin', async () => {
    const h = { Origin: APP_ORIGIN };
    expect(title(await req('GET', '/zilo/v1/events', h))).toBe('missing-bearer');
    expect(title(await req('GET', '/zilo/v1/blob?size=1', { ...h, Authorization: 'Bearer nope' }))).toBe('bad-bearer');
    // The HTTP-control origin's token does not work for the HTTPS app origin.
    expect(title(await req('GET', '/zilo/v1/blob?size=1', { ...h, Authorization: `Bearer ${APP_TOKENS[HTTP_CONTROL_ORIGIN]}` }))).toBe('bad-bearer');
    // No-Origin, non-browser callers cannot use app tokens.
    expect(title(await req('GET', '/zilo/v1/blob?size=1', { Authorization: `Bearer ${APP_TOKENS[APP_ORIGIN]}` }))).toBe('caller-not-authorizable');
    const ok = await req('GET', '/zilo/v1/blob?size=16', { ...h, Authorization: `Bearer ${APP_TOKENS[APP_ORIGIN]}` });
    expect(ok.status).toBe(200);
    expect(title(await req('GET', `/zilo/v1/blob?size=${MAX_BLOB_BYTES + 1}`, { ...h, Authorization: `Bearer ${APP_TOKENS[APP_ORIGIN]}` }))).toBe('bad-size');
  });

  test('bridge page: restrictive CSP, no framing, no-store, never served as a subresource', async () => {
    const r = await req('GET', '/bridge', {});
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).not.toContain(APP_TOKENS[APP_ORIGIN]);
    expect(title(await req('GET', '/bridge', { Origin: APP_ORIGIN }))).toBe('bridge-not-subresource');
  });

  test('bridge mint: bridge origin only, allowlisted app origin, valid token, single-use nonce; re-mint makes the old session stale', async () => {
    expect(title(await mint(nonce(), { origin: APP_ORIGIN }))).toBe('mint-requires-bridge-origin');
    expect(title(await mint(nonce(), { appOrigin: EVIL_ORIGIN }))).toBe('app-origin-not-allowed');
    expect(title(await mint(nonce(), { token: 'wrong' }))).toBe('bad-app-token');
    expect(title(await mint('not-hex'))).toBe('bad-nonce');
    const n1 = nonce();
    const first = await mint(n1);
    expect(first.status).toBe(201);
    expect(title(await mint(n1))).toBe('nonce-replayed');
    const cap1 = JSON.parse(first.body).capability as string;
    const asBridge = (cap: string) => req('GET', '/zilo/v1/blob?size=8', { 'Sec-Fetch-Site': 'same-origin', Authorization: `Bearer ${cap}` });
    expect((await asBridge(cap1)).status).toBe(200);
    // A capability is only valid for bridge (same-origin) callers, not for the public app origin.
    expect(title(await req('GET', '/zilo/v1/blob?size=8', { Origin: APP_ORIGIN, Authorization: `Bearer ${cap1}` }))).toBe('bad-bearer');
    // ...and not for no-Origin callers that do not present Sec-Fetch-Site: same-origin.
    expect(title(await req('GET', '/zilo/v1/blob?size=8', { Authorization: `Bearer ${cap1}` }))).toBe('caller-not-authorizable');
    const second = await mint(nonce());
    expect(second.status).toBe(201);
    expect(title(await asBridge(cap1))).toBe('stale-bridge-session');
    expect((await asBridge(JSON.parse(second.body).capability)).status).toBe(200);
  });
});
