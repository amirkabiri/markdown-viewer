// Unit tests for the pure line-metrics/alignment math behind the gutter:
// line splitting (logical-line semantics), per-line y offsets from injected
// wrapped heights, the visible-window computation (virtualization) and the
// digit-driven gutter width. No DOM — heights are supplied by the test, per
// the house fakes-over-mocks style (TESTING.md).
import { describe, expect, it } from 'vitest';

import {
  digitCount, gutterWidthStyle, lineTopOffsets, splitLines, visibleLineRange,
} from './lineNumbers';

describe('splitLines', () => {
  it('counts logical lines as text.split("\\n") — an empty document is one line', () => {
    expect(splitLines('')).toEqual(['']);
  });

  it('splits on newlines and keeps empty lines, including a trailing one', () => {
    expect(splitLines('alpha\nbeta')).toEqual(['alpha', 'beta']);
    expect(splitLines('alpha\n\nbeta')).toEqual(['alpha', '', 'beta']);
    expect(splitLines('alpha\n')).toEqual(['alpha', '']);
  });
});

describe('lineTopOffsets', () => {
  it('places line 0 at the given top and accumulates injected heights', () => {
    // Line 2 wraps to two rows (25 = 2 * 12.5), line 3 is single.
    expect(lineTopOffsets([10, 25, 5], 20)).toEqual([20, 30, 55]);
  });

  it('defaults the starting top to 0 and keeps fractional heights exact', () => {
    expect(lineTopOffsets([28.275, 28.275])).toEqual([0, 28.275]);
  });

  it('returns no offsets without lines', () => {
    expect(lineTopOffsets([], 20)).toEqual([]);
  });
});

describe('visibleLineRange', () => {
  const TOPS = [0, 30, 60, 90, 120];

  it('returns every line when the document fits the viewport', () => {
    expect(visibleLineRange([0, 30, 60], 0, 200, 30)).toEqual([0, 2]);
  });

  it('returns only the lines whose first visual row intersects the view', () => {
    // View covers y 65..115: row 2 (60..90) and row 3 (90..120) intersect.
    expect(visibleLineRange(TOPS, 65, 50, 30, 0)).toEqual([2, 3]);
  });

  it('extends the window by the overscan in both directions', () => {
    // View covers y 55..125 with overscan 10: rows 1..4 intersect.
    expect(visibleLineRange(TOPS, 65, 50, 30, 10)).toEqual([1, 4]);
  });

  it('keeps a number whose row is only partially visible at the top edge', () => {
    // Row 0 (0..30) is cut at y 25 — its glyph midpoint is still on screen.
    expect(visibleLineRange(TOPS, 25, 10, 30, 0)).toEqual([0, 1]);
  });

  it('renders nothing when scrolled past every line', () => {
    expect(visibleLineRange([0, 30], 500, 50, 30, 0)).toEqual([-1, -1]);
  });

  it('renders nothing without lines', () => {
    expect(visibleLineRange([], 0, 200, 30)).toEqual([-1, -1]);
  });

  it('renders everything when no geometry is available (viewport or row height unknown)', () => {
    // Measure-less environments (jsdom, pre-layout first paint) report no
    // geometry; the safe degradation is the full range.
    expect(visibleLineRange(TOPS, 0, 0, 30)).toEqual([0, 4]);
    expect(visibleLineRange(TOPS, 0, Number.NaN, 30)).toEqual([0, 4]);
    expect(visibleLineRange(TOPS, 0, 200, Number.NaN)).toEqual([0, 4]);
  });
});

describe('digitCount', () => {
  it('grows at powers of ten', () => {
    expect(digitCount(1)).toBe(1);
    expect(digitCount(9)).toBe(1);
    expect(digitCount(10)).toBe(2);
    expect(digitCount(99)).toBe(2);
    expect(digitCount(100)).toBe(3);
    expect(digitCount(50_000)).toBe(5);
  });
});

describe('gutterWidthStyle', () => {
  it('sizes the column in ch units plus fixed padding', () => {
    expect(gutterWidthStyle(1)).toContain('1ch');
    expect(gutterWidthStyle(9)).toContain('1ch');
  });

  it('auto-grows when the document crosses 9 lines', () => {
    expect(gutterWidthStyle(10)).toContain('2ch');
    expect(gutterWidthStyle(1234)).toContain('4ch');
  });
});
