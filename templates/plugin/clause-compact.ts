import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const SETTINGS_PATH = join(homedir(), ".config", "opencode", "clause-settings.json")
function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"))
  } catch {}
  return {}
}

export const server: Plugin = async ({ client }) => {
  const s = loadSettings()
  const COMPACT_AFTER: number = s.compact_after ?? 10

  const counts  = new Map<string, number>()
  const pending = new Set<string>()

  const toast = (message: string, variant: "info" | "error" = "info") =>
    client.tui.showToast({ body: { message, variant, duration: 4000 } }).catch(() => {})

  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sid = (event as any).properties?.sessionID
      if (!sid || pending.has(sid)) return

      const n = (counts.get(sid) ?? 0) + 1
      counts.set(sid, n)
      if (n < COMPACT_AFTER) return

      pending.add(sid)
      counts.set(sid, 0)
      try {
        await toast(`Auto-compacting context (${n} turns)…`)
        await (client.session as any).summarize({
          path: { id: sid },
          body: { providerID: "ollama-cloud", modelID: "deepseek-v4-flash" },
        })
      } catch (e) {
        console.error("[clause-compact] failed:", e)
        await toast("Auto-compact failed — run /compact manually", "error")
      } finally {
        pending.delete(sid)
      }
    },
  }
}

export default server
