# Bacchetta

**Multi-agent AI coding dashboard for [OpenCode](https://github.com/opencode-ai/opencode)**

Bacchetta adds a real-time dashboard and an orchestrated agent pipeline on top of OpenCode. Instead of one model doing everything, a **commander** routes tasks to specialists — researcher, coder, reviewer, and more — with a **guardian** that strips secrets before anything touches the internet.

Works with **Ollama Cloud** ($20/month subscription, no GPU needed) and **local Ollama** (for high-end setups).

---

## Dashboard

![Projects page with active session monitor](docs/images/projects-page-mid-rag.png)

*Projects page — manage projects, view live sessions, launch the monitor panel*

![Agents page](docs/images/agents-page.png)

*Agents page — view and edit every agent's system prompt and model*

![Monitor page showing live agent activity](docs/images/monitor-page-with-active-session.png)

*Session monitor — watch every agent step in real time, grouped by prompt*

![Usage page](docs/images/usagepage.png)

*Usage page — token usage and cost across all sessions*

![Settings page](docs/images/sttings-page-.png)

*Settings page — configure memory, models, and behaviour*

---

## What it does

- **Dashboard** at `localhost:6969` — monitor live agent activity, manage agents, view memory, switch projects
- **Commander agent** — orchestrates all work; routes to the right specialist, never builds without reviewing
- **11 specialist agents** — researcher, coder, quick, reviewer, guardian, memory-keeper, teacher, vision, diagram, docs, test-writer
- **Web search** — researcher uses [SearXNG](https://github.com/searxng/searxng) (self-hosted, started automatically via Docker) so searches stay private
- **Security layer** — guardian strips API keys, tokens, and credentials from briefs before they reach the internet
- **Persistent memory** — [opencode-mem](https://github.com/opencode-ai/opencode-mem) auto-captures memories from every session; Bacchetta also extracts structured memory and embeds it for semantic search

---

## Prerequisites

| Requirement | Install |
|-------------|---------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **OpenCode** | `npm install -g opencode-ai` |
| **Ollama** (local, for memory embeddings) | [ollama.com](https://ollama.com) |
| **Ollama Cloud account** *(recommended)* | [ollama.com](https://ollama.com) — $20/month, no GPU needed |
| **Docker Desktop** *(optional)* | [docker.com](https://www.docker.com/products/docker-desktop) — enables web search |

---

## Install

```bash
npm install -g bacchetta
bacchetta install
```

The installer walks you through everything:

1. Checks for OpenCode, Ollama, and Docker
2. Detects and backs up any existing OpenCode config
3. Asks whether you're using Ollama Cloud or local Ollama
4. Sets up agents, plugins, and memory

**Your existing OpenCode setup is safe.** Bacchetta backs up `opencode.json` before touching anything. `bacchetta uninstall` restores it exactly as it was.

### Ollama Cloud setup

Select option 1 during install. Ollama Cloud is a **$20/month subscription** that lets you run large models (Gemini, Kimi, GLM) via API without owning a GPU. You'll be asked for your API key from [ollama.com/settings/keys](https://ollama.com/settings/keys).

The installer will print the exact command to save it as a permanent environment variable — no need to re-enter it each time.

### Local Ollama setup

Select option 2 during install. The installer shows hardware requirements and recommended models:

| VRAM / RAM | Recommended models |
|-----------|-------------------|
| 8 GB | `qwen2.5-coder:7b`, `gemma3:4b` |
| 16 GB | `qwen2.5-coder:14b` |
| 32 GB+ | `qwen2.5-coder:32b`, `llama3.3:70b` |

The installer prints the exact `ollama pull` commands for your chosen models.

---

## Start

```bash
bacchetta start
```

Dashboard opens at **http://localhost:6969**

Then use OpenCode either way:
- Run `opencode` in any project folder as usual
- Or open the dashboard → **Projects** → add a folder → **Launch New**

If you get a port conflict:

```bash
bacchetta restart
```

---

## How it works

Every task goes through a fixed pipeline:

```
You
  → commander
    ├─ (image in message?) → vision first
    ├─ guardian  ← strips secrets from the researcher brief
    ├─ researcher ← reads code, traces logic, searches the web
    ├─ YAGNI check (does this actually need to be built?)
    ├─ coder or quick ← writes the code
    ├─ reviewer ← 9-category audit, writes plan files if issues found
    └─ (issues found?) → fix loop → reviewer again
  → 2–3 line summary back to you
```

Commander has no file/bash tools itself — it can only delegate. This means it never skips the researcher, never skips the reviewer, and never puts your input directly into a web search.

---

## Agents

| Agent | Mode | What it does |
|-------|------|-------------|
| **commander** | primary | Orchestrates everything — routes tasks, runs YAGNI checks, ensures reviewer always runs |
| **guardian** | subagent | Sanitizes briefs — strips API keys, tokens, and credentials before they reach internet-connected agents |
| **researcher** | subagent | Reads files, traces logic, searches the web via SearXNG |
| **coder** | subagent | Multi-file implementation, new features, refactors |
| **quick** | subagent | Single-file edits, config changes, small fixes |
| **reviewer** | subagent | 9-category audit after every build — writes plan files for anything critical |
| **memory-keeper** | subagent | Captures important context before it gets compressed out of the session |
| **teacher** | primary | Explains concepts from first principles, fetches and searches CF documentation |
| **vision** | subagent | Interprets screenshots and images |
| **diagram** | subagent | Generates `.drawio` architecture diagrams, flowcharts, ERDs |
| **docs** | subagent | Writes and updates documentation files |
| **test-writer** | subagent | Writes tests for new code — unit, integration, and edge cases |

![System prompt view](docs/images/system_prompt_dictionary.png)

*Every agent's system prompt is visible and editable from the dashboard*

---

## The Guardian

When commander prepares a brief for researcher, it first passes it through `@guardian`. The guardian pattern-matches for:

- Stripe keys (`sk_live_*`, `sk_test_*`, `pk_live_*`)
- GitHub tokens (`ghp_*`, `ghs_*`)
- AWS access keys (`AKIA*`)
- Bearer tokens, JWTs, private keys
- `password=`, `secret=`, `token=` inline assignments
- Database connection strings with embedded credentials

Sensitive values are replaced with `[REDACTED: type]` before the brief reaches researcher. This prevents credentials from appearing in SearXNG queries or `webfetch` URLs, where they could end up in external search engine logs.

---

## Web search (SearXNG)

![Terminal showing provider setup](docs/images/termial-provider-setup.png)

Bacchetta starts a [SearXNG](https://github.com/searxng/searxng) Docker container automatically on `bacchetta start`. SearXNG is a self-hosted meta-search engine — it queries Google, DuckDuckGo, Bing, GitHub, Stack Overflow, npm, and MDN, then returns results without tracking you.

**Requires Docker Desktop.**

On first start, Docker pulls the SearXNG image (~150MB, one-time). After that it starts in under a second. If you don't have Docker, everything else still works — the researcher just won't have web search.

---

## Memory

Bacchetta layers two memory systems on top of OpenCode:

**[opencode-mem](https://github.com/opencode-ai/opencode-mem)** — runs alongside OpenCode and automatically captures memories from every conversation. Visible in the dashboard as a live status indicator.

**Bacchetta structured memory** — a background job extracts key facts from sessions as they go idle, embeds them with `bge-m3` (via local Ollama), and stores them in a SQLite vector database. Agents automatically get relevant past context injected into new sessions. Searchable from the Agents → Settings tab.

---

## Uninstall

```bash
bacchetta uninstall
```

This will:
- Restore your original `opencode.json` from the backup taken at install time
- Remove all agent files that bacchetta created (files you modified are kept)
- Remove plugin files
- Print commands to remove npm packages if you want them fully gone

---

## Data locations

| What | Where |
|------|-------|
| Agent files | `~/.config/opencode/agents/` |
| Plugin files | `~/.config/opencode/plugin/` |
| Install manifest | `~/.config/opencode/bacchetta-manifest.json` |
| opencode.json backup | `~/.config/opencode/opencode.json.bacchetta.bak` |
| Session database | `~/.local/share/opencode/opencode.db` |
| Structured memory | `~/.local/share/opencode/clause-memory/` |
| Memory + RAG index | `~/.local/share/opencode/clause-memory.db`, `clause-rag.db` |

---

## Works with

| Setup | Notes |
|-------|-------|
| **Ollama Cloud** | Recommended. $20/month subscription, no GPU needed. Sign up at [ollama.com](https://ollama.com) |
| **Local Ollama** | Free, runs on your machine. 16GB+ RAM/VRAM recommended for the full agent stack |
| **Any OpenCode provider** | Swap models any time in `~/.config/opencode/opencode.json` |

---

## Built on

| Project | What it provides |
|---------|-----------------|
| [opencode-ai/opencode](https://github.com/opencode-ai/opencode) | The AI coding engine Bacchetta runs on top of |
| [opencode-ai/opencode-mem](https://github.com/opencode-ai/opencode-mem) | Session memory capture service |
| [searxng/searxng](https://github.com/searxng/searxng) | Self-hosted meta-search engine for the researcher agent |
| [Ollama](https://ollama.com) | Local model runtime + Ollama Cloud API |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite for the RAG and memory databases |
| [React](https://github.com/facebook/react) | Dashboard UI |
| [Recharts](https://github.com/recharts/recharts) | Usage charts and graphs |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | Dashboard styling |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | 7-rung YAGNI decision ladder embedded in coder, quick, and reviewer agents |
| [shadcn/improve](https://github.com/shadcn/improve) | 9-category audit structure and self-contained plan file format used by the reviewer agent |
| [Agents365-ai/drawio-skill](https://github.com/Agents365-ai/drawio-skill) | Diagram agent approach: 6 presets, self-checking loop, code visualization, PNG export |
| [nvidia/skillspector](https://github.com/nvidia/skillspector) | Security scanning patterns informing the guardian agent's credential detection |

---

## License

MIT
