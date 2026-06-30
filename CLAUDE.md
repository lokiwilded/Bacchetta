# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What clause is

A minimal overlay on [opencode-ai/opencode](https://github.com/opencode-ai/opencode) that adds a dashboard without forking. Two layers: surgical patch scripts that modify opencode's compiled output, and a standalone server + React SPA that runs alongside opencode.

## Commands

```bash
# From ui/ — dev, build, run
bun run dev          # Vite hot-reload on :5173 (proxies /api/* to :3001)
bun run build        # vite build → scripts/build.ts copies to public/dashboard.html + ../../public/dashboard.html
bun run server.ts    # Production server on :6969

# From server/ — run and test the Node production server
node index.js        # Production Node server on :6969
npm test             # node --test tests/*.test.js  (58 tests, ~80ms)

# From the opencode repo root — apply overlay patches
bash clause/overlay/apply.sh
```

## Two-server architecture

**Production:** `server/index.js` — a plain Node.js HTTP server on :6969. Handles all clause API routes, serves `public/dashboard.html`, and proxies everything else to the active opencode instance (port from `opencode_port` cookie, default 4000).

**Dev:** `ui/server.ts` — a Bun TypeScript server with the same routing logic. Route handlers live in `ui/routes/*.ts`. In dev mode Vite handles the SPA on :5173.

Both servers share identical logic — when updating a route, update both the `server/routes/*.js` (Node) and `ui/routes/*.ts` (Bun) versions.

## Route handler map

| Route | Node | Bun | What it does |
|-------|------|-----|-------------|
| `/api/agents` | `server/routes/agents.js` | `ui/routes/agents.ts` | GET/PUT agent `.md` files; surgical frontmatter patching |
| `/api/sessions` | `server/routes/sessions.js` | `ui/routes/sessions.ts` | Lists sessions by project dir (queries `opencode.db` directly) |
| `/api/settings` | `server/routes/settings.js` | `ui/routes/settings.ts` | GET/POST `clause-settings.json` |
| `/api/memory` | `server/routes/memory.js` | `ui/routes/memory.ts` | CRUD for memory markdown files + search + profile sub-routes |
| `/api/restart` | `server/routes/restart.js` | `ui/routes/restart.ts` | Kill + respawn opencode; waits up to 25s for health |
| `/api/projects` | `server/routes/projects.js` | `ui/routes/projects.ts` | Manages `clause-projects.json`; spawns opencode on ports 4001–4005 |

## Agent file format

Files at `~/.config/opencode/agents/<name>.md`. OpenCode validates these with a Zod schema.

```
---
model: ollama-cloud/gemini-3-flash-preview:cloud
mode: primary          # primary | subagent
description: ...
permission:            # OpenCode's tool permission system — object format, not array
  edit: deny
  task: allow
clause_tools:          # Clause-specific tool restriction (NOT tools: — that's OpenCode's key)
  - read
  - glob
---
System prompt body here.
```

**Critical:** Never write `tools:` as a YAML list (array format) — OpenCode validates `tools:` as an object and will throw `ConfigInvalidError`, breaking its entire agent system. Clause uses `clause_tools:` for its own tool restriction list.

`parseFrontmatter` and `patchContent` in `agents.js/agents.ts` surgically patch only changed fields, preserving `permission:` blocks exactly.

## Memory system

Memory is handled by the **opencode-mem** plugin (installed by `clause install`). It:
- Auto-captures memories from conversations as you work
- Uses local Ollama bge-m3 for embeddings (free, runs on GPU)
- Uses Ollama Cloud deepseek-v4-flash (or your local model) for extraction
- Has its own web UI at http://localhost:4747
- Injects relevant memories at the start of each new session

Config lives at `~/.config/opencode/opencode-mem.jsonc`. No clause-side extraction job runs — opencode-mem owns all memory operations.

## Settings

`clause-settings.json` stores both numeric and string settings. `settings.js` exports `validateAndMerge(body, current)` which only accepts:
- **Numeric keys** (`NUM_DEFAULTS`): must be finite and > 0
- **String keys** (`STR_DEFAULTS`): any string, trimmed

New settings fields: `memory_idle_minutes`, `memory_top_k` (numeric), `memory_model`, `profile_model`, `memory_embed_model` (string).

## Data locations

- Config: `~/.config/opencode/` — `opencode.json`, `agents/*.md`, `clause-settings.json`, `clause-projects.json`
- Data: `~/.local/share/opencode/` — `opencode.db` (opencode's SQLite), `clause-rag.db`, `clause-memory.db`, `clause-memory/` (markdown files)

## Build pipeline

`bun run build` = `vite build` (single inlined HTML via `vite-plugin-singlefile`) → `scripts/build.ts` copies to `public/dashboard.html` AND `../../public/dashboard.html` (Node server's public dir). Always run this after any UI change.

## Tests

```bash
cd server && npm test   # 58 tests covering parseFrontmatter, patchContent, parseChunks, cosine, bufToVec, validateAndMerge
```

Tests live in `server/tests/*.test.js`, use `node:test` + `node:assert/strict`, no external deps. To add a test file: create `server/tests/<name>.test.js` — the glob picks it up automatically.
