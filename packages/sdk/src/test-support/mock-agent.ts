// OpenAPI-driven mock agent for SDK unit tests. Routing comes from the spec's `paths`, the
// default `limits` from its `x-zilo-default` values, and every response body is validated against
// the schema the spec declares for that operation and status before it is sent. Requests with a
// body are validated against the request schema too (R-V5). Auth follows CONTRACT.md §2.1 and §3.
//
// The job model is contract-shaped (§5 to §8): one ordered event log per job with strictly
// increasing `seq`, retained with only the latest `progress`, page metadata and synthetic image
// bytes, live SSE subscribers, and export selection snapshots. Tests drive a job through its
// transitions with `appendState`, `addPage`, `finish`, `fail` and `dispose`.
import { encodeSseFrame } from '../sse.js';
import { openapi, operations, assertResponse, schema, validate } from './schema.js';

type Json = Record<string, unknown>;

export const PAGE_ORIGIN = 'https://app.zilo.test:8443';

const IMAGE_TYPES = { jpeg: 'image/jpeg', png: 'image/png' } as const;
const EXPORT_TYPES = {
  pdf: 'application/pdf',
  tiff: 'image/tiff',
  jpeg: 'image/jpeg',
  png: 'image/png',
} as const;
const EXPORT_EXT = { pdf: 'pdf', tiff: 'tiff', jpeg: 'jpg', png: 'png' } as const;

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

interface Subscriber {
  /** Buffered until the replay high-water mark has been sent (R-E5 live handoff). */
  live: boolean;
  buffer: string[];
  push(frame: string): void;
  close(): void;
}

interface JobRec {
  familyId: string;
  job: Json;
  /** Full event log, ascending `seq`, one `progress` at most (R-E5). */
  events: Json[];
  /** Page metadata in `index` order; a page is listed once its `page` event was emitted. */
  pages: Json[];
  pageBytes: Map<number, Uint8Array>;
  subscribers: Set<Subscriber>;
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

const encoder = new TextEncoder();

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
  readonly log: {
    op: string;
    method: string;
    port: number;
    token: string | undefined;
    headers?: Record<string, string>;
  }[] = [];

  /** SSE: when set, each frame is written in pieces of at most this many bytes (R-E2 splits). */
  sseChunkBytes: number | undefined;
  /** SSE: heartbeat period; 0 disables the comment lines (a deliberately silent stream). */
  heartbeatMs = 15_000;
  /** SSE: drop the next connection after this many events, without `done` (a lost stream). */
  sseDropNextAfter: number | undefined;
  /** SSE: when set, the next stream closes at once with no event (a settled replay, R-E7). */
  sseCloseNextImmediately = false;
  /** Counts of opened and closed SSE responses, for stream lifetime assertions. */
  streamsOpened = 0;
  streamsClosed = 0;
  /** True once an export request carried `deleteAfterExport` (the SDK must never do that). */
  sawDeleteAfterExport = false;
  /** When set, `/export` answers that problem instead of rendering. */
  exportProblem: InjectedProblem | undefined;
  /** When true, `/export` lies about `Content-Length` (a short body, R-X3). */
  exportShortBody = false;
  /** When set, `quality` is echoed into the exported bytes so tests can see it. */
  readonly exported: { format: string; indexes: number[]; rotates: number[] }[] = [];

  private readonly routes = compileRoutes();
  private seq = 0;

  constructor(port = 48100) {
    this.port = port;
  }

  /** Agent restart: new instance, and every family, token and job of the old process is gone (§12). */
  restart(): void {
    for (const rec of this.jobs.values()) for (const sub of rec.subscribers) sub.close();
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

  /** The last `Last-Event-ID` header the agent was sent, or `undefined` when absent. */
  lastEventIdHeaders(): (string | undefined)[] {
    return this.log
      .filter((l) => l.op === 'streamJobEvents')
      .map((l) => l.headers?.['last-event-id']);
  }

  /** A job record, or a test failure: tests use it to arrange events and inspect state. */
  rec(jobId: string): JobRec {
    const rec = this.jobs.get(jobId);
    if (rec === undefined) throw new Error(`mock agent: no job ${jobId}`);
    return rec;
  }

  /** Appends a `state` event, filling `previous` from the current job state (§5.2). */
  appendState(jobId: string, state: string, extra: Json = {}): Json {
    const rec = this.rec(jobId);
    const event: Json = { type: 'state', state, previous: rec.job.state, ...extra };
    return this.appendEvent(rec, event);
  }

  appendProgress(
    jobId: string,
    progress: { pagesCompleted: number } & Record<string, unknown>,
  ): Json {
    return this.appendEvent(this.rec(jobId), { type: 'progress', ...progress });
  }

  /** Stores one page and emits its `page` event (R-P4: fetchable from that moment). */
  addPage(jobId: string, options: { index?: number; side?: string; colorMode?: string } = {}): Json {
    const rec = this.rec(jobId);
    const index = options.index ?? rec.pages.length;
    if (index !== rec.pages.length) throw new Error('mock agent: page indexes are 0..n in order');
    const page: Json = {
      index,
      sheet: Math.floor(index / 2),
      side: options.side ?? 'front',
      widthPx: 100,
      heightPx: 200,
      resolution: { x: 300, y: 300 },
      colorMode: options.colorMode ?? 'color',
      etag: `"page-${String(index)}-default"`,
      createdAt: new Date(this.now()).toISOString(),
    };
    rec.pages.push(page);
    rec.pageBytes.set(index, this.pageBytes(index, page));
    this.appendEvent(rec, { type: 'page', page });
    return page;
  }

  /** Emits a non-fatal `error` event (§6, R-E5: the agent caps them at 16). */
  addError(jobId: string, problem: Json, fatal = false): Json {
    return this.appendEvent(this.rec(jobId), {
      type: 'error',
      fatal,
      problem: this.asyncProblem(problem),
    });
  }

  /** Terminal transition plus `done` (R-E3, R-E4). */
  finish(jobId: string, state: 'completed' | 'failed' | 'cancelled' = 'completed'): Json {
    const rec = this.rec(jobId);
    if (rec.job.state !== state) this.appendState(jobId, state);
    const done = this.appendEvent(rec, { type: 'done', state, pageCount: rec.pages.length });
    this.closeWhenSettled(rec);
    return done;
  }

  /** `error{fatal}`, `state: failed`, `done{failed, error}` as one atomic step (R-E4). */
  fail(jobId: string, problem: Json = { code: 'paper-jam', status: 409, retryable: true }): Json {
    const rec = this.rec(jobId);
    const async = this.asyncProblem(problem);
    this.appendEvent(rec, { type: 'error', fatal: true, problem: async });
    this.appendState(jobId, 'failed');
    const done = this.appendEvent(rec, {
      type: 'done',
      state: 'failed',
      pageCount: rec.pages.length,
      error: async,
    });
    this.closeWhenSettled(rec);
    return done;
  }

  /**
   * Disposal (§5.2, R-E4): an active job gets the compound `cancelled`, `done`, `disposed` step;
   * a terminal job gets `disposed`. Pages are deleted and `pageCount` becomes 0 (tombstone).
   */
  dispose(jobId: string): void {
    const rec = this.rec(jobId);
    const state = rec.job.state;
    if (state === 'disposed') return;
    if (state !== 'completed' && state !== 'failed' && state !== 'cancelled') {
      this.appendEvent(rec, { type: 'state', state: 'cancelled', previous: state });
      this.appendEvent(rec, { type: 'done', state: 'cancelled', pageCount: rec.pages.length });
    }
    this.appendEvent(rec, { type: 'state', state: 'disposed', previous: rec.job.state });
    rec.pages = [];
    rec.pageBytes.clear();
    rec.job.pageCount = 0;
    this.closeWhenSettled(rec);
  }

  /** Sets `effective` and `adjustments` on the job, as the agent's R-J5/R-J6 resolution does. */
  setEffective(jobId: string, effective: Json, adjustments: Json[]): void {
    const rec = this.rec(jobId);
    rec.job.effective = effective;
    rec.job.adjustments = adjustments;
  }

  private asyncProblem(problem: Json): Json {
    return {
      type: `urn:zilo:problem:${String(problem.code ?? 'unknown')}`,
      title: String(problem.code ?? 'unknown'),
      status: problem.status ?? 500,
      retryable: problem.retryable ?? false,
      requestId: 'req-1',
      errorId: `err-${String(++this.seq)}`,
      jobId: problem.jobId ?? 'job',
      ...problem,
    };
  }

  private pageBytes(index: number, page: Json): Uint8Array {
    return encoder.encode(`PAGE:${String(index)}:${String(page.colorMode)}`);
  }

  /** Appends one event with the next `seq`, keeping the log's contract invariants (R-E4, R-E5). */
  private appendEvent(rec: JobRec, partial: Json): Json {
    const seq = (rec.job.lastSeq as number) + 1;
    const event: Json = {
      seq,
      jobId: rec.job.id,
      time: new Date(this.now()).toISOString(),
      ...partial,
    };
    this.assertEvent(event);
    if (event.type === 'progress') {
      rec.events = rec.events.filter((e) => e.type !== 'progress');
    }
    rec.events.push(event);
    rec.job.lastSeq = seq;
    rec.job.updatedAt = event.time;
    switch (event.type) {
      case 'state':
        rec.job.state = event.state;
        break;
      case 'page':
        rec.job.pageCount = rec.pages.length;
        break;
      case 'done':
        rec.job.pageCount = event.pageCount;
        break;
      default:
        break;
    }
    const frame = encodeSseFrame({
      id: String(seq),
      event: String(event.type),
      data: JSON.stringify(event),
    });
    for (const sub of [...rec.subscribers]) sub.push(frame);
    return event;
  }

  private assertEvent(event: Json): void {
    const envelope = validate(schema('JobEventEnvelope'), event);
    if (envelope.length > 0) {
      throw new Error(`mock agent event violates JobEventEnvelope: ${envelope.join('; ')}`);
    }
    if (['state', 'progress', 'page', 'error', 'done'].includes(String(event.type))) {
      const known = validate(schema('JobEvent'), event);
      if (known.length > 0) {
        throw new Error(`mock agent event violates JobEvent: ${known.join('; ')}`);
      }
    }
  }

  private closeWhenSettled(rec: JobRec): void {
    const state = rec.job.state;
    if (state === 'disposed' || state === 'completed' || state === 'failed' || state === 'cancelled') {
      for (const sub of [...rec.subscribers]) sub.close();
    }
  }

  readonly fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const port = Number(url.port);
    const signal = init.signal ?? undefined;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const auth = headers.get('Authorization');
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
    this.log.push({
      op: route?.operationId ?? '?',
      method,
      port,
      token,
      headers: {
        'last-event-id': headers.get('Last-Event-ID') ?? undefined,
        'if-none-match': headers.get('If-None-Match') ?? undefined,
      } as Record<string, string>,
    });
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
      const query = Object.fromEntries(url.searchParams);
      return this.protectedOp(
        op,
        { ...route.params, ...query },
        fam,
        init.body,
        token ?? '',
        headers,
        signal,
      );
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

  /** A binary 200 (page image, export) or 304; the schema's media type is checked by the SDK. */
  private binary(
    status: number,
    bytes: Uint8Array,
    contentType: string,
    headers: Record<string, string>,
  ): Response {
    const h: Record<string, string> = {
      'Zilo-Request-Id': `req-${String(++this.seq)}`,
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': this.origin,
      ...headers,
    };
    if (status === 304) return new Response(null, { status, headers: h });
    h['Content-Type'] = contentType;
    h['Content-Length'] = String(bytes.byteLength);
    return new Response(bytes as unknown as BodyInit, { status, headers: h });
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
    headers: Headers,
    signal: AbortSignal | undefined,
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
      case 'createJob':
        return this.createJob(op, fam, rawBody);
      case 'listJobs':
        return this.respond(op, 200, {
          jobs: [...this.jobs.values()]
            .filter((r) => r.familyId === fam.id)
            .map((r) => r.job),
        });
      case 'getJob': {
        const rec = this.ownedJob(params.jobId, fam, op);
        if (rec instanceof Response) return rec;
        return this.respond(op, 200, rec.job);
      }
      case 'disposeJob': {
        const rec = this.ownedJob(params.jobId, fam, op);
        if (rec instanceof Response) return rec;
        this.dispose(rec.job.id as string);
        return this.respond(op, 204);
      }
      case 'cancelJob': {
        const rec = this.ownedJob(params.jobId, fam, op);
        if (rec instanceof Response) return rec;
        if (rawBody !== undefined && String(rawBody) !== '') {
          this.checkRequest('CancelJobRequest', rawBody);
        }
        const body = rawBody === undefined ? {} : (JSON.parse(String(rawBody)) as Json);
        const state = rec.job.state;
        const settled =
          state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'disposed';
        // R-J2: a settled job is a 200 no-op and never discards, whatever `discardPages` says.
        if (settled) return this.respond(op, 200, rec.job);
        if (body.discardPages === true) {
          // R-J2: `cancelled`, `done` and `disposed` as one atomic step.
          this.appendEvent(rec, { type: 'state', state: 'cancelled', previous: state });
          this.appendEvent(rec, { type: 'done', state: 'cancelled', pageCount: rec.pages.length });
          this.appendEvent(rec, { type: 'state', state: 'disposed', previous: 'cancelled' });
          rec.pages = [];
          rec.pageBytes.clear();
          rec.job.pageCount = 0;
          this.closeWhenSettled(rec);
        }
        return this.respond(op, 202, rec.job);
      }
      case 'streamJobEvents':
        return this.streamEvents(op, params, fam, headers, signal ?? new AbortController().signal);
      case 'listPages': {
        const rec = this.ownedJob(params.jobId, fam, op);
        if (rec instanceof Response) return rec;
        return this.respond(op, 200, { pages: rec.pages });
      }
      case 'getPageImage':
        return this.pageImage(op, params, fam, headers);
      case 'exportJob':
        return this.export(op, params, fam, rawBody);
      default:
        throw new Error(`mock agent: ${op} is outside the T21 scope`);
    }
  }

  private createJob(op: string, fam: FamilyRec, rawBody: unknown): Response {
    this.checkRequest('CreateJobRequest', rawBody);
    const req = JSON.parse(String(rawBody)) as { deviceId: string; settings: Json };
    const id = rand(16);
    const job: Json = {
      id,
      deviceId: req.deviceId,
      state: 'queued',
      createdAt: new Date(this.now()).toISOString(),
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
      lastSeq: 0,
    };
    const rec: JobRec = {
      familyId: fam.id,
      job,
      events: [],
      pages: [],
      pageBytes: new Map(),
      subscribers: new Set(),
    };
    this.jobs.set(id, rec);
    this.appendEvent(rec, { type: 'state', state: 'queued' });
    return this.respond(op, 201, job, { Location: `/zilo/v1/jobs/${id}` });
  }

  private ownedJob(jobId: string | undefined, fam: FamilyRec, op: string): JobRec | Response {
    const rec = jobId === undefined ? undefined : this.jobs.get(jobId);
    // R-J1: a job of another family is indistinguishable from an unknown one.
    if (rec === undefined || rec.familyId !== fam.id) return this.problem(op, 404, 'not-found');
    return rec;
  }

  /** SSE response with replay, live handoff, heartbeats and the R-E7 close rule. */
  private streamEvents(
    op: string,
    params: Record<string, string>,
    fam: FamilyRec,
    headers: Headers,
    requestSignal: AbortSignal,
  ): Response {
    const rec = this.ownedJob(params.jobId, fam, op);
    if (rec instanceof Response) return rec;
    const lastRaw = headers.get('Last-Event-ID');
    let last = 0;
    if (lastRaw !== null) {
      if (!/^\d{1,15}$/.test(lastRaw)) return this.problem(op, 400, 'invalid-request');
      last = Number(lastRaw);
      if (last > (rec.job.lastSeq as number)) return this.problem(op, 400, 'invalid-request');
    }
    this.streamsOpened += 1;
    const closeImmediately = this.sseCloseNextImmediately;
    this.sseCloseNextImmediately = false;
    const dropAfter = this.sseDropNextAfter;
    this.sseDropNextAfter = undefined;
    const self = this;
    const signal = requestSignal;
    let cleanup = (): void => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let sentEvents = 0;
        let heartbeat: ReturnType<typeof setTimeout> | undefined;
        const subscriber: Subscriber = {
          live: false,
          buffer: [],
          push(frame) {
            if (closed) return;
            if (!subscriber.live) {
              subscriber.buffer.push(frame);
              return;
            }
            write(frame);
          },
          close() {
            finish();
          },
        };
        const clearHeartbeat = (): void => {
          if (heartbeat !== undefined) clearTimeout(heartbeat);
          heartbeat = undefined;
        };
        const finish = (): void => {
          if (closed) return;
          closed = true;
          clearHeartbeat();
          signal.removeEventListener('abort', onAbort);
          rec.subscribers.delete(subscriber);
          self.streamsClosed += 1;
          try {
            controller.close();
          } catch {
            // Already closed by the consumer.
          }
        };
        const write = (frame: string): void => {
          if (closed) return;
          if (dropAfter !== undefined && sentEvents >= dropAfter) {
            // A dropped connection: close without `done` (R-E6 recovery is the SDK's).
            finish();
            return;
          }
          const bytes = encoder.encode(frame);
          const size = self.sseChunkBytes;
          try {
            if (size === undefined || size <= 0 || size >= bytes.byteLength) {
              controller.enqueue(bytes);
            } else {
              for (let i = 0; i < bytes.byteLength; i += size) {
                controller.enqueue(bytes.subarray(i, Math.min(bytes.byteLength, i + size)));
              }
            }
          } catch {
            finish();
            return;
          }
          if (frame.includes('event: ')) sentEvents += 1;
        };
        const armHeartbeat = (): void => {
          clearHeartbeat();
          if (self.heartbeatMs <= 0 || closed) return;
          heartbeat = setTimeout(() => {
            if (closed) return;
            write(': hb\n\n');
            armHeartbeat();
          }, self.heartbeatMs);
        };
        const onAbort = (): void => finish();
        cleanup = finish;
        signal.addEventListener('abort', onAbort, { once: true });

        if (closeImmediately) {
          finish();
          return;
        }
        // R-E5: capture H atomically with subscribing, then replay `L < seq <= H`.
        const high = rec.job.lastSeq as number;
        rec.subscribers.add(subscriber);
        for (const event of rec.events) {
          const seq = event.seq as number;
          if (seq > last && seq <= high) {
            write(
              encodeSseFrame({
                id: String(seq),
                event: String(event.type),
                data: JSON.stringify(event),
              }),
            );
          }
        }
        subscriber.live = true;
        for (const frame of subscriber.buffer.splice(0)) write(frame);
        const state = rec.job.state;
        const settled =
          state === 'disposed' ||
          state === 'completed' ||
          state === 'failed' ||
          state === 'cancelled';
        // R-E7: a settled job closes after its replay (a tombstone ends with `state: disposed`);
        // `L == lastSeq` on a settled job closes right after the headers.
        if (settled) {
          finish();
          return;
        }
        armHeartbeat();
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        'Access-Control-Allow-Origin': this.origin,
        'Zilo-Request-Id': `req-${String(++this.seq)}`,
      },
    });
  }

  /** `GET /jobs/{id}/pages/{index}` (R-P2, R-P3): bytes, variant ETag, `304` revalidation. */
  private pageImage(
    op: string,
    params: Record<string, string>,
    fam: FamilyRec,
    headers: Headers,
  ): Response {
    const rec = this.ownedJob(params.jobId, fam, op);
    if (rec instanceof Response) return rec;
    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0 || index >= rec.pages.length) {
      return this.problem(op, 404, 'not-found');
    }
    const page = rec.pages[index] as Json;
    const format =
      (params.format as string | undefined) ??
      (page.colorMode === 'bw' ? 'png' : 'jpeg');
    if (format !== 'jpeg' && format !== 'png') return this.problem(op, 400, 'invalid-request');
    const maxWidth = params.maxWidth === undefined ? undefined : Number(params.maxWidth);
    if (maxWidth !== undefined && (!Number.isInteger(maxWidth) || maxWidth < 16 || maxWidth > 4096)) {
      return this.problem(op, 400, 'invalid-request');
    }
    const quality = params.quality === undefined ? undefined : Number(params.quality);
    if (quality !== undefined && (!Number.isInteger(quality) || quality < 1 || quality > 100)) {
      return this.problem(op, 400, 'invalid-request');
    }
    const etag = `"page-${String(index)}-${format}-${String(maxWidth ?? 0)}-${String(quality ?? 85)}"`;
    const ifNoneMatch = headers.get('If-None-Match') ?? undefined;
    if (ifNoneMatch !== undefined && ifNoneMatch === etag) {
      return this.binary(304, new Uint8Array(), IMAGE_TYPES[format], { ETag: etag });
    }
    const bytes = encoder.encode(
      `IMAGE:${String(index)}:${format}:${String(maxWidth ?? 'full')}:${String(quality ?? 85)}:${String(page.colorMode)}`,
    );
    return this.binary(200, bytes, IMAGE_TYPES[format], { ETag: etag });
  }

  /** `POST /jobs/{id}/export` (§8, R-X1 to R-X7). */
  private export(op: string, params: Record<string, string>, fam: FamilyRec, rawBody: unknown): Response {
    const rec = this.ownedJob(params.jobId, fam, op);
    if (rec instanceof Response) return rec;
    this.checkRequest('ExportRequest', rawBody);
    const body = JSON.parse(String(rawBody)) as Json;
    if (body.deleteAfterExport === true) this.sawDeleteAfterExport = true;
    const state = rec.job.state;
    const active = state !== 'completed' && state !== 'failed' && state !== 'cancelled' && state !== 'disposed';
    if (body.deleteAfterExport === true && active) return this.problem(op, 409, 'invalid-state');
    if (this.exportProblem !== undefined) {
      const p = this.exportProblem;
      return this.problem(op, p.status, p.code, p.retryable, p.retryAfterSeconds, p.extra);
    }
    const explicit = Array.isArray(body.pages) ? (body.pages as Json[]) : undefined;
    let selection: Json[];
    if (explicit === undefined) {
      selection = rec.pages.map((page) => ({ index: page.index as number, rotate: 0 }));
    } else {
      selection = explicit.map((p) => ({
        index: p.index as number,
        rotate: (p.rotate as number | undefined) ?? 0,
      }));
    }
    const seen = new Set<number>();
    for (let i = 0; i < selection.length; i++) {
      const entry = selection[i] as Json;
      const index = entry.index as number;
      if (index < 0 || index >= rec.pages.length) {
        return this.problem(op, 422, 'invalid-request', false, undefined, {
          errors: [{ field: `/pages/${String(i)}/index`, reason: 'page-unavailable' }],
        });
      }
      if (seen.has(index)) {
        return this.problem(op, 422, 'invalid-request', false, undefined, {
          errors: [{ field: `/pages/${String(i)}/index`, reason: 'duplicate-index' }],
        });
      }
      seen.add(index);
    }
    if (selection.length === 0) {
      return this.problem(op, 409, 'invalid-state', false, undefined, {
        errors: [{ field: '/pages', reason: 'no-pages' }],
      });
    }
    const format = String(body.format);
    this.exported.push({
      format,
      indexes: selection.map((p) => p.index as number),
      rotates: selection.map((p) => p.rotate as number),
    });
    const content = `EXPORT:${format}:${selection
      .map((p) => `${String(p.index)}@${String(p.rotate)}`)
      .join(',')}:q${String(body.quality ?? 85)}`;
    const bytes = encoder.encode(content);
    const filename = sanitiseFilename(typeof body.filename === 'string' ? body.filename : undefined);
    const short = this.exportShortBody;
    if (body.deleteAfterExport === true) {
      // The mock disposes the moment it has the whole body, like the agent (§8, R-X5).
      this.dispose(rec.job.id as string);
    }
    const response = this.binary(
      200,
      bytes,
      EXPORT_TYPES[format as keyof typeof EXPORT_TYPES] ?? 'application/octet-stream',
      {
        'Content-Disposition': `attachment; filename="${filename}.${EXPORT_EXT[format as keyof typeof EXPORT_EXT] ?? 'bin'}"`,
        'Zilo-Page-Count': String(selection.length),
      },
    );
    if (!short) return response;
    // A transfer that fails after the 200: the length is right, the body is short (R-X3).
    const headers = new Headers(response.headers);
    const truncated = bytes.subarray(0, Math.max(0, bytes.byteLength - 3));
    return new Response(truncated as unknown as BodyInit, { status: 200, headers });
  }
}

function sanitiseFilename(value: string | undefined): string {
  const base = (value ?? 'scan').replace(/[^A-Za-z0-9._-]/g, '');
  return base === '' ? 'scan' : base;
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
