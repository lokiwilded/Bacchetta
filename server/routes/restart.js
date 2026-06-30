'use strict';

const { spawn, execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const isWin = process.platform === 'win32';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function killPort(port) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', timeout: 3000 });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port} `) && line.includes('LISTENING')) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            try { execSync(`taskkill /F /T /PID ${pid}`, { timeout: 3000 }); } catch {}
          }
        }
      }
    } else {
      try { execSync(`fuser -k ${port}/tcp`, { timeout: 3000 }); } catch {
        try {
          const pid = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 3000 }).trim();
          if (pid) execSync(`kill -9 ${pid}`, { timeout: 3000 });
        } catch {}
      }
    }
  } catch {}
  await sleep(800);
}

// Fallback: find the worktree for a port from clause-projects.json
function worktreeFromProjects(port) {
  try {
    const p = path.join(os.homedir(), '.config', 'opencode', 'clause-projects.json');
    if (!existsSync(p)) return null;
    const data = JSON.parse(readFileSync(p, 'utf8'));
    const proj = (data.projects || []).find(pr => pr.runningPort === port);
    return proj?.directory || null;
  } catch { return null; }
}

async function waitHealthy(port, maxMs = 25000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(600) });
      if (r.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

module.exports.handler = async function handler(req, res, _url, ctx) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  try {
    const ocUrl  = new URL(ctx.opencodeUrl);
    const port   = parseInt(ocUrl.port) || 4000;

    // Get working directory from opencode before killing it
    let worktree = null;
    try {
      const info = await fetch(`${ctx.opencodeUrl}/project/current`, { signal: AbortSignal.timeout(2000) });
      if (info.ok) worktree = (await info.json())?.worktree;
    } catch {}

    // Fallback: look up in clause-projects.json
    if (!worktree) worktree = worktreeFromProjects(port);

    await killPort(port);

    if (!worktree) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'could not determine opencode working directory' }));
    }

    const cwd = isWin ? worktree.replace(/\//g, '\\') : worktree;
    const proc = spawn('opencode', ['serve', '--hostname', '0.0.0.0', '--port', String(port)], {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: isWin,
    });
    proc.unref();

    const healthy = await waitHealthy(port);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: healthy, port }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
};
