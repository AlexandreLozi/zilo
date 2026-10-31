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
  let busy = false;
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

  async function onOp(ev) {
    const m = ev.data;
    const port = bound.port;
    if (!m || typeof m.id !== 'number' || typeof m.op !== 'string') return;
    const reply = (msg, transfer) => port.postMessage({ id: m.id, ...msg }, transfer || []);
    if (!OPS.has(m.op)) return reply({ ok: false, code: 'unknown-op' });
    const auth = { Authorization: `Bearer ${bound.capability}` };
    try {
      if (m.op === 'hello') {
        const r = await fetch('/zilo/v1/hello', { cache: 'no-store' });
        return reply({ ok: r.ok, status: r.status, body: await r.json() });
      }
      if (m.op === 'blob') {
        const size = m.args && m.args.size;
        if (!Number.isInteger(size) || size < 0) return reply({ ok: false, code: 'bad-size' });
        if (size > cfg.maxBytes) return reply({ ok: false, code: 'too-large', maxBytes: cfg.maxBytes });
        if (busy) return reply({ ok: false, code: 'busy' }); // one binary transfer in flight
        busy = true;
        try {
          const r = await fetch(`/zilo/v1/blob?size=${size}`, { cache: 'no-store', headers: auth });
          if (!r.ok) return reply({ ok: false, status: r.status, code: (await r.json()).title });
          const buf = await r.arrayBuffer();
          if (buf.byteLength !== size) return reply({ ok: false, code: 'length-mismatch' });
          // Transfer (not copy) the ArrayBuffer to the app.
          return reply({ ok: true, sessionId: bound.sessionId, bytes: buf }, [buf]);
        } finally { busy = false; }
      }
      if (m.op === 'events') {
        const r = await fetch('/zilo/v1/events', { cache: 'no-store', headers: auth });
        if (!r.ok) return reply({ ok: false, status: r.status, code: (await r.json()).title });
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev2 = /^event: (.*)$/m.exec(frame);
            const data = /^data: (.*)$/m.exec(frame);
            reply({ ok: true, event: ev2 ? ev2[1] : 'message', data: data ? JSON.parse(data[1]) : null });
          }
        }
        return reply({ ok: true, end: true });
      }
    } catch (e) {
      return reply({ ok: false, code: 'relay-error', detail: String(e) });
    }
  }

  // Announce readiness only to allowlisted origins, each with an exact targetOrigin.
  // The browser delivers the message only if the opener's origin matches, so a hostile opener
  // never learns that a bridge is present.
  for (const o of cfg.allowedOrigins) {
    try { opener.postMessage({ zilo: 'bridge-ready', v: PROTOCOL }, o); } catch { /* opener gone */ }
  }
  setStatus('waiting-for-handshake');
})();
