// Module: features/editor/lineMeasurer — the measurement boundary between
// the pure line-metrics math (lineNumbers.ts) and real text layout. The
// production measurer mirrors the document into a hidden div that replicates
// the textarea's wrap width and typography — the textarea is the wrap
// oracle, so soft-wrap heights match exactly. Tests inject scripted fakes
// instead (house style: fakes over mocks, TESTING.md).

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

/** Typography and wrapping properties copied from the textarea's computed
 *  style onto the mirror — everything that can change line breaking. */
const MIRROR_STYLE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'direction',
] as const;

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
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  const mirrorStyle = mirror.style;
  mirrorStyle.position = 'absolute';
  mirrorStyle.top = '0';
  mirrorStyle.insetInlineStart = '0';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  // The textarea's UA wrapping rules; white-space/overflow-wrap replicate
  // soft wrap, everything typographic is copied per measure pass below.
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  (textarea.parentElement ?? document.body).appendChild(mirror);

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
      for (let i = 0; i < MIRROR_STYLE_PROPS.length; i += 1) {
        const prop = MIRROR_STYLE_PROPS[i];
        mirrorStyle[prop] = cs[prop];
      }

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
