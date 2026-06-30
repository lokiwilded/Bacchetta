'use strict';

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const os   = require('node:os');

const PROJECTS_PATH = path.join(os.homedir(), '.config', 'opencode', 'clause-projects.json');
const isWin = process.platform === 'win32';

// Candidate ports for the single persistent opencode instance — first free one wins.
const PORT_CANDIDATES = [4001, 4002, 4003, 4004];
const INIT_PORT = 4005; // temp port for new-project registration
let _mainPort = null; // resolved once on first launch

const procs = new Map(); // port → ChildProcess

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function norm(p) { return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }

function read() {
  try { if (existsSync(PROJECTS_PATH)) return JSON.parse(readFileSync(PROJECTS_PATH, 'utf-8')); } catch {}
  return { projects: [] };
}

function write(data) {
  mkdirSync(path.dirname(PROJECTS_PATH), { recursive: true });
  writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2));
}

async function probeOpenCode(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const h = await res.json();
    if (!h?.healthy) return null;
    try {
      const p = await fetch(`http://127.0.0.1:${port}/project/current`, { signal: AbortSignal.timeout(2500) });
      return { port, version: h.version, project: p.ok ? await p.json() : null };
    } catch { return { port, version: h.version, project: null }; }
  } catch { return null; }
}

async function isHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const h = await res.json();
    return h?.healthy === true;
  } catch { return false; }
}

async function isPortOccupied(port) {
  return new Promise(resolve => {
    const server = require('net').createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
  });
}

async function waitHealthy(port, maxMs = 90000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) return true;
    await sleep(800);
  }
  return false;
}

async function killPortProcess(port) {
  if (procs.has(port)) {
    try { procs.get(port).kill('SIGKILL'); } catch {}
    procs.delete(port);
  }
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
  await sleep(600);
}

function spawnOpenCode(cwd, port) {
  const proc = spawn('opencode', ['serve', '--hostname', '0.0.0.0', '--port', String(port)], {
    cwd,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env },
    shell: isWin,
    windowsHide: true,
  });
  procs.set(port, proc);
  proc.on('exit', () => procs.delete(port));
  return proc;
}

async function ensureGitRepo(cwd) {
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', timeout: 3000 }).trim();
    if (norm(root) !== norm(cwd)) execSync('git init', { cwd, stdio: 'ignore', timeout: 5000 });
  } catch { try { execSync('git init', { cwd, stdio: 'ignore', timeout: 5000 }); } catch {} }
}

async function findProjectByDir(port, dir) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/project`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const projects = await res.json();
    // Prefer a permanent (non-global) ID; fall back to global if directory matches
    const permanent = projects.find(p => p.id !== 'global' && norm(p.worktree) === norm(dir));
    if (permanent) return permanent;
    return projects.find(p => norm(p.worktree) === norm(dir)) || null;
  } catch { return null; }
}

async function createSession(port, projectID) {
  try {
    const body = projectID ? { projectID } : {};
    const res = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

async function resolveMainPort() {
  if (_mainPort && await isHealthy(_mainPort)) return _mainPort;
  // Check if any candidate already has a healthy opencode
  for (const p of PORT_CANDIDATES) {
    if (await isHealthy(p)) { _mainPort = p; return p; }
  }
  // Find first truly free port (bind-test skips orphaned sockets)
  for (const p of PORT_CANDIDATES) {
    if (!await isPortOccupied(p)) { _mainPort = p; return p; }
    await killPortProcess(p);
    if (!await isPortOccupied(p)) { _mainPort = p; return p; }
  }
  return null;
}

async function launchProject(directory) {
  const dir = norm(directory);
  const cwd = isWin ? directory.replace(/\//g, '\\') : directory;

  await ensureGitRepo(cwd);

  // ── Step 1: Ensure one opencode is running on a free port ────────────────
  const MAIN_PORT = await resolveMainPort();
  if (MAIN_PORT === null) {
    return { port: 4001, error: 'All ports 4001-4004 are stuck with orphaned sockets. Restart your PC to free them.' };
  }

  if (!await isHealthy(MAIN_PORT)) {
    spawnOpenCode(cwd, MAIN_PORT);
    if (!await waitHealthy(MAIN_PORT, 90000)) {
      await killPortProcess(MAIN_PORT);
      _mainPort = null;
      return { port: MAIN_PORT, error: 'OpenCode did not start within 90s. Check terminal for errors.' };
    }
  }

  // ── Step 2: Find this directory in opencode's project list ───────────────
  let project = await findProjectByDir(MAIN_PORT, dir);
  let sessionId;

  if (project) {
    // Known project — create session on main
    const ses = await createSession(MAIN_PORT, project.id !== 'global' ? project.id : null);
    sessionId = ses?.id;
  } else {
    // New project — start a temp opencode from that directory to register it,
    // create a session there (session stores its own directory), then kill temp.
    if (await isPortOccupied(INIT_PORT)) await killPortProcess(INIT_PORT);

    if (!await isPortOccupied(INIT_PORT)) {
      spawnOpenCode(cwd, INIT_PORT);
      if (await waitHealthy(INIT_PORT, 60000)) {
        const ses = await createSession(INIT_PORT, null);
        sessionId = ses?.id;
      }
      await killPortProcess(INIT_PORT);
    } else {
      console.warn('[projects] INIT_PORT 4005 still stuck after kill — new project session may be missing');
    }
  }

  return { port: MAIN_PORT, sessionId };
}

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
    const data    = read();
    const portsToProbe = [...new Set([4000, ...PORT_CANDIDATES])];
    const running = (await Promise.all(portsToProbe.map(probeOpenCode))).filter(Boolean);

    const projects = (data.projects || []).map(p => {
      const match = running.find(r => {
        const wt  = r.project?.worktree?.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const dir = p.directory?.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return wt && dir && wt === dir;
      });
      if (!match) {
        // Even if not the "current" project, show running if main is up and project is in DB
        const mainUp = running.find(r => PORT_CANDIDATES.includes(r.port));
        return { ...p, running: false, runningPort: mainUp ? _mainPort : null, version: mainUp?.version || null };
      }
      return { ...p, running: true, runningPort: match.port, version: match.version };
    });

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ projects, running }));
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const { action } = body;

    if (action === 'add') {
      const dir = (body.directory || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!dir) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'directory required' })); }
      const winDir = isWin ? dir.replace(/\//g, '\\') : dir;
      if (!existsSync(winDir)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `Directory not found: ${winDir}` })); }
      const data = read();
      if (data.projects.find(p => p.directory === dir)) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'already added' })); }
      data.projects.push({ id: Date.now().toString(), name: body.name || path.basename(dir) || dir, directory: dir, addedAt: Date.now() });
      write(data);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }

    if (action === 'launch') {
      const data    = read();
      const project = data.projects.find(p => p.id === body.id);
      if (!project) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'project not found' })); }
      const winDir = isWin ? project.directory.replace(/\//g, '\\') : project.directory;
      if (!existsSync(winDir)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `Directory not found: ${winDir}` })); }
      const result = await launchProject(project.directory);
      if (result.error) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: result.error })); }
      if (result.sessionId) {
        const fresh = read();
        const idx = fresh.projects.findIndex(p => p.id === body.id);
        if (idx >= 0) { fresh.projects[idx].sessionId = result.sessionId; write(fresh); }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, port: result.port, sessionId: result.sessionId }));
    }

    if (action === 'remove') {
      const data = read();
      data.projects = data.projects.filter(p => p.id !== body.id);
      write(data);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }

    if (action === 'stop') {
      const port = body.port;
      if (!port) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'port required' })); }
      await killPortProcess(port);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true }));
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown action' }));
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};
