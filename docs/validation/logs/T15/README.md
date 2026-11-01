# T15 local evidence (WSL host, Node 24.22.2, pnpm 11.17.0)

| Step | Log | Result |
|---|---|---|
| `pnpm install --frozen-lockfile && pnpm license-check && pnpm format:check && pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` | `local-acceptance.log` | pass, run with every `dist/` deleted first (as on CI). Licence gate: 161 packages; axe-core / @axe-core/playwright (MPL-2.0) are dev-only. Unit tests: ui 25, react 6, catalog 3, demo 1, sdk 1, dwt-compat 1, license-gate 10 |
| `CI=1 pnpm e2e` (all three browsers) | `local-e2e-all-browsers.log` (trimmed) | Chromium and Firefox pass (catalog 116, demo 2). Every WebKit test fails to launch because the host is missing libraries (libgtk-4, gstreamer, …). That is a host limitation, not a test result |
| Catalog e2e, Chromium only | `local-e2e-catalog-chromium.log` | 58 passed: 47 axe pages (23 states × 2 themes + index) and 11 dialog keyboard/theme tests |
| Demo e2e, Chromium only | `local-e2e-demo-chromium.log` | 1 passed |

Hosted `ci-web` (ubuntu-latest, `playwright install --with-deps`) is the WebKit evidence.
