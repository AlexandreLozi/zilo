# ci-web push path filter — validation log

Task: `docs/tasks/ci-web-paths.md` (DeepSeek author, OD-11; GPT reviewer), plus the review r1 fix
`docs/tasks/ci-web-paths-fix-r1.md` (DeepSeek author; GPT reviewer).
Change: `.github/workflows/ci-web.yml` only. No hosted run needed; the branch is pushed without a PR.

## What changed

1. `push: branches: [main]` now carries the **same** `paths:` list as `pull_request` (base task), so
   docs-only pushes to `main` no longer start (and cancel) a billed `ci-web` run.
2. `'.gitignore'` added to **both** lists (base task): the licence-gate step runs
   `pnpm license-check`, whose lint uses `--ignore-path ../../.gitignore`, so editing `.gitignore`
   must re-run the gate.
3. `'api/openapi.yaml'` added to **both** lists (review r1, P1): `packages/sdk/src/contract.test.ts`
   reads the root API contract and compares its SHA-256 with the generated SDK hash, and that test
   runs in the `Unit tests` step. Without this pattern an API-only change skipped the very check
   that detects a stale generated SDK.
4. `'*'` added at the top of **both** lists (review r1, P2 #2 and #3): `*` matches every file
   directly at the repository root because it does not cross `/`. It covers the root formatting
   input `AGENTS.md` (read by `pnpm format:check` → `prettier --check .`), a future `.npmrc`
   (consumed by `pnpm install --frozen-lockfile`), and any future root config or README. The
   explicit entries are kept for documentation value even where `*` subsumes them.
5. Both lists are byte-identical (13 patterns) and in the same order. A YAML anchor was considered
   and rejected: `on.*.paths` anchors are not a documented, runner-supported pattern for trigger
   filters, so the list is duplicated (the task allows this).
6. `workflow_dispatch`, `permissions`, `concurrency` and the `web` job (13 steps) are unchanged.

Diff against the review commit `20586b7`: 4 insertions, 0 deletions, one file.

Final ordered lists (identical for `push` and `pull_request`):

```text
'*'
'package.json'
'pnpm-lock.yaml'
'pnpm-workspace.yaml'
'.nvmrc'
'tsconfig*.json'
'eslint.config.*'
'.prettier*'
'.gitignore'
'api/openapi.yaml'
'packages/**'
'apps/**'
'.github/workflows/ci-web.yml'
```

## Root `*` and dotfiles (review r1 requirement)

The task asked for confirmation that GitHub's filter glob matches root dotfiles with `*`, citing
the GitHub docs. Confirmed:

- GitHub's "Filter pattern cheat sheet" (Workflow syntax for GitHub Actions) defines only two
  path-relevant wildcards: `*` "Matches zero or more characters, but does not match the `/`
  character", and `**` "Matches zero or more of any character". The cheat sheet states no exception
  for names beginning with `.`, unlike `.gitignore`, where `*` deliberately does not match a leading
  dot. `.npmrc` is a root-level name without `/`, so it matches `*` under the documented rule.
- Supporting implementation evidence from GitHub's own glob engine: `@actions/glob`
  (`actions/toolkit`, `packages/glob/src/internal-pattern.ts`) builds its `Minimatch` with
  `dot: true`, and its default options set `excludeHiddenFiles: false`
  (`internal-glob-options-helper.ts`). GitHub's glob matching therefore does not hide dot-prefixed
  names from `*`.
- Consequence: `'.*'` was **not** added. It would be redundant: `.*` is itself `*`-matching (a
  leading dot is just a character), so it can only restate the same coverage. If a later behaviour
  check on hosted GitHub ever shows the opposite, the fallback in the task spec is a one-line add.
- Dotfiles in subdirectories are unaffected: `*` never crosses `/`, so e.g. `.claude/settings.json`
  still does not match. Only root-level names are covered.

## Parse validation

`actionlint` is not installed in this environment and PyYAML is absent, so the workflow was parsed
with the YAML parser already present on the machine (`yaml` bundled with the global OpenCode install;
nothing installed, no new project dependency), and the globs were exercised with an anchored
glob→regex conversion of the documented semantics.

```sh
node /tmp/opencode/ciweb-check.mjs   # parser from /home/alexandre/.config/opencode/node_modules/yaml
```

Output:

```text
YAML parse: OK
on.push.branches: ["main"]
push.paths count: 13 pr.paths count: 13
identical & same order: true
has .gitignore: true
has api/openapi.yaml: true
has root *: true
workflow_dispatch: null
permissions: {"contents":"read"}
concurrency: {"group":"ci-web-${{ github.ref }}","cancel-in-progress":true}
jobs: web steps: 13
... 33/33 truth-table cases ok ...
ALL CASES PASS
```

The workflow file is itself a formatting input (`/.github/workflows/*` is ignored but
`!/.github/workflows/ci-web.yml` re-includes it), so it was also checked with a Prettier binary
already in the local npm cache (3.9.6; the repo pins 3.9.10), using the repo `.prettierrc.json`:
`prettier --check .github/workflows/ci-web.yml` → `All matched files use Prettier code style!`.
`docs/` is in `.prettierignore`, so this log is not a formatting input.

## Truth table

Sample changed-file lists matched against the 13 globs with GitHub Actions filter semantics
(`*`/`?` never cross `/`; `**` does; `*` matches leading dots at the root). A workflow run is
triggered when **any** changed file matches **any** glob.

| Changed files | ci-web runs? | Note |
|---|---|---|
| `docs/**` only (`docs/planning/PLAN.md`, `docs/validation/logs/x.md`) | **false** | `*` cannot cross `/` |
| `design/**` only | **false** | |
| `backend/**` only | **false** | |
| `spikes/**` only | **false** | |
| `packaging/**` only | **false** | |
| `api/openapi.yaml` | **true** | r1 P1 |
| `api/openapi.yaml` + `docs/planning/PLAN.md` (mixed) | **true** | r1 P1 |
| `AGENTS.md` | **true** | r1 P2 #2 (prettier reads it) |
| `.npmrc` (added) | **true** | r1 P2 #3 (install reads it) |
| `README.md` | **true** | via `*` |
| `CLAUDE.md` | **true** | via `*` (Prettier-ignored, so not a formatting input) |
| `package.json` | **true** | existing input |
| `pnpm-lock.yaml` | **true** | existing input |
| `pnpm-workspace.yaml` | **true** | existing input |
| `.nvmrc` | **true** | existing input |
| `tsconfig.json`, `tsconfig.base.json` | **true** | existing input |
| `eslint.config.js`, `eslint.config.mjs` | **true** | existing input |
| `.prettierrc.json`, `.prettierignore` | **true** | existing input |
| `.gitignore` | **true** | existing input |
| `packages/core/src/index.ts`, `packages/README.md` | **true** | existing input |
| `apps/demo/src/App.tsx`, `apps/README.md` | **true** | existing input |
| `.github/workflows/ci-web.yml` | **true** | existing input |
| `docs/planning/PLAN.md` + `packages/core/src/index.ts` (mixed) | **true** | mixed docs + input |
| `docs/planning/PLAN.md` + `.gitignore` (mixed) | **true** | mixed docs + input |
| `scripts/foo.mjs` | **false** | no tracked file, no executed reference |
| `.github/workflows/ci-api.yml` | **false** | other workflow |
| `docs/package.json` (nested, not a listed root file) | **false** | `*` is root-anchored |
| `.claude/settings.json` | **false** | nested; `*` cannot cross `/` |

Notes:

- `docs/package.json` stays **false**: the globs are anchored to the repository root, so only a
  root `package.json` matches. This is the pre-existing `pull_request` behaviour and is unchanged
  by this task.
- Deliberate over-inclusion from `*`: any root-level file change now runs ci-web, including files
  this job does not read (`Directory.Build.props`, `Directory.Packages.props`). That is the accepted
  trade-off of a single root catch-all: an ubuntu run is cheap, and a missed root input is a silent
  bypass. Subdirectory configs stay out (`api/CONTRACT.md`, `api/redocly.yaml` are not inputs of
  this job).
- Push events on `main` now behave exactly like pull requests for this workflow. `workflow_dispatch`
  is untouched, so the workflow can still be run manually on any commit.

## Not done / out of scope

- No `actionlint` run (binary not installed; installing it is a new dependency and out of scope).
- No hosted run: the branch is pushed without a PR by design, to avoid a billed macOS/ubuntu run.
  The truth table is a static description of the submitted filters, not hosted evidence; the
  cross-family reviewer may re-verify the globs independently.
