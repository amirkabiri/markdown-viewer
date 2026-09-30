// Unit tests for features/preview/sourceAnchor — the PURE half of the
// preview-selection→AI handoff: mapping a selection's rendered block units
// back to source line ranges in the raw markdown. The pipeline (marked 12)
// exposes no per-node positions, but its lexer tokens carry `raw` — the exact
// source slice — so spans are recovered by sequential scanning and verified
// against the rendered units' text before any range is trusted.
import { describe, expect, it } from 'vitest';

import {
  alignUnitsToSpans,
  buildSourceBlockSpans,
  headingPathForUnits,
  sourceRangeForUnits,
  type BlockUnit,
} from './sourceAnchor';

/** The mixed-shape doc most tests anchor into (1-based line numbers below). */
const DOC = [
  '# Main title', //          1
  '', //                      2
  'Intro paragraph.', //      3
  '', //                      4
  '## Section one', //        5
  '', //                      6
  'A paragraph here.', //     7
  '', //                      8
  '- item one', //            9
  '- item two', //            10
  '', //                      11
  '```js', //                 12
  'let x = 1;', //            13
  '```', //                   14
  '', //                      15
  'Outro paragraph.', //      16
  '', //                      17
].join('\n');

/** Units as the DOM adapter would read them from the rendered article. */
function units(specs: { text: string; kind?: BlockUnit['kind']; headingLevel?: number }[]): BlockUnit[] {
  return specs.map((s) => ({
    text: s.text,
    kind: s.kind ?? 'text',
    headingLevel: s.headingLevel ?? null,
  }));
}

describe('buildSourceBlockSpans', () => {
  it('recovers every rendered block’s source offset + line range', () => {
    const spans = buildSourceBlockSpans(DOC);
    expect(spans).not.toBeNull();
    const rendered = (spans ?? []).filter((s) => !s.skippable);

    // heading, paragraph, heading, paragraph, list, code, paragraph
    expect(rendered.map((s) => s.kind)).toEqual([
      'heading', 'paragraph', 'heading', 'paragraph', 'list', 'code', 'paragraph',
    ]);
    // line numbers are 1-based and match the layout above
    expect(rendered.map((s) => [s.startLine, s.endLine])).toEqual([
      [1, 1], [3, 3], [5, 5], [7, 7], [9, 10], [12, 14], [16, 16],
    ]);
    // offsets are exact source slices (char offsets into the LF-normalized text)
    expect(DOC.slice(rendered[0].startOffset, rendered[0].endOffset)).toContain('Main title');
    expect(DOC.slice(rendered[6].startOffset, rendered[6].endOffset)).toContain('Outro paragraph.');
  });

  it('normalizes CRLF exactly like the render pipeline does', () => {
    const crlf = buildSourceBlockSpans('# T\r\n\r\nBody line.\r\n');
    expect(crlf).not.toBeNull();
    const rendered = (crlf ?? []).filter((s) => !s.skippable);
    expect(rendered.map((s) => [s.startLine, s.endLine])).toEqual([[1, 1], [3, 3]]);
  });

  it('returns an empty (not null) span list for empty input', () => {
    expect(buildSourceBlockSpans('')).toEqual([]);
  });
});

describe('alignUnitsToSpans', () => {
  it('pairs rendered units to spans in order and skips invisible tokens', () => {
    const spans = buildSourceBlockSpans(DOC) ?? [];
    const unitsFor = units([
      { text: 'Main title', headingLevel: 1 },
      { text: 'Intro paragraph.' },
      { text: 'Section one', headingLevel: 2 },
      { text: 'A paragraph here.' },
      { text: 'item one item two' }, // list flatten
      { text: 'let x = 1;', kind: 'text' }, // pre (code block)
      { text: 'Outro paragraph.' },
    ]);

    const mapping = alignUnitsToSpans(unitsFor, spans);
    expect(mapping).not.toBeNull();
    // every unit lands on a non-skippable span (no drift past invisible tokens)
    expect((mapping ?? []).every((spanIndex) => !spans[spanIndex].skippable)).toBe(true);
  });

  it('returns null when the unit shapes disagree (untrusted → fallback)', () => {
    const spans = buildSourceBlockSpans(DOC) ?? [];
    // one unit too many — the article was replaced by different content
    const misaligned = units([
      { text: 'Main title', headingLevel: 1 },
      { text: 'Something entirely different.' },
      { text: 'Outro paragraph.' },
    ]);
    expect(alignUnitsToSpans(misaligned, spans)).toBeNull();
  });
});

describe('sourceRangeForUnits', () => {
  const spans = buildSourceBlockSpans(DOC) ?? [];
  const unitsFor = units([
    { text: 'Main title', headingLevel: 1 },
    { text: 'Intro paragraph.' },
    { text: 'Section one', headingLevel: 2 },
    { text: 'A paragraph here.' },
    { text: 'item one item two' },
    { text: 'let x = 1;' },
    { text: 'Outro paragraph.' },
  ]);
  const alignment = alignUnitsToSpans(unitsFor, spans) ?? [];

  it('maps a single-block selection to that block’s source lines', () => {
    const range = sourceRangeForUnits(spans, alignment, 3, 3);
    expect(range).toEqual({
      startOffset: DOC.indexOf('A paragraph here.'),
      endOffset: DOC.indexOf('A paragraph here.') + 'A paragraph here.'.length,
      startLine: 7,
      endLine: 7,
    });
  });

  it('maps a multi-block selection to the union of its blocks’ lines', () => {
    // paragraph → list → code fence selection
    const range = sourceRangeForUnits(spans, alignment, 3, 5);
    expect(range?.startLine).toBe(7);
    expect(range?.endLine).toBe(14);
  });

  it('returns null when a touched unit has no span (defensive)', () => {
    expect(sourceRangeForUnits(spans, [0], 0, 5)).toBeNull();
  });
});

describe('headingPathForUnits', () => {
  it('builds the nested heading path preceding the selection start', () => {
    const path = headingPathForUnits(
      units([
        { text: 'Main title', headingLevel: 1 },
        { text: 'Intro paragraph.' },
        { text: 'Section one', headingLevel: 2 },
        { text: 'A paragraph here.' },
      ]),
      3, // selection starts at "A paragraph here."
    );
    expect(path).toEqual(['Main title', 'Section one']);
  });

  it('pops shallower headings as the outline deepens then resets', () => {
    const path = headingPathForUnits(
      units([
        { text: 'Chapter', headingLevel: 1 },
        { text: 'Sub', headingLevel: 2 },
        { text: 'Deep', headingLevel: 3 },
        { text: 'Body.' },
        { text: 'Other', headingLevel: 2 },
        { text: 'Body two.' },
      ]),
      5,
    );
    expect(path).toEqual(['Chapter', 'Other']);
  });

  it('is empty before any heading', () => {
    expect(headingPathForUnits(units([{ text: 'Plain.' }]), 0)).toEqual([]);
  });
});
