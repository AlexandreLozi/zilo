# @zilo/license-gate

Default-deny licence gate for the npm dependency graph of the web workspace (D-002). Run it from the
repository root with `pnpm license-check`; CI (`ci-web`) runs it after install.

- It reads `pnpm licenses list --json --recursive` (whole graph) and the same with `--prod`.
- Every package must have a licence expression satisfied by `policy.json` `allowed`. Packages that
  are only in the development graph may also use `devOnlyAllowed` (for example MPL-2.0 build tools).
- Unknown, missing or unparsable licences fail. GPL, AGPL, LGPL and SSPL can never be allowlisted;
  the only way through is a version-specific `exceptions` entry backed by a reviewed record in
  `docs/legal/exceptions.md`.
