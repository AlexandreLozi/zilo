// T10 fix r1: author tests for the 13 findings of docs/reviews/T10-r1.md.
// Two kinds of test:
// - schema tests run the real schemas of api/openapi.yaml through Ajv (JSON Schema 2020-12);
// - "rule model" tests run small executable models of CONTRACT.md rules on their worked examples.
//   They check that a rule is deterministic and self-consistent. They do not test an agent or an
//   SDK; T11 and T13 should reuse the vectors in their conformance tests.
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

// ------------------------------------------------------------------ fixtures
const T0 = '2026-10-31T00:00:00Z';
const effective = {
  source: 'feeder', resolution: 300, colorMode: 'color', pageSize: 'a4',
  pageSizeMm: { widthMm: 210, heightMm: 297 }, maxPages: null,
};
const limitsDefaults = Object.fromEntries(Object.entries(schemas.Limits.properties)
  .map(([k, v]) => [k, v['x-zilo-default'] ?? v.const]));
const fullHello = {
  product: 'zilo', scope: 'full', protocol: { min: '1.0', max: '1.0' },
  capabilities: ['auth.consent', 'jobs.scan'], version: '1.0.0', os: 'linux', arch: 'x64',
  instanceId: 'restart-id', limits: limitsDefaults,
};
const asyncProblem = {
  type: 'urn:zilo:problem:paper-jam', title: 'Paper jam', status: 409, code: 'paper-jam',
  retryable: true, requestId: 'create-request-1', errorId: 'err-000001', jobId: 'abcdefghijklmnop',
};
const envelope = (seq, type, extra = {}) => ({ seq, type, jobId: 'abcdefghijklmnop', time: T0, ...extra });

// ------------------------------------------------------------------ F1 export
test('F1 deleteAfterExport is documented receipt-ambiguous and SDK-forbidden', () => {
  const desc = schemas.ExportRequest.properties.deleteAfterExport.description;
  assert.match(desc, /receipt-ambiguous/i);
  assert.match(desc, /SDK\s+never sets it/);
  const op = spec.paths['/zilo/v1/jobs/{jobId}/export'].post.description;
  assert.match(op, /receipt-ambiguous/);
  assert.match(op, /non-destructive/);
  assert.match(contract, /\*\*R-X5 `deleteAfterExport` is receipt-ambiguous\*\*/);
});

// SDK export-and-delete model (R-X5): every request non-destructive, DELETE only after all
// bodies were received with their full Content-Length.
function sdkExportAndDelete(format, indices, transfer) {
  const requests = format === 'jpeg' || format === 'png'
    ? indices.map((index) => ({ format, pages: [{ index }] }))
    : [{ format, pages: indices.map((index) => ({ index })) }];
  const actions = [];
  for (const req of requests) {
    actions.push({ export: req, deleteAfterExport: false });
    const { contentLength, received } = transfer(req);
    if (received !== contentLength) return { actions, deleted: false, retryable: true };
  }
  actions.push({ delete: true });
  return { actions, deleted: true };
}
test('F1 rule model: receive-then-DELETE keeps pages until every body is verified', () => {
  const ok = sdkExportAndDelete('jpeg', [0, 1, 2], () => ({ contentLength: 10, received: 10 }));
  assert.equal(ok.deleted, true);
  assert.ok(ok.actions.filter((a) => a.export).every((a) => a.deleteAfterExport === false));
  assert.deepEqual(ok.actions.at(-1), { delete: true });
  let n = 0;
  const short = sdkExportAndDelete('jpeg', [0, 1, 2], () => ({ contentLength: 10, received: ++n === 2 ? 4 : 10 }));
  assert.equal(short.deleted, false, 'a short body on page 1 must not dispose the job');
  assert.equal(short.actions.some((a) => a.delete), false);
});

// ------------------------------------------------------------------ F2 tokens
function tokenTimes(issuedAt, ttl, familyExpiresAt) {
  const expiresAt = Math.min(issuedAt + ttl, familyExpiresAt);
  const renewAfter = issuedAt + Math.floor((3 * (expiresAt - issuedAt)) / 4);
  return { expiresAt, renewAfter };
}
test('F2 rule model: token times are valid for every permitted TTL and capped by the family', () => {
  const minTtl = schemas.Limits.properties.tokenTtlSeconds.minimum;
  for (let ttl = minTtl; ttl <= 86400; ttl += 97) {
    for (const remaining of [2, 3, 59, ttl - 1, ttl, ttl + 1, 86400]) {
      const { expiresAt, renewAfter } = tokenTimes(0, ttl, remaining);
      assert.ok(expiresAt <= remaining, 'never past the family deadline');
      assert.ok(renewAfter > 0 && renewAfter < expiresAt, `ttl=${ttl} remaining=${remaining}`);
    }
  }
  assert.deepEqual(tokenTimes(0, 3600, 86400), { expiresAt: 3600, renewAfter: 2700 }, 'default: 45 min');
});
test('F2 Limits forbid a TTL the renewal schedule cannot serve', () => {
  const L = schemas.Limits.properties;
  assert.ok(L.tokenTtlSeconds.minimum >= 300);
  assert.ok(L.tokenRenewGraceSeconds.maximum <= L.tokenTtlSeconds.minimum);
  assert.ok(L.familyMaxSeconds.minimum >= L.tokenTtlSeconds.minimum);
  assert.match(schemas.Token.description, /min\(issuedAt \+ limits\.tokenTtlSeconds, familyExpiresAt\)/);
});
function renew({ now, renewAfter, expiresAt, hasSuccessor, familyExpiresAt }) {
  if (hasSuccessor) return { status: 409, code: 'invalid-state' };
  if (now < renewAfter) return { status: 429, code: 'rate-limited', retryAfter: renewAfter - now };
  if (expiresAt >= familyExpiresAt) return { status: 409, code: 'invalid-state' };
  return { status: 200 };
}
test('F2 rule model: renewal outcomes', () => {
  const t = { renewAfter: 2700, expiresAt: 3600, hasSuccessor: false, familyExpiresAt: 86400 };
  assert.deepEqual(renew({ ...t, now: 100 }), { status: 429, code: 'rate-limited', retryAfter: 2600 });
  assert.deepEqual(renew({ ...t, now: 2700 }), { status: 200 });
  assert.equal(renew({ ...t, now: 2701, hasSuccessor: true }).status, 409, 'second tab loses, reads storage');
  assert.equal(renew({ ...t, now: 2701, expiresAt: 86400 }).status, 409, 'family deadline reached');
  // Token-invalid is never documented as page loss; token-revoked is documented as revoked access.
  assert.match(contract, /\*\*It says nothing about pages\.\*\*/);
  assert.doesNotMatch(contract, /because the session's pages are gone/);
});

// ------------------------------------------------------------------ F3 ownership
test('F3 Token carries the family, not a session', () => {
  for (const f of ['familyId', 'familyExpiresAt', 'issuedAt', 'renewAfter']) {
    assert.ok(schemas.Token.required.includes(f), f);
  }
  assert.equal(schemas.Token.properties.sessionId, undefined);
  assert.equal(schemas.SessionId, undefined);
});
test('F3 no session vocabulary remains in the YAML', () => {
  assert.doesNotMatch(yamlText, /session/i);
  assert.match(contract, /separately issued\s+families of the same origin stay isolated/);
});

// ------------------------------------------------------------------ F4 bounds
test('F4 Limits declare the global and auth budgets', () => {
  for (const f of ['maxFamiliesPerOrigin', 'maxFamiliesTotal', 'tokenIssuesPerOriginPerHour',
    'maxRetainedAuthRecords', 'maxJobRecordsTotal', 'maxEventStreamsTotal',
    'maxConcurrentExportsTotal', 'maxErrorEventsPerJob', 'revocationCleanupSeconds']) {
    assert.ok(schemas.Limits.required.includes(f), f);
    assert.notEqual(limitsDefaults[f], undefined, `${f} has a default`);
  }
  assert.match(schemas.Limits.properties.maxStoreBytes.description, /export staging/);
});
test('F4 renewToken declares 409 and 429', () => {
  const r = spec.paths['/zilo/v1/auth/token/renew'].post.responses;
  assert.ok(r['409'] && r['429']);
});

// ------------------------------------------------------------------ F5 CORS and Host
test('F5 Unauthorized no longer grants CORS to a removed origin', () => {
  const d = spec.components.responses.Unauthorized.description;
  assert.doesNotMatch(d, /issued to this origin/);
  assert.match(d, /before any token is looked at/);
});
test('F5 PreflightDenied separates host-denied from the bodyless refusal', () => {
  const d = spec.components.responses.PreflightDenied.description;
  assert.match(d, /host-denied/);
  assert.match(d, /\*\*no body\*\*/);
  assert.match(contract, /\*\*The one exception:\*\* a refused preflight/);
});

// ------------------------------------------------------------------ F6 SSE
// Event-log model. A stream sends retained events with L < seq <= H, then later appends in seq
// order, and closes once it has sent everything up to the current lastSeq of a settled job.
const SETTLED = new Set(['completed', 'failed', 'cancelled', 'disposed']);
function stream(log, L, appendBatches = []) {
  const lastSeq = () => log.at(-1).seq;
  if (!Number.isInteger(L) || L > lastSeq()) return { status: 400 };
  const settled = () => SETTLED.has(log.filter((e) => e.type === 'state').at(-1)?.state);
  const sent = [];
  let cursor = L;
  const drain = () => {
    for (const e of log) if (e.seq > cursor) { sent.push(e); cursor = e.seq; }
    return cursor === lastSeq() && settled();
  };
  if (drain()) return { status: 200, sent, closed: true };
  for (const batch of appendBatches) {
    log.push(...batch); // one atomic append (R-E4)
    if (drain()) return { status: 200, sent, closed: true };
  }
  return { status: 200, sent, closed: false };
}
const st = (seq, state) => ({ seq, type: 'state', state });
const tombstoneLog = () => [st(1, 'queued'), st(2, 'scanning'), { seq: 3, type: 'page' },
  st(4, 'completed'), { seq: 5, type: 'done' }, st(6, 'disposed')];
test('F6 rule model: replay and close', () => {
  const tomb = stream(tombstoneLog(), 0);
  assert.deepEqual(tomb.sent.map((e) => e.seq), [1, 2, 3, 4, 5, 6], 'no truncation at done');
  assert.equal(tomb.sent.at(-1).state, 'disposed');

  const active = stream([st(1, 'queued'), st(2, 'scanning'), { seq: 3, type: 'page' }], 0,
    [[st(4, 'cancelled'), { seq: 5, type: 'done' }, st(6, 'disposed')]]);
  assert.deepEqual(active.sent.map((e) => e.seq), [1, 2, 3, 4, 5, 6], 'compound DELETE is delivered whole');
  assert.equal(active.closed, true);

  const terminalLog = tombstoneLog().slice(0, 5);
  const terminal = stream(terminalLog, 0);
  assert.equal(terminal.closed, true);
  assert.equal(terminal.sent.at(-1).type, 'done', 'later disposal needs a reopen');
  terminalLog.push(st(6, 'disposed'));
  assert.deepEqual(stream(terminalLog, 5).sent.map((e) => e.seq), [6], 'reopen observes disposal');

  assert.deepEqual(stream(tombstoneLog(), 6), { status: 200, sent: [], closed: true });
  assert.equal(stream(tombstoneLog(), 7).status, 400);

  const live = stream([st(1, 'queued'), st(2, 'scanning')], 1, [[{ seq: 4, type: 'progress' }]]);
  assert.equal(live.closed, false, 'an active job keeps its stream open');
  assert.deepEqual(live.sent.map((e) => e.seq), [2, 4], 'ascending, gap from a dropped progress');
});
test('F6 async problems require a stable errorId', () => {
  assert.equal(accepts('ErrorEvent', envelope(7, 'error', { fatal: true, problem: asyncProblem })), true);
  const { errorId, ...noId } = asyncProblem;
  assert.equal(accepts('ErrorEvent', envelope(7, 'error', { fatal: true, problem: noId })), false);
  assert.equal(accepts('Job', {
    id: 'abcdefghijklmnop', deviceId: 'virtual-0', state: 'failed', createdAt: T0,
    requested: { source: 'feeder' }, effective, adjustments: [], pageCount: 2, lastSeq: 9, error: noId,
  }), false, 'Job.error is an AsyncProblem too');
  assert.match(schemas.Problem.properties.requestId.description, /created the job/);
});

// ------------------------------------------------------------------ F7 open enums
test('F7 every open response enum accepts an unknown value', () => {
  const known = Object.keys(schemas).filter((n) => n.endsWith('Known') && n !== 'EventTypeKnown');
  assert.ok(known.length >= 14, `found ${known.length}`);
  for (const k of known) {
    const open = k.slice(0, -'Known'.length);
    assert.ok(schemas[open], `${k} has an open counterpart`);
    assert.equal(accepts(k, 'zz-future'), false, `${k} is closed`);
    assert.equal(accepts(open, 'zz-future'), true, `${open} is open`);
  }
  for (const s of Object.values(schemas)) assert.equal(s['x-zilo-open-enum'], undefined);
});
test('F7 request enums stay closed', () => {
  assert.equal(accepts('ScanSettings', { source: 'feeder' }), true);
  assert.equal(accepts('ScanSettings', { source: 'future-source' }), false);
  assert.equal(accepts('ScanSettings', { source: 'feeder', colorMode: 'sepia' }), false);
  assert.equal(accepts('ExportRequest', { format: 'zip' }), false);
  assert.equal(accepts('RequestedSettings', { source: 'future-source' }), true, 'the echo is open');
});
test('F7 unknown events survive the envelope and stop at the known-event boundary', () => {
  const future = envelope(9, 'thumbnail', { data: 1 });
  assert.equal(accepts('JobEventEnvelope', future), true);
  assert.equal(accepts('JobEvent', future), false);
  assert.equal(accepts('JobEvent', envelope(10, 'done', { state: 'completed', pageCount: 3 })), true);
  assert.equal(accepts('JobEvent', envelope(11, 'state', { state: 'archived' })), true, 'open JobState');
});

// ------------------------------------------------------------------ F8 scope and effective
test('F8 full hello with every field is valid', () => {
  assert.equal(accepts('Hello', fullHello), true);
  const { limits, ...noLimits } = fullHello;
  assert.equal(accepts('Hello', noLimits), false);
  const { maxPagesPerJob, ...partial } = limitsDefaults;
  assert.equal(accepts('Hello', { ...fullHello, limits: partial }), false);
  assert.equal(accepts('Hello', { ...fullHello, scope: 'public', futureField: 1, version: undefined }), false);
  assert.equal(accepts('Hello', {
    product: 'zilo', scope: 'public', protocol: { min: '1.0', max: '1.0' }, capabilities: [], futureField: 1,
  }), true, 'unknown fields stay tolerated');
});
test('F8 ConsentStatus requires the state\'s fields', () => {
  const o = 'https://app.example.com';
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'pending' }), false);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'pending', pollAfterSeconds: 2, promptExpiresAt: T0 }), true);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'denied' }), false);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'denied', retryAfterSeconds: 600 }), true);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'granted' }), false);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'granted', managed: false }), true);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'blocked' }), true);
  assert.equal(accepts('ConsentStatus', { origin: o, state: 'future-state' }), true);
});

// ------------------------------------------------------------------ F9 cancel and page bound
function cancel(state, inTombstoneWindow = true) {
  if (state === 'queued' || state === 'scanning') return 202;
  if (['completed', 'failed', 'cancelled'].includes(state)) return 200;
  if (state === 'disposed') return inTombstoneWindow ? 200 : 404;
  return 404;
}
test('F9 rule model: cancel outcomes', () => {
  assert.equal(cancel('scanning'), 202);
  assert.equal(cancel('completed'), 200);
  assert.equal(cancel('disposed'), 200, 'tombstone: no-op');
  assert.equal(cancel('disposed', false), 404);
  assert.match(spec.paths['/zilo/v1/jobs/{jobId}/cancel'].post.description, /\*\*settled\*\*/);
});
test('F9 done never carries disposed', () => {
  assert.equal(accepts('DoneEvent', envelope(5, 'done', { state: 'disposed', pageCount: 0 })), false);
  assert.equal(accepts('DoneEvent', envelope(5, 'done', { state: 'scanning', pageCount: 0 })), false);
  assert.equal(accepts('DoneEvent', envelope(5, 'done', { state: 'future-terminal', pageCount: 0 })), true);
});
// Page-count model (R-J8). Returns the create outcome and, for a stack of `sheets` pages, the end.
function pageCount({ source, maxPages, strict = false, cap = 500, stack }) {
  const adjustments = [];
  let eff = maxPages ?? null;
  if (source === 'flatbed') {
    if (maxPages !== undefined && maxPages !== 1) {
      if (strict) return { status: 422, code: 'unsupported-capability' };
      adjustments.push('coerced');
    }
    eff = 1;
  } else if (eff !== null) {
    if (eff > cap) {
      if (strict) return { status: 422, code: 'invalid-settings' };
      eff = cap; adjustments.push('limit');
    }
    if (source === 'duplex' && eff % 2) {
      if (strict) return { status: 422, code: 'unsupported-capability' };
      eff += 1; adjustments.push('coerced');
    }
  }
  const bound = eff ?? cap;
  const stored = Math.min(stack, bound);
  const end = eff === null && stack >= cap
    ? { state: 'failed', code: 'limits-exceeded', pagesKept: cap }
    : { state: 'completed', pages: stored };
  return { status: 201, effectiveMaxPages: eff, adjustments, end };
}
test('F9 rule model: page count completion versus safety bound', () => {
  assert.deepEqual(pageCount({ source: 'feeder', maxPages: 600, stack: 700 }),
    { status: 201, effectiveMaxPages: 500, adjustments: ['limit'], end: { state: 'completed', pages: 500 } });
  assert.deepEqual(pageCount({ source: 'feeder', stack: 700 }).end,
    { state: 'failed', code: 'limits-exceeded', pagesKept: 500 });
  assert.deepEqual(pageCount({ source: 'feeder', stack: 20 }).end, { state: 'completed', pages: 20 });
  assert.equal(pageCount({ source: 'feeder', maxPages: 600, strict: true, stack: 1 }).code, 'invalid-settings');
  assert.deepEqual(pageCount({ source: 'flatbed', maxPages: 3, stack: 1 }).adjustments, ['coerced']);
  assert.equal(pageCount({ source: 'flatbed', maxPages: 3, strict: true, stack: 1 }).status, 422);
  assert.equal(pageCount({ source: 'duplex', maxPages: 5, stack: 10 }).effectiveMaxPages, 6);
  assert.equal(schemas.Limits.properties.maxPagesPerJob.multipleOf, 2);
});

// ------------------------------------------------------------------ F10 defaults and sizes
const CANON = { a3: [297, 420], a4: [210, 297], a5: [148, 210], b5: [176, 250],
  letter: [215.9, 279.4], legal: [215.9, 355.6], executive: [184.15, 266.7] };
function nearestListed(caps, [rw, rh]) {
  let best;
  caps.pageSizes.forEach((p, i) => {
    const d = Math.abs(p.widthMm - rw) + Math.abs(p.heightMm - rh);
    const area = p.widthMm * p.heightMm;
    if (!best || d < best.d || (d === best.d && area > best.area)) best = { d, area, i, p };
  });
  return best.p;
}
function resolvePageSize(caps, { pageSize, customPageSizeMm }, strict = false) {
  const fits = ([w, h]) => w <= caps.maxAreaMm.widthMm && h <= caps.maxAreaMm.heightMm;
  const coerce = (dims) => {
    if (strict) return { status: 422, code: 'unsupported-capability' };
    const p = nearestListed(caps, dims);
    return { pageSize: p.id, mm: [p.widthMm, p.heightMm], adjustment: 'coerced' };
  };
  if (pageSize === 'custom') {
    const dims = [customPageSizeMm.widthMm, customPageSizeMm.heightMm];
    if (!caps.customPageSize) return coerce(dims);
    if (!fits(dims)) return { status: 422, code: 'invalid-settings' };
    return { pageSize: 'custom', mm: dims };
  }
  const listed = caps.pageSizes.find((p) => p.id === pageSize);
  if (listed) return { pageSize, mm: [listed.widthMm, listed.heightMm] };
  if (pageSize === 'max') return { pageSize, mm: [caps.maxAreaMm.widthMm, caps.maxAreaMm.heightMm] };
  if (CANON[pageSize]) {
    if (caps.customPageSize && fits(CANON[pageSize])) return { pageSize, mm: CANON[pageSize] };
    return coerce(CANON[pageSize]);
  }
  return { status: 422, code: 'invalid-settings', reason: 'unknown-page-size' };
}
const flatbedCaps = {
  pageSizes: [{ id: 'a4', widthMm: 210, heightMm: 297 }, { id: 'legal', widthMm: 215.9, heightMm: 355.6 }],
  maxAreaMm: { widthMm: 216, heightMm: 356 }, customPageSize: false,
};
test('F10 rule model: page size resolution', () => {
  for (const strict of [false, true]) {
    assert.equal(resolvePageSize(flatbedCaps, { pageSize: 'banana' }, strict).reason, 'unknown-page-size');
  }
  assert.deepEqual(resolvePageSize(flatbedCaps, { pageSize: 'letter' }),
    { pageSize: 'a4', mm: [210, 297], adjustment: 'coerced' }, 'letter is nearer to a4 than to legal');
  assert.equal(resolvePageSize(flatbedCaps, { pageSize: 'letter' }, true).code, 'unsupported-capability');
  const custom = { ...flatbedCaps, customPageSize: true };
  assert.deepEqual(resolvePageSize(custom, { pageSize: 'letter' }), { pageSize: 'letter', mm: [215.9, 279.4] });
  assert.equal(resolvePageSize(custom, { pageSize: 'a3' }).pageSize, 'legal', 'a3 does not fit: nearest listed');
  assert.equal(resolvePageSize(custom, { pageSize: 'custom', customPageSizeMm: { widthMm: 300, heightMm: 300 } }).code,
    'invalid-settings');
  assert.deepEqual(resolvePageSize(flatbedCaps, { pageSize: 'max' }).mm, [216, 356]);
  const tie = { ...flatbedCaps, pageSizes: [{ id: 'x', widthMm: 200, heightMm: 300 }, { id: 'y', widthMm: 220, heightMm: 300 }] };
  assert.equal(resolvePageSize(tie, { pageSize: 'custom', customPageSizeMm: { widthMm: 210, heightMm: 300 } }).pageSize,
    'y', 'tie: larger area');
  const sameArea = { ...flatbedCaps, pageSizes: [{ id: 'p', widthMm: 200, heightMm: 300 }, { id: 'q', widthMm: 300, heightMm: 200 }] };
  assert.equal(resolvePageSize(sameArea, { pageSize: 'custom', customPageSizeMm: { widthMm: 250, heightMm: 250 } }).pageSize,
    'p', 'tie on area: earlier entry');
  assert.match(contract, /`a4` 210×297/);
});
function coerceResolution(supported, requested, maxDpi, strict = false) {
  if (requested > maxDpi) return { status: 422, code: 'invalid-settings' };
  if (supported.includes(requested)) return { value: requested };
  if (strict) return { status: 422, code: 'unsupported-capability' };
  const ok = supported.filter((v) => v <= maxDpi);
  ok.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || b - a);
  return { value: ok[0], adjustment: 'coerced' };
}
const range = (min, max, step) => Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, k) => min + k * step);
test('F10 rule model: resolution coercion', () => {
  assert.deepEqual(coerceResolution([150, 300, 600], 450, 1200), { value: 600, adjustment: 'coerced' });
  assert.deepEqual(coerceResolution(range(100, 1200, 100), 250, 1200), { value: 300, adjustment: 'coerced' });
  assert.equal(coerceResolution([300, 2400], 1000, 1200).value, 300, 'never above the agent limit');
  assert.equal(coerceResolution([300, 600], 1300, 1200).code, 'invalid-settings');
  assert.equal(coerceResolution([300, 600], 400, 1200, true).code, 'unsupported-capability');
});
test('F10 caps always carry complete defaults', () => {
  const caps = {
    source: 'feeder', resolutions: { kind: 'list', values: [300] }, colorModes: ['color'],
    pageSizes: [{ id: 'a4', widthMm: 210, heightMm: 297 }], maxAreaMm: { widthMm: 216, heightMm: 356 },
    customPageSize: false, defaults: { resolution: 300, colorMode: 'color', pageSize: 'a4' },
  };
  assert.equal(accepts('SourceCaps', caps), true);
  const { defaults, ...noDefaults } = caps;
  assert.equal(accepts('SourceCaps', noDefaults), false);
  assert.equal(accepts('SourceCaps', { ...caps, defaults: { resolution: 300 } }), false);
  assert.equal(accepts('SourceCaps', { ...caps, pageSizes: [] }), false);
  assert.equal(accepts('EffectiveSettings', { ...effective, maxPages: undefined }), false);
  assert.equal(accepts('ScanSettings', { source: 'feeder', pageSize: 'custom' }), false);
  assert.equal(accepts('ScanSettings', { source: 'feeder', pageSize: 'a4', customPageSizeMm: { widthMm: 1, heightMm: 1 } }), false);
  assert.equal(accepts('ScanSettings', { source: 'feeder', pageSize: 'custom', customPageSizeMm: { widthMm: 1, heightMm: 1 } }), true);
});

// ------------------------------------------------------------------ F11 selection
function select(snapshot, pages) {
  if (pages === undefined) {
    if (snapshot.length === 0) return { status: 409, code: 'invalid-state', reason: 'no-pages' };
    return { selection: [...snapshot].sort((a, b) => a - b) };
  }
  const seen = new Set();
  for (const [i, p] of pages.entries()) {
    if (seen.has(p.index)) return { status: 422, code: 'invalid-request', field: `/pages/${i}/index`, reason: 'duplicate-index' };
    seen.add(p.index);
    if (!snapshot.includes(p.index)) return { status: 422, code: 'invalid-request', field: `/pages/${i}/index`, reason: 'page-unavailable' };
  }
  return { selection: pages.map((p) => p.index) };
}
test('F11 rule model: selection snapshot', () => {
  assert.equal(select([], undefined).reason, 'no-pages');
  assert.deepEqual(select([0, 1, 2], [{ index: 8 }]),
    { status: 422, code: 'invalid-request', field: '/pages/0/index', reason: 'page-unavailable' });
  assert.equal(select([0, 1, 2], [{ index: 1 }, { index: 1 }]).reason, 'duplicate-index');
  const snapshot = [0, 1, 2];
  const result = select(snapshot, undefined);
  snapshot.push(3); // a page stored after the snapshot
  assert.deepEqual(result.selection, [0, 1, 2]);
  assert.deepEqual(select([0, 1, 2], [{ index: 2 }, { index: 0 }]).selection, [2, 0], 'list order is output order');
});
test('F11 ExportRequest encodes the one-image selection', () => {
  assert.equal(accepts('ExportRequest', { format: 'jpeg' }), false);
  assert.equal(accepts('ExportRequest', { format: 'png', pages: [{ index: 0 }, { index: 1 }] }), false);
  assert.equal(accepts('ExportRequest', { format: 'jpeg', pages: [{ index: 3, rotate: 90 }] }), true);
  assert.equal(accepts('ExportRequest', { format: 'pdf' }), true);
  assert.equal(accepts('ExportRequest', { format: 'tiff', pages: [{ index: 1 }, { index: 0 }] }), true);
  assert.equal(accepts('ExportRequest', { format: 'pdf', pages: [] }), false);
});

// ------------------------------------------------------------------ F12 global errors
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item).filter(([m]) => ['get', 'post', 'delete'].includes(m))
    .map(([method, op]) => ({ path, method, op })));
test('F12 every operation declares the global errors', () => {
  assert.ok(operations.length >= 18);
  for (const { path, method, op } of operations) {
    const r = op.responses;
    for (const code of ['429', '500', '503', 'default']) assert.ok(r[code], `${method} ${path} ${code}`);
    if (method !== 'get') assert.ok(r['413'], `${method} ${path} 413`);
  }
  const globals = spec['x-zilo-global-errors'].map((g) => `${g.status} ${g.code}`);
  for (const g of ['403 host-denied', '404 not-found', '405 invalid-request', '413 limits-exceeded',
    '429 rate-limited', '500 unknown', '503 agent-unavailable']) assert.ok(globals.includes(g), g);
  assert.ok(spec.components.responses.MethodNotAllowed.headers.Allow);
});
test('F12 problem responses carry request ID and CORS headers', () => {
  for (const [name, resp] of Object.entries(spec.components.responses)) {
    if (!resp.content?.['application/problem+json']) continue;
    assert.ok(resp.headers?.['Zilo-Request-Id'], `${name} Zilo-Request-Id`);
    assert.ok(resp.headers?.Vary, `${name} Vary`);
    if (name !== 'PreflightDenied') assert.ok(resp.headers?.['Access-Control-Allow-Origin'], `${name} CORS`);
  }
});
test('F12 the error-code list is frozen for T05', () => {
  assert.deepEqual(schemas.ErrorCodeKnown.enum, [
    'host-denied', 'unauthorized-origin', 'consent-pending', 'consent-denied', 'token-invalid',
    'token-revoked', 'rate-limited', 'invalid-request', 'invalid-settings', 'unsupported-capability',
    'invalid-state', 'not-found', 'device-busy', 'feeder-empty', 'paper-jam', 'cover-open', 'timeout',
    'disconnected', 'permission', 'export-failed', 'limits-exceeded', 'agent-unavailable', 'unknown',
  ]);
  assert.equal(accepts('Problem', { ...asyncProblem, code: 'future-code', type: 'urn:zilo:problem:future-code' }), true);
});

// ------------------------------------------------------------------ F13 TIFF quality
test('F13 quality is not described as applying to TIFF', () => {
  const d = schemas.ExportRequest.properties.quality.description;
  assert.match(d, /ignored for `tiff` and `png`/);
  assert.doesNotMatch(d, /inside PDF and TIFF/);
});

// ------------------------------------------------------------------ resolution table
test('CONTRACT.md has an r1 resolution row for each of the 13 findings, naming real tests', () => {
  const section = contract.split('## r1 resolution')[1];
  assert.ok(section);
  const names = new Set();
  for (const file of ['t10-r1-schema.test.mjs', 't10-fix-r1.test.mjs']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of src.matchAll(/^test\('((?:[^'\\]|\\.)*)'/gm)) names.add(m[1].replaceAll("\\'", "'"));
  }
  for (let n = 1; n <= 13; n++) {
    const row = section.split('\n').find((l) => l.startsWith(`| ${n} |`));
    assert.ok(row, `row ${n}`);
    const cited = [...row.split('|').at(-2).matchAll(/`([^`]+)`/g)].map((m) => m[1])
      .filter((c) => !c.endsWith('.ts'));
    assert.ok(cited.length > 0, `row ${n} cites a test`);
    for (const c of cited) {
      assert.ok([...names].some((t) => t.startsWith(c)), `row ${n} cites unknown test "${c}"`);
    }
  }
});
