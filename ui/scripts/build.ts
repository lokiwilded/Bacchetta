// Copies vite output → public/dashboard.html after build
import { existsSync, copyFileSync, mkdirSync } from "fs"
import { join } from "path"

const src  = join(import.meta.dir, "../dist/index.html")
const dest = join(import.meta.dir, "../public/dashboard.html")

if (!existsSync(src)) {
  console.error("❌ dist/index.html not found — did vite build succeed?")
  process.exit(1)
}

mkdirSync(join(import.meta.dir, "../public"), { recursive: true })
copyFileSync(src, dest)

// Also deploy to the Node server's public dir (clause/public/)
const dest2 = join(import.meta.dir, "../../public/dashboard.html")
mkdirSync(join(import.meta.dir, "../../public"), { recursive: true })
copyFileSync(src, dest2)
console.log(`✅ Deployed → public/dashboard.html + ../../public/dashboard.html`)
