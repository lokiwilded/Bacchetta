import { Database } from "bun:sqlite"
import { readdir, readFile, stat } from "fs/promises"
import { join, extname, relative, resolve } from "path"
import { homedir } from "os"
import { mkdirSync, existsSync } from "fs"

const OLLAMA_URL  = process.env.OLLAMA_URL         || "http://localhost:11434"
const EMBED_MODEL = process.env.CLAUSE_EMBED_MODEL || "bge-m3"
const DB_PATH     = join(homedir(), ".local", "share", "opencode", "clause-rag.db")

const CODE_EXTS = new Set([
  ".ts",".tsx",".js",".jsx",".mjs",".cjs",
  ".py",".go",".rs",".java",".c",".cpp",".h",".hpp",
  ".cs",".rb",".php",".swift",".kt",
  ".vue",".svelte",".astro",
  ".md",".mdx",".json",".yaml",".yml",".toml",
  ".sh",".bash",".zsh",".css",".scss",".html",".sql",
])

const IGNORE_DIRS = new Set([
  "node_modules",".git","dist","build",".next",".nuxt",
  ".cache","coverage","__pycache__",".venv","venv",
  ".idea",".vscode","vendor","target","out",
])

function initDB() {
  mkdirSync(join(homedir(), ".local", "share", "opencode"), { recursive: true })
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER, end_line INTEGER,
      content TEXT NOT NULL, embedding BLOB,
      file_mtime INTEGER, indexed_at INTEGER
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

function chunkContent(content: string, filePath: string) {
  const lines = content.split("\n")
  const chunks: { text: string; startLine: number; endLine: number }[] = []
  const CHUNK = 80, OVERLAP = 15
  for (let i = 0; i < lines.length; i += CHUNK - OVERLAP) {
    const s = i, e = Math.min(i + CHUNK, lines.length)
    chunks.push({ text: `// ${filePath} lines ${s+1}-${e}\n` + lines.slice(s, e).join("\n"), startLine: s+1, endLine: e })
    if (e >= lines.length) break
  }
  return chunks
}

export async function handler(req: Request, _ctx: any): Promise<Response> {
  const url = new URL(req.url)
  const path_ = url.pathname

  // GET /api/rag/status?dir=...
  if (req.method === "GET" && path_ === "/api/rag/status") {
    const dir = url.searchParams.get("dir")
    try {
      const db  = initDB()
      const ws  = dir
        ? db.query("SELECT indexed_at, chunk_count FROM workspaces WHERE path = ?").get(resolve(dir)) as any
        : null
      const all = db.query("SELECT path, indexed_at, chunk_count FROM workspaces ORDER BY indexed_at DESC").all() as any[]
      db.close()
      return Response.json({
        workspace: ws ? { indexed: true, chunks: ws.chunk_count, age_minutes: Math.round((Date.now() - ws.indexed_at) / 60000) } : { indexed: false },
        all: all.map(r => ({ path: r.path, chunks: r.chunk_count, age_minutes: Math.round((Date.now() - r.indexed_at) / 60000) })),
      })
    } catch { return Response.json({ workspace: { indexed: false }, all: [] }) }
  }

  // POST /api/rag/index — SSE stream of progress events
  if (req.method === "POST" && path_ === "/api/rag/index") {
    let body: any = {}
    try { body = await req.json() } catch {}
    const dir = body.directory
    if (!dir) return Response.json({ error: "directory required" }, { status: 400 })

    const absDir = resolve(dir.replace(/\//g, "\\"))
    if (!existsSync(absDir)) return Response.json({ error: `Directory not found: ${absDir}` }, { status: 400 })

    const encoder = new TextEncoder()
    function sse(event: string, data: object) {
      return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: object) => {
          try { controller.enqueue(sse(event, data)) } catch {}
        }

        try {
          // Check Ollama
          send("status", { phase: "checking", message: "Checking Ollama…" })
          try {
            await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
          } catch {
            send("error", { message: `Ollama not reachable at ${OLLAMA_URL}` })
            controller.close()
            return
          }

          // Test embedding
          send("status", { phase: "checking", message: `Testing ${EMBED_MODEL} model…` })
          const test = await embed("hello")
          if (!test) {
            send("error", { message: `Model ${EMBED_MODEL} not available. Run: ollama pull ${EMBED_MODEL}` })
            controller.close()
            return
          }

          const db = initDB()

          // Check if already indexed (and not forced)
          if (!body.force) {
            const ws = db.query("SELECT chunk_count, indexed_at FROM workspaces WHERE path = ?").get(absDir) as any
            if (ws) {
              const age = Math.round((Date.now() - ws.indexed_at) / 60000)
              db.close()
              send("done", { message: `Already indexed — ${ws.chunk_count} chunks, ${age}m ago`, chunks: ws.chunk_count, files: 0, already: true })
              controller.close()
              return
            }
          }

          // Walk directory
          send("status", { phase: "walking", message: "Scanning files…" })
          const files = await walkDir(absDir)
          send("status", { phase: "walking", message: `Found ${files.length} files to index` })

          db.run("DELETE FROM chunks WHERE workspace = ?", [absDir])
          const ins = db.prepare(
            "INSERT INTO chunks (workspace,file_path,start_line,end_line,content,embedding,file_mtime,indexed_at) VALUES (?,?,?,?,?,?,?,?)"
          )

          let indexed = 0, skipped = 0, totalChunks = 0
          const MAX_BYTES = 200 * 1024

          for (let fi = 0; fi < files.length; fi++) {
            const file = files[fi]
            try {
              const info = await stat(file)
              if (info.size > MAX_BYTES) { skipped++; continue }
              const content = await readFile(file, "utf8")
              const relPath = relative(absDir, file)
              const chunks  = chunkContent(content, relPath)
              for (const chunk of chunks) {
                const vec = await embed(chunk.text)
                if (!vec) continue
                ins.run(absDir, relPath, chunk.startLine, chunk.endLine, chunk.text, vecToBlob(vec), info.mtimeMs, Date.now())
                totalChunks++
              }
              indexed++
              // Progress update every 5 files
              if (fi % 5 === 0 || fi === files.length - 1) {
                send("progress", {
                  phase: "indexing",
                  file: relPath ?? relative(absDir, file),
                  indexed,
                  total: files.length,
                  chunks: totalChunks,
                  pct: Math.round((fi + 1) / files.length * 100),
                })
              }
            } catch { skipped++ }
          }

          db.run("INSERT OR REPLACE INTO workspaces (path,indexed_at,chunk_count) VALUES (?,?,?)", [absDir, Date.now(), totalChunks])
          db.close()

          send("done", { message: `Indexed ${indexed} files → ${totalChunks} chunks`, files: indexed, chunks: totalChunks, skipped })
        } catch (e: any) {
          try { controller.enqueue(sse("error", { message: String(e) })) } catch {}
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  return Response.json({ error: "not found" }, { status: 404 })
}
