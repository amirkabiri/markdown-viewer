// Unit tests for src/ai.ts normalizeStreamChunk — ported from /tmp/ai-chunk-test.mjs.
// ai.ts → i18n.ts/state.ts touch browser globals at module-eval time; stub only
// what Node lacks (navigator exists in Node 24 — never assigned).

function stubGlobal(name: string, value: unknown): void {
  if (name in globalThis) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('self', globalThis); // ai.ts aliases `self` at module-eval time (browsers: self === globalThis)

const { normalizeStreamChunk } = await import('../src/ai.js');

import { describe, it, expect } from 'vitest';

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
    for (const c of cumulative) { out += normalizeStreamChunk(prev, c); prev = c; }
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
    for (const c of deltas) { const p = normalizeStreamChunk(prev, c); out += p; prev = c; }
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
