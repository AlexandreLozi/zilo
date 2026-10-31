// Review regressions, intentionally failing against T10 draft 1.
// Dependencies live OUTSIDE the repo:
// npm install --prefix /tmp/opencode/t10-review-deps --ignore-scripts --save-exact \
//   yaml@2.8.1 ajv@8.17.1 ajv-formats@3.0.1
// T10_TEST_DEPS=/tmp/opencode/t10-review-deps node --test api/tests/t10-r1-schema.test.mjs
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
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
// Preserve schema semantics; only relocate local references into a JSON Schema root.
const defs = JSON.parse(JSON.stringify(spec.components.schemas)
  .replaceAll('#/components/schemas/', '#/$defs/'));
function accepts(name, value) {
  const validate = ajv.compile({ $defs: defs, $ref: `#/$defs/${name}` });
  return validate(value);
}

const publicHello = {
  product: 'zilo', scope: 'public', protocol: { min: '1.0', max: '1.0' },
  capabilities: ['auth.consent', 'auth.token', 'transport.http'],
};

test('control: documented public hello is valid', () => {
  assert.equal(accepts('Hello', publicHello), true);
});

test('R-V4: response Driver accepts an unknown future value', () => {
  assert.equal(accepts('Driver', 'future-driver'), true,
    'x-zilo-open-enum must not leave the normative JSON Schema closed');
});

test('R-V2: full hello cannot omit authenticated identity and limits', () => {
  assert.equal(accepts('Hello', { ...publicHello, scope: 'full' }), false,
    'full requires version, os, arch, instanceId and limits');
});

test('R-V2/D-004a: public hello cannot carry full-scope identity', () => {
  assert.equal(accepts('Hello', {
    ...publicHello, version: '1.0.0', os: 'linux', arch: 'x64', instanceId: 'restart-id', limits: {},
  }), false, 'public must exclude the known full-only fields, while tolerating unknown fields');
});

test('R-J6: newly created queued job must report effective settings', () => {
  assert.equal(accepts('Job', {
    id: 'abcdefghijklmnop', deviceId: 'virtual-0', state: 'queued',
    createdAt: '2026-10-31T00:00:00Z', requested: { source: 'flatbed' },
    pageCount: 0, lastSeq: 1,
  }), false, 'R-J6 says effective settings are known at creation');
});
