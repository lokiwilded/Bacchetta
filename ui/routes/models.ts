import { readFile } from "fs/promises"
import { join } from "path"

export async function handler(_req: Request, ctx: { configDir: string }) {
  try {
    const cfg = JSON.parse(await readFile(join(ctx.configDir, "opencode.json"), "utf8"))
    const models: { id: string; name: string; provider: string }[] = []
    for (const [provId, prov] of Object.entries(cfg.provider || {}) as any[]) {
      for (const [modelId, info] of Object.entries(prov.models || {}) as any[]) {
        models.push({ id: `${provId}/${modelId}`, name: info.name || modelId, provider: provId })
      }
    }
    return Response.json({ models, defaultModel: cfg.model || "", smallModel: cfg.small_model || "" }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: String(e), models: [] }, { status: 500 })
  }
}
