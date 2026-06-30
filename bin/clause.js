#!/usr/bin/env node
'use strict';

const { spawn, execSync } = require('child_process');
const { existsSync }      = require('fs');
const { resolve, join }   = require('path');
const os                  = require('os');

const args        = process.argv.slice(2);
const showHelp    = args.includes('--help') || args.includes('-h');
const openBrowser = args.includes('--open');
const dir         = args.find(a => !a.startsWith('--')) || '.';

const portArg  = args.find(a => a.startsWith('--port='));
const oportArg = args.find(a => a.startsWith('--oport='));
const UI_PORT  = portArg  ? parseInt(portArg.split('=')[1])  : parseInt(process.env.CLAUSE_UI_PORT  || '3001');
const OC_PORT  = oportArg ? parseInt(oportArg.split('=')[1]) : parseInt(process.env.OPENCODE_PORT   || '4000');

if (showHelp) {
  console.log(`
  clause — OpenCode dashboard

  Usage: clause [directory] [options]

  Options:
    --port=<n>    Dashboard port (default: 3001)
    --oport=<n>   OpenCode backend port (default: 4000)
    --open        Open browser on start
    --help        Show this help

  Examples:
    clause                     start in current directory
    clause ~/projects/myapp    start in a specific directory
    clause --open              start and open browser
    clause --port=3000         use port 3000 for the dashboard
`);
  process.exit(0);
}

const workspace = resolve(dir);
if (!existsSync(workspace)) {
  console.error(`\n  ✗ Directory not found: ${workspace}\n`);
  process.exit(1);
}

function hasCommand(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 }); return true; }
  catch { return false; }
}

if (!hasCommand('opencode')) {
  console.error(`
  ✗  opencode is not installed.

  Install it:
    npm install -g opencode-ai

  Or with the official installer:
    curl -fsSL https://opencode.ai/install | sh

  Then re-run: clause
`);
  process.exit(1);
}

const SERVER_ENTRY = join(__dirname, '..', 'server', 'index.js');
const isWin = process.platform === 'win32';

console.log(`\n  clause  →  ${workspace}\n`);

const oc = spawn('opencode', ['serve', '--port', String(OC_PORT)], {
  cwd: workspace,
  stdio: 'inherit',
  env: { ...process.env },
  shell: isWin,
});

const ui = spawn(process.execPath, [SERVER_ENTRY], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CLAUSE_UI_PORT: String(UI_PORT),
    OPENCODE_URL: `http://localhost:${OC_PORT}`,
  },
});

oc.on('error', e => console.error('  opencode:', e.message));
ui.on('error', e => console.error('  server:',   e.message));

setTimeout(() => {
  const lan = getLAN();
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │  clause                                          │');
  console.log('  │                                                  │');
  console.log(`  │  Dashboard  →  http://localhost:${UI_PORT}              │`);
  console.log(`  │  Chat       →  http://localhost:${OC_PORT}              │`);
  if (lan) {
    console.log('  │                                                  │');
    console.log(`  │  Phone      →  http://${lan}:${UI_PORT}         │`);
  }
  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');

  if (openBrowser) {
    const url = `http://localhost:${UI_PORT}`;
    const open = isWin ? `start "" "${url}"` :
                 process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    try { execSync(open, { shell: true }); } catch {}
  }
}, 2500);

function cleanup() {
  try { oc.kill('SIGTERM'); } catch {}
  try { ui.kill('SIGTERM'); } catch {}
  process.exit(0);
}

process.on('SIGINT',  cleanup);
process.on('SIGTERM', cleanup);

function getLAN() {
  try {
    for (const ifaces of Object.values(os.networkInterfaces()))
      for (const iface of ifaces || [])
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  } catch {}
  return null;
}
