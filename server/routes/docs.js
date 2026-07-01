'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const Database = require('better-sqlite3');

const OLLAMA_URL  = process.env.OLLAMA_URL         || 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env.CLAUSE_EMBED_MODEL || 'bge-m3';
const GITHUB_RAW  = 'https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production';
const GITHUB_API  = 'https://api.github.com/repos/cloudflare/cloudflare-docs';
const RAG_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'clause-rag.db');

const CF_DOCS_DIR       = path.join(os.homedir(), '.local', 'share', 'opencode', 'cf-docs');
const CF_DOCS_META_PATH = path.join(CF_DOCS_DIR, '_meta.json');
const CF_DOCS_WORKSPACE = CF_DOCS_DIR;

const STALE_MS     = 7 * 24 * 60 * 60 * 1000;   // 7 days
const MAX_FILES    = 25;                           // per product
const MAX_DEPTH    = 2;                            // directory recursion depth
const CHUNK_LINES  = 60;
const OVERLAP      = 10;

const PRODUCTS = {
  d1:      { path: 'src/content/docs/d1',      name: 'Cloudflare D1 (SQL at the edge)' },
  kv:      { path: 'src/content/docs/kv',      name: 'Cloudflare KV (key-value store)' },
  workers: { path: 'src/content/docs/workers', name: 'Cloudflare Workers (serverless runtime)' },
  r2:      { path: 'src/content/docs/r2',      name: 'Cloudflare R2 (object storage)' },
};

// ─── meta file ───────────────────────────────────────────────────────────────

function readMeta(metaPath) {
  const p = metaPath || CF_DOCS_META_PATH;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeMeta(meta, metaPath) {
  const p = metaPath || CF_DOCS_META_PATH;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

// ─── staleness ───────────────────────────────────────────────────────────────

function isStale(productMeta, latestSha) {
  if (!productMeta || !productMeta.last_fetched) return true;
  if (Date.now() - productMeta.last_fetched > STALE_MS) return true;
  if (latestSha && productMeta.sha && latestSha !== productMeta.sha) return true;
  return false;
}

// ─── MDX → markdown ──────────────────────────────────────────────────────────

function stripMdx(content) {
  return content
    .replace(/^---[\s\S]*?---\n?/m, '')               // frontmatter
    .replace(/^import\s+.*?(?:from\s+['"][^'"]*['"])?\s*;?\s*$/gm, '') // imports
    .replace(/^export\s+(const|default|function|type|interface)\s+[^\n]*/gm, '') // exports
    .replace(/<[A-Z][a-zA-Z]*(?:\s[^>]*)?\/?>/g, '')  // <JSXComponent ...>
    .replace(/<\/[A-Z][a-zA-Z]*>/g, '')                // </JSXComponent>
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')              // {/* comments */}
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── chunker ─────────────────────────────────────────────────────────────────

function chunkDoc(content, sourceName) {
  const lines  = content.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES - OVERLAP) {
    const s = i, e = Math.min(i + CHUNK_LINES, lines.length);
    chunks.push({
      text:      `// CF Docs: ${sourceName} (lines ${s + 1}–${e})\n` + lines.slice(s, e).join('\n'),
      startLine: s + 1,
      endLine:   e,
    });
    if (e >= lines.length) break;
  }
  return chunks;
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────

async function githubLatestSha(docPath) {
  try {
    const res = await fetch(
      `${GITHUB_API}/commits?path=${encodeURIComponent(docPath)}&per_page=1&sha=production`,
      { headers: { 'User-Agent': 'bacchetta-docs', Accept: 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.sha ?? null;
  } catch { return null; }
}

async function githubListFiles(dirPath, depth) {
  if (depth > MAX_DEPTH) return [];
  try {
    const res = await fetch(
      `${GITHUB_API}/contents/${encodeURIComponent(dirPath)}?ref=production`,
      { headers: { 'User-Agent': 'bacchetta-docs', Accept: 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const items = await res.json();
    const urls  = [];
    for (const item of items) {
      if (item.type === 'file' && /\.(mdx?|md)$/.test(item.name)) {
        urls.push(`${GITHUB_RAW}/${item.path}`);
      } else if (item.type === 'dir' && urls.length < MAX_FILES) {
        const sub = await githubListFiles(item.path, depth + 1);
        urls.push(...sub);
      }
      if (urls.length >= MAX_FILES) break;
    }
    return urls.slice(0, MAX_FILES);
  } catch { return []; }
}

async function fetchRaw(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? res.text() : null;
  } catch { return null; }
}

// ─── RAG indexing ─────────────────────────────────────────────────────────────

function initRagDb() {
  fs.mkdirSync(path.dirname(RAG_DB_PATH), { recursive: true });
  const db = new Database(RAG_DB_PATH);
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

async function embedText(text) {
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

async function indexProductIntoRag(productKey, content) {
  const db       = initRagDb();
  const filePath = `${productKey}.md`;
  db.prepare('DELETE FROM chunks WHERE workspace = ? AND file_path = ?').run(CF_DOCS_WORKSPACE, filePath);

  const ins = db.prepare(
    'INSERT INTO chunks (workspace,file_path,start_line,end_line,content,embedding,file_mtime,indexed_at) VALUES (?,?,?,?,?,?,?,?)'
  );

  let count = 0;
  for (const chunk of chunkDoc(content, productKey)) {
    const vec = await embedText(chunk.text);
    if (!vec) continue;
    ins.run(CF_DOCS_WORKSPACE, filePath, chunk.startLine, chunk.endLine, chunk.text, vec, Date.now(), Date.now());
    count++;
  }

  // Update total workspace chunk count
  const existing = db.prepare('SELECT chunk_count FROM workspaces WHERE path = ?').get(CF_DOCS_WORKSPACE);
  const total    = Math.max(0, (existing?.chunk_count ?? 0) + count);
  db.prepare('INSERT OR REPLACE INTO workspaces (path,indexed_at,chunk_count) VALUES (?,?,?)').run(CF_DOCS_WORKSPACE, Date.now(), total);
  db.close();
  return count;
}

// ─── status ───────────────────────────────────────────────────────────────────

function getStatus(metaPath) {
  const meta = readMeta(metaPath);
  return Object.entries(PRODUCTS).map(([key, prod]) => {
    const m = meta[key] ?? {};
    return {
      key,
      name:        prod.name,
      last_fetched: m.last_fetched ?? null,
      age_hours:   m.last_fetched ? Math.round((Date.now() - m.last_fetched) / 3_600_000) : null,
      stale:       isStale(m, null),
      sha:         m.sha ?? null,
      chunks:      m.chunks ?? 0,
      files:       m.files  ?? 0,
    };
  });
}

// ─── refresh ──────────────────────────────────────────────────────────────────

async function refreshAllDocs(force, metaPath) {
  const meta = readMeta(metaPath);
  const results = [];
  const ollamaOk = await (async () => {
    try {
      await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      return true;
    } catch { return false; }
  })();

  for (const [key, product] of Object.entries(PRODUCTS)) {
    const productMeta = meta[key] ?? {};
    const sha = await githubLatestSha(product.path);

    if (!force && !isStale(productMeta, sha)) {
      results.push({ key, skipped: true, reason: 'up-to-date', sha });
      continue;
    }

    const fileUrls = await githubListFiles(product.path, 0);
    if (fileUrls.length === 0) {
      results.push({ key, skipped: true, reason: 'no files found' });
      continue;
    }

    const parts = [];
    for (const url of fileUrls) {
      const raw = await fetchRaw(url);
      if (raw) parts.push(stripMdx(raw));
    }

    if (parts.length === 0) {
      results.push({ key, skipped: true, reason: 'all fetches failed' });
      continue;
    }

    const combined = `# ${product.name}\n\n` + parts.join('\n\n---\n\n');

    // Save markdown to disk
    fs.mkdirSync(CF_DOCS_DIR, { recursive: true });
    fs.writeFileSync(path.join(CF_DOCS_DIR, `${key}.md`), combined, 'utf8');

    // Index into RAG (skip if Ollama unreachable)
    let chunkCount = 0;
    if (ollamaOk) {
      chunkCount = await indexProductIntoRag(key, combined);
    }

    meta[key] = { sha, last_fetched: Date.now(), chunks: chunkCount, files: fileUrls.length };
    results.push({ key, updated: true, sha, chunks: chunkCount, files: fileUrls.length });
  }

  writeMeta(meta, metaPath);
  return results;
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', () => resolve(''));
  });
}

module.exports.handler = async function handler(req, res, _url, _ctx) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ docs: getStatus() }));
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const results = await refreshAllDocs(body.force === true);
      return res.end(JSON.stringify({ ok: true, results }));
    } catch (e) {
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};

// Exported for tests and server background tick
module.exports.refreshAllDocs = refreshAllDocs;
module.exports.getStatus      = getStatus;
module.exports.stripMdx       = stripMdx;
module.exports.chunkDoc       = chunkDoc;
module.exports.readMeta       = readMeta;
module.exports.writeMeta      = writeMeta;
module.exports.isStale        = isStale;
