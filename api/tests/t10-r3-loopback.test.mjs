// Reviewer regression for r2-5's remaining root-qualified localhost case.
// Exercises the AUTHOR'S policy model, not an agent, browser, or SDK runtime.
// Import just its existing standalone model helpers without registering its tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const author = readFileSync(new URL('./t10-fix-r2.test.mjs', import.meta.url), 'utf8');
const start = author.indexOf('function hextets(');
const end = author.indexOf("test('r2-5 rule model:", start);
assert.ok(start >= 0 && end > start, 'locate the existing standalone author policy model');
const policy = vm.runInNewContext(`(() => {
${author.slice(start, end)}
return { classify, preAuth, loadBaked };
})()`, { URL });

test('r3 control: existing localhost and normalized IP loopback cases stay blocked', () => {
  for (const origin of ['https://localhost', 'https://app.localhost', 'https://127.1', 'https://[::1]']) {
    assert.equal(policy.classify(origin).cls, 'ineligible', origin);
    assert.equal(policy.classify(origin, { dev: true }).cls, 'dev-eligible', origin);
  }
  assert.equal(policy.classify('https://localhost.example.com').cls, 'eligible');
});

test('r3 root-qualified localhost is excluded from ordinary HTTPS eligibility', () => {
  for (const origin of ['https://localhost.', 'https://app.localhost.']) {
    // URL origin serialization retains the final DNS root dot; it does not fix the policy.
    assert.ok(new URL(origin).hostname.endsWith('.'));
    assert.equal(policy.classify(origin).cls, 'ineligible', origin);
  }
});

test('r3 root-qualified localhost is diagnostics-only in dev and rejected from baked origins', () => {
  for (const origin of ['https://localhost.', 'https://app.localhost.']) {
    assert.equal(policy.classify(origin, { dev: true }).cls, 'dev-eligible', origin);
    assert.equal(policy.loadBaked([origin]).size, 0, origin);
    assert.equal(policy.preAuth(policy.classify(origin)).corsOnPostConsent, false, origin);
  }
});
