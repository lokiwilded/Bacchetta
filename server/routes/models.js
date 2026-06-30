'use strict';

const { readFile } = require('node:fs/promises');
const path = require('node:path');

module.exports.handler = async function handler(_req, res, _url, ctx) {
  try {
    const raw = await readFile(path.join(ctx.configDir, 'opencode.json'), 'utf8');
    const cfg = JSON.parse(raw);
    const models = [];
    for (const [provId, prov] of Object.entries(cfg.provider || {})) {
      for (const [modelId, info] of Object.entries(prov.models || {})) {
        models.push({ id: `${provId}/${modelId}`, name: info.name || modelId, provider: provId });
      }
    }
    const data = { models, defaultModel: cfg.model || '', smallModel: cfg.small_model || '' };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e), models: [] }));
  }
};
