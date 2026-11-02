# ci-web push paths — GPT review r2

**Verdict: pass.** Cross-family review of DeepSeek's fix at
`4048e10067217c87cfc2b412e6d32e57315e5ad6`, delta
`20586b7..4048e10` (2026-11-02). No blocking findings remain.

## Numbered findings and r1 disposition

1. **Closed — r1 #1 (P1), SDK contract input.** Both lists now explicitly
   include `api/openapi.yaml` (`.github/workflows/ci-web.yml:16,31`). The SDK
   `vitest run` script executes `packages/sdk/src/contract.test.ts:15-17`, which
   reads that exact file and checks its hash. API-only and API-plus-docs cases
   now match.
2. **Closed — r1 #2 (P2), root formatting input.** Both lists start with the
   quoted `'*'` (`:7,22`), covering `AGENTS.md`. Root `format:check` remains
   `prettier --check .`; `AGENTS.md` remains outside the formatter ignores.
3. **Closed — r1 #3 (P2), added root npm configuration.** The same root catch-all
   covers an addition-only `.npmrc` change, as well as future root configuration
   and README files. No separate `'.*'` pattern is necessary.
4. **P3, non-blocking — validation-log explanation has two imprecisions.**
   `docs/validation/logs/ci-web-paths.md`, “Root `*` and dotfiles”, incorrectly
   says `.gitignore` wildcards deliberately exclude leading dots: Git ignore
   patterns do match leading dots. Also, `@actions/glob` is a runner-side file
   glob library, not proof of GitHub's server-side trigger implementation.
   Neither issue changes the correct filter result; use the workflow-syntax
   reference below as the basis and remove the misleading comparison when the
   log is next maintained. No workflow correction is requested.

## Independent checks

- Read the r1 review and the coordinator-specified fix task in the main checkout;
  inspected the complete two-file delta, all 13 workflow steps, workspace
  manifests/scripts and TypeScript/Vite/Playwright configs, ESLint configuration,
  formatter ignores, licence-gate reads, and SDK filesystem reads.
- GitHub's [Filter pattern cheat sheet](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#filter-pattern-cheat-sheet),
  retrieved through its article-body API on 2026-11-02, says `*` matches zero or
  more characters except `/`, and path patterns must match the whole path from
  the repository root. A leading `.` is not excluded. Thus `*` covers `.npmrc`,
  `.gitignore`, and root Markdown files, but not `.claude/settings.json` or any
  file inside `docs/`. The quoted YAML form is correct.
- Parsed current and base workflows with the already-installed
  `/home/alexandre/.config/opencode/node_modules/yaml` and Node strict assertions.
  Both **13-pattern lists are identical and ordered identically**; push branches
  remain `[main]`. The entire jobs object (13 steps), permissions, concurrency,
  and manual dispatch are structurally unchanged against both `20586b7` and
  original main `c92524f`. The text delta changes only the two trigger lists and
  the evidence log.
- An independent anchored conversion of the submitted patterns (`*` → `[^/]*`,
  `**` → `.*`) passed **59 individual/mixed-file assertions**. In addition,
  **636 tracked paths** under `docs/`, `design/`, `backend/`, `spikes/`, and
  `packaging/` all remained false; **130 conservative root/workspace/workflow
  inputs** all matched. These are static checks of documented semantics, not
  hosted trigger evidence.

## Input-coverage recheck

| Job input or scope | Coverage |
|---|---|
| pnpm version, Node version, lockfile, workspace config, root configs | Root `*` and retained explicit entries |
| Workspace source, manifests, licence policy, all build/test/config files | `packages/**`, `apps/**` |
| Root Prettier scope | All root files match `*`; workspace trees match; workflow exception matches explicitly |
| SDK contract hash source | Explicit `api/openapi.yaml` |
| Workflow/action pins and artifact paths | Workflow itself covered; artifact paths are workspace outputs |

`.prettierignore` excludes `docs/`, `design/`, `backend/`, `packaging/`,
`spikes/`, `tools/`, `api/`, agent-config subtrees, and other workflows; its only
workflow reinclusion is `ci-web.yml`, explicitly covered. Root ignored files
being over-included by `*` is the task's intentional trade-off. Workspace lint
scripts read the covered root `.gitignore` and `.prettierignore`; TypeScript
extends the covered root base config. The licence gate reads its covered policy
and the covered workspace dependency graph, not `tools/license-gate/` or the
documentation exception pointer. SDK generated JSON/hash inputs live under
`packages/`; the only external SDK file read found is `api/openapi.yaml`.
`docs/validation/logs/T13/` is an optional performance-test output, not an input;
the SDK generation script is not invoked by these CI scripts. Both active E2E
configs and their application inputs live under `apps/`. No remaining uncovered
current ci-web input was found.

`git diff --check 20586b7..4048e10` passed. No dependency installation, hosted
run, application test/build suite, or PR was performed. This review writes only
this report; merge and any subsequent CI disposition remain with the coordinator.
