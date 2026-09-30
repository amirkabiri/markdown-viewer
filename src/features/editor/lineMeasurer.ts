// Module: features/editor/lineMeasurer — the measurement boundary between
// the pure line-metrics math (lineNumbers.ts) and real text layout. The
// production measurer mirrors the document into a hidden div that replicates
// the textarea's wrap width and typography — the textarea is the wrap
// oracle, so soft-wrap heights match exactly. Tests inject scripted fakes
// instead (house style: fakes over mocks, TESTING.md). The mirror base
// (creation + typography) is shared with the selection toolbar's caret
// measurer (textareaMirror.ts / caretGeometry.ts).

import { createHiddenMirror, syncMirrorTypography } from './textareaMirror';

/**
 * Wrapped-row heights for one measurement pass. Contract: called at most
 * once per animation frame with the full logical-line list; must not
 * mutate the textarea.
 */
export interface LineMeasurer {
  /** Rendered height (px, fractional) of each logical line at the editor's
   *  current wrap width — its visual row count × row height. */
  measureHeights(lines: readonly string[]): number[];
  /** Release any measurement resources (the mirror node). Optional — fakes
   *  are stateless and skip it. */
  dispose?(): void;
}

/**
 * The real measurer: a `visibility: hidden`, `pointer-events: none`,
 * `aria-hidden` mirror kept inside the editor wrapper. Each measure pass
 * syncs the mirror's width (the textarea's exact content box, scrollbar
 * excluded via clientWidth) and typography from the textarea's computed
 * style, rebuilds one block per logical line, then reads the blocks'
 * heights — the first read settles the single layout flush, the rest are
 * struct reads. Heights come from getBoundingClientRect (sub-pixel), not
 * offsetHeight (integer-rounded), so lineTopOffsets does not drift over
 * long documents.
 */
export function createDomLineMeasurer(textarea: HTMLTextAreaElement): LineMeasurer {
  const mirror = createHiddenMirror(textarea);
  const mirrorStyle = mirror.style;

  return {
    measureHeights(lines: readonly string[]): number[] {
      const cs = getComputedStyle(textarea);
      // The textarea's text wraps inside clientWidth minus its padding —
      // clientWidth already excludes the scrollbar, so the mirror wraps on
      // exactly the same width (and re-wraps when the scrollbar appears).
      const contentWidth = textarea.clientWidth
        - (parseFloat(cs.paddingLeft) || 0)
        - (parseFloat(cs.paddingRight) || 0);
      mirrorStyle.width = `${contentWidth}px`;
      syncMirrorTypography(mirror, cs);

      // One block per logical line; an empty line gets a zero-width space
      // so it still produces its strut row (one row tall), like the
      // textarea's own empty lines.
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < lines.length; i += 1) {
        const block = document.createElement('div');
        block.textContent = lines[i] === '' ? '\u200B' : lines[i];
        fragment.appendChild(block);
      }
      mirror.replaceChildren(fragment);

      return lines.map((_, i) => {
        const block = mirror.children[i];
        if (!(block instanceof HTMLElement)) throw new Error('line mirror is missing a row block');
        return block.getBoundingClientRect().height;
      });
    },

    dispose() {
      mirror.remove();
    },
  };
}
