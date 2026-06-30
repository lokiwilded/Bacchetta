'use strict';

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const { readBody } = require('../lib/util');

const SETTINGS_PATH = path.join(os.homedir(), '.config', 'opencode', 'clause-settings.json');

const NUM_DEFAULTS = {
  compact_after:        10,
  rag_chunk_lines:      50,
  rag_top_k:            3,
  rag_max_file_kb:      100,
  cache_read_cap_chars: 30_000,
  cache_bash_cap_chars: 20_000,
  memory_idle_minutes:  5,
  memory_top_k:         3,
};

const STR_DEFAULTS = {
  memory_model:       '',
  profile_model:      '',
  memory_embed_model: 'bge-m3',
};

const DEFAULTS = { ...NUM_DEFAULTS, ...STR_DEFAULTS };

function read() {
  try {
    if (existsSync(SETTINGS_PATH)) return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {}
  return { ...DEFAULTS };
}

module.exports.DEFAULTS = DEFAULTS;
module.exports.NUM_DEFAULTS = NUM_DEFAULTS;
module.exports.STR_DEFAULTS = STR_DEFAULTS;
module.exports.validateAndMerge = function validateAndMerge(body, current) {
  const next = { ...current };
  for (const [k, v] of Object.entries(body)) {
    if (k in NUM_DEFAULTS && typeof v === 'number' && isFinite(v) && v > 0) {
      next[k] = v;
    } else if (k in STR_DEFAULTS && typeof v === 'string') {
      next[k] = v.trim();
    }
  }
  return next;
};

module.exports.handler = async function handler(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(read()));
  }

  if (req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const next = module.exports.validateAndMerge(body, read());
      mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, settings: next }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};
