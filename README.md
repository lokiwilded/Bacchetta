# clause

Multi-agent AI coding dashboard for [OpenCode](https://opencode.ai). Adds a project launcher, agent manager, usage monitor, and persistent memory to your OpenCode setup.

Works with **Ollama Cloud** (pay-per-second), **local Ollama** (free, your GPU), or any provider OpenCode supports.

## What you get

- **Dashboard** at `localhost:6969` — add project folders, launch OpenCode sessions, monitor activity
- **9 specialised agents** — commander orchestrates, coder implements, researcher investigates, reviewer checks, and more
- **Persistent memory** via opencode-mem — remembers facts across sessions, injects context automatically
- **RAG** — semantic search over your codebase injected into context
- **Auto-compact** — summarises context before hitting the limit

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [OpenCode](https://opencode.ai) — `npm install -g opencode-ai`
- [Ollama](https://ollama.com) — for local embeddings (bge-m3): `ollama pull bge-m3`
- Ollama Cloud API key **or** local models pulled in Ollama

## Install

```bash
npm install -g clause-ai
clause install
```

The wizard will:
1. Check for OpenCode and Ollama
2. Ask whether you're using Ollama Cloud or local Ollama
3. Install all required OpenCode plugins
4. Set up your agents, config, and memory system

## Usage

```bash
opencode          # start OpenCode — clause dashboard runs at http://localhost:6969
```

Or start the dashboard separately:
```bash
clause start      # dashboard only, at http://localhost:6969
opencode          # run OpenCode as normal
```

## From the dashboard

1. **Add a project** — paste any folder path
2. **Launch** — starts an OpenCode session in that folder, opens the chat
3. **Agents** — view and change the model each agent uses
4. **Monitor** — watch live session activity
5. **Usage** — token and cost breakdown by agent and model

## Providers

**Ollama Cloud** (default):
- Set `OLLAMA_API_KEY` in your environment (get one at ollama.com/settings/keys)
- Models billed per second of inference — faster models cost less

**Local Ollama** (free):
- Runs entirely on your machine, no API key needed
- Works with any model you have pulled: `ollama pull qwen2.5-coder:32b`
- During `clause install`, enter your model name when prompted

**Other providers** (Anthropic, OpenAI, etc.):
- OpenCode supports these natively — configure them in `~/.config/opencode/opencode.json`
- Run `clause install` and choose local Ollama, then manually update agent model fields

## Memory

Memory is powered by [opencode-mem](https://github.com/ramtinj95/opencode-mem). It automatically captures facts from your sessions and injects them into new ones. View memories at `http://localhost:4747` when OpenCode is running.

Config: `~/.config/opencode/opencode-mem.jsonc`

## Agents

| Agent | Model | Role |
|-------|-------|------|
| commander | Gemini 3 Flash | Orchestrates — routes tasks to specialists |
| coder | Kimi K2.7 Code | Heavy implementation, multi-file features |
| researcher | Kimi K2.6 | Deep investigation, read-only |
| reviewer | MiniMax M2.7 | Code review, catches bugs |
| test-writer | Devstral Small 24B | Writes test suites |
| docs | GPT-OSS 20B | READMEs, docstrings, API docs |
| quick | DeepSeek V4 Flash | Lint fixes, small edits |
| memory-keeper | DeepSeek V4 Flash | Extracts facts before compression |
| vision | MiniMax M3 | Describes screenshots and images |

Edit any agent's model from the Agents page in the dashboard, or edit `~/.config/opencode/agents/<name>.md` directly.

## License

MIT
