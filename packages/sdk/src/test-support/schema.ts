// A small JSON Schema 2020-12 validator for the keywords api/openapi.yaml uses, so the mock agent
// can check every response it sends against the contract without adding a dependency (T13: no new
// dependencies). Unsupported keywords throw, so a contract change cannot be skipped silently.
import spec from '../generated/openapi.json' with { type: 'json' };

type Schema = boolean | Record<string, unknown>;

const IGNORED = new Set([
  'description',
  'title',
  'examples',
  'example',
  'format',
  'discriminator',
  'deprecated',
  'readOnly',
  'writeOnly',
  'default',
]);
const SUPPORTED = new Set([
  '$ref',
  'type',
  'const',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
]);

export const openapi = spec as unknown as Record<string, unknown>;

function resolveRef(ref: string): Schema {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let node: unknown = openapi;
  for (const part of ref.slice(2).split('/')) {
    node = (node as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`dangling $ref ${ref}`);
  }
  return node as Schema;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

/** Returns a list of error paths; empty means valid. */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${path}: forbidden`];
  const errors: string[] = [];
  const s = schema;
  for (const key of Object.keys(s)) {
    if (!SUPPORTED.has(key) && !IGNORED.has(key) && !key.startsWith('x-')) {
      throw new Error(`schema keyword not supported by the test validator: ${key}`);
    }
  }
  if (typeof s.$ref === 'string') errors.push(...validate(resolveRef(s.$ref), value, path));
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => typeMatches(value, t))) return [...errors, `${path}: expected ${types.join('|')}`];
  }
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(value)) errors.push(`${path}: const`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: enum`);
  }
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && [...value].length < s.minLength) errors.push(`${path}: minLength`);
    if (typeof s.maxLength === 'number' && [...value].length > s.maxLength) errors.push(`${path}: maxLength`);
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(value)) errors.push(`${path}: pattern`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${path}: minimum`);
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${path}: maximum`);
    if (typeof s.exclusiveMinimum === 'number' && value <= s.exclusiveMinimum) errors.push(`${path}: exclusiveMinimum`);
    if (typeof s.multipleOf === 'number' && value % s.multipleOf !== 0) errors.push(`${path}: multipleOf`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) errors.push(`${path}: minItems`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(`${path}: maxItems`);
    if (s.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      errors.push(`${path}: uniqueItems`);
    }
    if (s.items !== undefined) {
      value.forEach((item, i) => errors.push(...validate(s.items as Schema, item, `${path}[${String(i)}]`)));
    }
  }
  if (typeOf(value) === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const r of s.required as string[]) if (!(r in o)) errors.push(`${path}.${r}: required`);
    }
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const [k, v] of Object.entries(o)) {
      if (k in props) errors.push(...validate(props[k] as Schema, v, `${path}.${k}`));
      else if (s.additionalProperties !== undefined) {
        errors.push(...validate(s.additionalProperties as Schema, v, `${path}.${k}`));
      }
    }
  }
  if (Array.isArray(s.allOf)) for (const sub of s.allOf as Schema[]) errors.push(...validate(sub, value, path));
  if (Array.isArray(s.anyOf) && !(s.anyOf as Schema[]).some((sub) => validate(sub, value, path).length === 0)) {
    errors.push(`${path}: anyOf`);
  }
  if (Array.isArray(s.oneOf)) {
    const matches = (s.oneOf as Schema[]).filter((sub) => validate(sub, value, path).length === 0).length;
    if (matches !== 1) errors.push(`${path}: oneOf matched ${String(matches)}`);
  }
  if (s.not !== undefined && validate(s.not as Schema, value, path).length === 0) errors.push(`${path}: not`);
  if (s.if !== undefined) {
    const branch = validate(s.if as Schema, value, path).length === 0 ? s.then : s.else;
    if (branch !== undefined) errors.push(...validate(branch as Schema, value, path));
  }
  return errors;
}

/** A component schema by name. */
export function schema(name: string): Schema {
  return resolveRef(`#/components/schemas/${name}`);
}

type Operation = { operationId: string; responses: Record<string, unknown> };

/** Every operation in the spec, keyed by operationId, with its path template and method. */
export function operations(): Map<string, { path: string; method: string; op: Operation }> {
  const out = new Map<string, { path: string; method: string; op: Operation }>();
  const paths = openapi.paths as Record<string, Record<string, unknown>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (method === 'parameters') continue;
      const operation = op as Operation;
      out.set(operation.operationId, { path, method: method.toUpperCase(), op: operation });
    }
  }
  return out;
}

/**
 * The JSON schema the spec declares for an operation's response with this status (falling back to
 * `default`), or `undefined` when the response has no body.
 */
export function responseSchema(operationId: string, status: number): Schema | undefined {
  const entry = operations().get(operationId);
  if (entry === undefined) throw new Error(`unknown operation ${operationId}`);
  let response = (entry.op.responses[String(status)] ?? entry.op.responses.default) as Record<string, unknown> | undefined;
  if (response === undefined) throw new Error(`${operationId} declares no ${String(status)} response`);
  if (typeof response.$ref === 'string') response = resolveRef(response.$ref) as Record<string, unknown>;
  const content = response.content as Record<string, { schema: Schema }> | undefined;
  if (content === undefined) return undefined;
  const media = content['application/json'] ?? content['application/problem+json'];
  if (media === undefined) throw new Error(`${operationId} ${String(status)}: no JSON media type`);
  return media.schema;
}

/** Throws when `body` does not match the declared response of `operationId` for `status`. */
export function assertResponse(operationId: string, status: number, body: unknown): void {
  const s = responseSchema(operationId, status);
  if (s === undefined) {
    if (body !== undefined) throw new Error(`${operationId} ${String(status)}: the spec declares no body`);
    return;
  }
  const errors = validate(s, body);
  if (errors.length > 0) {
    throw new Error(`${operationId} ${String(status)} violates the contract: ${errors.slice(0, 5).join('; ')}`);
  }
}
