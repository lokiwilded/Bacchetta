'use strict';

const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os   = require('node:os');
const { readBody } = require('../lib/util');

const PROJECTS_PATH = path.join(os.homedir(), '.config', 'opencode', 'clause-projects.json');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function norm(p) { return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }

function read() {
  try { if (existsSync(PROJECTS_PATH)) return JSON.parse(readFileSync(PROJECTS_PATH, 'utf-8')); } catch {}
  return { projects: [] };
}

function write(data) {
  mkdirSync(path.dirname(PROJECTS_PATH), { recursive: true });
  writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2));
}

function openTerminal(cwd) {
  if (isWin) {
    // Try Windows Terminal first, fall back to cmd.exe
    try {
      spawn('wt', ['-d', cwd, 'cmd', '/k', 'opencode'], {
        detached: true, stdio: 'ignore', shell: true,
      }).unref();
      return;
    } catch {}
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${cwd}" && opencode`], {
      detached: true, stdio: 'ignore',
    }).unref();
  } else if (isMac) {
    spawn('osascript', [
      '-e', `tell application "Terminal" to do script "cd '${cwd.replace(/'/g, "'\\''")}' && opencode"`,
      '-e', 'tell application "Terminal" to activate',
    ], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Linux — try common terminals in order
    const terminals = [
      ['gnome-terminal', ['--working-directory', cwd, '--', 'bash', '-c', 'opencode; exec bash']],
      ['konsole',        ['--workdir', cwd, '-e', 'bash', '-c', 'opencode; exec bash']],
      ['xterm',          ['-e', `bash -c "cd '${cwd}' && opencode; exec bash"`]],
    ];
    for (const [term, args] of terminals) {
      try { spawn(term, args, { detached: true, stdio: 'ignore' }).unref(); return; } catch {}
    }
  }
}

module.exports.handler = async function handler(req, res) {
  if (req.method === 'GET') {
    const data = read();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ projects: data.projects || [] }));
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const { action } = body;

    if (action === 'add') {
      const dir = (body.directory || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
      if (!dir) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'directory required' }));
      }
      const nativePath = isWin ? dir.replace(/\//g, '\\') : dir;
      if (!existsSync(nativePath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Directory not found: ${nativePath}` }));
      }
      const data = read();
      if (data.projects.find(p => norm(p.directory) === norm(dir))) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'already added' }));
      }
      data.projects.push({
        id:        Date.now().toString(),
        name:      body.name || path.basename(dir) || dir,
        directory: dir,
        addedAt:   Date.now(),
      });
      write(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (action === 'launch') {
      const data    = read();
      const project = data.projects.find(p => p.id === body.id);
      if (!project) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'project not found' }));
      }
      const cwd = isWin ? project.directory.replace(/\//g, '\\') : project.directory;
      if (!existsSync(cwd)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Directory not found: ${cwd}` }));
      }
      openTerminal(cwd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (action === 'remove') {
      const data = read();
      data.projects = data.projects.filter(p => p.id !== body.id);
      write(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unknown action' }));
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};
