#!/usr/bin/env node
'use strict';

if (parseInt(process.versions.node) < 18) {
  console.error('  bacchetta requires Node.js 18 or later. Current: ' + process.version);
  process.exit(1);
}

const { execSync, spawn }                                        = require('child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync,
        readdirSync, copyFileSync, unlinkSync }                  = require('fs');
const { join }                                                   = require('path');
const readline                                                   = require('readline');
const os                                                         = require('os');

const args = process.argv.slice(2);
const cmd  = args[0];

const SEARXNG_CONTAINER = 'bacchetta-searxng';
const SEARXNG_PORT      = 8888;
const SEARXNG_CONFIG    = join(os.homedir(), '.config', 'searxng');
const SEARXNG_SETTINGS  = join(SEARXNG_CONFIG, 'settings.yml');

const HELP = `
  bacchetta — OpenCode multi-agent dashboard

  Usage:
    bacchetta install      Set up your environment (run this first)
    bacchetta uninstall    Remove bacchetta and restore your previous OpenCode config
    bacchetta start        Start the dashboard server on :6969
    bacchetta restart      Kill any running instance and start fresh
    bacchetta --help       Show this help

  Examples:
    bacchetta install      # First-time setup wizard
    bacchetta start        # Start the dashboard, then run: opencode
    bacchetta restart      # Use this after npm install -g bacchetta@latest
    bacchetta uninstall    # Full cleanup, restores original opencode.json
`;

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (cmd === 'start') {
  cmdStart(false);
} else if (cmd === 'restart') {
  cmdStart(true);
} else if (cmd === 'install') {
  cmdInstall().catch(err => {
    console.error('\n  Error:', err.message);
    process.exit(1);
  });
} else if (cmd === 'uninstall') {
  cmdUninstall().catch(err => {
    console.error('\n  Error:', err.message);
    process.exit(1);
  });
} else {
  console.error(`  Unknown command: ${cmd}\n`);
  console.log(HELP);
  process.exit(1);
}

// --- SearXNG ----------------------------------------------------------------

const SEARXNG_YML = `\
use_default_settings: true

server:
  secret_key: "bacchetta-searxng-localkey-7x9k2m"
  limiter: false
  image_proxy: false
  port: 8080
  bind_address: "0.0.0.0"

search:
  safe_search: 0
  default_lang: "en"
  formats:
    - html
    - json

engines:
  - name: google
    engine: google
    shortcut: g
    disabled: false
  - name: duckduckgo
    engine: duckduckgo
    shortcut: d
    disabled: false
  - name: bing
    engine: bing
    shortcut: b
    disabled: false
  - name: github
    engine: github
    shortcut: gh
    disabled: false
  - name: stackoverflow
    engine: stackoverflow
    shortcut: so
    disabled: false
  - name: npm
    engine: npm
    shortcut: npm
    disabled: false
  - name: mdn
    engine: mdn
    shortcut: mdn
    disabled: false
`;

function startSearXNG() {
  if (!checkCmd('docker')) {
    console.log('  ⚠  Docker not found — SearXNG web search unavailable (install Docker Desktop to enable)');
    return;
  }

  mkdirSync(SEARXNG_CONFIG, { recursive: true });
  if (!existsSync(SEARXNG_SETTINGS)) {
    writeFileSync(SEARXNG_SETTINGS, SEARXNG_YML, 'utf8');
  }

  try {
    const state = execSync(
      `docker inspect --format={{.State.Status}} ${SEARXNG_CONTAINER}`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().replace(/"/g, '');

    if (state === 'running') {
      console.log(`  ✓ SearXNG already running → http://localhost:${SEARXNG_PORT}`);
      return;
    }

    execSync(`docker start ${SEARXNG_CONTAINER}`, { stdio: 'ignore', timeout: 10000 });
    console.log(`  ✓ SearXNG started → http://localhost:${SEARXNG_PORT}`);
  } catch {
    // Container doesn't exist — clean up any old tonyai container that may hold the port
    try { execSync('docker rm -f tonyai-searxng', { stdio: 'ignore', timeout: 5000 }); } catch {}

    console.log('  ↓ Setting up SearXNG web search (first run — ~150MB download)…');
    try {
      execSync(
        `docker run -d --name ${SEARXNG_CONTAINER} -p ${SEARXNG_PORT}:8080 -v "${SEARXNG_CONFIG}:/etc/searxng:rw" --restart unless-stopped searxng/searxng`,
        { stdio: 'pipe', timeout: 180000 }
      );
      console.log(`  ✓ SearXNG ready → http://localhost:${SEARXNG_PORT}`);
    } catch (err) {
      const msg = String(err.message || '');
      if (msg.includes('port is already allocated') || msg.includes('address already in use')) {
        console.log(`  ⚠  Port ${SEARXNG_PORT} is in use by another process — SearXNG skipped`);
        console.log(`     Free port ${SEARXNG_PORT} then run: bacchetta restart`);
      } else {
        console.log(`  ⚠  SearXNG setup failed: ${msg.split('\n')[0]}`);
      }
    }
  }
}

// --- bacchetta start / restart ----------------------------------------------

function killPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p TCP 2>NUL`, { encoding: 'utf8', timeout: 5000 });
      const re  = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'i');
      const m   = out.match(re);
      if (m) execSync(`taskkill /PID ${m[1]} /F`, { stdio: 'ignore', timeout: 5000 });
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

function cmdStart(kill) {
  const PORT = 6969;
  const serverPath = join(__dirname, '..', 'server', 'index.js');

  if (kill) {
    console.log('\n  bacchetta → stopping any running instance…');
    killPort(PORT);
    const until = Date.now() + 1200;
    while (Date.now() < until) { /* spin */ }
  }

  startSearXNG();
  console.log('\n  bacchetta dashboard → http://localhost:6969\n');
  const child = spawn(process.execPath, [serverPath], { stdio: 'inherit' });
  child.on('error', err => {
    if (err.code === 'EADDRINUSE' || String(err).includes('EADDRINUSE')) {
      console.error(`\n  Port ${PORT} is already in use. Run: bacchetta restart\n`);
    } else {
      console.error('  server error:', err.message);
    }
    process.exit(1);
  });
  child.on('exit', code => {
    if (code === 98 || code === 48) {
      console.error(`\n  Port ${PORT} is already in use. Run: bacchetta restart\n`);
      process.exit(1);
    }
    process.exit(code || 0);
  });
  process.on('SIGINT',  () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); });
  process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); });
}

// --- bacchetta install ------------------------------------------------------

async function cmdInstall() {
  const configDir  = join(os.homedir(), '.config', 'opencode');
  const pluginDir  = join(configDir, 'plugin');
  const agentsDir  = join(configDir, 'agents');
  const pkgDir     = join(__dirname, '..');
  const tmplDir    = join(pkgDir, 'templates');
  const manifestPath = join(configDir, 'bacchetta-manifest.json');

  console.log('\n  bacchetta — OpenCode multi-agent dashboard\n');
  console.log('  Checking prerequisites...\n');

  // opencode
  const hasOpencode = checkCmd('opencode');
  console.log(`  ${hasOpencode ? '✓' : '✗'} opencode ${hasOpencode ? 'found' : 'not found  (install: npm install -g opencode-ai)'}`);

  if (hasOpencode) {
    let hasServe = false;
    try { execSync('opencode serve --help', { stdio: 'ignore', timeout: 5000 }); hasServe = true; } catch {}
    if (!hasServe) {
      console.log('  ⚠  opencode found but `opencode serve` is not available.');
      console.log('    Make sure you have opencode-ai >= 0.3.0: npm install -g opencode-ai\n');
    }
  }

  // Detect existing OpenCode setup
  const opencodePath   = join(configDir, 'opencode.json');
  const existingConfig = existsSync(opencodePath);
  if (existingConfig) {
    console.log('\n  Detected existing OpenCode setup.');
    console.log('  Your opencode.json will be backed up before any changes are made.');
    console.log('  Running bacchetta uninstall will restore it exactly as it is now.\n');
  }

  // Ollama + bge-m3
  let ollamaOk = false;
  let hasBgeM3 = false;
  try {
    const res = await fetchWithTimeout('http://127.0.0.1:11434/api/tags', 2000);
    if (res.ok) {
      ollamaOk = true;
      const data = await res.json();
      const models = (data.models || []).map(m => m.name || '');
      hasBgeM3 = models.some(m => m.includes('bge-m3'));
    }
  } catch {}

  console.log(`  ${ollamaOk ? '✓' : '✗'} Ollama running at localhost:11434`);
  console.log(`  ${hasBgeM3 ? '✓' : '✗'} bge-m3 embedding model${!hasBgeM3 && ollamaOk ? '  (run: ollama pull bge-m3)' : ''}`);
  console.log('');

  // -- Provider setup --------------------------------------------------------
  console.log('  Provider setup:');
  const providerChoice = await prompt(
    '  ? How are you running AI models?\n' +
    '    1) Ollama Cloud  (pay-per-second, cloud models at ollama.com)\n' +
    '    2) Local Ollama  (free, your own GPU)\n' +
    '  > '
  );
  const isCloud = providerChoice.trim() !== '2';

  let apiKey       = '';
  let primaryModel = '';
  let fastModel    = '';

  if (isCloud) {
    apiKey = process.env.OLLAMA_API_KEY || '';
    if (apiKey) {
      console.log('  ✓ OLLAMA_API_KEY found in environment\n');
    } else {
      console.log('  Get your API key from: https://ollama.com/settings/keys\n');
      apiKey = (await prompt('  ? Ollama Cloud API key: ')).trim();
      if (apiKey) {
        console.log('\n  Save this to your environment so you only do this once:');
        if (process.platform === 'win32') {
          console.log(`    setx OLLAMA_API_KEY "${apiKey}"`);
          console.log('    (open a new terminal after running setx)\n');
        } else {
          const profile = (process.env.SHELL || '').includes('zsh') ? '~/.zshrc' : '~/.bashrc';
          console.log(`    echo 'export OLLAMA_API_KEY="${apiKey}"' >> ${profile}`);
          console.log(`    source ${profile}\n`);
        }
      }
    }
    primaryModel = 'ollama-cloud/kimi-k2.6';
    fastModel    = 'ollama-cloud/gemini-3-flash-preview:cloud';
  } else {
    console.log('  Recommended models by hardware:\n');
    console.log('     8GB  VRAM/RAM  →  qwen2.5-coder:7b, gemma3:4b');
    console.log('    16GB  VRAM/RAM  →  qwen2.5-coder:14b');
    console.log('    32GB+ VRAM/RAM  →  qwen2.5-coder:32b, llama3.3:70b\n');
    primaryModel = (await prompt('  ? Primary model (for coding tasks): ')).trim();
    fastModel    = (await prompt('  ? Fast model (for quick edits, defaults to same): ')).trim();
    if (!primaryModel) primaryModel = 'qwen2.5-coder:14b';
    if (!fastModel)    fastModel    = primaryModel;
    console.log('\n  Pull your models now (or run these later):');
    console.log(`    ollama pull ${primaryModel}`);
    if (fastModel !== primaryModel) console.log(`    ollama pull ${fastModel}`);
    console.log('    ollama pull bge-m3\n');
  }

  closeRL();
  console.log('');

  mkdirSync(configDir, { recursive: true });

  // -- Backup opencode.json before touching it -------------------------------
  const opencodeBackup = join(configDir, 'opencode.json.bacchetta.bak');
  const backedUp = [];

  if (existsSync(opencodePath) && !existsSync(opencodeBackup)) {
    copyFileSync(opencodePath, opencodeBackup);
    backedUp.push('opencode.json');
    console.log('  ✓ opencode.json backed up → opencode.json.bacchetta.bak');
  }

  // -- npm install -----------------------------------------------------------
  console.log('  Installing OpenCode plugins...');
  const packages = [
    'opencode-mem',
    '@tarquinen/opencode-dcp',
    '@ramtinj95/opencode-tokenscope',
    'opencode-synced',
    'opencode-queue',
    '@ai-sdk/openai-compatible',
  ];
  for (const pkg of packages) console.log(`    ${pkg}`);

  try {
    execSync(`npm install ${packages.join(' ')}`, { cwd: configDir, stdio: 'inherit' });
    console.log('  done.\n');
  } catch {
    console.warn('  ⚠  npm install failed — you may need to run it manually:');
    console.warn(`    cd "${configDir}" && npm install ${packages.join(' ')}\n`);
  }

  // -- Copy plugin files -----------------------------------------------------
  console.log('  Copying plugin files...');
  mkdirSync(pluginDir, { recursive: true });
  const pluginSrc = join(tmplDir, 'plugin');
  const createdFiles = [];

  for (const f of readdirSync(pluginSrc)) {
    const dest = join(pluginDir, f);
    copyFileSync(join(pluginSrc, f), dest);
    createdFiles.push(`plugin/${f}`);
    console.log(`  ✓ ${f}`);
  }
  console.log('');

  // -- Set up agents ---------------------------------------------------------
  console.log('  Setting up agents...');
  mkdirSync(agentsDir, { recursive: true });
  const agentSrc = join(tmplDir, 'agents');

  for (const f of readdirSync(agentSrc)) {
    const dest = join(agentsDir, f);
    const name = f.replace('.md', '');
    if (existsSync(dest)) {
      console.log(`  - ${name}  (skipped — already exists)`);
    } else {
      let content = readFileSync(join(agentSrc, f), 'utf8');
      if (!isCloud) {
        content = content.replace(/ollama-cloud\/[^\s'"]+/g, `ollama/${primaryModel}`);
      }
      writeFileSync(dest, content, 'utf8');
      createdFiles.push(`agents/${f}`);
      console.log(`  ✓ ${name}`);
    }
  }
  console.log('');

  // -- Configure OpenCode ----------------------------------------------------
  console.log('  Configuring OpenCode...');

  let ocConfig = {};
  if (existsSync(opencodePath)) {
    try { ocConfig = JSON.parse(readFileSync(opencodePath, 'utf8')); } catch {}
  }

  if (isCloud) {
    if (!ocConfig.provider) ocConfig.provider = {};
    if (!ocConfig.provider['ollama-cloud']) {
      const tmpl = JSON.parse(readFileSync(join(tmplDir, 'opencode.json'), 'utf8'));
      ocConfig.provider['ollama-cloud'] = tmpl.provider['ollama-cloud'];
    }
    // Only set models if not already configured — preserve existing user choices
    if (!ocConfig.model)       ocConfig.model       = 'ollama-cloud/kimi-k2.6';
    if (!ocConfig.small_model) ocConfig.small_model = 'ollama-cloud/gemini-3-flash-preview:cloud';
  } else {
    if (!ocConfig.model)       ocConfig.model       = `ollama/${primaryModel}`;
    if (!ocConfig.small_model) ocConfig.small_model = `ollama/${fastModel}`;
  }

  const requiredPlugins = [
    '@ramtinj95/opencode-tokenscope',
    'opencode-synced',
    'opencode-queue',
    '@tarquinen/opencode-dcp',
    'opencode-mem',
    './plugin/clause-cache.ts',
    './plugin/clause-rag.ts',
    './plugin/clause-compact.ts',
  ];
  if (!Array.isArray(ocConfig.plugin)) ocConfig.plugin = [];
  const addedPlugins = [];
  for (const p of requiredPlugins) {
    if (!ocConfig.plugin.includes(p)) {
      ocConfig.plugin.push(p);
      addedPlugins.push(p);
    }
  }

  if (!ocConfig.default_agent) ocConfig.default_agent = 'commander';

  writeFileSync(opencodePath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf8');
  console.log('  ✓ opencode.json updated');

  // opencode-mem.jsonc
  const memConfigPath = join(configDir, 'opencode-mem.jsonc');
  if (existsSync(memConfigPath)) {
    console.log('  - opencode-mem.jsonc  (skipped — already exists)');
  } else {
    const memConfig = buildMemConfig(isCloud, fastModel);
    writeFileSync(memConfigPath, JSON.stringify(memConfig, null, 2) + '\n', 'utf8');
    createdFiles.push('opencode-mem.jsonc');
    console.log('  ✓ opencode-mem.jsonc created');
  }

  // clause-settings.json (used internally by the bacchetta server)
  const settingsPath = join(configDir, 'clause-settings.json');
  if (existsSync(settingsPath)) {
    console.log('  - clause-settings.json  (skipped — already exists)');
  } else {
    copyFileSync(join(tmplDir, 'clause-settings.json'), settingsPath);
    createdFiles.push('clause-settings.json');
    console.log('  ✓ clause-settings.json created');
  }

  // -- Write manifest --------------------------------------------------------
  const manifest = {
    version:      require(join(__dirname, '..', 'package.json')).version,
    installedAt:  new Date().toISOString(),
    backedUp,
    createdFiles,
    addedPlugins,
    npmPackages:  packages,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('\n  ✓ Done!\n');
  console.log('  Start the dashboard:\n');
  console.log('    bacchetta start\n');
  console.log('  Then use OpenCode either way:\n');
  console.log('    • Run opencode in any project folder as usual');
  console.log('    • Or open the dashboard → Projects → add a folder → Start Session\n');
  console.log('  To undo everything: bacchetta uninstall\n');
}

// --- bacchetta uninstall ----------------------------------------------------

async function cmdUninstall() {
  const configDir    = join(os.homedir(), '.config', 'opencode');
  const manifestPath = join(configDir, 'bacchetta-manifest.json');

  console.log('\n  bacchetta uninstall\n');

  if (!existsSync(manifestPath)) {
    console.log('  No bacchetta installation found (manifest missing).');
    console.log('  If you installed manually, remove files from ~/.config/opencode/ by hand.\n');
    process.exit(0);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.error('  Could not read bacchetta-manifest.json. Aborting.');
    process.exit(1);
  }

  const answer = await prompt('  This will restore your previous opencode.json and remove all bacchetta files.\n  Continue? (y/N) ');
  closeRL();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\n  Aborted.\n');
    process.exit(0);
  }

  console.log('');

  // Restore opencode.json backup
  const opencodePath   = join(configDir, 'opencode.json');
  const opencodeBackup = join(configDir, 'opencode.json.bacchetta.bak');

  if (existsSync(opencodeBackup)) {
    copyFileSync(opencodeBackup, opencodePath);
    tryUnlink(opencodeBackup);
    console.log('  ✓ opencode.json restored from backup');
  } else if (manifest.addedPlugins && manifest.addedPlugins.length > 0) {
    try {
      const ocConfig = JSON.parse(readFileSync(opencodePath, 'utf8'));
      ocConfig.plugin = (ocConfig.plugin || []).filter(p => !manifest.addedPlugins.includes(p));
      writeFileSync(opencodePath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf8');
      console.log('  ✓ opencode.json — removed bacchetta plugin entries');
    } catch {
      console.warn('  ⚠  Could not patch opencode.json — check it manually');
    }
  }

  // Remove files created by install
  for (const rel of (manifest.createdFiles || [])) {
    const full = join(configDir, rel);
    if (tryUnlink(full)) {
      console.log(`  ✓ removed ${rel}`);
    }
  }

  // Remove manifest itself
  tryUnlink(manifestPath);
  console.log('  ✓ removed bacchetta-manifest.json');

  // Npm packages — inform but don't auto-remove
  if (manifest.npmPackages && manifest.npmPackages.length > 0) {
    console.log('\n  npm packages were installed to ~/.config/opencode/.');
    console.log('  To remove them run:');
    console.log(`    cd "${configDir}" && npm uninstall ${manifest.npmPackages.join(' ')}`);
  }

  console.log('\n  ✓ bacchetta uninstalled. Your previous OpenCode setup is restored.\n');
}

// --- Helpers ----------------------------------------------------------------

function checkCmd(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 }); return true; }
  catch { return false; }
}

function fetchWithTimeout(url, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function tryUnlink(p) {
  try { unlinkSync(p); return true; } catch { return false; }
}

let _rl = null;
function getRL() {
  if (!_rl) _rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return _rl;
}
function closeRL() {
  if (_rl) { _rl.close(); _rl = null; }
}
function prompt(question) {
  return new Promise(resolve => getRL().question(question, answer => resolve(answer)));
}

function buildMemConfig(isCloud, fastModel) {
  const localUrl = 'http://127.0.0.1:11434/v1';
  const cloudUrl = 'https://ollama.com/v1';

  return {
    embeddingApiUrl: localUrl,
    embeddingApiKey: 'ollama',
    embeddingModel:  'bge-m3',

    memoryProvider:    'openai-chat',
    memoryApiUrl:      isCloud ? cloudUrl  : localUrl,
    memoryApiKey:      isCloud ? 'env://OLLAMA_API_KEY' : 'ollama',
    memoryModel:       isCloud ? 'gemini-3-flash-preview:cloud' : fastModel,
    memoryTemperature: 0.3,

    opencodeProvider: isCloud ? 'ollama-cloud' : 'ollama',
    opencodeModel:    isCloud ? 'gemini-3-flash-preview:cloud' : fastModel,

    webServerEnabled: true,
    webServerPort:    4747,
    webServerHost:    '127.0.0.1',

    autoCaptureEnabled:       true,
    autoCaptureMaxIterations: 5,
    autoCaptureMaxRetries:    3,

    deduplicationEnabled:             true,
    deduplicationSimilarityThreshold: 0.90,

    autoCleanupEnabled:       true,
    autoCleanupRetentionDays: 30,

    chatMessage: {
      enabled:               true,
      maxMemories:           3,
      injectOn:              'first',
      excludeCurrentSession: true,
    },

    injectProfile:               true,
    userProfileAnalysisInterval: 10,
    userProfileMaxPreferences:   20,
    userProfileMaxPatterns:      15,

    similarityThreshold: 0.6,
    maxMemories:         10,
    memory:              { defaultScope: 'project' },

    showAutoCaptureToasts: true,
    showUserProfileToasts: true,
    showErrorToasts:       true,
  };
}
