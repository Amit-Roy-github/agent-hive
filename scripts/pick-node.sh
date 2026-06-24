# Resolve a Node >= 22 into $NODE. Prefers 25 (what we run), then 26/24/23/22.
# Used by start.sh and dev.sh so neither ever falls back to the shell's old node.
# If a usable node is already on PATH (>= 22) we keep it.

_node_major() { "$1" -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null; }

NODE=""

# 1) honour an explicit override
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then NODE="$NODE_BIN"; fi

# 2) prefer an installed nvm version, newest-first (25 = our pinned major)
if [ -z "$NODE" ]; then
  for v in 25 26 24 23 22; do
    for d in "$HOME/.nvm/versions/node/v$v".*; do
      [ -x "$d/bin/node" ] && { NODE="$d/bin/node"; break 2; }
    done
  done
fi

# 3) fall back to PATH node only if it is new enough
if [ -z "$NODE" ] && command -v node >/dev/null 2>&1; then
  [ "$(_node_major node)" -ge 22 ] 2>/dev/null && NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  echo "✖ No Node >= 22 found (need it for the Claude Agent SDK)." >&2
  echo "  Install one:  nvm install 25   then re-run." >&2
  exit 1
fi
