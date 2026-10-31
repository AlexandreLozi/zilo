#!/usr/bin/env bash
# Runs the T05 prototype checks: copy-table coverage + sync, and an axe scan of every prototype state
# in light and dark themes. Not wired into any workflow on purpose (T05 constraint).
# Usage: design/prototypes/check/run.sh            (installs playwright + axe-core into check/.deps once)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
deps="$here/.deps"
if [ ! -d "$deps/node_modules/playwright" ] || [ ! -d "$deps/node_modules/axe-core" ]; then
  mkdir -p "$deps"
  npm install --prefix "$deps" --no-save --no-package-lock --silent playwright@1.64.1 axe-core@4.14.0 >/dev/null
fi
if ! NODE_PATH="$deps/node_modules" node -e "require('playwright').chromium.executablePath()" >/dev/null 2>&1 \
   || [ ! -x "$(NODE_PATH="$deps/node_modules" node -e "process.stdout.write(require('playwright').chromium.executablePath())")" ]; then
  "$deps/node_modules/.bin/playwright" install chromium
fi
NODE_PATH="$deps/node_modules" node "$here/check.cjs" "$@"
