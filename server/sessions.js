// Passive side: tail every ~/.claude/projects/**.jsonl session and any watched
// markdown file, keep a cache, and broadcast changes over SSE.

import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_PROJECTS_DIR as ROOT, ACTIVE_WINDOW_MS, WATCHFILE, POLL_MS, expand } from './config.js';
import { normalize, decodeProject } from './normalize.js';
import { broadcast } from './sse.js';

// keyed by absolute file path
export const cache = new Map();

function newMeta(file, project) {
    return {
        id: path.basename(file, '.jsonl'),
        file,
        project, // decoded cwd-ish path
        projectDir: path.basename(path.dirname(file)),
        cwd: null,
        title: null,
        lastPrompt: null,
        model: null,
        counts: { user: 0, assistant: 0, tool_use: 0 },
        tokensIn: 0,
        tokensOut: 0,
        firstTs: null,
        lastTs: null,
        offset: 0, // bytes consumed (complete lines only)
        size: 0,
        mtime: 0,
    };
}

// Update meta tallies from a raw object (used for sidebar stats).
function applyMeta(meta, obj) {
    if (obj.timestamp) {
        if (!meta.firstTs) meta.firstTs = obj.timestamp;
        meta.lastTs = obj.timestamp;
    }
    if (obj.cwd) meta.cwd = obj.cwd;
    if (obj.type === 'ai-title' && obj.aiTitle) meta.title = obj.aiTitle;
    if (obj.type === 'last-prompt' && obj.lastPrompt) meta.lastPrompt = obj.lastPrompt;
    if (obj.type === 'user') {
        meta.counts.user++;
        const c = obj.message?.content;
        if (typeof c === 'string' && c.trim()) meta.lastPrompt = c.slice(0, 200);
    }
    if (obj.type === 'assistant') {
        meta.counts.assistant++;
        if (obj.message?.model) meta.model = obj.message.model;
        const u = obj.message?.usage;
        if (u) {
            meta.tokensIn +=
                (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            meta.tokensOut += u.output_tokens || 0;
        }
        if (Array.isArray(obj.message?.content)) {
            for (const it of obj.message.content) if (it.type === 'tool_use') meta.counts.tool_use++;
        }
    }
}

// Read only the bytes appended since meta.offset. Returns parsed objects + normalized entries.
function readNew(meta) {
    const stat = fs.statSync(meta.file);
    meta.size = stat.size;
    meta.mtime = stat.mtimeMs;
    if (stat.size <= meta.offset) return { objs: [], entries: [] };

    const fd = fs.openSync(meta.file, 'r');
    const len = stat.size - meta.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, meta.offset);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return { objs: [], entries: [] }; // no complete line yet
    const complete = text.slice(0, lastNl + 1);
    meta.offset += Buffer.byteLength(complete, 'utf8');

    const objs = [];
    const entries = [];
    for (const line of complete.split('\n')) {
        if (!line.trim()) continue;
        let obj;
        try {
            obj = JSON.parse(line);
        } catch {
            continue;
        }
        applyMeta(meta, obj);
        objs.push(obj);
        for (const e of normalize(obj)) entries.push(e);
    }
    return { objs, entries };
}

function publicMeta(m) {
    if (m.isFile) {
        return {
            id: m.id,
            isFile: true,
            project: m.project,
            projectDir: path.basename(m.project),
            title: m.title,
            lastPrompt: m.label,
            model: null,
            counts: m.counts,
            tokensIn: 0,
            tokensOut: 0,
            lines: m.lines,
            firstTs: m.firstTs,
            lastTs: m.lastTs,
            mtime: m.mtime,
            size: m.size,
            active: Date.now() - m.mtime < ACTIVE_WINDOW_MS,
        };
    }
    return {
        id: m.id,
        project: m.cwd || m.project,
        projectDir: m.projectDir,
        title: m.title,
        lastPrompt: m.lastPrompt,
        model: m.model,
        counts: m.counts,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        firstTs: m.firstTs,
        lastTs: m.lastTs,
        mtime: m.mtime,
        size: m.size,
        active: Date.now() - m.mtime < ACTIVE_WINDOW_MS,
    };
}

// ---- watched files (arbitrary md/text tailed as pseudo-sessions) ----------
export function getWatched() {
    const out = [],
        seen = new Set();
    const add = (p) => {
        p = (p || '').trim();
        if (!p || p.startsWith('#')) return;
        const abs = expand(p);
        if (seen.has(abs)) return;
        seen.add(abs);
        out.push({ file: abs, label: path.basename(abs) });
    };
    if (process.env.WATCH_FILES) process.env.WATCH_FILES.split(',').forEach(add);
    try {
        fs.readFileSync(WATCHFILE, 'utf8').split('\n').forEach(add);
    } catch {}
    return out.filter((w) => {
        try {
            return fs.statSync(w.file).isFile();
        } catch {
            return false;
        }
    });
}

function readWatchRaw() {
    try {
        return fs.readFileSync(WATCHFILE, 'utf8');
    } catch {
        return '';
    }
}

export function addWatchLine(abs) {
    const raw = readWatchRaw();
    const present = raw.split('\n').some((l) => {
        const t = l.trim();
        return t && !t.startsWith('#') && expand(t) === abs;
    });
    if (present) return false;
    fs.writeFileSync(WATCHFILE, raw + (raw && !raw.endsWith('\n') ? '\n' : '') + abs + '\n');
    return true;
}

export function removeWatchLine(abs) {
    const kept = readWatchRaw()
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            if (!t || t.startsWith('#')) return true; // keep comments/blanks
            return expand(t) !== abs;
        });
    fs.writeFileSync(WATCHFILE, kept.join('\n'));
}

export function newFileMeta(file, label) {
    const m = {
        id: 'file:' + file,
        file,
        isFile: true,
        label: label || path.basename(file),
        project: path.dirname(file),
        title: null,
        lines: 0,
        size: 0,
        mtime: 0,
        counts: { user: 0, assistant: 0, tool_use: 0 },
        tokensIn: 0,
        tokensOut: 0,
        firstTs: null,
        lastTs: null,
    };
    updateFileMeta(m);
    return m;
}

export function updateFileMeta(m) {
    let raw = '';
    try {
        raw = fs.readFileSync(m.file, 'utf8');
    } catch {}
    try {
        const st = fs.statSync(m.file);
        m.size = st.size;
        m.mtime = st.mtimeMs;
        m.lastTs = new Date(st.mtimeMs).toISOString();
    } catch {}
    m.lines = raw ? raw.split('\n').length : 0;
    const h = raw.match(/^#\s+(.*)$/m);
    m.title = h ? h[1].replace(/[#*`]/g, '').trim() : m.label;
}

// ---- polling loop --------------------------------------------------------
function scanFiles() {
    const files = [];
    let dirs = [];
    try {
        dirs = fs.readdirSync(ROOT, { withFileTypes: true });
    } catch {
        return files;
    }
    for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dir = path.join(ROOT, d.name);
        let entries = [];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const f of entries) {
            if (f.endsWith('.jsonl')) files.push({ file: path.join(dir, f), project: decodeProject(d.name) });
        }
    }
    return files;
}

function tick() {
    let changed = false;
    for (const { file, project } of scanFiles()) {
        let meta = cache.get(file);
        if (!meta) {
            meta = newMeta(file, project);
            cache.set(file, meta);
            changed = true;
        }
        let stat;
        try {
            stat = fs.statSync(file);
        } catch {
            continue;
        }
        if (stat.size !== meta.size || stat.mtimeMs !== meta.mtime) {
            const { entries } = readNew(meta);
            if (entries.length) broadcast('append', { sessionId: meta.id, entries });
            changed = true;
        }
    }
    // watched files — re-render whole doc on any change (true "tail -f" for markdown)
    const watchedNow = new Set();
    for (const { file, label } of getWatched()) {
        watchedNow.add(file);
        let meta = cache.get(file);
        if (!meta) {
            meta = newFileMeta(file, label);
            cache.set(file, meta);
            changed = true;
        }
        let stat;
        try {
            stat = fs.statSync(file);
        } catch {
            continue;
        }
        if (stat.size !== meta.size || stat.mtimeMs !== meta.mtime) {
            updateFileMeta(meta);
            broadcast('replace', { sessionId: meta.id });
            changed = true;
        }
    }
    // prune file pseudo-sessions that are no longer watched (removed from list)
    for (const [key, meta] of cache) {
        if (meta.isFile && !watchedNow.has(meta.file)) {
            cache.delete(key);
            changed = true;
        }
    }
    if (changed) broadcast('sessions', listSessions());
}

export function listSessions() {
    return [...cache.values()].map(publicMeta).sort((a, b) => b.mtime - a.mtime);
}

// Full transcript (re-parse the whole file, normalized).
export function fullTranscript(id) {
    for (const m of cache.values()) {
        if (m.id !== id) continue;
        if (m.isFile) {
            let raw = '';
            try {
                raw = fs.readFileSync(m.file, 'utf8');
            } catch {
                return null;
            }
            return { meta: publicMeta(m), entries: [{ ts: m.lastTs, role: 'file', kind: 'mdfull', text: raw }] };
        }
        const entries = [];
        let raw = '';
        try {
            raw = fs.readFileSync(m.file, 'utf8');
        } catch {
            return null;
        }
        for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            let obj;
            try {
                obj = JSON.parse(line);
            } catch {
                continue;
            }
            for (const e of normalize(obj)) entries.push(e);
        }
        return { meta: publicMeta(m), entries };
    }
    return null;
}

// Prime the cache once at boot (no SSE clients yet), then start the poll loop.
export function primeCache() {
    for (const { file, project } of scanFiles()) {
        const meta = newMeta(file, project);
        cache.set(file, meta);
        try {
            readNew(meta);
        } catch {}
    }
    for (const { file, label } of getWatched()) {
        cache.set(file, newFileMeta(file, label));
    }
}

export function startPolling() {
    setInterval(tick, POLL_MS);
}
