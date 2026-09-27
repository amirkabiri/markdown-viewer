// Unit tests for src/share.ts — ported from /tmp/share-tests.mjs (node roundtrips).
// share.ts → i18n.ts → state.ts touch browser globals at module-eval time; stub
// only what Node lacks (navigator exists in Node 24 — never assigned).

function stubGlobal(name: string, value: unknown): void {
  if (name in globalThis) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { origin: 'https://example.github.io', pathname: '/markdown-viewer/' });

const { shareEncode, shareDecode, SHARE_WARN_CHARS, SHARE_MAX_CHARS } = await import('../src/share.js');

import { describe, it, expect, afterEach } from 'vitest';

const g = globalThis as unknown as Record<string, unknown>;
const HAS_CS_BEFORE = g.CompressionStream;
const HAS_DS_BEFORE = g.DecompressionStream;
const csAvailable = typeof HAS_CS_BEFORE !== 'undefined';

function forceNoCompressionStreams(): void {
  g.CompressionStream = undefined;
  g.DecompressionStream = undefined;
}

function restoreCompressionStreams(): void {
  if (HAS_CS_BEFORE) g.CompressionStream = HAS_CS_BEFORE; else delete g.CompressionStream;
  if (HAS_DS_BEFORE) g.DecompressionStream = HAS_DS_BEFORE; else delete g.DecompressionStream;
}

afterEach(restoreCompressionStreams);

const faText = '# سند آزمایشی\n\nاین یک «متنِ» فارسی است با ایموجی 🎉🚀 و نیم‌فاصله‌ها:\n\n'
  + '```mermaid\ngraph TD\n  A[شروع] --> B{پایان؟}\n  B -- بله --> C["✅ تمام"]\n```\n\n'
  + 'خطِ دوم با > و & و "نقل قول" — تمام.\n\n';
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

/* ---------- 0. export surface ---------- */

describe('export surface', () => {
  it('exposes the contract constants', () => {
    expect(SHARE_WARN_CHARS).toBe(30000);
    expect(SHARE_MAX_CHARS).toBe(300000);
    expect(typeof shareEncode).toBe('function');
    expect(typeof shareDecode).toBe('function');
  });
});

/* ---------- 1. roundtrips (deflate path when CompressionStream exists) ---------- */

const cases: [string, string][] = [
  ['short English', '# Hello\n\nA *short* doc with `code`, <html> & "quotes".\n'],
  ['long Persian + emoji + mermaid fence', faText.repeat(40)],
  ['empty string', ''],
  ['BOM-prefixed', '﻿# BOM doc\nمحتوا\n'],
  ['100KB lorem', lorem.repeat(700)],
];

describe('encode/decode roundtrips', () => {
  for (const [name, text] of cases) {
    it(`roundtrips: ${name}`, async () => {
      const enc = await shareEncode(text);
      expect(enc.ok).toBe(true);
      if (!enc.ok) return;
      expect(enc.url.startsWith('https://example.github.io/markdown-viewer/#d=')).toBe(true);
      expect(enc.compressed).toBe(csAvailable);
      expect(enc.warn).toBe(enc.chars > SHARE_WARN_CHARS);
      const frag = enc.url.slice(enc.url.indexOf('#'));
      const payload = frag.slice(3);
      expect(payload.slice(0, 2)).toBe(enc.compressed ? 'D.' : 'R.');
      for (const [form, input] of [['fragment', frag], ['bare', 'd=' + payload], ['raw payload', payload]] as const) {
        const dec = await shareDecode(input);
        expect(dec, `${name}: decode ${form}`).not.toBeNull();
        expect(dec!.text).toBe(text);
        expect(dec!.compressed).toBe(enc.compressed);
      }
    });
  }
});

/* ---------- 2. both prefixes + flag correctness ---------- */

describe('prefix handling', () => {
  const short = 'Both prefixes must work forever.\n— هر دو پیشوند.\n';

  it('uses the deflate path (D.) when CompressionStream is available', async () => {
    const encD = await shareEncode(short);
    if (!encD.ok) throw new Error('encode should succeed');
    expect(encD.url.includes('#d=D.')).toBe(csAvailable);
    expect(encD.compressed).toBe(csAvailable);
  });

  it('uses the raw path (R.) without CompressionStream and roundtrips', async () => {
    forceNoCompressionStreams();
    const encR = await shareEncode(short);
    if (!encR.ok) throw new Error('encode should succeed');
    expect(encR.compressed).toBe(false);
    expect(encR.url.includes('#d=R.')).toBe(true);
    const decR = await shareDecode(encR.url.slice(encR.url.indexOf('#')));
    expect(decR).toEqual({ text: short, compressed: false });
  });

  it('refuses a D. payload with null when only DecompressionStream is missing', async () => {
    const encD = await shareEncode(short);
    if (!encD.ok) throw new Error('encode should succeed');
    const dPayload = encD.url.slice(encD.url.indexOf('#') + 3);
    g.DecompressionStream = undefined;
    await expect(shareDecode('d=' + dPayload)).resolves.toBeNull();
  });

  it('decodes an R. payload even while CompressionStream is available', async () => {
    if (!csAvailable) return;
    forceNoCompressionStreams();
    const encR = await shareEncode(short);
    restoreCompressionStreams();
    if (!encR.ok) throw new Error('encode should succeed');
    const decR2 = await shareDecode('d=' + encR.url.slice(encR.url.indexOf('#') + 3));
    expect(decR2).toEqual({ text: short, compressed: false });
  });

  it('roundtrips an empty document through the raw (R.) payload', async () => {
    forceNoCompressionStreams();
    const encEmpty = await shareEncode('');
    expect(encEmpty.ok && encEmpty.url.endsWith('#d=R.')).toBe(true);
    await expect(shareDecode('d=R.')).resolves.toEqual({ text: '', compressed: false });
  });
});

/* ---------- 3. malformed input -> null, never throws ---------- */

describe('decode rejections', () => {
  const bad: unknown[] = [
    '', '#', '#d', '#d=', 'd=', 'D.', // empty / empty body ('R.' alone is valid)
    'X.abc', 'x=D.abc', '#x=D.abc', 'Zm9v', // unknown prefix / no prefix
    '#d=D.!!!!', 'd=D.%%%%', 'D.@#$%', // garbage base64
    'D.' + btoa('random-not-deflate-data'), // valid b64, corrupt deflate
    'R.' + btoa(String.fromCharCode(0xff, 0xfe, 0xc0, 0x80)), // invalid UTF-8
    'https://example.com/x#d=D.abc', // full URL unsupported
    null, undefined, 42, {}, // non-strings
  ];

  it(`returns null (never throws) for ${bad.length} malformed/non-string inputs`, async () => {
    for (const input of bad) {
      let out: unknown;
      let threw = false;
      try { out = await shareDecode(input); } catch { threw = true; }
      expect(threw, `no throw for ${JSON.stringify(String(input)).slice(0, 30)}`).toBe(false);
      expect(out, `null for ${JSON.stringify(String(input)).slice(0, 30)}`).toBeNull();
    }
  });
});

/* ---------- 4. capacity smoke ---------- */

describe('capacity smoke (text chars -> url chars must stay < 4500)', () => {
  const exactLen = (s: string, n: number): string => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const asciiDoc = exactLen('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. ', 3000);
  const faSentence = 'این متنِ نمونهٔ فارسی برای سنجش نسبت فشرده‌سازی نشانی هم‌رسانی است. ';
  const faDoc = exactLen(faSentence + 'پاراگراف دوم با کلمات گوناگون: آب‌وهوا، کتاب‌خانه، هم‌رسانی.\n', 1500);

  for (const mode of ['deflate', 'raw'] as const) {
    it(`capacity (${mode})`, async () => {
      if (mode === 'raw') forceNoCompressionStreams();
      try {
        for (const [name, text] of [['3000-char ASCII', asciiDoc], ['1500-char Persian', faDoc]] as const) {
          const enc = await shareEncode(text);
          if (!enc.ok) throw new Error(`${name}: encode should succeed`);
          expect(enc.chars, `${name}: ${enc.chars} < 4500`).toBeLessThan(4500);
          const dec = await shareDecode(enc.url.slice(enc.url.indexOf('#')));
          expect(dec!.text).toBe(text);
        }
      } finally {
        if (mode === 'raw') restoreCompressionStreams();
      }
    });
  }
});

/* ---------- 5. too-large ---------- */

describe('too-large refusal', () => {
  it('refuses 400KB of incompressible text without hanging', async () => {
    const parts: string[] = [];
    for (let i = 0; i < 400000; i++) parts.push(String.fromCharCode(33 + Math.floor(Math.random() * 223)));
    const big = parts.join(''); // true-random-ish bytes: incompressible
    const t0 = Date.now();
    const encBig = await shareEncode(big);
    const ms = Date.now() - t0;
    expect(encBig.ok).toBe(false);
    if (encBig.ok) return;
    expect(encBig.reason).toBe('too-large');
    expect(encBig.chars).toBeGreaterThan(SHARE_MAX_CHARS);
    expect(ms).toBeLessThan(2000);
  });
});
