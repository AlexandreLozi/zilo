# T15 local evidence (WSL host, Node 24.22.2, pnpm 11.17.0)

| Step | Log | Result |
|---|---|---|
| `pnpm install --frozen-lockfile && pnpm license-check && pnpm format:check && pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` | `local-acceptance.log` | pass, run with every `dist/` deleted first (as on CI). Licence gate: 161 packages; axe-core / @axe-core/playwright (MPL-2.0) are dev-only. Unit tests: ui 25, react 6, catalog 3, demo 1, sdk 1, dwt-compat 1, license-gate 10 |
| `CI=1 pnpm e2e` (all three browsers) | `local-e2e-all-browsers.log` (trimmed) | Chromium and Firefox pass (catalog 116, demo 2). Every WebKit test fails to launch because the host is missing libraries (libgtk-4, gstreamer, …). That is a host limitation, not a test result |
| Catalog e2e, Chromium only | `local-e2e-catalog-chromium.log` | 58 passed: 47 axe pages (23 states × 2 themes + index) and 11 dialog keyboard/theme tests |
| Demo e2e, Chromium only | `local-e2e-demo-chromium.log` | 1 passed |

Hosted `ci-web` (ubuntu-latest, `playwright install --with-deps`) is the WebKit evidence.

## Fix r1 (Node 24.22.2, pnpm 11.17.0)

| Step | Log | Result |
|---|---|---|
| Same acceptance chain, every `dist/` deleted first | `local-acceptance-fix-r1.log` | pass. Licence gate: 186 packages (Radix, React and their deps are catalog devDependencies; `tslib` is 0BSD, allowlisted). Unit tests: ui 34, react 10, catalog 3, demo 1, sdk 1, dwt-compat 1, license-gate 10 |
| `CI=1 pnpm e2e` | `local-e2e-fix-r1-webkit-blocked.log` | the demo's WebKit launch fails first (missing host libraries, as before), which stops the recursive run |
| `CI=1` Playwright per app, Chromium + Firefox | `local-e2e-fix-r1-chromium-firefox.log` | catalog 144 passed (72 per browser: 49 axe pages, 11 dialog keyboard/theme, 2 review-r1 proofs, 10 host-modal), demo 2 passed, none flaky |
| Negative control (not kept as a log) | — | with the r1 `dialog.ts` restored, 4 host-modal tests fail in Chromium (Escape, outside click, focus hand-off, ancestor pointer-events); the two new React ordering tests fail without `transitions` |

Hosted `ci-web` remains the WebKit evidence.
