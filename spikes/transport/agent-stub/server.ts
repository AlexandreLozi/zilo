// SP-1a agent stub: a minimal loopback HTTP server. Throwaway spike code.
//
// Binds 127.0.0.1:<port> only. Enforces:
//   - an exact Host allowlist (DNS-rebinding defence, D-004);
//   - an exact Origin allowlist, with CORS reflecting only allowed origins (D-004);
//   - a bearer check in the Authorization header on everything except `hello` and the bridge page
//     (CORS preflights cannot carry credentials, so OPTIONS is answered without one).
// Every decision is appended to a JSONL audit log so tests can assert what the server saw.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_PORT, ALLOWED_APP_ORIGINS, APP_TOKENS, AUDIT_LOG, BRIDGE_ORIGIN, EVENT_INTERVAL_MS,
  EVENT_TICKS, MAX_BLOB_BYTES, MAX_BRIDGE_BYTES, BRIDGE_ACK_TIMEOUT_MS, BRIDGE_EVENT_WINDOW,
} from '../config.ts';

const HOST_ALLOWLIST = new Set([`127.0.0.1:${AGENT_PORT}`, `localhost:${AGENT_PORT}`, `[::1]:${AGENT_PORT}`]);
const ORIGIN_ALLOWLIST = new Set(ALLOWED_APP_ORIGINS);
const BRIDGE_SESSION_TTL_MS = 10 * 60 * 1000;

interface BridgeSession {
  sessionId: string;
  capability: string;
  appOrigin: string;
  createdAt: number;
  revoked: boolean;
}
const bridgeSessions = new Map<string, BridgeSession>(); // capability -> session
const usedNonces = new Set<string>();

mkdirSync(dirname(AUDIT_LOG), { recursive: true });
writeFileSync(AUDIT_LOG, '');

const here = dirname(fileURLToPath(import.meta.url));
const bridgeHtml = readFileSync(`${here}/bridge.html`, 'utf8').replace(
  '__ZILO_BRIDGE_CONFIG__',
  JSON.stringify({
    allowedOrigins: [...ORIGIN_ALLOWLIST], maxBytes: MAX_BRIDGE_BYTES, protocol: 1,
    eventWindow: BRIDGE_EVENT_WINDOW, ackTimeoutMs: BRIDGE_ACK_TIMEOUT_MS,
  }),
);
const bridgeJs = readFileSync(`${here}/bridge.js`, 'utf8');

type Audit = Record<string, unknown>;
function audit(entry: Audit): void {
  appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function bearer(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim();
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  // Reflect only an exact allowlisted app origin. Never `*`.
  if (origin && ORIGIN_ALLOWLIST.has(origin)) {
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return { Vary: 'Origin' };
}

function problem(
  res: http.ServerResponse, status: number, code: string, origin: string | undefined, log: Audit,
): void {
  audit({ ...log, status, decision: 'deny', reason: code });
  res.writeHead(status, {
    'Content-Type': 'application/problem+json',
    'Cache-Control': 'no-store',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify({ type: `urn:zilo:spike:${code}`, title: code, status }));
}

/** Which caller class does this request belong to? */
type Caller =
  | { kind: 'app'; origin: string }
  | { kind: 'bridge' } // same-origin request from the bridge page
  | { kind: 'no-origin' } // top-level navigation or non-browser client
  | { kind: 'denied'; origin: string };

function classify(req: http.IncomingMessage): Caller {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (origin === undefined) {
    // Same-origin GETs carry no Origin header; Sec-Fetch-Site tells them apart from other callers.
    return site === 'same-origin' ? { kind: 'bridge' } : { kind: 'no-origin' };
  }
  if (origin === BRIDGE_ORIGIN) return { kind: 'bridge' };
  if (ORIGIN_ALLOWLIST.has(origin)) return { kind: 'app', origin };
  return { kind: 'denied', origin };
}

/** Bearer check. App tokens are bound to their origin; bridge capabilities to bridge callers. */
function authorize(req: http.IncomingMessage, caller: Caller): { ok: true; principal: string } | { ok: false; code: string } {
  const token = bearer(req);
  if (!token) return { ok: false, code: 'missing-bearer' };
  if (caller.kind === 'app') {
    const expected = APP_TOKENS[caller.origin];
    return expected && safeEqual(token, expected)
      ? { ok: true, principal: `app:${caller.origin}` }
      : { ok: false, code: 'bad-bearer' };
  }
  if (caller.kind === 'bridge') {
    const s = bridgeSessions.get(token);
    if (!s) return { ok: false, code: 'bad-bridge-capability' };
    if (s.revoked) return { ok: false, code: 'stale-bridge-session' };
    if (Date.now() - s.createdAt > BRIDGE_SESSION_TTL_MS) return { ok: false, code: 'expired-bridge-session' };
    // The capability is bound to one session: the bridge must name that session on every call.
    const sid = req.headers['x-zilo-bridge-session'];
    if (typeof sid !== 'string' || !safeEqual(sid, s.sessionId)) return { ok: false, code: 'bridge-session-mismatch' };
    return { ok: true, principal: `bridge:${s.appOrigin}:${s.sessionId}` };
  }
  return { ok: false, code: 'caller-not-authorizable' };
}

function blobByte(i: number): number {
  return (i * 31 + 7) & 0xff;
}

async function readJson(req: http.IncomingMessage, limit = 4096): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('body-too-large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub.invalid');
  const origin = req.headers.origin;
  const log: Audit = {
    method: req.method,
    path: url.pathname,
    host: req.headers.host,
    origin: origin ?? null,
    secFetchSite: req.headers['sec-fetch-site'] ?? null,
    secFetchMode: req.headers['sec-fetch-mode'] ?? null,
    hasAuthorization: Boolean(req.headers.authorization),
    acrMethod: req.headers['access-control-request-method'] ?? null,
    acrHeaders: req.headers['access-control-request-headers'] ?? null,
    acrPrivateNetwork: req.headers['access-control-request-private-network'] ?? null,
    acrLocalNetwork: req.headers['access-control-request-local-network'] ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };

  // 1. Exact Host allowlist, before anything else (DNS rebinding).
  if (!req.headers.host || !HOST_ALLOWLIST.has(req.headers.host)) {
    return problem(res, 403, 'host-denied', undefined, log);
  }

  const caller = classify(req);
  log.caller = caller.kind;

  // 2. Exact Origin allowlist.
  if (caller.kind === 'denied') return problem(res, 403, 'origin-denied', undefined, log);

  // 3. CORS preflight: only allowlisted app origins get a positive answer.
  if (req.method === 'OPTIONS') {
    if (caller.kind !== 'app') return problem(res, 403, 'preflight-denied', undefined, log);
    audit({ ...log, status: 204, decision: 'allow', reason: 'preflight' });
    res.writeHead(204, {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '5',
      // Deliberately no Access-Control-Allow-Private-Network: D-003 does not rely on PNA headers.
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && url.pathname === '/zilo/v1/hello') {
      audit({ ...log, status: 200, decision: 'allow', reason: 'hello' });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) });
      return res.end(JSON.stringify({
        product: 'zilo-spike-agent', version: '0.0.0-sp1a', protocol: 1, os: process.platform, arch: process.arch,
        capabilities: ['events', 'blob', 'bridge'],
      }));
    }

    if (req.method === 'GET' && (url.pathname === '/bridge' || url.pathname === '/bridge.js')) {
      // Top-level popup page for S2. Restrictive CSP, no framing, no caching.
      if (caller.kind === 'app') return problem(res, 403, 'bridge-not-subresource', origin, log);
      const isJs = url.pathname === '/bridge.js';
      audit({ ...log, status: 200, decision: 'allow', reason: isJs ? 'bridge-js' : 'bridge-page' });
      res.writeHead(200, {
        'Content-Type': isJs ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; " +
          "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(isJs ? bridgeJs : bridgeHtml);
    }

    if (req.method === 'POST' && url.pathname === '/zilo/v1/bridge/session') {
      // Mint a bridge capability. Only the bridge page itself may call this (browser-set Origin),
      // only for an allowlisted app origin, only with that origin's token, and only once per nonce.
      if (origin !== BRIDGE_ORIGIN) return problem(res, 403, 'mint-requires-bridge-origin', origin, log);
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
        return problem(res, 403, 'mint-requires-same-origin', origin, log);
      }
      const body = (await readJson(req)) as { appOrigin?: unknown; nonce?: unknown };
      const appOrigin = typeof body.appOrigin === 'string' ? body.appOrigin : '';
      const nonce = typeof body.nonce === 'string' ? body.nonce : '';
      log.appOrigin = appOrigin;
      if (!ORIGIN_ALLOWLIST.has(appOrigin)) return problem(res, 403, 'app-origin-not-allowed', origin, log);
      if (!/^[0-9a-f]{32}$/.test(nonce)) return problem(res, 400, 'bad-nonce', origin, log);
      if (usedNonces.has(nonce)) return problem(res, 409, 'nonce-replayed', origin, log);
      const token = bearer(req);
      const expected = APP_TOKENS[appOrigin];
      if (!token || !expected || !safeEqual(token, expected)) return problem(res, 401, 'bad-app-token', origin, log);
      usedNonces.add(nonce);
      // One live bridge session per app origin: a re-handshake makes older sessions stale.
      for (const s of bridgeSessions.values()) if (s.appOrigin === appOrigin) s.revoked = true;
      const session: BridgeSession = {
        sessionId: randomBytes(8).toString('hex'),
        capability: randomBytes(32).toString('base64url'),
        appOrigin,
        createdAt: Date.now(),
        revoked: false,
      };
      bridgeSessions.set(session.capability, session);
      audit({ ...log, status: 201, decision: 'allow', reason: 'bridge-session-minted', sessionId: session.sessionId });
      res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({
        sessionId: session.sessionId, capability: session.capability, appOrigin, expiresInSec: BRIDGE_SESSION_TTL_MS / 1000,
      }));
    }

    if (req.method === 'GET' && (url.pathname === '/zilo/v1/events' || url.pathname === '/zilo/v1/blob')) {
      const auth = authorize(req, caller);
      if (!auth.ok) return problem(res, 401, auth.code, origin, log);
      log.principal = auth.principal;

      if (url.pathname === '/zilo/v1/blob') {
        const size = Number(url.searchParams.get('size') ?? '0');
        if (!Number.isInteger(size) || size < 0 || size > MAX_BLOB_BYTES) {
          return problem(res, 400, 'bad-size', origin, log);
        }
        const buf = Buffer.allocUnsafe(size);
        for (let i = 0; i < size; i++) buf[i] = blobByte(i);
        audit({ ...log, status: 200, decision: 'allow', reason: 'blob', size });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(size),
          'Cache-Control': 'no-store',
          ...corsHeaders(origin),
        });
        return res.end(buf);
      }

      audit({ ...log, status: 200, decision: 'allow', reason: 'events' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...corsHeaders(origin),
      });
      res.flushHeaders();
      let seq = 0;
      const timer = setInterval(() => {
        seq += 1;
        res.write(`id: ${seq}\nevent: tick\ndata: ${JSON.stringify({ seq, at: Date.now() })}\n\n`);
        if (seq >= EVENT_TICKS) {
          clearInterval(timer);
          res.write(`event: done\ndata: {}\n\n`);
          res.end();
        }
      }, EVENT_INTERVAL_MS);
      req.on('close', () => clearInterval(timer));
      return;
    }

    return problem(res, 404, 'not-found', origin, log);
  } catch (err) {
    return problem(res, 400, `bad-request:${(err as Error).message}`, origin, log);
  }
});

server.listen(AGENT_PORT, '127.0.0.1', () => {
  console.log(`[agent-stub] listening on http://127.0.0.1:${AGENT_PORT} (audit: ${AUDIT_LOG})`);
});
