// SP-1a S2 bridge prototype. Runs as a top-level page on http://127.0.0.1:<port>/bridge,
// opened by the public app with window.open(). It relays typed operations only.
'use strict';
(() => {
  const cfg = JSON.parse(document.getElementById('zilo-bridge-config').textContent);
  const statusEl = document.getElementById('status');
  const sessionEl = document.getElementById('session');
  const PROTOCOL = 1;
  const OPS = new Set(['hello', 'blob', 'events']);
  let bound = null; // { appOrigin, nonce, capability, sessionId, port }
    const rejections = [];

  const setStatus = (s) => { statusEl.textContent = s; };
  const reject = (code, detail) => {
    rejections.push({ code, detail });
    setStatus(`rejected: ${code}`);
  };
  // Exposed for test assertions only (read via the popup page handle).
  window.__ziloBridge = { rejections, get state() { return statusEl.textContent; } };

  const opener = window.opener;
  if (!opener) {
    // No opener: COOP severed it, or the page was opened directly. Fail explicitly.
    setStatus('error: no-opener');
    return;
  }

  window.addEventListener('message', async (ev) => {
    // Exact source, exact origin, then schema. Nothing from anywhere else is processed.
    if (ev.source !== opener) return reject('wrong-source');
    if (!cfg.allowedOrigins.includes(ev.origin)) return reject('origin-not-allowed', ev.origin);
    const m = ev.data;
    if (!m || m.zilo !== 'bridge-hello' || m.v !== PROTOCOL) return reject('bad-schema');
    if (typeof m.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(m.nonce)) return reject('bad-nonce');
    if (typeof m.token !== 'string' || m.token.length > 512) return reject('bad-token-shape');
    if (ev.ports.length !== 1) return reject('no-port');
    if (bound) return reject('already-bound'); // one handshake per page load; reload to re-handshake
    const port = ev.ports[0];
    setStatus('minting');
    let r;
    try {
      r = await fetch('/zilo/v1/bridge/session', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.token}` },
        // The app origin comes from the browser-attested event.origin, never from the message body.
        body: JSON.stringify({ appOrigin: ev.origin, nonce: m.nonce }),
      });
    } catch (e) {
      port.postMessage({ zilo: 'bridge-error', v: PROTOCOL, nonce: m.nonce, code: 'mint-network-error' });
      return reject('mint-network-error', String(e));
    }
    if (!r.ok) {
      const code = (await r.json().catch(() => ({}))).title || `http-${r.status}`;
      port.postMessage({ zilo: 'bridge-error', v: PROTOCOL, nonce: m.nonce, code });
      return reject(code);
    }
    const s = await r.json();
    bound = { appOrigin: ev.origin, nonce: m.nonce, capability: s.capability, sessionId: s.sessionId, port };
    port.onmessage = onOp;
    port.postMessage({ zilo: 'bridge-welcome', v: PROTOCOL, nonce: m.nonce, sessionId: s.sessionId, maxBytes: cfg.maxBytes });
    sessionEl.textContent = s.sessionId;
    setStatus('bound');
  });

  // ---- Typed-op relay over the bound MessagePort (T01 fix r1: strict envelope + flow control) ----
  // Every request is {v, id, sessionId, op, args?}: the protocol version, a unique positive integer
  // request ID and the bound session ID are mandatory. Replies carry {v, id, sessionId}.
  // Flow control: a binary reply holds the single binary slot until the app sends
  // {op:'ack', args:{request: <id>, seq: 1}}; relayed events stop being read once `eventWindow`
  // are unacknowledged, and a consumer silent for `ackTimeoutMs` is cut off (`consumer-stalled`).
  const seenIds = new Set();
  let binarySlot = null; // { request, timer } while one binary reply awaits the app's ack
  const streams = new Map(); // request id -> { sent, acked, wake }

  function invalidEnvelope(m) {
    if (m.v !== PROTOCOL) return 'bad-version';
    if (typeof m.op !== 'string' || m.op.length > 64) return 'bad-op';
    if (m.args !== undefined && (m.args === null || typeof m.args !== 'object' || Array.isArray(m.args))) return 'bad-args';
    return null;
  }

  function onAck(m, reply) {
    const a = m.args || {};
    if (!Number.isSafeInteger(a.request) || !Number.isSafeInteger(a.seq) || a.seq < 1) return reply({ ok: false, code: 'bad-ack' });
    if (binarySlot && binarySlot.request === a.request) {
      clearTimeout(binarySlot.timer);
      binarySlot = null;
      return undefined;
    }
    const st = streams.get(a.request);
    if (st && a.seq <= st.sent) {
      st.acked = Math.max(st.acked, a.seq);
      if (st.wake) st.wake();
      return undefined;
    }
    return reply({ ok: false, code: 'unknown-ack' });
  }

  // Resolves true once fewer than `eventWindow` events are unacknowledged, false after ackTimeoutMs.
  function credit(st) {
    if (st.sent - st.acked < cfg.eventWindow) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { st.wake = null; resolve(false); }, cfg.ackTimeoutMs);
      st.wake = () => {
        if (st.sent - st.acked < cfg.eventWindow) { clearTimeout(timer); st.wake = null; resolve(true); }
      };
    });
  }

  async function onOp(ev) {
    if (!bound) return;
    const m = ev.data;
    const session = bound; // captured: a pagehide may clear `bound` while a fetch is pending
    const port = session.port;
    // Without a valid request ID a reply cannot be correlated: record and drop.
    if (!m || typeof m !== 'object' || !Number.isSafeInteger(m.id) || m.id <= 0) return reject('bad-request-id');
    const reply = (msg, transfer) => port.postMessage({ v: PROTOCOL, id: m.id, sessionId: session.sessionId, ...msg }, transfer || []);
    // Stale or foreign sessions are refused before anything else, including acks and pings.
    if (m.sessionId !== session.sessionId) { reject('session-mismatch'); return reply({ ok: false, code: 'session-mismatch' }); }
    const bad = invalidEnvelope(m);
    if (bad) { reject(bad); return reply({ ok: false, code: bad }); }
    if (seenIds.has(m.id)) { reject('duplicate-request-id'); return reply({ ok: false, code: 'duplicate-request-id' }); }
    seenIds.add(m.id);
    if (m.op === 'ack') return onAck(m, reply);
    if (m.op === 'ping') return reply({ ok: true, pong: true });
    if (!OPS.has(m.op)) return reply({ ok: false, code: 'unknown-op' });
    const headers = { Authorization: `Bearer ${session.capability}`, 'X-Zilo-Bridge-Session': session.sessionId };
    try {
      if (m.op === 'hello') {
        const r = await fetch('/zilo/v1/hello', { cache: 'no-store' });
        return reply({ ok: r.ok, status: r.status, body: await r.json() });
      }
      if (m.op === 'blob') {
        const size = m.args && m.args.size;
        if (!Number.isInteger(size) || size < 0) return reply({ ok: false, code: 'bad-size' });
        if (size > cfg.maxBytes) return reply({ ok: false, code: 'too-large', maxBytes: cfg.maxBytes });
        // One binary reply in flight, released by the app's ack, not by postMessage returning.
        if (binarySlot) return reply({ ok: false, code: 'busy', awaitingAckFor: binarySlot.request });
        const slot = { request: m.id, timer: null };
        binarySlot = slot;
        let sent = false;
        try {
          const r = await fetch(`/zilo/v1/blob?size=${size}`, { cache: 'no-store', headers });
          if (!r.ok) return reply({ ok: false, status: r.status, code: (await r.json()).title });
          const buf = await r.arrayBuffer();
          if (buf.byteLength !== size) return reply({ ok: false, code: 'length-mismatch' });
          // Transfer (not copy) the ArrayBuffer to the app. seq 1 is the only data message.
          reply({ ok: true, seq: 1, bytes: buf }, [buf]);
          sent = true;
          // A consumer that never acks keeps the slot (no further binary is sent). Record it.
          slot.timer = setTimeout(() => { if (binarySlot === slot) rejections.push({ code: 'binary-ack-overdue', detail: m.id }); }, cfg.ackTimeoutMs);
          return undefined;
        } finally {
          if (!sent && binarySlot === slot) binarySlot = null;
        }
      }
      if (m.op === 'events') {
        const r = await fetch('/zilo/v1/events', { cache: 'no-store', headers });
        if (!r.ok) return reply({ ok: false, status: r.status, code: (await r.json()).title });
        const st = { sent: 0, acked: 0, wake: null };
        streams.set(m.id, st);
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const stalled = () => {
          reader.cancel().catch(() => {});
          reject('consumer-stalled', m.id);
          return reply({ ok: false, code: 'consumer-stalled', sent: st.sent, acked: st.acked });
        };
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              // Backpressure: no further event is posted (and the agent stream is not read) while
              // `eventWindow` events are unacknowledged.
              if (!(await credit(st))) return stalled();
              const frame = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const ev2 = /^event: (.*)$/m.exec(frame);
              const data = /^data: (.*)$/m.exec(frame);
              st.sent += 1;
              reply({ ok: true, seq: st.sent, event: ev2 ? ev2[1] : 'message', data: data ? JSON.parse(data[1]) : null });
            }
          }
          return reply({ ok: true, end: true, sent: st.sent });
        } finally {
          streams.delete(m.id);
        }
      }
    } catch (e) {
      return reply({ ok: false, code: 'relay-error', detail: String(e) });
    }
    return undefined;
  }

  // Navigation, reload or closure of this window ends the session explicitly: the app is told on the
  // port (it also has a ping-based liveness check for the cases where this message cannot be sent).
  window.addEventListener('pagehide', () => {
    if (!bound) return;
    try { bound.port.postMessage({ zilo: 'bridge-gone', v: PROTOCOL, sessionId: bound.sessionId, reason: 'pagehide' }); } catch { /* port gone */ }
    bound.port.close();
    bound = null;
  });

  // Announce readiness only to allowlisted origins, each with an exact targetOrigin.
  // The browser delivers the message only if the opener's origin matches, so a hostile opener
  // never learns that a bridge is present.
  function announce() {
    for (const o of cfg.allowedOrigins) {
      try { opener.postMessage({ zilo: 'bridge-ready', v: PROTOCOL }, o); } catch { /* opener gone */ }
    }
    setStatus('waiting-for-handshake');
  }
  // Restored from the back/forward cache after pagehide ended the session: offer a fresh handshake.
  window.addEventListener('pageshow', (e) => { if (e.persisted && !bound) announce(); });
  announce();
})();
