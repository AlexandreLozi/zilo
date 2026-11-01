// Fetch-based HTTP transport to the loopback agent (D-003, CONTRACT.md §2): bounded timeouts,
// caller abort, bearer attach (R-T10: header only, never the URL), typed problem errors (§9) and
// redacted debug logging.
import {
  isKnownProblemCode,
  ZiloAbortError,
  ZiloProblemError,
  ZiloProtocolError,
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
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/** One agent endpoint, `http://127.0.0.1:<port>` (R-T1: the IP literal). */
export class HttpTransport {
  readonly port: number;
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly log: DebugLogger;

  constructor(port: number, options: TransportOptions = {}) {
    this.port = port;
    this.baseUrl = `http://127.0.0.1:${String(port)}`;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.log = createLogger(options.logger);
  }

  async request(options: RequestOptions): Promise<HttpResponse> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const started = Date.now();
    const controller = new AbortController();
    const flags = { timedOut: false };
    const timer = setTimeout(() => {
      flags.timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort();
    };
    if (options.signal?.aborted === true) {
      clearTimeout(timer);
      throw new ZiloAbortError('aborted');
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
    const init: RequestInit & { targetAddressSpace: 'loopback' } = {
      method: options.method,
      headers,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      // R-T1: Chromium's Local Network Access hint; ignored where unsupported.
      targetAddressSpace: 'loopback',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const fail = (err: unknown): never => {
      if (flags.timedOut) throw new ZiloTimeoutError(timeoutMs);
      if (options.signal?.aborted === true) throw new ZiloAbortError('aborted');
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
    }

    const body = parseBody(text, response);
    const status = response.status;
    if (status >= 400) {
      const problem = asProblem(body, status);
      this.log('request.problem', {
        op: options.op,
        port: this.port,
        status,
        code: problem?.code,
        ms: Date.now() - started,
      });
      if (problem === undefined)
        throw new ZiloProtocolError(`HTTP ${String(status)} without a problem body`, status);
      const code = isKnownProblemCode(problem.code) ? problem.code : 'unknown';
      throw new ZiloProblemError(
        code,
        problem,
        parseRetryAfter(response.headers.get('Retry-After')),
      );
    }
    this.log('request.ok', { op: options.op, port: this.port, status, ms: Date.now() - started });
    return { status, headers: response.headers, body };
  }
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
