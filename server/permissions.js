// Permission bridge: an agent's canUseTool asks here; we resolve immediately by
// policy (safe auto, full auto, read-only deny) or hold the Promise until the UI
// answers via /api/perm.

import crypto from 'node:crypto';
import { SAFE_TOOLS, PERM_TIMEOUT_MS } from './config.js';
import { broadcast } from './sse.js';
import { agents, listAgents } from './state.js';

// reqId -> { resolve, agentId, tool_name, input, timer }
export const pendingPerms = new Map();

export function resolvePerm(reqId, verdict) {
    const p = pendingPerms.get(reqId);
    if (!p) return false;
    clearTimeout(p.timer);
    pendingPerms.delete(reqId);
    const a = agents.get(p.agentId);
    if (a) {
        a.perms = a.perms.filter((x) => x.id !== reqId);
        broadcast('agents', listAgents());
    }
    broadcast('perm-resolved', { id: reqId, behavior: verdict.behavior });
    p.resolve(verdict);
    return true;
}

// Returns a Promise<PermissionResult> for the SDK's canUseTool callback.
export function checkPerm({ agentId, tool_name, input, tool_use_id }) {
    return new Promise((resolve) => {
        const a = agents.get(agentId);
        if (a && a.trust === 'full') return resolve({ behavior: 'allow', updatedInput: input });
        if (SAFE_TOOLS.has(tool_name)) return resolve({ behavior: 'allow', updatedInput: input });
        if (a && a.trust === 'readonly') return resolve({ behavior: 'deny', message: 'agent is read-only' });

        const reqId = crypto.randomUUID();
        const timer = setTimeout(
            () => resolvePerm(reqId, { behavior: 'deny', message: 'permission timed out' }),
            PERM_TIMEOUT_MS,
        );
        pendingPerms.set(reqId, { resolve, agentId, tool_name, input, timer });
        const req = { id: reqId, agentId, tool_name, input, tool_use_id, ts: new Date().toISOString() };
        if (a) a.perms.push(req);
        broadcast('perm-request', req);
        broadcast('agents', listAgents());
    });
}
