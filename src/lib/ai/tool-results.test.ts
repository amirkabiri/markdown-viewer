// Unit tests for src/lib/ai/tool-results.ts — the v2 tool services (numbered
// ranged reads, search, outline) and the structured TOOL RESULT payloads
// (errors as data: code + hint + nearest anchors). Node project: everything
// here is pure text-in/text-out, single-pass, and 10 MB-safe.

import { describe, expect, it } from 'vitest';
import {
  AUTO_APPLY_MAX_LINES,
  boundDiffLines,
  changedLineCount,
  documentOutline,
  formatDocumentRead,
  formatToolResult,
  readDocumentLines,
  searchDocument,
} from './tool-results';

const DOC = ['# Title', '', 'first body', 'second body', '', '## Section', 'tail'].join('\n');

/* ---------------- readDocumentLines (cat -n style) ---------------- */

describe('readDocumentLines', () => {
  it('returns a numbered window with the total and the clip flag', () => {
    const read = readDocumentLines(DOC, 1, 3);
    expect(read.totalLines).toBe(7);
    expect(read.startLine).toBe(1);
    expect(read.endLine).toBe(3);
    expect(read.clipped).toBe(true);
    expect(read.text).toBe('1  # Title\n2  \n3  first body');
  });

  it('defaults to the start and ~400 lines (whole small docs come back unclipped)', () => {
    const read = readDocumentLines(DOC);
    expect(read.startLine).toBe(1);
    expect(read.endLine).toBe(7);
    expect(read.clipped).toBe(false);
    expect(read.text).toContain('7  tail');
  });

  it('honors a mid-document offset and reports an empty window past the end', () => {
    expect(readDocumentLines(DOC, 6, 400).text).toBe('6  ## Section\n7  tail');
    const past = readDocumentLines(DOC, 99, 10);
    expect(past.startLine).toBe(99);
    expect(past.endLine).toBe(98); // empty window — nothing there
    expect(past.text).toBe('');
    expect(past.clipped).toBe(true); // and it is not the whole document
  });

  it('clamps a runaway limit to the hard cap (bounded response size)', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `l${i + 1}`).join('\n');
    const read = readDocumentLines(big, 1, 10 ** 6);
    expect(read.endLine - read.startLine + 1).toBeLessThanOrEqual(2000);
    expect(read.clipped).toBe(true);
  });

  it('is linear and fast enough for a 10 MB document (no quadratic structures)', () => {
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i + 1} text`).join('\n');
    const started = Date.now();
    const read = readDocumentLines(big, 19000, 400);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(read.startLine).toBe(19000);
    expect(read.text).toContain('19000  line 19000 text');
  });

  it('treats the empty document as zero lines', () => {
    expect(readDocumentLines('', 1, 400)).toMatchObject({ totalLines: 0, startLine: 1, endLine: 0, clipped: false });
  });
});

describe('formatDocumentRead', () => {
  it('carries totalLines and the clipped flag in the header', () => {
    const payload = formatDocumentRead(readDocumentLines(DOC, 1, 3));
    expect(payload).toContain('[document · 7 lines · showing 1-3 · clipped]');
    expect(payload).toContain('3  first body');
  });

  it('marks an unclipped full read as such', () => {
    const payload = formatDocumentRead(readDocumentLines(DOC));
    expect(payload).toContain('[document · 7 lines · showing 1-7]');
    expect(payload).not.toContain('clipped');
  });
});

/* ---------------- searchDocument ---------------- */

describe('searchDocument', () => {
  it('finds literal hits with line numbers and full line text', () => {
    const result = searchDocument(DOC, 'body');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.hits).toEqual([
      { line: 3, text: 'first body' },
      { line: 4, text: 'second body' },
    ]);
    expect(result.totalMatches).toBe(2);
    expect(result.totalLines).toBe(7);
  });

  it('caps results at maxResults but still counts the total', () => {
    const doc = 'hit\nhit\nhit\nhit\n';
    const result = searchDocument(doc, 'hit', { maxResults: 2 });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.hits.map((h) => h.line)).toEqual([1, 2]);
    expect(result.totalMatches).toBe(4);
  });

  it('treats the pattern literally by default (regex metacharacters stay literal)', () => {
    const result = searchDocument('a.c\nabc\n', 'a.c');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.hits.map((h) => h.line)).toEqual([1]);
  });

  it('enables regex only on request', () => {
    const result = searchDocument('a.c\nabc\n', 'a\\.c|abc', { regex: true });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.hits.map((h) => h.line)).toEqual([1, 2]);
  });

  it('returns a structured BAD_PATTERN error for an invalid regex', () => {
    const result = searchDocument(DOC, '([unclosed', { regex: true });
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.code).toBe('BAD_PATTERN');
    expect(result.hint).toMatch(/regex/i);
  });

  it('rejects an empty pattern with the same structured error', () => {
    expect(searchDocument(DOC, '')).toMatchObject({ status: 'error', code: 'BAD_PATTERN' });
  });

  it('truncates pathological single lines instead of returning megabytes', () => {
    const doc = `${'x'.repeat(50000)} needle\n`;
    const result = searchDocument(doc, 'needle');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.hits[0].text.length).toBeLessThanOrEqual(200);
  });

  it('is a single pass over a 10 MB document', () => {
    const big = Array.from({ length: 50000 }, (_, i) => `line ${i} ${i % 100 === 0 ? 'needle' : 'hay'}`).join('\n');
    const started = Date.now();
    const result = searchDocument(big, 'needle');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.status === 'ok' && result.totalMatches).toBe(500);
  });
});

/* ---------------- documentOutline ---------------- */

describe('documentOutline', () => {
  it('lists ATX headings with their line numbers and levels', () => {
    expect(documentOutline(DOC)).toEqual([
      { line: 1, level: 1, text: 'Title' },
      { line: 6, level: 2, text: 'Section' },
    ]);
  });

  it('ignores hash runs inside text and fenced code', () => {
    const doc = 'not # a heading\n\n```md\n# inside code\n```\n\n##  Real\n';
    expect(documentOutline(doc)).toEqual([{ line: 7, level: 2, text: 'Real' }]);
  });

  it('allows up to three leading spaces and trims closing hashes', () => {
    const doc = '   ### Heading ###\n';
    expect(documentOutline(doc)).toEqual([{ line: 1, level: 3, text: 'Heading' }]);
  });

  it('is a single pass (10 MB-safe)', () => {
    const big = `${'paragraph\n'.repeat(100000)}# End\n`;
    const started = Date.now();
    const entries = documentOutline(big);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(entries).toEqual([{ line: 100001, level: 1, text: 'End' }]);
  });
});

/* ---------------- pending-diff bounding + auto-apply budget ---------------- */

describe('boundDiffLines / changedLineCount', () => {
  it('splits text into lines without a phantom trailing empty line', () => {
    expect(boundDiffLines('a\nb\n')).toEqual({ lines: ['a', 'b'], hidden: 0 });
    expect(boundDiffLines('a\nb')).toEqual({ lines: ['a', 'b'], hidden: 0 });
    expect(boundDiffLines('')).toEqual({ lines: [], hidden: 0 });
  });

  it('collapses huge diffs with a hidden count instead of rendering them', () => {
    const text = Array.from({ length: 300 }, (_, i) => `l${i + 1}`).join('\n');
    const view = boundDiffLines(text);
    expect(view.lines).toHaveLength(100);
    expect(view.hidden).toBe(200);
    expect(view.lines[0]).toBe('l1');
    expect(view.lines[99]).toBe('l100'); // the HEAD is kept for context
  });

  it('counts changed lines as removed + added (the auto-apply budget unit)', () => {
    expect(changedLineCount('a\nb\n', 'x\n')).toBe(3);
    expect(changedLineCount('', 'one line\n')).toBe(1);
  });

  it('keeps the auto-apply budget small enough for one visible edit', () => {
    // A 10-line SEARCH/REPLACE is ~20 changed lines — exactly at the budget.
    expect(AUTO_APPLY_MAX_LINES).toBe(20);
  });
});

/* ---------------- formatToolResult (structured, retryable payloads) ---------------- */

describe('formatToolResult', () => {
  it('passes read payloads through', () => {
    const payload = formatToolResult({
      status: 'ok',
      message: formatDocumentRead(readDocumentLines(DOC, 1, 3)),
    });
    expect(payload).toContain('[document · 7 lines');
    expect(payload).toContain('3  first body');
  });

  it('formats a pending write with its diff summary and a no-retry note', () => {
    const payload = formatToolResult({
      status: 'pending',
      message: 'proposed at lines 3-4 (2 removed / 1 added)',
      diff: {
        tool: 'replace_text',
        startLine: 3,
        endLine: 4,
        startOffset: 10,
        endOffset: 30,
        removedText: 'a\nb\n',
        addedText: 'x\n',
      },
    });
    expect(payload).toContain('PENDING');
    expect(payload).toContain('lines 3-4');
    expect(payload).toMatch(/Apply or Discard/i);
  });

  it('formats applied and refused outcomes', () => {
    expect(formatToolResult({ status: 'applied', message: 'replaced lines 3-4' }))
      .toContain('APPLIED');
    const refused = formatToolResult({
      status: 'refused',
      code: 'READ_ONLY',
      message: 'write access is off',
      hint: 'include the text in your reply',
    });
    expect(refused).toContain('REFUSED');
    expect(refused).toContain('READ_ONLY');
  });

  it('formats errors as data: code, message, hint, and nearest anchors', () => {
    const payload = formatToolResult({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'the SEARCH text was not found in the document',
      hint: 're-read the region and retry with the exact current text',
      nearestLines: [12, 47],
    });
    expect(payload).toContain('ERROR NOT_FOUND');
    expect(payload).toContain('12, 47');
    expect(payload).toContain('re-read the region');
  });

  it('omits the anchors line when there are none', () => {
    const payload = formatToolResult({
      status: 'error',
      code: 'STALE_RANGE',
      message: 'line numbers are out of date',
      hint: 're-read, then retry',
    });
    expect(payload).toContain('ERROR STALE_RANGE');
    expect(payload).not.toContain('lines:');
  });
});
