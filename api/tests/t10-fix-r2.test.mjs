// T10 fix r2: author tests for the 5 residual findings of docs/reviews/T10-r2.md and the two new
// master inputs (agent restart, D-004a clarification). Same two kinds of test as t10-fix-r1:
// - schema tests run the real schemas of api/openapi.yaml through Ajv (JSON Schema 2020-12);
// - "rule model" tests run small executable models of CONTRACT.md rules on their acceptance
//   vectors. They check that a rule is deterministic and self-consistent. They do not test an
//   agent or an SDK; T11 and T13/T21 should reuse the vectors in their conformance tests.
// Dependencies live OUTSIDE the repo (api/tools/check.sh installs them in a scratch dir):
//   T10_TEST_DEPS=<dir with yaml@2.8.1 ajv@8.17.1 ajv-formats@3.0.1> node --test api/tests/
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

const yamlText = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../CONTRACT.md', import.meta.url), 'utf8');
const spec = parse(yamlText);
const schemas = spec.components.schemas;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const defs = JSON.parse(JSON.stringify(schemas).replaceAll('#/components/schemas/', '#/$defs/'));
const compiled = new Map();
function accepts(name, value) {
  if (!compiled.has(name)) compiled.set(name, ajv.compile({ $defs: defs, $ref: `#/$defs/${name}` }));
  return compiled.get(name)(value);
}
const limitsDefaults = Object.fromEntries(Object.entries(schemas.Limits.properties)
  .map(([k, v]) => [k, v['x-zilo-default'] ?? v.const]));

// ------------------------------------------------------------------ r2-1 settled export-and-delete
// R-X7 model. `world` is the agent as the SDK sees it: a job state, its stored pages, and what
// happens while the device stops after a cancel (pages may still arrive).
function sdkExportAndDeleteSettled(world, { stop = false, selection, seenCount } = {}) {
  const actions = [];
  if (world.state === 'queued' || world.state === 'scanning') {
    if (!stop) return { actions, deleted: false, outcome: 'job-active' };
    actions.push({ cancel: { discardPages: false } });
    world.stopDevice(); // pages may be stored until the device has stopped; then done arrives
    actions.push({ awaitDone: world.state });
  }
  assert.ok(['completed', 'failed', 'cancelled'].includes(world.state), 'settled before selecting');
  const settled = [...world.pages];
  const pages = selection ?? settled;
  for (const index of pages) assert.ok(settled.includes(index), 'selection is within the settled set');
  actions.push({ export: { pages, deleteAfterExport: false } });
  const unseen = selection ? settled.filter((i) => i >= seenCount) : [];
  if (unseen.length > 0) return { actions, deleted: false, outcome: 'new-pages', unseen };
  actions.push({ delete: true });
  return { actions, deleted: true, outcome: 'exported-and-deleted' };
}
function scanningFeeder() {
  const world = { state: 'scanning', pages: [0, 1, 2] };
  world.stopDevice = () => { world.pages.push(3); world.state = 'cancelled'; };
  return world;
}
test('r2-1 rule model: export-and-delete waits for a settled acquisition boundary', () => {
  // Default on an active job: refuse, send nothing, delete nothing.
  const refused = sdkExportAndDeleteSettled(scanningFeeder());
  assert.deepEqual(refused, { actions: [], deleted: false, outcome: 'job-active' });
  // With stop: cancel keeping pages, page 3 arrives during the stop, the export covers it.
  const stopped = sdkExportAndDeleteSettled(scanningFeeder(), { stop: true });
  assert.deepEqual(stopped.actions[0], { cancel: { discardPages: false } });
  assert.deepEqual(stopped.actions[1], { awaitDone: 'cancelled' });
  assert.deepEqual(stopped.actions[2].export.pages, [0, 1, 2, 3], 'page 3 is exported, not lost');
  assert.deepEqual(stopped.actions.at(-1), { delete: true });
  // An explicit selection built from pages 0-2 must not delete page 3 silently.
  const partial = sdkExportAndDeleteSettled(scanningFeeder(), { stop: true, selection: [0, 1, 2], seenCount: 3 });
  assert.equal(partial.deleted, false);
  assert.deepEqual(partial.unseen, [3]);
  // An explicit selection built from the settled list is an intentional discard.
  const terminal = { state: 'completed', pages: [0, 1, 2, 3], stopDevice() {} };
  const discard = sdkExportAndDeleteSettled(terminal, { selection: [2, 0], seenCount: 4 });
  assert.equal(discard.deleted, true);
});
test('r2-1 R-X7 is normative and the export operation documents the boundary', () => {
  assert.match(contract, /\*\*R-X7 Settled acquisition boundary for export-and-delete/);
  assert.match(contract, /without\*\* `discardPages` \(pages kept, R-J2\)/);
  const op = spec.paths['/zilo/v1/jobs/{jobId}/export'].post.description;
  assert.match(op, /Settled acquisition boundary/);
  assert.match(op, /always non-destructive/);
  // The wire flag stays terminal-only and receipt-ambiguous.
  assert.match(contract, /It is allowed only on a terminal job; otherwise the call returns `409 invalid-state`\./);
});

// ------------------------------------------------------------------ r2-2 physical reservations
// R-L5 model: logical quotas are released at revocation; physical bytes and workers only when
// actually freed.
function agentStore({ maxStoreBytes, maxConcurrentExportsTotal, cleanupSeconds }) {
  const live = new Map(); // family -> bytes
  const pending = { bytes: 0, workers: 0, deadline: null };
  const workers = new Map(); // family -> running workers
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const onDisk = () => sum(live) + pending.bytes;
  const running = () => sum(workers) + pending.workers;
  const refuse = (name, now, curable) => (curable
    ? { status: 429, code: 'limits-exceeded', limit: name, retryable: true, retryAfter: pending.deadline - now }
    : { status: name === 'maxStoreBytes' ? 413 : 429, code: 'limits-exceeded', limit: name });
  return {
    onDisk, running,
    store(family, bytes, now) {
      if (onDisk() + bytes > maxStoreBytes) {
        return refuse('maxStoreBytes', now, sum(live) + bytes <= maxStoreBytes && pending.bytes > 0);
      }
      live.set(family, (live.get(family) ?? 0) + bytes);
      return { status: 201 };
    },
    startExport(family, now) {
      if (running() >= maxConcurrentExportsTotal) {
        return refuse('maxConcurrentExportsTotal', now, pending.workers > 0);
      }
      workers.set(family, (workers.get(family) ?? 0) + 1);
      return { status: 200 };
    },
    revoke(family, now) {
      // Immediate logical denial; physical resources move to pending, still counted.
      pending.bytes += live.get(family) ?? 0;
      pending.workers += workers.get(family) ?? 0;
      pending.deadline = now + cleanupSeconds;
      live.delete(family);
      workers.delete(family);
      return { denial: 'token-revoked', streamsClosed: true };
    },
    cleanup() { pending.bytes = 0; pending.workers = 0; pending.deadline = null; },
  };
}
test('r2-2 rule model: revoke and refill before cleanup never exceeds the physical bound', () => {
  const GiB = 2 ** 30;
  const a = agentStore({ maxStoreBytes: 8 * GiB, maxConcurrentExportsTotal: 4, cleanupSeconds: 60 });
  for (let i = 0; i < 8; i++) assert.equal(a.store('F1', GiB, 0).status, 201);
  for (let i = 0; i < 4; i++) assert.equal(a.startExport('F1', 0).status, 200);
  assert.deepEqual(a.revoke('F1', 10), { denial: 'token-revoked', streamsClosed: true });
  // F2 is refused, retryably, until cleanup; the backlog stays inside the bound.
  const job = a.store('F2', GiB, 15);
  assert.deepEqual(job, { status: 429, code: 'limits-exceeded', limit: 'maxStoreBytes', retryable: true, retryAfter: 55 });
  assert.ok(job.retryAfter <= limitsDefaults.revocationCleanupSeconds);
  const exp = a.startExport('F2', 15);
  assert.equal(exp.status, 429);
  assert.equal(exp.limit, 'maxConcurrentExportsTotal');
  assert.equal(exp.retryable, true);
  assert.ok(a.onDisk() <= 8 * GiB && a.running() <= 4);
  a.cleanup();
  for (let i = 0; i < 8; i++) assert.equal(a.store('F2', GiB, 70).status, 201);
  assert.equal(a.onDisk(), 8 * GiB, 'refill only after the physical release');
  // A refusal the cleanup cannot cure keeps its R-L1 status.
  assert.equal(a.store('F3', GiB, 80).status, 413);
});
test('r2-2 R-L5 separates logical quotas from physical reservations', () => {
  assert.match(contract, /\*\*R-L5 Logical quotas versus physical reservations\.\*\*/);
  assert.doesNotMatch(contract, /Revoked jobs count against no quota from the moment of revocation/);
  assert.match(contract, /revoked jobs leave every logical quota/);
  assert.match(schemas.Limits.properties.maxStoreBytes.description, /physical reservation/i);
  assert.match(schemas.Limits.properties.maxConcurrentExportsTotal.description, /physical reservation/i);
  assert.match(spec.paths['/zilo/v1/auth/token'].delete.description, /global physical\s+reservations/);
});

// ------------------------------------------------------------------ r2-3 family-indexed credentials
// Agent model of R-A8/R-A11 plus the SDK storage of R-A15 (map + current pointer).
function agentAuth({ ttl = 3600 } = {}) {
  const families = new Map(); // id -> { expiresAt (family), tokens: Map(token -> {expiresAt, renewAfter, successor}) }
  const jobs = new Map(); // jobId -> familyId
  let n = 0;
  const mint = (fid, now) => {
    const f = families.get(fid);
    const expiresAt = Math.min(now + ttl, f.expiresAt);
    const t = { token: `t${++n}`, familyId: fid, expiresAt, renewAfter: now + Math.floor((3 * (expiresAt - now)) / 4), familyExpiresAt: f.expiresAt };
    f.tokens.set(t.token, { ...t, successor: null });
    return t;
  };
  const valid = (token, now) => {
    for (const [fid, f] of families) {
      const t = f.tokens.get(token);
      if (t && now < t.expiresAt && now < f.expiresAt) return fid;
    }
    return null;
  };
  return {
    issued: () => n,
    issue(now, familyLifetime) {
      const fid = `F${families.size + 1}`;
      families.set(fid, { expiresAt: now + familyLifetime, tokens: new Map() });
      return mint(fid, now);
    },
    renew(token, now) {
      const fid = valid(token, now);
      if (!fid) return { status: 401, code: 'token-invalid' };
      const t = families.get(fid).tokens.get(token);
      if (t.successor) return { status: 409, code: 'invalid-state' };
      if (now < t.renewAfter) return { status: 429, code: 'rate-limited' };
      if (t.expiresAt >= t.familyExpiresAt) return { status: 409, code: 'invalid-state' };
      const s = mint(fid, now);
      t.successor = s.token;
      return { status: 200, token: s };
    },
    createJob(token, now, jobId) {
      const fid = valid(token, now);
      if (!fid) return { status: 401, code: 'token-invalid' };
      jobs.set(jobId, fid);
      return { status: 201 };
    },
    getJob(token, now, jobId) {
      const fid = valid(token, now);
      if (!fid) return { status: 401, code: 'token-invalid' };
      return jobs.get(jobId) === fid ? { status: 200 } : { status: 404, code: 'not-found' };
    },
  };
}
// Shared same-origin storage and the SDK operations, all under the cross-tab exclusion.
function sdkStorage(maxEntries) {
  return { map: new Map(), current: null, jobFamily: new Map(), maxEntries };
}
const isFinal = (e) => e.expiresAt >= e.familyExpiresAt;
function currentForNewScan(store, agent, now, familyLifetime) {
  const cur = store.current && store.map.get(store.current);
  const usable = cur && now < cur.expiresAt;
  if (usable && !isFinal(cur)) return cur;
  // Rollover rule: no usable current entry, or a final token before a new scan.
  assert.ok(store.map.size < store.maxEntries, 'map stays bounded');
  const t = agent.issue(now, familyLifetime);
  store.map.set(t.familyId, t); // never replaces another family's entry
  store.current = t.familyId;
  return t;
}
function credentialForJob(store, jobId) {
  return store.map.get(store.jobFamily.get(jobId));
}
test('r2-3 rule model: two tabs, a live old job, the final token, a 409 and a new scan', () => {
  const agent = agentAuth();
  const store = sdkStorage(limitsDefaults.maxFamiliesPerOrigin);
  // F1 has 30 minutes left; its current token is final.
  const f1 = agent.issue(0, 1800);
  store.map.set(f1.familyId, f1);
  store.current = f1.familyId;
  assert.ok(isFinal(f1));
  assert.equal(agent.createJob(f1.token, 0, 'J1').status, 201);
  store.jobFamily.set('J1', 'F1');
  // Tab B starts a new scan: the final token triggers a rollover to F2; F1 stays in the map.
  const f2 = currentForNewScan(store, agent, 10, 86400);
  assert.equal(f2.familyId, 'F2');
  assert.equal(store.current, 'F2');
  assert.ok(store.map.has('F1'), 'the old family credential is kept');
  assert.equal(agent.createJob(f2.token, 10, 'J2').status, 201);
  store.jobFamily.set('J2', 'F2');
  // Tab A renews F1 at renewAfter: 409, because the token is final. It keeps using it for J1.
  assert.deepEqual(agent.renew(f1.token, f1.renewAfter), { status: 409, code: 'invalid-state' });
  assert.ok(isFinal(store.map.get('F1')), 'the SDK tells the deadline 409 from its own record');
  // J1 stays reachable after the final token's renewAfter, until the family deadline.
  assert.equal(agent.getJob(credentialForJob(store, 'J1').token, 1700, 'J1').status, 200);
  // The current family's token would get 404 for J1: per-job family selection is required.
  assert.deepEqual(agent.getJob(store.map.get(store.current).token, 1700, 'J1'), { status: 404, code: 'not-found' });
  // Tab A's next new scan uses F2 from the pointer: no third family.
  assert.equal(currentForNewScan(store, agent, 1400, 86400).familyId, 'F2');
  assert.equal(agent.issued(), 2);
  // After F1's deadline its entry is unusable and removed; the map stays bounded.
  assert.equal(agent.getJob(credentialForJob(store, 'J1').token, 1801, 'J1').status, 401);
  store.map.delete('F1');
  assert.ok(store.map.size <= store.maxEntries);
});
test('r2-3 rule model: no early rollover while the current token is renewable', () => {
  const agent = agentAuth();
  const store = sdkStorage(limitsDefaults.maxFamiliesPerOrigin);
  const f1 = agent.issue(0, 86400);
  store.map.set(f1.familyId, f1);
  store.current = f1.familyId;
  assert.equal(isFinal(f1), false);
  assert.equal(currentForNewScan(store, agent, 100, 86400).familyId, 'F1');
  assert.equal(agent.issued(), 1);
  const r = agent.renew(f1.token, f1.renewAfter);
  assert.equal(r.status, 200);
  assert.equal(r.token.familyId, 'F1', 'renewal keeps the family and never moves the pointer');
});
test('r2-3 R-A9, R-A11, R-A15 and the YAML state one rollover policy', () => {
  assert.doesNotMatch(contract, /The SDK starts a new family only when storage holds no usable token of a live family/);
  assert.doesNotMatch(contract, /The SDK keeps one record per origin/);
  assert.match(contract, /\*\*Family-indexed credentials\.\*\*/);
  assert.match(contract, /\*\*current-family pointer\*\*/);
  assert.match(contract, /\*\*Rollover rule \(deterministic\)\.\*\*/);
  assert.match(contract, /\*\*Per-job family selection\.\*\*/);
  const renew = spec.paths['/zilo/v1/auth/token/renew'].post.description;
  assert.match(renew, /keeps the old family's\s+credential under its family ID/);
  assert.match(spec.paths['/zilo/v1/auth/token'].post.description, /rollover rule/);
});

// ------------------------------------------------------------------ r2-4 open ResolutionCaps
const sourceCaps = (resolutions) => ({
  source: 'feeder', resolutions, colorModes: ['color'],
  pageSizes: [{ id: 'a4', widthMm: 210, heightMm: 297 }],
  maxAreaMm: { widthMm: 216, heightMm: 356 }, customPageSize: false,
  defaults: { resolution: 300, colorMode: 'color', pageSize: 'a4' },
});
test('r2-4 an unknown resolution kind keeps the whole caps response decodable', () => {
  const caps = { deviceId: 'virtual-0', sources: [sourceCaps({ kind: 'stepped-set', anything: [1] })] };
  assert.equal(accepts('DeviceCaps', caps), true);
  assert.equal(accepts('ResolutionCaps', { kind: 'future' }), true);
  assert.equal(accepts('ResolutionCaps', {}), false, 'kind stays required');
  assert.equal(accepts('ResolutionCaps', { kind: '' }), false);
  assert.equal(accepts('ResolutionCaps', { kind: 'list', values: [] }), false, 'known kinds stay strict');
  assert.equal(accepts('ResolutionCaps', { kind: 'range', min: 1, max: 2 }), false);
  assert.equal(accepts('ResolutionCaps', { kind: 'list', values: [150, 300] }), true);
});
test('r2-4 exactly two closed response discriminators remain', () => {
  const discriminated = Object.entries(schemas).filter(([, s]) => s.discriminator).map(([n]) => n).sort();
  assert.deepEqual(discriminated, ['Hello', 'JobEvent']);
  assert.match(contract, /\*\*Exactly two\*\* response discriminators are \*\*closed\*\*/);
  assert.match(spec.info.description, /Exactly two response discriminators are deliberately closed/);
});
// Safe client fallback (R-D4).
function resolutionOffer(caps) {
  const r = caps.resolutions;
  if (r.kind === 'list') return { values: r.values, sendResolution: true };
  if (r.kind === 'range') {
    const values = [];
    for (let v = r.min; v <= r.max; v += r.step) values.push(v);
    return { values, sendResolution: true };
  }
  return { values: [caps.defaults.resolution], sendResolution: false, unsupported: true };
}
test('r2-4 rule model: unknown kind falls back to the default resolution, omitted from the request', () => {
  assert.deepEqual(resolutionOffer(sourceCaps({ kind: 'range', min: 150, max: 600, step: 150 })).values, [150, 300, 450, 600]);
  const fb = resolutionOffer(sourceCaps({ kind: 'future-list', values: [1200] }));
  assert.deepEqual(fb, { values: [300], sendResolution: false, unsupported: true });
  assert.equal(accepts('ScanSettings', { source: 'feeder' }), true, 'a request without resolution is valid');
});

// ------------------------------------------------------------------ r2-5 loopback eligibility
function hextets(addr) {
  const [head, tail = ''] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = addr.includes('::') ? (tail ? tail.split(':') : []) : [];
  const fill = addr.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}
// Fix r3, R-T3 host normalisation, for classification only. A domain host may end in ONE root
// dot, removed here; any other empty label is malformed (null). IP literals are already canonical.
function classHost(host) {
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const name = host.endsWith('.') ? host.slice(0, -1) : host;
  return name.split('.').includes('') ? null : name;
}
function isLoopbackHost(raw) {
  const host = classHost(raw);
  if (host === null) return false; // malformed: the callers reject it before this matters
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return Number(v4[1]) === 127 || host === '0.0.0.0';
  if (host.startsWith('[')) {
    const x = hextets(host.slice(1, -1));
    const zero5 = x.slice(0, 5).every((v) => v === 0);
    if (zero5 && x[5] === 0 && x[6] === 0 && (x[7] === 1 || x[7] === 0)) return true; // ::1, ::
    if (zero5 && x[5] === 0xffff) return (x[6] >> 8) === 0x7f || (x[6] === 0 && x[7] === 0);
  }
  return false;
}
function classify(origin, { dev = false, consented = new Set(), baked = new Set() } = {}) {
  if (origin === undefined) return { cls: 'absent' };
  let url;
  try { url = new URL(origin); } catch { return { cls: 'ineligible' }; }
  if (origin === 'null' || url.origin === 'null') return { cls: 'ineligible' };
  const serial = url.origin;
  const scheme = url.protocol.slice(0, -1);
  if (classHost(url.hostname) === null) return { cls: 'ineligible', serial }; // empty label
  if (isLoopbackHost(url.hostname)) {
    return { cls: dev && (scheme === 'http' || scheme === 'https') ? 'dev-eligible' : 'ineligible', serial };
  }
  if (scheme !== 'https') return { cls: 'ineligible', serial };
  if (consented.has(serial) || baked.has(serial)) return { cls: 'allowed', serial };
  return { cls: 'eligible', serial };
}
const loadBaked = (list) => new Set(list.map((o) => new URL(o)).filter((u) =>
  classHost(u.hostname) !== null && !isLoopbackHost(u.hostname)).map((u) => u.origin));
function preAuth(c) {
  return {
    corsOnGetHello: ['eligible', 'allowed', 'dev-eligible'].includes(c.cls),
    corsOnPostConsent: ['eligible', 'allowed'].includes(c.cls),
    canPrompt: c.cls === 'eligible',
    canMintToken: c.cls === 'allowed',
  };
}
test('r2-5 rule model: ordinary HTTPS eligibility excludes loopback; dev gives diagnostics only', () => {
  const loopbacks = [
    'http://localhost:3000', 'https://localhost:8443', 'https://LOCALHOST:8443', 'https://app.localhost',
    'http://127.0.0.1:5173', 'https://127.0.0.1:8443', 'https://127.1.2.3', 'https://[::1]:8443',
    'http://[::1]', 'https://[::ffff:127.0.0.1]:8443', 'https://0.0.0.0:8443',
  ];
  for (const o of loopbacks) {
    const off = classify(o);
    assert.equal(off.cls, 'ineligible', `${o} dev off`);
    assert.deepEqual(preAuth(off), { corsOnGetHello: false, corsOnPostConsent: false, canPrompt: false, canMintToken: false }, o);
    const on = classify(o, { dev: true });
    assert.equal(on.cls, 'dev-eligible', `${o} dev on`);
    assert.deepEqual(preAuth(on), { corsOnGetHello: true, corsOnPostConsent: false, canPrompt: false, canMintToken: false }, o);
  }
  // Baked configuration cannot make a loopback origin allowed.
  const baked = loadBaked(['https://localhost:8443', 'https://[::1]', 'https://app.example.com']);
  assert.deepEqual([...baked], ['https://app.example.com']);
  assert.equal(classify('https://localhost:8443', { baked, dev: true }).cls, 'dev-eligible');
  assert.equal(classify('https://localhost:8443', { baked, consented: new Set(['https://localhost:8443']) }).cls, 'ineligible');
  // Non-loopback HTTPS stays eligible; exact serialised comparison afterwards.
  assert.equal(classify('https://app.example.com:443', { baked }).cls, 'allowed');
  assert.equal(classify('https://App.Example.com', { baked }).serial, 'https://app.example.com');
  assert.equal(classify('https://app.example.com:8443', { baked }).cls, 'eligible');
  assert.equal(classify('https://localhost.example.com').cls, 'eligible', 'only the .localhost suffix is loopback');
  assert.equal(classify('http://app.example.com').cls, 'ineligible');
  assert.equal(classify('null').cls, 'ineligible');
});
test('r2-5 R-T3 classifies loopback for every scheme and rejects baked loopback entries', () => {
  assert.match(contract, /\*\*Loopback host classification\.\*\*/);
  assert.match(contract, /for \*\*every scheme\*\*: `https:\/\/localhost:8443`/);
  assert.match(contract, /A well-formed `https:\/\/host\[:port\]` origin whose host is \*\*not loopback\*\*/);
  assert.match(contract, /\*\*Installer-baked loopback origins\*\* are rejected/);
  assert.match(spec.components.parameters.Origin.description, /loopback get no CORS headers/);
});
test('r3 rule model: one root dot is removed for classification only; other empty labels reject', () => {
  const closed = { corsOnGetHello: false, corsOnPostConsent: false, canPrompt: false, canMintToken: false };
  for (const o of ['https://localhost.', 'https://LOCALHOST.:8443', 'https://app.localhost.', 'http://localhost.:3000']) {
    const off = classify(o);
    assert.equal(off.cls, 'ineligible', `${o} dev off`);
    assert.deepEqual(preAuth(off), closed, o);
    const on = classify(o, { dev: true, consented: new Set([new URL(o).origin]) });
    assert.equal(on.cls, 'dev-eligible', `${o} dev on, even if consented`);
    assert.equal(on.serial, new URL(o).origin, `${o} serial keeps its root dot`);
    assert.equal(preAuth(on).corsOnPostConsent, false, o);
  }
  // Baked root-qualified loopback entries are rejected at load, like their dotless forms.
  assert.deepEqual([...loadBaked(['https://localhost.', 'https://app.localhost.:8443', 'https://app.example.com.'])],
    ['https://app.example.com.']);
  // Empty labels other than one terminal root dot are malformed: ineligible, dev or not, and never baked.
  for (const o of ['https://localhost..', 'https://app.localhost..', 'https://.localhost', 'https://app..localhost',
    'https://.', 'https://127.0.0.1..', 'https://app.example.com..', 'https://.app.example.com']) {
    assert.equal(classify(o).cls, 'ineligible', `${o} dev off`);
    assert.equal(classify(o, { dev: true }).cls, 'ineligible', `${o} dev on`);
    assert.equal(loadBaked([o]).size, 0, `${o} baked`);
  }
  // Non-loopback controls; exact serialised comparison keeps the dot (no normalisation there).
  assert.equal(classify('https://localhost.example.com').cls, 'eligible');
  assert.equal(classify('https://localhost.example.com.').cls, 'eligible');
  const baked = loadBaked(['https://app.example.com']);
  assert.equal(classify('https://app.example.com', { baked }).cls, 'allowed');
  assert.equal(classify('https://app.example.com.', { baked }).cls, 'eligible', 'root-qualified is a distinct origin');
  assert.equal(classify('https://app.example.com.', { consented: new Set(['https://app.example.com.']) }).cls, 'allowed');
  assert.equal(classify('https://127.0.0.1.').serial, 'https://127.0.0.1', 'URL canonicalises the IPv4 root dot');
});
test('r3 R-T3 states the root-dot normalisation and the empty-label rejection', () => {
  assert.match(contract, /\*\*Host normalisation for classification\.\*\*/);
  assert.match(contract, /`localhost\.` and `app\.localhost\.` are loopback/);
  assert.match(contract, /any other empty label[\s\S]{0,160}?is\s\*\*malformed\*\*/);
  assert.match(contract, /used \*\*only\*\* for this classification/);
  assert.match(contract, /\n## Fix r3\n[\s\S]*\| r3-1 \|/);
});

// ------------------------------------------------------------------ N1 agent restart
test('N1 instanceId is authenticated-only, and agent-restarted is never a wire code or event', () => {
  assert.ok(schemas.HelloFull.required.includes('instanceId'));
  assert.equal(schemas.HelloPublic.properties.instanceId, false);
  assert.equal(schemas.ErrorCodeKnown.enum.includes('agent-restarted'), false);
  assert.equal(schemas.EventTypeKnown.enum.includes('agent-restarted'), false);
  assert.match(schemas.HelloFull.properties.instanceId.description, /SDK-local/);
  assert.match(schemas.HelloFull.properties.instanceId.description, /never triggers an automatic rescan/);
  for (const r of ['R-R1', 'R-R2', 'R-R3']) assert.match(contract, new RegExp(`\\*\\*${r} `));
});
// R-R3 model: classification on a recovery path, no automatic actions.
function sdkOnRecovery(tracked, observedInstance) {
  const actions = [];
  const outcomes = {};
  for (const [jobId, j] of tracked) {
    outcomes[jobId] = j.instanceId !== observedInstance
      ? { code: 'agent-restarted', retryable: true, local: true }
      : { code: j.notFound ? 'not-found' : 'tracked' };
  }
  return { actions, outcomes, dropFamilies: [...tracked.values()].some((j) => j.instanceId !== observedInstance) };
}
test('N1 rule model: SDK-local agent-restarted, retryable, no automatic rescan', () => {
  const tracked = new Map([['J1', { instanceId: 'A', state: 'completed' }], ['J2', { instanceId: 'A', state: 'scanning' }]]);
  const r = sdkOnRecovery(tracked, 'B');
  assert.deepEqual(r.outcomes.J1, { code: 'agent-restarted', retryable: true, local: true });
  assert.deepEqual(r.outcomes.J2, { code: 'agent-restarted', retryable: true, local: true });
  assert.deepEqual(r.actions, [], 'no scan, re-send or export on its own');
  assert.equal(r.dropFamilies, true);
  // Same instance: an unknown job stays not-found.
  const same = sdkOnRecovery(new Map([['J3', { instanceId: 'B', notFound: true }]]), 'B');
  assert.deepEqual(same.outcomes.J3, { code: 'not-found' });
  // The wire answer for an old job ID is the typed not-found problem.
  assert.equal(accepts('Problem', {
    type: 'urn:zilo:problem:not-found', title: 'Not found', status: 404, code: 'not-found',
    retryable: false, requestId: 'req-1',
  }), true);
});

// ------------------------------------------------------------------ N2 D-004a clarification
test('N2 HelloPublic stays minimal; consent state comes from GET /auth/consent', () => {
  const allowed = Object.entries(schemas.HelloPublic.properties).filter(([, v]) => v !== false).map(([k]) => k).sort();
  assert.deepEqual(allowed, ['capabilities', 'product', 'protocol', 'scope']);
  assert.equal(schemas.HelloPublic.properties.consent, undefined);
  assert.ok(spec.paths['/zilo/v1/auth/consent'].get);
  assert.match(spec.paths['/zilo/v1/hello'].get.description, /carries no consent state/);
  for (const n of ['Hello', 'HelloPublic', 'HelloFull']) {
    assert.ok(schemas[n]['x-zilo-source'].includes('D-004a clarification 2026-11-01 (GPT approval pending)'), n);
  }
  assert.doesNotMatch(yamlText, /D-004a \(pending GPT\)/, 'stale revision-2 provenance is reconciled');
});

// ------------------------------------------------------------------ mapping
test('CONTRACT.md has a Fix r2 row for each residual and each new input, naming real tests', () => {
  const section = contract.split('\n## Fix r2\n')[1];
  assert.ok(section, 'Fix r2 section');
  const names = new Set();
  for (const file of ['t10-r2-schema.test.mjs', 't10-fix-r2.test.mjs']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of src.matchAll(/^test\('((?:[^'\\]|\\.)*)'/gm)) names.add(m[1].replaceAll("\\'", "'"));
  }
  for (const id of ['r2-1', 'r2-2', 'r2-3', 'r2-4', 'r2-5', 'N1', 'N2']) {
    const row = section.split('\n').find((l) => l.startsWith(`| ${id} |`));
    assert.ok(row, `row ${id}`);
    const cited = [...row.split('|').at(-2).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(cited.length > 0, `row ${id} cites a test`);
    for (const c of cited) assert.ok([...names].some((t) => t.startsWith(c)), `row ${id} cites unknown test "${c}"`);
  }
  const newInputs = section.split('### New inputs')[1];
  assert.ok(newInputs && newInputs.includes('| N1 |') && !newInputs.includes('| r2-1 |'), 'new inputs are separate');
});
