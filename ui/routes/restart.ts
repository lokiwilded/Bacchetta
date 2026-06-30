import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { spawn } from "bun"
import { execSync } from "child_process"

const isWin = process.platform === 'win32'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function worktreeFromProjects(port: number): string | null {
  try {
    const p = join(homedir(), '.config', 'opencode', 'clause-projects.json')
    if (!existsSync(p)) return null
    const data = JSON.parse(readFileSync(p, 'utf8'))
    const proj = (data.projects || []).find((pr: any) => pr.runningPort === port)
    return proj?.directory || null
  } catch { return null }
}

async function killPort(port: number) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', timeout: 3000 })
      for (const line of out.split('\n')) {
        if (line.includes(`:${port} `) && line.includes('LISTENING')) {
          const pid = line.trim().split(/\s+/).pop()
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            try { execSync(`taskkill /F /T /PID ${pid}`, { timeout: 3000 }) } catch {}
          }
        }
      }
    } else {
      try { execSync(`fuser -k ${port}/tcp`, { timeout: 3000 }) } catch {
        try {
          const pid = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 3000 }).trim()
          if (pid) execSync(`kill -9 ${pid}`, { timeout: 3000 })
        } catch {}
      }
    }
  } catch {}
  await sleep(800)
}

async function waitHealthy(port: number, maxMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/global/health`, { signal: AbortSignal.timeout(600) })
      if (r.ok) return true
    } catch {}
    await sleep(500)
  }
  return false
}

export async function handler(req: Request, ctx: { opencodeUrl: string }) {
  if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 })

  try {
    const ocUrl = new URL(ctx.opencodeUrl)
    const port  = parseInt(ocUrl.port) || 4000

    let worktree: string | null = null
    try {
      const info = await fetch(`${ctx.opencodeUrl}/project/current`, { signal: AbortSignal.timeout(2000) })
      if (info.ok) worktree = (await info.json() as any)?.worktree
    } catch {}

    if (!worktree) worktree = worktreeFromProjects(port)

    await killPort(port)

    if (!worktree) return Response.json({ error: 'could not determine opencode working directory' }, { status: 500 })

    const cwd = isWin ? worktree.replace(/\//g, '\\') : worktree
    const proc = spawn(['opencode', 'serve', '--hostname', '0.0.0.0', '--port', String(port)], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    proc.unref()

    const healthy = await waitHealthy(port)
    return Response.json({ ok: healthy, port })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
