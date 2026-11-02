// OpenAPI-driven mock agent for SDK unit tests. Routing comes from the spec's `paths`, the
// default `limits` from its `x-zilo-default` values, and every response body is validated against
// the schema the spec declares for that operation and status before it is sent. Requests with a
// body are validated against the request schema too (R-V5). Auth follows CONTRACT.md §2.1 and §3.
import { openapi, operations, assertResponse, schema, validate } from './schema.js';

type Json = Record<string, unknown>;

export const PAGE_ORIGIN = 'https://app.zilo.test:8443';

interface TokenRec {
  familyId: string;
  issuedAt: number;
  expiresAt: number;
  renewAfter: number;
  /** Set once renewed: the end of the grace (R-A11). */
  graceUntil?: number;
  renewed?: boolean;
}

interface FamilyRec {
  id: string;
  familyExpiresAt: number;
  revoked: boolean;
}

interface JobRec {
  familyId: string;
  job: Json;
}

export interface InjectedProblem {
  status: number;
  code: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  extra?: Json;
}

function rand(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Default limits, taken from the spec: `x-zilo-default`, or `const` where the spec fixes a value. */
export function contractLimits(): Json {
  const limits = schema('Limits') as { properties: Record<string, Json> };
  return Object.fromEntries(
    Object.entries(limits.properties).map(([k, p]) => [k, p['x-zilo-default'] ?? p.const]),
  );
}

const PRE_AUTH = new Set(['getHello', 'getConsent', 'requestConsent', 'issueToken']);

interface Route {
  operationId: string;
  params: Record<string, string>;
}

function compileRoutes(): { re: RegExp; names: string[]; byMethod: Map<string, string> }[] {
  const byPath = new Map<string, Map<string, string>>();
  for (const [id, { path, method }] of operations()) {
    if (method === 'OPTIONS') continue;
    const m = byPath.get(path) ?? new Map<string, string>();
    m.set(method, id);
    byPath.set(path, m);
  }
  return [...byPath].map(([path, byMethod]) => {
    const names: string[] = [];
    const re = new RegExp(
      `^${path.replace(/\{(\w+)\}/g, (_m, n: string) => {
        names.push(n);
        return '([^/]+)';
      })}$`,
    );
    return { re, names, byMethod };
  });
}

export class MockAgent {
  readonly port: number;
  origin = PAGE_ORIGIN;
  now: () => number = () => Date.now();
  /** When false, every port refuses connections (TypeError), like an absent or blocked agent. */
  up = true;
  /** Ports that answer `hello` with a foreign product. */
  foreignPorts = new Set<number>();
  /** Artificial latency per request, honouring abort. */
  delayMs = 0;
  instanceId = rand(16);
  protocol = { min: '1.0', max: '1.0' };
  publicCapabilities = ['auth.consent', 'auth.token', 'transport.http'];
  version = '1.2.0';
  limits: Json = contractLimits();

  consent: string = 'none';
  managed = false;
  /** State the origin moves to when `POST /auth/consent` finds no consent (the prompt opens). */
  promptOutcome: 'pending' | 'granted' = 'pending';
  /** States that successive `GET /auth/consent` polls return while the prompt is open. */
  pollScript: string[] = [];
  denyRetryAfter = 600;

  devices: Json[] = [];
  caps = new Map<string, Json>();
  readonly families = new Map<string, FamilyRec>();
  readonly tokens = new Map<string, TokenRec>();
  readonly jobs = new Map<string, JobRec>();
  /** Problems to return for the next call of an operation, in order. */
  readonly inject = new Map<string, InjectedProblem[]>();
  /** Every request seen: operationId (or `?`), method, whether it carried a token. */
  readonly log: { op: string; method: string; port: number; token: string | undefined }[] = [];
  private readonly routes = compileRoutes();
  private seq = 0;

  constructor(port = 48100) {
    this.port = port;
  }

  /** Agent restart: new instance, and every family, token and job of the old process is gone (§12). */
  restart(): void {
    this.instanceId = rand(16);
    this.families.clear();
    this.tokens.clear();
    this.jobs.clear();
  }

  /** Tray "Remove": consent back to `none`, every family revoked (R-A6, R-A12). */
  removeSite(): void {
    this.consent = 'none';
    for (const f of this.families.values()) f.revoked = true;
  }

  /** Tray "Reset access" on a baked site, or self-revocation: families revoked, consent kept. */
  revokeAll(): void {
    for (const f of this.families.values()) f.revoked = true;
  }

  ops(op: string): number {
    return this.log.filter((l) => l.op === op).length;
  }

  readonly fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const port = Number(url.port);
    const signal = init.signal ?? undefined;
    const method = (init.method ?? 'GET').toUpperCase();
    const auth = new Headers(init.headers).get('Authorization');
    const token = auth?.startsWith('Bearer ') === true ? auth.slice(7) : undefined;
    if (this.delayMs > 0) await sleep(this.delayMs, signal);
    if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    if (this.foreignPorts.has(port)) {
      this.log.push({ op: '?', method, port, token });
      return new Response(JSON.stringify({ product: 'something-else', version: '9' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!this.up || port !== this.port) throw new TypeError('Failed to fetch');
    const route = this.route(url.pathname, method);
    this.log.push({ op: route?.operationId ?? '?', method, port, token });
    if (route === undefined) return this.problem('getHello', 404, 'not-found');
    const op = route.operationId;

    const injected = this.inject.get(op)?.shift();
    if (injected !== undefined) {
      return this.problem(
        op,
        injected.status,
        injected.code,
        injected.retryable,
        injected.retryAfterSeconds,
        injected.extra,
      );
    }

    if (!PRE_AUTH.has(op)) {
      // §2.1 step 4: a non-allowed origin gets 403 without CORS: the browser sees a TypeError.
      if (!this.allowed()) throw new TypeError('Failed to fetch');
      const fam = this.authenticate(token);
      if (typeof fam === 'string') return this.problem(op, 401, fam);
      return this.protectedOp(op, route.params, fam, init.body, token ?? '');
    }
    return this.preAuthOp(op, token, init.body);
  };

  private route(pathname: string, method: string): Route | undefined {
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (m === null) continue;
      const id = r.byMethod.get(method);
      if (id === undefined) return undefined;
      return {
        operationId: id,
        params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? '')])),
      };
    }
    return undefined;
  }

  private allowed(): boolean {
    return this.consent === 'granted';
  }

  /** §3.3: returns the family or the 401 code. */
  private authenticate(token: string | undefined): FamilyRec | 'token-invalid' | 'token-revoked' {
    const rec = token === undefined ? undefined : this.tokens.get(token);
    const fam = rec === undefined ? undefined : this.families.get(rec.familyId);
    if (rec === undefined || fam === undefined) return 'token-invalid';
    if (fam.revoked) return 'token-revoked';
    const now = this.now();
    if (now >= rec.expiresAt || now >= fam.familyExpiresAt) return 'token-invalid';
    if (rec.graceUntil !== undefined && now >= rec.graceUntil) return 'token-invalid';
    return fam;
  }

  private respond(
    op: string,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Response {
    assertResponse(op, status, body);
    const h: Record<string, string> = {
      'Zilo-Request-Id': `req-${String(++this.seq)}`,
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': this.origin,
      ...headers,
    };
    if (body === undefined) return new Response(null, { status, headers: h });
    h['Content-Type'] = status >= 400 ? 'application/problem+json' : 'application/json';
    return new Response(JSON.stringify(body), { status, headers: h });
  }

  problem(
    op: string,
    status: number,
    code: string,
    retryable?: boolean,
    retryAfterSeconds?: number,
    extra: Json = {},
  ): Response {
    const body: Json = {
      type: `urn:zilo:problem:${code}`,
      title: code,
      status,
      code,
      retryable:
        retryable ??
        [
          'consent-pending',
          'consent-denied',
          'rate-limited',
          'device-busy',
          'agent-unavailable',
          'unknown',
        ].includes(code),
      requestId: `req-${String(this.seq + 1)}`,
      ...extra,
    };
    const headers: Record<string, string> = {};
    if (retryAfterSeconds !== undefined) {
      body.retryAfterSeconds = retryAfterSeconds;
      headers['Retry-After'] = String(retryAfterSeconds);
    }
    if (status === 401) headers['WWW-Authenticate'] = 'Bearer error="invalid_token"';
    return this.respond(op, status, body, headers);
  }

  private consentStatus(): Json {
    const s: Json = { origin: this.origin, state: this.consent };
    if (this.consent === 'pending') {
      s.pollAfterSeconds = 2;
      s.promptExpiresAt = new Date(this.now() + 120_000).toISOString();
    }
    if (this.consent === 'denied') s.retryAfterSeconds = this.denyRetryAfter;
    if (this.consent === 'granted') s.managed = this.managed;
    return s;
  }

  private preAuthOp(op: string, token: string | undefined, rawBody: unknown): Response {
    switch (op) {
      case 'getHello': {
        const fam = this.allowed() ? this.authenticate(token) : 'token-invalid';
        if (typeof fam === 'string') {
          return this.respond(op, 200, {
            product: 'zilo',
            scope: 'public',
            protocol: this.protocol,
            capabilities: this.publicCapabilities,
          });
        }
        return this.respond(op, 200, {
          product: 'zilo',
          scope: 'full',
          protocol: this.protocol,
          capabilities: [...this.publicCapabilities, 'devices.refresh', 'jobs.scan'],
          version: this.version,
          os: 'linux',
          arch: 'x64',
          instanceId: this.instanceId,
          limits: this.limits,
        });
      }
      case 'getConsent': {
        if (this.consent === 'pending' && this.pollScript.length > 0)
          this.consent = this.pollScript.shift() ?? 'pending';
        return this.respond(op, 200, this.consentStatus());
      }
      case 'requestConsent': {
        if (this.consent === 'granted') return this.respond(op, 200, this.consentStatus());
        if (this.consent === 'denied')
          return this.problem(op, 403, 'consent-denied', true, this.denyRetryAfter);
        if (this.consent === 'blocked')
          return this.problem(op, 403, 'consent-denied', false, undefined, { blocked: true });
        if (this.consent === 'none') this.consent = this.promptOutcome;
        return this.respond(op, this.consent === 'granted' ? 200 : 202, this.consentStatus());
      }
      case 'issueToken': {
        if (rawBody !== undefined) this.checkRequest('TokenRequest', rawBody);
        if (this.consent === 'pending') return this.problem(op, 403, 'consent-pending', true, 2);
        if (this.consent === 'denied')
          return this.problem(op, 403, 'consent-denied', true, this.denyRetryAfter);
        if (!this.allowed()) return this.problem(op, 403, 'unauthorized-origin');
        const now = this.now();
        const fam: FamilyRec = {
          id: rand(16),
          familyExpiresAt: now + (this.limits.familyMaxSeconds as number) * 1000,
          revoked: false,
        };
        this.families.set(fam.id, fam);
        return this.respond(op, 201, this.mint(fam, now));
      }
      default:
        throw new Error(`unhandled pre-auth op ${op}`);
    }
  }

  private mint(fam: FamilyRec, now: number): Json {
    const ttl = (this.limits.tokenTtlSeconds as number) * 1000;
    const expiresAt = Math.min(now + ttl, fam.familyExpiresAt);
    const renewAfter = now + Math.floor((3 * (expiresAt - now)) / 4);
    const token = rand(32);
    this.tokens.set(token, { familyId: fam.id, issuedAt: now, expiresAt, renewAfter });
    return {
      token,
      tokenType: 'Bearer',
      origin: this.origin,
      familyId: fam.id,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresIn: Math.max(1, Math.round((expiresAt - now) / 1000)),
      renewAfter: new Date(renewAfter).toISOString(),
      familyExpiresAt: new Date(fam.familyExpiresAt).toISOString(),
    };
  }

  private checkRequest(schemaName: string, raw: unknown): void {
    const errors = validate(schema(schemaName), JSON.parse(String(raw)));
    if (errors.length > 0)
      throw new Error(`SDK sent an invalid ${schemaName}: ${errors.join('; ')}`);
  }

  private protectedOp(
    op: string,
    params: Record<string, string>,
    fam: FamilyRec,
    rawBody: unknown,
    token: string,
  ): Response {
    const now = this.now();
    switch (op) {
      case 'renewToken': {
        const rec = this.tokens.get(token);
        // At most one successor per token; a token in its grace cannot be renewed (R-A11).
        if (rec === undefined || rec.renewed === true || rec.graceUntil !== undefined) {
          return this.problem(op, 409, 'invalid-state');
        }
        if (rec.expiresAt >= fam.familyExpiresAt) return this.problem(op, 409, 'invalid-state');
        if (now < rec.renewAfter)
          return this.problem(
            op,
            429,
            'rate-limited',
            true,
            Math.ceil((rec.renewAfter - now) / 1000),
          );
        rec.renewed = true;
        rec.graceUntil = Math.min(
          now + (this.limits.tokenRenewGraceSeconds as number) * 1000,
          rec.expiresAt,
        );
        return this.respond(op, 200, this.mint(fam, now));
      }
      case 'revokeToken':
        fam.revoked = true;
        return this.respond(op, 204);
      case 'listDevices':
      case 'refreshDevices':
        return this.respond(op, 200, {
          devices: this.devices,
          discovery: { state: 'idle', lastCompletedAt: new Date(now).toISOString() },
        });
      case 'getDeviceCaps': {
        const caps = this.caps.get(params.deviceId ?? '');
        if (caps === undefined) return this.problem(op, 404, 'not-found');
        return this.respond(op, 200, caps);
      }
      case 'createJob': {
        this.checkRequest('CreateJobRequest', rawBody);
        const req = JSON.parse(String(rawBody)) as { deviceId: string; settings: Json };
        const id = rand(16);
        const job: Json = {
          id,
          deviceId: req.deviceId,
          state: 'queued',
          createdAt: new Date(now).toISOString(),
          requested: req.settings,
          effective: {
            source: req.settings.source,
            resolution: 300,
            colorMode: 'color',
            pageSize: 'a4',
            pageSizeMm: { widthMm: 210, heightMm: 297 },
            maxPages: 1,
          },
          adjustments: [],
          pageCount: 0,
          lastSeq: 1,
        };
        this.jobs.set(id, { familyId: fam.id, job });
        return this.respond(op, 201, job, { Location: `/zilo/v1/jobs/${id}` });
      }
      case 'getJob':
      case 'disposeJob': {
        const rec = this.jobs.get(params.jobId ?? '');
        // R-J1: a job of another family is indistinguishable from an unknown one.
        if (rec === undefined || rec.familyId !== fam.id) return this.problem(op, 404, 'not-found');
        if (op === 'disposeJob') {
          this.jobs.delete(params.jobId ?? '');
          return this.respond(op, 204);
        }
        return this.respond(op, 200, rec.job);
      }
      default:
        throw new Error(`mock agent: ${op} is outside the T13 scope`);
    }
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Contract-shaped fixtures, validated against the spec by the tests that use them. */
export const fixtures = {
  virtualDevice: {
    id: 'virtual-0',
    name: 'Zilo Virtual Scanner',
    driver: 'virtual',
    connection: 'virtual',
    busy: false,
  },
  /** A future agent: unknown driver and connection values, and an unknown field (R-V4). */
  futureDevice: {
    id: 'future.1',
    name: 'Future Scanner',
    driver: 'holo-scan',
    connection: 'quantum-link',
    colorProfile: 'sRGB',
  },
  virtualCaps: {
    deviceId: 'virtual-0',
    sources: [
      {
        source: 'flatbed',
        resolutions: { kind: 'list', values: [75, 150, 300, 600] },
        colorModes: ['color', 'gray', 'bw'],
        pageSizes: [{ id: 'a4', widthMm: 210, heightMm: 297 }],
        maxAreaMm: { widthMm: 216, heightMm: 356 },
        customPageSize: true,
        defaults: { resolution: 300, colorMode: 'color', pageSize: 'a4' },
      },
      {
        source: 'feeder',
        resolutions: { kind: 'range', min: 100, max: 600, step: 100 },
        colorModes: ['color', 'gray'],
        pageSizes: [{ id: 'letter', widthMm: 215.9, heightMm: 279.4 }],
        maxAreaMm: { widthMm: 216, heightMm: 356 },
        customPageSize: false,
        maxPages: 50,
        defaults: { resolution: 200, colorMode: 'gray', pageSize: 'letter' },
      },
    ],
  },
  /** Unknown `ResolutionCaps.kind`, unknown source and colour values, unknown fields (R-D4, R-V4). */
  futureCaps: {
    deviceId: 'future.1',
    sources: [
      {
        source: 'film-holder',
        resolutions: { kind: 'stepped-set', sets: [[100, 200]], hint: 'opaque' },
        colorModes: ['color', 'cmyk'],
        pageSizes: [{ id: 'max', widthMm: 100, heightMm: 150 }],
        maxAreaMm: { widthMm: 100, heightMm: 150 },
        customPageSize: false,
        defaults: { resolution: 1200, colorMode: 'cmyk', pageSize: 'max' },
        lightSource: 'transmissive',
      },
    ],
    futureTopLevel: { nested: true },
  },
} as const;

/** The spec this mock was built from, for tests that enumerate it. */
export const contract = openapi;
