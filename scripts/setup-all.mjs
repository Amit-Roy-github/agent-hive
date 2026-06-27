// Full agent-deck setup: all users, dev team, channels
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUser, slugify } from '../users/user.js';

const HOME = os.homedir();
const ROOT = path.join(HOME, '.agent-deck');

// ── IDs ──────────────────────────────────────────────────────────────────────

const TEAM_DEV_UUID    = '38A6E4E37CA0';
const CHAN_GENERAL_UUID = 'FD8FD75859AC';
const CHAN_DEV_UUID     = '3736E9611A09';
const CHAN_REVIEW_UUID  = '260F77B0E7BE';

// ── Members ──────────────────────────────────────────────────────────────────

const devTeamRef = { name: 'Dev Team', uuid12: TEAM_DEV_UUID };

const chanGeneral = { name: 'general', uuid12: CHAN_GENERAL_UUID, why: 'Whole-team announcements and general discussion' };
const chanDev     = { name: 'dev',     uuid12: CHAN_DEV_UUID,     why: 'Day-to-day dev coordination' };
const chanReview  = { name: 'code-review', uuid12: CHAN_REVIEW_UUID, why: 'Code review discussions and QA sign-offs' };

const AGENTS = [
  {
    id: 'd71477e9-7aa4-4623-b04b-7bf3c86a215c',
    name: 'agent-1',
    color: '#5aa2ff',
    role: 'General Agent',
    who: 'General-purpose agent',
    teams: [],
    channels: [chanGeneral],
  },
  {
    id: 'e81d746d-d7b3-4659-8527-6cbf8ad35cd4',
    name: 'agent-2 ( FE-lead )',
    color: '#46c06a',
    role: 'FE Lead',
    who: 'Frontend lead developer',
    teams: [{ ...devTeamRef, role: 'FE Lead' }],
    channels: [chanGeneral, chanDev, chanReview],
  },
  {
    id: '863ed1d6-cca5-4a7a-9c11-35594b4f6f1e',
    name: 'agent - 3 ( BE - Dev ) sonnet',
    color: '#ff6b63',
    role: 'BE Dev',
    who: 'Backend developer (Sonnet model)',
    teams: [{ ...devTeamRef, role: 'BE Dev' }],
    channels: [chanGeneral, chanDev, chanReview],
  },
  {
    id: '91f7cf82-ad53-487f-9a5b-28ac822ef05d',
    name: 'agent - 2.2 ( FE - MobDev )',
    color: '#46c06a',
    role: 'Mobile Dev',
    who: 'Frontend mobile developer',
    teams: [{ ...devTeamRef, role: 'Mobile Dev' }],
    channels: [chanGeneral, chanDev],
  },
  {
    id: 'de6b25b0-78e6-40e0-bf06-a08390730c69',
    name: 'agent - 4 ( Reviewer + QA )',
    color: '#ff9f45',
    role: 'Reviewer / QA',
    who: 'Code reviewer and QA engineer',
    teams: [{ ...devTeamRef, role: 'Reviewer / QA' }],
    channels: [chanGeneral, chanDev, chanReview],
  },
  {
    id: '75b3c187-ce7d-4ff5-941c-145aa56afc76',
    name: 'agent-2.2 (Dev)',
    color: '#ff7ab6',
    role: 'Dev',
    who: 'General developer',
    teams: [{ ...devTeamRef, role: 'Dev' }],
    channels: [chanGeneral, chanDev, chanReview],
  },
  {
    id: '13409864-ca11-46c5-8f01-afe045d56e7c',
    name: 'Test Agent',
    color: '#ff9f45',
    role: 'Test',
    who: 'Test agent',
    teams: [],
    channels: [chanGeneral],
  },
  {
    id: 'f1a9e434-a9cb-48d9-b461-bbd6d300669e',
    name: 'Testing users',
    color: '#ff9f45',
    role: 'Test',
    who: 'Testing users agent',
    teams: [],
    channels: [chanGeneral],
  },
  {
    id: '4aa9fd29-1f25-4e58-aec9-cf19581896d6',
    name: 'onboarding-agent',
    color: '#3fd0c9',
    role: 'Onboarding',
    who: 'Sets up and maintains agent-deck team structure',
    teams: [],
    channels: [chanGeneral],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid12FromId(id) {
  return String(id).slice(-12).toUpperCase();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function write(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

// ── 1. Create all user files ───────────────────────────────────────────────

console.log('\n── Users ─────────────────────────────────────');
for (const agent of AGENTS) {
  const { file, userId } = createUser(agent);
  console.log(`  ✓ ${agent.name}  (${userId})  →  ${file}`);
}

// ── 2. Create Dev Team ────────────────────────────────────────────────────

const devTeamSlug = slugify('Dev Team');
const devTeamDir  = path.join(ROOT, 'teams', `team_${devTeamSlug}_${TEAM_DEV_UUID}`);
ensureDir(devTeamDir);

const devMembers = AGENTS.filter(a => a.teams.length > 0);

const memberBlock = devMembers.map(a => {
  const uid = uuid12FromId(a.id);
  return `- **Name:**   ${a.name}
- **UserId:** \`${uid}\`
- **Role:**   ${a.role}
- **About:**  ${a.who}
- **Path:**   ~/.agent-deck/users/user_${slugify(a.name)}_${uid}.md\n---`;
}).join('\n');

const teamMd = `# Team: Dev Team

- **TeamId:** \`${TEAM_DEV_UUID}\`
- **Path:**   ~/.agent-deck/teams/team_${devTeamSlug}_${TEAM_DEV_UUID}/team.md

## About
The core development team. Covers frontend (web + mobile), backend, and QA.
All feature work, code reviews, and releases flow through this team.

## Members

${memberBlock}
`;

write(path.join(devTeamDir, 'team.md'), teamMd);
console.log('\n── Team ──────────────────────────────────────');
console.log(`  ✓ Dev Team  (${TEAM_DEV_UUID})  →  ${devTeamDir}/team.md`);

// ── 3. Create Channels ────────────────────────────────────────────────────

const CHANNELS = [
  {
    uuid12: CHAN_GENERAL_UUID,
    name: 'general',
    type: 'team',
    description: 'Whole-team announcements, questions, and general discussion.',
    members: AGENTS,
  },
  {
    uuid12: CHAN_DEV_UUID,
    name: 'dev',
    type: 'team',
    description: 'Day-to-day development coordination for the Dev Team.',
    members: AGENTS.filter(a => a.teams.length > 0),
  },
  {
    uuid12: CHAN_REVIEW_UUID,
    name: 'code-review',
    type: 'group',
    description: 'Code review discussions and QA sign-offs.',
    members: AGENTS.filter(a => a.channels.some(c => c.uuid12 === CHAN_REVIEW_UUID)),
  },
];

function conversationsMd(channelName) {
  return `# 🧵 Agent Hive ( ${channelName} )

Shared async discussion log for the team — **agents, devs, and anyone else**.
Treat it like a real team chat: read the context, then add your thoughts, ideas,
and decisions here.

---

## 📌 How to use

1. **Read top-to-bottom first.** This is the source of truth for what's been discussed and decided.
2. **Append-only.** Add your message at the **bottom** of the Thread. Never edit or delete anyone else's message.
3. **One message = one block**, separated by a \`---\` line.
4. If your message settles something, also add a one-line entry to **Decisions** below.

## 👀 Reading efficiently

If this is your **first time**, read the whole file top-to-bottom.
If you've **read this channel before**, recall the last \`#msg-NNN\` you saw and read only messages after it.

## ✍️ Message format

\`\`\`
---
**[role]** \`name\` · \`YYYY-MM-DD HH:MM\` · \`#msg-NNN\` · #tag

Your message here.
\`\`\`

- **role** — \`dev\` or \`agent\` (or other)
- **\`#msg-NNN\`** — take the highest real \`#msg-<number>\` in Thread and add 1

---

## 📌 Decisions

- _(none yet)_

---

## 💬 Thread

---
**[agent]** \`onboarding-agent\` · \`2026-06-27 00:00\` · \`#msg-001\` · #fyi

Channel set up. Welcome, team.

------ conversation starts from here --------
`;
}

console.log('\n── Channels ──────────────────────────────────');
for (const ch of CHANNELS) {
  const slug = slugify(ch.name);
  const chanDir = path.join(ROOT, 'channels', `channel_${slug}_${ch.uuid12}`);
  ensureDir(chanDir);

  const memberLines = ch.members.map(a => {
    const uid = uuid12FromId(a.id);
    return `- **Name:**   ${a.name}
- **UserId:** \`${uid}\`
- **Role:**   ${a.role}
- **Path:**   ~/.agent-deck/users/user_${slugify(a.name)}_${uid}.md`;
  }).join('\n\n');

  const chanMd = `# Channel: ${ch.name}

- **ChannelId:** \`${ch.uuid12}\`
- **Type:**      ${ch.type}
- **Path:**      ~/.agent-deck/channels/channel_${slug}_${ch.uuid12}/

## Description
${ch.description}

## Members

${memberLines}

## Channel conversations file
- ~/.agent-deck/channels/channel_${slug}_${ch.uuid12}/conversations.md
---
`;

  write(path.join(chanDir, 'channel.md'), chanMd);
  write(path.join(chanDir, 'conversations.md'), conversationsMd(ch.name));
  console.log(`  ✓ #${ch.name}  (${ch.uuid12})  →  ${chanDir}/`);
}

console.log('\n✅ Done — all users, Dev Team, and channels created.\n');
