# Onboard a User (`user.md`)

> Read `onboard.md` first (common: slugify, UUID12, paths). Then this.
> **For the onboarding agent only.** The member's own agent never reads this file —
> it only receives the identity file the method creates.

## Goal

Give a member their identity file:

```
~/.agent-deck/users/user_<name-slug>_<UUID12>.md
```

The server injects this into the member's system prompt every turn, so they never
forget who they are. You only need it **created** — you don't hand-write it.

## How — call the create-user method

Don't write the markdown yourself. Call the method in **`users/user.js`**:

```js
import { createUser } from '../users/user.js';

createUser({
  id:    '<member's FULL agent id from agents.json>', // userId = its last 12, UPPERCASE
  name:  '<member name>',
  color: '<hex from agents.json, e.g. #46c06a>',       // the agent's deck color
  role:  '<FE-lead / BE-dev / QA / ...>',
  who:   '<one line — who this is>',
  teams:    [ /* { name, uuid12, role } — existing teams, optional */ ],
  channels: [ /* { name, uuid12, why } — existing channels, optional */ ],
});
```

Or CLI: `node users/user.js '<json-input>'`.

- The same method also runs at **runtime** when an agent is spawned with no
  onboarder — so identity is always created, with or without you.
- It's plain Node, nothing hidden. If a call errors, open `users/user.js`, read
  the failing line, fix it, re-run.

Full reference (every export, the template, how to fix it) → **`users/user.md`**.

## Key rule: reuse the member's id

`<UUID12>` = the member's **own** agent id (from `agents.json`), last-12 UPPERCASE.
Do **NOT** generate a new one — that id is their durable identity.

## Required: update `agents.json` after creating the user file

Creating the file on disk is **not enough**. The deck server reads `agents.json` to
know which identity file to inject. After every `createUser` call, write `userId`
and `userFile` back into the agent's entry in `agents.json`:

```js
// patch agents.json
const agentsPath = '<repo>/agents.json';
const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
const entry = agents.find(a => a.id === input.id);
if (entry) {
  entry.userId   = userId;      // last-12 UPPERCASE
  entry.userFile = file;        // absolute path to the .md file
}
fs.writeFileSync(agentsPath, JSON.stringify(agents, null, 2));
```

If you skip this step, the user file exists on disk but the server never sees it —
the agent gets no identity injected.
