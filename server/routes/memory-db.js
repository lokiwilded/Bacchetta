'use strict';

const fs     = require('node:fs');
const path   = require('node:path');
const os     = require('node:os');
const crypto = require('node:crypto');

const DB_PATH    = path.join(os.homedir(), '.local', 'share', 'opencode', 'clause-memory.db');
const MEMORY_DIR = path.join(os.homedir(), '.local', 'share', 'opencode', 'clause-memory');

function getSettings() {
  try {
    const p = path.join(os.homedir(), '.config', 'opencode', 'clause-settings.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return {};
}

function getDB() {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id         TEXT    PRIMARY KEY,
      dir        TEXT    NOT NULL,
      section    TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      embedding  BLOB,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      confidence REAL    NOT NULL DEFAULT 1.0
    );
    CREATE INDEX IF NOT EXISTS chunks_dir ON chunks(dir);

    CREATE TABLE IF NOT EXISTS profile (
      key       TEXT    PRIMARY KEY,
      value     TEXT    NOT NULL,
      confidence REAL   NOT NULL DEFAULT 1.0,
      last_seen INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      count     INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

async function embedText(text, modelOverride) {
  const s     = getSettings();
  const url   = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = modelOverride || s.memory_embed_model || process.env.CLAUSE_EMBED_MODEL || 'bge-m3';
  try {
    const res = await fetch(`${url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const { embedding } = await res.json();
    if (!embedding?.length) return null;
    return Buffer.from(new Float32Array(embedding).buffer);
  } catch { return null; }
}

function bufToVec(buf) {
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  return Array.from(arr);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Parse memory markdown into ## sections
function parseChunks(dir, content) {
  const chunks = [];
  const sections = content.split(/\n(?=## )/);
  for (const sec of sections) {
    const m = sec.trim().match(/^## (.+)\n([\s\S]*)$/);
    if (!m) continue;
    const body = m[2].trim();
    if (!body) continue;
    chunks.push({
      id:      crypto.createHash('sha1').update(dir + '::' + m[1]).digest('hex').slice(0, 20),
      dir,
      section: m[1].trim(),
      content: body,
    });
  }
  return chunks;
}

// Upsert chunks + embeddings for a memory file
async function indexMemoryFile(dir, content) {
  const chunks = parseChunks(dir, content);
  if (!chunks.length) return 0;
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO chunks (id, dir, section, content, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content, embedding=excluded.embedding, created_at=excluded.created_at
  `);
  let indexed = 0;
  for (const c of chunks) {
    const emb = await embedText(c.section + ': ' + c.content);
    upsert.run(c.id, c.dir, c.section, c.content, emb, Date.now());
    indexed++;
  }
  db.close();
  return indexed;
}

// Semantic search across all chunks (or filtered by dir)
async function searchMemory(query, dir, topK = 5) {
  const queryEmb = await embedText(query);
  const db = getDB();
  const rows = dir
    ? db.prepare('SELECT id, dir, section, content, embedding FROM chunks WHERE dir = ? AND embedding IS NOT NULL').all(dir)
    : db.prepare('SELECT id, dir, section, content, embedding FROM chunks WHERE embedding IS NOT NULL').all();
  db.close();

  if (!queryEmb || !rows.length) {
    // fallback: return all chunks (no semantic ranking)
    return rows.slice(0, topK).map(r => ({ ...r, similarity: 1 }));
  }

  const qVec = bufToVec(queryEmb);
  return rows
    .map(r => ({ ...r, similarity: cosine(qVec, bufToVec(r.embedding)) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map(r => ({ id: r.id, dir: r.dir, section: r.section, content: r.content, similarity: Math.round(r.similarity * 1000) / 1000 }));
}

// Upsert a profile item (increments count, decays old items toward new evidence)
function upsertProfile(key, value) {
  const db = getDB();
  const existing = db.prepare('SELECT count, confidence FROM profile WHERE key = ?').get(key);
  if (existing) {
    const count = existing.count + 1;
    const confidence = Math.min(0.99, existing.confidence + (1 - existing.confidence) * 0.2);
    db.prepare('UPDATE profile SET value=?, count=?, confidence=?, last_seen=? WHERE key=?')
      .run(value, count, confidence, Date.now(), key);
  } else {
    db.prepare('INSERT INTO profile (key, value, confidence, last_seen, count) VALUES (?,?,0.6,?,1)')
      .run(key, value, Date.now());
  }
  db.close();
}

module.exports = { getDB, embedText, bufToVec, cosine, parseChunks, indexMemoryFile, searchMemory, upsertProfile, DB_PATH, MEMORY_DIR };
