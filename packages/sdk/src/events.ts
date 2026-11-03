// Job event stream over fetch (CONTRACT.md §6): SSE framing, two-step decoding (R-V4), `seq`
// tracking with resume from the last *processed* sequence (R-E4, R-E5), bounded reconnect backoff,
// heartbeat liveness (R-E6), `done` closing the stream (R-E7) and full release of every listener
// and timer on abort, dispose or `done`.
//
// The stream never invents a job transition: a `state` event is validated against §5.2 and passed
// on as the agent sent it. A fatal `error` event is surfaced as-is; the agent's following
// `state: failed` and `done` are expected, and a stream that ends without them is a protocol
// error, not a synthesized completion.
import { throwIfAborted } from './abort.js';
import { decodeEventEnvelope, decodeJobEvent, isKnownEventType } from './decode.js';
import {
  isProblem,
  ZiloAbortError,
  ZiloDisposedError,
  ZiloError,
  ZiloProtocolError,
  ZiloTimeoutError,
  ZiloTransportError,
} from './errors.js';
import { applyJobTransition, isSettledState, terminalState } from './job-state.js';
import { SseDecoder, type SseFrame } from './sse.js';
import type { AsyncProblem, DoneEvent, JobEvent, JobEventEnvelope, JobState } from './types.js';

/** Default heartbeat period of CONTRACT §10 (`sseHeartbeatSeconds`), used until `hello.limits` is read. */
export const DEFAULT_SSE_HEARTBEAT_SECONDS = 15;

/** R-E6: nothing (event or heartbeat) for 3× the heartbeat period means the stream is dead. */
export function heartbeatTimeoutFor(heartbeatSeconds: number): number {
  return Math.max(1, heartbeatSeconds) * 3 * 1000;
}

export interface BackoffOptions {
  initialMs?: number;
  maxMs?: number;
  factor?: number;
}

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  initialMs: 250,
  maxMs: 5_000,
  factor: 2,
};

/** The terminal state of a job, and how the stream learned it. */
export interface JobDone {
  /** The `done` event, when the stream carried it. Absent only when a settled replay had none left. */
  event?: DoneEvent;
  /** A terminal state, or `disposed` when the replay ended on a tombstone (R-E7). */
  state: JobState;
  pageCount: number;
  error?: AsyncProblem;
}

/** What `GET /jobs/{id}` says after a stream closed without `done` (R-E7). */
export interface JobSettledSnapshot {
  state: JobState;
  pageCount: number;
  error?: AsyncProblem;
}

/** Opens one stream attempt. The client supplies this; the credential and recovery live there. */
export type StreamOpener = (request: {
  lastEventId: number | undefined;
  signal: AbortSignal;
}) => Promise<Response>;

export interface JobEventStreamOptions {
  /** Caller abort and client disposal both end the stream and release everything. */
  signal?: AbortSignal | undefined;
  /** Last `seq` already processed by a previous stream (R-E5). */
  lastEventId?: number | undefined;
  backoff?: BackoffOptions | undefined;
  /** R-E6 dead-stream bound. Defaults to 3× 15 s. */
  heartbeatTimeoutMs?: number | undefined;
  /** Reconnects before the stream fails. */
  maxReconnects?: number | undefined;
  /** Reads the job after an unexpected end of stream, to tell a settled replay from a drop. */
  snapshot?: ((signal: AbortSignal) => Promise<JobSettledSnapshot | undefined>) | undefined;
}

type EventListener = (event: JobEvent) => void | Promise<void>;
type UnknownListener = (envelope: JobEventEnvelope) => void;

interface Waiter {
  resolve: (value: IteratorResult<JobEvent>) => void;
  reject: (reason: unknown) => void;
}

export class JobEventStream implements AsyncIterable<JobEvent> {
  private readonly open: StreamOpener;
  private readonly options: JobEventStreamOptions;
  private readonly controller = new AbortController();
  private readonly listeners = new Set<EventListener>();
  private readonly unknownListeners = new Set<UnknownListener>();
  private readonly queue: JobEvent[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly donePromise: Promise<JobDone>;
  private resolveDonePromise: (value: JobDone) => void = () => undefined;
  private rejectDonePromise: (reason: unknown) => void = () => undefined;
  private externalListener: (() => void) | undefined;
  private listenerCount = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatFired = false;
  private lastSeqValue: number;
  private lastState: JobState | undefined;
  private isClosed = false;
  private failure: unknown;
  private terminal: JobDone | undefined;

  constructor(open: StreamOpener, options: JobEventStreamOptions = {}) {
    this.open = open;
    this.options = options;
    this.lastSeqValue = options.lastEventId ?? 0;
    this.donePromise = new Promise<JobDone>((resolve, reject) => {
      this.resolveDonePromise = resolve;
      this.rejectDonePromise = reject;
    });
    // A consumer may only iterate and never read `done`; an internal handler keeps that rejection
    // from surfacing as an unhandled rejection, while real awaiters still see it.
    void this.donePromise.catch(() => undefined);
    const signal = options.signal;
    if (signal !== undefined) {
      if (signal.aborted) {
        this.finishWithError(new ZiloAbortError('aborted'));
        return;
      }
      const onAbort = (): void => {
        this.abort();
      };
      this.externalListener = onAbort;
      signal.addEventListener('abort', onAbort, { once: true });
      this.listenerCount += 1;
    }
    void this.run();
  }

  /** The last `seq` processed, including an ignored unknown type (R-E5). */
  get lastSeq(): number {
    return this.lastSeqValue;
  }

  /** The agent's `done` event, or the settled state a replay ended on. Rejects on failure/abort. */
  get done(): Promise<JobDone> {
    return this.donePromise;
  }

  get finished(): boolean {
    return this.isClosed;
  }

  get terminalOutcome(): JobDone | undefined {
    return this.terminal;
  }

  /** Live timers and abort listeners; a diagnostic used to prove nothing leaks. */
  get resources(): { timers: number; listeners: number } {
    return { timers: this.timers.size, listeners: this.listenerCount };
  }

  onEvent(listener: EventListener): () => void {
    if (this.isClosed) return () => false;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Events whose `type` the SDK does not know; their `seq` is recorded as processed (R-V4). */
  onUnknown(listener: UnknownListener): () => void {
    if (this.isClosed) return () => false;
    this.unknownListeners.add(listener);
    return () => this.unknownListeners.delete(listener);
  }

  /** Stops the stream now and releases its reader, listeners and timers. Idempotent. */
  abort(): void {
    if (this.isClosed) return;
    this.controller.abort();
    this.finishWithError(new ZiloAbortError('aborted'));
  }

  [Symbol.asyncIterator](): AsyncIterator<JobEvent> {
    return {
      next: () => this.next(),
      return: () => {
        this.abort();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }

  private next(): Promise<IteratorResult<JobEvent>> {
    const value = this.queue.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.isClosed) {
      if (this.failure !== undefined) return Promise.reject(this.failure);
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private async run(): Promise<void> {
    const maxReconnects = this.options.maxReconnects ?? 6;
    let attempt = 0;
    try {
      for (;;) {
        throwIfAborted(this.controller.signal);
        let response: Response;
        try {
          response = await this.open({
            lastEventId: this.lastSeqValue > 0 ? this.lastSeqValue : undefined,
            signal: this.controller.signal,
          });
          throwIfAborted(this.controller.signal);
        } catch (err) {
          if (this.isClosed) return;
          throwIfAborted(this.controller.signal);
          if (!isRetryable(err) || attempt >= maxReconnects) throw err;
          attempt += 1;
          await this.sleep(this.backoffDelay(attempt));
          continue;
        }
        const before = this.lastSeqValue;
        await this.consume(response);
        if (this.isClosed) return;
        if (this.terminal !== undefined) return;
        if (this.lastSeqValue !== before) attempt = 0;
        // A stream that ends without `done` is either a settled replay with nothing left (R-E7:
        // `L == lastSeq` closes after the headers) or a dropped connection. The job tells them apart.
        const snapshot = await this.readSnapshot();
        if (snapshot !== undefined && isSettledState(snapshot.state)) {
          this.completeFromSnapshot(snapshot);
          return;
        }
        attempt += 1;
        if (attempt > maxReconnects) {
          throw new ZiloProtocolError('event stream closed before done');
        }
        await this.sleep(this.backoffDelay(attempt));
      }
    } catch (err) {
      this.finishWithError(err);
    }
  }

  private async readSnapshot(): Promise<JobSettledSnapshot | undefined> {
    const snapshot = this.options.snapshot;
    if (snapshot === undefined) return undefined;
    try {
      const value = await snapshot(this.controller.signal);
      throwIfAborted(this.controller.signal);
      return value;
    } catch (err) {
      throwIfAborted(this.controller.signal);
      if (isRetryable(err)) return undefined;
      throw err;
    }
  }

  private async consume(response: Response): Promise<void> {
    const type = response.headers.get('Content-Type') ?? '';
    if (!/^text\/event-stream\b/i.test(type)) {
      throw new ZiloProtocolError('event stream: expected text/event-stream');
    }
    const body = response.body;
    if (body === null) throw new ZiloProtocolError('event stream: no body');
    const reader = body.getReader();
    this.reader = reader;
    this.heartbeatFired = false;
    const decoder = new SseDecoder();
    this.armHeartbeat(reader);
    try {
      for (;;) {
        throwIfAborted(this.controller.signal);
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (err) {
          throwIfAborted(this.controller.signal);
          if (this.heartbeatFired) throw new ZiloTransportError('event stream heartbeat timeout');
          throw new ZiloTransportError('event stream failed', { cause: err });
        }
        throwIfAborted(this.controller.signal);
        if (result.done) break;
        this.armHeartbeat(reader);
        for (const frame of decoder.push(result.value)) {
          const stop = await this.frame(frame);
          if (stop) return;
        }
        throwIfAborted(this.controller.signal);
      }
      if (this.heartbeatFired) throw new ZiloTransportError('event stream heartbeat timeout');
      decoder.end();
    } finally {
      this.clearHeartbeat();
      this.reader = undefined;
      try {
        await reader.cancel();
      } catch {
        // The stream is already closed or errored; nothing to release beyond the reader.
      }
    }
  }

  private armHeartbeat(reader: ReadableStreamDefaultReader<Uint8Array>): void {
    this.clearHeartbeat();
    const timeoutMs = this.options.heartbeatTimeoutMs ?? heartbeatTimeoutFor(DEFAULT_SSE_HEARTBEAT_SECONDS);
    this.heartbeatTimer = this.setTimer(timeoutMs, () => {
      this.heartbeatTimer = undefined;
      this.heartbeatFired = true;
      void reader.cancel().catch(() => undefined);
    });
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearTimeout(this.heartbeatTimer);
      this.timers.delete(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** Handles one frame; returns true when the stream must stop (a `done` event arrived). */
  private async frame(frame: SseFrame): Promise<boolean> {
    if (frame.data === '') return false;
    let body: unknown;
    try {
      body = JSON.parse(frame.data);
    } catch {
      throw new ZiloProtocolError('event data is not JSON');
    }
    const envelope = decodeEventEnvelope(body);
    if (envelope.seq <= this.lastSeqValue) return false; // already processed, or replayed
    if (!isKnownEventType(envelope.type)) {
      // Step 1 only: the envelope is valid, the payload is opaque, and `seq` counts as processed.
      this.lastSeqValue = envelope.seq;
      for (const listener of [...this.unknownListeners]) listener(envelope);
      return false;
    }
    const event = decodeJobEvent(envelope.type, body);
    if (event.type === 'state') {
      if (this.lastState !== undefined) applyJobTransition(this.lastState, event.state);
      this.lastState = event.state;
    }
    if (event.type === 'done') terminalState(event.state);
    for (const listener of [...this.listeners]) await listener(event);
    throwIfAborted(this.controller.signal);
    this.lastSeqValue = envelope.seq;
    if (event.type === 'done') {
      this.terminal = {
        event,
        state: event.state,
        pageCount: event.pageCount,
        ...(event.error === undefined ? {} : { error: event.error }),
      };
      this.pushQueue(event);
      this.resolveDone(this.terminal);
      this.finish();
      return true;
    }
    this.pushQueue(event);
    return false;
  }

  private completeFromSnapshot(snapshot: JobSettledSnapshot): void {
    const terminal: JobDone = {
      state: snapshot.state,
      pageCount: snapshot.pageCount,
      ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    };
    this.terminal = terminal;
    this.resolveDone(terminal);
    this.finish();
  }

  private pushQueue(event: JobEvent): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter.resolve({ value: event, done: false });
    else this.queue.push(event);
  }

  private resolveDone(value: JobDone): void {
    this.resolveDonePromise(value);
  }

  private finish(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.release();
    for (const waiter of this.waiters.splice(0)) {
      if (this.failure !== undefined) waiter.reject(this.failure);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  private finishWithError(err: unknown): void {
    if (this.isClosed) return;
    this.failure = err;
    this.rejectDonePromise(err);
    this.finish();
  }

  /** Releases every timer, listener and reader; idempotent. */
  private release(): void {
    this.clearHeartbeat();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.externalListener !== undefined && this.options.signal !== undefined) {
      this.options.signal.removeEventListener('abort', this.externalListener);
      this.externalListener = undefined;
      this.listenerCount -= 1;
    }
    const reader = this.reader;
    this.reader = undefined;
    if (reader !== undefined) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Already released.
      }
    }
    this.listeners.clear();
    this.unknownListeners.clear();
  }

  private setTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  private sleep(ms: number): Promise<void> {
    throwIfAborted(this.controller.signal);
    const signal = this.controller.signal;
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        this.timers.delete(timer);
        reject(new ZiloAbortError('aborted'));
      };
      const timer = this.setTimer(ms, () => {
        signal.removeEventListener('abort', onAbort);
        this.listenerCount -= 1;
        resolve();
      });
      signal.addEventListener('abort', onAbort, { once: true });
      this.listenerCount += 1;
    });
  }

  private backoffDelay(attempt: number): number {
    const options = { ...DEFAULT_BACKOFF, ...this.options.backoff };
    return Math.min(options.maxMs, options.initialMs * options.factor ** Math.max(0, attempt - 1));
  }
}

/** A stream failure the reconnect loop may retry; everything else ends the stream. */
function isRetryable(err: unknown): boolean {
  if (err instanceof ZiloAbortError || err instanceof ZiloDisposedError) return false;
  if (err instanceof ZiloTransportError || err instanceof ZiloTimeoutError) return true;
  if (isProblem(err, 'rate-limited')) return true;
  if (isProblem(err, 'agent-unavailable')) return true;
  return false;
}

/** True for the SDK-local restart outcome or a lost job: the stream is over, not retried. */
export function isFatalStreamError(err: unknown): boolean {
  return err instanceof ZiloError && !isRetryable(err);
}
