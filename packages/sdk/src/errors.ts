// Typed SDK errors (CONTRACT.md §9). Clients key on `code`, never on the HTTP status alone (R-ER3).
import type { ErrorCodeKnown, Problem } from './types.js';

/** Every wire problem code of the frozen v1 list, with its §9 status and default retryability. */
export const PROBLEM_CODES = {
  'host-denied': { status: [403], retryable: false },
  'unauthorized-origin': { status: [403], retryable: false },
  'consent-pending': { status: [403], retryable: true },
  'consent-denied': { status: [403], retryable: true },
  'token-invalid': { status: [401], retryable: false },
  'token-revoked': { status: [401], retryable: false },
  'rate-limited': { status: [429], retryable: true },
  'invalid-request': { status: [400, 405, 422], retryable: false },
  'invalid-settings': { status: [422], retryable: false },
  'unsupported-capability': { status: [422], retryable: false },
  'invalid-state': { status: [409], retryable: false },
  'not-found': { status: [404], retryable: false },
  'device-busy': { status: [409], retryable: true },
  'feeder-empty': { status: [409], retryable: true },
  'paper-jam': { status: [409], retryable: true },
  'cover-open': { status: [409], retryable: true },
  timeout: { status: [504], retryable: true },
  disconnected: { status: [503], retryable: true },
  permission: { status: [403], retryable: false },
  'export-failed': { status: [500], retryable: true },
  'limits-exceeded': { status: [413, 429], retryable: false },
  'agent-unavailable': { status: [503], retryable: true },
  unknown: { status: [500], retryable: true },
} as const satisfies Record<ErrorCodeKnown, { status: readonly number[]; retryable: boolean }>;

/** A wire problem code the SDK knows. Unknown wire codes map to `unknown` (R-V4). */
export type ProblemCode = keyof typeof PROBLEM_CODES;

export function isKnownProblemCode(code: string): code is ProblemCode {
  return Object.hasOwn(PROBLEM_CODES, code);
}

/** Base class of every error the SDK throws. */
export class ZiloError extends Error {
  override name = 'ZiloError';
}

/**
 * An RFC 9457 problem from the agent. `code` is always a known code; an unknown wire code becomes
 * `unknown`, keeping the agent's `retryable` and the original code in `wireCode` (R-V4).
 */
export class ZiloProblemError<C extends ProblemCode = ProblemCode> extends ZiloError {
  override name = 'ZiloProblemError';
  readonly code: C;
  readonly wireCode: string;
  readonly status: number;
  readonly retryable: boolean;
  /** Seconds from `retryAfterSeconds` or the `Retry-After` header, when present. */
  readonly retryAfterSeconds: number | undefined;
  readonly requestId: string | undefined;
  /** The decoded problem body, unknown fields kept. Never contains document content or tokens. */
  readonly problem: Problem;

  constructor(code: C, problem: Problem, retryAfterHeader?: number) {
    super(`${String(problem.status)} ${problem.code}`);
    this.code = code;
    this.wireCode = problem.code;
    this.status = problem.status;
    this.retryable = problem.retryable;
    this.retryAfterSeconds = problem.retryAfterSeconds ?? retryAfterHeader;
    this.requestId = problem.requestId;
    this.problem = problem;
  }

  /** True for `consent-denied` with `blocked: true`: the agent will never prompt again. */
  get blocked(): boolean {
    return this.problem.blocked === true;
  }

  /** `limits-exceeded`: which limit was hit (§10, R-X6). Typed, never parsed from prose. */
  get limit(): { name: string; max?: number } | undefined {
    return this.problem.limit;
  }

  /** Field-level reasons on `invalid-request`/`invalid-settings` (§9). */
  get fieldErrors(): readonly { field: string; reason: string }[] {
    return this.problem.errors ?? [];
  }
}

/** Narrows an error to a problem with the given code. */
export function isProblem<C extends ProblemCode>(
  err: unknown,
  code: C,
): err is ZiloProblemError<C> {
  return err instanceof ZiloProblemError && err.code === code;
}

/**
 * The request did not reach a readable response: a network error, a refused connection, or a
 * response without CORS (the browser surfaces all of them as a `TypeError`).
 */
export class ZiloTransportError extends ZiloError {
  override name = 'ZiloTransportError';
}

/** The SDK's own bounded timeout fired before a response arrived. */
export class ZiloTimeoutError extends ZiloError {
  override name = 'ZiloTimeoutError';
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`timed out after ${String(timeoutMs)} ms`);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * A binary reply was shorter than its `Content-Length` (R-X3): the transfer failed, even though
 * the status line was a `200`. A non-destructive export may be retried (R-X4).
 */
export class ZiloShortBodyError extends ZiloTransportError {
  override name = 'ZiloShortBodyError';
  readonly expectedBytes: number;
  readonly receivedBytes: number;
  constructor(expectedBytes: number, receivedBytes: number) {
    super(`short body: expected ${String(expectedBytes)} bytes, received ${String(receivedBytes)}`);
    this.expectedBytes = expectedBytes;
    this.receivedBytes = receivedBytes;
  }
}

/** The caller aborted the operation through its `AbortSignal`. */
export class ZiloAbortError extends ZiloError {
  override name = 'ZiloAbortError';
}

/**
 * The client was disposed (`ZiloClient.dispose()`, the host app's Unload). Every pending and later
 * operation of that instance ends with this error; it is an abort, never an agent answer.
 */
export class ZiloDisposedError extends ZiloAbortError {
  override name = 'ZiloDisposedError';
  constructor() {
    super('client disposed');
  }
}

/** A response did not match the contract shape the SDK needs (or an error without a problem body). */
export class ZiloProtocolError extends ZiloError {
  override name = 'ZiloProtocolError';
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * SDK-local outcome `agent-restarted` (CONTRACT.md §12, R-R3). Never a wire code: the agent did
 * not report it. The job and its pages are gone; the outcome is retryable in the R-ER3 sense (the
 * user can scan again), and the SDK never rescans on its own.
 */
export class ZiloAgentRestartedError extends ZiloError {
  override name = 'ZiloAgentRestartedError';
  readonly code = 'agent-restarted';
  readonly retryable = true;
  readonly jobId: string;
  constructor(jobId: string) {
    super(`agent restarted; job ${jobId} is gone`);
    this.jobId = jobId;
  }
}

/**
 * Access was revoked (R-A12, R-A13): a readable `401 token-revoked`, or a site removal detected
 * after a `TypeError`. Copy must say that access was revoked, never that pages were erased.
 */
export class ZiloAccessRevokedError extends ZiloError {
  override name = 'ZiloAccessRevokedError';
  readonly code = 'token-revoked';
}
