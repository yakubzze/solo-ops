#!/bin/sh
# macOS: run `chmod +x start.command` once, then double-click it in Finder.
cd "$(dirname "$0")" || exit 1

[ -d node_modules ] || npm install --no-audit --no-fund
[ -d dist ] || npm run build

node server/index.mjs
