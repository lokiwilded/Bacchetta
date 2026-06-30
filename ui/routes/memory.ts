import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createHash } from "crypto"
import { Database } from "bun:sqlite"

const MEMORY_DIR = join(homedir(), '.local', 'share', 'opencode', 'clause-memory')
const MEMORY_DB  = join(homedir(), '.local', 'share', 'opencode', 'clause-memory.db')

function getTopK(): number {
  try {
    const p = join(homedir(), '.config', 'opencode', 'clause-settings.json')
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).memory_top_k || 3
  } catch {}
  return 3
}

function memPath(dir: string) {
  return join(MEMORY_DIR, createHash('sha1').update(dir).digest('hex').slice(0, 16) + '.md')
}

export async function handler(req: Request) {
  mkdirSync(MEMORY_DIR, { recursive: true })
  const url = new URL(req.url)
  const p   = url.pathname

  // GET /api/memory/search?q=...
  if (req.method === 'GET' && p === '/api/memory/search') {
    const q   = url.searchParams.get('q') || ''
    const dir = url.searchParams.get('dir') || ''
    if (!q) return Response.json({ error: 'q required' }, { status: 400 })
    try {
      const db = new Database(MEMORY_DB, { readonly: true })
      const rows: any[] = dir
        ? db.prepare('SELECT id, dir, section, content FROM chunks WHERE dir = ? LIMIT 20').all(dir)
        : db.prepare('SELECT id, dir, section, content FROM chunks LIMIT 20').all()
      db.close()
      // Simple text filter fallback (no embeddings in dev server)
      const ql = q.toLowerCase()
      const chunks = rows
        .filter((r: any) => r.section.toLowerCase().includes(ql) || r.content.toLowerCase().includes(ql))
        .slice(0, getTopK())
        .map((r: any) => ({ ...r, similarity: 1 }))
      return Response.json({ chunks }, { headers: { 'Cache-Control': 'no-store' } })
    } catch { return Response.json({ chunks: [] }, { headers: { 'Cache-Control': 'no-store' } }) }
  }

  // GET /api/memory/profile
  if (req.method === 'GET' && p === '/api/memory/profile') {
    try {
      const db = new Database(MEMORY_DB, { readonly: true })
      const profile: any[] = db.prepare('SELECT key, value, confidence, count, last_seen FROM profile ORDER BY confidence DESC, count DESC').all()
      db.close()
      return Response.json({ profile }, { headers: { 'Cache-Control': 'no-store' } })
    } catch { return Response.json({ profile: [] }, { headers: { 'Cache-Control': 'no-store' } }) }
  }

  if (req.method === 'GET') {
    const dir = url.searchParams.get('dir')
    if (dir) {
      const filePath = memPath(dir)
      if (!existsSync(filePath)) return Response.json({ dir, content: '', exists: false }, { headers: { 'Cache-Control': 'no-store' } })
      return Response.json({ dir, content: readFileSync(filePath, 'utf8'), exists: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'))
    const list = files.map(f => {
      const content = readFileSync(join(MEMORY_DIR, f), 'utf8')
      const dirMatch = content.match(/^# Project Memory — (.+)$/m)
      const timeMatch = content.match(/_Last extracted: (.+?)_/)
      return { file: f, dir: dirMatch?.[1] || '?', lastExtracted: timeMatch?.[1] || null, content }
    })
    return Response.json(list, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json() as any
      const { dir, content } = body
      if (!dir) return Response.json({ error: 'dir required' }, { status: 400 })
      writeFileSync(memPath(dir), content || '', 'utf8')
      return Response.json({ ok: true })
    } catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
  }

  if (req.method === 'DELETE') {
    const dir = url.searchParams.get('dir')
    if (!dir) return Response.json({ error: 'dir required' }, { status: 400 })
    try { unlinkSync(memPath(dir)) } catch {}
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 })
}

export { memPath, MEMORY_DIR }
