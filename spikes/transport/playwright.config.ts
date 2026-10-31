// SP-1a Playwright configuration. Throwaway spike code.
//
// How the HTTPS test origin is made "public" and non-loopback without touching the OS:
//   Chromium: --host-resolver-rules maps *.zilo.test to the local page server;
//             --ignore-certificate-errors-spki-list trusts the per-run leaf (treated as valid, no
//             interstitial); --ip-address-space-overrides marks the page server as `public`, so
//             LNA sees a public -> loopback request, as in production.
//   Firefox:  network.dns.localDomains maps *.zilo.test to loopback; the Certificates enterprise
//             policy (PLAYWRIGHT_FIREFOX_POLICIES_JSON) installs the per-run CA; the
//             network.lna.address_space.public.override pref marks the page server as public.
//   WebKit:   no host-resolver switch, so a spike-only resolver proxy (scripts/resolver-proxy.ts) maps
//             *.zilo.test to 127.0.0.1; it changes name resolution only, not the page URL or origin.
//             TLS uses ignoreHTTPSErrors by default (no OS trust-store change needed); every test
//             records isSecureContext so this deviation is visible. ZILO_WEBKIT_TRUST=system uses the
//             OS store instead (the CI job installs the CA there first).
//             WebKit has no LNA permission in Playwright: permission rows are n/a.
import { defineConfig } from '@playwright/test';
import {
  AGENT_PORT, APP_HOST, APP_HTTP_PORT, APP_HTTPS_PORT, EVIL_HOST,
} from './config.ts';
import { ensureCerts } from './scripts/gen-certs.ts';
import { PROXY_PORT } from './scripts/resolver-proxy-port.ts';

const certs = ensureCerts();
export const REBIND_HOST = 'rebind.zilo.test';
const mapped = [APP_HOST, EVIL_HOST, REBIND_HOST];
const publicEndpoints = [`127.0.0.1:${APP_HTTPS_PORT}`, `127.0.0.1:${APP_HTTP_PORT}`];

export const chromiumArgs = [
  `--host-resolver-rules=${mapped.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`,
  `--ignore-certificate-errors-spki-list=${certs.leafSpkiSha256}`,
  `--ip-address-space-overrides=${publicEndpoints.map((e) => `${e}=public`).join(',')}`,
];

export const firefoxPrefs: Record<string, string | number | boolean> = {
  'network.dns.localDomains': mapped.join(','),
  'network.lna.address_space.public.override': publicEndpoints.join(','),
};

const webkitIgnoreTls = process.env.ZILO_WEBKIT_TRUST !== 'system';
const browserTests = ['**/fetch.spec.ts', '**/bridge.spec.ts', '**/negative.spec.ts'];

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1, // one shared agent stub with a shared audit log
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/playwright-report.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
  webServer: [
    {
      command: 'node agent-stub/server.ts',
      url: `http://127.0.0.1:${AGENT_PORT}/zilo/v1/hello`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'node app/server.ts',
      url: `http://127.0.0.1:${APP_HTTP_PORT}/healthz`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'node scripts/resolver-proxy.ts',
      port: PROXY_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
  projects: [
    {
      // Direct HTTP tests of the stub's Host/Origin/bearer/bridge-mint rules. No browser.
      name: 'stub',
      testMatch: '**/stub-http.spec.ts',
    },
    {
      name: 'chromium',
      testMatch: browserTests,
      use: {
        browserName: 'chromium',
        // Full Chrome for Testing in new headless mode, not the headless shell.
        channel: 'chromium',
        launchOptions: { args: chromiumArgs },
      },
    },
    {
      name: 'firefox',
      testMatch: browserTests,
      use: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: firefoxPrefs,
          env: { ...process.env, PLAYWRIGHT_FIREFOX_POLICIES_JSON: certs.firefoxPolicies },
        },
      },
    },
    {
      name: 'webkit',
      testMatch: browserTests,
      use: {
        browserName: 'webkit',
        ignoreHTTPSErrors: webkitIgnoreTls,
        proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
      },
    },
  ],
});
