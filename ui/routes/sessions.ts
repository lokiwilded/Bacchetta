import { Database } from "bun:sqlite"
import { existsSync } from "fs"
import { join } from "path"

const PORTS = [4000, 4001, 4002, 4003, 4004, 4005]

export async function handler(req: Request, ctx: any) {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const port = parseInt(url.searchParams.get('port') || '')
    const dir  = url.searchParams.get('dir') || ''
    if (!port) return Response.json({ error: 'port required' }, { status: 400 })

    // Query DB directly by worktree — works even when OpenCode is stopped
    if (dir && ctx.dataDir) {
      try {
        const dbPath = join(ctx.dataDir, 'opencode.db')
        if (existsSync(dbPath)) {
          const db = new Database(dbPath, { readonly: true })
          const dirAlt = dir.includes('\\') ? dir.replace(/\\/g, '/') : dir.replace(/\//g, '\\')
          const rows = db.query<{ id: string; title: string; created: number; updated: number }, [string, string]>(`
            SELECT s.id, s.title,
              CAST(s.time_created AS INTEGER) as created,
              CAST(s.time_updated AS INTEGER) as updated
            FROM session s
            JOIN project pr ON pr.id = s.project_id
            WHERE (pr.worktree = ? OR pr.worktree = ?)
              AND s.parent_id IS NULL
            ORDER BY s.time_updated DESC
            LIMIT 50
          `).all(dir, dirAlt)
          db.close()
          const sessions = rows.map(r => ({
            id: r.id,
            title: r.title || 'Untitled',
            directory: dir,
            time: { created: r.created, updated: r.updated },
          }))
          return Response.json({ sessions, directory: dir }, { headers: { 'Cache-Control': 'no-store' } })
        }
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 })
      }
    }

    // Fallback: ask OpenCode directly
    try {
      const projRes = await fetch(`http://127.0.0.1:${port}/project/current`, { signal: AbortSignal.timeout(3000) })
      if (!projRes.ok) return Response.json({ error: 'opencode not responding' }, { status: 502 })
      const proj = await projRes.json() as { id: string; worktree: string }
      const sesRes = await fetch(`http://127.0.0.1:${port}/session`, { signal: AbortSignal.timeout(3000) })
      if (!sesRes.ok) return Response.json({ error: 'could not fetch sessions' }, { status: 502 })
      const all = await sesRes.json() as any[]
      const sessions = (Array.isArray(all) ? all : [])
        .filter((s: any) => s.projectID === proj.id)
        .sort((a: any, b: any) => b.time.updated - a.time.updated)
      return Response.json({ sessions, directory: proj.worktree }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502 })
    }
  }

  if (req.method === 'POST') {
    let body: any = {}
    try { body = await req.json() } catch {}

    if (body.action === 'abort') {
      const { sessionId, port } = body
      if (!sessionId) return Response.json({ error: 'sessionId required' }, { status: 400 })
      const tryPorts = port ? [port, ...PORTS.filter(p => p !== port)] : PORTS
      for (const p of tryPorts) {
        try {
          const r = await fetch(`http://127.0.0.1:${p}/session/${sessionId}/abort`, {
            method: 'POST',
            signal: AbortSignal.timeout(3000),
          })
          if (r.status !== 404) {
            return Response.json({ ok: r.ok, port: p }, { status: r.ok ? 200 : r.status })
          }
        } catch {}
      }
      return Response.json({ error: 'session not found on any running opencode instance' }, { status: 404 })
    }
    return Response.json({ error: 'unknown action' }, { status: 400 })
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 })
}
