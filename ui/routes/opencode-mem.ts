const OM_PORT = 4747
const OM_BASE = `http://127.0.0.1:${OM_PORT}`

async function getStatus(): Promise<{ running: boolean }> {
  for (const path of ['/api/health', '/']) {
    try {
      const r = await fetch(`${OM_BASE}${path}`, { signal: AbortSignal.timeout(1200) })
      if (r.ok || r.status < 500) return { running: true }
    } catch {}
  }
  return { running: false }
}

export async function handler(req: Request, _ctx: any) {
  if (req.method === 'GET') {
    const status = await getStatus()
    return Response.json({ ...status, port: OM_PORT, url: `http://localhost:${OM_PORT}` }, {
      headers: { 'Cache-Control': 'no-store' }
    })
  }
  return Response.json({ error: 'method not allowed' }, { status: 405 })
}
