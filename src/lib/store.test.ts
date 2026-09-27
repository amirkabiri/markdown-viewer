// Unit tests for src/lib/store.ts — the pure detectDir/slugify helpers are
// ported from legacy/test/state.test.ts (12 tests); the mv:* store ops,
// count math and preference defaults were untested in legacy and are covered
// here against an in-memory Storage fake (no browser globals required).

import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_BYTES,
  MV_KEY_PREFIX,
  countChars,
  countWords,
  createMvStore,
  defaultLang,
  defaultTheme,
  detectDir,
  enumOr,
  localeForLang,
  mvKey,
  slugify,
} from './store';
import makeStorage from '../test/fakes';

/* ---------------- detectDir (ported) ---------------- */

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

/* ---------------- slugify (ported) ---------------- */

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

/* ---------------- mv:* store ops ---------------- */

describe('mvKey', () => {
  it('namespaces logical keys under the mv: prefix', () => {
    expect(MV_KEY_PREFIX).toBe('mv:');
    expect(mvKey('ai')).toBe('mv:ai');
  });
});

describe('createMvStore', () => {
  it('roundtrips a value under the mv:-prefixed key', () => {
    const storage = makeStorage();
    const mv = createMvStore(storage);

    mv.set('recent', [{ name: 'Notes', url: 'https://x/n.md' }]);

    expect(JSON.parse(storage.getItem('mv:recent') as string)).toEqual([
      { name: 'Notes', url: 'https://x/n.md' },
    ]);
    expect(mv.get('recent', [])).toEqual([{ name: 'Notes', url: 'https://x/n.md' }]);
  });

  it('returns the fallback for a missing key', () => {
    const mv = createMvStore(makeStorage());
    expect(mv.get('lang', 'en')).toBe('en');
  });

  it('returns the fallback instead of throwing on corrupt JSON', () => {
    const storage = makeStorage();
    storage.setItem('mv:theme', '{not json');
    expect(createMvStore(storage).get('theme', 'light')).toBe('light');
  });

  it('removes the key when the value is null', () => {
    const storage = makeStorage();
    const mv = createMvStore(storage);
    mv.set('mode', 'split');

    mv.set('mode', null);

    expect(storage.getItem('mv:mode')).toBeNull();
    expect(mv.get('mode', 'split')).toBe('split');
  });
});

/* ---------------- count math ---------------- */

describe('countWords / countChars', () => {
  it('counts non-whitespace runs as words', () => {
    expect(countWords('Hello brave  new\nworld')).toBe(4);
    expect(countWords('   ')).toBe(0);
    expect(countWords('')).toBe(0);
  });

  it('counts UTF-16 code units as characters', () => {
    expect(countChars('سلام دنیا')).toBe(9);
    expect(countChars('a👍b')).toBe(4); // surrogate pair takes two
    expect(countChars('')).toBe(0);
  });
});

/* ---------------- validated preferences & defaults ---------------- */

describe('enumOr', () => {
  it('accepts only whitelisted values and falls back otherwise', () => {
    const allowed = ['auto', 'ltr', 'rtl'] as const;
    expect(enumOr('rtl', allowed, 'auto')).toBe('rtl');
    expect(enumOr('diagonal', allowed, 'auto')).toBe('auto');
    expect(enumOr(undefined, allowed, 'auto')).toBe('auto');
    expect(enumOr(42, allowed, 'ltr')).toBe('ltr');
  });
});

describe('localeForLang', () => {
  it('formats counts with fa-IR for Persian and en-US otherwise', () => {
    expect(localeForLang('fa')).toBe('fa-IR');
    expect(localeForLang('en')).toBe('en-US');
  });
});

describe('defaultLang / defaultTheme', () => {
  it('defaults the UI language to fa only for fa-prefixed navigator languages', () => {
    expect(defaultLang('fa-IR')).toBe('fa');
    expect(defaultLang('fa')).toBe('fa');
    expect(defaultLang('en-US')).toBe('en');
    expect(defaultLang('')).toBe('en');
    expect(defaultLang(undefined)).toBe('en');
  });

  it('defaults the theme to dark only when the OS prefers dark', () => {
    expect(defaultTheme(true)).toBe('dark');
    expect(defaultTheme(false)).toBe('light');
  });
});

describe('MAX_INPUT_BYTES', () => {
  it('keeps the frozen 10 MB document cap', () => {
    expect(MAX_INPUT_BYTES).toBe(10 * 1024 * 1024);
  });
});
