'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, NUM_DEFAULTS, STR_DEFAULTS, validateAndMerge } = require('../routes/settings');

// ─── DEFAULTS shape ───────────────────────────────────────────────────────────

describe('DEFAULTS', () => {

  test('all numeric defaults are positive numbers', () => {
    for (const [k, v] of Object.entries(NUM_DEFAULTS)) {
      assert.ok(typeof v === 'number' && v > 0, `${k} should be a positive number, got ${v}`);
    }
  });

  test('all string defaults are strings', () => {
    for (const [k, v] of Object.entries(STR_DEFAULTS)) {
      assert.ok(typeof v === 'string', `${k} should be a string, got ${typeof v}`);
    }
  });

  test('DEFAULTS merges NUM and STR defaults', () => {
    for (const k of Object.keys(NUM_DEFAULTS)) assert.ok(k in DEFAULTS);
    for (const k of Object.keys(STR_DEFAULTS)) assert.ok(k in DEFAULTS);
  });

  test('expected numeric keys exist', () => {
    const expected = ['compact_after', 'rag_chunk_lines', 'rag_top_k', 'rag_max_file_kb',
      'cache_read_cap_chars', 'cache_bash_cap_chars', 'memory_idle_minutes', 'memory_top_k'];
    for (const k of expected) assert.ok(k in NUM_DEFAULTS, `missing key: ${k}`);
  });

  test('expected string keys exist', () => {
    const expected = ['memory_model', 'profile_model', 'memory_embed_model'];
    for (const k of expected) assert.ok(k in STR_DEFAULTS, `missing key: ${k}`);
  });
});

// ─── validateAndMerge ────────────────────────────────────────────────────────

describe('validateAndMerge', () => {

  test('accepts valid positive integer for numeric key', () => {
    const result = validateAndMerge({ compact_after: 20 }, { ...DEFAULTS });
    assert.equal(result.compact_after, 20);
  });

  test('accepts valid float for numeric key', () => {
    const result = validateAndMerge({ rag_chunk_lines: 30.5 }, { ...DEFAULTS });
    assert.equal(result.rag_chunk_lines, 30.5);
  });

  test('rejects 0 for numeric key (must be > 0)', () => {
    const result = validateAndMerge({ compact_after: 0 }, { ...DEFAULTS });
    assert.equal(result.compact_after, DEFAULTS.compact_after);
  });

  test('rejects negative for numeric key', () => {
    const result = validateAndMerge({ compact_after: -5 }, { ...DEFAULTS });
    assert.equal(result.compact_after, DEFAULTS.compact_after);
  });

  test('rejects Infinity for numeric key', () => {
    const result = validateAndMerge({ compact_after: Infinity }, { ...DEFAULTS });
    assert.equal(result.compact_after, DEFAULTS.compact_after);
  });

  test('rejects NaN for numeric key', () => {
    const result = validateAndMerge({ compact_after: NaN }, { ...DEFAULTS });
    assert.equal(result.compact_after, DEFAULTS.compact_after);
  });

  test('rejects string value for numeric key', () => {
    const result = validateAndMerge({ compact_after: '20' }, { ...DEFAULTS });
    assert.equal(result.compact_after, DEFAULTS.compact_after);
  });

  test('accepts string value for string key', () => {
    const result = validateAndMerge({ memory_model: 'qwen2.5:7b' }, { ...DEFAULTS });
    assert.equal(result.memory_model, 'qwen2.5:7b');
  });

  test('trims whitespace from string values', () => {
    const result = validateAndMerge({ memory_model: '  qwen2.5:7b  ' }, { ...DEFAULTS });
    assert.equal(result.memory_model, 'qwen2.5:7b');
  });

  test('accepts empty string for string key', () => {
    const current = { ...DEFAULTS, memory_model: 'old-model' };
    const result = validateAndMerge({ memory_model: '' }, current);
    assert.equal(result.memory_model, '');
  });

  test('rejects number value for string key', () => {
    const result = validateAndMerge({ memory_model: 42 }, { ...DEFAULTS });
    assert.equal(result.memory_model, DEFAULTS.memory_model);
  });

  test('ignores unknown keys entirely', () => {
    const current = { ...DEFAULTS };
    const result = validateAndMerge({ totally_unknown_key: 999, another: 'bad' }, current);
    assert.ok(!('totally_unknown_key' in result));
    assert.ok(!('another' in result));
  });

  test('merges partial update — only changed keys are modified', () => {
    const current = { ...DEFAULTS, compact_after: 15, memory_model: 'old' };
    const result = validateAndMerge({ compact_after: 25 }, current);
    assert.equal(result.compact_after, 25);
    assert.equal(result.memory_model, 'old');
  });

  test('multiple keys updated in one call', () => {
    const result = validateAndMerge(
      { compact_after: 8, rag_top_k: 5, memory_embed_model: 'bge-small' },
      { ...DEFAULTS },
    );
    assert.equal(result.compact_after, 8);
    assert.equal(result.rag_top_k, 5);
    assert.equal(result.memory_embed_model, 'bge-small');
  });

  test('does not mutate the input current object', () => {
    const current = { ...DEFAULTS };
    const before = current.compact_after;
    validateAndMerge({ compact_after: 99 }, current);
    assert.equal(current.compact_after, before);
  });
});
