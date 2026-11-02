# ci-web push paths — GPT review r1

**Verdict: changes.** Cross-family review of DeepSeek-authored
`6e243765fc0613e64e56d8c787a154a359748284`, against `origin/main`
`c92524f5453e715faeeca9f3cc852a2adb57b083` (2026-11-02).

## Numbered findings

1. **P1 — The SDK contract's actual source input is missing from both filters.**
   `.github/workflows/ci-web.yml:6-30` does not match `api/openapi.yaml`.
   The unit-test step (`:70-71`) runs `packages/sdk/package.json:23` (`vitest run`),
   and `packages/sdk/src/contract.test.ts:15-17` reads that root API file and
   compares its SHA-256 with the generated SDK hash. An API-only main push,
   including a breaking contract edit without regeneration, now skips the check
   that would detect the mismatch. The existing PR omission does not make it safe
   to remove the main backstop. Add `api/openapi.yaml` to both ordered lists and
   test API-only and API-plus-docs cases as **true**.

2. **P2 — The root formatting step reads an uncovered, tracked file: `AGENTS.md`.**
   `.github/workflows/ci-web.yml:61-62` invokes `package.json:18`,
   `prettier --check .`, not a command restricted to `packages/` and `apps/`.
   Root `AGENTS.md` is tracked, supported by Prettier's Markdown formatter, and
   excluded by neither `.prettierignore` nor `.gitignore`. Both trigger lists
   omit it; the author's truth table explicitly marks it **false**. A formatting
   regression confined to this file therefore bypasses the main check. Include
   this actual formatting input in both lists and change that acceptance row to
   **true**. Alternatively, explicitly narrow the formatting command in a
   separately approved task; changing the job is outside this task's scope.

3. **P2 — Adding root `.npmrc` bypasses the install backstop.**
   The install step (`.github/workflows/ci-web.yml:55-56`) consumes repository
   npm/pnpm registry configuration, but neither list includes `.npmrc`. There is
   no tracked `.npmrc` at this head; this finding concerns its addition, not a
   claim that an existing file was missed. A commit adding `.npmrc` alone can
   change registry/authentication configuration used by the frozen install yet
   skip ci-web on both PR and main. Add `.npmrc` to both lists and an addition-only
   case to the truth table. Existing `pnpm-workspace.yaml` settings are covered.

## Checks and evidence

- Read the task specification, all 13 job steps, all workspace package scripts,
  licence-gate CLI/policy references, root pnpm configuration, ESLint/TypeScript
  references, both active Playwright configs, SDK file reads, and formatter
  ignore files. Inspected the complete author delta (workflow +13 lines and
  validation log +92 lines).
- Parsed current and base workflow with the already-installed
  `/home/alexandre/.config/opencode/node_modules/yaml` via Node; installed no
  dependency. Assertions passed: the 11 push and PR patterns are identical and
  ordered identically, both include `.gitignore`, and push branches remain
  `[main]`. `workflow_dispatch`, `permissions`, `concurrency`, and the complete
  jobs object are structurally unchanged. The textual diff likewise contains
  only the requested trigger additions, not job changes.
- Independently matched the author's sample paths with anchored glob conversion
  (`*` does not cross `/`, `**` does). All listed sample results are accurate
  **descriptions of the submitted filters**; the table is not sufficient input
  coverage evidence. Important additional/current cases:

  | Changed files | Submitted filter | Required for complete input coverage |
  |---|---|---|
  | `docs/planning/PLAN.md` | false | false |
  | `.gitignore` | true | true |
  | `packages/license-gate/policy.json` | true | true |
  | `apps/demo/e2e/playwright.config.ts` | true | true |
  | `apps/catalog/e2e/playwright.config.ts` | true | true |
  | `api/openapi.yaml` | false | true |
  | docs plus `api/openapi.yaml` | false | true |
  | `AGENTS.md` | false | true |
  | added `.npmrc` | false | true |
  | docs plus `.gitignore` | true | true |

- `packages/license-gate/src/cli.ts:7-9` reads its covered `policy.json`; its
  recursive licence report uses the covered workspace manifests and lockfile.
  All package lint scripts read covered root `.gitignore` and `.prettierignore`.
  Both active Playwright configurations and their test/application dependencies
  are inside `apps/**`. `spikes/transport/playwright.config.ts` is not used by
  this job. Root `scripts/**` has no tracked files and no executed script
  reference; `packages/sdk/scripts/gen-types.sh` is covered by `packages/**` and
  is not automatically invoked by this job. The optional performance-test
  `docs/validation/logs/T13/` path is an output, not a read input.
- `git diff --check origin/main...6e24376` passed. `actionlint` is unavailable.
  No install/build/test suite or hosted workflow was run; this is a bounded
  static trigger/input review, not replacement application-test evidence.

## Disposition

Preserve the unchanged jobs/security/concurrency settings. Address the missing
inputs in both lists and extend the validation table before merge; review-only
changes in this branch are limited to this report.
