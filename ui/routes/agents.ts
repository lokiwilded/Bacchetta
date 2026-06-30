import { readdir, readFile, writeFile } from "fs/promises"
import { join } from "path"

function parseFrontmatter(content: string) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {} as Record<string, string>, tools: [] as string[], hasPermission: false, body: content.trim() }
  const meta: Record<string, string> = {}
  const tools: string[] = []
  let inTools = false
  let hasPermission = false
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inTools = /^clause_tools:/i.test(line)
      if (/^permission:/i.test(line)) hasPermission = true
      if (!inTools) {
        const idx = line.indexOf(":")
        if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    } else if (inTools) {
      const item = line.trim().replace(/^-\s*/, '')
      if (item) tools.push(item)
    }
  }
  return { meta, tools, hasPermission, body: m[2].trim() }
}

// Surgically patch only the fields that changed — never re-serialize the whole file
// so nested blocks like permission: are preserved exactly as-is
function patchContent(content: string, model: string | undefined, systemPrompt: string | undefined, tools?: string[]): string {
  const fmMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/)
  if (!fmMatch) return content

  let fm   = fmMatch[1]
  let body = content.slice(fm.length)

  if (model !== undefined) {
    if (/^model:/m.test(fm)) {
      fm = fm.replace(/^model:.*$/m, `model: ${model}`)
    } else {
      fm = fm.replace(/^---\r?\n/, `---\nmodel: ${model}\n`)
    }
  }

  if (tools !== undefined) {
    fm = fm.replace(/^clause_tools:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/m, '').replace(/\n{2,}/g, '\n')
    if (tools.length > 0) {
      const block = `clause_tools:\n${tools.map(t => `  - ${t}`).join('\n')}`
      fm = fm.replace(/(\r?\n)---\r?\n$/, `\n${block}\n---\n`)
    }
  }

  if (systemPrompt !== undefined) body = systemPrompt + '\n'

  return fm + body
}

export async function handler(req: Request, ctx: { configDir: string }) {
  const agentsDir = join(ctx.configDir, "agents")

  if (req.method === "GET") {
    try {
      const files = await readdir(agentsDir).catch(() => [] as string[])
      const agents = []
      for (const f of files.filter(f => f.endsWith(".md"))) {
        try {
          const content = await readFile(join(agentsDir, f), "utf8")
          const { meta, tools, hasPermission, body } = parseFrontmatter(content)
          agents.push({ name: f.replace(".md", ""), mode: meta.mode || "subagent", model: meta.model || "", description: meta.description || "", systemPrompt: body, tools, hasPermission })
        } catch {}
      }
      return Response.json(agents, { headers: { 'Cache-Control': 'no-store' } })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  if (req.method === "PUT") {
    try {
      const body = await req.json() as any
      const { name, model, systemPrompt, tools } = body
      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return Response.json({ error: "invalid name" }, { status: 400 })
      const filePath = join(agentsDir, `${name}.md`)
      const existing = await readFile(filePath, "utf8").catch(() => null)
      if (!existing) return Response.json({ error: "agent file not found" }, { status: 404 })
      await writeFile(filePath, patchContent(existing, model, systemPrompt, tools), "utf8")
      return Response.json({ ok: true })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  return Response.json({ error: "method not allowed" }, { status: 405 })
}
