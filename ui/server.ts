import { serve } from "bun"
import { join } from "path"
import { homedir } from "os"
import { existsSync } from "fs"

const OPENCODE_URL  = process.env.OPENCODE_URL || "http://localhost:4000"
const CONFIG_DIR    = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode")
const DATA_DIR      = process.env.OPENCODE_DATA_DIR   || join(homedir(), ".local", "share", "opencode")
const PORT          = parseInt(process.env.CLAUSE_UI_PORT || process.env.PORT || "6969")

const PUBLIC_DIR = join(import.meta.dir, "public")
const ctx = { dataDir: DATA_DIR, configDir: CONFIG_DIR, opencodeUrl: OPENCODE_URL }

// Routes that belong to clause-ui itself
const OUR_API = new Set(['/api/usage', '/api/monitor', '/api/agents', '/api/models', '/api/projects', '/api/rag/status', '/api/rag/index', '/api/settings', '/api/restart', '/api/sessions', '/api/current-project', '/api/memory', '/api/memory/search', '/api/memory/profile', '/api/opencode-mem'])
const OUR_STATIC = new Set(['/', '/dashboard', '/app'])

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const idx = part.indexOf('=')
    if (idx < 1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

serve({
  port: PORT,
  async fetch(req) {
    const url  = new URL(req.url)
    const p    = url.pathname

    // Resolve which opencode port to proxy to (cookie overrides default)
    const cookies = parseCookies(req)
    const cookiePort = parseInt(cookies['opencode_port'] || '')
    const projectPort = (cookiePort >= 4000 && cookiePort <= 4005) ? cookiePort : 4000
    const proxyUrl = projectPort !== 4000 ? `http://localhost:${projectPort}` : OPENCODE_URL

    if (req.method === "OPTIONS") return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }
    })

    // Our API routes
    if (OUR_API.has(p)) {
      if (p === '/api/current-project') return Response.json({ port: projectPort, isMain: projectPort === 4000 })
      if (p === '/api/usage')    return (await import('./routes/usage')).handler(req, ctx)
      if (p === '/api/monitor')  return (await import('./routes/monitor')).handler(req, ctx)
      if (p === '/api/agents')   return (await import('./routes/agents')).handler(req, ctx)
      if (p === '/api/models')   return (await import('./routes/models')).handler(req, ctx)
      if (p === '/api/projects') return (await import('./routes/projects')).handler(req, ctx)
      if (p === '/api/rag/status' || p === '/api/rag/index') return (await import('./routes/rag')).handler(req, ctx)
      if (p === '/api/settings') return (await import('./routes/settings')).handler(req)
      if (p === '/api/restart')  return (await import('./routes/restart')).handler(req, ctx)
      if (p === '/api/sessions') return (await import('./routes/sessions')).handler(req, ctx)
      if (p === '/api/memory' || p === '/api/memory/search' || p === '/api/memory/profile')
                                return (await import('./routes/memory')).handler(req)
      if (p === '/api/opencode-mem') return (await import('./routes/opencode-mem')).handler(req, ctx)
    }

    // Our static SPA — check for ?port= param to switch which opencode we proxy
    if (OUR_STATIC.has(p) || p === '') {
      const html = join(PUBLIC_DIR, 'dashboard.html')
      const portParam = url.searchParams.get('port')
      const spaHeaders: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      if (portParam && /^\d+$/.test(portParam)) {
        const np = parseInt(portParam)
        if (np >= 4000 && np <= 4005) {
          spaHeaders['Set-Cookie'] = `opencode_port=${np}; Path=/; SameSite=Lax; Max-Age=86400`
        }
      }
      return new Response(Bun.file(html), { headers: spaHeaders })
    }

    // Other static assets from public/
    const staticPath = join(PUBLIC_DIR, p)
    if (existsSync(staticPath) && !staticPath.endsWith('/')) {
      const file = Bun.file(staticPath)
      return new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream' }
      })
    }

    // Proxy everything else to the selected opencode instance
    try {
      const target = `${proxyUrl}${url.pathname}${url.search}`
      const headers = new Headers(req.headers)
      headers.delete('host')
      const proxied = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET','HEAD'].includes(req.method) ? undefined : req.body,
        signal: AbortSignal.timeout(10_000),
      })
      const resHeaders = new Headers(proxied.headers)
      resHeaders.delete('content-encoding')
      return new Response(proxied.body, { status: proxied.status, headers: resHeaders })
    } catch {
      return new Response('OpenCode not running. Start it with: opencode serve', {
        status: 502, headers: { 'Content-Type': 'text/plain' }
      })
    }
  },
})

const lan = getLAN()
console.log(`\n  Dashboard  →  http://localhost:${PORT}/`)
console.log(`  Chat       →  http://localhost:${PORT}/  (OpenCode UI proxied)`)
if (lan) console.log(`  Phone      →  http://${lan}:${PORT}`)
console.log()

function getLAN() {
  try {
    const { networkInterfaces } = require('os')
    for (const ifaces of Object.values(networkInterfaces() as any) as any[])
      for (const iface of ifaces || [])
        if (iface.family === 'IPv4' && !iface.internal) return iface.address
  } catch {}
  return null
}
