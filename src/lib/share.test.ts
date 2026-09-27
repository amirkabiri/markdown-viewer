// Unit tests for src/lib/share.ts — ported from legacy/test/share.test.ts
// (node roundtrips). The codec is import-side-effect-free, so no globals need
// stubbing: shareEncode takes the page base explicitly and the
// CompressionStream availability toggle reaches the module at call time via
// globalThis.

import {
  afterEach, describe, expect, it,
} from 'vitest';
import {
  SHARE_MAX_CHARS, SHARE_WARN_CHARS, shareDecode, shareEncode,
} from './share';

const BASE = 'https://example.github.io/markdown-viewer/';

const g = globalThis as unknown as Record<string, unknown>;
const HAS_CS_BEFORE = g.CompressionStream;
const HAS_DS_BEFORE = g.DecompressionStream;
const csAvailable = typeof HAS_CS_BEFORE !== 'undefined';

function forceNoCompressionStreams(): void {
  g.CompressionStream = undefined;
  g.DecompressionStream = undefined;
}

function restoreCompressionStreams(): void {
  if (HAS_CS_BEFORE) g.CompressionStream = HAS_CS_BEFORE;
  else delete g.CompressionStream;
  if (HAS_DS_BEFORE) g.DecompressionStream = HAS_DS_BEFORE;
  else delete g.DecompressionStream;
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
  it.each(cases)('roundtrips: %s', async (name, text) => {
    const enc = await shareEncode(text, BASE);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    expect(enc.url.startsWith(`${BASE}#d=`)).toBe(true);
    expect(enc.compressed).toBe(csAvailable);
    expect(enc.warn).toBe(enc.chars > SHARE_WARN_CHARS);
    const frag = enc.url.slice(enc.url.indexOf('#'));
    const payload = frag.slice(3);
    expect(payload.slice(0, 2)).toBe(enc.compressed ? 'D.' : 'R.');
    const decFrag = await shareDecode(frag);
    expect(decFrag, `${name}: decode fragment`).not.toBeNull();
    expect(decFrag?.text).toBe(text);
    expect(decFrag?.compressed).toBe(enc.compressed);
    const decBare = await shareDecode(`d=${payload}`);
    expect(decBare?.text).toBe(text);
    const decRaw = await shareDecode(payload);
    expect(decRaw?.text).toBe(text);
  });
});

/* ---------- 2. both prefixes + flag correctness ---------- */

describe('prefix handling', () => {
  const short = 'Both prefixes must work forever.\n— هر دو پیشوند.\n';

  it('uses the deflate path (D.) when CompressionStream is available', async () => {
    const encD = await shareEncode(short, BASE);
    if (!encD.ok) throw new Error('encode should succeed');
    expect(encD.url.includes('#d=D.')).toBe(csAvailable);
    expect(encD.compressed).toBe(csAvailable);
  });

  it('uses the raw path (R.) without CompressionStream and roundtrips', async () => {
    forceNoCompressionStreams();
    try {
      const encR = await shareEncode(short, BASE);
      if (!encR.ok) throw new Error('encode should succeed');
      expect(encR.compressed).toBe(false);
      expect(encR.url.includes('#d=R.')).toBe(true);
      const decR = await shareDecode(encR.url.slice(encR.url.indexOf('#')));
      expect(decR).toEqual({ text: short, compressed: false });
    } finally {
      restoreCompressionStreams();
    }
  });

  it('refuses a D. payload with null when only DecompressionStream is missing', async () => {
    const encD = await shareEncode(short, BASE);
    if (!encD.ok) throw new Error('encode should succeed');
    const dPayload = encD.url.slice(encD.url.indexOf('#') + 3);
    g.DecompressionStream = undefined;
    await expect(shareDecode(`d=${dPayload}`)).resolves.toBeNull();
  });

  it('decodes an R. payload even while CompressionStream is available', async () => {
    if (!csAvailable) return;
    forceNoCompressionStreams();
    const encR = await shareEncode(short, BASE);
    restoreCompressionStreams();
    if (!encR.ok) throw new Error('encode should succeed');
    const decR2 = await shareDecode(`d=${encR.url.slice(encR.url.indexOf('#') + 3)}`);
    expect(decR2).toEqual({ text: short, compressed: false });
  });

  it('roundtrips an empty document through the raw (R.) payload', async () => {
    forceNoCompressionStreams();
    try {
      const encEmpty = await shareEncode('', BASE);
      expect(encEmpty.ok && encEmpty.url.endsWith('#d=R.')).toBe(true);
      await expect(shareDecode('d=R.')).resolves.toEqual({ text: '', compressed: false });
    } finally {
      restoreCompressionStreams();
    }
  });
});

/* ---------- 3. malformed input -> null, never throws ---------- */

describe('decode rejections', () => {
  const bad: unknown[] = [
    '', '#', '#d', '#d=', 'd=', 'D.', // empty / empty body ('R.' alone is valid)
    'X.abc', 'x=D.abc', '#x=D.abc', 'Zm9v', // unknown prefix / no prefix
    '#d=D.!!!!', 'd=D.%%%%', 'D.@#$%', // garbage base64
    `D.${btoa('random-not-deflate-data')}`, // valid b64, corrupt deflate
    `R.${btoa(String.fromCharCode(0xff, 0xfe, 0xc0, 0x80))}`, // invalid UTF-8
    'https://example.com/x#d=D.abc', // full URL whose payload is garbage
    null, undefined, 42, {}, // non-strings
  ];

  it(`returns null (never throws) for ${bad.length} malformed/non-string inputs`, async () => {
    const threw = await Promise.all(bad.map(async (input) => {
      try {
        const out = await shareDecode(input);
        expect(out, `null for ${JSON.stringify(String(input)).slice(0, 30)}`).toBeNull();
        return false;
      } catch {
        return true;
      }
    }));
    expect(threw).not.toContain(true);
  });

  it('decodes a full URL when the embedded payload is valid', async () => {
    const enc = await shareEncode('# From a full URL\n', BASE);
    if (!enc.ok) throw new Error('encode should succeed');
    await expect(shareDecode(enc.url)).resolves.toEqual({ text: '# From a full URL\n', compressed: enc.compressed });
  });
});

/* ---------- 4. capacity smoke ---------- */

describe('capacity smoke (text chars -> url chars must stay < 4500)', () => {
  const exactLen = (s: string, n: number): string => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const asciiDoc = exactLen('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod. ', 3000);
  const faSentence = 'این متنِ نمونهٔ فارسی برای سنجش نسبت فشرده‌سازی نشانی هم‌رسانی است. ';
  const faDoc = exactLen(`${faSentence}پاراگراف دوم با کلمات گوناگون: آب‌وهوا، کتاب‌خانه، هم‌رسانی.\n`, 1500);

  it.each([['3000-char ASCII', asciiDoc], ['1500-char Persian', faDoc]] as [string, string][])(
    'stays under the capacity budget: %s',
    async (name, text) => {
      const enc = await shareEncode(text, BASE);
      if (!enc.ok) throw new Error(`${name}: encode should succeed`);
      expect(enc.chars, `${name}: ${enc.chars} < 4500`).toBeLessThan(4500);
      const dec = await shareDecode(enc.url.slice(enc.url.indexOf('#')));
      expect(dec?.text).toBe(text);
    },
  );
});

/* ---------- 5. too-large ---------- */

describe('too-large refusal', () => {
  it('refuses 400KB of incompressible text without hanging', async () => {
    const parts: string[] = [];
    for (let i = 0; i < 400000; i += 1) {
      parts.push(String.fromCharCode(33 + Math.floor(Math.random() * 223)));
    }
    const big = parts.join(''); // true-random-ish bytes: incompressible
    const t0 = Date.now();
    const encBig = await shareEncode(big, BASE);
    const ms = Date.now() - t0;
    expect(encBig.ok).toBe(false);
    if (encBig.ok) return;
    expect(encBig.reason).toBe('too-large');
    expect(encBig.chars).toBeGreaterThan(SHARE_MAX_CHARS);
    expect(ms).toBeLessThan(2000);
  });
});
