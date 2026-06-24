// Configuration, paths, and small shared constants/helpers.

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Project root is one level up from this server/ folder.
export const ROOT_DIR = path.resolve(here, '..');
export const PUBLIC = path.join(ROOT_DIR, 'public');
export const WATCHFILE = path.join(ROOT_DIR, 'watched.txt');
export const AGENTSFILE = path.join(ROOT_DIR, 'agents.json');

export const PORT = process.env.PORT || 8787;
export const HOST = process.env.HOST || '127.0.0.1';
export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
export const POLL_MS = Number(process.env.POLL_MS || 1000);
export const ACTIVE_WINDOW_MS = Number(process.env.ACTIVE_WINDOW_MS || 90_000); // "active" = touched within this window
export const PERM_TIMEOUT_MS = Number(process.env.PERM_TIMEOUT_MS || 300_000);

// Tools that run without asking; everything else flows through the UI permission prompt.
export const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'WebSearch', 'WebFetch']);

// Agent trust level -> SDK permission mode (canUseTool enforces the rest).
export const TRUST_MODE = { readonly: 'plan', safe: 'default', full: 'acceptEdits' };

export const STATIC_TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

// Expand "~" and resolve to an absolute path.
export function expand(p) {
    p = (p || '').trim();
    if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
    return path.resolve(p);
}
