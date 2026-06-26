#### Mission : SH - 3.0
# Agent Monitor

A live control panel for Claude Code agents, built on the **Claude Agent SDK**.
Launch agents from the browser, give each a name + colour, talk to them in real
time, and approve/deny risky tool calls. Externally started sessions
(`~/.claude/projects/`) and watched files are tailed alongside.

The backend is a small Node server using the SDK; the frontend is dependency-free
(vendored marked + DOMPurify, no build step). Auth is your existing Claude Code
login — no separate API key, same subscription and rate limits.

## Run

```bash
cd ~/development/agent-deck
npm install        # pulls the Claude Agent SDK (first time only)
npm start          # ./start.sh — pins a compatible Node, frees the port, runs
# open http://127.0.0.1:8787
```

> **Node ≥ 22 required.** The Claude Agent SDK uses `Symbol.asyncDispose`; on
> older Node every agent fails to start/resume with `TypeError: Object not
> disposable`. `start.sh`/`dev.sh` auto-select an installed Node ≥ 22 (preferring
> 25) so they never fall back to the shell's default — don't launch `server.js`
> with a bare `node` unless you know it's ≥ 22 (the server guards and exits if not).

For development use `npm run dev` (→ `dev.sh`, nodemon) — auto-restarts the
server when backend code (`server.js`, `server/`) changes, on the same Node ≥ 22.
Frontend (`public/`) and runtime state (`agents.json`, `watched.txt`) are **not**
watched: UI edits just need a browser refresh, and state writes must not trigger
restarts (a restart drops any running agents — they can be **Resumed**
afterwards). Override the port with `PORT=8799 npm run dev`.

The server logs the agent lifecycle (start/resume/ready/SDK errors) to the
terminal — watch it there when an agent won't start or resume.

Code style is prettier with 4-space indent (`.prettierrc`); run `npm run format`.

## What it does

- **Launch agents** — `+ New`: pick working dir, name, colour, model, trust, and
  a first message. The server starts an SDK `query()` in streaming-input mode.
- **Talk to them** — send messages to a running agent; watch thinking, tool
  calls and replies stream in. Stop any agent.
- **Resume** — a stopped agent isn't dead: hit **Resume** (or just send a
  message) and it continues the same conversation via the SDK's `resume`, full
  context intact.
- **Survives restart** — agents you create are saved to `agents.json`; on reboot
  they come back (as stopped) with their history, ready to Resume.
- **Permissions ("safe auto, risky pe pucho")** — safe tools (Read/Glob/Grep/…)
  auto-run; risky ones (Bash/Write/Edit/…) pause and surface an **Allow / Deny**
  card in the UI, via the SDK's `canUseTool` callback.
- **Two views** — **Grid** (live tile per agent) ⇄ **Focus** (one agent: full
  chat + input). Toggle in the header.
- **Passive tail** — every `~/.claude/projects/**.jsonl` session and any watched
  file is listed read-only in the sidebar.
- **Adopt any session** — open an *inactive* externally-started session and hit
  **Resume here**: it loads the history and becomes a live agent you can talk to
  (via the SDK's `resume`). Active/live sessions stay view-only to avoid clashing
  with the process that owns them.
- Light / dark theme.

## Trust levels

| Trust      | `permissionMode` | Risky tools                            |
|------------|------------------|----------------------------------------|
| `safe`     | `default`        | `canUseTool` → prompt the UI           |
| `full`     | `default`        | `canUseTool` → auto-approve everything |
| `readonly` | `plan`           | agent only plans, no edits             |

## Architecture

```
Browser ──POST /api/agents──▶ server.js ──query()──▶ Claude Agent SDK ──▶ claude
   ▲        /say /stop /resume    │  streaming input (async iterable)
   │                              │  canUseTool(tool, input) ─┐
   └──── SSE (agent-append,       │                           │ safe? auto-allow
         agent-status,            │  for await (msg) → normalize() → UI
         perm-request) ◀──────────┘                           │ risky → broadcast UI
                  ▲                                            ▼
                  └──────── /api/perm (UI clicks Allow/Deny) ──┘
```

- The SDK drives the same `claude` engine, so each agent persists to
  `~/.claude/projects/…jsonl` — the same files the passive tailer reads, and what
  `resume` continues from.
- `canUseTool` returns a Promise; for risky tools the server holds it open until
  the UI answers (`checkPerm`/`resolvePerm` in `server/permissions.js`).
- SDK messages share the shape of the raw transcript, so one `normalize()` feeds
  both live agents and passive sessions.

## Layout

```
server.js          entry: wire the modules + boot
server/
  config.js        constants, paths, env
  sse.js           the broadcast channel to browsers
  normalize.js     raw/SDK message -> UI entries (pure)
  state.js         the shared agent registry
  sessions.js      passive tail: cache, watched files, poll loop
  permissions.js   canUseTool gate <-> UI allow/deny
  agents.js        SDK agents: spawn/say/stop/resume/adopt + persistence
  http.js          request router (static, API, SSE)
public/
  index.html       markup
  app.css          styles + light/dark
  app.js           SSE client, grid/focus views, perm cards, composer
  vendor/          marked + DOMPurify (offline, dependency-free frontend)
agents.json        runtime: saved agents (id, name, colour, cwd, sessionId…)
watched.txt        runtime: extra files tailed as pseudo-sessions
```

## Config (env)

| Var                   | Default              | Meaning                          |
|-----------------------|----------------------|----------------------------------|
| `PORT`                | `8787`               | HTTP port                        |
| `HOST`                | `127.0.0.1`          | bind address                     |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | where session JSONL files live   |
| `PERM_TIMEOUT_MS`     | `300000`             | auto-deny a permission after…    |
| `POLL_MS`             | `1000`               | passive file poll interval       |
