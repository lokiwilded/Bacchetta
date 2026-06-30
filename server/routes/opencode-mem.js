'use strict';

const OM_PORT = 4747;
const OM_BASE = `http://127.0.0.1:${OM_PORT}`;

async function getStatus() {
  for (const path of ['/api/health', '/']) {
    try {
      const r = await fetch(`${OM_BASE}${path}`, { signal: AbortSignal.timeout(1200) });
      if (r.ok || r.status < 500) return { running: true };
    } catch {}
  }
  return { running: false };
}

module.exports.handler = async function handler(req, res) {
  if (req.method === 'GET') {
    const status = await getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ...status, port: OM_PORT, url: `http://localhost:${OM_PORT}` }));
  }
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};
