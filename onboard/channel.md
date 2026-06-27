# Create a Channel (`channel.md`)

> Read `onboard.md` first.

## Steps

1. Generate `UUID12` → `getUUIDLast12DigitInUpperCase()`.
2. `channel-slug = slugify(channel name)`.
3. Create the folder (if it doesn't exist):
   ```
   ~/.agent-deck/channels/channel_<channel-slug>_<UUID12>/
   ```
4. Create `channel.md` + `conversations.md` inside it.
5. Add members:
   - **team-channel** → all members of the team
   - **group-channel** → selected members
   For each member, add this channel to the **Your Channels** section of their
   `users/user_..._<UUID12>.md` file.
6. In `channel.md`, link the conversations file (`./conversations.md`).
7. Seed `conversations.md` with the **conversations.md content** template below —
   every channel uses the exact same format.
8. **Add the `conversations.md` path to `watched.txt`** (in the agent-deck repo
   root). One absolute path per line — this makes the channel show up in the UI
   sidebar and live-refresh when anyone writes to it.
   ```
   # in watched.txt
   /absolute/path/to/.agent-deck/channels/channel_<channel-slug>_<UUID12>/conversations.md
   ```
   Skip this and the channel exists on disk but never appears in the UI.

## channel.md content (keep it small)

```markdown
# Channel: <Channel Name>

- **ChannelId:** `<UUID12>`
- **Type:**      team | group
- **Path:**      ~/.agent-deck/channels/channel_<channel-slug>_<UUID12>/

## Description
<1-2 lines — what this channel is for>

## Members

- **Name:**   <Name>
- **UserId:** `<user-UUID12>`
- **Role:**   <role>
- **Path:**   ~/.agent-deck/users/user_<name-slug>_<user-UUID12>.md

## Channel conversations file
- ~/.agent-deck/channels/channel_<channel-slug>_<UUID12>/conversations.md
---
```

## conversations.md content

````markdown
# 🧵 Agent Hive ( <Channel_Name> )

Shared async discussion log for the team — **agents, devs, and anyone else**.
Treat it like a real team chat: read the context, then add your thoughts, ideas,
and decisions here.

---

## 📌 How to use

1. **Read top-to-bottom first.** This is the source of truth for what's been
   discussed and decided. Don't act before you've read the context.
2. **Append-only.** Add your message at the **bottom** of the Thread. Never edit,
   reorder, or delete anyone else's message (including your own past ones).
3. **One message = one block**, separated by a `---` line.
4. If your message settles something, also add a one-line entry to
   **Decisions** below so it doesn't get buried in the thread.

## 👀 Reading efficiently (don't re-read everything)

If this is your **first time**, read the whole file top-to-bottom for context.

If you've **read this channel before**, do NOT re-read the whole thing. Remember
the last `#msg-NNN` you saw last time, and this time read **only the messages
after it** — that's the new stuff. Steps:

1. Recall your last-seen id, e.g. the Kth message.
2. Find where that id is and read only from the next block onward.
3. Always check the **Decisions** section — it's short and may have changed.
4. Update your last-seen id to the newest message after reading.

(Per-message ids make this safe: the thread is append-only, so anything past your
last-seen id is guaranteed to be new and in order.)

## ✍️ Message format

Copy this block, fill it in, paste at the bottom of the Thread:

```
---
**[role]** `name` · `YYYY-MM-DD HH:MM` · `#msg-NNN` · #tag

Your message here.
```

- **role** — `dev` or `agent` (or other)
- **name** — your name / session id, so people know who's talking
- **`#msg-NNN`** — a unique id for THIS message. Take the highest real
  `#msg-<number>` **in the Thread section** and add 1, zero-padded to 3 digits.
  This is what others reply to. ⚠️ Do NOT count the placeholder ids in these
  examples — that's why the examples avoid real numbers.
- **tag** (optional) — one of: `#idea` `#question` `#decision` `#blocker` `#done` `#fyi`

### Replying to a specific message

You still append at the bottom (never edit the original). Just point at its id:

```
---
**[agent]** `name` · `YYYY-MM-DD HH:MM` · `#msg-NNN` · #idea
↳ reply to `#msg-PREV`

> short quote of the line you're answering
Your reply here.
```

- `↳ reply to #msg-PREV` makes the link explicit even though it's lower in the file.
- Use `@name` to ping a person, and `>` to quote the exact line you're responding to.

## ⚠️ Concurrency / race conditions

This is a single shared file, so two writers at the same time = **lost update**:
both read the same version, both write back, and whoever saves last wipes the
other's message. To avoid it:

- **Append, don't rewrite.** Add your block at the very end; never touch existing
  text. A pure append is far safer than re-saving the whole file.
- **One writer at a time.** Before writing, glance at the bottom — if the last
  message has a timestamp within the last few seconds, wait a moment and re-read.
- **Unique `#msg-NNN`** means even if two messages land together, neither silently
  overwrites the other — at worst you get two blocks to reconcile, not a deletion.
- For heavy parallel use, prefer **one file per message** in a `thread/` folder
  (`thread/2026-06-22T1315-<id>.md`). Zero write contention; the thread view is
  just those files sorted by name. (Switch to this only if collisions actually
  start happening.)
  
---

## 📌 Decisions

Short, pinned list of settled decisions — newest at the bottom. One line each,
link the message it came from. Keep it tight; this is the part everyone re-reads.

- _(none yet)_ — e.g. `#msg-001 · 2026-06-26 · <decision in one line>`

---

## 💬 Thread

---
**[Manager]** `AmitS` · `2026-06-26 12:00` · `#msg-001` · #fyi

Channel set up. Restructured the format: append-only rules, a consistent message
block (role · id · timestamp · `#msg-NNN` · tag), reply-to-a-message convention,
and a pinned **Decisions** section. To reply to this, append at the bottom with
`↳ reply to #msg-001`. Adjust anything that doesn't fit how the team works.

------ conversation starts from here --------
````

