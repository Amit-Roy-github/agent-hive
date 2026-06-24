// Shared agent registry. Lives in its own module so both agents.js and
// permissions.js can touch it without importing each other (no cycle).

// agentId -> { id, name, color, cwd, model, trust, status, sessionId, q, input, entries[], perms[], ... }
export const agents = new Map();

// The browser-safe view of an agent (no live process handles).
export function publicAgent(a) {
    return {
        id: a.id,
        name: a.name,
        color: a.color,
        cwd: a.cwd,
        model: a.model,
        trust: a.trust,
        status: a.status,
        ctx: a.ctx || null,
        sessionId: a.sessionId,
        createdAt: a.createdAt,
        lastTs: a.lastTs,
        msgs: a.entries.length,
        pending: a.perms.length,
        exitCode: a.exitCode ?? null,
    };
}

export function listAgents() {
    return [...agents.values()].map(publicAgent).sort((x, y) => x.createdAt - y.createdAt);
}
