#!/usr/bin/env node
'use strict';

if (parseInt(process.versions.node) < 18) {
  console.error('  tony requires Node.js 18 or later. Current: ' + process.version);
  process.exit(1);
}

const { execSync, spawn }                                        = require('child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync,
        readdirSync, copyFileSync }                              = require('fs');
const { join }                                                   = require('path');
const readline                                                   = require('readline');
const os                                                         = require('os');

const args = process.argv.slice(2);
const cmd  = args[0];

const HELP = `
  tony — OpenCode multi-agent dashboard

  Usage:
    tony install    Set up your environment (run this first)
    tony start      Start the tony dashboard server on :6969
    tony --help     Show this help

  Examples:
    tony install    # First-time setup wizard
    tony start      # Start the dashboard, then run: opencode
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
} else {
  console.error(`  Unknown command: ${cmd}\n`);
  console.log(HELP);
  process.exit(1);
}

// â”€â”€â”€ tony start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function cmdStart() {
  const serverPath = join(__dirname, '..', 'server', 'index.js');
  console.log('\n  tony dashboard â†’ http://localhost:6969\n');
  const child = spawn(process.execPath, [serverPath], { stdio: 'inherit' });
  child.on('error', err => {
    console.error('  server error:', err.message);
    process.exit(1);
  });
  child.on('exit', code => process.exit(code || 0));
  process.on('SIGINT',  () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); });
  process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} process.exit(0); });
}

// â”€â”€â”€ tony install â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function cmdInstall() {
  const configDir = join(os.homedir(), '.config', 'opencode');
  const pluginDir = join(configDir, 'plugin');
  const agentsDir = join(configDir, 'agents');
  const pkgDir    = join(__dirname, '..');
  const tmplDir   = join(pkgDir, 'templates');

  console.log('\n  tony — OpenCode multi-agent dashboard\n');
  console.log('  Checking prerequisites...');

  // opencode
  const hasOpencode = checkCmd('opencode');
  console.log(`  ${hasOpencode ? 'âœ“' : 'âœ—'} opencode ${hasOpencode ? 'found' : 'not found  (install: npm install -g opencode-ai)'}`);

  if (hasOpencode) {
    let hasServe = false;
    try { execSync('opencode serve --help', { stdio: 'ignore', timeout: 5000 }); hasServe = true; } catch {}
    if (!hasServe) {
      console.log('  âš  opencode found but `opencode serve` is not available.');
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

  console.log(`  ${ollamaOk ? 'âœ“' : 'âœ—'} Ollama running at localhost:11434`);
  console.log(`  ${hasBgeM3 ? 'âœ“' : 'âœ—'} bge-m3 embedding model available${!hasBgeM3 && ollamaOk ? '  (run: ollama pull bge-m3)' : ''}`);
  console.log('');

  // â”€â”€ Provider setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ npm install â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  mkdirSync(configDir, { recursive: true });
  try {
    execSync(`npm install ${packages.join(' ')}`, { cwd: configDir, stdio: 'inherit' });
    console.log('  done.\n');
  } catch {
    console.warn('  âš  npm install failed â€” you may need to run it manually:');
    console.warn(`    cd "${configDir}" && npm install ${packages.join(' ')}\n`);
  }

  // â”€â”€ Copy plugin files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('  Copying plugin files...');
  mkdirSync(pluginDir, { recursive: true });
  const pluginSrc = join(tmplDir, 'plugin');
  for (const f of readdirSync(pluginSrc)) {
    copyFileSync(join(pluginSrc, f), join(pluginDir, f));
    console.log(`  âœ“ ${f}`);
  }
  console.log('');

  // â”€â”€ Set up agents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('  Setting up agents...');
  mkdirSync(agentsDir, { recursive: true });
  const agentSrc = join(tmplDir, 'agents');
  for (const f of readdirSync(agentSrc)) {
    const dest = join(agentsDir, f);
    const name = f.replace('.md', '');
    if (existsSync(dest)) {
      console.log(`  - ${name}  (skipped â€” already exists)`);
    } else {
      let content = readFileSync(join(agentSrc, f), 'utf8');
      if (!isCloud) {
        // Replace all ollama-cloud/<model> references with the user's local model
        content = content.replace(/ollama-cloud\/[^\s'"]+/g, `ollama/${primaryModel}`);
      }
      writeFileSync(dest, content, 'utf8');
      console.log(`  âœ“ ${name}`);
    }
  }
  console.log('');

  // â”€â”€ Configure OpenCode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log('  Configuring OpenCode...');

  // Patch opencode.json â€” READ â†’ MERGE â†’ WRITE
  const opencodePath = join(configDir, 'opencode.json');
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
    // Local Ollama â€” write the user's chosen model to opencode.json
    if (!ocConfig.model)       ocConfig.model       = `ollama/${primaryModel}`;
    if (!ocConfig.small_model) ocConfig.small_model = `ollama/${fastModel}`;
  }

  // Always merge plugin list â€” add missing, preserve order, no duplicates
  const requiredPlugins = [
    '@ramtinj95/opencode-tokenscope',
    'opencode-synced',
    'opencode-queue',
    '@tarquinen/opencode-dcp',
    'opencode-mem',
    './plugin/tony-cache.ts',
    './plugin/tony-rag.ts',
    './plugin/tony-compact.ts',
  ];
  if (!Array.isArray(ocConfig.plugin)) ocConfig.plugin = [];
  for (const p of requiredPlugins) {
    if (!ocConfig.plugin.includes(p)) ocConfig.plugin.push(p);
  }

  if (!ocConfig.default_agent) ocConfig.default_agent = 'commander';

  writeFileSync(opencodePath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf8');
  console.log('  âœ“ opencode.json updated');

  // Create opencode-mem.jsonc (skip if exists)
  const memConfigPath = join(configDir, 'opencode-mem.jsonc');
  if (existsSync(memConfigPath)) {
    console.log('  - opencode-mem.jsonc  (skipped â€” already exists)');
  } else {
    const memConfig = buildMemConfig(isCloud, fastModel);
    writeFileSync(memConfigPath, JSON.stringify(memConfig, null, 2) + '\n', 'utf8');
    console.log('  âœ“ opencode-mem.jsonc created');
  }

  // Create tony-settings.json (skip if exists)
  const settingsPath = join(configDir, 'tony-settings.json');
  if (existsSync(settingsPath)) {
    console.log('  - tony-settings.json  (skipped â€” already exists)');
  } else {
    writeFileSync(settingsPath, readFileSync(join(tmplDir, 'tony-settings.json'), 'utf8'), 'utf8');
    console.log('  âœ“ tony-settings.json created');
  }

  console.log('\n  âœ“ Done! Start OpenCode as normal â€” tony dashboard runs at http://localhost:6969');
  console.log('\n  Run: opencode\n');
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function checkCmd(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 }); return true; }
  catch { return false; }
}

function fetchWithTimeout(url, ms) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// Single shared readline interface for the install wizard
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
    // Embeddings â€” always local Ollama (free)
    embeddingApiUrl: localUrl,
    embeddingApiKey: 'ollama',
    embeddingModel: 'bge-m3',

    // LLM for memory extraction
    memoryProvider: 'openai-chat',
    memoryApiUrl:   isCloud ? cloudUrl  : localUrl,
    memoryApiKey:   isCloud ? 'env://OLLAMA_API_KEY' : 'ollama',
    memoryModel:    isCloud ? 'deepseek-v4-flash' : fastModel,
    memoryTemperature: 0.3,

    // OpenCode provider registration
    opencodeProvider: isCloud ? 'ollama-cloud' : 'ollama',
    opencodeModel:    isCloud ? 'deepseek-v4-flash' : fastModel,

    // Web UI (http://localhost:4747)
    webServerEnabled: true,
    webServerPort:    4747,
    webServerHost:    '127.0.0.1',

    // Auto-capture from conversations
    autoCaptureEnabled:       true,
    autoCaptureMaxIterations: 5,
    autoCaptureMaxRetries:    3,

    // Deduplication
    deduplicationEnabled:              true,
    deduplicationSimilarityThreshold:  0.90,

    // Memory retention
    autoCleanupEnabled:       true,
    autoCleanupRetentionDays: 30,

    // Inject top memories at start of each new session
    chatMessage: {
      enabled:              true,
      maxMemories:          3,
      injectOn:             'first',
      excludeCurrentSession: true,
    },

    // User profile learning
    injectProfile:                true,
    userProfileAnalysisInterval:  10,
    userProfileMaxPreferences:    20,
    userProfileMaxPatterns:       15,

    similarityThreshold: 0.6,
    maxMemories:         10,
    memory:              { defaultScope: 'project' },

    showAutoCaptureToasts:  true,
    showUserProfileToasts:  true,
    showErrorToasts:        true,
  };
}
