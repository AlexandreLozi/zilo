// Protocol and version compatibility (CONTRACT.md R-V2, R-V3; D-008 steps 3 and 4).
import type { HelloFull, HelloPublic } from './types.js';

/** The protocol range this SDK speaks, `major.minor` (R-V2). */
export const SDK_PROTOCOL = { min: '1.0', max: '1.0' } as const;

/** Public capability flags the SDK needs before authorisation (§1.3). */
export const REQUIRED_PUBLIC_CAPABILITIES = [
  'auth.consent',
  'auth.token',
  'transport.http',
] as const;

function parse(mm: string): [number, number] {
  const [major = 'NaN', minor = 'NaN'] = mm.split('.');
  return [Number(major), Number(minor)];
}

function cmp(a: string, b: string): number {
  const [aM, am] = parse(a);
  const [bM, bm] = parse(b);
  return aM !== bM ? aM - bM : am - bm;
}

export type Fit =
  | { fits: true }
  | {
      fits: false;
      reason: 'agent-too-old' | 'sdk-too-old' | 'missing-capabilities';
      missing?: string[];
    };

/**
 * Pre-auth fit from the public `hello` only (no version is visible before authorisation,
 * D-004a): the ranges overlap and the required public capabilities are present.
 */
export function publicFit(hello: HelloPublic | HelloFull): Fit {
  if (cmp(hello.protocol.max, SDK_PROTOCOL.min) < 0)
    return { fits: false, reason: 'agent-too-old' };
  if (cmp(hello.protocol.min, SDK_PROTOCOL.max) > 0) return { fits: false, reason: 'sdk-too-old' };
  const missing = REQUIRED_PUBLIC_CAPABILITIES.filter((c) => !hello.capabilities.includes(c));
  if (missing.length > 0) return { fits: false, reason: 'missing-capabilities', missing };
  return { fits: true };
}

/** SemVer precedence, enough for "installed below the site's minimum" (D-008 step 4). */
export function compareSemver(a: string, b: string): number {
  const split = (v: string): { core: number[]; pre: string[] } => {
    const [main = '', pre] = v.split('+')[0]?.split(/-(.*)/s) ?? [''];
    return {
      core: main.split('.').map(Number),
      pre: pre === undefined || pre === '' ? [] : pre.split('.'),
    };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}
