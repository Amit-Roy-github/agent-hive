# `users/user.js` — the create-user method

This is the **single source of truth** for a member's identity file. The format
lives here and nowhere else — the server only *reads* the file this produces.

## What it makes

One file per member:

```
~/.agent-deck/users/user_<name-slug>_<UUID12>.md
```

That file **is** the identity. The deck server injects it into the agent's system
prompt every turn, so the agent never forgets who it is — even after compaction.

## Who calls it

Same code, two callers:

1. **Runtime (no onboarder).** When a new agent is spawned and there's no
   onboarding agent around, the server calls `createUser({...})` so identity is
   still created automatically.
2. **Onboarding agent.** Calls it the same way while setting up a member.

It's plain readable Node — no MCP, nothing hidden. If a call errors, open
`users/user.js`, read the line the error points at, fix it, re-run.

## How to call

**As a module:**

```js
import { createUser } from './users/user.js';

const { file, userId } = createUser({
  id:    'e81d746d-d7b3-4659-8527-6cbf8ad35cd4', // member's FULL agent id (agents.json)
  name:  'agent-2 (FE-lead)',
  color: '#46c06a',                              // the agent's deck color (from agents.json)
  role:  'Frontend lead',
  who:  'Owns i14-web UI work; reviews dev PRs.',
  teams:    [{ name: 'i14 Web',        uuid12: 'A1B2C3D4E5F6', role: 'lead' }],
  channels: [{ name: 'voucher-revamp', uuid12: '9D8C7B6A5F4E', why:  'FE owner' }],
});
// → userId = last 12 of id, UPPERCASE = "6CBF8AD35CD4"
//   file   = ~/.agent-deck/users/user_agent-2-fe-lead_6CBF8AD35CD4.md
```

**From the CLI:**

```bash
node users/user.js '{"id":"e81d...cd4","name":"agent-2 (FE-lead)","role":"FE lead"}'
```

(no arg → writes a demo file so you can see the shape.)

`teams` / `channels` are optional — omit or pass `[]` and those sections render empty.

## How it works (so you can fix it)

| export          | does |
|-----------------|------|
| `slugify(s)`    | lowercase, non-alphanumeric → `-`, trim hyphens. `"agent-2 ( FE-lead )"` → `agent-2-fe-lead`. |
| `uuid12(id)`    | `id.slice(-12).toUpperCase()`. The member **reuses** its own agent id — never generate a new one. |
| `userFilePath`  | `~/.agent-deck/users/user_<slug>_<UUID12>.md` (`~` via `os.homedir()`, never hardcoded). |
| `renderUser`    | fills the identity template; `teams`/`channels` are `.map`-ed so empty arrays → empty sections. |
| `createUser`    | validates `id`+`name`, makes `users/` if missing, writes the file, returns `{ file, userId }`. |

The write is idempotent: same name + id → same path, overwritten cleanly.

## The file it produces

```markdown
# User: <Name>

## Identity
- **Name:**   <Name>
- **UserId:** `<UUID12>`
- **Color:**  <hex, e.g. #ff9f45 — the agent's deck color>
- **Role:**   <role>
- **Who:**    <one line — who this is>

## Your Teams

- **Team:**   <Team Name>
- **TeamId:** `<team-UUID12>`
- **Path:**   ~/.agent-deck/teams/team_<team-slug>_<team-UUID12>/team.md
- **Role:**   <role in this team>
---

## Your Channels

- **Channel:**   <Channel Name>
- **ChannelId:** `<chan-UUID12>`
- **Path:**      ~/.agent-deck/channels/channel_<chan-slug>_<chan-UUID12>/conversations.md
- **Why:**       <why added>
---
```

No teams/channels yet → keep the headings with empty lists; re-run with the filled
arrays (or edit the file) when they're created.
