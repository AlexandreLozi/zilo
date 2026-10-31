// SP-1a: S2 popup bridge prototype. The app opens http://127.0.0.1:<port>/bridge as a top-level
// popup, handshakes (nonce, exact origins, event.source), gets a MessageChannel, then relays typed
// ops and a bounded ArrayBuffer. No LNA permission is granted in any of these tests.
import { test, type BrowserContext, type Page } from '@playwright/test';
import { APP_ORIGIN, APP_TOKENS, EVIL_ORIGIN } from '../config.ts';
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
});
