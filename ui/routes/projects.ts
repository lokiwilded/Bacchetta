import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"
import { spawn } from "bun"
import { execSync } from "child_process"

const PROJECTS_PATH = join(homedir(), ".config", "opencode", "clause-projects.json")

const PORT_CANDIDATES = [4001, 4002, 4003, 4004]
const INIT_PORT = 4005
let _mainPort: number | null = null

const procs = new Map<number, any>()

function norm(p: string) { return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }

function read() {
  try { if (existsSync(PROJECTS_PATH)) return JSON.parse(readFileSync(PROJECTS_PATH, "utf-8")) } catch {}
  return { projects: [] }
}

function write(data: any) {
  mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true })
  writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2))
}

async function probeOpenCode(port: number) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(800) })
    if (!r.ok) return null
    const h = await r.json() as any
    if (!h?.healthy) return null
    try {
      const p = await fetch(`http://127.0.0.1:${port}/project/current`, { signal: AbortSignal.timeout(2500) })
      return { port, version: h.version, project: p.ok ? await p.json() : null }
    } catch { return { port, version: h.version, project: null } }
  } catch { return null }
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const h = await r.json() as any
    return h?.healthy === true
  } catch { return false }
}

async function isPortOccupied(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = require('net').createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => { server.close(); resolve(false) })
    server.listen(port, '127.0.0.1')
  })
}

async function waitHealthy(port: number, maxMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await isHealthy(port)) return true
    await Bun.sleep(800)
  }
  return false
}

async function killPortProcess(port: number): Promise<void> {
  if (procs.has(port)) {
    try { procs.get(port).kill() } catch {}
    procs.delete(port)
  }
  try {
    const out = execSync(`netstat -ano -p TCP`, { encoding: 'utf8', timeout: 3000 })
    for (const line of out.split('\n')) {
      if (line.includes(`:${port} `) && line.includes('LISTENING')) {
        const pid = line.trim().split(/\s+/).pop()
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          try { execSync(`taskkill /F /T /PID ${pid}`, { encoding: 'utf8', timeout: 3000 }) } catch {}
        }
      }
    }
  } catch {}
  await Bun.sleep(600)
}

function spawnOpenCode(cwd: string, port: number) {
  const proc = spawn({
    cmd: ['opencode', 'serve', '--hostname', '0.0.0.0', '--port', String(port)],
    cwd,
    stdout: 'ignore',
    stderr: 'inherit',
    env: { ...process.env },
  })
  procs.set(port, proc)
  proc.exited.then(() => procs.delete(port)).catch(() => procs.delete(port))
  return proc
}

async function ensureGitRepo(cwd: string) {
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', timeout: 3000 }).trim()
    if (norm(root) !== norm(cwd)) execSync('git init', { cwd, stdio: 'ignore', timeout: 5000 })
  } catch { try { execSync('git init', { cwd, stdio: 'ignore', timeout: 5000 }) } catch {} }
}

async function findProjectByDir(port: number, dir: string) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/project`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const projects = await res.json() as any[]
    const permanent = projects.find(p => p.id !== 'global' && norm(p.worktree) === norm(dir))
    if (permanent) return permanent
    return projects.find(p => norm(p.worktree) === norm(dir)) || null
  } catch { return null }
}

async function createSession(port: number, projectID: string | null) {
  try {
    const body = projectID ? { projectID } : {}
    const res = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return await res.json() as any
  } catch {}
  return null
}

async function resolveMainPort(): Promise<number | null> {
  if (_mainPort && await isHealthy(_mainPort)) return _mainPort
  for (const p of PORT_CANDIDATES) {
    if (await isHealthy(p)) { _mainPort = p; return p }
  }
  for (const p of PORT_CANDIDATES) {
    if (!await isPortOccupied(p)) { _mainPort = p; return p }
    await killPortProcess(p)
    if (!await isPortOccupied(p)) { _mainPort = p; return p }
  }
  return null
}

async function launchProject(directory: string): Promise<{ port: number; sessionId?: string; error?: string }> {
  const dir = norm(directory)
  const cwd = directory.replace(/\//g, '\\')

  await ensureGitRepo(cwd)

  // ── Step 1: Ensure one opencode is running on a free port ────────────────
  const MAIN_PORT = await resolveMainPort()
  if (MAIN_PORT === null) {
    return { port: 4001, error: 'All ports 4001-4004 are stuck with orphaned sockets. Restart your PC to free them.' }
  }

  if (!await isHealthy(MAIN_PORT)) {
    spawnOpenCode(cwd, MAIN_PORT)
    if (!await waitHealthy(MAIN_PORT, 90_000)) {
      await killPortProcess(MAIN_PORT)
      _mainPort = null
      return { port: MAIN_PORT, error: 'OpenCode did not start within 90s. Check terminal for errors.' }
    }
  }

  // ── Step 2: Find this directory in opencode's project list ───────────────
  let project = await findProjectByDir(MAIN_PORT, dir)
  let sessionId: string | undefined

  if (project) {
    const ses = await createSession(MAIN_PORT, project.id !== 'global' ? project.id : null)
    sessionId = ses?.id
  } else {
    // New project — start temp opencode to register it and create the first session
    if (await isPortOccupied(INIT_PORT)) await killPortProcess(INIT_PORT)
    if (!await isPortOccupied(INIT_PORT)) {
      spawnOpenCode(cwd, INIT_PORT)
      if (await waitHealthy(INIT_PORT, 60_000)) {
        const ses = await createSession(INIT_PORT, null)
        sessionId = ses?.id
      }
      await killPortProcess(INIT_PORT)
    }
  }

  return { port: MAIN_PORT, sessionId }
}

export async function handler(req: Request, _ctx: any) {
  if (req.method === "GET") {
    const data = read()
    const portsToProbe = [...new Set([4000, ...PORT_CANDIDATES])]
    const running = (await Promise.all(portsToProbe.map(probeOpenCode))).filter(Boolean) as any[]

    const projects = (data.projects || []).map((p: any) => {
      const match = running.find(r => {
        const wt  = r.project?.worktree?.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        const dir = p.directory?.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        return wt && dir && wt === dir
      })
      if (!match) {
        const mainUp = running.find((r: any) => PORT_CANDIDATES.includes(r.port))
        return { ...p, running: false, runningPort: mainUp ? MAIN_PORT : null, version: mainUp?.version || null }
      }
      return { ...p, running: true, runningPort: match.port, version: match.version }
    })

    return Response.json({ projects, running }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (req.method === "POST") {
    let body: any = {}
    try { body = await req.json() } catch {}

    if (body.action === "add") {
      const dir = (body.directory || "").trim().replace(/\\/g, "/").replace(/\/+$/, "")
      if (!dir) return Response.json({ error: "directory required" }, { status: 400 })
      const winDir = dir.replace(/\//g, '\\')
      if (!existsSync(winDir)) return Response.json({ error: `Directory not found: ${winDir}` }, { status: 400 })
      const data = read()
      if (data.projects.find((p: any) => p.directory === dir)) return Response.json({ error: "already added" }, { status: 409 })
      data.projects.push({ id: Date.now().toString(), name: body.name || basename(dir) || dir, directory: dir, addedAt: Date.now() })
      write(data)
      return Response.json({ ok: true })
    }

    if (body.action === "launch") {
      const data = read()
      const project = data.projects.find((p: any) => p.id === body.id)
      if (!project) return Response.json({ error: "project not found" }, { status: 404 })
      const winDir = project.directory.replace(/\//g, '\\')
      if (!existsSync(winDir)) return Response.json({ error: `Directory not found: ${winDir}` }, { status: 400 })
      const result = await launchProject(project.directory)
      if (result.error) return Response.json({ error: result.error }, { status: 500 })
      if (result.sessionId) {
        const fresh = read()
        const idx = fresh.projects.findIndex((p: any) => p.id === body.id)
        if (idx >= 0) { fresh.projects[idx].sessionId = result.sessionId; write(fresh) }
      }
      return Response.json({ ok: true, port: result.port, sessionId: result.sessionId })
    }

    if (body.action === "remove") {
      const data = read()
      data.projects = data.projects.filter((p: any) => p.id !== body.id)
      write(data)
      return Response.json({ ok: true })
    }

    if (body.action === "stop") {
      const port = body.port as number
      if (!port) return Response.json({ error: "port required" }, { status: 400 })
      await killPortProcess(port)
      return Response.json({ ok: true })
    }

    return Response.json({ error: "unknown action" }, { status: 400 })
  }

  return Response.json({ error: "method not allowed" }, { status: 405 })
}
