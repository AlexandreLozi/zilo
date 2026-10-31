// T01-r1 regression proofs. These intentionally fail against author head b4e14e1.
// Run with a scratch config whose chromium project includes this new test file.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { APP_ORIGIN, APP_TOKENS } from '../config.ts';
import { chromiumArgs } from '../playwright.config.ts';
import { openPage } from './helpers.ts';

async function bind(page: Page, context: BrowserContext) {
  // Observe the actual app's MessageChannel without changing its protocol or handlers.
  await page.addInitScript(() => {
    const Native = window.MessageChannel;
    window.MessageChannel = class extends Native {
      constructor() {
        super();
        (window as any).__reviewPort = this.port1;
      }
    };
  });
  await openPage(page, `${APP_ORIGIN}/`, APP_TOKENS[APP_ORIGIN]);
  const popupReady = context.waitForEvent('page');
  await page.click('#btn-bridge');
  const popup = await popupReady;
  await page.waitForFunction(() => (window as any).__zilo.results.bridge);
  const result = await page.evaluate(() => (window as any).__zilo.results.bridge);
  expect(result.ok, 'baseline full bridge flow must succeed before probing a defect').toBe(true);
  return popup;
}

test('D-003: a binary request for a different session must not succeed', async ({ page, context }) => {
  await bind(page, context);
  const reply = await page.evaluate(() => new Promise<any>((resolve) => {
    const port = (window as any).__reviewPort as MessagePort;
    port.addEventListener('message', (ev) => {
      if (ev.data?.id === 9001) resolve({ ok: ev.data.ok, sessionId: ev.data.sessionId, bytes: ev.data.bytes?.byteLength });
    });
    port.postMessage({ id: 9001, op: 'blob', sessionId: 'not-the-bound-session', args: { size: 8 } });
  }));
  console.log('wrong-session binary reply:', reply);
  expect(reply.ok, 'D-003 requires request/session IDs and rejection of stale or mismatched sessions').not.toBe(true);
});

test('D-003: navigation of a live popup must invalidate the bound state', async ({ page, context }) => {
  const popup = await bind(page, context);
  await popup.goto('about:blank');
  expect(popup.isClosed()).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as any).__zilo.bridgeState), {
    timeout: 2500,
    message: 'a navigated, unusable bridge must not remain reported as bound',
  }).not.toBe('bound');
});

test('S2: opening the popup must retain the click activation across a slow COOP HEAD response', async ({ playwright }) => {
  const browser = await playwright.chromium.launch({
    channel: 'chromium',
    args: chromiumArgs,
    // Restore the real popup blocker that Playwright normally disables.
    ignoreDefaultArgs: ['--disable-popup-blocking'],
  });
  try {
    const page = await browser.newPage();
    await page.route(`${APP_ORIGIN}/`, async (route) => {
      if (route.request().method() === 'HEAD') {
        // A same-origin network delay is enough to expire Chromium's transient activation.
        await new Promise((resolve) => setTimeout(resolve, 6000));
      }
      await route.continue();
    });
    await openPage(page, `${APP_ORIGIN}/`, APP_TOKENS[APP_ORIGIN]);
    await page.click('#btn-bridge');
    await page.waitForFunction(() => (window as any).__zilo.results.bridge, null, { timeout: 20000 });
    const result = await page.evaluate(() => (window as any).__zilo.results.bridge);
    console.log('real-popup-blocker result:', result);
    expect(result.code, 'the popup must be opened synchronously from the click, before network awaits').not.toBe('popup-blocked');
  } finally {
    await browser.close();
  }
});
