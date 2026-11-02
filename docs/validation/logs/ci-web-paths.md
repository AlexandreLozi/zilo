# ci-web push path filter — validation log

Task: `docs/tasks/ci-web-paths.md` (DeepSeek author, OD-11; GPT reviewer).
Change: `.github/workflows/ci-web.yml` only. No hosted run needed; the branch is pushed without a PR.

## What changed

1. `push: branches: [main]` now carries the **same** `paths:` list as `pull_request`, so docs-only
   pushes to `main` no longer start (and cancel) a billed `ci-web` run.
2. `'.gitignore'` added to **both** lists: the licence-gate step runs
   `pnpm license-check`, whose lint uses `--ignore-path ../../.gitignore`, so editing `.gitignore`
   must re-run the gate.
3. Both lists are byte-identical and in the same order. A YAML anchor was considered and rejected:
   `on.*.paths` anchors are not a documented, runner-supported pattern for trigger filters, so the
   list is duplicated (the task allows this).
4. `workflow_dispatch`, `permissions`, `concurrency` and the `web` job (13 steps) are unchanged.

Diff: 13 insertions, 0 deletions, one file.

## Parse validation

`actionlint` is not installed in this environment and PyYAML is absent, so the workflow was parsed
with the YAML parser already present on the machine (`js-yaml@4.1.1`, bundled with a global tool;
nothing installed, no new project dependency):

```sh
node -e '
const yaml = require("<global>/node_modules/js-yaml");
const doc = yaml.load(require("fs").readFileSync(".github/workflows/ci-web.yml","utf8"));
...'
```

Output:

```
YAML parse: OK
on.push.branches: ["main"]
push.paths count: 11 pr.paths count: 11
identical & same order: true
has .gitignore: true
workflow_dispatch: null
permissions: {"contents":"read"}
concurrency: {"group":"ci-web-${{ github.ref }}","cancel-in-progress":true}
jobs: web steps: 13
```

## Truth table

Sample changed-file lists matched against the 11 globs with GitHub Actions filter semantics
(`*`/`?` never cross `/`; `**` crosses `/`). A workflow run is triggered when **any** changed file
matches **any** glob.

| changed files | ci-web runs? |
|---|---|
| `docs/planning/PLAN.md` (docs-only) | **false** |
| `docs/planning/DECISIONS.md`, `docs/validation/logs/x.md` (docs-only) | **false** |
| `package.json` | **true** |
| `pnpm-lock.yaml` | **true** |
| `pnpm-workspace.yaml` | **true** |
| `.nvmrc` | **true** |
| `tsconfig.json` | **true** |
| `tsconfig.base.json` | **true** |
| `eslint.config.js` | **true** |
| `eslint.config.mjs` | **true** |
| `.prettierrc` | **true** |
| `.prettierignore` | **true** |
| `.gitignore` | **true** |
| `packages/core/src/index.ts` | **true** |
| `packages/README.md` | **true** |
| `apps/demo/src/App.tsx` | **true** |
| `apps/README.md` | **true** |
| `.github/workflows/ci-web.yml` | **true** |
| `docs/planning/PLAN.md` + `packages/core/src/index.ts` (mixed) | **true** |
| `docs/planning/PLAN.md` + `apps/demo/src/App.tsx` (mixed) | **true** |
| `docs/planning/PLAN.md` + `.gitignore` (mixed) | **true** |
| `README.md` | **false** |
| `AGENTS.md` | **false** |
| `scripts/foo.mjs` | **false** |
| `.github/workflows/ci-api.yml` | **false** |
| `docs/package.json` (nested, not a listed root file) | **false** |

Notes:
- `docs/package.json` stays **false**: the globs are anchored to the repository root, so only a
  root `package.json` matches. This is the pre-existing `pull_request` behaviour and is unchanged
  by this task.
- Push events on `main` now behave exactly like pull requests for this workflow. `workflow_dispatch`
  is untouched, so the workflow can still be run manually on any commit.

## Not done / out of scope

- No `actionlint` run (binary not installed; installing it is a new dependency and out of scope).
- No hosted run: the branch is pushed without a PR by design, to avoid a billed macOS/ubuntu run.
