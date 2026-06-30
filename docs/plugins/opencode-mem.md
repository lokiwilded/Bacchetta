# opencode-mem

**Type:** npm OpenCode plugin  
**Package:** `opencode-mem`  
**Installed at:** `~/.config/opencode/node_modules/opencode-mem/`  
**Config:** `~/.config/opencode/opencode-mem.jsonc`  
**Web UI:** `http://localhost:4747`  
**GitHub:** https://github.com/tickernelz/opencode-mem

## What it does

Persistent local vector memory for OpenCode. Auto-captures insights from every conversation using an LLM, stores them as embeddings in a SQLite+USearch database, and injects the most relevant memories into the start of new conversations. Also builds a user profile from patterns observed across sessions.

## How it works

1. **Auto-capture:** After each conversation turn, extracts key information using the configured LLM and saves it as a memory chunk
2. **Embedding:** Uses `Xenova/nomic-embed-text-v1` (ONNX, runs in-process) to embed each chunk
3. **Deduplication:** Chunks with cosine similarity >0.90 are deduplicated
4. **Context injection:** On the first turn of a new session, injects the top-K most relevant memories from previous sessions
5. **Profile learning:** Every 10 prompts, analyzes patterns and updates a user preference profile

## Config (`opencode-mem.jsonc`)

| Key | Our setting | Description |
|-----|-------------|-------------|
| `memoryProvider` | `openai-chat` | LLM provider type |
| `memoryApiUrl` | `https://ollama.com/v1` | Ollama Cloud endpoint |
| `memoryApiKey` | `env://OLLAMA_API_KEY` | API key from env |
| `memoryModel` | `deepseek-v4-flash` | Fast model for extraction |
| `webServerPort` | `4747` | Web UI port |
| `autoCaptureEnabled` | `true` | Background capture |
| `chatMessage.maxMemories` | `3` | Memories injected per session |
| `chatMessage.injectOn` | `first` | Only inject on first turn |
| `memory.defaultScope` | `project` | Scope memories per project |

## Dashboard integration

The Memory panel in the Agents tab shows:
- Running status (green pulse when active)
- "Open UI →" button linking to the web UI at port 4747
- The web UI has full memory browsing, search, and management

## Web UI features (port 4747)

- Browse all stored memories by project
- Search memories semantically
- View and edit user profile
- Delete or archive memories
- Stats and activity history

## Notes

- Memories are stored at `~/.opencode-mem/data/` (USearch vector shards + SQLite index)
- The plugin loads when OpenCode starts; the web UI spins up on the same process
- This runs alongside clause's own memory extraction system (`clause-memory.db`) — they are complementary:
  - **opencode-mem**: auto-capture during conversation, lightweight per-turn extraction
  - **clause memory**: deeper extraction at session end, bge-m3 embeddings, integrated into the clause dashboard
