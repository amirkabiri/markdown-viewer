// Unit tests for src/lib/ai/chunk.ts — ported from legacy/test/ai-chunk.test.ts.
// The module is dependency-free, so the legacy browser-global stubbing is gone.

import { describe, expect, it } from 'vitest';
import normalizeStreamChunk from './chunk';

describe('normalizeStreamChunk', () => {
  it('passes delta chunks through', () => {
    expect(normalizeStreamChunk('Hello', ' world')).toBe(' world');
  });

  it('collapses cumulative builds by slicing off prev', () => {
    expect(normalizeStreamChunk('Hello', 'Hello world')).toBe(' world');
    expect(normalizeStreamChunk('abc', 'abc')).toBe('');
  });

  it('treats an empty/undefined prev as pure passthrough', () => {
    expect(normalizeStreamChunk('', 'Hello')).toBe('Hello');
    expect(normalizeStreamChunk(undefined, 'Hello')).toBe('Hello');
  });

  it('returns an empty append for empty chunks', () => {
    expect(normalizeStreamChunk('Hello', '')).toBe('');
    expect(normalizeStreamChunk('', '')).toBe('');
  });

  it('passes a non-prefix rewrite through untouched', () => {
    expect(normalizeStreamChunk('Hello', 'Help')).toBe('Help');
  });

  it('rebuilds full text from a cumulative multi-chunk sequence', () => {
    const cumulative = [
      '# Title',
      '# Title\n\nSome ',
      '# Title\n\nSome text',
      '# Title\n\nSome text\n\n```mermaid\nflowchart LR\n  A["برچسب"] --> B\n```',
    ];
    let out = '';
    let prev = '';
    cumulative.forEach((c) => {
      out += normalizeStreamChunk(prev, c);
      prev = c;
    });
    expect(out).toBe('# Title\n\nSome text\n\n```mermaid\nflowchart LR\n  A["برچسب"] --> B\n```');
  });

  it('rebuilds full text from a delta multi-chunk sequence', () => {
    const deltas = [
      '# Title',
      '\n\nSome ',
      'text',
      '\n\n```mermaid\ngraph TD\n  X["نود"] --> Y\n```',
    ];
    let out = '';
    let prev = '';
    deltas.forEach((c) => {
      const p = normalizeStreamChunk(prev, c);
      out += p;
      prev = c;
    });
    expect(out).toBe('# Title\n\nSome text\n\n```mermaid\ngraph TD\n  X["نود"] --> Y\n```');
  });

  it('is pure: arguments are not mutated', () => {
    const a = 'Hello';
    const b = 'Hello world';
    normalizeStreamChunk(a, b);
    expect(a).toBe('Hello');
    expect(b).toBe('Hello world');
  });
});
