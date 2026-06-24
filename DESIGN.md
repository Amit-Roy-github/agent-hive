# Design notes

A control panel for Claude Code agents: launch, drive, gate, and resume them
live — plus a passive tail of everything else. Backend on the Claude Agent SDK;
frontend dependency-free.

## How agents run (SDK)
Each agent is an SDK `query({ prompt, options })` in **streaming-input mode**:
- **input** — `prompt` is an async iterable; we push `{type:'user', message:{role,
  content}}` objects into a per-agent queue as the user types. Same queue is how
  `say` and the auto-resume-on-send work.
- **output** — `for await (const msg of query)` yields SDK messages whose shape
  matches the raw transcript (`assistant`/`user` with `message.content`,
  `system:init`, `result`). One `normalize()` serves both live agents and the
  passive JSONL tail.
- **session** — captured from `system:init` (`session_id`); `resume` reuses it,
  and it maps to the same `~/.claude/projects/…jsonl` the tailer reads.
- **stop** — `query.interrupt()` + close the input stream. The resulting
  AbortError is treated as a clean exit (`a.stopping` flag), not an error.

## Permissions ("safe auto, risky pe pucho")
`options.canUseTool(tool, input, {toolUseID})` is the single gate. It calls
`checkPerm`, which applies policy: safelist (Read/Glob/Grep/…) and `full` trust →
auto-allow; `readonly` → deny; otherwise a `perm-request` is broadcast and the
returned Promise is held until the UI posts `/api/perm`. Verdict shape is the
SDK's `PermissionResult`: `{behavior:'allow', updatedInput}` or `{behavior:'deny',
message}` — exactly what `resolvePerm` builds. `permissionMode` is `plan` for
read-only agents, `default` otherwise (the callback does the rest).

## Why the SDK (vs the earlier raw CLI)
The raw approach spawned `claude` directly, hand-parsed stream-json, and bridged
permissions through a stdlib MCP server (`perm-mcp.mjs`). The SDK does the same
under the hood but gives typed messages + a `canUseTool` callback, so the MCP
bridge and manual parser are gone. Cost: one dependency. Tokens/auth/limits are
identical — it's the same Claude Code engine.

## UI — "signal console"
Ink-base palette; per-kind signal colours are the hero (user #5aa2ff, assistant
#e0b34a, thinking #b07bf0, tool #3fd0c9, err #ff6b63). Each agent carries a user
colour. Two views: Grid (live tiles) ⇄ Focus (chat + composer). User messages sit
right as bubbles, assistant left; thinking quiet/italic; tool calls collapse to a
one-line peek; permission requests are red Allow/Deny cards inline. Stopped agents
keep an enabled composer (↵ resumes) and a Resume button. Light theme via
`:root[data-theme=light]`, persisted, FOUC-guarded.
