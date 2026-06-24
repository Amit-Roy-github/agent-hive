// Active side: each agent is a Claude Agent SDK query() in streaming-input mode.
// We spawn, drive, stop, resume, adopt sessions, and persist agents across reboots.

import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { TRUST_MODE, AGENTSFILE, ACTIVE_WINDOW_MS, expand } from './config.js';
import { broadcast } from './sse.js';
import { agents, listAgents } from './state.js';
import { checkPerm, resolvePerm, pendingPerms } from './permissions.js';
import { fullTranscript, cache } from './sessions.js';
import { normalize, decodeProject } from './normalize.js';

// ---- logging --------------------------------------------------------------
// One-line, timestamped server logs for the agent lifecycle. Show up in the
// terminal (and nodemon) so spawn/resume/SDK failures are debuggable at a glance.
const ts = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(`[${ts()}] [agent]`, ...a);
const logErr = (...a) => console.error(`[${ts()}] [agent]`, ...a);

// ---- persistence ----------------------------------------------------------
// Save durable metadata only (live process/entries are runtime). A sessionId is
// required — that's what makes a saved agent resumable.
export function persistAgents() {
    const data = [...agents.values()]
        .filter((a) => a.sessionId)
        .map((a) => ({
            id: a.id,
            name: a.name,
            color: a.color,
            cwd: a.cwd,
            model: a.model,
            trust: a.trust,
            sessionId: a.sessionId,
            createdAt: a.createdAt,
            lastTs: a.lastTs,
        }));
    try {
        fs.writeFileSync(AGENTSFILE, JSON.stringify(data, null, 2));
    } catch {}
}

// Rehydrate saved agents on boot as 'exited' (resume-ready), seeding history from disk.
export function loadAgents() {
    let arr = [];
    try {
        arr = JSON.parse(fs.readFileSync(AGENTSFILE, 'utf8'));
    } catch {
        return;
    }
    for (const s of arr) {
        if (!s.id || !s.sessionId || agents.has(s.id)) continue;
        const a = {
            id: s.id,
            name: s.name || 'agent',
            color: s.color || '#5aa2ff',
            cwd: s.cwd,
            model: s.model || null,
            trust: s.trust || 'safe',
            status: 'exited',
            sessionId: s.sessionId,
            q: null,
            input: null,
            entries: [],
            perms: [],
            createdAt: s.createdAt || Date.now(),
            lastTs: s.lastTs || null,
            exitCode: null,
            stderr: '',
        };
        const d = fullTranscript(a.sessionId);
        if (d) a.entries = d.entries;
        agents.set(a.id, a);
    }
}

// ---- SDK plumbing ---------------------------------------------------------
// An async-iterable input queue = the agent's live stdin (streaming input mode).
function makeInput() {
    const q = [];
    let waiting = null;
    let closed = false;
    return {
        push(text) {
            const m = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
            if (waiting) {
                waiting({ value: m, done: false });
                waiting = null;
            } else {
                q.push(m);
            }
        },
        close() {
            closed = true;
            if (waiting) {
                waiting({ value: undefined, done: true });
                waiting = null;
            }
        },
        stream: {
            [Symbol.asyncIterator]() {
                return this;
            },
            next() {
                if (q.length) return Promise.resolve({ value: q.shift(), done: false });
                if (closed) return Promise.resolve({ value: undefined, done: true });
                return new Promise((r) => (waiting = r));
            },
        },
    };
}

// Start (or resume) a query for this agent and consume its messages.
function startQuery(a, resume) {
    const input = makeInput();
    a.input = input;
    const options = {
        cwd: a.cwd,
        permissionMode: a.trust === 'readonly' ? 'plan' : 'default',
        // every tool needing a decision flows through our UI policy (safe auto, risky → prompt)
        canUseTool: (toolName, toolInput, opts) =>
            checkPerm({ agentId: a.id, tool_name: toolName, input: toolInput, tool_use_id: opts.toolUseID }),
        stderr: (d) => {
            a.stderr = (a.stderr + d).slice(-4000);
        },
    };
    if (a.model) options.model = a.model;
    if (resume && a.sessionId) options.resume = a.sessionId;
    a.status = 'starting';
    log(`${resume ? 'resume' : 'start'} "${a.name}" (${a.id.slice(0, 8)}) cwd=${a.cwd} model=${a.model || 'default'} trust=${a.trust}${resume && a.sessionId ? ` resume=${a.sessionId}` : ''}`);
    a.q = query({ prompt: input.stream, options });
    consume(a, a.q); // fire-and-forget; errors handled inside
    return input;
}

async function consume(a, q) {
    try {
        for await (const m of q) handleAgentEvent(a, m);
        if (a.status !== 'error') a.status = 'exited';
    } catch (err) {
        if (a.stopping || (err && err.name === 'AbortError')) {
            a.status = 'exited'; // intentional stop
            log(`stopped "${a.name}" (${a.id.slice(0, 8)})`);
        } else {
            a.status = 'error';
            const msg = (err && err.message) || String(err);
            a.stderr = (a.stderr + '\n[sdk error] ' + msg).slice(-4000);
            logErr(`SDK error in "${a.name}" (${a.id.slice(0, 8)}): ${err?.name || ''} ${msg}`);
            if (err?.stack) logErr(err.stack);
        }
    }
    a.q = null;
    a.stopping = false;
    for (const [rid, p] of pendingPerms) {
        if (p.agentId === a.id) resolvePerm(rid, { behavior: 'deny', message: 'agent ended' });
    }
    broadcast('agent-status', { id: a.id, status: a.status });
    broadcast('agents', listAgents());
}

// Map an SDK message to UI entries (reuses normalize) + drive status.
function handleAgentEvent(a, o) {
    if (o.session_id && a.sessionId !== o.session_id) {
        a.sessionId = o.session_id;
        persistAgents();
    }
    if (o.type === 'system' && o.subtype === 'init') {
        if (a.status === 'starting') {
            a.status = 'idle';
            log(`ready "${a.name}" (${a.id.slice(0, 8)}) session=${o.session_id}`);
            broadcast('agent-status', { id: a.id, status: a.status });
        }
        return;
    }
    if (o.type === 'result') {
        a.status = 'idle';
        broadcast('agent-status', { id: a.id, status: a.status });
        pushContextUsage(a); // refresh the context meter each turn
        return;
    }
    // compaction progress: { subtype:'status', status:'compacting' | null, compact_result?, compact_error? }
    if (o.type === 'system' && o.subtype === 'status') {
        if (o.status === 'compacting') {
            a.status = 'compacting';
            broadcast('agent-status', { id: a.id, status: a.status });
        } else if (o.compact_result) {
            broadcast('agent-note', {
                id: a.id,
                note: o.compact_result === 'failed' ? 'compact failed: ' + (o.compact_error || '') : 'compacted ✓',
                ok: o.compact_result !== 'failed',
            });
            pushContextUsage(a);
        }
        return;
    }
    if (o.type === 'stream_event' || o.type === 'rate_limit_event') return;

    const entries = normalize(o);
    if (!entries.length) return;
    for (const e of entries) {
        a.entries.push(e);
        if (e.ts) a.lastTs = e.ts;
    }
    broadcast('agent-append', { agentId: a.id, entries });
}

// ---- lifecycle ------------------------------------------------------------
export function spawnAgent({ name, color, cwd, prompt, model, trust }) {
    const id = crypto.randomUUID();
    cwd = expand(cwd || os.homedir());
    trust = TRUST_MODE[trust] ? trust : 'safe';
    const a = {
        id,
        name: name || 'agent',
        color: color || '#5aa2ff',
        cwd,
        model: model || null,
        trust,
        status: 'starting',
        sessionId: null,
        q: null,
        input: null,
        entries: [],
        perms: [],
        createdAt: Date.now(),
        lastTs: null,
        exitCode: null,
        stderr: '',
    };
    agents.set(id, a);
    startQuery(a, false);
    if (prompt && prompt.trim()) sayToAgent(id, prompt.trim());
    broadcast('agents', listAgents());
    return a;
}

// Adopt an inactive passive session as a controllable agent (resume + history).
export function adoptSession(sessionId) {
    let meta = null;
    for (const m of cache.values()) {
        if (!m.isFile && m.id === sessionId) {
            meta = m;
            break;
        }
    }
    if (!meta) return { error: 'session not found' };
    if (Date.now() - meta.mtime < ACTIVE_WINDOW_MS) return { error: 'session is live — view only' };
    for (const a of agents.values()) {
        if (a.sessionId === sessionId) return { ok: true, id: a.id }; // already adopted
    }
    const cwd = meta.cwd || decodeProject(meta.projectDir);
    try {
        if (!fs.statSync(cwd).isDirectory()) throw 0;
    } catch {
        return { error: 'working dir not found: ' + cwd };
    }
    const id = crypto.randomUUID();
    const a = {
        id,
        name: meta.title || 'session ' + sessionId.slice(0, 8),
        color: '#5aa2ff',
        cwd,
        model: meta.model || null,
        trust: 'safe',
        status: 'starting',
        sessionId,
        q: null,
        input: null,
        entries: [],
        perms: [],
        createdAt: Date.now(),
        lastTs: meta.lastTs,
        exitCode: null,
        stderr: '',
    };
    const data = fullTranscript(sessionId); // seed the existing conversation
    if (data) a.entries = data.entries;
    agents.set(id, a);
    startQuery(a, true); // resume the persisted session
    a.status = 'idle'; // history seeded; ready for input
    persistAgents();
    broadcast('agents', listAgents());
    return { ok: true, id };
}

// Resume an ended agent against its persisted session — conversation continues.
export function resumeAgent(id) {
    const a = agents.get(id);
    if (!a) {
        logErr(`resume failed: no agent with id ${id}`);
        return false;
    }
    if (a.q && a.status !== 'exited' && a.status !== 'error') {
        log(`resume "${a.name}" (${a.id.slice(0, 8)}) ignored — already live (${a.status})`);
        return true; // already live
    }
    if (!a.sessionId) {
        logErr(`resume "${a.name}" (${a.id.slice(0, 8)}) failed — no sessionId yet (never reached init)`);
        return false; // nothing to resume yet
    }
    try {
        if (!fs.statSync(a.cwd).isDirectory()) throw 0;
    } catch {
        a.status = 'error';
        a.stderr = 'working dir missing: ' + a.cwd;
        logErr(`resume "${a.name}" (${a.id.slice(0, 8)}) failed — working dir missing: ${a.cwd}`);
        broadcast('agent-status', { id, status: 'error', error: a.stderr });
        broadcast('agents', listAgents());
        return false;
    }
    a.exitCode = null;
    a.stderr = '';
    startQuery(a, true);
    broadcast('agent-status', { id, status: a.status });
    broadcast('agents', listAgents());
    return true;
}

// Ask the SDK for the live context-window breakdown and push it to the UI.
export async function pushContextUsage(a) {
    if (!a || !a.q || typeof a.q.getContextUsage !== 'function') return null;
    try {
        const cu = await a.q.getContextUsage();
        a.ctx = { total: cu.totalTokens, max: cu.maxTokens, pct: cu.percentage, model: cu.model };
        broadcast('agent-ctx', { id: a.id, ctx: a.ctx });
        return a.ctx;
    } catch {
        return null;
    }
}

export function getAgentContext(id) {
    const a = agents.get(id);
    if (!a) return null;
    return pushContextUsage(a); // promise<ctx|null>
}

// Trigger Claude Code's /compact on a live agent (slash command via the input stream).
export function compactAgent(id) {
    const a = agents.get(id);
    if (!a) return false;
    if (!a.q || a.status === 'exited' || a.status === 'error') {
        if (!resumeAgent(id)) return false; // wake it first
    }
    try {
        a.input.push('/compact');
    } catch {
        return false;
    }
    a.status = 'compacting';
    broadcast('agent-status', { id, status: a.status });
    return true;
}

// Change an agent's trust/permission level live — checkPerm reads a.trust per
// tool call, so future decisions follow immediately. We also keep the SDK's
// permissionMode in sync (readonly -> plan, else -> default).
export function setTrust(id, trust) {
    const a = agents.get(id);
    if (!a) return false;
    if (!TRUST_MODE[trust]) return false;
    a.trust = trust;
    try {
        a.q && a.q.setPermissionMode && a.q.setPermissionMode(trust === 'readonly' ? 'plan' : 'default');
    } catch {}
    persistAgents();
    broadcast('agents', listAgents());
    broadcast('agent-status', { id, status: a.status, trust });
    return true;
}

export function sayToAgent(id, text) {
    const a = agents.get(id);
    if (!a) return false;
    if (!a.q || a.status === 'exited' || a.status === 'error') {
        if (!resumeAgent(id)) return false; // wake & continue
    }
    try {
        a.input.push(text);
    } catch {
        return false;
    }
    // echo the user message into the transcript immediately
    const e = { ts: new Date().toISOString(), role: 'user', kind: 'text', text };
    a.entries.push(e);
    a.lastTs = e.ts;
    a.status = 'running';
    broadcast('agent-append', { agentId: id, entries: [e] });
    broadcast('agent-status', { id, status: a.status });
    return true;
}

export function stopAgent(id) {
    const a = agents.get(id);
    if (!a) return false;
    a.stopping = true; // tell consume() this end is intentional
    try {
        a.q && a.q.interrupt();
    } catch {}
    try {
        a.input && a.input.close(); // ends the input stream → query finishes
    } catch {}
    return true;
}

export function stopAllAgents() {
    for (const a of agents.values()) {
        try {
            a.q && a.q.interrupt();
        } catch {}
        try {
            a.input && a.input.close();
        } catch {}
    }
}
