/// <reference types="node" />
// The generated artefacts match api/openapi.yaml, the test validator enforces the contract, and the
// SDK's error table covers exactly the frozen wire code list.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBLEM_CODES } from './errors.js';
import { SPEC_SHA256 } from './generated/spec-hash.js';
import { fixtures } from './test-support/mock-agent.js';
import { operations, schema, validate } from './test-support/schema.js';
import pkg from '../package.json' with { type: 'json' };
import { version } from './index.js';

describe('generated contract artefacts', () => {
  it('were generated from the current api/openapi.yaml (run scripts/gen-types.sh)', () => {
    const yaml = readFileSync(new URL('../../../api/openapi.yaml', import.meta.url));
    expect(createHash('sha256').update(yaml).digest('hex')).toBe(SPEC_SHA256);
  });

  it('exports a version that matches package.json', () => {
    expect(version).toBe(pkg.version);
  });
});

describe('test validator', () => {
  it('enforces the pre-auth disclosure boundary (HelloPublic forbids full-only fields)', () => {
    const pub = {
      product: 'zilo',
      scope: 'public',
      protocol: { min: '1.0', max: '1.0' },
      capabilities: [],
    };
    expect(validate(schema('Hello'), pub)).toEqual([]);
    expect(validate(schema('Hello'), { ...pub, instanceId: 'x' })).not.toEqual([]);
    expect(validate(schema('Hello'), { ...pub, unknownField: 1 })).toEqual([]);
  });

  it('keeps ResolutionCaps open for unknown kinds but strict for list and range', () => {
    const rc = schema('ResolutionCaps');
    expect(validate(rc, { kind: 'stepped-set', anything: [1] })).toEqual([]);
    expect(validate(rc, { kind: 'list', values: [] })).not.toEqual([]);
    expect(validate(rc, { kind: 'range', min: 1 })).not.toEqual([]);
  });

  it('accepts the contract fixtures, unknown fields and enum values included', () => {
    expect(validate(schema('Device'), fixtures.futureDevice)).toEqual([]);
    expect(validate(schema('DeviceCaps'), fixtures.virtualCaps)).toEqual([]);
    expect(validate(schema('DeviceCaps'), fixtures.futureCaps)).toEqual([]);
  });

  it('enforces state-dependent ConsentStatus fields (R-A2)', () => {
    const cs = schema('ConsentStatus');
    expect(validate(cs, { origin: 'https://a.test', state: 'pending' })).not.toEqual([]);
    expect(validate(cs, { origin: 'https://a.test', state: 'future-state' })).toEqual([]);
  });

  it('knows every operation the SDK calls', () => {
    const ops = operations();
    for (const id of [
      'getHello',
      'getConsent',
      'requestConsent',
      'issueToken',
      'renewToken',
      'revokeToken',
      'listDevices',
      'refreshDevices',
      'getDeviceCaps',
      'createJob',
      'getJob',
      'disposeJob',
    ]) {
      expect(ops.has(id), id).toBe(true);
    }
  });
});

describe('problem code table', () => {
  it('covers exactly ErrorCodeKnown (§9 list is frozen)', () => {
    const known = (schema('ErrorCodeKnown') as { enum: string[] }).enum;
    expect(Object.keys(PROBLEM_CODES).sort()).toEqual([...known].sort());
  });
});
