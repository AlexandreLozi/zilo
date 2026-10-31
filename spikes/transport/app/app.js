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
  let bridge = null;

  function waitFor(predicateName, accept, timeoutMs, popup) {
    // Resolves with the accepted MessageEvent, or with a failure code. Every rejected message is
    // recorded with the check that failed.
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        if (ev.source !== popup) return state.rejections.push({ at: predicateName, code: 'wrong-source' });
        if (ev.origin !== BRIDGE_ORIGIN) return state.rejections.push({ at: predicateName, code: 'wrong-origin', origin: ev.origin });
        if (!accept(ev.data)) return state.rejections.push({ at: predicateName, code: 'bad-schema' });
        cleanup();
        resolve({ ev });
      };
      const poll = setInterval(() => { if (popup.closed) { cleanup(); resolve({ fail: 'popup-closed' }); } }, 100);
      const timer = setTimeout(() => { cleanup(); resolve({ fail: 'timeout' }); }, timeoutMs);
      function cleanup() { window.removeEventListener('message', onMsg); clearInterval(poll); clearTimeout(timer); }
      window.addEventListener('message', onMsg);
    });
  }

  function portRequest(port, pending, op, args, timeoutMs = 8000) {
    const id = pending.next++;
    return new Promise((resolve) => {
      const msgs = [];
      const timer = setTimeout(() => { pending.map.delete(id); resolve({ ok: false, code: 'op-timeout', msgs }); }, timeoutMs);
      pending.map.set(id, (m) => {
        if (op === 'events' && m.ok && !m.end) { msgs.push(m); return; }
        clearTimeout(timer);
        pending.map.delete(id);
        resolve(op === 'events' ? { ...m, msgs } : m);
      });
      port.postMessage({ id, op, args });
    });
  }

  async function openBridge() {
    const opts = window.__ziloOpts;
    const t0 = now();
    const steps = [];
    const step = (s, extra) => steps.push({ s, ms: now() - t0, ...(extra || {}) });
    const result = { ok: false, steps };
    const done = (extra) => { Object.assign(result, extra); state.bridgeState = result.ok ? 'bound' : 'failed'; record('bridge', result); return result; };

    // Explicit COOP detection on our own document before relying on the opener relationship.
    try {
      const h = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
      result.coopHeader = h.headers.get('cross-origin-opener-policy');
    } catch (e) {
      result.coopHeader = `unknown:${e.name}`;
    }

    const nonce = opts.nonce || hex(16);
    result.nonce = nonce;
    state.bridgeState = 'opening';
    let popup;
    try {
      popup = window.open(`${AGENT}/bridge`, 'zilo-bridge', 'popup=yes,width=480,height=360');
    } catch (e) {
      return done({ code: 'window-open-threw', ...errInfo(e) });
    }
    if (!popup) return done({ code: 'popup-blocked' });
    step('opened', { closedImmediately: popup.closed });
    if (opts.injectFakeReady) window.postMessage({ zilo: 'bridge-ready', v: 1 }, location.origin);

    const ready = await waitFor('ready', (d) => d && d.zilo === 'bridge-ready' && d.v === 1, 5000, popup);
    if (ready.fail && !opts.forceHello) {
      const code = result.coopHeader === 'same-origin' ? 'coop-severed' : ready.fail === 'popup-closed' ? 'popup-closed' : 'bridge-timeout';
      return done({ code, readyFail: ready.fail, popupClosed: popup.closed });
    }
    step(ready.fail ? `ready-${ready.fail}` : 'ready');

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
      return done({ code: 'post-hello-threw', ...errInfo(e) });
    }
    const w = await welcome;
    if (w.fail) return done({ code: ready.fail ? `no-ready-then-${w.fail}` : `welcome-${w.fail}` });
    if (w.d.zilo === 'bridge-error') return done({ code: `bridge-error:${w.d.code}` });
    step('welcome', { sessionId: w.d.sessionId });

    const pending = { next: 1, map: new Map() };
    ch.port1.onmessage = (ev) => { const cb = pending.map.get(ev.data && ev.data.id); if (cb) cb(ev.data); };
    bridge = { popup, port: ch.port1, pending, sessionId: w.d.sessionId };
    const watch = setInterval(() => { if (popup.closed) { state.bridgeState = 'closed'; clearInterval(watch); record('bridge-closed', { detected: true, ms: now() - t0 }); } }, 200);

    const h = await portRequest(ch.port1, pending, 'hello');
    step('op-hello', { ok: h.ok });
    const tb = now();
    const b = await portRequest(ch.port1, pending, 'blob', { size: BLOB_SIZE });
    const blobRes = b.ok
      ? { ok: b.bytes instanceof ArrayBuffer && b.bytes.byteLength === BLOB_SIZE && patternOk(b.bytes), bytes: b.bytes.byteLength, ms: now() - tb }
      : { ok: false, code: b.code };
    step('op-blob', { ok: blobRes.ok });
    const big = await portRequest(ch.port1, pending, 'blob', { size: cfg.maxBridgeBytes + 1 });
    step('op-blob-oversize', { code: big.code });
    const ev = await portRequest(ch.port1, pending, 'events');
    const ticks = (ev.msgs || []).filter((m) => m.event === 'tick').map((m) => m.data.seq);
    step('op-events', { ticks: ticks.length });
    const unknown = await portRequest(ch.port1, pending, 'fetch-arbitrary-url', { url: 'http://example.com/' });

    return done({
      ok: h.ok && blobRes.ok && ticks.length === 5 && big.code === 'too-large' && unknown.code === 'unknown-op',
      sessionId: w.d.sessionId,
      hello: { ok: h.ok, product: h.body && h.body.product },
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
