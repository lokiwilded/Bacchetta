// Idempotent patch: registers clause routes + assets in Nitro's compiled index.mjs
import { readFileSync, writeFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const indexPath = process.argv[2];
if (!indexPath) { console.error("Usage: node patch-index.mjs <path/to/index.mjs>"); process.exit(1); }

let src = readFileSync(indexPath, "utf8");

// Guard — don't double-patch
if (src.includes("clause-patched")) {
  console.log("  (already patched, skipping)");
  process.exit(0);
}

const dashboardSize = statSync(join(dirname(fileURLToPath(import.meta.url)), "../ui/public/dashboard.html")).size;

// 1. Inject lazy route handlers after existing usage/monitor lines
const routeHandlerMarker = 'var _lazy_usage = defineLazyEventHandler';
src = src.replace(
  routeHandlerMarker,
  `// clause-patched
var _lazy_clause_usage = defineLazyEventHandler(() => import("./_routes/api/usage.mjs"));
var _lazy_clause_monitor = defineLazyEventHandler(() => import("./_routes/api/monitor.mjs"));
var _lazy_clause_agents = defineLazyEventHandler(() => import("./_routes/api/agents.mjs"));
var _lazy_clause_models = defineLazyEventHandler(() => import("./_routes/api/models.mjs"));
${routeHandlerMarker}`
);

// 2. Inject routes into findRoute (add before the closing else block)
src = src.replace(
  'else if (p === "/api/usage") return',
  `else if (p === "/api/clause/usage") return { data: { route: "/api/clause/usage", handler: _lazy_clause_usage } };
\telse if (p === "/api/clause/monitor") return { data: { route: "/api/clause/monitor", handler: _lazy_clause_monitor } };
\telse if (p === "/api/clause/agents") return { data: { route: "/api/clause/agents", handler: _lazy_clause_agents } };
\telse if (p === "/api/clause/models") return { data: { route: "/api/clause/models", handler: _lazy_clause_models } };
\telse if (p === "/api/usage") return`
);

// 3. Inject static asset entry for dashboard.html
const assetMarker = '"/robots.txt": {';
src = src.replace(
  assetMarker,
  `"/dashboard.html": {
\t\t"type": "text/html; charset=utf-8",
\t\t"etag": "\\"clause-dashboard\\"",
\t\t"mtime": "${new Date().toISOString()}",
\t\t"size": ${dashboardSize},
\t\t"path": "../public/dashboard.html"
\t},
\t${assetMarker}`
);

writeFileSync(indexPath, src, "utf8");
console.log("  patched index.mjs");
