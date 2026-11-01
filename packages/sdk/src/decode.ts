// Tolerant decoders (CONTRACT.md R-V4): they check the fields the SDK relies on and keep every
// other field, including unknown fields and unknown values of open enums, untouched. A decode
// failure is a `ZiloProtocolError` that names fields, never values.
import { ZiloProtocolError } from './errors.js';
import type {
  ConsentStatus,
  DeviceCaps,
  DeviceList,
  HelloFull,
  HelloPublic,
  Job,
  ResolutionList,
  ResolutionRange,
  SourceCaps,
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
    // `resolutions.kind` is an open discriminator: only the known kinds are checked (R-D4).
    const res = obj(src.resolutions, 'source.resolutions');
    const kind = str(res, 'kind', 'source.resolutions');
    if (kind === 'list') {
      const values = arr(res, 'values', 'source.resolutions');
      if (values.length === 0 || !values.every((v) => Number.isInteger(v) && (v as number) >= 1)) {
        throw new ZiloProtocolError('source.resolutions.values: expected positive integers');
      }
    } else if (kind === 'range') {
      for (const key of ['min', 'max', 'step']) int(res, key, 'source.resolutions');
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

/**
 * What a client may offer for a source's resolution (R-D4). For an unknown `kind`, the safe
 * fallback is to treat resolution as unsupported: offer only `defaults.resolution` and omit
 * `resolution` from the scan request, so the agent applies its default (R-J7).
 */
export type ResolutionChoice =
  | { kind: 'list'; values: number[] }
  | { kind: 'range'; min: number; max: number; step: number }
  | { kind: 'unsupported'; wireKind: string; defaultResolution: number };

export function resolutionChoice(source: SourceCaps): ResolutionChoice {
  const res: { kind: string } = source.resolutions;
  if (res.kind === 'list') return { kind: 'list', values: [...(res as ResolutionList).values] };
  if (res.kind === 'range') {
    const { min, max, step } = res as ResolutionRange;
    return { kind: 'range', min, max, step };
  }
  return { kind: 'unsupported', wireKind: res.kind, defaultResolution: source.defaults.resolution };
}
