// Independent T10 r2 regression against 04bc0d8094c94a0b37fe316163b54909bb689f6a.
// Deliberately red: R-V4 names only Hello.scope and known JobEvent.type as closed
// response discriminators, but ResolutionCaps rejects an unknown kind as well.
// This exercises the real response schema, not an agent/SDK or a rule model.
// T10_TEST_DEPS=<scratch dependency directory> node --test api/tests/t10-r2-schema.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

assert.ok(process.env.T10_TEST_DEPS, 'Set T10_TEST_DEPS to the scratch dependency directory');
const require = createRequire(resolve(process.env.T10_TEST_DEPS, 'package.json'));
const { parse } = require('yaml');
const Ajv = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const spec = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
const defs = JSON.parse(JSON.stringify(spec.components.schemas)
  .replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile({ $defs: defs, $ref: '#/$defs/SourceCaps' });
const caps = (resolutions) => ({
  source: 'feeder', resolutions, colorModes: ['color'],
  pageSizes: [{ id: 'a4', widthMm: 210, heightMm: 297 }],
  maxAreaMm: { widthMm: 216, heightMm: 356 }, customPageSize: false,
  defaults: { resolution: 300, colorMode: 'color', pageSize: 'a4' },
});

test('r2 control: known list and range resolution responses validate', () => {
  assert.equal(validate(caps({ kind: 'list', values: [300] })), true);
  assert.equal(validate(caps({ kind: 'range', min: 150, max: 600, step: 150 })), true);
});

test('r2 control: a malformed known resolution response remains invalid', () => {
  assert.equal(validate(caps({ kind: 'list', values: [] })), false);
  assert.equal(validate(caps({ kind: 'range', min: 150, max: 600 })), false);
});

test('r2 R-V4: unknown response ResolutionCaps.kind survives decoding', () => {
  // Keep the known payload shape; only the response discriminator value is new.
  // The client may treat this capability as opaque/unsupported, not reject the
  // complete device-caps response before it can apply that fallback.
  assert.equal(validate(caps({ kind: 'future-list', values: [300] })), true,
    'R-V4 promises open response values except Hello.scope and known JobEvent.type');
});
