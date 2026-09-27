// Module: features/preview/scrollSpy — the pure half of the legacy TOC scroll
// spy (legacy/src/ui.ts updateSpy): given the heading offsets and the scroll
// container's top, the active heading is the last one above the 90 px line.
export const SPY_THRESHOLD_PX = 90;

/**
 * Index of the active heading: the last heading whose top sits at or above
 * the container top + threshold (identical math to legacy updateSpy).
 */
export function currentHeadingIndex(headTops: number[], containerTop: number): number {
  let current = 0;
  for (let i = 0; i < headTops.length; i += 1) {
    if (headTops[i] - containerTop <= SPY_THRESHOLD_PX) current = i;
  }
  return current;
}
