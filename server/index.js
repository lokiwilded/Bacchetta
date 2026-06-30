'use strict';

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const OPENCODE_URL = process.env.OPENCODE_URL        || 'http://127.0.0.1:4000';
const CONFIG_DIR   = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
const DATA_DIR     = process.env.OPENCODE_DATA_DIR   || path.join(os.homedir(), '.local', 'share', 'opencode');
const PORT         = parseInt(process.env.CLAUSE_UI_PORT || process.env.PORT || '6969');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ctx = { dataDir: DATA_DIR, configDir: CONFIG_DIR, opencodeUrl: OPENCODE_URL };

const OWN_API = new Set([
  '/api/usage', '/api/monitor', '/api/agents', '/api/models',
  '/api/projects', '/api/rag/status', '/api/rag/index', '/api/settings',
  '/api/restart', '/api/sessions', '/api/current-project',
  '/api/memory', '/api/memory/search', '/api/memory/profile',
  '/api/opencode-mem',
]);
const SPA = new Set(['/', '/dashboard', '/app']);

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

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

function proxyToOpenCode(req, res, url, targetBase) {
  const target = new URL(`${targetBase || OPENCODE_URL}${url.pathname}${url.search}`);
  const mod = target.protocol === 'https:' ? require('node:https') : require('node:http');
  const opts = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers: { ...req.headers, host: target.host },
    timeout: 10000,
  };
  delete opts.headers.connection;

  return new Promise(resolve => {
    const pr = mod.request(opts, upstream => {
      const h = { ...upstream.headers };
      delete h['content-encoding'];
      res.writeHead(upstream.statusCode, h);
      upstream.pipe(res);
      upstream.on('end', resolve);
    });
    pr.on('timeout', () => pr.destroy());
    pr.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('OpenCode not running. Start it with: opencode serve');
      }
      resolve();
    });
    req.pipe(pr);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const p   = url.pathname;

  // Resolve which opencode port to proxy to (cookie overrides default)
  const cookies = parseCookies(req);
  const cookiePort = parseInt(cookies['opencode_port'] || '');
  const projectPort = (cookiePort >= 4000 && cookiePort <= 4005) ? cookiePort : 4000;
  const proxyBase = projectPort !== 4000 ? `http://127.0.0.1:${projectPort}` : OPENCODE_URL;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  try {
    if (OWN_API.has(p)) {
      if (p === '/api/current-project') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ port: projectPort, isMain: projectPort === 4000 }));
      }
      if (p === '/api/usage')                              return require('./routes/usage').handler(req, res, url, ctx);
      if (p === '/api/monitor')                            return require('./routes/monitor').handler(req, res, url, ctx);
      if (p === '/api/agents')                             return require('./routes/agents').handler(req, res, url, ctx);
      if (p === '/api/models')                             return require('./routes/models').handler(req, res, url, ctx);
      if (p === '/api/projects')                           return require('./routes/projects').handler(req, res, url, ctx);
      if (p === '/api/rag/status' || p === '/api/rag/index') return require('./routes/rag').handler(req, res, url, ctx);
      if (p === '/api/settings')                           return require('./routes/settings').handler(req, res, url, ctx);
      if (p === '/api/restart')                            return require('./routes/restart').handler(req, res, url, ctx);
      if (p === '/api/sessions')                           return require('./routes/sessions').handler(req, res, url, ctx);
      if (p === '/api/memory' || p === '/api/memory/search' || p === '/api/memory/profile')
                                                           return require('./routes/memory').handler(req, res, url, ctx);
      if (p === '/api/opencode-mem')                       return require('./routes/opencode-mem').handler(req, res);
    }

    if (SPA.has(p)) {
      const html = path.join(PUBLIC_DIR, 'dashboard.html');
      if (fs.existsSync(html)) {
        const portParam = url.searchParams.get('port');
        const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
        if (portParam && /^\d+$/.test(portParam)) {
          const np = parseInt(portParam);
          if (np >= 4000 && np <= 4005) {
            headers['Set-Cookie'] = `opencode_port=${np}; Path=/; SameSite=Lax; Max-Age=86400`;
          }
        }
        res.writeHead(200, headers);
        return res.end(fs.readFileSync(html));
      }
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('Dashboard not built — run: npm run build-ui');
    }

    const staticPath = path.join(PUBLIC_DIR, p);
    if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = path.extname(staticPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(staticPath));
    }

    return proxyToOpenCode(req, res, url, proxyBase);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
});

server.listen(PORT, () => {
  const lan = getLAN();
  console.log(`\n  Dashboard  →  http://localhost:${PORT}/`);
  console.log(`  Chat       →  http://localhost:${PORT}/  (OpenCode UI proxied)`);
  if (lan) console.log(`  Phone      →  http://${lan}:${PORT}`);
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

// ─── Ensure memory-keeper agent exists ───────────────────────────────────────

(function ensureMemoryKeeperAgent() {
  const agentPath = path.join(CONFIG_DIR, 'agents', 'memory-keeper.md');
  const DEFAULT_MODEL = '';
  if (fs.existsSync(agentPath)) {
    // Patch empty model to the fast default so the agent card shows a real selection
    try {
      const content = fs.readFileSync(agentPath, 'utf8');
      if (/^model:\s*["']?["']?\s*$/m.test(content)) {
        fs.writeFileSync(agentPath, content.replace(/^model:.*$/m, `model: ${DEFAULT_MODEL}`), 'utf8');
      }
    } catch {}
    return;
  }
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
