// Unit tests for src/lib/ai/edits.ts — computeEdit (pure editor-edit planner)
// and buildSelectionMessages (pure selection-aware chat prompt builder),
// ported from legacy/test/ai-edits.test.ts (20 tests). The remaining 2 legacy
// tests (the additive directEdit settings field) live in settings.test.ts
// next to the settings module. Node environment needs no browser-global
// stubbing: edits.ts only touches the BUILTIN_SYSTEM_PROMPT constant.

import { describe, expect, it } from 'vitest';
import {
  buildSelectionMessages,
  computeEdit,
  planReplaceRange,
  planReplaceText,
} from './edits';
import type { EditorSnapshot } from './edits';

const snap = (value: string, selectionStart: number, selectionEnd: number): EditorSnapshot => ({
  value,
  selectionStart,
  selectionEnd,
});

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

/* ---------------- planReplaceText (v2 content-anchored replace) ---------------- */

describe('planReplaceText — exact match', () => {
  it('plans a single-span replacement with char offsets and line anchors', () => {
    const doc = '# Title\n\nold line\nkeep me\n';
    const plan = planReplaceText(doc, 'old line', 'new line');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.start).toBe(doc.indexOf('old line'));
    expect(plan.plan.end).toBe(plan.plan.start + 'old line'.length);
    expect(plan.plan.replacement).toBe('new line');
    expect(plan.plan.matchCount).toBe(1);
    expect(plan.plan.startLine).toBe(3);
    expect(plan.plan.endLine).toBe(3);
    // the plan splices into the document exactly
    expect(doc.slice(0, plan.plan.start) + plan.plan.replacement + doc.slice(plan.plan.end))
      .toBe('# Title\n\nnew line\nkeep me\n');
  });

  it('replaces across multiple lines in one span', () => {
    const doc = 'a\nb\nc\nd\n';
    const plan = planReplaceText(doc, 'b\nc', 'X');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.startLine).toBe(2);
    expect(plan.plan.endLine).toBe(3);
    expect(doc.slice(0, plan.plan.start) + plan.plan.replacement + doc.slice(plan.plan.end))
      .toBe('a\nX\nd\n');
  });

  it('reports the match count when the SEARCH text occurs twice (occurrence first)', () => {
    const doc = 'same\nmiddle\nsame\n';
    const plan = planReplaceText(doc, 'same', 'NEW', 'first');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.matchCount).toBe(2); // ambiguity surfaced, not hidden
    expect(doc.slice(plan.plan.start, plan.plan.end)).toBe('same');
    expect(plan.plan.start).toBe(0); // the FIRST occurrence is targeted
  });

  it('replaces every occurrence with occurrence all, as one span (single undo step)', () => {
    const doc = 'x foo y\nfoo\nend foo\n';
    const plan = planReplaceText(doc, 'foo', 'bar', 'all');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.matchCount).toBe(3);
    const next = doc.slice(0, plan.plan.start) + plan.plan.replacement + doc.slice(plan.plan.end);
    expect(next).toBe('x bar y\nbar\nend bar\n');
  });

  it('non-overlapping all-replacement never matches inside earlier replacements', () => {
    const doc = 'aaaa\n';
    const plan = planReplaceText(doc, 'aa', 'b', 'all');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.matchCount).toBe(2);
    expect(doc.slice(0, plan.plan.start) + plan.plan.replacement + doc.slice(plan.plan.end))
      .toBe('bb\n');
  });
});

describe('planReplaceText — whitespace-tolerant fallback', () => {
  it('matches when only whitespace drifted (spaces vs newline, indentation)', () => {
    const doc = 'function a() {\n    return 1;\n}\n';
    const plan = planReplaceText(doc, 'function a() {\n  return 1;\n}', 'REPLACED');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(doc.slice(plan.plan.start, plan.plan.end)).toBe('function a() {\n    return 1;\n}');
    expect(plan.plan.replacement).toBe('REPLACED');
  });

  it('keeps exact matching preferred: a whitespace-drifted match never wins over the exact one', () => {
    const doc = 'a  b\na b\n';
    const plan = planReplaceText(doc, 'a b', 'X');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.start).toBe(5); // exact second line, not the drifted first
  });
});

describe('planReplaceText — structured not-found error', () => {
  it('returns NOT_FOUND with the nearest lines carrying a fragment of the SEARCH text', () => {
    const doc = '# Intro\n\nThe quick brown fox\njumps over the lazy dog\n\nThe quick brown cat\n';
    const plan = planReplaceText(doc, 'The quick brown fox\ndid something else', 'X');
    expect(plan).toMatchObject({
      status: 'error',
      code: 'NOT_FOUND',
    });
    if (plan.status !== 'error') return;
    expect(plan.nearestLines).toContain(3); // the line sharing the first-line probe
    expect(plan.hint).toMatch(/read_document|re-read/i);
  });

  it('returns no anchors when nothing resembles the SEARCH text', () => {
    const plan = planReplaceText('# doc\n', 'zzzz absent', 'X');
    expect(plan).toEqual({
      status: 'error',
      code: 'NOT_FOUND',
      hint: expect.any(String),
      nearestLines: [],
    });
  });

  it('rejects an empty SEARCH block with its own code', () => {
    expect(planReplaceText('doc', '', 'X')).toMatchObject({ status: 'error', code: 'BAD_SEARCH' });
  });
});

/* ---------------- planReplaceRange (v2 line-range replace + staleness) ---------------- */

describe('planReplaceRange', () => {
  const basis = '# Title\n\nline three\nline four\nline five\n';

  it('plans a whole-line replacement with correct char offsets', () => {
    const plan = planReplaceRange(basis, basis, 3, 4, 'REPLACED');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(basis.slice(plan.plan.start, plan.plan.end)).toBe('line three\nline four\n');
    expect(basis.slice(0, plan.plan.start) + plan.plan.replacement + basis.slice(plan.plan.end))
      .toBe('# Title\n\nREPLACED\nline five\n');
  });

  it('appends a newline when the body would glue onto the following line', () => {
    const plan = planReplaceRange(basis, basis, 3, 4, 'REPLACED');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.plan.replacement).toBe('REPLACED\n');
  });

  it('replaces the final line, keeping the document newline-terminated (no stray additions)', () => {
    const plan = planReplaceRange(basis, basis, 5, 5, 'last');
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(basis.slice(0, plan.plan.start) + plan.plan.replacement + basis.slice(plan.plan.end))
      .toBe('# Title\n\nline three\nline four\nlast\n');
  });

  it('reports STALE_RANGE when the document changed since the last read', () => {
    const plan = planReplaceRange(`${basis}user typed\n`, basis, 3, 3, 'X');
    expect(plan).toMatchObject({ status: 'error', code: 'STALE_RANGE' });
    if (plan.status !== 'error') return;
    expect(plan.totalLines).toBe(6); // the CURRENT document's line count
  });

  it('reports BAD_RANGE for non-integer, zero, or inverted lines', () => {
    expect(planReplaceRange(basis, basis, 0, 2, 'X')).toMatchObject({ status: 'error', code: 'BAD_RANGE' });
    expect(planReplaceRange(basis, basis, 3, 2, 'X')).toMatchObject({ status: 'error', code: 'BAD_RANGE' });
    expect(planReplaceRange(basis, basis, 1.5, 2, 'X')).toMatchObject({ status: 'error', code: 'BAD_RANGE' });
    expect(planReplaceRange(basis, basis, 1, 99, 'X')).toMatchObject({ status: 'error', code: 'BAD_RANGE' });
  });
});

/* ---------------- buildSelectionMessages ---------------- */

describe('buildSelectionMessages', () => {
  it('returns a system + user pair carrying the selection directive', () => {
    const msgs = buildSelectionMessages('make this formal', 'Draft text.', 'Draft text.');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Apply their instruction to that selection');
    expect(msgs[0].content).toContain('return ONLY the edited selection as Markdown');
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
    const doc = `HEAD_MARKER${'x'.repeat(20000)}TAIL_MARKER`;
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
