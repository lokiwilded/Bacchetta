#!/usr/bin/env node
'use strict';

if (parseInt(process.versions.node) < 18) {
  console.error('  tonyai requires Node.js 18 or later. Current: ' + process.version);
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

const HELP = `
  tonyai — OpenCode multi-agent dashboard

  Usage:
    tonyai install      Set up your environment (run this first)
    tonyai uninstall    Remove tonyai and restore your previous OpenCode config
    tonyai start        Start the tonyai dashboard server on :6969
    tonyai --help       Show this help

  Examples:
    tonyai install      # First-time setup wizard
    tonyai start        # Start the dashboard, then run: opencode
    tonyai uninstall    # Full cleanup, restores original opencode.json
`;

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (cmd === 'start') {
  cmdStart();
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

// --- tonyai start -----------------------------------------------------------

function cmdStart() {
  const serverPath = join(__dirname, '..', 'server', 'index.js');
  console.log('\n  tonyai dashboard → http://localhost:6969\n');
  const child = spawn(process.execPath, [serverPath], { stdio: 'inherit' });
  child.on('error', err => {
    console.error('  server error:', err.message);
    process.exit(1);
  });
  child.on('exit', code => process.exit(code || 0));
  process.on('SIGINT',  () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); });
  process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); });
}

// --- tonyai install ---------------------------------------------------------

async function cmdInstall() {
  const configDir  = join(os.homedir(), '.config', 'opencode');
  const pluginDir  = join(configDir, 'plugin');
  const agentsDir  = join(configDir, 'agents');
  const pkgDir     = join(__dirname, '..');
  const tmplDir    = join(pkgDir, 'templates');
  const manifestPath = join(configDir, 'tonyai-manifest.json');

  console.log('\n  tonyai — OpenCode multi-agent dashboard\n');
  console.log('  Checking prerequisites...');

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
  console.log(`  ${hasBgeM3 ? '✓' : '✗'} bge-m3 embedding model available${!hasBgeM3 && ollamaOk ? '  (run: ollama pull bge-m3)' : ''}`);
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
    if (!apiKey) {
      apiKey = (await prompt('  ? Ollama API key (from ollama.com/settings/keys): ')).trim();
      if (apiKey) {
        console.log(`  Add OLLAMA_API_KEY=${apiKey} to your shell profile to persist this.`);
      }
    }
    primaryModel = 'ollama-cloud/glm-5.2';
    fastModel    = 'ollama-cloud/deepseek-v4-flash';
  } else {
    primaryModel = (await prompt('  ? Primary model (e.g. qwen2.5-coder:32b, llama3.3:70b): ')).trim();
    fastModel    = (await prompt('  ? Fast model for quick tasks (e.g. qwen2.5:7b): ')).trim();
    if (!primaryModel) primaryModel = 'qwen2.5-coder:32b';
    if (!fastModel)    fastModel    = primaryModel;
  }

  closeRL();
  console.log('');

  mkdirSync(configDir, { recursive: true });

  // -- Backup opencode.json before touching it -------------------------------
  const opencodePath  = join(configDir, 'opencode.json');
  const opencodeBackup = join(configDir, 'opencode.json.tonyai.bak');
  const backedUp = [];

  if (existsSync(opencodePath) && !existsSync(opencodeBackup)) {
    copyFileSync(opencodePath, opencodeBackup);
    backedUp.push('opencode.json');
    console.log('  ✓ opencode.json backed up → opencode.json.tonyai.bak');
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
    if (!ocConfig.model)       ocConfig.model       = 'ollama-cloud/glm-5.2';
    if (!ocConfig.small_model) ocConfig.small_model = 'ollama-cloud/deepseek-v4-flash';
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

  // clause-settings.json (used internally by the tonyai server)
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

  console.log('\n  ✓ Done! Start OpenCode as normal — tonyai dashboard runs at http://localhost:6969');
  console.log('\n  Run: opencode\n');
  console.log('  To undo everything: tonyai uninstall\n');
}

// --- tonyai uninstall -------------------------------------------------------

async function cmdUninstall() {
  const configDir    = join(os.homedir(), '.config', 'opencode');
  const manifestPath = join(configDir, 'tonyai-manifest.json');

  console.log('\n  tonyai uninstall\n');

  if (!existsSync(manifestPath)) {
    console.log('  No tonyai installation found (manifest missing).');
    console.log('  If you installed manually, remove files from ~/.config/opencode/ by hand.\n');
    process.exit(0);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.error('  Could not read tonyai-manifest.json. Aborting.');
    process.exit(1);
  }

  const answer = await prompt('  This will restore your previous opencode.json and remove all tonyai files.\n  Continue? (y/N) ');
  closeRL();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\n  Aborted.\n');
    process.exit(0);
  }

  console.log('');

  // Restore opencode.json backup
  const opencodePath  = join(configDir, 'opencode.json');
  const opencodeBackup = join(configDir, 'opencode.json.tonyai.bak');

  if (existsSync(opencodeBackup)) {
    copyFileSync(opencodeBackup, opencodePath);
    tryUnlink(opencodeBackup);
    console.log('  ✓ opencode.json restored from backup');
  } else if (manifest.addedPlugins && manifest.addedPlugins.length > 0) {
    // No backup but we know what plugins we added — remove just those
    try {
      const ocConfig = JSON.parse(readFileSync(opencodePath, 'utf8'));
      ocConfig.plugin = (ocConfig.plugin || []).filter(p => !manifest.addedPlugins.includes(p));
      writeFileSync(opencodePath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf8');
      console.log('  ✓ opencode.json — removed tonyai plugin entries');
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
  console.log('  ✓ removed tonyai-manifest.json');

  // Npm packages — inform but don't auto-remove (could break other things)
  if (manifest.npmPackages && manifest.npmPackages.length > 0) {
    console.log('\n  npm packages were installed to ~/.config/opencode/.');
    console.log('  To remove them run:');
    console.log(`    cd "${configDir}" && npm uninstall ${manifest.npmPackages.join(' ')}`);
  }

  console.log('\n  ✓ tonyai uninstalled. Your previous OpenCode setup is restored.\n');
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
    memoryModel:       isCloud ? 'deepseek-v4-flash' : fastModel,
    memoryTemperature: 0.3,

    opencodeProvider: isCloud ? 'ollama-cloud' : 'ollama',
    opencodeModel:    isCloud ? 'deepseek-v4-flash' : fastModel,

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
