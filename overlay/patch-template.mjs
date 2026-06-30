// Idempotent patch: adds a floating Dashboard button to OpenCode's HTML template
import { readFileSync, writeFileSync } from "fs";

const templatePath = process.argv[2];
if (!templatePath) { console.error("Usage: node patch-template.mjs <path/to/renderer-template.mjs>"); process.exit(1); }

let src = readFileSync(templatePath, "utf8");

if (src.includes("clause-dashboard-btn")) {
  console.log("  (already patched, skipping)");
  process.exit(0);
}

// Inject before </body>
const inject = `<a id=\\"clause-dashboard-btn\\" href=\\"/dashboard.html\\" title=\\"Clause Dashboard\\" style=\\"position:fixed;bottom:14px;right:14px;z-index:9999;background:rgba(99,102,241,.9);color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;font-family:ui-sans-serif,sans-serif;text-decoration:none;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.15);font-weight:600\\">⬡ Dashboard<\\/a>`;

src = src.replace(`<\\/body>`, `${inject}\\n  <\\/body>`);

writeFileSync(templatePath, src, "utf8");
console.log("  patched renderer-template.mjs");
