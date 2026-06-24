#!/usr/bin/env bash
# Start the monitor using Node 26 directly (independent of the shell's default node).
set -e
NODE="$HOME/.nvm/versions/node/v26.3.1/bin/node"
[ -x "$NODE" ] || { echo "Node 26 not found at $NODE — run: nvm install node"; exit 1; }
cd "$(dirname "$0")"

# Free the port if a previous instance is still running.
PORT="${PORT:-8787}"
if lsof -ti ":$PORT" >/dev/null 2>&1; then
  echo "Port $PORT in use — stopping old instance…"
  lsof -ti ":$PORT" | xargs kill 2>/dev/null || true
  sleep 1
fi

echo "Starting with $("$NODE" --version)…"
exec "$NODE" server.js
