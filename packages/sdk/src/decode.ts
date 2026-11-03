// Tolerant decoders (CONTRACT.md R-V4): they check the fields the SDK relies on and keep every
// other field, including unknown fields and unknown values of open enums, untouched. A decode
// failure is a `ZiloProtocolError` that names fields, never values.
import { ZiloProtocolError } from './errors.js';
import { terminalState } from './job-state.js';
import type {
  ConsentStatus,
  DeviceCaps,
  DeviceList,
  DoneEvent,
  ErrorEvent,
  EventTypeKnown,
  HelloFull,
  HelloPublic,
  Job,
  JobEvent,
  JobEventEnvelope,
  JobList,
  Page,
  PageList,
  PageEvent,
  ProgressEvent,
  ResolutionList,
  ResolutionRange,
  SourceCaps,
  StateEvent,
  Token,
} from './types.js';

type Obj = Record<string, unknown>;

function obj(value: unknown, what: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ZiloProtocolError(`${what}: expected an object`);
  }
  return value as Obj;
}

function str(o: Obj, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new ZiloProtocolError(`${what}.${key}: expected a string`);
  return v;
}

function int(o: Obj, key: string, what: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ZiloProtocolError(`${what}.${key}: expected an integer`);
  }
  return v;
}

function arr(o: Obj, key: string, what: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new ZiloProtocolError(`${what}.${key}: expected an array`);
  return v;
}

const MAJOR_MINOR = /^(\d+)\.(\d+)$/;

function protocol(o: Obj, what: string): void {
  const p = obj(o.protocol, `${what}.protocol`);
  for (const key of ['min', 'max']) {
    if (!MAJOR_MINOR.test(str(p, key, `${what}.protocol`))) {
      throw new ZiloProtocolError(`${what}.protocol.${key}: expected major.minor`);
    }
  }
  for (const c of arr(o, 'capabilities', what)) {
    if (typeof c !== 'string')
      throw new ZiloProtocolError(`${what}.capabilities: expected strings`);
  }
}

/**
 * Decodes a `hello` body. Returns `undefined` when `product` is not `zilo`: a foreign service on
 * one of the ports (R-T1) is never talked to again.
 */
export function decodeHello(body: unknown): HelloPublic | HelloFull | undefined {
  const o = obj(body, 'hello');
  if (o.product !== 'zilo') return undefined;
  protocol(o, 'hello');
  if (o.scope === 'public') return o as unknown as HelloPublic;
  if (o.scope === 'full') {
    for (const key of ['version', 'instanceId', 'os', 'arch']) str(o, key, 'hello');
    obj(o.limits, 'hello.limits');
    return o as unknown as HelloFull;
  }
  // `scope` is one of the two closed discriminators (R-V4): another value is a contract breach.
  throw new ZiloProtocolError('hello.scope: expected public or full');
}

export function decodeConsent(body: unknown): ConsentStatus {
  const o = obj(body, 'consent');
  str(o, 'origin', 'consent');
  str(o, 'state', 'consent');
  if (o.state === 'pending') int(o, 'pollAfterSeconds', 'consent');
  if (o.state === 'denied') int(o, 'retryAfterSeconds', 'consent');
  return o as unknown as ConsentStatus;
}

export function decodeToken(body: unknown): Token {
  const o = obj(body, 'token');
  for (const key of [
    'token',
    'origin',
    'familyId',
    'issuedAt',
    'expiresAt',
    'renewAfter',
    'familyExpiresAt',
  ]) {
    str(o, key, 'token');
  }
  for (const key of ['issuedAt', 'expiresAt', 'renewAfter', 'familyExpiresAt']) {
    if (Number.isNaN(Date.parse(o[key] as string)))
      throw new ZiloProtocolError(`token.${key}: expected a timestamp`);
  }
  return o as unknown as Token;
}

export function decodeDeviceList(body: unknown): DeviceList {
  const o = obj(body, 'devices');
  for (const d of arr(o, 'devices', 'devices')) {
    const dev = obj(d, 'device');
    for (const key of ['id', 'name', 'driver', 'connection']) str(dev, key, 'device');
  }
  str(obj(o.discovery, 'devices.discovery'), 'state', 'devices.discovery');
  return o as unknown as DeviceList;
}

export function decodeCaps(body: unknown): DeviceCaps {
  const o = obj(body, 'caps');
  str(o, 'deviceId', 'caps');
  const sources = arr(o, 'sources', 'caps');
  if (sources.length === 0)
    throw new ZiloProtocolError('caps.sources: expected at least one source');
  for (const s of sources) {
    const src = obj(s, 'source');
    str(src, 'source', 'source');
    // `resolutions.kind` is an open discriminator: only the known kinds are checked (R-D4), with
    // the same guards `resolutionChoice` uses, so a malformed `list` or `range` stays invalid.
    const res = obj(src.resolutions, 'source.resolutions');
    const kind = str(res, 'kind', 'source.resolutions');
    if (kind === 'list' && !isResolutionList(res)) {
      throw new ZiloProtocolError('source.resolutions.values: expected positive integers');
    }
    if (kind === 'range' && !isResolutionRange(res)) {
      throw new ZiloProtocolError('source.resolutions: expected positive integer min, max, step');
    }
    arr(src, 'colorModes', 'source');
    if (arr(src, 'pageSizes', 'source').length === 0) {
      throw new ZiloProtocolError('source.pageSizes: expected at least one size');
    }
    const defaults = obj(src.defaults, 'source.defaults');
    int(defaults, 'resolution', 'source.defaults');
    str(defaults, 'colorMode', 'source.defaults');
    str(defaults, 'pageSize', 'source.defaults');
  }
  return o as unknown as DeviceCaps;
}

export function decodeJob(body: unknown): Job {
  const o = obj(body, 'job');
  for (const key of ['id', 'deviceId', 'state']) str(o, key, 'job');
  return o as unknown as Job;
}

/** `GET /jobs` (R-J1: only the caller's family's jobs). */
export function decodeJobList(body: unknown): JobList {
  const o = obj(body, 'jobs');
  for (const job of arr(o, 'jobs', 'jobs')) decodeJob(job);
  return o as unknown as JobList;
}

export function decodePageMeta(o: Obj, what: string): Page {
  for (const key of ['side', 'etag', 'createdAt']) str(o, key, what);
  for (const key of ['index', 'sheet', 'widthPx', 'heightPx']) int(o, key, what);
  const res = obj(o.resolution, `${what}.resolution`);
  int(res, 'x', `${what}.resolution`);
  int(res, 'y', `${what}.resolution`);
  str(o, 'colorMode', what);
  return o as unknown as Page;
}

/** `GET /jobs/{id}/pages`, in index order (R-P4). */
export function decodePageList(body: unknown): PageList {
  const o = obj(body, 'pages');
  for (const page of arr(o, 'pages', 'pages')) decodePageMeta(obj(page, 'page'), 'page');
  return o as unknown as PageList;
}

const KNOWN_EVENT_TYPES: readonly EventTypeKnown[] = ['state', 'progress', 'page', 'error', 'done'];

export function isKnownEventType(value: string): value is EventTypeKnown {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Decoding step 1 (R-V4, R-E2): `JobEventEnvelope` accepts any `type`, so an unknown event
 * survives this step. Only `seq`, `type`, `jobId` and `time` are required.
 */
export function decodeEventEnvelope(body: unknown): JobEventEnvelope {
  const o = obj(body, 'event');
  const seq = int(o, 'seq', 'event');
  if (seq < 1) throw new ZiloProtocolError('event.seq: expected an integer >= 1');
  str(o, 'type', 'event');
  str(o, 'jobId', 'event');
  const time = str(o, 'time', 'event');
  if (Number.isNaN(Date.parse(time))) throw new ZiloProtocolError('event.time: expected a timestamp');
  return o as unknown as JobEventEnvelope;
}

function decodeAsyncProblem(o: Obj, what: string): void {
  for (const key of ['code', 'requestId', 'errorId', 'jobId']) str(o, key, what);
  if (typeof o.status !== 'number' || !Number.isInteger(o.status))
    throw new ZiloProtocolError(`${what}.status: expected an integer`);
  if (typeof o.retryable !== 'boolean')
    throw new ZiloProtocolError(`${what}.retryable: expected a boolean`);
}

/**
 * Decoding step 2 (R-V4): a known event. The caller only reaches this for a `type` in
 * `EventTypeKnown`; every field the SDK relies on is checked, unknown fields are kept.
 */
export function decodeJobEvent(type: EventTypeKnown, body: unknown): JobEvent {
  const o = obj(body, 'event');
  switch (type) {
    case 'state': {
      str(o, 'state', 'stateEvent');
      if (o.previous !== undefined) str(o, 'previous', 'stateEvent');
      if (o.effective !== undefined) {
        const eff = obj(o.effective, 'stateEvent.effective');
        for (const key of ['source', 'pageSize']) str(eff, key, 'stateEvent.effective');
        for (const key of ['resolution']) int(eff, key, 'stateEvent.effective');
        str(eff, 'colorMode', 'stateEvent.effective');
        const mm = obj(eff.pageSizeMm, 'stateEvent.effective.pageSizeMm');
        for (const key of ['widthMm', 'heightMm']) {
          if (typeof mm[key] !== 'number')
            throw new ZiloProtocolError(`stateEvent.effective.pageSizeMm.${key}: expected a number`);
        }
      }
      if (o.adjustments !== undefined) arr(o, 'adjustments', 'stateEvent');
      return o as unknown as StateEvent;
    }
    case 'progress': {
      const done = int(o, 'pagesCompleted', 'progressEvent');
      if (done < 0) throw new ZiloProtocolError('progressEvent.pagesCompleted: expected >= 0');
      if (o.pageIndex !== undefined) int(o, 'pageIndex', 'progressEvent');
      if (o.totalPages !== undefined && o.totalPages !== null) int(o, 'totalPages', 'progressEvent');
      if (o.fraction !== undefined && o.fraction !== null && typeof o.fraction !== 'number')
        throw new ZiloProtocolError('progressEvent.fraction: expected a number or null');
      return o as unknown as ProgressEvent;
    }
    case 'page':
      decodePageMeta(obj(o.page, 'pageEvent.page'), 'pageEvent.page');
      return o as unknown as PageEvent;
    case 'error': {
      if (typeof o.fatal !== 'boolean')
        throw new ZiloProtocolError('errorEvent.fatal: expected a boolean');
      decodeAsyncProblem(obj(o.problem, 'errorEvent.problem'), 'errorEvent.problem');
      return o as unknown as ErrorEvent;
    }
    case 'done': {
      terminalState(str(o, 'state', 'doneEvent'));
      const pageCount = int(o, 'pageCount', 'doneEvent');
      if (pageCount < 0) throw new ZiloProtocolError('doneEvent.pageCount: expected >= 0');
      if (o.error !== undefined) decodeAsyncProblem(obj(o.error, 'doneEvent.error'), 'doneEvent.error');
      return o as unknown as DoneEvent;
    }
  }
}

const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;

/**
 * Runtime guard for `ResolutionList` (R-D4): `kind: list` and a non-empty array of integers >= 1.
 * The generated `ResolutionUnknown` (`kind: string`) overlaps the known kinds, so TypeScript cannot
 * narrow on `kind` alone (triage #6): the payload's shape is checked, never cast.
 */
export function isResolutionList(value: unknown): value is ResolutionList {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown; values?: unknown };
  return (
    v.kind === 'list' &&
    Array.isArray(v.values) &&
    v.values.length > 0 &&
    v.values.every(positiveInt)
  );
}

/** Runtime guard for `ResolutionRange` (R-D4): `kind: range` and integer `min`, `max`, `step` >= 1. */
export function isResolutionRange(value: unknown): value is ResolutionRange {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown; min?: unknown; max?: unknown; step?: unknown };
  return v.kind === 'range' && positiveInt(v.min) && positiveInt(v.max) && positiveInt(v.step);
}

/**
 * What a client may offer for a source's resolution (R-D4). Anything that is not a well-formed
 * known kind (an unknown `kind`, or a value that never went through `decodeCaps`) gets the safe
 * fallback: resolution is unsupported, offer only `defaults.resolution` and omit `resolution`
 * from the scan request, so the agent applies its default (R-J7).
 */
export type ResolutionChoice =
  | { kind: 'list'; values: number[] }
  | { kind: 'range'; min: number; max: number; step: number }
  | { kind: 'unsupported'; wireKind: string; defaultResolution: number };

export function resolutionChoice(source: SourceCaps): ResolutionChoice {
  const res: unknown = source.resolutions;
  if (isResolutionList(res)) return { kind: 'list', values: [...res.values] };
  if (isResolutionRange(res)) return { kind: 'range', min: res.min, max: res.max, step: res.step };
  const wire = (res as { kind?: unknown } | null | undefined)?.kind;
  return {
    kind: 'unsupported',
    wireKind: typeof wire === 'string' ? wire : '',
    defaultResolution: source.defaults.resolution,
  };
}
