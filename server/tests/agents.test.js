'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter, patchContent } = require('../routes/agents');

// ─── parseFrontmatter ─────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {

  test('parses basic frontmatter fields', () => {
    const content = `---
model: ollama/qwen2.5:7b
mode: primary
description: My agent
---
You are an assistant.`;
    const { meta, tools, hasPermission, body } = parseFrontmatter(content);
    assert.equal(meta.model, 'ollama/qwen2.5:7b');
    assert.equal(meta.mode, 'primary');
    assert.equal(meta.description, 'My agent');
    assert.deepEqual(tools, []);
    assert.equal(hasPermission, false);
    assert.equal(body, 'You are an assistant.');
  });

  test('extracts clause_tools list', () => {
    const content = `---
model: ollama/qwen2.5:7b
mode: subagent
clause_tools:
  - read
  - glob
  - grep
---
Body here.`;
    const { tools } = parseFrontmatter(content);
    assert.deepEqual(tools, ['read', 'glob', 'grep']);
  });

  test('detects permission: block → hasPermission true', () => {
    const content = `---
description: Commander
mode: primary
permission:
  edit: deny
  task: allow
---
Route everything.`;
    const { hasPermission, tools, meta } = parseFrontmatter(content);
    assert.equal(hasPermission, true);
    assert.deepEqual(tools, []);
    assert.equal(meta.description, 'Commander');
  });

  test('permission: and clause_tools: coexist correctly', () => {
    const content = `---
mode: subagent
permission:
  bash: deny
clause_tools:
  - read
---
Body.`;
    const { hasPermission, tools } = parseFrontmatter(content);
    assert.equal(hasPermission, true);
    assert.deepEqual(tools, ['read']);
  });

  test('returns empty meta and body when no frontmatter delimiter', () => {
    const content = 'Just a plain body with no frontmatter.';
    const { meta, tools, hasPermission, body } = parseFrontmatter(content);
    assert.deepEqual(meta, {});
    assert.deepEqual(tools, []);
    assert.equal(hasPermission, false);
    assert.equal(body, content);
  });

  test('handles CRLF line endings', () => {
    const content = '---\r\nmodel: mymodel\r\nmode: subagent\r\n---\r\nCRLF body.';
    const { meta, body } = parseFrontmatter(content);
    assert.equal(meta.model, 'mymodel');
    assert.equal(body, 'CRLF body.');
  });

  test('OpenCode tools: object format does NOT set our tools array', () => {
    // OpenCode uses tools: as an object — we only read clause_tools:
    const content = `---
model: x
tools:
  read: allow
  bash: deny
---
Body.`;
    const { tools, hasPermission } = parseFrontmatter(content);
    // tools: is not clause_tools: so our array stays empty
    assert.deepEqual(tools, []);
    assert.equal(hasPermission, false);
  });

  test('body is trimmed of leading/trailing whitespace', () => {
    const content = `---
mode: subagent
---

  Indented body with extra lines.

`;
    const { body } = parseFrontmatter(content);
    assert.equal(body, 'Indented body with extra lines.');
  });

  test('empty body produces empty string', () => {
    const content = `---
model: x
---
`;
    const { body } = parseFrontmatter(content);
    assert.equal(body, '');
  });
});

// ─── patchContent ─────────────────────────────────────────────────────────────

describe('patchContent', () => {

  const BASE = `---
model: old-model
mode: subagent
description: Test agent
---
Original body here.
`;

  test('patches existing model line', () => {
    const result = patchContent(BASE, 'new-model', undefined, undefined);
    assert.ok(result.includes('model: new-model'));
    assert.ok(!result.includes('old-model'));
    assert.ok(result.includes('Original body here.'));
  });

  test('adds model when not in frontmatter', () => {
    const content = `---
mode: subagent
---
Body.
`;
    const result = patchContent(content, 'added-model', undefined, undefined);
    assert.ok(result.includes('model: added-model'));
  });

  test('undefined model leaves model line unchanged', () => {
    const result = patchContent(BASE, undefined, undefined, undefined);
    assert.ok(result.includes('model: old-model'));
  });

  test('patches system prompt (body)', () => {
    const result = patchContent(BASE, undefined, 'New system prompt.', undefined);
    assert.ok(result.includes('New system prompt.'));
    assert.ok(!result.includes('Original body here.'));
  });

  test('undefined system prompt leaves body unchanged', () => {
    const result = patchContent(BASE, undefined, undefined, undefined);
    assert.ok(result.includes('Original body here.'));
  });

  test('adds clause_tools block when tools provided', () => {
    const result = patchContent(BASE, undefined, undefined, ['read', 'glob']);
    assert.ok(result.includes('clause_tools:'));
    assert.ok(result.includes('  - read'));
    assert.ok(result.includes('  - glob'));
  });

  test('removes clause_tools block when tools is empty array', () => {
    const withTools = `---
model: x
clause_tools:
  - read
  - grep
---
Body.
`;
    const result = patchContent(withTools, undefined, undefined, []);
    assert.ok(!result.includes('clause_tools:'));
    assert.ok(!result.includes('- read'));
    assert.ok(result.includes('Body.'));
  });

  test('replaces existing clause_tools block', () => {
    const withTools = `---
model: x
clause_tools:
  - bash
---
Body.
`;
    const result = patchContent(withTools, undefined, undefined, ['read', 'grep']);
    assert.ok(result.includes('  - read'));
    assert.ok(result.includes('  - grep'));
    assert.ok(!result.includes('  - bash'));
    assert.equal((result.match(/clause_tools:/g) || []).length, 1);
  });

  test('permission: block is preserved when adding clause_tools', () => {
    const withPerm = `---
mode: primary
permission:
  edit: deny
  task: allow
---
Commander body.
`;
    const result = patchContent(withPerm, undefined, undefined, ['read']);
    assert.ok(result.includes('permission:'));
    assert.ok(result.includes('  edit: deny'));
    assert.ok(result.includes('  task: allow'));
    assert.ok(result.includes('clause_tools:'));
  });

  test('permission: block is preserved when patching model', () => {
    const withPerm = `---
model: old
permission:
  edit: deny
---
Body.
`;
    const result = patchContent(withPerm, 'new-model', undefined, undefined);
    assert.ok(result.includes('model: new-model'));
    assert.ok(result.includes('permission:'));
    assert.ok(result.includes('  edit: deny'));
  });

  test('undefined tools leaves existing clause_tools unchanged', () => {
    const withTools = `---
model: x
clause_tools:
  - read
---
Body.
`;
    const result = patchContent(withTools, undefined, undefined, undefined);
    assert.ok(result.includes('clause_tools:'));
    assert.ok(result.includes('  - read'));
  });

  test('no frontmatter returns content unchanged', () => {
    const bare = 'No frontmatter here at all.';
    assert.equal(patchContent(bare, 'model', 'prompt', ['read']), bare);
  });
});
