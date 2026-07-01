'use strict';

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
const DATA_DIR   = process.env.OPENCODE_DATA_DIR   || path.join(os.homedir(), '.local', 'share', 'opencode');
const PORT       = parseInt(process.env.CLAUSE_UI_PORT || process.env.PORT || '6969');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ctx = { dataDir: DATA_DIR, configDir: CONFIG_DIR };

const OWN_API = new Set([
  '/api/usage', '/api/monitor', '/api/agents', '/api/models',
  '/api/projects', '/api/rag/status', '/api/rag/index', '/api/settings',
  '/api/sessions', '/api/memory', '/api/memory/search', '/api/memory/profile',
  '/api/opencode-mem', '/api/docs',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const p   = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  try {
    // Own API routes
    if (OWN_API.has(p)) {
      if (p === '/api/usage')                                  return require('./routes/usage').handler(req, res, url, ctx);
      if (p === '/api/monitor')                                return require('./routes/monitor').handler(req, res, url, ctx);
      if (p === '/api/agents')                                 return require('./routes/agents').handler(req, res, url, ctx);
      if (p === '/api/models')                                 return require('./routes/models').handler(req, res, url, ctx);
      if (p === '/api/projects')                               return require('./routes/projects').handler(req, res, url, ctx);
      if (p === '/api/rag/status' || p === '/api/rag/index')  return require('./routes/rag').handler(req, res, url, ctx);
      if (p === '/api/settings')                               return require('./routes/settings').handler(req, res, url, ctx);
      if (p === '/api/sessions')                               return require('./routes/sessions').handler(req, res, url, ctx);
      if (p === '/api/memory' || p.startsWith('/api/memory/')) return require('./routes/memory').handler(req, res, url, ctx);
      if (p === '/api/opencode-mem')                           return require('./routes/opencode-mem').handler(req, res);
      if (p === '/api/docs')                                   return require('./routes/docs').handler(req, res, url, ctx);
    }

    // Static files in public/
    const staticPath = path.join(PUBLIC_DIR, p);
    if (p !== '/' && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = path.extname(staticPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(staticPath));
    }

    // SPA fallback — serve dashboard for all other routes
    const html = path.join(PUBLIC_DIR, 'dashboard.html');
    if (fs.existsSync(html)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(html));
    }

    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('Dashboard not built — run: bun run build from ui/');
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.\n  Run: bacchetta restart\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const lan = getLAN();
  console.log(`\n  bacchetta dashboard  →  http://localhost:${PORT}/`);
  if (lan) console.log(`  On your network   →  http://${lan}:${PORT}`);
  console.log();
});

function getLAN() {
  try {
    for (const ifaces of Object.values(os.networkInterfaces()))
      for (const iface of ifaces || [])
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  } catch {}
  return null;
}

// ─── CF docs — daily staleness refresh ───────────────────────────────────────

let _lastDocsCheck = 0;
async function docsRefreshTick() {
  if (Date.now() - _lastDocsCheck < 23 * 60 * 60 * 1000) return; // once per ~day
  _lastDocsCheck = Date.now();
  try {
    const { refreshAllDocs } = require('./routes/docs');
    const results = await refreshAllDocs(false);
    const updated = results.filter(r => r.updated).length;
    if (updated > 0) console.log(`  ✓ cf-docs: refreshed ${updated} product(s)`);
  } catch (e) {
    console.error('  ✗ cf-docs refresh failed:', e.message);
  }
}

setInterval(docsRefreshTick, 60 * 60 * 1000).unref(); // check hourly, don't block exit
setTimeout(docsRefreshTick, 15_000).unref();           // initial check 15s after startup

// ─── Ensure memory-keeper agent exists ───────────────────────────────────────

(function ensureMemoryKeeperAgent() {
  const agentPath = path.join(CONFIG_DIR, 'agents', 'memory-keeper.md');
  if (fs.existsSync(agentPath)) return;
  try {
    fs.mkdirSync(path.dirname(agentPath), { recursive: true });
    fs.writeFileSync(agentPath, [
      '---',
      'description: Extracts and stores key project facts before context compression.',
      'mode: subagent',
      'model: ',
      'permission:',
      '  edit: deny',
      '  write: deny',
      '  bash: deny',
      '  task: deny',
      '  delegate: deny',
      '  read: allow',
      '  glob: allow',
      '  grep: allow',
      '---',
      'You are a memory extraction agent. Your only job is to read the current conversation',
      'context and produce a concise markdown document that captures:',
      '',
      '## Key Facts',
      'Important technical facts about the project (stack, architecture, file locations).',
      '',
      '## Decisions Made',
      'Architectural or implementation decisions reached in this session.',
      '',
      '## Known Issues',
      'Bugs or problems identified but not yet resolved.',
      '',
      '## Patterns & Preferences',
      'How the user likes things done — code style, tool preferences, workflow habits.',
      '',
      'Be factual and brief. Omit any section that has nothing worth saving.',
      'Output only the markdown document, nothing else.',
    ].join('\n') + '\n', 'utf8');
    console.log('  ✓ created memory-keeper agent');
  } catch {}
})();
