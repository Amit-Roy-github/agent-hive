#!/usr/bin/env bash
# Start the monitor on a compatible Node (>= 22), independent of the shell's
# default node. The Claude Agent SDK needs Symbol.asyncDispose (Node >= 22) or
# every agent fails with "TypeError: Object not disposable".
set -e
cd "$(dirname "$0")"
source "$(dirname "$0")/scripts/pick-node.sh"   # sets $NODE

echo "Starting with $("$NODE" --version)…"

# Free the port if a previous instance is still running.
PORT="${PORT:-8787}"
if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "Port $PORT in use — stopping old instance…"
  lsof -ti ":$PORT" | xargs kill 2>/dev/null || true
  sleep 1
fi

exec "$NODE" server.js
