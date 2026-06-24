// HTTP routing: static assets, the JSON API, and the SSE stream.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, STATIC_TYPES, expand } from './config.js';
import { addClient, removeClient, broadcast } from './sse.js';
import {
    cache,
    listSessions,
    fullTranscript,
    getWatched,
    addWatchLine,
    removeWatchLine,
    newFileMeta,
    updateFileMeta,
} from './sessions.js';
import { agents, listAgents, publicAgent } from './state.js';
import {
    spawnAgent,
    adoptSession,
    sayToAgent,
    stopAgent,
    resumeAgent,
    setTrust,
    compactAgent,
    getAgentContext,
} from './agents.js';
import { resolvePerm, pendingPerms } from './permissions.js';

function send(res, code, type, body) {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
}

function readBody(req, cb) {
    let d = '';
    req.on('data', (c) => {
        d += c;
        if (d.length > 1e6) req.destroy();
    });
    req.on('end', () => {
        let j = {};
        try {
            j = JSON.parse(d || '{}');
        } catch {}
        cb(j);
    });
}

export function createServer() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const p = url.pathname;

        // ---- watch management (UI-driven) ----
        if (req.method === 'POST' && p === '/api/watch') {
            return readBody(req, (body) => {
                const input = (body.path || '').trim();
                if (!input) return send(res, 400, 'application/json', '{"error":"path required"}');
                const abs = expand(input);
                let st;
                try {
                    st = fs.statSync(abs);
                } catch {
                    return send(res, 400, 'application/json', JSON.stringify({ error: 'not found: ' + abs }));
                }
                if (!st.isFile())
                    return send(res, 400, 'application/json', JSON.stringify({ error: 'not a file: ' + abs }));
                addWatchLine(abs);
                const meta = newFileMeta(abs, path.basename(abs));
                cache.set(abs, meta);
                broadcast('sessions', listSessions());
                return send(res, 200, 'application/json', JSON.stringify({ ok: true, id: meta.id }));
            });
        }
        if (req.method === 'POST' && p === '/api/append') {
            return readBody(req, (body) => {
                let id = (body.id || '').trim();
                const text = (body.text || '').trim();
                if (!id || !text) return send(res, 400, 'application/json', '{"error":"id and text required"}');
                const abs = id.startsWith('file:') ? id.slice('file:'.length) : expand(id);
                const watched = new Set(getWatched().map((w) => w.file));
                if (!watched.has(abs)) return send(res, 403, 'application/json', '{"error":"file is not watched"}');

                const role = (body.role || 'dev').replace(/[`\]\[]/g, '');
                const author = (body.author || 'anon').replace(/[`\n]/g, '').trim() || 'anon';
                const tag = (body.tag || '').trim();
                let raw = '';
                try {
                    raw = fs.readFileSync(abs, 'utf8');
                } catch {}
                const hasMsg = /#msg-\d+/.test(raw);
                let next = 0;
                for (const m of raw.matchAll(/#msg-(\d+)/g)) next = Math.max(next, +m[1]);
                const msgId = '#msg-' + String(next + 1).padStart(3, '0');

                const d = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

                let block = `\n---\n**[${role}]** \`${author}\` · \`${ts}\``;
                if (hasMsg) block += ` · \`${msgId}\``;
                if (tag) block += ` · ${tag}`;
                block += `\n\n${text}\n`;

                // pure append — safest against concurrent writers (no full-file rewrite)
                try {
                    fs.appendFileSync(abs, block);
                } catch (e) {
                    return send(res, 500, 'application/json', JSON.stringify({ error: String(e) }));
                }
                const meta = cache.get(abs);
                if (meta) updateFileMeta(meta);
                broadcast('replace', { sessionId: 'file:' + abs });
                broadcast('sessions', listSessions());
                return send(res, 200, 'application/json', JSON.stringify({ ok: true, msgId: hasMsg ? msgId : null }));
            });
        }
        if (req.method === 'POST' && p === '/api/unwatch') {
            return readBody(req, (body) => {
                let id = (body.id || body.path || '').trim();
                if (!id) return send(res, 400, 'application/json', '{"error":"id or path required"}');
                const abs = id.startsWith('file:') ? id.slice('file:'.length) : expand(id);
                removeWatchLine(abs);
                cache.delete(abs);
                broadcast('sessions', listSessions());
                return send(res, 200, 'application/json', '{"ok":true}');
            });
        }

        // ---- agents (spawn / drive / inspect) ----
        if (req.method === 'GET' && p === '/api/agents') {
            return send(res, 200, 'application/json', JSON.stringify(listAgents()));
        }
        if (req.method === 'POST' && p === '/api/agents') {
            return readBody(req, (body) => {
                const cwd = (body.cwd || '').trim();
                if (!cwd) return send(res, 400, 'application/json', '{"error":"cwd required"}');
                const abs = expand(cwd);
                try {
                    if (!fs.statSync(abs).isDirectory()) throw 0;
                } catch {
                    return send(res, 400, 'application/json', JSON.stringify({ error: 'not a directory: ' + abs }));
                }
                try {
                    const a = spawnAgent({
                        name: body.name,
                        color: body.color,
                        cwd: abs,
                        prompt: body.prompt,
                        model: body.model,
                        trust: body.trust,
                    });
                    return send(res, 200, 'application/json', JSON.stringify({ ok: true, id: a.id }));
                } catch (e) {
                    return send(res, 500, 'application/json', JSON.stringify({ error: String(e) }));
                }
            });
        }
        if (p.startsWith('/api/agent/')) {
            const rest = p.slice('/api/agent/'.length);
            const [id, action] = rest.split('/');
            const a = agents.get(id);
            if (!a) return send(res, 404, 'application/json', '{"error":"no such agent"}');
            if (req.method === 'GET' && !action) {
                return send(
                    res,
                    200,
                    'application/json',
                    JSON.stringify({ agent: publicAgent(a), entries: a.entries, perms: a.perms, stderr: a.stderr }),
                );
            }
            if (req.method === 'POST' && action === 'say') {
                return readBody(req, (body) => {
                    const text = (body.text || '').trim();
                    if (!text) return send(res, 400, 'application/json', '{"error":"text required"}');
                    const ok = sayToAgent(id, text);
                    return send(
                        res,
                        ok ? 200 : 409,
                        'application/json',
                        JSON.stringify(ok ? { ok: true } : { error: 'agent not accepting input' }),
                    );
                });
            }
            if (req.method === 'POST' && action === 'stop') {
                stopAgent(id);
                return send(res, 200, 'application/json', '{"ok":true}');
            }
            if (req.method === 'GET' && action === 'context') {
                return getAgentContext(id).then((ctx) =>
                    send(res, 200, 'application/json', JSON.stringify({ ok: true, ctx: ctx || a.ctx || null })),
                );
            }
            if (req.method === 'POST' && action === 'compact') {
                const ok = compactAgent(id);
                return send(
                    res,
                    ok ? 200 : 409,
                    'application/json',
                    JSON.stringify(ok ? { ok: true } : { error: 'cannot compact' }),
                );
            }
            if (req.method === 'POST' && action === 'trust') {
                return readBody(req, (body) => {
                    const ok = setTrust(id, (body.trust || '').trim());
                    return send(
                        res,
                        ok ? 200 : 400,
                        'application/json',
                        JSON.stringify(ok ? { ok: true } : { error: 'invalid trust level' }),
                    );
                });
            }
            if (req.method === 'POST' && action === 'resume') {
                const ok = resumeAgent(id);
                return send(
                    res,
                    ok ? 200 : 409,
                    'application/json',
                    JSON.stringify(ok ? { ok: true } : { error: 'cannot resume' }),
                );
            }
            return send(res, 404, 'application/json', '{"error":"unknown agent action"}');
        }

        // ---- permission: the UI answers a pending request ----
        if (req.method === 'POST' && p === '/api/perm') {
            return readBody(req, (body) => {
                const id = (body.id || '').trim();
                const behavior = body.behavior === 'allow' ? 'allow' : 'deny';
                const verdict =
                    behavior === 'allow'
                        ? { behavior: 'allow', updatedInput: pendingPerms.get(id)?.input }
                        : { behavior: 'deny', message: 'denied from monitor' };
                const ok = resolvePerm(id, verdict);
                return send(
                    res,
                    ok ? 200 : 404,
                    'application/json',
                    JSON.stringify(ok ? { ok: true } : { error: 'no such pending permission' }),
                );
            });
        }

        // ---- static assets (everything browser-served lives under public/) ----
        if (p === '/' || p === '/index.html' || p === '/app.css' || p === '/app.js' || p.startsWith('/vendor/')) {
            const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
            const file = path.join(PUBLIC, path.normalize(rel));
            if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep))
                return send(res, 403, 'text/plain', 'forbidden');
            const type = STATIC_TYPES[path.extname(file)] || 'application/octet-stream';
            try {
                return send(res, 200, type + '; charset=utf-8', fs.readFileSync(file));
            } catch {
                return send(res, 404, 'text/plain', 'not found');
            }
        }
        if (p === '/api/sessions') {
            return send(res, 200, 'application/json', JSON.stringify(listSessions()));
        }
        if (req.method === 'POST' && p.startsWith('/api/session/') && p.endsWith('/adopt')) {
            const id = decodeURIComponent(p.slice('/api/session/'.length, -'/adopt'.length));
            const r = adoptSession(id);
            return send(res, r.ok ? 200 : 409, 'application/json', JSON.stringify(r));
        }
        if (p.startsWith('/api/session/')) {
            const id = decodeURIComponent(p.slice('/api/session/'.length));
            const data = fullTranscript(id);
            if (!data) return send(res, 404, 'application/json', '{"error":"not found"}');
            return send(res, 200, 'application/json', JSON.stringify(data));
        }
        if (p === '/api/stream') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            res.write(`event: sessions\ndata: ${JSON.stringify(listSessions())}\n\n`);
            res.write(`event: agents\ndata: ${JSON.stringify(listAgents())}\n\n`);
            addClient(res);
            const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
            req.on('close', () => {
                clearInterval(ka);
                removeClient(res);
            });
            return;
        }
        send(res, 404, 'text/plain', 'not found');
    });
}
