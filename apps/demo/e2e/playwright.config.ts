import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Serves the production build, so run `pnpm build` first.
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${String(port)}`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
