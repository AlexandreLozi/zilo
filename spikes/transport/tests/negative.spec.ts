// SP-1a negative controls: hostile origin, DNS-rebinding Host, HTTP (insecure) page, forged bridge
// mint, and a methodology control proving the "public" address-space override is what makes LNA
// apply (a page served from loopback would hide the constraint).
import { test } from '@playwright/test';
import { AGENT_PORT, APP_ORIGIN, APP_TOKENS, EVIL_ORIGIN, HTTP_CONTROL_ORIGIN } from '../config.ts';
import { chromiumArgs, firefoxPrefs, REBIND_HOST } from '../playwright.config.ts';
import { ensureCerts } from '../scripts/gen-certs.ts';
import { auditMark, auditSince, expect, openPage, queryPermissions, run, saveEvidence, verified } from './helpers.ts';

async function tryGrant(context: any, origin: string): Promise<string> {
  try {
    await context.grantPermissions(['local-network-access'], { origin });
    return 'granted';
  } catch (e) {
    return `not grantable: ${(e as Error).message.split('\n')[0]}`;
  }
}

test.describe('negative controls', () => {
  test('hostile HTTPS origin is denied by the agent (even with LNA granted)', async ({ page, context, browser, browserName }, info) => {
    const grant = await tryGrant(context, EVIL_ORIGIN);
    const mark = auditMark();
    await openPage(page, `${EVIL_ORIGIN}/`, APP_TOKENS[APP_ORIGIN]);
    const hello = await run(page, 'hello-tas', 'hello-tas');
    const blob = await run(page, 'blob', 'blob');
    const seen = auditSince(mark).filter((e) => e.origin === EVIL_ORIGIN);
    const strict = verified(browserName);
    const serverDenied = seen.length > 0 && seen.every((e) => e.decision === 'deny' && e.reason === 'origin-denied');
    await saveEvidence(info, page, browser, {
      scenario: 'neg-hostile-origin',
      outcome: !hello.ok && !blob.ok && (serverDenied || (!strict && seen.length === 0)) ? 'pass' : 'fail',
      expectation: 'agent answers 403 origin-denied without CORS headers; page cannot read anything',
      observed: { grant, hello, blob, audit: seen.map((e) => [e.method, e.path, e.status, e.reason]) },
    });
    expect(hello.ok).toBe(false);
    expect(blob.ok).toBe(false);
    if (strict) expect(serverDenied).toBe(true);
    for (const e of seen) expect(e.reason).toBe('origin-denied');
  });

  test('bad Host (DNS rebinding name -> 127.0.0.1) is denied by the agent', async ({ page, browser }, info) => {
    const mark = auditMark();
    const url = `http://${REBIND_HOST}:${AGENT_PORT}/zilo/v1/hello`;
    const resp = await page.goto(url).catch((e) => e as Error);
    const seen = auditSince(mark).filter((e) => e.host === `${REBIND_HOST}:${AGENT_PORT}`);
    const status = resp instanceof Error ? `error: ${resp.message.split('\n')[0]}` : resp?.status();
    await saveEvidence(info, page, browser, {
      scenario: 'neg-bad-host',
      outcome: seen.length > 0 && seen.every((e) => e.status === 403 && e.reason === 'host-denied') ? 'pass' : 'fail',
      expectation: 'agent refuses Host rebind.zilo.test:<port> with 403 host-denied',
      observed: { status, audit: seen.map((e) => [e.method, e.path, e.host, e.status, e.reason]) },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const e of seen) {
      expect(e.status).toBe(403);
      expect(e.reason).toBe('host-denied');
    }
  });

  test('HTTP (insecure) page as a control', async ({ page, context, browser, browserName }, info) => {
    // The HTTP origin is allowlisted in the stub on purpose: any failure here is browser policy.
    const grant = await tryGrant(context, HTTP_CONTROL_ORIGIN);
    await openPage(page, `${HTTP_CONTROL_ORIGIN}/`, APP_TOKENS[HTTP_CONTROL_ORIGIN]);
    const env = await page.evaluate(() => (window as any).__zilo.results.env);
    const perms = await queryPermissions(page);
    const hello = await run(page, 'hello-tas', 'hello-tas');
    const observed = { grant, isSecureContext: env.isSecureContext, permissions: perms, hello };
    let outcome: 'pass' | 'fail' | 'observed' = 'observed';
    let expectation = 'record what an insecure page can do';
    if (browserName === 'chromium') {
      expectation = 'LNA permission cannot be granted to an insecure context; loopback fetch blocked';
      outcome = grant.startsWith('not grantable') && !hello.ok && !hello.timedOut ? 'pass' : 'fail';
    } else if (browserName === 'firefox') {
      expectation = 'Firefox 157 lets an insecure page reach loopback once the permission is granted (finding, not a requirement)';
      outcome = grant === 'granted' && hello.ok ? 'pass' : 'fail';
    }
    await saveEvidence(info, page, browser, { scenario: 'neg-http-control', outcome, expectation, observed });
    expect(env.isSecureContext).toBe(false);
    if (browserName === 'chromium') {
      expect(grant).toContain("can't be granted");
      expect(hello.ok).toBe(false);
      expect(hello.timedOut).toBe(false);
    }
    if (browserName === 'firefox') {
      expect(grant).toBe('granted');
      expect(hello.ok).toBe(true);
    }
  });

  test('forged bridge mint from the public page is refused', async ({ page, context, browser, browserName }, info) => {
    const grant = await tryGrant(context, APP_ORIGIN);
    const mark = auditMark();
    await openPage(page, `${APP_ORIGIN}/`, APP_TOKENS[APP_ORIGIN]);
    const forged = await run(page, 'forge-mint', 'forge-mint');
    const seen = auditSince(mark).filter((e) => e.path === '/zilo/v1/bridge/session' && e.method === 'POST');
    const strict = verified(browserName);
    await saveEvidence(info, page, browser, {
      scenario: 'neg-forged-mint',
      outcome: !forged.ok && seen.every((e) => e.reason === 'mint-requires-bridge-origin') ? 'pass' : 'fail',
      expectation: 'agent refuses a mint whose browser-set Origin is not the bridge origin (403)',
      observed: { grant, forged, audit: seen.map((e) => [e.status, e.reason, e.origin]) },
    });
    expect(forged.ok).toBe(false);
    if (strict && browserName !== 'webkit') {
      expect(forged.status).toBe(403);
      expect(forged.code).toBe('mint-requires-bridge-origin');
    }
    for (const e of seen) expect(e.reason).toBe('mint-requires-bridge-origin');
  });

  test('methodology control: without the public address-space override, LNA does not apply', async ({ playwright, browserName }, info) => {
    test.skip(browserName === 'webkit', 'WebKit has no LNA (n/a)');
    const b = browserName === 'chromium'
      ? await playwright.chromium.launch({ channel: 'chromium', args: chromiumArgs.filter((a) => !a.startsWith('--ip-address-space-overrides')) })
      : await playwright.firefox.launch({
        env: { ...process.env, PLAYWRIGHT_FIREFOX_POLICIES_JSON: ensureCerts().firefoxPolicies },
        firefoxUserPrefs: Object.fromEntries(Object.entries(firefoxPrefs).filter(([k]) => !k.startsWith('network.lna.address_space'))),
      });
    const page = await (await b.newContext()).newPage();
    await openPage(page, `${APP_ORIGIN}/`, APP_TOKENS[APP_ORIGIN]);
    const perms = await queryPermissions(page);
    const hello = await run(page, 'hello-tas', 'hello-tas');
    await saveEvidence(info, page, b, {
      scenario: 'control-no-override',
      outcome: hello.ok && perms['loopback-network'] === 'prompt' ? 'pass' : 'fail',
      expectation: 'page resolved to 127.0.0.1 without the override is loopback -> loopback: fetch succeeds with no permission, so tests on a loopback page would hide LNA',
      observed: { permissions: perms, hello },
    });
    await b.close();
    expect(hello.ok).toBe(true);
    expect(perms['loopback-network']).toBe('prompt');
  });
});
