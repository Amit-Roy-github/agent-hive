// Active side: each agent is a Claude Agent SDK query() in streaming-input mode.
// We spawn, drive, stop, resume, adopt sessions, and persist agents across reboots.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { uuid12, createUser } from '../users/user.js';
import { z } from 'zod';
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
            effort: a.effort,
            trust: a.trust,
            sessionId: a.sessionId,
            userId: a.userId || null,
            userFile: a.userFile || null,
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
            effort: s.effort || null,
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

// ---- agent-to-agent messaging --------------------------------------------
// Resolve a target agent from a free-form "name or id" (the live `agents`
// registry is loaded from agents.json, so this is the agents.json data + live
// status). Matching order: exact id / id-prefix, then exact name, then partial
// name. Returns { agent } or { error } (error also covers ambiguous matches).
export function resolveAgent(nameOrId) {
    const key = String(nameOrId || '').trim();
    if (!key) return { error: 'empty target — pass a name or id' };
    if (agents.has(key)) return { agent: agents.get(key) };
    const lower = key.toLowerCase();
    const byId = [];
    const byNameExact = [];
    const byNamePart = [];
    for (const a of agents.values()) {
        if (a.id === key || a.id.startsWith(key)) byId.push(a);
        const n = (a.name || '').toLowerCase();
        if (n === lower) byNameExact.push(a);
        else if (n.includes(lower)) byNamePart.push(a);
    }
    const pick = byId.length ? byId : byNameExact.length ? byNameExact : byNamePart;
    if (pick.length === 1) return { agent: pick[0] };
    if (pick.length > 1) {
        const list = pick.map((a) => `${a.name} (${a.id.slice(0, 8)})`).join(', ');
        return { error: `ambiguous "${key}" — matches: ${list}. Use a full id.` };
    }
    return { error: `no agent matches "${key}" — call list_agents to see who's on the deck` };
}

// Per-agent in-process MCP server: gives THIS agent (`self`) tools to discover
// and message other agents on the deck. Delivery is one-way (push into the
// target's session); the target replies by calling message_agent back at `self`.
function buildDeckTools(self) {
    return createSdkMcpServer({
        name: 'agent-deck',
        version: '0.1.0',
        tools: [
            tool(
                'list_agents',
                'List the other agents on the deck (name, short id, status) so you can pick who to message.',
                {},
                async () => {
                    const rows = [...agents.values()]
                        .filter((a) => a.id !== self.id)
                        .map((a) => `- ${a.name} · id=${a.id.slice(0, 8)} · ${a.status}`)
                        .join('\n');
                    return { content: [{ type: 'text', text: rows || '(no other agents on the deck)' }] };
                },
            ),
            tool(
                'message_agent',
                'Send a message to another agent on the deck by its name or id (resolved from agents.json). ' +
                    'The message lands in that agent\'s session and wakes it if asleep. This is one-way: the ' +
                    'reply does NOT come back here inline — the other agent will reply by messaging you back, ' +
                    'which arrives as a new message in your session.',
                {
                    target: z.string().describe('name or id (full or 8-char prefix) of the agent to message'),
                    text: z.string().describe('the message to send'),
                },
                async ({ target, text }) => {
                    const { agent: t, error } = resolveAgent(target);
                    if (error) return { content: [{ type: 'text', text: error }], isError: true };
                    if (t.id === self.id)
                        return { content: [{ type: 'text', text: 'That target is you.' }], isError: true };
                    const from8 = self.id.slice(0, 8);
                    const note =
                        `📨 Message from ${self.name} (${from8}):\n\n${text}\n\n` +
                        `— To reply, use message_agent with target "${from8}".`;
                    const ok = sayToAgent(t.id, note);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: ok
                                    ? `Delivered to ${t.name} (${t.id.slice(0, 8)}). Their reply will arrive as a new message to you.`
                                    : `Could not deliver to ${t.name} (${t.id.slice(0, 8)}).`,
                            },
                        ],
                        isError: !ok,
                    };
                },
            ),
        ],
    });
}

// ---- identity injection ---------------------------------------------------
// An agent's identity lives in ~/.agent-deck/users/user_<slug>_<UUID12>.md
// (created by users/user.js — the single source of truth). We append it to the
// system prompt on every start/resume so it's re-sent each turn and survives
// compaction — the agent never forgets who it is. Matched by the agent's durable
// id (last-12 UPPERCASE), so renaming the agent doesn't break the link.
const USERS_DIR = path.join(os.homedir(), '.agent-deck', 'users');

function findIdentityFile(a) {
    const tag = `_${uuid12(a.id)}.md`; // file suffix = _<UUID12>.md
    try {
        const match = fs.readdirSync(USERS_DIR).find((f) => f.endsWith(tag));
        return match ? path.join(USERS_DIR, match) : null;
    } catch {
        return null; // no users dir yet
    }
}

function readIdentity(a) {
    const file = findIdentityFile(a);
    if (!file) {
        log(`identity "${a.name}" (${a.id.slice(0, 8)}) none — no users/*_${uuid12(a.id)}.md`);
        return null;
    }
    try {
        const text = fs.readFileSync(file, 'utf8');
        log(`identity "${a.name}" (${a.id.slice(0, 8)}) loaded ${path.basename(file)} (${text.length} chars)`);
        return text;
    } catch (e) {
        log(`identity "${a.name}" (${a.id.slice(0, 8)}) skipped — ${e?.code || e?.message || 'read failed'}`);
        return null;
    }
}

// On spawn: auto-create the identity file (the users/ part) so a brand-new agent
// knows who it is from turn one. teams/channels start empty — the onboarder fills
// those later. Idempotent: if the file already exists (e.g. onboarder pre-made it),
// we leave it untouched so its teams/channels aren't clobbered.
function ensureIdentity(a) {
    if (findIdentityFile(a)) return; // already has one — don't overwrite
    try {
        const { file } = createUser({ id: a.id, name: a.name, color: a.color });
        log(`identity "${a.name}" (${a.id.slice(0, 8)}) auto-created ${path.basename(file)}`);
    } catch (e) {
        logErr(`identity "${a.name}" (${a.id.slice(0, 8)}) auto-create failed — ${e?.message || e}`);
    }
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
        // in-process tools so this agent can discover & message other agents
        mcpServers: { 'agent-deck': buildDeckTools(a) },
    };
    // Durable identity: append the agent's user_*.md to the claude_code system
    // prompt (preset stays the default; we only add). Re-applied every start/
    // resume, so it persists across compaction. We also record userId/userFile on
    // the agent (persisted to agents.json) for visibility — but the runtime lookup
    // is always by id (last-12), so a rename never breaks the link.
    const idFile = findIdentityFile(a);
    const identity = readIdentity(a);
    a.userId = uuid12(a.id);
    a.userFile = idFile || null;
    if (identity) {
        options.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append:
                '\n\n# Who you are (agent-deck identity)\n\n' +
                'The profile below is YOU — your actual identity on this agent-deck team, ' +
                'not just metadata. Adopt it fully:\n\n' +
                '- **Your name is the `Name` below.** When anyone asks your name or "who are you", ' +
                'answer with that name (e.g. "I\'m ' + (a.name || 'this agent') + '"). Do NOT default ' +
                'to "I\'m Claude" — you are still built on Claude, but here you go by this name and role.\n' +
                '- Speak and act as this person: honor your Role, Teams, and Channels.\n' +
                '- This block is re-injected every turn, so it stays true even after your context is ' +
                'compacted. Trust it over any summary.\n\n' +
                identity,
        };
    }
    // Persist the identity link now. (On resume the sessionId doesn't change, so
    // the init-time persist wouldn't fire — persist here so userId/userFile land
    // in agents.json. No-op for a fresh spawn that has no sessionId yet; it gets
    // written on the init event below.)
    if (a.sessionId) persistAgents();
    if (a.model) options.model = a.model;
    if (a.effort) options.effort = a.effort;
    if (resume && a.sessionId) options.resume = a.sessionId;
    a.status = 'starting';
    log(`${resume ? 'resume' : 'start'} "${a.name}" (${a.id.slice(0, 8)}) cwd=${a.cwd} model=${a.model || 'default'} effort=${a.effort || 'default'} trust=${a.trust} identity=${identity ? 'yes' : 'none'}${resume && a.sessionId ? ` resume=${a.sessionId}` : ''}`);
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
export function spawnAgent({ name, color, cwd, prompt, model, effort, trust }) {
    const id = crypto.randomUUID();
    cwd = expand(cwd || os.homedir());
    trust = TRUST_MODE[trust] ? trust : 'safe';
    const a = {
        id,
        name: name || 'agent',
        color: color || '#5aa2ff',
        cwd,
        model: model || null,
        effort: effort || null,
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
    ensureIdentity(a); // auto-create users/ identity (empty teams/channels) before first run
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
        effort: meta.effort || null,
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

// Change an agent's reasoning effort. We persist a.effort (so it carries over on
// the next start/resume via options.effort) and, when the agent is live, push it
// to the running session via the SDK's apply_flag_settings control request.
// Note: the live path supports low/medium/high/xhigh; 'max' only applies on the
// next start (it isn't a live-settable flag level). The /effort slash command is
// NOT available in the headless SDK environment, hence the control request.
const EFFORT_LEVELS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']);
const LIVE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh']);
export function setEffort(id, effort) {
    const a = agents.get(id);
    if (!a) return false;
    if (!EFFORT_LEVELS.has(effort)) return false;
    const prev = a.effort;
    a.effort = effort || null;
    const live = a.effort && a.q && a.q.applyFlagSettings && a.status !== 'exited' && a.status !== 'error';
    let how = 'next start/resume';
    if (live && LIVE_EFFORT.has(a.effort)) {
        how = 'live';
        a.q
            .applyFlagSettings({ effortLevel: a.effort })
            .catch((e) => logErr(`effort "${a.name}" (${a.id.slice(0, 8)}) live apply failed: ${e?.message || e}`));
    } else if (live) {
        how = 'next start/resume (max not live-settable)';
    }
    log(`effort "${a.name}" (${a.id.slice(0, 8)}) ${prev || 'default'} -> ${a.effort || 'default'} [${how}]`);
    persistAgents();
    broadcast('agents', listAgents());
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
