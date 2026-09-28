// Small tests for the pure scroll-spy math (legacy updateSpy).
import { describe, expect, it } from 'vitest';

import { currentHeadingIndex } from './scrollSpy';

describe('currentHeadingIndex', () => {
  it('activates the last heading above the threshold line', () => {
    // container top at 0; headings at 50 (above 90) and 300 (below)
    expect(currentHeadingIndex([50, 300], 0)).toBe(0);
  });

  it('moves to a heading once it crosses the 90px line', () => {
    expect(currentHeadingIndex([50, 90, 300], 0)).toBe(1);
    expect(currentHeadingIndex([50, 91, 300], 0)).toBe(0);
  });

  it('counts scrolled-past headings, keeping the deepest match', () => {
    expect(currentHeadingIndex([-500, -100, 89, 900], 0)).toBe(2);
  });

  it('offsets by the container top (split pane below a header)', () => {
    expect(currentHeadingIndex([140, 260], 100)).toBe(0);
    expect(currentHeadingIndex([140, 190], 100)).toBe(1);
  });

  it('defaults to the first heading when nothing crossed yet', () => {
    expect(currentHeadingIndex([500, 900], 0)).toBe(0);
  });
});
