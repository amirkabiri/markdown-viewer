// Unit tests for src/state.ts pure helpers (detectDir, slugify).
// state.ts touches browser globals at module-eval time; stub only what Node lacks
// (navigator exists in Node 24 — never assigned).

function stubGlobal(name: string, value: unknown): void {
  if (name in globalThis) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { detectDir, slugify } = await import('../src/state.js');

import { describe, it, expect } from 'vitest';

describe('detectDir', () => {
  it('returns rtl for Persian text', () => {
    expect(detectDir('سلام دنیا')).toBe('rtl');
  });

  it('returns ltr for English text', () => {
    expect(detectDir('Hello world')).toBe('ltr');
  });

  it('uses the first strong character for mixed text', () => {
    expect(detectDir('Hello — سلام')).toBe('ltr');
    expect(detectDir('سلام — Hello')).toBe('rtl');
  });

  it('skips weak characters (digits, punctuation, whitespace) before deciding', () => {
    expect(detectDir('   1234 — سلام')).toBe('rtl');
    expect(detectDir(' … "Hello" 12')).toBe('ltr');
  });

  it('defaults to ltr when there is no strong character', () => {
    expect(detectDir('')).toBe('ltr');
    expect(detectDir('1234 …?!')).toBe('ltr');
    expect(detectDir('🎉🚀')).toBe('ltr');
  });

  it('treats other RTL-range scripts as rtl', () => {
    expect(detectDir('שלום')).toBe('rtl'); // Hebrew range
  });
});

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('strips punctuation but keeps unicode letters', () => {
    expect(slugify('سلام، دنیا!')).toBe('سلام-دنیا');
    expect(slugify('Кириллица тоже')).toBe('кириллица-тоже');
  });

  it('keeps digits, hyphens and underscores', () => {
    expect(slugify('Top 10 tips')).toBe('top-10-tips');
    expect(slugify('keep-this_ID')).toBe('keep-this_id');
  });

  it('collapses whitespace runs into a single hyphen', () => {
    expect(slugify('  A \t B  ')).toBe('a-b');
  });

  it('removes punctuation anywhere in the heading', () => {
    expect(slugify('Head — with "quotes" & (more)')).toBe('head-with-quotes-more');
  });

  it('returns an empty string when nothing survives', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('🎉')).toBe('');
  });
});
