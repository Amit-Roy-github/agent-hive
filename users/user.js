// users/user.js — the create-user method (single source of truth for identity).
//
// A member's identity lives in one file:
//   ~/.agent-deck/users/user_<name-slug>_<UUID12>.md
// The deck server reads that file and injects it into the agent's system prompt
// every turn, so the agent never forgets who it is (survives compaction).
//
// This method is called TWO ways — both run the exact same code:
//   1. Runtime  — when a new agent is spawned and there is NO onboarding agent,
//                 the server calls createUser({...}) so identity is still made.
//   2. Onboarder — the onboarding agent calls it the same way.
// If a call ever errors, it's plain readable Node: open this file, fix it, re-run.
// Nothing is hidden behind a tool/MCP, on purpose.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// name → file/folder-safe slug. "agent-2 ( FE-lead )" → "agent-2-fe-lead"
export const slugify = (s) =>
    String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A member REUSES its own agent id (from agents.json) — last 12, UPPERCASE.
// Never generate a fresh one for a user; the id is its durable identity.
export const uuid12 = (id) => String(id).slice(-12).toUpperCase();

// Absolute path of a member's identity file (~ resolved at runtime).
export const userFilePath = (name, userId) =>
    path.join(os.homedir(), '.agent-deck', 'users', `user_${slugify(name)}_${userId}.md`);

// Render the identity markdown. teams/channels are optional (empty = empty section).
export function renderUser({ name, userId, color = '', role = '', who = '', teams = [], channels = [] }) {
    const team = (t) => `
- **Team:**   ${t.name}
- **TeamId:** \`${t.uuid12}\`
- **Path:**   ~/.agent-deck/teams/team_${slugify(t.name)}_${t.uuid12}/team.md
- **Role:**   ${t.role || ''}
---`;
    const chan = (c) => `
- **Channel:**   ${c.name}
- **ChannelId:** \`${c.uuid12}\`
- **Path:**      ~/.agent-deck/channels/channel_${slugify(c.name)}_${c.uuid12}/conversations.md
- **Why:**       ${c.why || ''}
---`;
    return `# User: ${name}

## Identity
- **Name:**   ${name}
- **UserId:** \`${userId}\`
- **Color:**  ${color}
- **Role:**   ${role}
- **Who:**    ${who}

## Your Teams
${teams.map(team).join('\n')}

## Your Channels
${channels.map(chan).join('\n')}
`;
}

// Create (or overwrite) a member's identity file. Returns { file, userId }.
// input = { id, name, role?, who?, teams?, channels? }
//   id   — the member's FULL agent id (from agents.json); userId = its last 12.
//   name — display name.
export function createUser(input) {
    if (!input || !input.id) throw new Error('createUser: input.id (full agent id) is required');
    if (!input.name) throw new Error('createUser: input.name is required');

    const userId = uuid12(input.id);
    const file = userFilePath(input.name, userId);
    fs.mkdirSync(path.dirname(file), { recursive: true }); // make users/ if missing
    fs.writeFileSync(file, renderUser({ ...input, userId }));
    return { file, userId };
}

// CLI: node users/user.js '<json-input>'
//   e.g. node users/user.js '{"id":"e81d...cd4","name":"agent-2 (FE-lead)","role":"FE lead"}'
// With no arg it writes a demo file so you can see the output shape.
if (import.meta.url === `file://${process.argv[1]}`) {
    const arg = process.argv[2];
    const input = arg
        ? JSON.parse(arg)
        : {
              id: 'PASTE-full-agent-id-from-agents.json',
              name: 'agent-2 (FE-lead)',
              role: 'Frontend lead',
              who: 'Owns i14-web UI work; reviews dev PRs.',
              teams: [],
              channels: [],
          };
    const { file, userId } = createUser(input);
    console.log('wrote', file, '(userId', userId + ')');
}
