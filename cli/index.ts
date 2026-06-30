#!/usr/bin/env bun
// clause — start opencode + openportal + clause-ui in one command
// Usage: clause [directory] [--open]

import { spawn } from "bun"
import { resolve, existsSync } from "bun"
import { networkInterfaces } from "os"

const args = process.argv.slice(2)
const dir = args.find(a => !a.startsWith("--")) || "."
const openBrowser = args.includes("--open")

const workspace = resolve(dir)
if (!existsSync(workspace)) {
  console.error(`Directory not found: ${workspace}`)
  process.exit(1)
}

const OPENCODE_PORT = 4000
const UI_PORT       = 3001

const UI_DIR = resolve(import.meta.dir, "../ui")

console.log(`\n  clause — ${workspace}\n`)

// Start OpenCode headless server
const oc = spawn({
  cmd: ["opencode", "serve", "--port", String(OPENCODE_PORT)],
  cwd: workspace,
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env },
})

// Start clause-ui dashboard on 3001
const ui = spawn({
  cmd: ["bun", "run", "server.ts"],
  cwd: UI_DIR,
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    CLAUSE_UI_PORT: String(UI_PORT),
    OPENCODE_URL: `http://localhost:${OPENCODE_PORT}`,
  },
})

await Bun.sleep(2500)

const lan = getLAN()

console.log(`  ┌──────────────────────────────────────────────┐`)
console.log(`  │  clause                                      │`)
console.log(`  │                                              │`)
console.log(`  │  Dashboard: http://localhost:${UI_PORT}            │`)
console.log(`  │  Chat:      http://localhost:${OPENCODE_PORT}            │`)
if (lan) {
console.log(`  │                                              │`)
console.log(`  │  Phone:     http://${lan}:${UI_PORT}        │`)
}
console.log(`  └──────────────────────────────────────────────┘\n`)

if (openBrowser) spawn({ cmd: ["cmd", "/c", "start", `http://localhost:${UI_PORT}`] })

process.on("SIGINT",  () => { oc.kill(); ui.kill(); process.exit(0) })
process.on("SIGTERM", () => { oc.kill(); ui.kill(); process.exit(0) })

await Promise.all([oc.exited, ui.exited])

function getLAN(): string | null {
  try {
    for (const ifaces of Object.values(networkInterfaces()) as any[])
      for (const iface of ifaces || [])
        if (iface.family === "IPv4" && !iface.internal) return iface.address
  } catch {}
  return null
}
