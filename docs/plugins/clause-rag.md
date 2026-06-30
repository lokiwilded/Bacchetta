# clause-rag

**Type:** Local OpenCode plugin  
**Location:** `~/.config/opencode/plugin/clause-rag.ts`  
**Runtime:** Bun (loaded by OpenCode at startup)

## What it does

Indexes any project directory into a local SQLite vector store (`clause-rag.db`) using Ollama bge-m3 embeddings. Agents use `search_code` instead of grep/glob to find relevant code by semantic meaning.

## Tools exposed

| Tool | Signature | Description |
|------|-----------|-------------|
| `search_code` | `(query, directory, top_k?)` | Semantic search over indexed codebase. Returns file:line chunks ranked by relevance. |
| `index_workspace` | `(directory, force?)` | Index a project dir. Skips if already indexed; `force: true` re-indexes. |
| `rag_status` | `()` | List all indexed workspaces with chunk counts and age. |

## Settings (in `clause-settings.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `rag_chunk_lines` | 40 | Lines per code chunk |
| `rag_top_k` | 5 | Results returned per search |
| `rag_max_file_kb` | 100 | Skip files larger than this |

## Data

- Database: `~/.local/share/opencode/clause-rag.db`
- Embedding model: `bge-m3` via Ollama at `http://127.0.0.1:11434`

## Notes

- Agents should call `index_workspace` at the start of any new project session
- `search_code` should be the first step before reading specific files
- Dashboard streams indexing progress via `/api/rag/index` (SSE)
- Dashboard checks status via `/api/rag/status`
