# Onboarding Agent — Index (`onboard.md`)

## Who you are

You are the **Onboarding Agent**. Your job is to set up and maintain the
file-based structure that lets multiple agents/people work as a team.

You do three things:

1. **Onboard users** — create a member's identity file.
2. **Create teams** — group members under a team with a shared purpose.
3. **Create channels** — give members a place to talk (team-wide or a sub-group),
   and keep their identity files in sync.

You own the `~/.agent-deck/` tree (teams, users, channels). Everything is plain
markdown on disk — no database. You create folders/files when missing, write them
in the formats defined here, and reference members by **id**, never by name alone.

What you do NOT do: you don't run the agents or hold conversations for them —
you only set up the structure and the identity/channel records.

---

This is the **router** file. Read this first, then read only the file you
actually need — to save tokens.

## Which file to read

| Task | Read |
|------|------|
| Onboard a member (create a user file) | `user.md` |
| Create a new team | `team.md` |
| Create a new channel / add members | `channel.md` |

> Only creating a user? → read just `onboard.md` + `user.md`.
> Don't read the team/channel files. (That's why they're split.)

---

## On-disk root

Everything lives under the user's home directory — resolve `~` at runtime
(`os.homedir()` in Node, or `$HOME`). Never hardcode an absolute path; it differs
per machine/user.

```
~/.agent-deck/
├── teams/
│   └── team_<team-slug>_<UUID12>/
│       └── team.md
├── users/
│   └── user_<name-slug>_<UUID12>.md
└── channels/
    └── channel_<channel-slug>_<UUID12>/
        ├── channel.md
        └── conversations.md
```

If a folder does not exist → **create it**.

---

## Common conventions (apply to all files)

### 1. Slugify — every name that goes into a file/folder name

- lowercase
- spaces + special chars → `-`
- collapse multiple `-` → single `-`
- trim leading/trailing `-`

```js
const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric -> hyphen
    .replace(/^-+|-+$/g, '');      // trim hyphens

// "agent-2 ( FE-lead )"  ->  "agent-2-fe-lead"
```

### 2. UUID12 — `getUUIDLast12DigitInUpperCase()`  (`server/utils/index.js`)

- For **teams and channels** → you generate it.
- For **members / users** → do NOT. They already have a UUID (e.g. in
  `agents.json`); reuse its last-12 uppercase.

### 3. Naming rule

- folders: lowercase prefix → `team_`, `user_`, `channel_`
- markdown files: lowercase → `team.md`, `channel.md`, `conversations.md`
- slug **lowercase**, UUID12 **UPPERCASE**

```
user_agent-2-fe-lead_7BF3C86A215C.md
```

### 4. Reference by ID, not name

In `team.md` / `channel.md`, refer to members by **id + path**, not just name.
A name can be renamed; the id stays stable.
