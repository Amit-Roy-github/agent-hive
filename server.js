#!/usr/bin/env node
// Agent Monitor — a control panel for Claude Code agents (Claude Agent SDK),
// plus a passive tail of ~/.claude/projects sessions and watched files.
// This entry just wires the modules under server/ together.

import { PORT, HOST, CLAUDE_PROJECTS_DIR } from './server/config.js';
import { primeCache, startPolling, cache } from './server/sessions.js';
import { loadAgents, stopAllAgents } from './server/agents.js';
import { createServer } from './server/http.js';

primeCache(); // tail existing sessions/files (no SSE clients yet)
loadAgents(); // restore UI-created agents (resume-ready) after the cache is primed
startPolling();

const server = createServer();
server.listen(PORT, HOST, () => {
    console.log(`\n  Agent Monitor`);
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
