# Bacchetta

**Multi-agent AI coding dashboard for [OpenCode](https://github.com/opencode-ai/opencode)**

Bacchetta adds a web dashboard and an orchestrated agent pipeline on top of OpenCode. Instead of one model doing everything, a **commander** routes every task to the right specialist — researcher, coder, reviewer, and more — with a **guardian** that strips secrets before anything touches the internet.

Works with **Ollama Cloud** ($20/month subscription, no GPU needed) and **local Ollama** (free, for high-end setups).

---

## What it does

- **Dashboard** at `localhost:6969` — monitor live agent activity, manage agents, view memory, switch projects
- **Commander agent** — orchestrates all work; routes to the right specialist, runs a YAGNI decision ladder before building, ensures reviewer always runs
- **12 agents total** — commander + 11 specialists: researcher, coder, quick, reviewer, guardian, memory-keeper, teacher, vision, diagram, docs, test-writer
- **Code RAG** — `clause-rag` plugin indexes your codebase with `bge-m3` embeddings so agents find existing patterns before writing anything
- **Private web search** — researcher uses [SearXNG](https://github.com/searxng/searxng) (self-hosted at `localhost:8888` via Docker) so searches stay private
- **Security layer** — guardian strips API keys, tokens, and credentials from briefs before they reach internet-connected agents
- **Session memory** — [opencode-mem](https://github.com/opencode-ai/opencode-mem) auto-captures memories from every session and injects relevant past context into new ones
- **Diagram generation** — diagram agent generates `.drawio` files saved to `~/diagrams/` with 6 presets and self-checking layout
- **Cloudflare docs** — teacher agent can fetch and search Cloudflare D1/KV/Workers/R2 documentation locally
- **Context management** — auto-compact keeps sessions from hitting token limits *(Ollama Cloud only)*

---

## Prerequisites

Install these **before** running `bacchetta install`:

| Requirement | How to get it | Notes |
|-------------|--------------|-------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) | Required to run bacchetta |
| **OpenCode >= 0.3.0** | `npm install -g opencode-ai` | The AI coding engine everything runs on top of. Must be >= 0.3.0 |
| **Ollama** | [ollama.com](https://ollama.com) | Required — used for memory embeddings even on Ollama Cloud |
| **bge-m3 model** | `ollama pull bge-m3` | **Required** — powers code search, RAG, and memory embeddings. Code search and memory won't work without it |
| **Ollama Cloud account** *(recommended)* | [ollama.com](https://ollama.com) — $20/month | Cloud models (Gemini, Kimi, GLM) without a GPU |
| **Docker Desktop** *(optional)* | [docker.com](https://www.docker.com/products/docker-desktop) | Needed only for SearXNG web search — everything else works without it |

**Windows users:** `better-sqlite3` (used for the RAG and memory databases) requires native compilation. On a fresh Windows machine, install [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) first or the install step will fail with a node-gyp error.

---

## Install

```bash
npm install -g bacchetta
bacchetta install
```

**What the installer actually does, in order:**

1. Checks for OpenCode >= 0.3.0, Ollama, bge-m3, and Docker
2. Asks whether you're using Ollama Cloud or local Ollama
3. Backs up your existing `opencode.json` (restored exactly by `bacchetta uninstall`)
4. Installs 6 OpenCode plugin packages into `~/.config/opencode/` *(not globally — see [Plugins](#plugins))*
5. Copies 3 custom plugin files to `~/.config/opencode/plugin/`
6. Copies 12 agent files to `~/.config/opencode/agents/` *(skips any that already exist)*
7. Merges your provider config, models, and plugin list into `opencode.json`
8. Creates `opencode-mem.jsonc` (memory settings) and `clause-settings.json`

### Ollama Cloud setup

Select option 1 during install. You'll be asked for your API key from [ollama.com/settings/keys](https://ollama.com/settings/keys). The installer prints the exact `setx` / `export` command to save it permanently.

### Local Ollama setup

Select option 2. The installer shows recommended models by hardware:

| VRAM / RAM | Recommended models |
|-----------|-------------------|
| 8 GB | `qwen2.5-coder:7b`, `gemma3:4b` |
| 16 GB | `qwen2.5-coder:14b` |
| 32 GB+ | `qwen2.5-coder:32b`, `llama3.3:70b` |

The installer prints the exact `ollama pull` commands for your chosen models.

> **Local Ollama limitation:** The auto-compact plugin (`clause-compact`) is configured for Ollama Cloud and won't work on local setups. All other features — agents, RAG, memory, web search, diagrams — work fully.

---

## Start

```bash
bacchetta start
```

Starts the dashboard server. Open **http://localhost:6969** in your browser (it doesn't open automatically).

Also starts SearXNG in Docker if Docker is installed. First run downloads ~150MB.

Then use OpenCode either way:
- Run `opencode` in any project folder as usual
- Or open the dashboard → **Projects** → add a folder → **Launch New**

Port conflict:

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
    ├─ guardian  ← strips secrets from the brief (skipped for pure questions)
    ├─ researcher ← reads code, traces logic, searches the web via SearXNG
    ├─ YAGNI ladder (does this actually need to be built?)
    ├─ coder or quick ← writes the code
    ├─ reviewer ← 9-category audit, writes plan files if issues found
    └─ (issues found?) → fix loop → reviewer again
  → 2–3 line summary back to you
```

Commander has no file, bash, or edit tools itself — it can only delegate. This means it never skips the researcher, never skips the reviewer, and never puts your input directly into a web search.

---

## Agents

| Agent | Mode | Model (Ollama Cloud) | What it does |
|-------|------|---------------------|-------------|
| **commander** | primary | kimi-k2.6 | Orchestrates everything — routes tasks, runs YAGNI decision ladder, ensures reviewer always runs |
| **guardian** | subagent | gemini-3-flash | Strips API keys, tokens, and credentials from briefs before they reach internet-connected agents |
| **researcher** | subagent | kimi-k2.6 | Reads files, traces logic, searches the web via SearXNG |
| **coder** | subagent | kimi-k2.7-code | Multi-file implementation — runs a 6-rung decision ladder before writing any code |
| **quick** | subagent | deepseek-v4-flash | Single-file edits, config changes, small fixes — 3-question YAGNI check before any edit |
| **reviewer** | subagent | minimax-m2.7 | 9-category audit after every build — writes self-contained plan files for any critical finding |
| **memory-keeper** | subagent | deepseek-v4-flash | Captures important context before it gets compressed out of the session |
| **teacher** | primary | glm-5.2 | Explains concepts from first principles; can fetch and search Cloudflare docs |
| **vision** | subagent | minimax-m3 | Interprets screenshots and images |
| **diagram** | subagent | glm-5.2 | Generates `.drawio` files — 6 presets, self-checking layout loop, saves to `~/diagrams/` |
| **docs** | subagent | deepseek-v4-flash | Writes and updates documentation files |
| **test-writer** | subagent | devstral-small-2 | Writes tests for new code — unit, integration, and edge cases |

Models listed are Ollama Cloud defaults. Local Ollama installs replace all agent models with your chosen model.

Every agent's system prompt is visible and editable from the dashboard (Agents tab).

---

## Plugins

### Custom plugins (3)

TypeScript files copied to `~/.config/opencode/plugin/` during install. They extend OpenCode with new tools available to all agents.

| Plugin | Tools added | What it does |
|--------|------------|-------------|
| **clause-rag** | `index_workspace`, `search_code`, `rag_status` | Crawls your codebase, chunks it into 50-line segments, embeds each with `bge-m3`, stores in `clause-rag.db`. Agents call `search_code()` before writing anything to find existing patterns. Requires Ollama + bge-m3 |
| **clause-cache** | `read_cached`, `bash_cached`, `cache_status` | Caches file reads (1-hour TTL) and bash output (configurable TTL) to avoid re-reading unchanged files. Speeds up multi-step tasks significantly |
| **clause-compact** | *(automatic, no tool)* | Listens for idle sessions and calls OpenCode's summarize API to compress context. **Ollama Cloud only** |

### Third-party plugins (6)

Installed to `~/.config/opencode/` via npm during `bacchetta install`. Not installed globally.

| Package | What it does |
|---------|-------------|
| [opencode-mem](https://github.com/opencode-ai/opencode-mem) | Auto-captures memories from every session; serves them at port 4747; injects up to 3 relevant past memories into new sessions |
| `@tarquinen/opencode-dcp` | Dynamic context pruning — trims irrelevant context to keep sessions efficient |
| `@ramtinj95/opencode-tokenscope` | Tracks token usage per session |
| `opencode-synced` | Keeps agent state consistent during OpenCode operations |
| `opencode-queue` | Manages agent task queuing to prevent concurrent conflicts |
| `@ai-sdk/openai-compatible` | OpenAI-compatible API adapter for the Ollama provider |

> These packages are installed to `~/.config/opencode/`, not globally. They won't appear in `npm list -g`. If you delete `~/.config/opencode/node_modules/` they'll need to be reinstalled.

---

## Memory

Two memory systems layer on top of OpenCode:

**[opencode-mem](https://github.com/opencode-ai/opencode-mem)** — runs alongside OpenCode at port 4747. Auto-captures key facts from every conversation and injects relevant past context into new sessions (up to 3 memories by default). Visible in the dashboard as a live status indicator.

**Code RAG** — `clause-rag` indexes your codebase into a local SQLite vector database (`clause-rag.db`) using `bge-m3` embeddings from your local Ollama. Agents call `search_code()` before writing anything to find existing patterns, naming conventions, and related code across the project.

---

## Web search (SearXNG)

Bacchetta starts a [SearXNG](https://github.com/searxng/searxng) Docker container automatically on `bacchetta start`. SearXNG is a self-hosted meta-search engine — it queries Google, DuckDuckGo, Bing, GitHub, Stack Overflow, npm, and MDN, then returns results without tracking you.

- Runs at `localhost:8888`
- Container named `bacchetta-searxng`
- Config saved to `~/.config/searxng/settings.yml`
- First start pulls ~150MB image (one-time)
- After that, starts in under a second

Requires Docker Desktop. If Docker isn't installed, everything else still works — the researcher just won't have web search.

---

## Cloudflare docs

The teacher agent can fetch and locally index Cloudflare documentation for D1, KV, Workers, and R2. Docs are pulled from Cloudflare's public GitHub and embedded into the RAG index, so teacher can search them without a web request each time.

Docs are saved to `~/.local/share/opencode/cf-docs/` and refresh automatically when Cloudflare publishes an update (checked hourly, refreshed every 7 days).

If docs aren't indexed yet, the teacher agent will tell you — the dashboard also shows a banner with a fetch button.

---

## The Guardian

When commander prepares a brief for researcher, it passes it through `@guardian` first. Guardian strips:

- Stripe keys (`sk_live_*`, `sk_test_*`, `pk_live_*`)
- GitHub tokens (`ghp_*`, `ghs_*`)
- AWS access keys (`AKIA*`)
- Bearer tokens, JWTs, private keys
- `password=`, `secret=`, `token=` inline assignments
- Database connection strings with embedded credentials

Values are replaced with `[REDACTED: type]` before the brief reaches researcher. Guardian is skipped for pure factual questions that contain no user-provided values (no credentials or keys to accidentally expose).

---

## Diagrams

The diagram agent generates `.drawio` XML files and saves them to `~/diagrams/`. It supports 6 presets:

| Preset | Best for |
|--------|---------|
| Architecture | Microservices, cloud infra, agent pipelines |
| Flowchart | Decision trees, processes, user flows |
| UML Sequence | API call sequences, auth flows |
| ERD | Database schemas, table relationships |
| ML / Deep Learning | Neural network layers, training pipelines |
| UML Class | Object models, class hierarchies |

After generating, the agent self-checks for overlapping nodes and clipped labels before saving. If draw.io CLI is installed, it exports a PNG and uses the vision agent to verify the layout visually.

**Open generated diagrams:**
- draw.io desktop: File → Open → select the file
- Browser: [app.diagrams.net](https://app.diagrams.net) → Extras → Edit Diagram → paste the XML

---

## Uninstall

```bash
bacchetta uninstall
```

This will:
- Restore your original `opencode.json` from the backup taken at install time
- Remove all files that bacchetta created during install (plugin files, agent files, config files)
- Print commands to remove the npm packages from `~/.config/opencode/` if you want them fully gone

> **Important:** Only files bacchetta originally created are removed. However, if you modified an agent file that bacchetta created (e.g. you edited `commander.md`), your edits will be lost. Export any customized agent prompts before uninstalling if you want to keep them.

---

## Data locations

| What | Where |
|------|-------|
| Agent files | `~/.config/opencode/agents/` |
| Plugin files | `~/.config/opencode/plugin/` |
| Plugin packages | `~/.config/opencode/node_modules/` |
| OpenCode config | `~/.config/opencode/opencode.json` |
| opencode.json backup | `~/.config/opencode/opencode.json.bacchetta.bak` |
| Memory config | `~/.config/opencode/opencode-mem.jsonc` |
| Bacchetta settings | `~/.config/opencode/clause-settings.json` |
| Project list | `~/.config/opencode/clause-projects.json` |
| Install manifest | `~/.config/opencode/bacchetta-manifest.json` |
| SearXNG config | `~/.config/searxng/settings.yml` |
| Session database | `~/.local/share/opencode/opencode.db` |
| Memory database | `~/.local/share/opencode/clause-memory.db` |
| Code RAG index | `~/.local/share/opencode/clause-rag.db` |
| Memory files | `~/.local/share/opencode/clause-memory/` |
| Cloudflare docs | `~/.local/share/opencode/cf-docs/` |
| Generated diagrams | `~/diagrams/` |

---

## Works with

| Setup | Notes |
|-------|-------|
| **Ollama Cloud** | Recommended. $20/month subscription, no GPU needed. Sign up at [ollama.com](https://ollama.com) |
| **Local Ollama** | Free, runs on your machine. 16GB+ RAM/VRAM recommended for the full agent stack. Auto-compact won't work |
| **Any OpenCode provider** | Swap models any time in `~/.config/opencode/opencode.json` |

---

## Built on

| Project | What it provides |
|---------|-----------------|
| [opencode-ai/opencode](https://github.com/opencode-ai/opencode) | The AI coding engine Bacchetta runs on top of |
| [opencode-ai/opencode-mem](https://github.com/opencode-ai/opencode-mem) | Session memory capture, deduplication, and injection at port 4747 |
| [searxng/searxng](https://github.com/searxng/searxng) | Self-hosted meta-search engine for the researcher agent |
| [Ollama](https://ollama.com) | Local model runtime + Ollama Cloud API |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite for the RAG and memory databases |
| [React](https://github.com/facebook/react) | Dashboard UI |
| [Recharts](https://github.com/recharts/recharts) | Usage charts and graphs |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | Dashboard styling |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | 7-rung YAGNI decision ladder — embedded in commander, coder, quick, and reviewer agents |
| [shadcn/improve](https://github.com/shadcn/improve) | 9-category audit structure and self-contained plan file format used by the reviewer agent |
| [Agents365-ai/drawio-skill](https://github.com/Agents365-ai/drawio-skill) | Diagram agent approach: 6 presets, self-checking loop, code visualization, PNG export |
| [nvidia/skillspector](https://github.com/nvidia/skillspector) | Security scanning patterns informing the guardian agent's credential detection |

---

## License

MIT
