#!/usr/bin/env bash
# Dev mode: same compatible Node as start.sh, but via nodemon so backend code
# edits auto-restart the server. We invoke nodemon's JS entry with our chosen
# Node directly — running ./node_modules/.bin/nodemon would use the PATH node
# (often an old one) and the SDK would throw "Object not disposable".
set -e
cd "$(dirname "$0")"
source "$(dirname "$0")/scripts/pick-node.sh"   # sets $NODE

echo "Dev (nodemon) with $("$NODE" --version)…"
exec "$NODE" node_modules/nodemon/bin/nodemon.js server.js
