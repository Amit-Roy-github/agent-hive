# Create a Team (`team.md`)

> Read `onboard.md` first. If onboarding members, read `user.md` too.

## Steps

1. Generate `UUID12` → `getUUIDLast12DigitInUpperCase()`.
2. `team-slug = slugify(team name)`.
3. Create the folder (if it doesn't exist):
   ```
   ~/.agent-deck/teams/team_<team-slug>_<UUID12>/
   ```
4. Write `team.md` inside it (format below).
5. For each member → follow `user.md` to create their user file, then add a
   reference to them in the `team.md` **Members** section.

## team.md content

```markdown
# Team: <Team Name>

- **TeamId:** `<UUID12>`
- **Path:**   ~/.agent-deck/teams/team_<team-slug>_<UUID12>/team.md

## About
<2-3 lines — why this team exists, what it does>

## Members

- **Name:**   <Name>
- **UserId:** `<user-UUID12>`
- **Role:**   <role>
- **About:**  <one-line description>
- **Path:**   ~/.agent-deck/users/user_<name-slug>_<user-UUID12>.md
---
- **Name:**   <Name>
- **UserId:** `<user-UUID12>`
- **Role:**   <role>
- **About:**  <one-line description>
- **Path:**   ~/.agent-deck/users/user_<name-slug>_<user-UUID12>.md
---
```

Refer to members by **UserId + Path**, not just name. Keep the file small.
