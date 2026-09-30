// Module: features/editor/lineNumbers — the pure line-metrics math behind
// the document editor's line-number gutter. No DOM: heights come from an
// injected measurer (real layout in the browser via lineMeasurer.ts,
// scripted fakes in tests), so every rule here is unit-testable in node.
// Line semantics are the textarea's own: one logical line per '\n', and an
// empty document is exactly one line.

/** Logical lines of a document — `text.split('\n')`, the line count a user
 *  (and the statusbar) already reasons with. */
export function splitLines(text: string): string[] {
  return text.split('\n');
}

/**
 * Y offset of each logical line's FIRST VISUAL ROW: line 0 sits at `top`,
 * every following line below the previous line's wrapped height, so a
 * paragraph that soft-wraps across k rows advances the numbering by k rows.
 * Fractional pixel heights are preserved (the measurer reports sub-pixel
 * heights) so offsets do not drift over thousands of lines.
 */
export function lineTopOffsets(heights: readonly number[], top = 0): number[] {
  const tops: number[] = [];
  let y = top;
  for (let i = 0; i < heights.length; i += 1) {
    tops.push(y);
    y += heights[i];
  }
  return tops;
}

/**
 * Inclusive [first, last] index range of the lines whose numbered row — a
 * line's first visual row, `[tops[i], tops[i] + lineHeight]` — intersects
 * `[scrollTop - overscan, scrollTop + viewportHeight + overscan]`. Binary
 * searches over the sorted tops keep this O(log n) per scroll frame.
 *
 * Without usable geometry (viewportHeight or lineHeight not positive —
 * jsdom, or the first frame before measurement) the full range renders: the
 * safe degradation is every number, not none.
 */
export function visibleLineRange(
  tops: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  lineHeight: number,
  overscan = 8,
): [number, number] {
  const count = tops.length;
  if (count === 0) return [-1, -1];
  if (!(viewportHeight > 0) || !(lineHeight > 0)) return [0, count - 1];

  const viewTop = scrollTop - overscan;
  const viewBottom = scrollTop + viewportHeight + overscan;

  // Smallest index whose row reaches below the (overscanned) view top.
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (tops[mid] > viewTop - lineHeight) hi = mid;
    else lo = mid + 1;
  }
  const first = tops[lo] > viewTop - lineHeight ? lo : count;

  // Largest index whose row starts above the (overscanned) view bottom.
  lo = 0;
  hi = count - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tops[mid] < viewBottom) lo = mid;
    else hi = mid - 1;
  }
  const last = tops[lo] < viewBottom ? lo : -1;

  return first <= last ? [first, last] : [-1, -1];
}

/** Digits needed to number `lineCount` lines (9 → 1, 10 → 2). */
export function digitCount(lineCount: number): number {
  return String(Math.max(1, lineCount)).length;
}

/** The gutter's horizontal padding, both sides together. Keep in sync with
 *  `Editor.module.css` (`.gutter { padding-inline: … }`). */
export const GUTTER_INLINE_PX = 20;

/** Gutter column width: one `ch` per digit (the gutter uses the editor's
 *  monospace stack, so `ch` is exactly a digit width) plus fixed padding. */
export function gutterWidthStyle(lineCount: number): string {
  return `calc(${GUTTER_INLINE_PX}px + ${digitCount(lineCount)}ch)`;
}
