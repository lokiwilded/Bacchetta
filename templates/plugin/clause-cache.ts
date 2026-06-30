import { tool } from "@opencode-ai/plugin"
import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createHash } from "crypto"
import { execSync } from "child_process"

const CACHE_DIR     = join(homedir(), ".local", "share", "opencode", "clause-cache")
const SETTINGS_PATH = join(homedir(), ".config", "opencode", "clause-settings.json")
mkdirSync(CACHE_DIR, { recursive: true })

function loadSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"))
  } catch {}
  return {}
}
const _S = loadSettings()
const READ_CAP = _S.cache_read_cap_chars  ?? 30_000
const BASH_CAP = _S.cache_bash_cap_chars  ?? 20_000

function key(s: string) { return createHash("sha1").update(s).digest("hex") }

function readEntry(k: string, maxAgeMs: number): string | null {
  const f = join(CACHE_DIR, k + ".json")
  if (!existsSync(f)) return null
  try {
    const { ts, value } = JSON.parse(readFileSync(f, "utf8"))
    return Date.now() - ts < maxAgeMs ? value : null
  } catch { return null }
}

function writeEntry(k: string, value: string) {
  writeFileSync(join(CACHE_DIR, k + ".json"), JSON.stringify({ ts: Date.now(), value }), "utf8")
}

export const server: Plugin = async () => {
  return {
    tool: {
      read_cached: tool({
        description:
          "Read a file with caching — instant on repeated reads if file is unchanged. " +
          "Always prefer this over the built-in `read` for files you may read more than once.",
        args: {
          path: tool.schema.string().describe("Absolute path to the file"),
        },
        async execute({ path }) {
          if (!existsSync(path)) return `File not found: ${path}`
          try {
            const mtime = statSync(path).mtimeMs
            const k = key(path + ":" + mtime)
            const cached = readEntry(k, 3_600_000)
            if (cached !== null) return { title: `read_cached ✓ ${path}`, output: cached, metadata: { cached: true } }
            const content = readFileSync(path, "utf8")
            const truncated = content.length > READ_CAP
            const out = truncated ? content.slice(0, READ_CAP) + `\n\n[... truncated — file is ${content.length} chars, showing first ${READ_CAP}. Use grep/search_code for specific sections.]` : content
            writeEntry(k, out)
            return { title: `read_cached (fresh) ${path}`, output: out, metadata: { cached: false, truncated, total_chars: content.length } }
          } catch (e: any) { return `Error: ${e.message}` }
        },
      }),

      bash_cached: tool({
        description:
          "Run a shell command and cache the output. Use for repeated status checks " +
          "(git status, build output, test results) where the result won't change. " +
          "Do NOT use for commands with side effects.",
        args: {
          command:     tool.schema.string().describe("Shell command to run"),
          ttl_seconds: tool.schema.number().default(30).describe("Cache TTL in seconds (default 30)"),
          cwd:         tool.schema.string().optional().describe("Working directory"),
        },
        async execute({ command, ttl_seconds, cwd }) {
          const k = key(command + (cwd || ""))
          const cached = readEntry(k, ttl_seconds * 1000)
          if (cached !== null) return { title: `bash_cached ✓`, output: cached, metadata: { cached: true, command } }
          try {
            const raw = execSync(command, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 512 * 1024 })
            const output = raw.length > BASH_CAP ? raw.slice(0, BASH_CAP) + `\n[... truncated — ${raw.length} chars total]` : raw
            writeEntry(k, output)
            return { title: `bash_cached (fresh)`, output, metadata: { cached: false, command } }
          } catch (e: any) {
            const raw = (e.stdout || "") + (e.stderr || "") || String(e)
            const out = raw.length > BASH_CAP ? raw.slice(0, BASH_CAP) + `\n[... truncated]` : raw
            writeEntry(k, out)
            return { title: `bash_cached (error)`, output: out, metadata: { cached: false, command } }
          }
        },
      }),

      cache_status: tool({
        description: "List what's in the file and bash caches — useful for debugging.",
        args: {},
        async execute() {
          try {
            const { readdirSync } = await import("fs")
            const files = readdirSync(CACHE_DIR).filter((f: string) => f.endsWith(".json"))
            const entries = files.slice(-20).map((f: string) => {
              try {
                const { ts } = JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8"))
                return `  ${f.slice(0, 12)} — ${Math.round((Date.now() - ts) / 1000)}s old`
              } catch { return null }
            }).filter(Boolean)
            return `Cache dir: ${CACHE_DIR}\nEntries: ${files.length}\n\nRecent:\n${entries.join("\n")}`
          } catch (e: any) { return `Error: ${e.message}` }
        },
      }),
    },
  }
}
