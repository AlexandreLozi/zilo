// SP-1a test page logic. Every scenario records a structured result in window.__zilo.results
// so Playwright can assert it, and prints it to the on-page log for screenshots.
'use strict';
(() => {
  const cfg = JSON.parse(document.getElementById('zilo-app-config').textContent);
  const AGENT = `http://127.0.0.1:${cfg.agentPort}`;
  const BRIDGE_ORIGIN = AGENT;
  const TIMEOUT_MS = 6000;
  const BLOB_SIZE = 1024 * 1024;

  const state = { results: {}, rejections: [], bridgeState: 'idle' };
  window.__zilo = state;
  // Test hooks: options a test may set before clicking a button (the click supplies the gesture).
  window.__ziloOpts = window.__ziloOpts || {};

  const logEl = document.getElementById('log');
  document.getElementById('origin').textContent = location.origin;
  document.getElementById('secure').textContent = String(window.isSecureContext);
  document.getElementById('variant').textContent = cfg.variant;

  const now = () => Math.round(performance.now());
  function record(name, value) {
    state.results[name] = value;
    logEl.textContent += `${name}: ${JSON.stringify(value)}\n`;
  }
  const errInfo = (e) => ({ error: (e && e.name) || 'Error', message: String((e && e.message) || e) });
  const token = () => document.getElementById('token').value;
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const blobByte = (i) => (i * 31 + 7) & 0xff;
  function patternOk(buf) {
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 4093) if (u8[i] !== blobByte(i)) return false;
    return u8.length === 0 || u8[u8.length - 1] === blobByte(u8.length - 1);
  }

  // Does this engine recognise the targetAddressSpace RequestInit member at all?
  function tasSupport() {
    try {
      const r = new Request(`${AGENT}/`, { targetAddressSpace: 'loopback' });
      return r.targetAddressSpace === undefined ? 'ignored' : String(r.targetAddressSpace);
    } catch (e) {
      return `throws:${e.name}`;
    }
  }
  record('env', { origin: location.origin, isSecureContext: window.isSecureContext, ua: navigator.userAgent, tas: tasSupport(), variant: cfg.variant });

  async function timedFetch(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { cache: 'no-store', ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  const failure = (e, t0) => ({ ok: false, ...errInfo(e), timedOut: e && e.name === 'AbortError', ms: now() - t0 });

  async function hello(name, useTas) {
    const t0 = now();
    try {
      const r = await timedFetch(`${AGENT}/zilo/v1/hello`, useTas ? { targetAddressSpace: 'loopback' } : {});
      const body = await r.json();
      record(name, { ok: r.ok, status: r.status, product: body.product, ms: now() - t0 });
    } catch (e) {
      record(name, failure(e, t0));
    }
  }

  async function events() {
    const t0 = now();
    try {
      const r = await timedFetch(`${AGENT}/zilo/v1/events`, {
        targetAddressSpace: 'loopback',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!r.ok) return record('events', { ok: false, status: r.status, code: (await r.json()).title, ms: now() - t0 });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      const ticks = [];
      let done = false;
      let buf = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(frame);
          if (ev && ev[1] === 'tick') ticks.push({ seq: JSON.parse(/^data: (.*)$/m.exec(frame)[1]).seq, ms: now() - t0 });
          if (ev && ev[1] === 'done') done = true;
        }
      }
      // Streaming (not buffered) if ticks arrived spread out over time.
      const spreadMs = ticks.length > 1 ? ticks[ticks.length - 1].ms - ticks[0].ms : 0;
      record('events', { ok: ticks.length === 5 && done, status: r.status, ticks: ticks.map((t) => t.seq), spreadMs, incremental: spreadMs >= 400, ms: now() - t0 });
    } catch (e) {
      record('events', failure(e, t0));
    }
  }

  async function blob() {
    const t0 = now();
    try {
      const r = await timedFetch(`${AGENT}/zilo/v1/blob?size=${BLOB_SIZE}`, {
        targetAddressSpace: 'loopback',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!r.ok) return record('blob', { ok: false, status: r.status, code: (await r.json()).title, ms: now() - t0 });
      const buf = await r.arrayBuffer();
      record('blob', { ok: buf.byteLength === BLOB_SIZE && patternOk(buf), status: r.status, bytes: buf.byteLength, ms: now() - t0 });
    } catch (e) {
      record('blob', failure(e, t0));
    }
  }

  async function permissions() {
    const out = {};
    for (const name of ['loopback-network', 'local-network']) {
      try {
        const s = await navigator.permissions.query({ name });
        out[name] = s.state;
      } catch (e) {
        out[name] = `error:${e.name}`;
      }
    }
    record('permissions', out);
  }

  // Negative control: the public page tries to mint a bridge capability directly, claiming to be
  // the app. The browser stamps Origin with the real page origin, so the stub must refuse.
  async function forgeMint() {
    const t0 = now();
    try {
      const r = await timedFetch(`${AGENT}/zilo/v1/bridge/session`, {
        method: 'POST',
        targetAddressSpace: 'loopback',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ appOrigin: location.origin, nonce: hex(16) }),
      });
      record('forge-mint', { ok: r.ok, status: r.status, code: (await r.json().catch(() => ({}))).title, ms: now() - t0 });
    } catch (e) {
      record('forge-mint', failure(e, t0));
    }
  }

  // ---- S2 popup bridge ----
  // T01 fix r1:
  //  - window.open runs synchronously in the click handler, before any await, so the click's user
  //    activation is still live; the COOP diagnostic runs afterwards and is bounded in time.
  //  - every port request carries {v, id, sessionId}; replies must carry the bound session ID.
  //  - binary and event replies are acknowledged after they are consumed (bridge flow control).
  //  - liveness: a `bridge-gone` notice (bridge pagehide) or a missed ping marks the bridge lost; a
  //    fresh `bridge-ready` from the same popup (reload) triggers a fresh handshake and session.
  const COOP_PROBE_MS = 3000;
  let bridge = null; // the current bridge instance; handlers of an older instance are inert

  function waitFor(predicateName, accept, timeoutMs, popup, holdForRejection) {
    // Resolves with the accepted MessageEvent, or with a failure code. Every rejected message is
    // recorded with the check that failed.
    // T01 fix r2 (test harness only): with `holdForRejection` (the forged-ready negative control),
    // an accepted message is held, and the listener stays active, until a message has been
    // rejected at this step. That way the forged ready is always validated, whichever of the two
    // arrives first. If the forged message is never rejected, the held message is released at
    // timeout and the control fails because no rejection was recorded.
    return new Promise((resolve) => {
      let held = null;
      let rejectedHere = false;
      const reject = (r) => {
        state.rejections.push({ at: predicateName, ...r });
        rejectedHere = true;
        if (held) { cleanup(); resolve({ ev: held }); }
      };
      const onMsg = (ev) => {
        if (ev.source !== popup) return reject({ code: 'wrong-source' });
        if (ev.origin !== BRIDGE_ORIGIN) return reject({ code: 'wrong-origin', origin: ev.origin });
        if (!accept(ev.data)) return reject({ code: 'bad-schema' });
        if (holdForRejection && !rejectedHere) { if (!held) held = ev; return; }
        cleanup();
        resolve({ ev });
      };
      const poll = setInterval(() => { if (popup.closed) { cleanup(); resolve({ fail: 'popup-closed' }); } }, 100);
      const timer = setTimeout(() => { cleanup(); resolve(held ? { ev: held } : { fail: 'timeout' }); }, timeoutMs);
      function cleanup() { window.removeEventListener('message', onMsg); clearInterval(poll); clearTimeout(timer); }
      window.addEventListener('message', onMsg);
    });
  }
  const isReady = (d) => d && d.zilo === 'bridge-ready' && d.v === 1;

  // Explicit COOP detection on our own document. Started after window.open, bounded in time.
  function coopProbe() {
    const probe = fetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then((h) => h.headers.get('cross-origin-opener-policy'))
      .catch((e) => `unknown:${e.name}`);
    const limit = new Promise((resolve) => setTimeout(() => resolve('unknown:timeout'), COOP_PROBE_MS));
    return Promise.race([probe, limit]);
  }

  // Handshake on an already-open popup whose bridge-ready was accepted: hello + nonce + port.
  async function handshake(popup, nonce) {
    const ch = new MessageChannel();
    const welcome = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ fail: 'timeout' }), 5000);
      ch.port1.onmessage = (ev) => {
        const d = ev.data;
        if (d && d.v === 1 && d.nonce === nonce && (d.zilo === 'bridge-welcome' || d.zilo === 'bridge-error')) {
          clearTimeout(timer);
          resolve({ d });
        } else {
          state.rejections.push({ at: 'welcome', code: 'bad-schema-or-nonce' });
        }
      };
    });
    try {
      popup.postMessage({ zilo: 'bridge-hello', v: 1, nonce, token: token() }, BRIDGE_ORIGIN, [ch.port2]);
    } catch (e) {
      return { fail: 'post-hello-threw', err: errInfo(e) };
    }
    const w = await welcome;
    if (w.fail) { ch.port1.close(); return { fail: w.fail }; }
    if (w.d.zilo === 'bridge-error') { ch.port1.close(); return { error: w.d.code }; }
    return { port: ch.port1, sessionId: w.d.sessionId };
  }

  // A bound bridge instance: request/reply correlation, session checks, acks, liveness.
  function bindInstance(b, port, sessionId) {
    b.port = port;
    b.sessionId = sessionId;
    b.pending = new Map();
    b.lastSeen = now();
    if (b.pingTimer) clearInterval(b.pingTimer);
    port.onmessage = (ev) => {
      if (bridge !== b || b.port !== port) return;
      const d = ev.data;
      if (d && d.zilo === 'bridge-gone' && d.v === 1 && d.sessionId === b.sessionId) return lose(b, d.reason || 'bridge-gone');
      if (!d || d.v !== 1 || d.sessionId !== b.sessionId) return state.rejections.push({ at: 'reply', code: 'bad-session-or-schema' });
      b.lastSeen = now();
      const cb = b.pending.get(d.id);
      if (cb) cb(d);
    };
    state.bridgeState = 'bound';
    b.pingTimer = setInterval(() => {
      if (bridge !== b || state.bridgeState !== 'bound') return;
      if (now() - b.lastSeen > cfg.lostAfterMs) return lose(b, 'no-pong');
      request(b, 'ping', undefined, cfg.lostAfterMs).catch(() => {});
    }, cfg.pingMs);
  }

  function request(b, op, args, timeoutMs = 8000) {
    const id = b.next++;
    const port = b.port;
    return new Promise((resolve) => {
      const msgs = [];
      const finish = (m) => { clearTimeout(timer); b.pending.delete(id); resolve(op === 'events' ? { ...m, msgs } : m); };
      const timer = setTimeout(() => finish({ ok: false, code: 'op-timeout' }), timeoutMs);
      b.pending.set(id, (m) => {
        if (op === 'events' && m.ok && !m.end) {
          msgs.push(m);
          // Consumed: acknowledge so the bridge may send more (its event window is small).
          port.postMessage({ v: 1, id: b.next++, sessionId: b.sessionId, op: 'ack', args: { request: id, seq: m.seq } });
          return;
        }
        finish(m);
      });
      port.postMessage({ v: 1, id, sessionId: b.sessionId, op, args });
    });
  }
  const ack = (b, requestId) => { if (b.port) b.port.postMessage({ v: 1, id: b.next++, sessionId: b.sessionId, op: 'ack', args: { request: requestId, seq: 1 } }); };

  function unbind(b) {
    if (b.pingTimer) { clearInterval(b.pingTimer); b.pingTimer = null; }
    if (b.port) { b.port.onmessage = null; b.port.close(); b.port = null; }
    if (b.pending) for (const cb of [...b.pending.values()]) cb({ ok: false, code: 'bridge-lost' });
  }

  // Navigation, reload or a missed ping: the session is unusable and is reported as such.
  function lose(b, reason) {
    if (bridge !== b || !b.port) return;
    const sessionId = b.sessionId;
    unbind(b);
    state.bridgeState = 'lost';
    record('bridge-lost', { reason, sessionId, ms: now() - b.t0 });
  }

  // Closure watch and reload recovery for the lifetime of the popup window.
  function watch(b) {
    b.closeTimer = setInterval(() => {
      if (bridge !== b) return clearInterval(b.closeTimer);
      if (b.popup.closed) {
        clearInterval(b.closeTimer);
        unbind(b);
        state.bridgeState = 'closed';
        record('bridge-closed', { detected: true, ms: now() - b.t0 });
      }
    }, 200);
    // A reloaded bridge announces itself again: re-handshake with a fresh nonce and a fresh session.
    b.onReady = async (ev) => {
      if (bridge !== b || ev.source !== b.popup || ev.origin !== BRIDGE_ORIGIN || !isReady(ev.data)) return;
      if (b.port) lose(b, 'reannounced');
      state.bridgeState = 'rebinding';
      const previous = b.sessionId;
      const nonce = hex(16);
      const h = await handshake(b.popup, nonce);
      if (bridge !== b) return;
      if (!h.port) {
        state.bridgeState = 'failed';
        return record('bridge-reconnect', { ok: false, code: h.error ? `bridge-error:${h.error}` : `welcome-${h.fail}` });
      }
      bindInstance(b, h.port, h.sessionId);
      const hello = await request(b, 'hello');
      record('bridge-reconnect', { ok: hello.ok === true && h.sessionId !== previous, previousSessionId: previous, sessionId: h.sessionId, nonceFresh: nonce !== b.nonce, hello: hello.ok });
    };
    window.addEventListener('message', b.onReady);
  }

  function retire(b) {
    if (!b) return;
    unbind(b);
    if (b.closeTimer) clearInterval(b.closeTimer);
    if (b.onReady) window.removeEventListener('message', b.onReady);
  }

  async function openBridge() {
    const opts = window.__ziloOpts;
    const t0 = now();
    const nonce = opts.nonce || hex(16);
    // Retire any previous instance synchronously (no await before window.open).
    retire(bridge);
    bridge = null;
    let popup;
    let openError = null;
    try {
      popup = window.open(`${AGENT}/bridge`, 'zilo-bridge', 'popup=yes,width=480,height=360');
    } catch (e) {
      openError = e;
    }
    const coop = coopProbe(); // after window.open: never consumes the click's activation

    const steps = [];
    const step = (s, extra) => steps.push({ s, ms: now() - t0, ...(extra || {}) });
    const result = { ok: false, steps, nonce };
    const b = { popup, t0, nonce, next: 1, port: null };
    const done = async (extra) => {
      Object.assign(result, extra);
      result.coopHeader = await coop;
      if (bridge !== b && bridge !== null) { result.superseded = true; return result; } // a newer click owns the state
      if (result.ok && b.port) state.bridgeState = 'bound';
      else if (result.ok) result.lostDuringFlow = state.bridgeState;
      else if (!['lost', 'closed'].includes(state.bridgeState)) state.bridgeState = 'failed';
      record('bridge', result);
      return result;
    };
    if (openError) return done({ code: 'window-open-threw', ...errInfo(openError) });
    if (!popup) return done({ code: 'popup-blocked' });
    bridge = b;
    state.bridgeState = 'opening';
    step('opened', { closedImmediately: popup.closed });
    if (opts.injectFakeReady) window.postMessage({ zilo: 'bridge-ready', v: 1 }, location.origin);

    const ready = await waitFor('ready', isReady, 5000, popup, !!opts.injectFakeReady);
    if (ready.fail && !opts.forceHello) {
      const coopHeader = await coop;
      const code = coopHeader === 'same-origin' ? 'coop-severed' : ready.fail === 'popup-closed' ? 'popup-closed' : 'bridge-timeout';
      return done({ code, readyFail: ready.fail, popupClosed: popup.closed });
    }
    step(ready.fail ? `ready-${ready.fail}` : 'ready');

    const h = await handshake(popup, nonce);
    if (h.fail === 'post-hello-threw') return done({ code: 'post-hello-threw', ...h.err });
    if (h.fail) return done({ code: ready.fail ? `no-ready-then-${h.fail}` : `welcome-${h.fail}` });
    if (h.error) return done({ code: `bridge-error:${h.error}` });
    step('welcome', { sessionId: h.sessionId });
    bindInstance(b, h.port, h.sessionId);
    watch(b);

    const hr = await request(b, 'hello');
    step('op-hello', { ok: hr.ok });
    const tb = now();
    const bl = await request(b, 'blob', { size: BLOB_SIZE });
    const blobRes = bl.ok
      ? { ok: bl.bytes instanceof ArrayBuffer && bl.bytes.byteLength === BLOB_SIZE && patternOk(bl.bytes), bytes: bl.bytes.byteLength, ms: now() - tb }
      : { ok: false, code: bl.code };
    if (bl.ok) ack(b, bl.id); // consumed: release the bridge's binary slot
    step('op-blob', { ok: blobRes.ok });
    const big = await request(b, 'blob', { size: cfg.maxBridgeBytes + 1 });
    step('op-blob-oversize', { code: big.code });
    const ev = await request(b, 'events');
    const ticks = (ev.msgs || []).filter((m) => m.event === 'tick').map((m) => m.data.seq);
    step('op-events', { ticks: ticks.length });
    const unknown = await request(b, 'fetch-arbitrary-url', { url: 'http://example.com/' });

    return done({
      ok: hr.ok && blobRes.ok && ticks.length === 5 && big.code === 'too-large' && unknown.code === 'unknown-op',
      sessionId: h.sessionId,
      hello: { ok: hr.ok, product: hr.body && hr.body.product },
      blob: blobRes,
      oversize: { code: big.code },
      events: { ticks },
      unknownOp: { code: unknown.code },
    });
  }

  function closeBridge() {
    if (bridge && bridge.popup) bridge.popup.close();
  }

  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  on('btn-hello-tas', () => hello('hello-tas', true));
  on('btn-hello-plain', () => hello('hello-plain', false));
  on('btn-events', events);
  on('btn-blob', blob);
  on('btn-perm', permissions);
  on('btn-forge-mint', forgeMint);
  on('btn-bridge', openBridge);
  on('btn-bridge-close', closeBridge);
})();
