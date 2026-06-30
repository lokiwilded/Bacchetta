import { tool } from "@opencode-ai/plugin"
import type { Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { readdir, readFile, stat } from "fs/promises"
import { join, extname, relative, resolve } from "path"
import { homedir } from "os"
import { mkdirSync, existsSync, readFileSync } from "fs"

const OLLAMA_URL   = process.env.OLLAMA_URL         || "http://localhost:11434"
const EMBED_MODEL  = process.env.CLAUSE_EMBED_MODEL || "bge-m3"
const DB_PATH      = join(homedir(), ".local", "share", "opencode", "clause-rag.db")

const SETTINGS_PATH = join(homedir(), ".config", "opencode", "clause-settings.json")
function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"))
  } catch {}
  return {}
}
const _S = loadSettings()

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".rb", ".php", ".swift", ".kt",
  ".vue", ".svelte", ".astro",
  ".md", ".mdx",
  ".json", ".yaml", ".yml", ".toml",
  ".sh", ".bash", ".zsh",
  ".css", ".scss", ".html", ".sql",
])

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".cache", "coverage", "__pycache__", ".venv", "venv",
  ".idea", ".vscode", "vendor", "target", "out",
])

const CHUNK_LINES    = _S.rag_chunk_lines   ?? 50
const CHUNK_OVERLAP  = Math.floor(CHUNK_LINES / 5)
const MAX_FILE_BYTES = (_S.rag_max_file_kb  ?? 100) * 1024

function initDB() {
  mkdirSync(join(homedir(), ".local", "share", "opencode"), { recursive: true })
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      content TEXT NOT NULL,
      embedding BLOB,
      file_mtime INTEGER,
      indexed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ws ON chunks(workspace);
    CREATE TABLE IF NOT EXISTS workspaces (
      path TEXT PRIMARY KEY,
      indexed_at INTEGER,
      chunk_count INTEGER
    );
  `)
  return db
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8)
}

async function embed(text: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const { embedding } = await res.json() as { embedding: number[] }
    return new Float32Array(embedding)
  } catch { return null }
}

function vecToBlob(v: Float32Array): Buffer { return Buffer.from(v.buffer) }
function blobToVec(b: Buffer | Uint8Array): Float32Array {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b)
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

function chunkContent(content: string, filePath: string) {
  const lines = content.split("\n")
  const out: { text: string; startLine: number; endLine: number }[] = []
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const s = i, e = Math.min(i + CHUNK_LINES, lines.length)
    out.push({ text: `// ${filePath} lines ${s+1}-${e}\n` + lines.slice(s, e).join("\n"), startLine: s+1, endLine: e })
    if (e >= lines.length) break
  }
  return out
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(d: string) {
    let entries: Awaited<ReturnType<typeof readdir>>
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(join(d, e.name))
      } else if (e.isFile() && CODE_EXTS.has(extname(e.name).toLowerCase())) {
        files.push(join(d, e.name))
      }
    }
  }
  await walk(dir)
  return files
}

export const server: Plugin = async () => {
  return {
    tool: {
      index_workspace: tool({
        description:
          "Index a project directory for semantic code search using local bge-m3 embeddings via Ollama. " +
          "Run once at the start of a session in a new project. Skips if already indexed recently. " +
          "Requires Ollama running locally with bge-m3 pulled.",
        args: {
          directory: tool.schema.string().describe("Absolute path to the project root to index"),
          force:     tool.schema.boolean().default(false).describe("Re-index even if already indexed"),
        },
        async execute({ directory, force }) {
          const dir = resolve(directory)
          try { await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }) }
          catch { return `Ollama not reachable at ${OLLAMA_URL}. Run: ollama serve` }

          const testVec = await embed("hello")
          if (!testVec) return `Model '${EMBED_MODEL}' not available. Run: ollama pull ${EMBED_MODEL}`

          const db = initDB()
          if (!force) {
            const ws = db.query("SELECT chunk_count, indexed_at FROM workspaces WHERE path = ?").get(dir) as any
            if (ws) {
              const ageMins = Math.round((Date.now() - ws.indexed_at) / 60000)
              db.close()
              return { title: "index_workspace", output: `Already indexed: ${ws.chunk_count} chunks, ${ageMins}m ago. Pass force:true to re-index.`, metadata: { status: "already_indexed", chunks: ws.chunk_count, age_minutes: ageMins } }
            }
          }

          db.run("DELETE FROM chunks WHERE workspace = ?", [dir])
          const files = await walkDir(dir)
          let indexed = 0, skipped = 0, totalChunks = 0
          const ins = db.prepare(
            "INSERT INTO chunks (workspace,file_path,start_line,end_line,content,embedding,file_mtime,indexed_at) VALUES (?,?,?,?,?,?,?,?)"
          )
          for (const file of files) {
            try {
              const info = await stat(file)
              if (info.size > MAX_FILE_BYTES) { skipped++; continue }
              const content = await readFile(file, "utf8")
              const relPath = relative(dir, file)
              for (const chunk of chunkContent(content, relPath)) {
                const vec = await embed(chunk.text)
                if (!vec) continue
                ins.run(dir, relPath, chunk.startLine, chunk.endLine, chunk.text, vecToBlob(vec), info.mtimeMs, Date.now())
                totalChunks++
              }
              indexed++
            } catch { skipped++ }
          }
          db.run("INSERT OR REPLACE INTO workspaces (path,indexed_at,chunk_count) VALUES (?,?,?)", [dir, Date.now(), totalChunks])
          db.close()
          return { title: "index_workspace ✓", output: `Indexed ${indexed} files → ${totalChunks} chunks (${skipped} skipped)`, metadata: { status: "done", files_indexed: indexed, chunks: totalChunks } }
        },
      }),

      search_code: tool({
        description:
          "Semantic search over an indexed codebase. Returns the most relevant code chunks for a natural-language query. " +
          "USE THIS instead of grep/glob/read when exploring — massively reduces context usage. " +
          "Call index_workspace first if not yet indexed.",
        args: {
          query:     tool.schema.string().describe("Natural language: 'token expiry logic', 'how auth validates requests'"),
          directory: tool.schema.string().describe("Absolute path to the indexed project directory"),
          top_k:     tool.schema.number().default(_S.rag_top_k ?? 3).describe("Number of results (default 3, max 8)"),
        },
        async execute({ query, directory, top_k }) {
          const dir = resolve(directory)
          const db  = initDB()
          const ws  = db.query("SELECT chunk_count FROM workspaces WHERE path = ?").get(dir) as any
          if (!ws) { db.close(); return `Not indexed. Run index_workspace with directory:"${dir}" first.` }

          const qv = await embed(query)
          if (!qv) { db.close(); return "Embedding failed — is Ollama running?" }

          const rows = db.query(
            "SELECT file_path, start_line, end_line, content, embedding FROM chunks WHERE workspace = ?"
          ).all(dir) as any[]
          db.close()

          const scored = rows.map(r => ({
            file: r.file_path as string,
            lines: `${r.start_line}-${r.end_line}`,
            score: cosine(qv, blobToVec(r.embedding as Buffer)),
            content: (r.content as string).substring(0, 300),
          })).sort((a, b) => b.score - a.score).slice(0, Math.min(top_k, 8))

          const out = scored.map((r, i) =>
            `[${i+1}] ${r.file}:${r.lines} (score: ${r.score.toFixed(3)})\n${r.content}`
          ).join("\n\n---\n\n")

          return { title: `search_code: "${query}"`, output: out || "No results found.", metadata: { total_chunks: rows.length, results: scored.length } }
        },
      }),

      rag_status: tool({
        description: "Check which workspaces are indexed for RAG search.",
        args: {},
        async execute() {
          const db   = initDB()
          const rows = db.query("SELECT path, indexed_at, chunk_count FROM workspaces ORDER BY indexed_at DESC").all() as any[]
          db.close()
          if (!rows.length) return `No workspaces indexed yet.\n\nModel: ${EMBED_MODEL} @ ${OLLAMA_URL}`
          const list = rows.map(r =>
            `  ${r.path}\n    ${r.chunk_count} chunks — indexed ${Math.round((Date.now() - r.indexed_at) / 60000)}m ago`
          ).join("\n")
          return `Indexed workspaces (${rows.length}):\n${list}\n\nModel: ${EMBED_MODEL} @ ${OLLAMA_URL}`
        },
      }),
    },
  }
}
