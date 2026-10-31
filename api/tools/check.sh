#!/usr/bin/env bash
# T10 observable acceptance for the contract. Headless, no browser.
#   1. Redocly lint (pinned) of api/openapi.yaml.
#   2. In a scratch dir OUTSIDE the repo: openapi-typescript (pinned) generates TS types, and
#      they compile with `tsc --strict` (TypeScript 6.0.3, the web lane's pin, and 5.9.3, the
#      generator's peer).
#   3. The schema and rule tests in api/tests/ (node:test), with pinned yaml, ajv and
#      ajv-formats installed in the same scratch dir.
set -euo pipefail

REDOCLY_CLI=2.72.1
OPENAPI_TS=7.13.0
TS_GEN=5.9.3
TS_WEB=6.0.3
YAML_PKG=2.8.1
AJV=8.17.1
AJV_FORMATS=3.0.1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api="$(dirname "$here")"
spec="$api/openapi.yaml"

echo "== redocly lint (@redocly/cli@$REDOCLY_CLI)"
npx --yes "@redocly/cli@$REDOCLY_CLI" lint "$spec" --config "$api/redocly.yaml"

scratch="$(mktemp -d "${TMPDIR:-/tmp}/zilo-t10-types.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
echo "== scratch dir: $scratch"
cd "$scratch"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund --ignore-scripts --save-exact \
  "openapi-typescript@$OPENAPI_TS" "typescript@$TS_GEN" "ts-web@npm:typescript@$TS_WEB" \
  "yaml@$YAML_PKG" "ajv@$AJV" "ajv-formats@$AJV_FORMATS"

echo "== openapi-typescript@$OPENAPI_TS"
npx --no-install openapi-typescript "$spec" -o zilo-api.ts
cp "$here/consumer.ts" consumer.ts

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": false
  },
  "files": ["zilo-api.ts", "consumer.ts"]
}
JSON

echo "== tsc --strict (typescript@$TS_WEB)"
node node_modules/ts-web/bin/tsc -p tsconfig.json --strict
echo "== tsc --strict (typescript@$TS_GEN)"
node node_modules/typescript/bin/tsc -p tsconfig.json --strict

echo "== schema and rule tests (node --test api/tests)"
T10_TEST_DEPS="$scratch" node --test "$api"/tests/*.test.mjs
echo "OK: lint passed; generated types compile under --strict ($(wc -l < zilo-api.ts) lines); tests passed"
