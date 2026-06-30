'use strict';

const { readdir, readFile, stat } = require('node:fs/promises');
const { mkdirSync, existsSync }   = require('node:fs');
const path    = require('node:path');
const os      = require('node:os');
const Database = require('better-sqlite3');
const { readBody } = require('../lib/util');

const OLLAMA_URL  = process.env.OLLAMA_URL          || 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.CLAUSE_EMBED_MODEL  || 'bge-m3';
const DB_PATH     = path.join(os.homedir(), '.local', 'share', 'opencode', 'clause-rag.db');

const CODE_EXTS = new Set([
  '.ts','.tsx','.js','.jsx','.mjs','.cjs',
  '.py','.go','.rs','.java','.c','.cpp','.h','.hpp',
  '.cs','.rb','.php','.swift','.kt',
  '.vue','.svelte','.astro',
  '.md','.mdx','.json','.yaml','.yml','.toml',
  '.sh','.bash','.zsh','.css','.scss','.html','.sql',
]);

const IGNORE_DIRS = new Set([
  'node_modules','.git','dist','build','.next','.nuxt',
  '.cache','coverage','__pycache__','.venv','venv',
  '.idea','.vscode','vendor','target','out',
]);

function initDB() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL, file_path TEXT NOT NULL,
      start_line INTEGER, end_line INTEGER,
      content TEXT NOT NULL, embedding BLOB,
      file_mtime INTEGER, indexed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ws ON chunks(workspace);
    CREATE TABLE IF NOT EXISTS workspaces (
      path TEXT PRIMARY KEY, indexed_at INTEGER, chunk_count INTEGER
    );
  `);
  return db;
}

async function embed(text) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const { embedding } = await res.json();
    return Buffer.from(new Float32Array(embedding).buffer);
  } catch { return null; }
}

async function walkDir(dir) {
  const files = [];
  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(path.join(d, e.name));
      } else if (e.isFile() && CODE_EXTS.has(path.extname(e.name).toLowerCase())) {
        files.push(path.join(d, e.name));
      }
    }
  }
  await walk(dir);
  return files;
}

function chunkContent(content, filePath) {
  const lines = content.split('\n');
  const chunks = [];
  const CHUNK = 80, OVERLAP = 15;
  for (let i = 0; i < lines.length; i += CHUNK - OVERLAP) {
    const s = i, e = Math.min(i + CHUNK, lines.length);
    chunks.push({ text: `// ${filePath} lines ${s+1}-${e}\n` + lines.slice(s, e).join('\n'), startLine: s+1, endLine: e });
    if (e >= lines.length) break;
  }
  return chunks;
}

module.exports.handler = async function handler(req, res, url, _ctx) {
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/rag/status') {
    const dir = url.searchParams.get('dir');
    try {
      const db  = initDB();
      const ws  = dir ? db.prepare('SELECT indexed_at, chunk_count FROM workspaces WHERE path = ?').get(path.resolve(dir)) : null;
      const all = db.prepare('SELECT path, indexed_at, chunk_count FROM workspaces ORDER BY indexed_at DESC').all();
      db.close();
      const data = {
        workspace: ws ? { indexed: true, chunks: ws.chunk_count, age_minutes: Math.round((Date.now() - ws.indexed_at) / 60000) } : { indexed: false },
        all: all.map(r => ({ path: r.path, chunks: r.chunk_count, age_minutes: Math.round((Date.now() - r.indexed_at) / 60000) })),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ workspace: { indexed: false }, all: [] }));
    }
  }

  if (req.method === 'POST' && p === '/api/rag/index') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const dir = body.directory;
    if (!dir) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'directory required' })); }

    const absDir = path.resolve(dir.replace(/\//g, process.platform === 'win32' ? '\\' : '/'));
    if (!existsSync(absDir)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `Directory not found: ${absDir}` })); }

    // SSE streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    function send(event, data) {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    try {
      send('status', { phase: 'checking', message: 'Checking Ollama…' });
      try {
        await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      } catch {
        send('error', { message: `Ollama not reachable at ${OLLAMA_URL}` });
        return res.end();
      }

      send('status', { phase: 'checking', message: `Testing ${EMBED_MODEL} model…` });
      const test = await embed('hello');
      if (!test) {
        send('error', { message: `Model ${EMBED_MODEL} not available. Run: ollama pull ${EMBED_MODEL}` });
        return res.end();
      }

      const db = initDB();

      if (!body.force) {
        const ws = db.prepare('SELECT chunk_count, indexed_at FROM workspaces WHERE path = ?').get(absDir);
        if (ws) {
          const age = Math.round((Date.now() - ws.indexed_at) / 60000);
          db.close();
          send('done', { message: `Already indexed — ${ws.chunk_count} chunks, ${age}m ago`, chunks: ws.chunk_count, files: 0, already: true });
          return res.end();
        }
      }

      send('status', { phase: 'walking', message: 'Scanning files…' });
      const files = await walkDir(absDir);
      send('status', { phase: 'walking', message: `Found ${files.length} files to index` });

      db.prepare('DELETE FROM chunks WHERE workspace = ?').run(absDir);
      const ins = db.prepare(
        'INSERT INTO chunks (workspace,file_path,start_line,end_line,content,embedding,file_mtime,indexed_at) VALUES (?,?,?,?,?,?,?,?)'
      );

      let indexed = 0, skipped = 0, totalChunks = 0;
      const MAX_BYTES = 200 * 1024;

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        try {
          const info = await stat(file);
          if (info.size > MAX_BYTES) { skipped++; continue; }
          const content = await readFile(file, 'utf8');
          const relPath = path.relative(absDir, file);
          const chunks  = chunkContent(content, relPath);
          for (const chunk of chunks) {
            const vec = await embed(chunk.text);
            if (!vec) continue;
            ins.run(absDir, relPath, chunk.startLine, chunk.endLine, chunk.text, vec, info.mtimeMs, Date.now());
            totalChunks++;
          }
          indexed++;
          if (fi % 5 === 0 || fi === files.length - 1) {
            send('progress', { phase: 'indexing', file: relPath, indexed, total: files.length, chunks: totalChunks, pct: Math.round((fi + 1) / files.length * 100) });
          }
        } catch { skipped++; }
      }

      db.prepare('INSERT OR REPLACE INTO workspaces (path,indexed_at,chunk_count) VALUES (?,?,?)').run(absDir, Date.now(), totalChunks);
      db.close();

      send('done', { message: `Indexed ${indexed} files → ${totalChunks} chunks`, files: indexed, chunks: totalChunks, skipped });
    } catch (e) {
      send('error', { message: String(e) });
    }
    return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
};
