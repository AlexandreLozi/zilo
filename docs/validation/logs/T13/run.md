# T13 SDK core: local run log

- Base: `t10-contract` @ `f3ba120`, merged with `origin/main` @ `ec28324` (the T10 base predates
  the T04a web workspace, so `packages/sdk` and `package.json` were missing). `api/**` is identical
  to `f3ba120`; `pnpm-lock.yaml` is identical to `main`.
- Toolchain: Node 24.22.2, pnpm 11.17.0 (`pnpm install --frozen-lockfile`).
- Types: `packages/sdk/scripts/gen-types.sh` (openapi-typescript 7.13.0, yaml 2.8.1, as pinned in
  `api/tools/check.sh`), spec SHA-256 `73c86eb1ab77acf948b0f50fb06bfcad285d41987a8ffcfeaf3389f6a0402247`.
- Gate (repo root): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`: all exit 0.
  `@zilo/sdk`: 7 test files, 100 tests passed. Other packages unchanged (dwt-compat 1, license-gate
  10, ui 1, demo 1).
- Detection timings (PLAN §8, recorded, not gated): `detection-timings.json`, written by
  `ZILO_T13_RECORD=1 pnpm --filter @zilo/sdk test`. In-process mock, so SDK overhead only: ready
  p95 1.23 ms (target 300 ms), refused-port verdict p95 0.37 ms, hung-port verdict 1.50 s (target
  2 s; bounded by the 1.5 s parallel probe timeout). Real loopback numbers belong to T23.
