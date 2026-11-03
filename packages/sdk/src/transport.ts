// Fetch-based HTTP transport to the loopback agent (D-003, CONTRACT.md §2): bounded timeouts,
// caller abort, bearer attach (R-T10: header only, never the URL), typed problem errors (§9),
// response-body length verification for binary replies (R-X3) and redacted debug logging.
import {
  isKnownProblemCode,
  ZiloAbortError,
  ZiloProblemError,
  ZiloProtocolError,
  ZiloShortBodyError,
  ZiloTimeoutError,
  ZiloTransportError,
} from './errors.js';
import { createLogger, type DebugLogger } from './log.js';
import type { Problem } from './types.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface TransportOptions {
  /** Defaults to the global `fetch`. Tests inject the contract mock agent here. */
  fetch?: FetchLike | undefined;
  /** Default per-request timeout. */
  timeoutMs?: number | undefined;
  logger?: DebugLogger | undefined;
  /**
   * The owner's lifetime: once aborted (the client was disposed), every in-flight request is
   * aborted and every later one fails at once with `ZiloAbortError`.
   */
  lifetime?: AbortSignal | undefined;
}

export interface RequestOptions {
  /** OpenAPI operationId, used for logs only. */
  op: string;
  method: 'GET' | 'POST' | 'DELETE';
  /** Absolute path under `/zilo/v1/`. */
  path: string;
  token?: string | undefined;
  body?: unknown;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /** Extra request headers (for example `Last-Event-ID` or `If-None-Match`). */
  headers?: Record<string, string> | undefined;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/** A reply whose body is left unread: SSE streams (R-E1) and binary payloads. */
export interface RawResponse {
  status: number;
  headers: Headers;
  response: Response;
}

export interface BinaryResponse {
  /** 200 with bytes, or 304 with an empty body and the variant's `ETag` (R-P3). */
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

function combineSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (a !== undefined && b !== undefined) return AbortSignal.any([a, b]);
  return a ?? b;
}

/** One agent endpoint, `http://127.0.0.1:<port>` (R-T1: the IP literal). */
export class HttpTransport {
  readonly port: number;
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly log: DebugLogger;
  private readonly lifetime: AbortSignal | undefined;

  constructor(port: number, options: TransportOptions = {}) {
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${String(port)}`;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.log = createLogger(options.logger);
    this.lifetime = options.lifetime;
  }

  async request(options: RequestOptions): Promise<HttpResponse> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const started = Date.now();
    const aborted = (): boolean => options.signal?.aborted === true || this.lifetime?.aborted === true;
    if (aborted()) throw new ZiloAbortError('aborted');
    const controller = new AbortController();
    const flags = { timedOut: false };
    const timer = setTimeout(() => {
      flags.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    this.lifetime?.addEventListener('abort', onAbort, { once: true });

    const init = this.init(options, controller.signal);
    const fail = (err: unknown): never => {
      if (flags.timedOut) throw new ZiloTimeoutError(timeoutMs);
      if (aborted()) throw new ZiloAbortError('aborted');
      if (err instanceof ZiloProtocolError) throw err;
      throw new ZiloTransportError('request failed', { cause: err });
    };

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(this.baseUrl + options.path, init);
      text = response.status === 204 ? '' : await response.text();
    } catch (err) {
      this.log('request.failed', {
        op: options.op,
        port: this.port,
        reason: flags.timedOut ? 'timeout' : 'transport',
        ms: Date.now() - started,
      });
      return fail(err);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      this.lifetime?.removeEventListener('abort', onAbort);
    }
    // Disposed or aborted while the body was read: drop the answer instead of acting on it.
    if (aborted()) throw new ZiloAbortError('aborted');

    const body = parseBody(text, response);
    const status = response.status;
    if (status >= 400) this.throwProblem(options.op, response, body, started);
    this.log('request.ok', { op: options.op, port: this.port, status, ms: Date.now() - started });
    return { status, headers: response.headers, body };
  }

  /**
   * Sends a request and returns the unread `Response`, for a long-lived body (SSE, R-E1). There is
   * no timeout: the stream's own heartbeat check (R-E6) and the caller's abort end it. A problem
   * answer is read and thrown like any other call.
   */
  async open(options: RequestOptions): Promise<RawResponse> {
    const started = Date.now();
    const aborted = (): boolean => options.signal?.aborted === true || this.lifetime?.aborted === true;
    if (aborted()) throw new ZiloAbortError('aborted');
    const signal = combineSignals(options.signal, this.lifetime);
    const init = this.init(options, signal);
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + options.path, init);
    } catch (err) {
      this.log('stream.failed', { op: options.op, port: this.port, ms: Date.now() - started });
      if (aborted()) throw new ZiloAbortError('aborted');
      throw new ZiloTransportError('stream request failed', { cause: err });
    }
    if (aborted()) {
      await response.body?.cancel().catch(() => undefined);
      throw new ZiloAbortError('aborted');
    }
    if (response.status >= 400) {
      const text = await response.text();
      this.throwProblem(options.op, response, parseBody(text, response), started);
    }
    this.log('stream.open', {
      op: options.op,
      port: this.port,
      status: response.status,
      ms: Date.now() - started,
    });
    return { status: response.status, headers: response.headers, response };
  }

  /**
   * Sends a request and reads the whole body as bytes, verifying it against `Content-Length`
   * (R-X3: a short body is a failed transfer, never a successful export). A `304` has no body.
   */
  async requestBinary(options: RequestOptions): Promise<BinaryResponse> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const started = Date.now();
    const aborted = (): boolean => options.signal?.aborted === true || this.lifetime?.aborted === true;
    if (aborted()) throw new ZiloAbortError('aborted');
    const controller = new AbortController();
    const flags = { timedOut: false };
    const timer = setTimeout(() => {
      flags.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    this.lifetime?.addEventListener('abort', onAbort, { once: true });
    const init = this.init(options, controller.signal);

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + options.path, init);
      if (response.status >= 400) {
        const text = await response.text();
        this.throwProblem(options.op, response, parseBody(text, response), started);
      }
      if (response.status === 304) {
        await response.body?.cancel().catch(() => undefined);
        this.log('binary.not-modified', {
          op: options.op,
          port: this.port,
          ms: Date.now() - started,
        });
        return { status: 304, headers: response.headers, bytes: new Uint8Array() };
      }
      const expected = contentLength(response.headers);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (aborted()) throw new ZiloAbortError('aborted');
      if (bytes.byteLength !== expected) throw new ZiloShortBodyError(expected, bytes.byteLength);
      this.log('binary.ok', {
        op: options.op,
        port: this.port,
        status: response.status,
        bytes: bytes.byteLength,
        ms: Date.now() - started,
      });
      return { status: response.status, headers: response.headers, bytes };
    } catch (err) {
      if (flags.timedOut) throw new ZiloTimeoutError(timeoutMs);
      if (aborted()) throw new ZiloAbortError('aborted');
      if (
        err instanceof ZiloProtocolError ||
        err instanceof ZiloProblemError ||
        err instanceof ZiloShortBodyError ||
        err instanceof ZiloAbortError
      ) {
        throw err;
      }
      this.log('binary.failed', {
        op: options.op,
        port: this.port,
        reason: flags.timedOut ? 'timeout' : 'transport',
        ms: Date.now() - started,
      });
      throw new ZiloTransportError('request failed', { cause: err });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      this.lifetime?.removeEventListener('abort', onAbort);
    }
  }

  private init(options: RequestOptions, signal: AbortSignal | undefined): RequestInit & {
    targetAddressSpace: 'loopback';
  } {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
    const init: RequestInit & { targetAddressSpace: 'loopback' } = {
      method: options.method,
      headers,
      cache: 'no-store',
      credentials: 'omit',
      // R-T1: Chromium's Local Network Access hint; ignored where unsupported.
      targetAddressSpace: 'loopback',
    };
    if (signal !== undefined) init.signal = signal;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return init;
  }

  private throwProblem(
    op: string,
    response: Response,
    body: unknown,
    started: number,
  ): never {
    const status = response.status;
    const problem = asProblem(body, status);
    this.log('request.problem', {
      op,
      port: this.port,
      status,
      code: problem?.code,
      ms: Date.now() - started,
    });
    if (problem === undefined) {
      throw new ZiloProtocolError(`HTTP ${String(status)} without a problem body`, status);
    }
    const code = isKnownProblemCode(problem.code) ? problem.code : 'unknown';
    throw new ZiloProblemError(code, problem, parseRetryAfter(response.headers.get('Retry-After')));
  }
}

function contentLength(headers: Headers): number {
  const value = headers.get('Content-Length');
  if (value === null || !/^\d+$/.test(value.trim())) {
    throw new ZiloProtocolError('response has no usable Content-Length');
  }
  return Number(value.trim());
}

function parseBody(text: string, response: Response): unknown {
  if (text === '') return undefined;
  const type = response.headers.get('Content-Type') ?? '';
  if (!/^application\/(?:problem\+)?json\b/i.test(type)) {
    throw new ZiloProtocolError(
      `unexpected content type for HTTP ${String(response.status)}`,
      response.status,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ZiloProtocolError('response body is not JSON', response.status);
  }
}

function asProblem(body: unknown, status: number): Problem | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const p = body as Partial<Problem>;
  if (typeof p.code !== 'string' || typeof p.retryable !== 'boolean') return undefined;
  return { ...(body as Problem), status: typeof p.status === 'number' ? p.status : status };
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
}
