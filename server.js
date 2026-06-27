#!/usr/bin/env node
// Agent Monitor — a control panel for Claude Code agents (Claude Agent SDK),
// plus a passive tail of ~/.claude/projects sessions and watched files.
// This entry just wires the modules under server/ together.

import { PORT, HOST, CLAUDE_PROJECTS_DIR } from './server/config.js';
import { primeCache, startPolling, cache } from './server/sessions.js';
import { loadAgents, stopAllAgents } from './server/agents.js';
import { createServer } from './server/http.js';

// Hard requirement: the Claude Agent SDK uses Symbol.asyncDispose (Node ≥ 22).
// On older Node every query() throws "TypeError: Object not disposable", which
// surfaces as agents that silently refuse to start or resume. Fail loud instead.
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 22) {
    console.error(`\n  ✖ agent-deck needs Node ≥ 22 — you are on ${process.version}.`);
    console.error(`    The Claude Agent SDK relies on Symbol.asyncDispose (absent before Node 22),`);
    console.error(`    so spawning/resuming agents fails with "TypeError: Object not disposable".`);
    console.error(`    Fix: nvm use 25   (or run ./start.sh, which pins a compatible Node).\n`);
    process.exit(1);
}
console.log(`  node:     ${process.version}`);

primeCache(); // tail existing sessions/files (no SSE clients yet)
loadAgents(); // restore UI-created agents (resume-ready) after the cache is primed
startPolling();

const server = createServer();
server.listen(PORT, HOST, () => {
    console.log(`\n  Agent Deck`);
    console.log(`  watching: ${CLAUDE_PROJECTS_DIR}`);
    console.log(`  sessions: ${cache.size}`);
    console.log(`  open:     http://${HOST}:${PORT}\n`);
});

function shutdown() {
    stopAllAgents();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// last-resort net: a local monitor should never die from one bad agent/stream
process.on('uncaughtException', (err) => console.error('[uncaught]', (err && err.stack) || err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
