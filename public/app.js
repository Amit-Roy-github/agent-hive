const $ = (s) => document.querySelector(s);
const el = (h) => {
    const t = document.createElement('template');
    t.innerHTML = h.trim();
    return t.content.firstChild;
};
const esc = (s) =>
    (s == null ? '' : String(s)).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmtTime = (ts) =>
    ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const ago = (ms) => {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
};
const COLORS = ['#5aa2ff', '#46c06a', '#e0b34a', '#b07bf0', '#3fd0c9', '#ff6b63', '#ff7ab6', '#ff9f45'];
const fmtK = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : '' + n;
const ctxLabel = (c) => (c ? `ctx ${c.pct}% · ${fmtK(c.total)}/${fmtK(c.max)}` : 'ctx —');

if (window.marked) marked.setOptions({ gfm: true, breaks: true });
if (window.DOMPurify)
    DOMPurify.addHook('afterSanitizeAttributes', (n) => {
        if (n.tagName === 'A') {
            n.setAttribute('target', '_blank');
            n.setAttribute('rel', 'noopener noreferrer');
        }
    });
const md = (src) => (!src ? '' : window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(src)) : esc(src));

// ---- state ----------------------------------------------------------------
let agents = [],
    sessions = [];
let view = 'grid'; // 'grid' | 'focus'
let focus = null; // { kind:'agent'|'session', id }
let thread = { kind: null, id: null, entries: [], perms: [] };
let spawnColor = COLORS[0];
const previews = new Map(); // agentId -> last text (for grid tiles)
const permsByAgent = new Map(); // agentId -> [req]
const drafts = new Map(); // focusId -> in-progress composer text (survives re-renders)
let autoScroll = true;

const agentById = (id) => agents.find((a) => a.id === id);

// ---- rendering: sidebar ---------------------------------------------------
function renderAgents() {
    const wrap = $('#agentList');
    $('#activeCount').textContent =
        agents.filter((a) => a.status === 'running' || a.status === 'thinking').length + ' running';
    if (!agents.length) {
        wrap.innerHTML =
            '<div class="empty" style="margin:8px;padding:14px;font-size:12px">No agents yet — hit <b>+ New</b></div>';
        return;
    }
    wrap.innerHTML = agents
        .map((a) => {
            const np = (permsByAgent.get(a.id) || []).length;
            const live = a.status === 'running' || a.status === 'thinking';
            const sel = focus && focus.kind === 'agent' && focus.id === a.id;
            return `<div class="agent-row ${sel ? 'sel' : ''}" data-aid="${a.id}" style="--ac:${esc(a.color)}">
      <span class="ic ${live ? 'pulse' : ''}"></span>
      <span class="nm">${esc(a.name)}</span>
      ${np ? `<span class="pbadge">${np}</span>` : ''}
      <span class="st ${esc(a.status)}">${esc(a.status)}</span>
    </div>`;
        })
        .join('');
    wrap.querySelectorAll('.agent-row').forEach((r) => (r.onclick = () => openAgent(r.dataset.aid)));
}

function renderSessions() {
    const q = $('#filter').value.toLowerCase();
    const activeOnly = $('#activeOnly').checked;
    const list = sessions.filter((s) => {
        if (activeOnly && !s.active) return false;
        if (!q) return true;
        return (
            (s.title || '').toLowerCase().includes(q) ||
            (s.project || '').toLowerCase().includes(q) ||
            (s.lastPrompt || '').toLowerCase().includes(q)
        );
    });
    const wrap = $('#sessionList');
    wrap.innerHTML =
        list
            .map((s) => {
                const sel = focus && focus.kind === 'session' && focus.id === s.id;
                return `<div class="sess ${sel ? 'sel' : ''}" data-sid="${esc(s.id)}">
      <div class="s1">
        <span class="title">${s.isFile ? '📄 ' : ''}${esc(s.title || s.lastPrompt || '(untitled)')}</span>
        ${s.active ? '<span class="badge live">live</span>' : ''}
        ${s.isFile ? `<span class="unwatch" data-uid="${esc(s.id)}" title="stop watching">✕</span>` : ''}
      </div>
      <div class="s2">${esc((s.project || s.projectDir || '').split('/').slice(-2).join('/'))} · ${ago(s.mtime)}</div>
    </div>`;
            })
            .join('') || '<div class="empty" style="font-size:12px;padding:14px">no sessions</div>';
    wrap.querySelectorAll('.sess').forEach((r) => (r.onclick = () => openSession(r.dataset.sid)));
    wrap.querySelectorAll('.unwatch').forEach(
        (u) =>
            (u.onclick = (e) => {
                e.stopPropagation();
                unwatch(u.dataset.uid);
            }),
    );
}

// ---- rendering: stage (grid | focus) --------------------------------------
function renderStage() {
    const stage = $('#stage');
    if (view === 'grid') return renderGrid(stage);
    renderFocus(stage);
}

function renderGrid(stage) {
    const tiles = agents
        .map((a) => {
            const live = a.status === 'running' || a.status === 'thinking';
            const np = (permsByAgent.get(a.id) || []).length;
            return `<div class="tile" data-aid="${a.id}" style="--ac:${esc(a.color)}">
      <div class="tile-head"><span class="ic ${live ? 'pulse' : ''}"></span><span class="nm">${esc(a.name)}</span>
        ${np ? `<span class="permdot">⚠ ${np}</span>` : ''}<span class="fstatus ${esc(a.status)}">${esc(a.status)}</span></div>
      <div class="cwd">${esc(a.cwd)}</div>
      <div class="tile-feed">${esc(previews.get(a.id) || '…')}</div>
      <div class="tile-foot"><span>${esc(a.model || 'default')}</span><span>·</span><span>${esc(a.trust)}</span><span>·</span><span>${a.msgs} msgs</span></div>
    </div>`;
        })
        .join('');
    stage.className = '';
    stage.innerHTML = `<div class="grid">${tiles}<div class="tile newtile" id="gridNew">+ New agent</div></div>`;
    stage.querySelectorAll('.tile[data-aid]').forEach((t) => (t.onclick = () => openAgent(t.dataset.aid)));
    $('#gridNew').onclick = openSpawn;
}

function renderFocus(stage) {
    stage.className = '';
    if (!focus) {
        stage.innerHTML =
            '<div class="empty"><div class="lead">Koi agent ya session chuno</div>Left se select karo, ya <b>+ New</b> se agent launch karo.</div>';
        return;
    }
    const isAgent = focus.kind === 'agent';
    const a = isAgent ? agentById(focus.id) : null;
    const s = !isAgent ? sessions.find((x) => x.id === focus.id) : null;
    const color = a ? a.color : 'var(--accent)';
    const title = a ? a.name : s ? s.title || s.lastPrompt || '(untitled)' : focus.id;
    const meta = a ? a.cwd : s ? s.project || s.projectDir || '' : '';
    const status = a ? a.status : s && s.active ? 'live' : 'session';
    const exited = isAgent && a && (a.status === 'exited' || a.status === 'error');
    stage.innerHTML = `<div class="focus">
    <div class="fhead" style="--ac:${esc(color)}">
      <span class="ic"></span>
      <div class="ftitleline"><span class="ftitle">${esc(title)}</span><span class="fmeta">${esc(meta)}</span></div>
      <div class="fright">
        ${
            isAgent
                ? `<select id="trustSel" class="cc-sel trustsel" title="permission level">${[
                      ['safe', 'safe — ask on risky'],
                      ['full', 'full — auto-approve'],
                      ['readonly', 'read-only — plan'],
                  ]
                      .map(([v, l]) => `<option value="${v}"${a.trust === v ? ' selected' : ''}>${l}</option>`)
                      .join('')}</select>`
                : ''
        }
        ${
            isAgent && !exited
                ? `<span class="ctxchip" id="ctxChip" title="context window used">${ctxLabel(a.ctx)}</span>
        <button class="btn sm compactbtn" id="compactBtn" title="compact the conversation (/compact)">⟲ Compact</button>`
                : ''
        }
        <span class="fstatus ${esc(status)}">${esc(status)}</span>
        ${
            isAgent
                ? exited
                    ? '<button class="btn allow sm" id="resumeBtn">▸ Resume</button>'
                    : '<button class="btn deny sm" id="stopBtn">Stop</button>'
                : s && !s.isFile && !s.active
                  ? '<button class="btn allow sm" id="adoptBtn">▸ Resume here</button>'
                  : ''
        }
      </div>
    </div>
    <div class="feed" id="feed"></div>
    ${
        isAgent
            ? `<div class="composer"><textarea id="say" rows="1" placeholder="message ${esc(a.name)}…   ${exited ? '↵ resume & continue' : '↵ send · ⇧↵ newline'}">${esc(drafts.get(a.id) || '')}</textarea><button class="send" id="sendBtn">Send</button></div>`
            : s && s.isFile
              ? `<div class="composer chan-composer">
      <div class="cc-row">
        <input id="ccAuthor" class="cc-author" placeholder="your name" />
        <select id="ccRole" class="cc-sel">${['dev', 'senior', 'manager', 'pm', 'agent'].map((r) => `<option>${r}</option>`).join('')}</select>
        <select id="ccTag" class="cc-sel"><option value="">no tag</option>${CHAN_TAGS.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
      </div>
      <div class="cc-row2"><textarea id="ccMsg" rows="1" placeholder="message to the channel…   (⌘/Ctrl+Enter to send)"></textarea><button class="send" id="ccSend">Send</button></div>
    </div>`
              : ''
    }
  </div>`;
    renderFeed();
    if (isAgent) {
        const stop = $('#stopBtn');
        if (stop) stop.onclick = () => fetch(`/api/agent/${focus.id}/stop`, { method: 'POST' });
        const res = $('#resumeBtn');
        if (res) res.onclick = () => fetch(`/api/agent/${focus.id}/resume`, { method: 'POST' });
        const ts = $('#trustSel');
        if (ts)
            ts.onchange = () =>
                fetch(`/api/agent/${focus.id}/trust`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trust: ts.value }),
                }).catch(() => {});
        const cb = $('#compactBtn');
        if (cb)
            cb.onclick = async () => {
                cb.disabled = true;
                cb.textContent = 'compacting…';
                await fetch(`/api/agent/${focus.id}/compact`, { method: 'POST' }).catch(() => {});
            };
        const ta = $('#say');
        if (ta) {
            const resize = () => {
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 170) + 'px';
            };
            ta.oninput = () => {
                drafts.set(focus.id, ta.value); // persist so a re-render can't wipe it
                resize();
            };
            ta.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    sendSay();
                }
            };
            $('#sendBtn').onclick = sendSay;
            resize(); // size to a restored draft
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length); // caret at end
        }
    } else if (s && s.isFile) {
        const au = $('#ccAuthor');
        if (au) au.value = localStorage.getItem('csm-author') || '';
        const rl = $('#ccRole');
        if (rl) rl.value = localStorage.getItem('csm-role') || 'dev';
        const cm = $('#ccMsg');
        if (cm) {
            cm.oninput = () => {
                cm.style.height = 'auto';
                cm.style.height = Math.min(cm.scrollHeight, 170) + 'px';
            };
            cm.onkeydown = (e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    postChannel();
                }
            };
        }
        const cs = $('#ccSend');
        if (cs) cs.onclick = postChannel;
    }
    const adopt = $('#adoptBtn');
    if (adopt)
        adopt.onclick = async () => {
            adopt.disabled = true;
            adopt.textContent = 'resuming…';
            let r;
            try {
                r = await fetch(`/api/session/${encodeURIComponent(focus.id)}/adopt`, { method: 'POST' }).then((x) =>
                    x.json(),
                );
            } catch (e) {
                r = { error: String(e) };
            }
            if (r && r.ok) openAgent(r.id);
            else {
                adopt.disabled = false;
                adopt.textContent = '✕ ' + (r.error || 'failed');
                setTimeout(() => {
                    adopt.textContent = '▸ Resume here';
                }, 2500);
            }
        };
    const feed = $('#feed');
    feed.onclick = (e) => {
        const al = e.target.closest('[data-allow]');
        const dn = e.target.closest('[data-deny]');
        if (al) answerPerm(al.dataset.allow, 'allow');
        if (dn) answerPerm(dn.dataset.deny, 'deny');
    };
    feed.onscroll = () => {
        autoScroll = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    };
}

// ---- collaboration channel rendering --------------------------------------
const CHAN_TAGS = ['#idea', '#question', '#decision', '#blocker', '#done', '#fyi'];
// A watched markdown file is a "channel" when it carries the message-block format.
const isChannel = (t) => /#msg-\d+/.test(t) && /\*\*\[[^\]]+\]\*\*/.test(t);

// stable accent colour per author name
function roleColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `hsl(${h} 58% 58%)`;
}
// render `#msg-066` references inside text as little pills
const refChips = (s) => esc(s).replace(/#msg-(\d+)/g, '<span class="chan-ref">#msg-$1</span>');

function channelHTML(text) {
    const blocks = text.split(/\n-{3,}[ \t]*\n/);
    let cards = '';
    let preamble = '';
    for (const raw of blocks) {
        const chunk = raw.trim();
        if (!chunk) continue;
        // real messages only — placeholders (YYYY-MM-DD / #msg-NNN) won't match the \d header
        const m = chunk.match(
            /^\*\*\[([^\]]+)\]\*\*\s*`([^`]+)`\s*·\s*`(\d{4}-\d{2}-\d{2}[^`]*)`(?:\s*·\s*`?(#msg-\d+)`?)?(?:\s*·\s*(#\w+))?/,
        );
        if (!m) {
            preamble += chunk + '\n\n---\n\n';
            continue;
        }
        const [, role, author, ts, msgId, tag] = m;
        const lines = chunk.split('\n');
        lines.shift(); // drop the header line
        let reply = '';
        if (lines[0] && /↳\s*reply to/i.test(lines[0])) reply = lines.shift().trim();
        const body = lines.join('\n').trim();
        const tagClass = tag ? ' tag-' + tag.slice(1) : '';
        cards += `<div class="chan-msg${tagClass}" style="--rc:${roleColor(author)}">
      <div class="chan-head">
        <span class="chan-ava">${esc((author[0] || '?').toUpperCase())}</span>
        <span class="chan-badge">${esc(role)}</span>
        <span class="chan-who">${esc(author)}</span>
        ${msgId ? `<span class="chan-id">${esc(msgId)}</span>` : ''}
        ${tag ? `<span class="chan-tag">${esc(tag)}</span>` : ''}
        <span class="chan-ts">${esc(ts)}</span>
      </div>
      ${reply ? `<div class="chan-reply">${refChips(reply)}</div>` : ''}
      <div class="chan-body md">${md(body)}</div>
    </div>`;
    }
    const pre = preamble.trim()
        ? `<details class="chan-pre"><summary>📖 channel guide</summary><div class="md">${md(preamble)}</div></details>`
        : '';
    return `<div class="chan">${pre}${cards}</div>`;
}

function entryHTML(e) {
    if (e.kind === 'mdfull')
        return isChannel(e.text)
            ? channelHTML(e.text)
            : `<div class="msg assistant"><div class="bubble md">${md(e.text)}</div></div>`;
    if (e.kind === 'tool_use' || e.kind === 'tool_result') {
        const peek = (e.text || '').replace(/\s+/g, ' ').trim();
        const label = e.kind === 'tool_use' ? e.tool || 'tool' : 'result';
        return `<div class="msg tool"><div class="head"><span class="kdot"></span>${e.kind === 'tool_use' ? 'tool call' : 'tool result'}<span class="ts">${fmtTime(e.ts)}</span></div>
      <details class="toolbox"><summary><span class="toolname">${esc(label)}</span><span class="peek">${esc(peek.slice(0, 140)) || '(empty)'}</span><span class="exp"></span></summary>
        <div class="codeblk ${e.isError ? 'err' : ''}">${esc(e.text)}</div></details></div>`;
    }
    const cls = e.kind === 'thinking' ? 'thinking' : e.kind === 'system' ? 'system' : e.role;
    const who = e.kind === 'thinking' ? 'thinking' : e.role;
    return `<div class="msg ${cls}"><div class="head"><span class="kdot"></span>${esc(who)}<span class="ts">${fmtTime(e.ts)}</span></div><div class="bubble md">${md(e.text)}</div></div>`;
}

function permHTML(req) {
    const input = req.input || {};
    const pretty =
        input.command || input.file_path || input.path
            ? input.command || `${input.file_path || input.path}${input.content ? '\n\n' + input.content : ''}`
            : JSON.stringify(input, null, 2);
    return `<div class="permcard" data-pid="${req.id}">
    <div class="pc-h">⚠ permission needed</div>
    <div class="pc-tool">Agent wants to run <span class="toolname">${esc(req.tool_name)}</span></div>
    <div class="pc-input">${esc(pretty)}</div>
    <div class="pc-btns"><button class="btn allow" data-allow="${req.id}">Allow</button><button class="btn deny" data-deny="${req.id}">Deny</button></div>
  </div>`;
}

function renderFeed() {
    const feed = $('#feed');
    if (!feed) return;
    const perms = thread.kind === 'agent' ? permsByAgent.get(thread.id) || [] : [];
    const html = thread.entries.map(entryHTML).join('') + perms.map(permHTML).join('');
    feed.innerHTML = html || '<div class="empty" style="font-size:13px">no messages yet…</div>';
    feed.scrollTop = feed.scrollHeight;
}

// ---- open / load ----------------------------------------------------------
async function openAgent(id) {
    focus = { kind: 'agent', id };
    view = 'focus';
    syncToggle();
    thread = { kind: 'agent', id, entries: [], perms: [] };
    renderAgents();
    renderSessions();
    renderFocus($('#stage'));
    const data = await fetch(`/api/agent/${id}`)
        .then((r) => r.json())
        .catch(() => null);
    if (!data || !focus || focus.id !== id) return;
    thread.entries = data.entries || [];
    permsByAgent.set(id, data.perms || []);
    renderFeed();
    renderAgents();
    // pull a fresh context-window reading for live agents (updates the chip via SSE)
    const st = data.agent && data.agent.status;
    if (st && st !== 'exited' && st !== 'error') fetch(`/api/agent/${id}/context`).catch(() => {});
}
async function openSession(id) {
    focus = { kind: 'session', id };
    view = 'focus';
    syncToggle();
    thread = { kind: 'session', id, entries: [], perms: [] };
    renderSessions();
    renderAgents();
    renderFocus($('#stage'));
    const data = await fetch('/api/session/' + encodeURIComponent(id))
        .then((r) => r.json())
        .catch(() => null);
    if (!data || !focus || focus.id !== id) return;
    thread.entries = data.entries || [];
    renderFeed();
}

async function sendSay() {
    const ta = $('#say');
    if (!ta) return;
    const text = ta.value.trim();
    if (!text || !focus) return;
    ta.value = '';
    drafts.delete(focus.id); // clear the saved draft now that it's sent
    ta.style.height = 'auto';
    await fetch(`/api/agent/${focus.id}/say`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });
}
async function postChannel() {
    const cm = $('#ccMsg');
    if (!cm || !focus) return;
    const text = cm.value.trim();
    if (!text) return;
    const author = ($('#ccAuthor')?.value || '').trim() || 'anon';
    const role = $('#ccRole')?.value || 'dev';
    const tag = $('#ccTag')?.value || '';
    localStorage.setItem('csm-author', author);
    localStorage.setItem('csm-role', role);
    cm.value = '';
    cm.style.height = 'auto';
    await fetch('/api/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: focus.id, text, author, role, tag }),
    }).catch(() => {});
}
async function answerPerm(id, behavior) {
    const card = document.querySelector(`.permcard[data-pid="${id}"]`);
    if (card) card.style.opacity = '.5';
    await fetch('/api/perm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, behavior }),
    });
}
async function unwatch(id) {
    await fetch('/api/unwatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    }).catch(() => {});
    if (focus && focus.kind === 'session' && focus.id === id) {
        focus = null;
        renderFocus($('#stage'));
    }
}

// ---- spawn modal ----------------------------------------------------------
function openSpawn() {
    $('#spSwatches').innerHTML = COLORS.map(
        (c) => `<span data-c="${c}" style="background:${c}" class="${c === spawnColor ? 'on' : ''}"></span>`,
    ).join('');
    $('#spSwatches')
        .querySelectorAll('span')
        .forEach(
            (s) =>
                (s.onclick = () => {
                    spawnColor = s.dataset.c;
                    $('#spSwatches')
                        .querySelectorAll('span')
                        .forEach((x) => x.classList.toggle('on', x.dataset.c === spawnColor));
                }),
        );
    $('#spErr').textContent = '';
    $('#spawnModal').hidden = false;
    $('#spName').focus();
}
function closeSpawn() {
    $('#spawnModal').hidden = true;
}
async function launchAgent() {
    const body = {
        name: $('#spName').value.trim() || 'agent',
        color: spawnColor,
        cwd: $('#spCwd').value.trim(),
        model: $('#spModel').value,
        trust: $('#spTrust').value,
        prompt: $('#spPrompt').value.trim(),
    };
    if (!body.cwd) {
        $('#spErr').textContent = 'working dir chahiye';
        return;
    }
    $('#spLaunch').disabled = true;
    let r;
    try {
        r = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((x) => x.json());
    } catch (e) {
        r = { error: String(e) };
    }
    $('#spLaunch').disabled = false;
    if (r.ok) {
        closeSpawn();
        $('#spName').value = '';
        $('#spPrompt').value = '';
        openAgent(r.id);
    } else $('#spErr').textContent = r.error || 'failed';
}

// ---- view toggle ----------------------------------------------------------
function syncToggle() {
    $('#viewToggle')
        .querySelectorAll('button')
        .forEach((b) => b.classList.toggle('on', b.dataset.view === view));
}
$('#viewToggle')
    .querySelectorAll('button')
    .forEach(
        (b) =>
            (b.onclick = () => {
                view = b.dataset.view;
                syncToggle();
                renderStage();
            }),
    );

// ---- SSE ------------------------------------------------------------------
function connect() {
    const es = new EventSource('/api/stream');
    es.addEventListener('open', () => {
        $('#conn').classList.add('on');
        $('#connTxt').textContent = 'live';
    });
    es.addEventListener('error', () => {
        $('#conn').classList.remove('on');
        $('#connTxt').textContent = 'reconnecting…';
    });

    es.addEventListener('agents', (ev) => {
        agents = JSON.parse(ev.data);
        for (const a of agents) if (!permsByAgent.has(a.id)) permsByAgent.set(a.id, []);
        renderAgents();
        if (view === 'grid') renderGrid($('#stage'));
        else if (focus && focus.kind === 'agent') {
            const a = agentById(focus.id);
            if (a) updateFocusStatus(a.status);
        }
    });
    es.addEventListener('agent-append', (ev) => {
        const { agentId, entries } = JSON.parse(ev.data);
        const last = entries[entries.length - 1];
        if (last && (last.kind === 'text' || last.kind === 'thinking'))
            previews.set(agentId, (last.text || '').slice(0, 240));
        if (thread.kind === 'agent' && thread.id === agentId) {
            thread.entries.push(...entries);
            appendFeed(entries);
        }
        if (view === 'grid') renderGrid($('#stage'));
    });
    es.addEventListener('agent-status', (ev) => {
        const { id, status } = JSON.parse(ev.data);
        const a = agentById(id);
        if (a) a.status = status;
        renderAgents();
        if (view === 'grid') renderGrid($('#stage'));
        else if (focus && focus.kind === 'agent' && focus.id === id) updateFocusStatus(status);
    });
    es.addEventListener('agent-ctx', (ev) => {
        const { id, ctx } = JSON.parse(ev.data);
        const a = agentById(id);
        if (a) a.ctx = ctx;
        if (focus && focus.kind === 'agent' && focus.id === id) {
            const chip = $('#ctxChip');
            if (chip) chip.textContent = ctxLabel(ctx);
        }
    });
    es.addEventListener('agent-note', (ev) => {
        const { id, note, ok } = JSON.parse(ev.data);
        if (focus && focus.kind === 'agent' && focus.id === id) {
            const cb = $('#compactBtn');
            if (cb) {
                cb.disabled = false;
                cb.textContent = ok === false ? '⚠ ' + note : '✓ compacted';
                setTimeout(() => {
                    if ($('#compactBtn') === cb) cb.textContent = '⟲ Compact';
                }, 3000);
            }
        }
    });
    es.addEventListener('perm-request', (ev) => {
        const req = JSON.parse(ev.data);
        const arr = permsByAgent.get(req.agentId) || [];
        arr.push(req);
        permsByAgent.set(req.agentId, arr);
        renderAgents();
        if (thread.kind === 'agent' && thread.id === req.agentId) renderFeed();
        else if (view === 'grid') renderGrid($('#stage'));
    });
    es.addEventListener('perm-resolved', (ev) => {
        const { id } = JSON.parse(ev.data);
        for (const [aid, arr] of permsByAgent)
            permsByAgent.set(
                aid,
                arr.filter((r) => r.id !== id),
            );
        renderAgents();
        if (thread.kind === 'agent') renderFeed();
        if (view === 'grid') renderGrid($('#stage'));
    });

    es.addEventListener('sessions', (ev) => {
        sessions = JSON.parse(ev.data);
        renderSessions();
    });
    es.addEventListener('append', (ev) => {
        const { sessionId, entries } = JSON.parse(ev.data);
        if (thread.kind === 'session' && thread.id === sessionId) {
            thread.entries.push(...entries);
            appendFeed(entries);
        }
    });
    es.addEventListener('replace', (ev) => {
        const { sessionId } = JSON.parse(ev.data);
        if (thread.kind === 'session' && thread.id === sessionId) openSession(sessionId);
    });
}

function updateFocusStatus(status) {
    // re-render only when crossing the exited boundary (swaps Resume ⇄ Stop); else just update the pill
    const deadNow = status === 'exited' || status === 'error';
    const hasStop = !!document.getElementById('stopBtn');
    const hasResume = !!document.getElementById('resumeBtn');
    if ((deadNow && hasStop) || (!deadNow && hasResume)) {
        renderFocus($('#stage'));
        return;
    }
    const s = document.querySelector('.fhead .fstatus');
    if (s) {
        s.textContent = status;
        s.className = 'fstatus ' + status;
    }
}
function appendFeed(entries) {
    const feed = $('#feed');
    if (!feed) {
        return;
    }
    // re-render to keep perm cards at the bottom and markdown consistent
    renderFeed();
    if (autoScroll) feed.scrollTop = feed.scrollHeight;
}

// ---- misc wiring ----------------------------------------------------------
$('#newAgentBtn').onclick = openSpawn;
$('#spawnClose').onclick = closeSpawn;
$('#spCancel').onclick = closeSpawn;
$('#spLaunch').onclick = launchAgent;
$('#spawnModal').onclick = (e) => {
    if (e.target.id === 'spawnModal') closeSpawn();
};
$('#filter').oninput = renderSessions;
$('#activeOnly').onchange = renderSessions;
$('#watchBtn').onclick = addWatch;
$('#watchPath').onkeydown = (e) => {
    if (e.key === 'Enter') addWatch();
};
$('#themeBtn').onclick = () => {
    const light = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    localStorage.setItem('csm-theme', light ? 'light' : 'dark');
};

async function addWatch() {
    const inp = $('#watchPath'),
        msg = $('#watchMsg');
    const p = inp.value.trim();
    if (!p) return;
    let r;
    try {
        r = await fetch('/api/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: p }),
        }).then((x) => x.json());
    } catch (e) {
        r = { error: String(e) };
    }
    if (r.ok) {
        inp.value = '';
        msg.textContent = 'watching ✓';
        msg.className = 'watchmsg ok';
        if (r.id) openSession(r.id);
    } else {
        msg.textContent = r.error || 'failed';
        msg.className = 'watchmsg err';
    }
    setTimeout(() => {
        msg.textContent = '';
        msg.className = 'watchmsg';
    }, 4000);
}

setInterval(() => {
    if (sessions.length) renderSessions();
}, 10000);
renderStage();
connect();
