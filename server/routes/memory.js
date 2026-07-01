'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const crypto = require('node:crypto');

const MEMORY_DIR = path.join(os.homedir(), '.local', 'share', 'opencode', 'clause-memory');

function getTopK() {
  try {
    const p = path.join(os.homedir(), '.config', 'opencode', 'clause-settings.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).memory_top_k || 3;
  } catch {}
  return 3;
}

function memPath(dir) {
  const hash = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 16);
  return path.join(MEMORY_DIR, `${hash}.md`);
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', () => resolve(''));
  });
}

module.exports.handler = async function handler(req, res, url) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });

  // GET /api/memory/search?q=...&dir=...
  if (req.method === 'GET' && url.pathname === '/api/memory/search') {
    const q   = url.searchParams.get('q') || '';
    const dir = url.searchParams.get('dir') || '';
    if (!q) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'q required' })); }
    try {
      const { searchMemory } = require('./memory-db');
      const chunks = await searchMemory(q, dir || null, getTopK());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ chunks }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  // GET /api/memory/profile
  if (req.method === 'GET' && url.pathname === '/api/memory/profile') {
    try {
      const { getDB } = require('./memory-db');
      const db = getDB();
      const profile = db.prepare('SELECT key, value, confidence, count, last_seen FROM profile ORDER BY confidence DESC, count DESC').all();
      db.close();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ profile }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e), profile: [] }));
    }
  }

  // GET /api/memory           → list all memory files
  // GET /api/memory?dir=...   → read specific memory file
  if (req.method === 'GET') {
    const dir = url.searchParams.get('dir');
    if (dir) {
      const p = memPath(dir);
      if (!fs.existsSync(p)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ dir, content: '', exists: false }));
      }
      const content = fs.readFileSync(p, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ dir, content, exists: true }));
    }

    // List all
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md'));
    const list = files.map(f => {
      const p = path.join(MEMORY_DIR, f);
      const content = fs.readFileSync(p, 'utf8');
      const dirMatch = content.match(/^# Project Memory — (.+)$/m);
      const timeMatch = content.match(/_Last extracted: (.+?)_/);
      return {
        file: f,
        dir: dirMatch?.[1] || '?',
        lastExtracted: timeMatch?.[1] || null,
        content,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(list));
  }

  // POST /api/memory { dir, content }  → save memory file
  if (req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { dir, content } = body;
      if (!dir) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'dir required' })); }
      fs.writeFileSync(memPath(dir), content || '', 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  // DELETE /api/memory?dir=...
  if (req.method === 'DELETE') {
    const dir = url.searchParams.get('dir');
    if (!dir) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'dir required' })); }
    try { fs.unlinkSync(memPath(dir)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};

module.exports.memPath = memPath;
module.exports.MEMORY_DIR = MEMORY_DIR;
