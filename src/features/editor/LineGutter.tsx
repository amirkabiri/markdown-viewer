// The display-only line-number gutter. aria-hidden so numbers never reach
// a screen reader (the textarea stays the only editable/tabbable surface),
// pointer-events none so wheel/pointer fall through to the textarea. The
// whole column translates by -scrollTop — one compositor-friendly transform
// per scroll frame — and only the lines whose first visual row intersects
// the viewport (plus overscan) render, so the gutter stays smooth on
// 5,000-line documents.
import type { ReactNode } from 'react';

import { visibleLineRange } from './lineNumbers';

import styles from './Editor.module.css';

export interface LineGutterProps {
  /** The editor's rendered text direction — logical CSS properties inside
   *  resolve against it, putting the gutter on the inline-start side. */
  dir: 'ltr' | 'rtl';
  /** First-visual-row y offsets, one per logical line (content space). */
  tops: readonly number[];
  /** The textarea's current scrollTop (rAF-batched by useLineNumbers). */
  scrollTop: number;
  /** The textarea's visible height (0 → render everything, no geometry). */
  viewportHeight: number;
  /** One text row's rendered height (0 → render everything). */
  lineHeight: number;
}

export default function LineGutter({
  dir, tops, scrollTop, viewportHeight, lineHeight,
}: LineGutterProps) {
  const [first, last] = visibleLineRange(tops, scrollTop, viewportHeight, lineHeight);

  const numbers: ReactNode[] = [];
  // [-1, -1] (nothing visible — e.g. a stale scrollTop while the document
  // shrinks) must render no numbers at all.
  for (let i = Math.max(first, 0); i <= last; i += 1) {
    // The line number IS the identity: stable across edits and scrolls.
    numbers.push(
      <div key={`line-${i + 1}`} className={styles.gutterNumber} style={{ top: `${tops[i]}px` }}>
        {i + 1}
      </div>,
    );
  }

  return (
    <div className={styles.gutter} dir={dir} aria-hidden="true" data-testid="line-gutter">
      <div
        className={styles.gutterColumn}
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {numbers}
      </div>
    </div>
  );
}
