'use strict';

const { readdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { readBody } = require('../lib/util');

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, tools: [], hasPermission: false, body: content.trim() };
  const meta = {};
  const tools = [];
  let inTools = false;
  let hasPermission = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inTools = /^clause_tools:/i.test(line);
      if (/^permission:/i.test(line)) hasPermission = true;
      if (!inTools) {
        const idx = line.indexOf(':');
        if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    } else if (inTools) {
      const item = line.trim().replace(/^-\s*/, '');
      if (item) tools.push(item);
    }
  }
  return { meta, tools, hasPermission, body: m[2].trim() };
}

function patchContent(content, model, systemPrompt, tools) {
  const fmMatch = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (!fmMatch) return content;
  let fm   = fmMatch[1];
  let body = content.slice(fm.length);
  if (model !== undefined) {
    if (/^model:/m.test(fm)) fm = fm.replace(/^model:.*$/m, `model: ${model}`);
    else fm = fm.replace(/^---\r?\n/, `---\nmodel: ${model}\n`);
  }
  if (tools !== undefined) {
    // Remove existing clause_tools block (our custom key, invisible to OpenCode)
    fm = fm.replace(/^clause_tools:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/m, '').replace(/\n{2,}/g, '\n');
    if (Array.isArray(tools) && tools.length > 0) {
      const block = `clause_tools:\n${tools.map(t => `  - ${t}`).join('\n')}`;
      fm = fm.replace(/(\r?\n)---\r?\n$/, `\n${block}\n---\n`);
    }
  }
  if (systemPrompt !== undefined) body = systemPrompt + '\n';
  return fm + body;
}

module.exports.parseFrontmatter = parseFrontmatter;
module.exports.patchContent = patchContent;

module.exports.handler = async function handler(req, res, _url, ctx) {
  const agentsDir = path.join(ctx.configDir, 'agents');

  if (req.method === 'GET') {
    try {
      const files = await readdir(agentsDir).catch(() => []);
      const agents = [];
      for (const f of files.filter(f => f.endsWith('.md'))) {
        try {
          const content = await readFile(path.join(agentsDir, f), 'utf8');
          const { meta, tools, hasPermission, body } = parseFrontmatter(content);
          agents.push({
            name: f.replace('.md', ''),
            mode: meta.mode || 'subagent',
            model: meta.model || '',
            description: meta.description || '',
            systemPrompt: body,
            tools,
            hasPermission,
          });
        } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(agents));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  if (req.method === 'PUT') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const { name, model, systemPrompt, tools } = body;
      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid name' }));
      }
      const filePath = path.join(agentsDir, `${name}.md`);
      const existing = await readFile(filePath, 'utf8').catch(() => null);
      if (!existing) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'agent file not found' })); }
      await writeFile(filePath, patchContent(existing, model, systemPrompt, tools), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'method not allowed' }));
};
