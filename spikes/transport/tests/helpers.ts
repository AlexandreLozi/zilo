// Shared helpers for the SP-1a browser tests. Throwaway spike code.
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AUDIT_LOG, SPIKE_DIR } from '../config.ts';

export type Results = Record<string, any>;

/** Committed evidence: evidence/<os>/<project>/<scenario>.{json,jpg}. */
export function evidenceDir(info: TestInfo): string {
  const dir = `${SPIKE_DIR}evidence/${process.platform}/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface Evidence {
  scenario: string;
  outcome: 'pass' | 'fail' | 'n/a' | 'observed';
  expectation: string;
  observed: unknown;
  notes?: string;
}

/**
 * Write JSON evidence and a screenshot of the page (the on-page log shows the raw results).
 * Credentials never appear: the token input is a password field and results carry no tokens.
 */
export async function saveEvidence(info: TestInfo, page: Page | null, browser: Browser | null, ev: Evidence): Promise<void> {
  const dir = evidenceDir(info);
  const file = `${dir}/${ev.scenario}`;
  const payload = {
    ...ev,
    project: info.project.name,
    os: process.platform,
    browserVersion: browser ? browser.version() : null,
    playwright: info.config.version,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(`${file}.json`, JSON.stringify(payload, null, 2) + '\n');
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${file}.jpg`, type: 'jpeg', quality: 60, fullPage: true }).catch(() => {});
  }
  info.annotations.push({ type: 'evidence', description: `${ev.scenario}: ${ev.outcome} (${ev.expectation})` });
  console.log(`[evidence] ${info.project.name}/${process.platform} ${ev.scenario}: ${ev.outcome} :: ${JSON.stringify(ev.observed)}`);
}

export async function openPage(page: Page, url: string, token?: string): Promise<void> {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(url);
  if (token) await page.fill('#token', token);
}

/** Click a scenario button (a trusted user gesture) and wait for its recorded result. */
export async function run(page: Page, button: string, resultKey: string, timeout = 20_000): Promise<any> {
  await page.click(`#btn-${button}`);
  await page.waitForFunction((k) => (window as any).__zilo.results[k], resultKey, { timeout });
  return page.evaluate((k) => (window as any).__zilo.results[k], resultKey);
}

export async function queryPermissions(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => { delete (window as any).__zilo.results.permissions; });
  return run(page, 'perm', 'permissions');
}

export async function results(page: Page): Promise<Results> {
  return page.evaluate(() => (window as any).__zilo.results);
}

/** Byte offset into the audit log, so a test reads only its own entries. */
export function auditMark(): number {
  return readFileSync(AUDIT_LOG).length;
}

export function auditSince(mark: number): any[] {
  const text = readFileSync(AUDIT_LOG).subarray(mark).toString('utf8').trim();
  return text ? text.split('\n').map((l) => JSON.parse(l)) : [];
}

/** Chromium only: force a permission to `denied` for one origin in one context via CDP. */
export async function chromiumDeny(browser: Browser, context: BrowserContext, page: Page, origin: string, names: string[]): Promise<void> {
  const pageSession = await context.newCDPSession(page);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');
  const browserSession = await browser.newBrowserCDPSession();
  for (const name of names) {
    await browserSession.send('Browser.setPermission', {
      permission: { name },
      setting: 'denied',
      origin,
      browserContextId: targetInfo.browserContextId,
    });
  }
}

/**
 * Platforms where the encoded expectations were observed at least once. Elsewhere a browser test
 * records what it sees and only asserts browser-independent invariants (server-side denials, the
 * bridge's own checks). WebKit on Linux and macOS stays observe-only until a run there is recorded.
 */
export function verified(browserName: string): boolean {
  if (browserName !== 'webkit') return true;
  return (process.env.ZILO_WEBKIT_VERIFIED ?? 'win32').split(',').includes(process.platform);
}

export { expect };
