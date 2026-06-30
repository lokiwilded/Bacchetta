'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseChunks, cosine, bufToVec } = require('../routes/memory-db');

// ─── parseChunks ──────────────────────────────────────────────────────────────

describe('parseChunks', () => {

  test('splits on ## headers and extracts content', () => {
    const content = `## Key Facts
Stack is Node.js + React.

## Decisions Made
Chose SQLite for persistence.`;
    const chunks = parseChunks('/project/foo', content);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].section, 'Key Facts');
    assert.ok(chunks[0].content.includes('Node.js'));
    assert.equal(chunks[1].section, 'Decisions Made');
    assert.ok(chunks[1].content.includes('SQLite'));
  });

  test('all chunks carry the dir', () => {
    const content = `## Key Facts\nSomething.`;
    const chunks = parseChunks('/my/project', content);
    assert.equal(chunks[0].dir, '/my/project');
  });

  test('generates stable IDs — same dir+section always same id', () => {
    const content = `## Key Facts\nContent.`;
    const a = parseChunks('/proj', content);
    const b = parseChunks('/proj', content);
    assert.equal(a[0].id, b[0].id);
  });

  test('different dirs produce different IDs for same section name', () => {
    const content = `## Key Facts\nContent.`;
    const a = parseChunks('/proj/a', content);
    const b = parseChunks('/proj/b', content);
    assert.notEqual(a[0].id, b[0].id);
  });

  test('skips sections with empty body', () => {
    const content = `## Empty Section

## Real Section
Some content here.`;
    const chunks = parseChunks('/p', content);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].section, 'Real Section');
  });

  test('returns empty array when no ## sections', () => {
    const chunks = parseChunks('/p', 'No headers here at all.');
    assert.deepEqual(chunks, []);
  });

  test('returns empty array for empty content', () => {
    assert.deepEqual(parseChunks('/p', ''), []);
  });

  test('id is 20 hex chars', () => {
    const chunks = parseChunks('/p', '## Section\nContent.');
    assert.match(chunks[0].id, /^[0-9a-f]{20}$/);
  });
});

// ─── cosine ───────────────────────────────────────────────────────────────────

describe('cosine', () => {

  test('identical vectors → similarity 1.0', () => {
    const v = [1, 2, 3];
    assert.ok(Math.abs(cosine(v, v) - 1.0) < 1e-6);
  });

  test('orthogonal vectors → similarity 0.0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    assert.ok(Math.abs(cosine(a, b)) < 1e-6);
  });

  test('opposite vectors → similarity -1.0', () => {
    const a = [1, 0];
    const b = [-1, 0];
    assert.ok(Math.abs(cosine(a, b) + 1.0) < 1e-6);
  });

  test('zero vector → no crash, returns 1 (guarded division)', () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    // || 1 guard prevents division by zero
    const result = cosine(a, b);
    assert.ok(isFinite(result));
  });

  test('similarity is between -1 and 1 for random vectors', () => {
    const a = [0.3, -0.5, 0.8, 0.1];
    const b = [0.7,  0.2, 0.4, -0.9];
    const s = cosine(a, b);
    assert.ok(s >= -1 && s <= 1);
  });
});

// ─── bufToVec ─────────────────────────────────────────────────────────────────

describe('bufToVec', () => {

  test('round-trips Float32Array through Buffer', () => {
    const original = [0.1, 0.5, -0.3, 0.9, 1.0];
    const buf = Buffer.from(new Float32Array(original).buffer);
    const result = bufToVec(buf);
    assert.equal(result.length, original.length);
    for (let i = 0; i < original.length; i++) {
      // Float32 has ~7 significant digits
      assert.ok(Math.abs(result[i] - original[i]) < 1e-6, `index ${i}: got ${result[i]}, expected ${original[i]}`);
    }
  });

  test('empty buffer → empty array', () => {
    const buf = Buffer.from(new Float32Array([]).buffer);
    assert.deepEqual(bufToVec(buf), []);
  });

  test('output is a plain Array, not Float32Array', () => {
    const buf = Buffer.from(new Float32Array([1, 2]).buffer);
    const result = bufToVec(buf);
    assert.ok(Array.isArray(result));
  });

  test('cosine works on round-tripped vectors', () => {
    const v = [0.6, 0.8];
    const buf = Buffer.from(new Float32Array(v).buffer);
    const restored = bufToVec(buf);
    assert.ok(Math.abs(cosine(restored, restored) - 1.0) < 1e-5);
  });
});
