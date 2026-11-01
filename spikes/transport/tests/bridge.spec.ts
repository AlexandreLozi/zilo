// SP-1a: S2 popup bridge prototype. The app opens http://127.0.0.1:<port>/bridge as a top-level
// popup, handshakes (nonce, exact origins, event.source), gets a MessageChannel, then relays typed
// ops and a bounded ArrayBuffer. No LNA permission is granted in any of these tests.
import { test, type BrowserContext, type Page } from '@playwright/test';
import { APP_ORIGIN, APP_TOKENS, BRIDGE_ACK_TIMEOUT_MS, BRIDGE_EVENT_WINDOW, EVIL_ORIGIN } from '../config.ts';
import { auditMark, auditSince, expect, openPage, saveEvidence, verified } from './helpers.ts';

const TOKEN = APP_TOKENS[APP_ORIGIN];

async function openBridge(page: Page, context: BrowserContext, opts: Record<string, unknown> = {}) {
  await page.evaluate((o) => { (window as any).__ziloOpts = o; delete (window as any).__zilo.results.bridge; }, opts);
  const popupPromise = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  await page.click('#btn-bridge');
  await page.waitForFunction(() => (window as any).__zilo.results.bridge, null, { timeout: 30_000 });
  const popup = await popupPromise;
  let popupState: any = null;
  if (popup) {
    await popup.waitForLoadState().catch(() => {});
    popupState = await popup
      .evaluate(() => ({
        url: location.href,
        status: document.getElementById('status')?.textContent,
        rejections: (window as any).__ziloBridge?.rejections ?? null,
        hasOpener: Boolean(window.opener),
      }))
      .catch((e) => ({ error: String(e) }));
  }
  const r = await page.evaluate(() => ({ bridge: (window as any).__zilo.results.bridge, rejections: (window as any).__zilo.rejections }));
  return { ...r, popup, popupState };
}

/**
 * Keep a handle on the app's own MessageChannel port (test-side observation only; the app's
 * protocol and handlers are unchanged). Must run before openPage.
 */
async function capturePort(page: Page) {
  await page.addInitScript(() => {
    const Native = window.MessageChannel;
    window.MessageChannel = class extends Native {
      constructor() {
        super();
        (window as any).__testPort = this.port1;
      }
    };
  });
}

/** Send one raw envelope on the captured port and collect replies with that id until `until` holds. */
function rawRequest(page: Page, msg: Record<string, unknown>, untilMs: number) {
  return page.evaluate(([m, ms]) => new Promise<any[]>((resolve) => {
    const port = (window as any).__testPort as MessagePort;
    const got: any[] = [];
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (d?.id !== (m as any).id) return;
      got.push({ ok: d.ok, code: d.code, seq: d.seq, end: d.end, event: d.event, sessionId: d.sessionId, v: d.v, bytes: d.bytes?.byteLength });
      if (!d.ok || d.end || d.bytes) { port.removeEventListener('message', onMsg); resolve(got); }
    };
    port.addEventListener('message', onMsg);
    port.postMessage(m);
    setTimeout(() => { port.removeEventListener('message', onMsg); resolve(got); }, ms as number);
  }), [msg, untilMs] as const);
}

const mints = (entries: any[]) => entries.filter((e) => e.path === '/zilo/v1/bridge/session' && e.method === 'POST');

test.describe('S2 popup bridge', () => {
  test('handshake, typed hello relay, bounded ArrayBuffer transfer, SSE relay, closure detection', async ({ page, context, browser, browserName }, info) => {
    const mark = auditMark();
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const { bridge, rejections, popup, popupState } = await openBridge(page, context);
    const minted = mints(auditSince(mark));
    let closed: any = null;
    if (bridge.ok) {
      await page.click('#btn-bridge-close');
      closed = await page
        .waitForFunction(() => (window as any).__zilo.results['bridge-closed'], null, { timeout: 5_000 })
        .then((h) => h.jsonValue())
        .catch(() => null);
    }
    const strict = verified(browserName);
    await saveEvidence(info, page, browser, {
      scenario: 's2-bridge',
      outcome: strict ? (bridge.ok ? 'pass' : 'fail') : 'observed',
      expectation: 'handshake ok without any LNA permission; hello relayed; 1 MiB ArrayBuffer transferred; 5 SSE ticks relayed; oversize refused (too-large); arbitrary op refused',
      observed: { bridge, rejections, popupState, mintStatuses: minted.map((m) => [m.status, m.reason, m.appOrigin]) },
    });
    await saveEvidence(info, page, browser, {
      scenario: 's2-closure',
      outcome: strict ? (closed?.detected ? 'pass' : 'fail') : 'observed',
      expectation: 'app detects bridge window closure explicitly',
      observed: closed,
    });
    if (!strict) return;
    expect(bridge.ok, JSON.stringify(bridge)).toBe(true);
    expect(bridge.blob.bytes).toBe(1024 * 1024);
    expect(bridge.oversize.code).toBe('too-large');
    expect(bridge.unknownOp.code).toBe('unknown-op');
    expect(bridge.events.ticks).toEqual([1, 2, 3, 4, 5]);
    expect(popupState.status).toBe('bound');
    expect(minted).toHaveLength(1);
    expect(minted[0].status).toBe(201);
    expect(minted[0].appOrigin).toBe(APP_ORIGIN);
    expect(minted[0].origin).toBe(`http://127.0.0.1:${new URL(popup!.url()).port}`);
    expect(closed?.detected).toBe(true);
  });

  test('COOP same-origin on the app page: failure is explicit (coop-severed), nothing minted', async ({ page, context, browser }, info) => {
    const mark = auditMark();
    await openPage(page, `${APP_ORIGIN}/coop`, TOKEN);
    const { bridge, popupState } = await openBridge(page, context);
    const minted = mints(auditSince(mark));
    await saveEvidence(info, page, browser, {
      scenario: 's2-coop',
      outcome: bridge.code === 'coop-severed' && minted.length === 0 ? 'pass' : 'fail',
      expectation: 'app reports coop-severed (COOP header detected, opener severed); bridge shows no-opener; no capability minted',
      observed: { bridge, popupState, minted: minted.length },
    });
    expect(bridge.ok).toBe(false);
    expect(bridge.coopHeader).toBe('same-origin');
    expect(bridge.code).toBe('coop-severed');
    expect(minted).toHaveLength(0);
    if (popupState && !popupState.error) expect(popupState.status).toBe('error: no-opener');
  });

  test('COOP same-origin-allow-popups keeps the opener: bridge works', async ({ page, context, browser, browserName }, info) => {
    await openPage(page, `${APP_ORIGIN}/coop-allow-popups`, TOKEN);
    const { bridge, popupState } = await openBridge(page, context);
    const strict = verified(browserName);
    await saveEvidence(info, page, browser, {
      scenario: 's2-coop-allow-popups',
      outcome: strict ? (bridge.ok ? 'pass' : 'fail') : 'observed',
      expectation: 'with COOP same-origin-allow-popups the popup keeps its opener and the full bridge flow passes',
      observed: { ok: bridge.ok, code: bridge.code, coopHeader: bridge.coopHeader, popupStatus: popupState?.status },
    });
    expect(bridge.coopHeader).toBe('same-origin-allow-popups');
    if (strict) expect(bridge.ok, JSON.stringify(bridge)).toBe(true);
  });

  test('hostile opener: bridge never announces itself, rejects a forced hello, mints nothing', async ({ page, context, browser }, info) => {
    const mark = auditMark();
    await openPage(page, `${EVIL_ORIGIN}/`, TOKEN); // even a stolen token must not help
    const { bridge, popupState } = await openBridge(page, context, { forceHello: true });
    const minted = mints(auditSince(mark));
    await saveEvidence(info, page, browser, {
      scenario: 's2-hostile-opener',
      outcome: !bridge.ok && minted.length === 0 && popupState?.rejections?.some((r: any) => r.code === 'origin-not-allowed') ? 'pass' : 'fail',
      expectation: 'no bridge-ready reaches the hostile opener; forced hello rejected (origin-not-allowed); no mint request',
      observed: { bridge, popupState, minted: minted.length },
    });
    expect(bridge.ok).toBe(false);
    expect(bridge.steps.map((s: any) => s.s)).toContain('ready-timeout');
    expect(minted).toHaveLength(0);
    expect(popupState.rejections.map((r: any) => r.code)).toContain('origin-not-allowed');
  });

  test('wrong event.source: a forged bridge-ready from another window is ignored', async ({ page, context, browser, browserName }, info) => {
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const { bridge, rejections } = await openBridge(page, context, { injectFakeReady: true });
    const strict = verified(browserName);
    const rejected = rejections.some((r: any) => r.at === 'ready' && r.code === 'wrong-source');
    await saveEvidence(info, page, browser, {
      scenario: 's2-wrong-source',
      outcome: strict ? (rejected && bridge.ok ? 'pass' : 'fail') : 'observed',
      expectation: 'forged ready (source = app window) rejected as wrong-source; real handshake still completes',
      observed: { rejections, bridgeOk: bridge.ok, code: bridge.code },
    });
    expect(rejected).toBe(true);
    if (strict) expect(bridge.ok).toBe(true);
  });

  test('nonce replay: a second handshake reusing a nonce is refused by the agent', async ({ page, context, browser, browserName }, info) => {
    const mark = auditMark();
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const first = await openBridge(page, context);
    const second = await openBridge(page, context, { nonce: first.bridge.nonce });
    const entries = mints(auditSince(mark));
    const strict = verified(browserName);
    await saveEvidence(info, page, browser, {
      scenario: 's2-nonce-replay',
      outcome: strict ? (first.bridge.ok && second.bridge.code === 'bridge-error:nonce-replayed' ? 'pass' : 'fail') : 'observed',
      expectation: 'reloading the bridge and replaying the nonce yields bridge-error:nonce-replayed (agent 409)',
      observed: { first: { ok: first.bridge.ok, code: first.bridge.code }, second: second.bridge, mintStatuses: entries.map((e) => [e.status, e.reason]) },
    });
    if (!strict) return;
    expect(first.bridge.ok).toBe(true);
    expect(second.bridge.code).toBe('bridge-error:nonce-replayed');
    expect(entries.map((e) => e.status)).toEqual([201, 409]);
  });

  // ---- T01 fix r1 (review findings 2 and 3) ----

  test('session envelope: every op needs version, unique id and the bound session; replies carry the session', async ({ page, context, browser, browserName }, info) => {
    await capturePort(page);
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const { bridge } = await openBridge(page, context);
    const sid = bridge.sessionId as string;
    const strict = verified(browserName);
    const wrongSession = await rawRequest(page, { v: 1, id: 900001, op: 'blob', sessionId: 'not-the-bound-session', args: { size: 8 } }, 3000);
    const noSession = await rawRequest(page, { v: 1, id: 900002, op: 'hello' }, 3000);
    const noVersion = await rawRequest(page, { id: 900003, op: 'hello', sessionId: sid }, 3000);
    const valid = await rawRequest(page, { v: 1, id: 900004, op: 'blob', sessionId: sid, args: { size: 8 } }, 3000);
    await page.evaluate((s) => (window as any).__testPort.postMessage({ v: 1, id: 900005, op: 'ack', sessionId: s, args: { request: 900004, seq: 1 } }), sid);
    const duplicate = await rawRequest(page, { v: 1, id: 900004, op: 'hello', sessionId: sid }, 3000);
    const observed = { bridgeOk: bridge.ok, wrongSession, noSession, noVersion, valid, duplicate };
    const ok = bridge.ok
      && wrongSession[0]?.code === 'session-mismatch' && wrongSession[0]?.bytes === undefined
      && noSession[0]?.code === 'session-mismatch'
      && noVersion[0]?.code === 'bad-version'
      && valid[0]?.ok === true && valid[0]?.bytes === 8 && valid[0]?.sessionId === sid && valid[0]?.v === 1
      && duplicate[0]?.code === 'duplicate-request-id';
    await saveEvidence(info, page, browser, {
      scenario: 's2-session-envelope',
      outcome: strict ? (ok ? 'pass' : 'fail') : 'observed',
      expectation: 'wrong or missing session -> session-mismatch, no bytes; missing version -> bad-version; reused id -> duplicate-request-id; valid request -> 8 bytes with the bound session id',
      observed,
    });
    if (!strict) return;
    expect(ok, JSON.stringify(observed)).toBe(true);
  });

  test('backpressure: an unacknowledged binary reply holds the slot; a stalled event consumer is cut off', async ({ page, context, browser, browserName }, info) => {
    await capturePort(page);
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const { bridge, popup } = await openBridge(page, context);
    const sid = bridge.sessionId as string;
    const strict = verified(browserName);
    const first = await rawRequest(page, { v: 1, id: 910001, op: 'blob', sessionId: sid, args: { size: 4096 } }, 3000);
    // Not acknowledged yet: the bridge must refuse a second binary transfer.
    const whileUnacked = await rawRequest(page, { v: 1, id: 910002, op: 'blob', sessionId: sid, args: { size: 4096 } }, 3000);
    await page.evaluate((s) => (window as any).__testPort.postMessage({ v: 1, id: 910003, op: 'ack', sessionId: s, args: { request: 910001, seq: 1 } }), sid);
    const afterAck = await rawRequest(page, { v: 1, id: 910004, op: 'blob', sessionId: sid, args: { size: 4096 } }, 3000);
    // Events without any ack: at most BRIDGE_EVENT_WINDOW are posted, then consumer-stalled.
    const t0 = Date.now();
    const events = await rawRequest(page, { v: 1, id: 910005, op: 'events', sessionId: sid }, BRIDGE_ACK_TIMEOUT_MS + 6000);
    const stalledAfterMs = Date.now() - t0;
    const popupRejections = await popup?.evaluate(() => (window as any).__ziloBridge.rejections.map((r: any) => r.code)).catch(() => null);
    const delivered = events.filter((e) => e.ok && e.event);
    const last = events[events.length - 1];
    const observed = { first, whileUnacked, afterAck, delivered: delivered.map((e) => e.seq), last, stalledAfterMs, popupRejections };
    const ok = first[0]?.bytes === 4096 && whileUnacked[0]?.code === 'busy' && afterAck[0]?.bytes === 4096
      && delivered.length === BRIDGE_EVENT_WINDOW && last?.code === 'consumer-stalled';
    await saveEvidence(info, page, browser, {
      scenario: 's2-backpressure',
      outcome: strict ? (ok ? 'pass' : 'fail') : 'observed',
      expectation: `second blob refused (busy) until the first is acked; after ack a blob is sent; with no event acks only ${BRIDGE_EVENT_WINDOW} events are posted, then consumer-stalled after ~${BRIDGE_ACK_TIMEOUT_MS} ms`,
      observed,
    });
    if (!strict) return;
    expect(ok, JSON.stringify(observed)).toBe(true);
  });

  test('navigation and reload: bound state is invalidated (notice or ping deadline); reload re-handshakes with a fresh session; reopen recovers', async ({ page, context, browser, browserName }, info) => {
    const mark = auditMark();
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const first = await openBridge(page, context);
    const popup = first.popup!;
    const strict = verified(browserName);
    const stateOf = () => page.evaluate(() => ({ state: (window as any).__zilo.bridgeState, lost: (window as any).__zilo.results['bridge-lost'], reconnect: (window as any).__zilo.results['bridge-reconnect'] }));
    // 1. Reload: the old session is reported lost, then a fresh handshake binds a new session.
    await popup.reload();
    const reloaded = await page.waitForFunction(() => (window as any).__zilo.results['bridge-reconnect'], null, { timeout: 10_000 })
      .then(() => stateOf()).catch(() => stateOf());
    // 2. Navigation away (popup stays open): bound state must be invalidated quickly.
    await page.evaluate(() => { delete (window as any).__zilo.results['bridge-lost']; });
    await popup.goto('about:blank');
    const tNav = Date.now();
    await page.waitForFunction(() => (window as any).__zilo.bridgeState !== 'bound', null, { timeout: 2_500 }).catch(() => {});
    const navigated = { ...(await stateOf()), detectMs: Date.now() - tNav, popupOpen: !popup.isClosed() };
    // 3. Recovery: a new click reopens the bridge in the same window with a fresh handshake.
    const again = await openBridge(page, context);
    // 4. Fallback: with the bridge's pagehide notice suppressed, the ping deadline still detects it.
    await page.evaluate(() => { delete (window as any).__zilo.results['bridge-lost']; });
    // Test-side only: drop the bridge's `bridge-gone` notice, as if the page died without running it.
    const suppressedAt = await popup.evaluate(() => {
      const native = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (this: MessagePort, m: any, t?: any) {
        if (m && m.zilo === 'bridge-gone') return undefined;
        return native.call(this, m, t);
      } as typeof native;
      return location.href;
    });
    await popup.goto('about:blank');
    const tSilent = Date.now();
    await page.waitForFunction(() => (window as any).__zilo.bridgeState !== 'bound', null, { timeout: 5_000 }).catch(() => {});
    const silent = { ...(await stateOf()), detectMs: Date.now() - tSilent, suppressedAt };
    const sessions = [first.bridge.sessionId, reloaded.reconnect?.sessionId, again.bridge.sessionId];
    const minted = mints(auditSince(mark));
    const observed = {
      firstOk: first.bridge.ok, reloaded, navigated, again: { ok: again.bridge.ok, sessionId: again.bridge.sessionId }, silent,
      sessions, mintStatuses: minted.map((m) => m.status),
    };
    const ok = first.bridge.ok
      && reloaded.reconnect?.ok === true && ['pagehide', 'reannounced'].includes(reloaded.lost?.reason) && reloaded.state === 'bound'
      && navigated.state === 'lost' && navigated.popupOpen
      && again.bridge.ok === true
      && silent.state === 'lost' && silent.lost?.reason === 'no-pong'
      && new Set(sessions).size === 3 && minted.length === 3 && minted.every((m) => m.status === 201);
    await saveEvidence(info, page, browser, {
      scenario: 's2-navigation-reconnect',
      outcome: strict ? (ok ? 'pass' : 'fail') : 'observed',
      expectation: 'reload -> bridge-lost (pagehide notice, or the re-announcement) then bridge-reconnect with a new session; navigation to about:blank -> state lost within 2.5 s (popup still open); a new click rebinds; with the pagehide notice suppressed, the ping deadline reports lost (no-pong); three distinct sessions, three 201 mints',
      observed,
    });
    if (!strict) return;
    expect(ok, JSON.stringify(observed)).toBe(true);
  });
});
