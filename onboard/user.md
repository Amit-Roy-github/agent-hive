# Onboard a User (`user.md`)

> Read `onboard.md` first (common: slugify, UUID12, paths). Then this.

## What gets created

One file:

```
~/.agent-deck/users/user_<name-slug>_<UUID12>.md
```

- `<name-slug>` = the member's name, slugified (lowercase)
- `<UUID12>` = the member's **own** UUID, last-12 UPPERCASE — do **NOT** generate a new one

If the `users/` folder doesn't exist → create it.

## File content

```markdown
# User: <Name>

## Identity
- **Name:**   <Name>
- **UserId:** `<UUID12>`
- **Role:**   <role, e.g. FE-lead / BE-dev / QA>
- **Who:**    <one line — who this is>

## Your Teams

- **Team:**   <Team Name>
- **TeamId:** `<team-UUID12>`
- **Folder:** `team_<team-slug>_<team-UUID12>`
- **Role:**   <role in this team>
---

## Your Channels

- **Channel:**   <Channel Name>
- **ChannelId:** `<chan-UUID12>`
- **Folder:**    `channel_<chan-slug>_<chan-UUID12>`
- **Why:**       <why added>
---
```

If there are no teams/channels yet → keep the **Your Teams** and **Your Channels**
headings but leave the lists empty. Add to them later when teams/channels are created.
