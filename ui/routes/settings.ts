import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const SETTINGS_PATH = join(homedir(), ".config", "opencode", "clause-settings.json")

const NUM_DEFAULTS = {
  compact_after:        10,
  rag_chunk_lines:      50,
  rag_top_k:            3,
  rag_max_file_kb:      100,
  cache_read_cap_chars: 30_000,
  cache_bash_cap_chars: 20_000,
  memory_idle_minutes:  5,
  memory_top_k:         3,
}

const STR_DEFAULTS = {
  memory_model:       '',
  profile_model:      '',
  memory_embed_model: 'bge-m3',
}

export const DEFAULTS = { ...NUM_DEFAULTS, ...STR_DEFAULTS }

function read() {
  try {
    if (existsSync(SETTINGS_PATH)) return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) }
  } catch {}
  return { ...DEFAULTS }
}

export async function handler(req: Request) {
  if (req.method === "GET") {
    return Response.json(read(), { headers: { "Cache-Control": "no-store" } })
  }

  if (req.method === "POST") {
    try {
      const body = await req.json() as Record<string, unknown>
      const current = read()
      const next = { ...current } as Record<string, unknown>
      for (const [k, v] of Object.entries(body)) {
        if (k in NUM_DEFAULTS && typeof v === "number" && isFinite(v) && v > 0) {
          next[k] = v
        } else if (k in STR_DEFAULTS && typeof v === "string") {
          next[k] = v.trim()
        }
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8")
      return Response.json({ ok: true, settings: next })
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 })
    }
  }

  return new Response("Method not allowed", { status: 405 })
}
