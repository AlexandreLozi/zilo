// SP-1a: HTTPS public page -> http://127.0.0.1 loopback fetch, SSE over fetch streaming, binary,
// and the permission states each browser exposes.
import { test } from '@playwright/test';
import { APP_ORIGIN, APP_TOKENS } from '../config.ts';
import { chromiumArgs, firefoxPrefs } from '../playwright.config.ts';
import { ensureCerts } from '../scripts/gen-certs.ts';
import { auditMark, auditSince, chromiumDeny, expect, openPage, queryPermissions, run, saveEvidence, verified } from './helpers.ts';

const TOKEN = APP_TOKENS[APP_ORIGIN];

test.describe('loopback fetch from an HTTPS public origin', () => {
  test('page is a secure context on a non-loopback public origin', async ({ page, browser, browserName }, info) => {
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const env = await page.evaluate(() => (window as any).__zilo.results.env);
    await saveEvidence(info, page, browser, {
      scenario: 'env',
      outcome: env.isSecureContext && env.origin === APP_ORIGIN ? 'pass' : 'fail',
      expectation: 'page loads from https://app.zilo.test, isSecureContext=true',
      observed: env,
      notes: browserName === 'webkit' ? 'WebKit TLS: ignoreHTTPSErrors unless ZILO_WEBKIT_TRUST=system' : undefined,
    });
    expect(env.origin).toBe(APP_ORIGIN);
    expect(env.isSecureContext).toBe(true);
  });

  test('default permission state (prompt): never silently allowed', async ({ page, browser, browserName }, info) => {
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const before = await queryPermissions(page);
    const hello = await run(page, 'hello-tas', 'hello-tas');
    const after = await queryPermissions(page);
    const observed = { before, hello, after };
    if (browserName === 'chromium') {
      // New-headless Chromium auto-denies the prompt (an automation artifact; see the headful test).
      expect(before['loopback-network']).toBe('prompt');
      expect(hello.ok).toBe(false);
      expect(hello.error).toBe('TypeError');
      expect(after['loopback-network']).toBe('denied');
    } else if (browserName === 'firefox') {
      // Firefox holds the request while its doorhanger waits for the user; the page aborts at 6 s.
      expect(before['loopback-network']).toBe('prompt');
      expect(hello.ok).toBe(false);
      expect(hello.timedOut).toBe(true);
      expect(after['loopback-network']).toBe('prompt');
    } else if (verified(browserName)) {
      // Playwright WebKit answers the query with `prompt` but has no prompt: the HTTPS page's
      // loopback fetch is refused immediately (see the hello rows).
      expect(before['loopback-network']).toBe('prompt');
      expect(hello.error).toBe('TypeError');
      expect(hello.timedOut).toBe(false);
    }
    await saveEvidence(info, page, browser, {
      scenario: 'perm-prompt',
      outcome: browserName === 'webkit' ? 'n/a' : 'pass',
      expectation: browserName === 'webkit'
        ? 'WebKit exposes no LNA permission; see fetch rows for what it does with no prompt'
        : 'request is held (prompt) or refused, never silently allowed',
      observed,
    });
  });

  test('default permission state, headful Chromium: request held on a real prompt', async ({ playwright, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'Chromium-specific: checks the headless auto-deny artifact');
    // Owner directive OD-4: no visible browser windows. Headful runs only on an explicit virtual
    // display (xvfb-run sets it; see the workflow and README), with Wayland removed from the env.
    const virtualDisplay = process.env.ZILO_HEADFUL_DISPLAY;
    test.skip(!virtualDisplay, 'needs ZILO_HEADFUL_DISPLAY (a virtual X display from xvfb-run)');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'WAYLAND_DISPLAY') env[k] = v;
    env.DISPLAY = virtualDisplay!;
    const b = await playwright.chromium.launch({
      channel: 'chromium', headless: false, env, args: [...chromiumArgs, '--ozone-platform=x11'],
    });
    const page = await (await b.newContext()).newPage();
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const before = await queryPermissions(page);
    const hello = await run(page, 'hello-tas', 'hello-tas');
    const after = await queryPermissions(page);
    await saveEvidence(info, page, b, {
      scenario: 'perm-prompt-headful',
      outcome: hello.timedOut && after['loopback-network'] === 'prompt' ? 'pass' : 'fail',
      expectation: 'headful: request pending on the permission prompt (page aborts at 6 s); state stays prompt',
      observed: { before, hello, after },
    });
    await b.close();
    expect(before['loopback-network']).toBe('prompt');
    expect(hello.timedOut).toBe(true);
    expect(after['loopback-network']).toBe('prompt');
  });

  test('granted: hello with/without targetAddressSpace, SSE over fetch streaming, 1 MiB blob', async ({ page, context, browser, browserName }, info) => {
    let grant = 'granted via context.grantPermissions(local-network-access)';
    try {
      await context.grantPermissions(['local-network-access'], { origin: APP_ORIGIN });
    } catch (e) {
      grant = `not grantable: ${(e as Error).message.split('\n')[0]}`;
    }
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const perms = await queryPermissions(page);
    const mark = auditMark();
    const helloTas = await run(page, 'hello-tas', 'hello-tas');
    const helloPlain = await run(page, 'hello-plain', 'hello-plain');
    const events = await run(page, 'events', 'events');
    const blob = await run(page, 'blob', 'blob');
    const env = await page.evaluate(() => (window as any).__zilo.results.env);
    const reachedAgent = auditSince(mark).length;
    const strict = verified(browserName);
    const rows: Array<[string, any, string]> = [
      ['hello-tas', helloTas, "fetch(..., {targetAddressSpace:'loopback'}) returns 200"],
      ['hello-plain', helloPlain, 'same fetch without the option returns 200'],
      ['sse-fetch-stream', events, '5 SSE ticks read incrementally through fetch streaming with Authorization'],
      ['blob', blob, '1 MiB binary body, pattern verified'],
    ];
    for (const [scenario, r, expectation] of rows) {
      await saveEvidence(info, page, browser, {
        scenario,
        outcome: strict ? (r.ok ? 'pass' : 'fail') : 'observed',
        expectation,
        observed: { result: r, permissions: perms, grant, targetAddressSpace: env.tas, requestsSeenByAgent: reachedAgent },
        notes: browserName === 'webkit'
          ? 'Playwright WebKit (not Safari): blocked before any request reaches the agent, consistent with mixed-content blocking of http://127.0.0.1'
          : undefined,
      });
    }
    if (browserName === 'webkit') {
      if (strict) {
        // Expected failure (observed in Playwright WebKit 27.2): blocked immediately, never sent.
        expect(grant).toContain('Unknown permission');
        for (const [, r] of rows) {
          expect(r.ok).toBe(false);
          expect(r.error).toBe('TypeError');
          expect(r.timedOut).toBe(false);
        }
        expect(reachedAgent).toBe(0);
      }
      return;
    }
    expect(perms['loopback-network']).toBe('granted');
    for (const [, r] of rows) expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(events.ticks).toEqual([1, 2, 3, 4, 5]);
    expect(events.incremental).toBe(true);
    expect(blob.bytes).toBe(1024 * 1024);
  });

  test('denied: request refused immediately', async ({ browser, browserName, playwright }, info) => {
    test.skip(browserName === 'webkit', 'WebKit exposes no LNA permission (n/a)');
    if (browserName === 'chromium') {
      const context = await browser.newContext();
      const page = await context.newPage();
      await chromiumDeny(browser, context, page, APP_ORIGIN, ['loopback-network', 'local-network']);
      await openPage(page, `${APP_ORIGIN}/`, TOKEN);
      const perms = await queryPermissions(page);
      const hello = await run(page, 'hello-tas', 'hello-tas');
      await saveEvidence(info, page, browser, {
        scenario: 'perm-denied',
        outcome: perms['loopback-network'] === 'denied' && hello.error === 'TypeError' && !hello.timedOut ? 'pass' : 'fail',
        expectation: 'denied via CDP Browser.setPermission: query reports denied, fetch fails fast',
        observed: { permissions: perms, hello },
      });
      expect(perms['loopback-network']).toBe('denied');
      expect(hello.error).toBe('TypeError');
      expect(hello.timedOut).toBe(false);
      await context.close();
      return;
    }
    // Firefox: deny through permission-default prefs (Playwright cannot deny on Firefox).
    const b = await playwright.firefox.launch({
      env: { ...process.env, PLAYWRIGHT_FIREFOX_POLICIES_JSON: ensureCerts().firefoxPolicies },
      firefoxUserPrefs: { ...firefoxPrefs, 'permissions.default.loopback-network': 2, 'permissions.default.local-network': 2 },
    });
    const page = await (await b.newContext()).newPage();
    await openPage(page, `${APP_ORIGIN}/`, TOKEN);
    const perms = await queryPermissions(page);
    const hello = await run(page, 'hello-tas', 'hello-tas');
    await saveEvidence(info, page, b, {
      scenario: 'perm-denied',
      outcome: hello.error === 'TypeError' && !hello.timedOut ? 'pass' : 'fail',
      expectation: 'denied via permissions.default.* prefs: fetch fails fast',
      observed: { permissions: perms, hello },
      notes: 'permissions.query still reports "prompt" under a pref-level default deny: the SDK cannot rely on query alone',
    });
    await b.close();
    expect(hello.error).toBe('TypeError');
    expect(hello.timedOut).toBe(false);
    expect(perms['loopback-network']).toBe('prompt');
  });
});
