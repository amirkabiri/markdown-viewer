// Unit tests for src/ai/edits.ts — computeEdit (pure editor-edit planner) and
// buildSelectionMessages (pure selection-aware chat prompt builder) — plus the
// additive `directEdit` settings field. Node environment: edits.ts imports
// state.ts/i18n.ts (browser globals at module-eval time) and
// providers/builtin.ts (`self`), so stub only what Node lacks, then import
// dynamically (same pattern as test/ai-providers.test.ts).

import { describe, expect, it } from 'vitest';

function stubIfAbsent(name: string, value: unknown): void {
  if (name in globalThis) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}
stubIfAbsent('matchMedia', () => ({ matches: false }));
stubIfAbsent('localStorage', makeStorage());
stubIfAbsent('self', globalThis); // ai/edits → ai/providers/builtin → ambient aliases `self`

const { computeEdit, buildSelectionMessages } = await import('../src/ai/edits.js');
const { normalizeSettings, loadSettings, saveSettings } = await import('../src/ai/settings.js');

const snap = (value: string, selectionStart: number, selectionEnd: number) =>
  ({ value, selectionStart, selectionEnd });

/* ---------------- computeEdit ---------------- */

describe('computeEdit — cursor (insert at selectionStart)', () => {
  it('inserts at an empty selection and parks the caret at the insertion end', () => {
    expect(computeEdit(snap('Hello world', 5, 5), ' brave', 'cursor'))
      .toEqual({ value: 'Hello brave world', selectionStart: 11, selectionEnd: 11 });
  });

  it('inserts at selectionStart of a RANGED selection without touching the range', () => {
    expect(computeEdit(snap('Hello world', 0, 5), '>>', 'cursor'))
      .toEqual({ value: '>>Hello world', selectionStart: 2, selectionEnd: 2 });
  });

  it('empty text is a no-op that still reports the caret', () => {
    expect(computeEdit(snap('Hello world', 5, 5), '', 'cursor'))
      .toEqual({ value: 'Hello world', selectionStart: 5, selectionEnd: 5 });
  });
});

describe('computeEdit — replace-selection', () => {
  it('replaces a ranged selection and parks the caret after the new text', () => {
    expect(computeEdit(snap('Hello world', 0, 5), 'Howdy', 'replace-selection'))
      .toEqual({ value: 'Howdy world', selectionStart: 5, selectionEnd: 5 });
  });

  it('replaces a mid-document range', () => {
    expect(computeEdit(snap('one two three', 4, 7), '2', 'replace-selection'))
      .toEqual({ value: 'one 2 three', selectionStart: 5, selectionEnd: 5 });
  });

  it('collapses an empty selection into a plain insert', () => {
    expect(computeEdit(snap('Hello world', 5, 5), ' brave', 'replace-selection'))
      .toEqual({ value: 'Hello brave world', selectionStart: 11, selectionEnd: 11 });
  });

  it('empty text deletes the selection (caret at range start)', () => {
    expect(computeEdit(snap('Hello world', 5, 11), '', 'replace-selection'))
      .toEqual({ value: 'Hello', selectionStart: 5, selectionEnd: 5 });
  });

  it('normalizes a reversed or out-of-bounds selection', () => {
    // reversed: start > end → [2, 8) = 'e two '
    expect(computeEdit(snap('one two three', 8, 2), '2', 'replace-selection').value).toBe('on2three');
    // clamped beyond the end: [1, 99) → [1, 3), 'bc' is consumed
    expect(computeEdit(snap('abc', 1, 99), 'X', 'replace-selection').value).toBe('aX');
    expect(computeEdit(snap('abc', -5, 2), 'X', 'replace-selection').value).toBe('Xc');
  });
});

describe('computeEdit — append', () => {
  it('inserts at value.length and parks the caret at the new end', () => {
    expect(computeEdit(snap('# Title', 4, 4), '\n\nBody text', 'append'))
      .toEqual({ value: '# Title\n\nBody text', selectionStart: 18, selectionEnd: 18 });
  });

  it('append on an empty document produces just the text', () => {
    expect(computeEdit(snap('', 0, 0), '# Hello\n', 'append'))
      .toEqual({ value: '# Hello\n', selectionStart: 8, selectionEnd: 8 });
  });

  it('empty text on an empty document stays empty', () => {
    expect(computeEdit(snap('', 0, 0), '', 'append'))
      .toEqual({ value: '', selectionStart: 0, selectionEnd: 0 });
  });
});

describe('computeEdit — replace-document', () => {
  it('replaces everything and parks the caret at the end', () => {
    expect(computeEdit(snap('old\ndocument', 3, 5), '# New', 'replace-document'))
      .toEqual({ value: '# New', selectionStart: 5, selectionEnd: 5 });
  });

  it('empty text clears the document', () => {
    expect(computeEdit(snap('content', 0, 7), '', 'replace-document'))
      .toEqual({ value: '', selectionStart: 0, selectionEnd: 0 });
  });
});

describe('computeEdit — unicode / Persian (UTF-16 index math, as in textareas)', () => {
  it('inserts Persian text into a Persian document', () => {
    // 'متن' = 3 chars; insert at the caret after it
    expect(computeEdit(snap('متن فارسی', 3, 3), ' خوب', 'cursor'))
      .toEqual({ value: 'متن خوب فارسی', selectionStart: 7, selectionEnd: 7 });
  });

  it('replaces a Persian selection with English text', () => {
    expect(computeEdit(snap('سلام دنیا', 0, 4), 'Hello', 'replace-selection'))
      .toEqual({ value: 'Hello دنیا', selectionStart: 5, selectionEnd: 5 });
  });

  it('offsets count UTF-16 code units (surrogate pairs take two)', () => {
    // 'a' (1) + '👍' (2) + 'b' (1) = length 4
    expect(computeEdit(snap('a👍b', 1, 1), '-', 'cursor').value).toBe('a-👍b');
    expect(computeEdit(snap('a👍b', 1, 3), 'X', 'replace-selection').value).toBe('aXb');
  });
});

/* ---------------- buildSelectionMessages ---------------- */

describe('buildSelectionMessages', () => {
  it('returns a system + user pair carrying the selection directive', () => {
    const msgs = buildSelectionMessages('make this formal', 'Draft text.', 'Draft text.');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Apply their instruction to that selection');
    expect(msgs[0].content).toContain('Return ONLY the edited selection as Markdown');
    expect(msgs[0].content).toContain('Markdown assistant'); // restates the builtin rules
    expect(msgs[1].role).toBe('user');
  });

  it('orders the user message as instruction → selection → labelled context', () => {
    const msgs = buildSelectionMessages('translate to English', 'متن انتخاب', '# سرصفحه\nمتن انتخاب\nپاورقی');
    const user = msgs[1].content;
    expect(user.indexOf('translate to English')).toBeGreaterThanOrEqual(0);
    expect(user.indexOf('translate to English'))
      .toBeLessThan(user.indexOf('<selection>\nمتن انتخاب\n</selection>'));
    expect(user.indexOf('<selection>')).toBeLessThan(user.indexOf('Surrounding document context'));
    expect(user.indexOf('Surrounding document context')).toBeLessThan(user.indexOf('<document>'));
    expect(user).toContain('<document>\n# سرصفحه\nمتن انتخاب\nپاورقی\n</document>');
  });

  it('clips a huge document context (head + tail + marker) but never the selection itself', () => {
    const selection = 'ب'.repeat(15000); // bigger than the context cap — must survive verbatim
    const doc = 'HEAD_MARKER' + 'x'.repeat(20000) + 'TAIL_MARKER';
    const msgs = buildSelectionMessages('add an example', selection, doc);
    const user = msgs[1].content;
    expect(user).toContain(selection); // edit target round-trips unclipped
    expect(user).toContain('HEAD_MARKER'); // head of the context preserved
    expect(user).toContain('TAIL_MARKER'); // tail of the context preserved
    expect(user).toContain('[…]'); // elision marker between head and tail
    // bounded: selection + ~12k context + framing
    expect(user.length).toBeLessThan(selection.length + 13000);
  });

  it('guards an empty/whitespace selection back to plain whole-document chat', () => {
    expect(buildSelectionMessages('what is this about?', '', '# doc')).toEqual([
      { role: 'user', content: 'what is this about?' },
    ]);
    expect(buildSelectionMessages('what is this about?', '   \n\t', '# doc')).toEqual([
      { role: 'user', content: 'what is this about?' },
    ]);
  });
});

/* ---------------- directEdit settings field (additive) ---------------- */

describe('directEdit settings field', () => {
  it('defaults to off (key absent) and repairs wrong types to absent/off', () => {
    expect(normalizeSettings({}).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: false }).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: 'yes' }).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: 1 }).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: null }).directEdit).toBeUndefined();
  });

  it('keeps an explicit true and roundtrips it through mv:ai', () => {
    saveSettings({ provider: 'openai', baseUrl: 'https://x/v1', apiKey: '', model: 'm', directEdit: true });
    expect(loadSettings().directEdit).toBe(true);

    saveSettings({ provider: 'openai', baseUrl: 'https://x/v1', apiKey: '', model: 'm' });
    expect(loadSettings().directEdit).toBeUndefined(); // toggled back off → absent = false
  });
});
