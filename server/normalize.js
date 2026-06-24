// Pure transcript helpers: turn a raw jsonl / SDK message into UI entries.

// ~/.claude/projects encodes the cwd by replacing '/' with '-'. Leading '-' => absolute path.
export function decodeProject(dirName) {
    return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

export function safeJson(v) {
    try {
        return JSON.stringify(v, null, 2);
    } catch {
        return String(v);
    }
}

function stringifyResult(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((p) => (typeof p === 'string' ? p : p.text || safeJson(p))).join('\n');
    }
    return safeJson(content);
}

// Turn one raw object (jsonl line or SDK message) into 0+ normalized entries for the UI.
export function normalize(obj) {
    const ts = obj.timestamp || null;
    const out = [];
    if (obj.type === 'user') {
        const c = obj.message?.content;
        if (typeof c === 'string') {
            out.push({ ts, role: 'user', kind: 'text', text: c });
        } else if (Array.isArray(c)) {
            for (const item of c) {
                if (item.type === 'tool_result') {
                    out.push({
                        ts,
                        role: 'tool',
                        kind: 'tool_result',
                        tool: item.tool_use_id || '',
                        text: stringifyResult(item.content),
                        isError: !!item.is_error,
                    });
                } else if (item.type === 'text') {
                    out.push({ ts, role: 'user', kind: 'text', text: item.text });
                }
            }
        }
    } else if (obj.type === 'assistant') {
        const c = obj.message?.content;
        const model = obj.message?.model || null;
        if (Array.isArray(c)) {
            for (const item of c) {
                if (item.type === 'text') {
                    out.push({ ts, role: 'assistant', kind: 'text', text: item.text, model });
                } else if (item.type === 'thinking') {
                    out.push({ ts, role: 'assistant', kind: 'thinking', text: item.thinking || '', model });
                } else if (item.type === 'tool_use') {
                    out.push({
                        ts,
                        role: 'assistant',
                        kind: 'tool_use',
                        tool: item.name,
                        text: safeJson(item.input),
                        model,
                    });
                }
            }
        }
    } else if (obj.type === 'system') {
        const t = typeof obj.content === 'string' ? obj.content : obj.text || '';
        if (t) out.push({ ts, role: 'system', kind: 'system', text: t });
    }
    return out;
}
