'use strict';

const PORTS = [4000, 4001, 4002, 4003, 4004, 4005];

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', () => resolve(''));
  });
}

module.exports.handler = async function handler(req, res, url, ctx) {
  if (req.method === 'GET') {
    const port = parseInt(url.searchParams.get('port') || '');
    const dir  = url.searchParams.get('dir') || '';
    if (!port) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'port required' })); }

    // Query the DB directly by worktree — reliable, doesn't depend on OpenCode API filtering
    if (dir && ctx.dataDir) {
      try {
        const fs       = require('node:fs');
        const path     = require('node:path');
        const Database = require('better-sqlite3');
        const dbPath   = path.join(ctx.dataDir, 'opencode.db');
        if (fs.existsSync(dbPath)) {
          const db = new Database(dbPath, { readonly: true });
          // Try both slash styles — Windows stores backslashes, frontend sends forward slashes
          const dirAlt = dir.includes('\\') ? dir.replace(/\\/g, '/') : dir.replace(/\//g, '\\');
          const rows = db.prepare(`
            SELECT s.id, s.title,
              CAST(s.time_created AS INTEGER) as created,
              CAST(s.time_updated AS INTEGER) as updated
            FROM session s
            JOIN project pr ON pr.id = s.project_id
            WHERE (pr.worktree = ? OR pr.worktree = ?)
              AND s.parent_id IS NULL
            ORDER BY s.time_updated DESC
            LIMIT 50
          `).all(dir, dirAlt);
          db.close();
          const sessions = rows.map(r => ({
            id: r.id,
            title: r.title || 'Untitled',
            directory: dir,
            time: { created: r.created, updated: r.updated },
          }));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ sessions, directory: dir }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: String(e) }));
      }
    }

    // Fallback (no dir param): ask OpenCode directly
    try {
      const projRes = await fetch(`http://127.0.0.1:${port}/project/current`, { signal: AbortSignal.timeout(3000) });
      if (!projRes.ok) { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'opencode not responding' })); }
      const proj = await projRes.json();
      const sesRes = await fetch(`http://127.0.0.1:${port}/session`, { signal: AbortSignal.timeout(3000) });
      if (!sesRes.ok) { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'could not fetch sessions' })); }
      const all = await sesRes.json();
      const sessions = (Array.isArray(all) ? all : [])
        .filter(s => s.projectID === proj.id)
        .sort((a, b) => b.time.updated - a.time.updated);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ sessions, directory: proj.worktree }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}

    if (body.action === 'abort') {
      const { sessionId, port } = body;
      if (!sessionId) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'sessionId required' })); }

      // Try specified port first, then scan all known ports
      const tryPorts = port ? [port, ...PORTS.filter(p => p !== port)] : PORTS;
      for (const p of tryPorts) {
        try {
          const r = await fetch(`http://127.0.0.1:${p}/session/${sessionId}/abort`, {
            method: 'POST',
            signal: AbortSignal.timeout(3000),
          });
          if (r.status !== 404) {
            res.writeHead(r.ok ? 200 : r.status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: r.ok, port: p }));
          }
        } catch {}
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'session not found on any running opencode instance' }));
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unknown action' }));
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};
